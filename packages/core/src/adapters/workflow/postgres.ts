/**
 * Postgres workflow adapter for Herald.
 *
 * Uses PostgreSQL as a durable job queue for workflow execution.
 * No external services required — just a Postgres connection.
 *
 * @example
 * ```ts
 * import { postgresWorkflowAdapter } from "@herald/core/postgres";
 *
 * const workflow = postgresWorkflowAdapter({
 *   connectionString: process.env.DATABASE_URL,
 * });
 * ```
 */
import { conditionsPass, performFetch, toMs } from "../../core/workflow-runtime.js";
import type {
	CancelArgs,
	DigestedEvent,
	NotificationWorkflow,
	StepContext,
	StepResult,
	TriggerArgs,
	TriggerResult,
	WorkflowAdapter,
	WorkflowHandler,
	WorkflowStep,
} from "../../types/workflow.js";

// ---------------------------------------------------------------------------
// Minimal Postgres pool interface
// ---------------------------------------------------------------------------

/**
 * Minimal Postgres query result.
 */
export interface PgQueryResult {
	rows: Record<string, unknown>[];
	rowCount: number | null;
}

/**
 * Minimal Postgres client — used inside transactions via pool.connect().
 */
export interface PgClient {
	query(text: string, values?: unknown[]): Promise<PgQueryResult>;
	release(): void;
}

/**
 * Minimal Postgres pool interface.
 * Any client that satisfies this shape works — pg.Pool, @neondatabase/serverless, etc.
 * In a future version this can be replaced by a DatabaseAdapter for full ORM reuse.
 */
export interface PgPool {
	query(text: string, values?: unknown[]): Promise<PgQueryResult>;
	connect(): Promise<PgClient>;
	end?(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface PostgresWorkflowConfig {
	/** Pass an existing pool instance that satisfies PgPool. */
	pool?: PgPool;
	/** Or provide a connection string — adapter creates a pg.Pool internally. */
	connectionString?: string;
	/** Polling interval in milliseconds. @default 1000 */
	pollInterval?: number;
	/** Maximum concurrent job executions per poll cycle. @default 10 */
	concurrency?: number;
	/** Maximum retries per job before marking as failed. @default 3 */
	maxRetries?: number;
	/** Table name prefix. @default "herald_wf" */
	tablePrefix?: string;
	/** Auto-create tables on startup. @default true */
	autoMigrate?: boolean;
}

// ---------------------------------------------------------------------------
// Job row shape (as returned from Postgres)
// ---------------------------------------------------------------------------

interface JobRow {
	id: string;
	transaction_id: string;
	workflow_id: string;
	subscriber_id: string;
	payload: Record<string, unknown>;
	actor: string | null;
	tenant: string | null;
	overrides: Record<string, unknown> | null;
	status: string;
	current_step: number;
	step_results: Record<string, Record<string, unknown>>;
	error: string | null;
	retry_count: number;
	max_retries: number;
	scheduled_at: string;
	created_at: string;
	updated_at: string;
}

// ---------------------------------------------------------------------------
// Status constants
// ---------------------------------------------------------------------------

type JobStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
const PENDING: JobStatus = "pending";
const RUNNING: JobStatus = "running";
const COMPLETED: JobStatus = "completed";
const FAILED: JobStatus = "failed";

// ---------------------------------------------------------------------------
// Extended adapter return type
// ---------------------------------------------------------------------------

export type PostgresWorkflowAdapter = WorkflowAdapter & {
	/** Start the background poller. Called automatically on first trigger(). */
	start(): Promise<void>;
	/** Stop polling and drain in-flight jobs. */
	stop(): Promise<void>;
	/** Run table migrations explicitly (also runs automatically if autoMigrate is true). */
	migrate(): Promise<void>;
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function postgresWorkflowAdapter(config: PostgresWorkflowConfig): PostgresWorkflowAdapter {
	if (!config.pool && !config.connectionString) {
		throw new Error(
			"postgresWorkflowAdapter requires either a `pool` or `connectionString` option",
		);
	}

	const prefix = config.tablePrefix ?? "herald_wf";
	const pollInterval = config.pollInterval ?? 1000;
	const concurrency = config.concurrency ?? 10;
	const maxRetries = config.maxRetries ?? 3;
	const autoMigrate = config.autoMigrate ?? true;

	const workflows = new Map<string, NotificationWorkflow>();
	let pool: PgPool;
	let ownsPool = false;
	let pollingTimer: ReturnType<typeof setInterval> | null = null;
	let started = false;
	let migrated = false;
	let inFlightCount = 0;

	// -----------------------------------------------------------------------
	// Pool initialization (lazy)
	// -----------------------------------------------------------------------

	async function getPool(): Promise<PgPool> {
		if (pool) return pool;

		if (config.pool) {
			pool = config.pool;
		} else {
			// Dynamic import so pg is only required when using connectionString
			// @ts-expect-error — pg types not required; we type against PgPool
			const pgModule = (await import("pg")) as Record<string, unknown>;
			const defaultExport = pgModule.default as Record<string, unknown> | undefined;
			const PoolCtor = defaultExport?.Pool ?? pgModule.Pool;
			pool = new (PoolCtor as new (opts: { connectionString?: string }) => PgPool)({
				connectionString: config.connectionString,
			});
			ownsPool = true;
		}

		return pool;
	}

	// -----------------------------------------------------------------------
	// Migration
	// -----------------------------------------------------------------------

	async function migrate(): Promise<void> {
		if (migrated) return;
		const p = await getPool();

		await p.query(`
			CREATE TABLE IF NOT EXISTS ${prefix}_jobs (
				id              TEXT PRIMARY KEY,
				transaction_id  TEXT NOT NULL,
				workflow_id     TEXT NOT NULL,
				subscriber_id   TEXT NOT NULL,
				payload         JSONB NOT NULL DEFAULT '{}',
				actor           TEXT,
				tenant          TEXT,
				overrides       JSONB,
				status          TEXT NOT NULL DEFAULT 'pending',
				current_step    INT NOT NULL DEFAULT 0,
				step_results    JSONB NOT NULL DEFAULT '{}',
				error           TEXT,
				retry_count     INT NOT NULL DEFAULT 0,
				max_retries     INT NOT NULL DEFAULT ${maxRetries},
				scheduled_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
			);
		`);

		await p.query(`
			CREATE TABLE IF NOT EXISTS ${prefix}_digest_events (
				id              TEXT PRIMARY KEY,
				job_id          TEXT NOT NULL REFERENCES ${prefix}_jobs(id) ON DELETE CASCADE,
				digest_key      TEXT NOT NULL,
				payload         JSONB NOT NULL DEFAULT '{}',
				created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
			);
		`);

		await p.query(`
			CREATE TABLE IF NOT EXISTS ${prefix}_throttle_state (
				key             TEXT PRIMARY KEY,
				count           INT NOT NULL DEFAULT 0,
				window_start    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				window_ms       BIGINT NOT NULL
			);
		`);

		// Partial index for the poller query
		await p.query(`
			CREATE INDEX IF NOT EXISTS idx_${prefix}_jobs_poll
			ON ${prefix}_jobs (status, scheduled_at)
			WHERE status IN ('pending');
		`);

		await p.query(`
			CREATE INDEX IF NOT EXISTS idx_${prefix}_jobs_transaction
			ON ${prefix}_jobs (transaction_id);
		`);

		await p.query(`
			CREATE INDEX IF NOT EXISTS idx_${prefix}_digest_key
			ON ${prefix}_digest_events (digest_key, job_id);
		`);

		migrated = true;
	}

	// -----------------------------------------------------------------------
	// Polling
	// -----------------------------------------------------------------------

	async function start(): Promise<void> {
		if (started) return;
		if (autoMigrate) await migrate();
		started = true;

		pollingTimer = setInterval(() => {
			pollAndExecute().catch((err) => {
				console.error("[herald] Postgres workflow poller error:", err);
			});
		}, pollInterval);
	}

	async function stop(): Promise<void> {
		if (pollingTimer) {
			clearInterval(pollingTimer);
			pollingTimer = null;
		}
		started = false;

		// Wait for in-flight jobs to drain (up to 30s)
		const deadline = Date.now() + 30_000;
		while (inFlightCount > 0 && Date.now() < deadline) {
			await new Promise((r) => setTimeout(r, 100));
		}

		if (ownsPool && pool?.end) {
			await pool.end();
		}
	}

	async function pollAndExecute(): Promise<void> {
		const p = await getPool();
		const client = await p.connect();

		try {
			await client.query("BEGIN");

			const result = await client.query(
				`
				SELECT * FROM ${prefix}_jobs
				WHERE status = '${PENDING}'
				  AND scheduled_at <= NOW()
				ORDER BY created_at ASC
				LIMIT $1
				FOR UPDATE SKIP LOCKED
				`,
				[concurrency],
			);

			if (result.rows.length === 0) {
				await client.query("COMMIT");
				return;
			}

			// Mark jobs as running within the transaction
			const ids = result.rows.map((r) => r.id as string);
			await client.query(
				`UPDATE ${prefix}_jobs SET status = '${RUNNING}', updated_at = NOW() WHERE id = ANY($1)`,
				[ids],
			);

			await client.query("COMMIT");

			// Execute jobs outside the transaction
			await Promise.allSettled(result.rows.map((row) => executeJob(row as unknown as JobRow)));
		} catch (err) {
			await client.query("ROLLBACK").catch(() => {});
			throw err;
		} finally {
			client.release();
		}
	}

	// -----------------------------------------------------------------------
	// Job execution
	// -----------------------------------------------------------------------

	async function executeJob(job: JobRow): Promise<void> {
		inFlightCount++;
		const p = await getPool();

		try {
			const workflow = workflows.get(job.workflow_id);
			if (!workflow) {
				await p.query(
					`UPDATE ${prefix}_jobs SET status = '${FAILED}', error = $1, updated_at = NOW() WHERE id = $2`,
					[`No workflow registered with id "${job.workflow_id}"`, job.id],
				);
				return;
			}

			const handlerPayload = { ...job.payload };

			// Resume from current_step (supports crash recovery)
			for (let i = job.current_step; i < workflow.steps.length; i++) {
				const currentStep = workflow.steps[i];
				if (!currentStep) continue;

				const subscriberCtx = { id: job.subscriber_id, externalId: job.subscriber_id };
				const stepContext: StepContext = {
					subscriber: subscriberCtx,
					payload: handlerPayload,
					step: {
						delay: async (c) => c as unknown as undefined,
						digest: async () => [],
						throttle: async (c) => ({ throttled: false, count: 0, limit: c.limit }),
						fetch: async (c) => performFetch(c),
					},
				};

				// Check conditions
				if (
					!conditionsPass(currentStep.conditions, stepContext, currentStep.conditionMode)
				) {
					await advanceStep(p, job.id, i + 1);
					continue;
				}

				// Handle special step types
				if (currentStep.type === "delay") {
					const action = await handleDelayStep(p, job, currentStep, i, stepContext);
					if (action === "parked") return;
					continue;
				}

				if (currentStep.type === "digest") {
					const action = await handleDigestStep(p, job, currentStep, i, stepContext);
					if (action === "parked") return;
					continue;
				}

				if (currentStep.type === "throttle") {
					const throttled = await handleThrottleStep(p, job, currentStep, stepContext);
					if (throttled) {
						await p.query(
							`UPDATE ${prefix}_jobs SET status = '${COMPLETED}', updated_at = NOW() WHERE id = $1`,
							[job.id],
						);
						return;
					}
					await advanceStep(p, job.id, i + 1);
					continue;
				}

				if (currentStep.type === "fetch") {
					const result = await currentStep.handler(stepContext);
					if (
						result._internal?.fetchResult != null &&
						typeof result._internal.fetchResult === "object"
					) {
						Object.assign(handlerPayload, result._internal.fetchResult);
					}
					await advanceStep(p, job.id, i + 1);
					continue;
				}

				// Channel steps (email, in_app, sms, push, chat, webhook)
				await currentStep.handler(stepContext);
				await advanceStep(p, job.id, i + 1);
			}

			// All steps completed
			await p.query(
				`UPDATE ${prefix}_jobs SET status = '${COMPLETED}', updated_at = NOW() WHERE id = $1`,
				[job.id],
			);
		} catch (err) {
			await handleJobError(p, job, err);
		} finally {
			inFlightCount--;
		}
	}

	async function advanceStep(p: PgPool, jobId: string, nextStep: number): Promise<void> {
		await p.query(`UPDATE ${prefix}_jobs SET current_step = $1, updated_at = NOW() WHERE id = $2`, [
			nextStep,
			jobId,
		]);
	}

	// -----------------------------------------------------------------------
	// Step handlers
	// -----------------------------------------------------------------------

	async function handleDelayStep(
		p: PgPool,
		job: JobRow,
		step: WorkflowStep,
		stepIndex: number,
		context: StepContext,
	): Promise<"parked" | "continue"> {
		let capturedDelay: { amount: number; unit: "seconds" | "minutes" | "hours" | "days" } | null =
			null;

		const delayContext: StepContext = {
			...context,
			step: {
				...context.step,
				delay: async (c) => {
					capturedDelay = c;
				},
			},
		};

		await step.handler(delayContext);

		if (capturedDelay) {
			const { amount, unit } = capturedDelay as { amount: number; unit: "seconds" | "minutes" | "hours" | "days" };
			const ms = toMs(amount, unit);
			// Park: advance step and set future scheduled_at so poller picks it up later
			await p.query(
				`UPDATE ${prefix}_jobs
				 SET current_step = $1, scheduled_at = NOW() + ($2 || ' milliseconds')::interval,
				     status = '${PENDING}', updated_at = NOW()
				 WHERE id = $3`,
				[stepIndex + 1, String(ms), job.id],
			);
			return "parked";
		}

		await advanceStep(p, job.id, stepIndex + 1);
		return "continue";
	}

	async function handleDigestStep(
		p: PgPool,
		job: JobRow,
		step: WorkflowStep,
		stepIndex: number,
		context: StepContext,
	): Promise<"parked" | "continue"> {
		const stepResults = job.step_results ?? {};
		const stepState = stepResults[step.stepId] as { windowSet?: boolean } | undefined;

		if (!stepState?.windowSet) {
			// First encounter — extract window config, park the job
			const captured: { window: number; unit: "seconds" | "minutes" | "hours" }[] = [];

			const digestContext: StepContext = {
				...context,
				step: {
					...context.step,
					digest: async (c) => {
						captured.push(c);
						return [];
					},
				},
			};

			await step.handler(digestContext);

			const digestWindow = captured[0]?.window ?? 5;
			const digestUnit = captured[0]?.unit ?? ("minutes" as const);
			const ms = toMs(digestWindow, digestUnit);

			const newResults = { ...stepResults, [step.stepId]: { windowSet: true } };

			await p.query(
				`UPDATE ${prefix}_jobs
				 SET scheduled_at = NOW() + ($1 || ' milliseconds')::interval,
				     step_results = $2, status = '${PENDING}', updated_at = NOW()
				 WHERE id = $3`,
				[String(ms), JSON.stringify(newResults), job.id],
			);
			return "parked";
		}

		// Window expired — collect digest events
		const digestKey = `${job.workflow_id}:${step.stepId}:${job.subscriber_id}`;
		const events = await p.query(
			`DELETE FROM ${prefix}_digest_events WHERE digest_key = $1 RETURNING payload, created_at`,
			[digestKey],
		);

		const digested: DigestedEvent[] = events.rows.map((r) => ({
			payload: (r.payload ?? {}) as Record<string, unknown>,
			timestamp: new Date(r.created_at as string),
		}));

		const digestContext: StepContext = {
			...context,
			step: {
				...context.step,
				digest: async () => digested,
			},
		};

		await step.handler(digestContext);
		await advanceStep(p, job.id, stepIndex + 1);
		return "continue";
	}

	async function handleThrottleStep(
		p: PgPool,
		job: JobRow,
		step: WorkflowStep,
		context: StepContext,
	): Promise<boolean> {
		let capturedConfig: {
			key: string;
			limit: number;
			window: number;
			unit: "seconds" | "minutes" | "hours";
		} | null = null;

		const throttleContext: StepContext = {
			...context,
			step: {
				...context.step,
				throttle: async (c) => {
					capturedConfig = c;
					return { throttled: false, count: 0, limit: c.limit };
				},
			},
		};

		// First call to capture the config
		await step.handler(throttleContext);

		if (!capturedConfig) return false;

		const cfg = capturedConfig as { key: string; limit: number; window: number; unit: "seconds" | "minutes" | "hours" };
		const windowMs = toMs(cfg.window, cfg.unit);
		const throttleKey = `${job.workflow_id}:${cfg.key}`;

		const result = await p.query(
			`INSERT INTO ${prefix}_throttle_state (key, count, window_start, window_ms)
			 VALUES ($1, 1, NOW(), $2)
			 ON CONFLICT (key) DO UPDATE SET
			   count = CASE
			     WHEN ${prefix}_throttle_state.window_start + (${prefix}_throttle_state.window_ms || ' milliseconds')::interval < NOW()
			     THEN 1
			     ELSE ${prefix}_throttle_state.count + 1
			   END,
			   window_start = CASE
			     WHEN ${prefix}_throttle_state.window_start + (${prefix}_throttle_state.window_ms || ' milliseconds')::interval < NOW()
			     THEN NOW()
			     ELSE ${prefix}_throttle_state.window_start
			   END
			 RETURNING count`,
			[throttleKey, windowMs],
		);

		const firstRow = result.rows[0];
		if (!firstRow) return false;
		const count = firstRow.count as number;
		const limit = cfg.limit;
		if (count > limit) {
			// Re-run handler with throttled result so it can set _internal
			const finalContext: StepContext = {
				...context,
				step: {
					...context.step,
					throttle: async () => ({
						throttled: true,
						count,
						limit,
					}),
				},
			};
			const stepResult = await step.handler(finalContext);
			return stepResult._internal?.throttled === true;
		}

		return false;
	}

	// -----------------------------------------------------------------------
	// Error handling & retry
	// -----------------------------------------------------------------------

	async function handleJobError(p: PgPool, job: JobRow, err: unknown): Promise<void> {
		const message = err instanceof Error ? err.message : String(err);
		const retryCount = job.retry_count + 1;

		if (retryCount >= job.max_retries) {
			await p.query(
				`UPDATE ${prefix}_jobs SET status = '${FAILED}', error = $1, retry_count = $2, updated_at = NOW() WHERE id = $3`,
				[message, retryCount, job.id],
			);
			console.error(
				`[herald] Postgres workflow job ${job.id} failed after ${retryCount} retries:`,
				message,
			);
		} else {
			// Exponential backoff: 2^retryCount seconds
			const backoffMs = 2 ** retryCount * 1000;
			await p.query(
				`UPDATE ${prefix}_jobs SET status = '${PENDING}', retry_count = $1, error = $2,
				 scheduled_at = NOW() + ($3 || ' milliseconds')::interval, updated_at = NOW()
				 WHERE id = $4`,
				[retryCount, message, String(backoffMs), job.id],
			);
		}
	}

	// -----------------------------------------------------------------------
	// WorkflowAdapter interface
	// -----------------------------------------------------------------------

	return {
		adapterId: "postgres",

		registerWorkflow(workflow: NotificationWorkflow): void {
			workflows.set(workflow.id, workflow);
		},

		async trigger(args: TriggerArgs): Promise<TriggerResult> {
			const p = await getPool();
			if (!started) await start();

			const transactionId = args.transactionId ?? crypto.randomUUID();
			const recipients = Array.isArray(args.to) ? args.to : [args.to];

			for (const subscriberId of recipients) {
				const jobId = crypto.randomUUID();
				await p.query(
					`INSERT INTO ${prefix}_jobs (id, transaction_id, workflow_id, subscriber_id, payload, actor, tenant, overrides, max_retries)
					 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
					[
						jobId,
						transactionId,
						args.workflowId,
						subscriberId,
						JSON.stringify(args.payload),
						args.actor ?? null,
						args.tenant ?? null,
						args.overrides ? JSON.stringify(args.overrides) : null,
						maxRetries,
					],
				);

				// If this workflow has digest steps, insert digest events
				const workflow = workflows.get(args.workflowId);
				if (workflow) {
					for (const step of workflow.steps) {
						if (step.type === "digest") {
							const digestKey = `${args.workflowId}:${step.stepId}:${subscriberId}`;
							await p.query(
								`INSERT INTO ${prefix}_digest_events (id, job_id, digest_key, payload)
								 VALUES ($1, $2, $3, $4)`,
								[crypto.randomUUID(), jobId, digestKey, JSON.stringify(args.payload)],
							);
						}
					}
				}
			}

			return { transactionId, status: "queued" };
		},

		async cancel(args: CancelArgs): Promise<void> {
			const p = await getPool();
			await p.query(
				`UPDATE ${prefix}_jobs SET status = 'cancelled', updated_at = NOW()
				 WHERE transaction_id = $1 AND workflow_id = $2 AND status IN ('${PENDING}', '${RUNNING}')`,
				[args.transactionId, args.workflowId],
			);
		},

		getHandler(): WorkflowHandler | null {
			return null;
		},

		start,
		stop,
		migrate,
	};
}
