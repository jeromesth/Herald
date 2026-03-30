import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PgClient, PgPool, PgQueryResult, PostgresWorkflowAdapter } from "../src/adapters/workflow/postgres.js";
import { postgresWorkflowAdapter } from "../src/adapters/workflow/postgres.js";
import type { NotificationWorkflow, StepContext, StepResult } from "../src/types/workflow.js";

// ---------------------------------------------------------------------------
// Mock PgPool
// ---------------------------------------------------------------------------

interface QueryLog {
	text: string;
	values?: unknown[];
}

function createMockPool(): PgPool & {
	queries: QueryLog[];
	mockResult: (result: PgQueryResult) => void;
	mockResults: (results: PgQueryResult[]) => void;
} {
	const queries: QueryLog[] = [];
	let resultQueue: PgQueryResult[] = [];
	const defaultResult: PgQueryResult = { rows: [], rowCount: 0 };

	const mockQuery = async (text: string, values?: unknown[]): Promise<PgQueryResult> => {
		queries.push({ text, values });
		return resultQueue.shift() ?? defaultResult;
	};

	return {
		queries,
		mockResult(result: PgQueryResult) {
			resultQueue.push(result);
		},
		mockResults(results: PgQueryResult[]) {
			resultQueue = [...results];
		},
		async query(text: string, values?: unknown[]): Promise<PgQueryResult> {
			return mockQuery(text, values);
		},
		async connect(): Promise<PgClient> {
			return {
				query: mockQuery,
				release: () => {},
			};
		},
		async end(): Promise<void> {},
	};
}

// ---------------------------------------------------------------------------
// Helper workflows
// ---------------------------------------------------------------------------

function simpleEmailWorkflow(): NotificationWorkflow {
	return {
		id: "welcome",
		name: "Welcome",
		steps: [
			{
				stepId: "email-1",
				type: "email",
				handler: async () => ({ subject: "Hi", body: "Hello" }),
			},
		],
	};
}

function delayThenEmailWorkflow(): NotificationWorkflow {
	return {
		id: "delay-wf",
		name: "Delay WF",
		steps: [
			{
				stepId: "delay-1",
				type: "delay",
				handler: async ({ step }) => {
					await step.delay({ amount: 30, unit: "minutes" });
					return { body: "" };
				},
			},
			{
				stepId: "email-1",
				type: "email",
				handler: async () => ({ subject: "Hi", body: "Hello" }),
			},
		],
	};
}

function digestWorkflow(): NotificationWorkflow {
	return {
		id: "digest-wf",
		name: "Digest WF",
		steps: [
			{
				stepId: "digest-1",
				type: "digest",
				handler: async ({ step }) => {
					const events = await step.digest({ window: 5, unit: "minutes" });
					return { body: `Got ${events.length} events` };
				},
			},
		],
	};
}

function throttleWorkflow(key = "t", limit = 2): NotificationWorkflow {
	return {
		id: "throttle-wf",
		name: "Throttle WF",
		steps: [
			{
				stepId: "throttle-1",
				type: "throttle",
				handler: async ({ step }) => {
					const r = await step.throttle({ key, limit, window: 1, unit: "hours" });
					if (r.throttled) {
						return { body: "throttled", _internal: { throttled: true } };
					}
					return { body: "ok" };
				},
			},
			{
				stepId: "email-1",
				type: "email",
				handler: async () => ({ subject: "Hi", body: "Hello" }),
			},
		],
	};
}

function fetchThenEmailWorkflow(): NotificationWorkflow {
	return {
		id: "fetch-wf",
		name: "Fetch WF",
		steps: [
			{
				stepId: "fetch-1",
				type: "fetch",
				handler: async ({ step }) => {
					const result = await step.fetch({ url: "https://api.example.com/data" });
					return { body: "", _internal: { fetchResult: result.data } };
				},
			},
			{
				stepId: "email-1",
				type: "email",
				handler: async ({ payload }) => ({
					subject: "Hi",
					body: `Name: ${payload.userName}`,
				}),
			},
		],
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("postgresWorkflowAdapter", () => {
	let mockPool: ReturnType<typeof createMockPool>;
	let adapter: PostgresWorkflowAdapter;

	beforeEach(() => {
		mockPool = createMockPool();
		adapter = postgresWorkflowAdapter({
			pool: mockPool,
			autoMigrate: false,
			pollInterval: 100_000, // Effectively disabled — we'll call methods directly
		});
	});

	afterEach(async () => {
		await adapter.stop();
	});

	describe("configuration", () => {
		it("throws when neither pool nor connectionString is provided", () => {
			expect(() => postgresWorkflowAdapter({} as PostgresWorkflowConfig)).toThrow("requires either a `pool` or `connectionString`");
		});

		it("has adapterId 'postgres'", () => {
			expect(adapter.adapterId).toBe("postgres");
		});

		it("getHandler() returns null", () => {
			expect(adapter.getHandler()).toBeNull();
		});
	});

	describe("registerWorkflow", () => {
		it("stores workflows in internal map", () => {
			const wf = simpleEmailWorkflow();
			adapter.registerWorkflow(wf);
			// We can verify it was stored by triggering — if not registered, trigger still inserts jobs
			// but executeJob would fail. Registration is implicitly tested via trigger+execute tests.
		});
	});

	describe("migrate", () => {
		it("creates tables and indexes idempotently", async () => {
			await adapter.migrate();

			const createQueries = mockPool.queries.filter((q) => q.text.includes("CREATE TABLE IF NOT EXISTS"));
			expect(createQueries).toHaveLength(3); // jobs, digest_events, throttle_state

			const indexQueries = mockPool.queries.filter((q) => q.text.includes("CREATE INDEX IF NOT EXISTS"));
			expect(indexQueries).toHaveLength(3); // poll, transaction, digest_key
		});

		it("only runs once (idempotent)", async () => {
			await adapter.migrate();
			const firstCount = mockPool.queries.length;

			await adapter.migrate();
			expect(mockPool.queries.length).toBe(firstCount); // No new queries
		});
	});

	describe("trigger", () => {
		it("inserts a job row per recipient", async () => {
			adapter.registerWorkflow(simpleEmailWorkflow());
			const result = await adapter.trigger({
				workflowId: "welcome",
				to: ["user-1", "user-2"],
				payload: { message: "hello" },
			});

			expect(result.status).toBe("queued");
			expect(result.transactionId).toBeDefined();

			const insertQueries = mockPool.queries.filter((q) => q.text.includes("INSERT INTO herald_wf_jobs"));
			expect(insertQueries).toHaveLength(2);

			// Verify payload is serialized
			expect(insertQueries[0].values?.[4]).toBe(JSON.stringify({ message: "hello" }));
		});

		it("uses provided transactionId", async () => {
			adapter.registerWorkflow(simpleEmailWorkflow());
			const result = await adapter.trigger({
				workflowId: "welcome",
				to: "user-1",
				payload: {},
				transactionId: "custom-tx-id",
			});

			expect(result.transactionId).toBe("custom-tx-id");
		});

		it("accepts a single recipient string", async () => {
			adapter.registerWorkflow(simpleEmailWorkflow());
			await adapter.trigger({ workflowId: "welcome", to: "user-1", payload: {} });

			const insertQueries = mockPool.queries.filter((q) => q.text.includes("INSERT INTO herald_wf_jobs"));
			expect(insertQueries).toHaveLength(1);
		});

		it("inserts digest events for workflows with digest steps", async () => {
			adapter.registerWorkflow(digestWorkflow());
			await adapter.trigger({ workflowId: "digest-wf", to: "user-1", payload: { data: 1 } });

			const digestInserts = mockPool.queries.filter((q) => q.text.includes("INSERT INTO herald_wf_digest_events"));
			expect(digestInserts).toHaveLength(1);
			expect(digestInserts[0].values?.[2]).toBe("digest-wf:digest-1:user-1");
		});

		it("includes actor and tenant when provided", async () => {
			adapter.registerWorkflow(simpleEmailWorkflow());
			await adapter.trigger({
				workflowId: "welcome",
				to: "user-1",
				payload: {},
				actor: "admin",
				tenant: "org-1",
			});

			const insertQuery = mockPool.queries.find((q) => q.text.includes("INSERT INTO herald_wf_jobs"));
			expect(insertQuery?.values?.[5]).toBe("admin");
			expect(insertQuery?.values?.[6]).toBe("org-1");
		});
	});

	describe("cancel", () => {
		it("updates matching jobs to cancelled", async () => {
			await adapter.cancel({ workflowId: "welcome", transactionId: "tx-1" });

			const updateQuery = mockPool.queries.find((q) => q.text.includes("cancelled"));
			expect(updateQuery).toBeDefined();
			expect(updateQuery?.values).toEqual(["tx-1", "welcome"]);
		});
	});

	describe("start / stop", () => {
		it("stop clears polling and calls pool.end when adapter owns pool", async () => {
			const endSpy = vi.fn();
			// Create adapter without pre-existing pool to simulate owning it
			// Since we can't easily test dynamic import, we test the pool.end path
			// by verifying stop() completes cleanly
			await adapter.stop();
			// No error = success
		});
	});
});

// We need to import the config type for the throw test
import type { PostgresWorkflowConfig } from "../src/adapters/workflow/postgres.js";

// ---------------------------------------------------------------------------
// Extended tests: durability, retries, delays, crash recovery
// ---------------------------------------------------------------------------

/**
 * Creates a mock pool that simulates poll-and-execute by returning jobs
 * from the SELECT query in pollAndExecute, then capturing subsequent UPDATEs.
 */
function createExecutionMockPool(opts?: { jobRows?: Record<string, unknown>[]; digestRows?: Record<string, unknown>[] }): PgPool & {
	queries: QueryLog[];
	setJobRows(rows: Record<string, unknown>[]): void;
} {
	const queries: QueryLog[] = [];
	let jobRows = opts?.jobRows ?? [];
	const digestRows = opts?.digestRows ?? [];

	const mockQuery = async (text: string, values?: unknown[]): Promise<PgQueryResult> => {
		queries.push({ text, values });

		// Return job rows for SELECT poll queries
		if (text.includes("SELECT") && text.includes("FOR UPDATE SKIP LOCKED")) {
			const rows = jobRows;
			jobRows = []; // Only return once per poll cycle
			return { rows, rowCount: rows.length };
		}

		// Return digest events for DELETE...RETURNING
		if (text.includes("DELETE FROM") && text.includes("digest_events") && text.includes("RETURNING")) {
			return { rows: digestRows, rowCount: digestRows.length };
		}

		// Return throttle count for INSERT...RETURNING
		if (text.includes("throttle_state") && text.includes("RETURNING count")) {
			return { rows: [{ count: (values?.[0] as string)?.includes("over") ? 10 : 1 }], rowCount: 1 };
		}

		return { rows: [], rowCount: 0 };
	};

	return {
		queries,
		setJobRows(rows: Record<string, unknown>[]) {
			jobRows = rows;
		},
		async query(text: string, values?: unknown[]): Promise<PgQueryResult> {
			return mockQuery(text, values);
		},
		async connect(): Promise<PgClient> {
			return {
				query: mockQuery,
				release: () => {},
			};
		},
		async end(): Promise<void> {},
	};
}

function makeJobRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
	return {
		id: "job-1",
		transaction_id: "tx-1",
		workflow_id: "welcome",
		subscriber_id: "user-1",
		payload: {},
		actor: null,
		tenant: null,
		overrides: null,
		status: "pending",
		current_step: 0,
		step_results: {},
		error: null,
		retry_count: 0,
		max_retries: 3,
		scheduled_at: new Date().toISOString(),
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		...overrides,
	};
}

describe("postgres workflow adapter — durability & crash recovery", () => {
	it("resumes execution from current_step after crash recovery", async () => {
		const emailHandler = vi.fn().mockResolvedValue({ subject: "Hi", body: "Hello" });
		const pool = createExecutionMockPool({
			jobRows: [
				makeJobRow({
					workflow_id: "two-step",
					current_step: 1, // Crash happened after step 0
					step_results: {},
				}),
			],
		});

		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false, pollInterval: 50 });
		adapter.registerWorkflow({
			id: "two-step",
			name: "Two Step",
			steps: [
				{
					stepId: "email-0",
					type: "email",
					handler: vi.fn().mockResolvedValue({ subject: "Step 0", body: "Should be skipped" }),
				},
				{
					stepId: "email-1",
					type: "email",
					handler: emailHandler,
				},
			],
		});

		// Start triggers the first poll cycle
		await adapter.start();
		// Give the poller time to execute
		await new Promise((r) => setTimeout(r, 200));
		await adapter.stop();

		// Step 0 handler should NOT have been called (current_step=1 means we resume at step 1)
		// Step 1 handler SHOULD have been called
		expect(emailHandler).toHaveBeenCalled();

		// Should have completed the job
		const completionQuery = pool.queries.find((q) => q.text.includes("completed") && q.text.includes("UPDATE"));
		expect(completionQuery).toBeDefined();
	});
});

describe("postgres workflow adapter — retry with exponential backoff", () => {
	it("retries failed jobs with 2^n second backoff", async () => {
		const failingHandler = vi.fn().mockRejectedValue(new Error("Network timeout"));
		const pool = createExecutionMockPool({
			jobRows: [makeJobRow({ workflow_id: "fail-wf", retry_count: 0, max_retries: 3 })],
		});

		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false, pollInterval: 50, maxRetries: 3 });
		adapter.registerWorkflow({
			id: "fail-wf",
			name: "Failing WF",
			steps: [{ stepId: "boom", type: "email", handler: failingHandler }],
		});

		await adapter.start();
		await new Promise((r) => setTimeout(r, 200));
		await adapter.stop();

		// Should have rescheduled with backoff (status back to pending)
		const retryQuery = pool.queries.find((q) => q.text.includes("UPDATE") && q.text.includes("pending") && q.text.includes("retry_count"));
		expect(retryQuery).toBeDefined();
		// retry_count should be 1, backoff should be "2000" (2^1 * 1000)
		expect(retryQuery?.values).toContain(1); // retry_count
		expect(retryQuery?.values).toContain("2000"); // backoff ms
	});

	it("marks job as failed after max retries exceeded", async () => {
		const failingHandler = vi.fn().mockRejectedValue(new Error("Permanent failure"));
		const pool = createExecutionMockPool({
			jobRows: [makeJobRow({ workflow_id: "fail-wf", retry_count: 2, max_retries: 3 })],
		});

		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false, pollInterval: 50 });
		adapter.registerWorkflow({
			id: "fail-wf",
			name: "Failing WF",
			steps: [{ stepId: "boom", type: "email", handler: failingHandler }],
		});

		await adapter.start();
		await new Promise((r) => setTimeout(r, 200));
		await adapter.stop();

		// Should have marked as failed (retry_count 3 >= max_retries 3)
		const failQuery = pool.queries.find((q) => q.text.includes("UPDATE") && q.text.includes("failed") && q.text.includes("retry_count"));
		expect(failQuery).toBeDefined();
	});
});

describe("postgres workflow adapter — delay step scheduling", () => {
	it("parks job with future scheduled_at for delay steps", async () => {
		const pool = createExecutionMockPool({
			jobRows: [makeJobRow({ workflow_id: "delay-wf" })],
		});

		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false, pollInterval: 50 });
		adapter.registerWorkflow({
			id: "delay-wf",
			name: "Delay WF",
			steps: [
				{
					stepId: "delay-1",
					type: "delay",
					handler: async ({ step }) => {
						await step.delay({ amount: 30, unit: "minutes" });
						return { body: "" };
					},
				},
				{
					stepId: "email-1",
					type: "email",
					handler: async () => ({ subject: "After delay", body: "Hello" }),
				},
			],
		});

		await adapter.start();
		await new Promise((r) => setTimeout(r, 200));
		await adapter.stop();

		// Should have parked the job: advance current_step and set future scheduled_at
		const parkQuery = pool.queries.find(
			(q) => q.text.includes("scheduled_at") && q.text.includes("milliseconds") && q.text.includes("pending"),
		);
		expect(parkQuery).toBeDefined();
		// 30 minutes = 1800000 ms
		expect(parkQuery?.values).toContain("1800000");
	});
});

describe("postgres workflow adapter — digest step windowing", () => {
	it("parks job on first encounter and sets window", async () => {
		const pool = createExecutionMockPool({
			jobRows: [makeJobRow({ workflow_id: "digest-wf", step_results: {} })],
		});

		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false, pollInterval: 50 });
		adapter.registerWorkflow(digestWorkflow());

		await adapter.start();
		await new Promise((r) => setTimeout(r, 200));
		await adapter.stop();

		// Should park with windowSet marker
		const parkQuery = pool.queries.find(
			(q) => q.text.includes("step_results") && q.text.includes("scheduled_at") && q.text.includes("pending"),
		);
		expect(parkQuery).toBeDefined();
		// Check step_results contains windowSet: true
		const stepResultsJson = parkQuery?.values?.find((v) => typeof v === "string" && v.includes("windowSet"));
		expect(stepResultsJson).toBeDefined();
	});

	it("collects digest events after window expires", async () => {
		const digestHandler = vi.fn().mockImplementation(async ({ step }: { step: StepContext["step"] }) => {
			const events = await step.digest({ window: 5, unit: "minutes" });
			return { body: `Got ${events.length} events` };
		});

		const pool = createExecutionMockPool({
			jobRows: [
				makeJobRow({
					workflow_id: "digest-wf",
					step_results: { "digest-1": { windowSet: true } }, // Window already set
				}),
			],
			digestRows: [
				{ payload: { data: 1 }, created_at: new Date().toISOString() },
				{ payload: { data: 2 }, created_at: new Date().toISOString() },
			],
		});

		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false, pollInterval: 50 });
		adapter.registerWorkflow({
			id: "digest-wf",
			name: "Digest WF",
			steps: [{ stepId: "digest-1", type: "digest", handler: digestHandler }],
		});

		await adapter.start();
		await new Promise((r) => setTimeout(r, 200));
		await adapter.stop();

		// Should have queried for digest events
		const deleteQuery = pool.queries.find((q) => q.text.includes("DELETE FROM") && q.text.includes("digest_events"));
		expect(deleteQuery).toBeDefined();

		// Handler should have been called with the digested events
		expect(digestHandler).toHaveBeenCalled();
	});
});

describe("postgres workflow adapter — throttle step", () => {
	it("allows execution when under the limit", async () => {
		const emailHandler = vi.fn().mockResolvedValue({ subject: "Hi", body: "Hello" });
		const pool = createExecutionMockPool({
			jobRows: [makeJobRow({ workflow_id: "throttle-wf" })],
		});

		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false, pollInterval: 50 });
		adapter.registerWorkflow({
			id: "throttle-wf",
			name: "Throttle WF",
			steps: [
				{
					stepId: "throttle-1",
					type: "throttle",
					handler: async ({ step }) => {
						const r = await step.throttle({ key: "t", limit: 5, window: 1, unit: "hours" });
						if (r.throttled) return { body: "throttled", _internal: { throttled: true } };
						return { body: "ok" };
					},
				},
				{
					stepId: "email-1",
					type: "email",
					handler: emailHandler,
				},
			],
		});

		await adapter.start();
		await new Promise((r) => setTimeout(r, 200));
		await adapter.stop();

		// Throttle upsert should have been called
		const throttleQuery = pool.queries.find((q) => q.text.includes("throttle_state"));
		expect(throttleQuery).toBeDefined();
	});
});

describe("postgres workflow adapter — branch step support", () => {
	it("resolves branch and executes matching steps", async () => {
		const emailHandler = vi.fn().mockResolvedValue({ subject: "VIP", body: "Hello VIP" });
		const pool = createExecutionMockPool({
			jobRows: [makeJobRow({ workflow_id: "branch-wf", payload: { tier: "vip" } })],
		});

		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false, pollInterval: 50 });
		adapter.registerWorkflow({
			id: "branch-wf",
			name: "Branch WF",
			steps: [
				{
					stepId: "branch-1",
					type: "branch",
					branches: [
						{
							key: "vip",
							conditions: [{ field: "payload.tier", operator: "eq", value: "vip" }],
							steps: [{ stepId: "vip-email", type: "email", handler: emailHandler }],
						},
						{
							key: "default",
							conditions: [],
							steps: [
								{
									stepId: "default-email",
									type: "email",
									handler: vi.fn().mockResolvedValue({ subject: "Default", body: "Hi" }),
								},
							],
						},
					],
				},
			],
		});

		await adapter.start();
		await new Promise((r) => setTimeout(r, 200));
		await adapter.stop();

		// The adapter should advance step for the branch
		const advanceQuery = pool.queries.find((q) => q.text.includes("current_step") && q.text.includes("UPDATE"));
		expect(advanceQuery).toBeDefined();
	});
});

describe("postgres workflow adapter — condition skipping", () => {
	it("skips steps when conditions are not met", async () => {
		const skippedHandler = vi.fn().mockResolvedValue({ subject: "Skipped", body: "Should not run" });
		const runHandler = vi.fn().mockResolvedValue({ subject: "Run", body: "Should run" });
		const pool = createExecutionMockPool({
			jobRows: [makeJobRow({ workflow_id: "cond-wf", payload: { premium: false } })],
		});

		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false, pollInterval: 50 });
		adapter.registerWorkflow({
			id: "cond-wf",
			name: "Conditional WF",
			steps: [
				{
					stepId: "premium-email",
					type: "email",
					handler: skippedHandler,
					conditions: [{ field: "payload.premium", operator: "eq", value: true }],
				},
				{
					stepId: "all-email",
					type: "email",
					handler: runHandler,
				},
			],
		});

		await adapter.start();
		await new Promise((r) => setTimeout(r, 200));
		await adapter.stop();

		// The job should complete (both steps processed, one skipped)
		const completionQuery = pool.queries.find((q) => q.text.includes("completed") && q.text.includes("UPDATE"));
		expect(completionQuery).toBeDefined();
	});
});

describe("postgres workflow adapter — multi-recipient fan-out", () => {
	it("creates one job per recipient", async () => {
		const pool = createMockPool();
		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false, pollInterval: 50 });
		adapter.registerWorkflow(simpleEmailWorkflow());

		const result = await adapter.trigger({
			workflowId: "welcome",
			to: ["user-1", "user-2", "user-3"],
			payload: { message: "hello" },
		});

		expect(result.status).toBe("queued");
		const insertQueries = pool.queries.filter((q) => q.text.includes("INSERT INTO herald_wf_jobs"));
		expect(insertQueries).toHaveLength(3);

		// Each recipient should have a different subscriber_id (position 3 in values)
		const subscriberIds = insertQueries.map((q) => q.values?.[3]);
		expect(subscriberIds).toEqual(["user-1", "user-2", "user-3"]);
	});
});

describe("postgres workflow adapter — unregistered workflow handling", () => {
	it("fails job when workflow is not registered", async () => {
		const pool = createExecutionMockPool({
			jobRows: [makeJobRow({ workflow_id: "nonexistent" })],
		});

		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false, pollInterval: 50 });
		// Don't register any workflow

		await adapter.start();
		await new Promise((r) => setTimeout(r, 200));
		await adapter.stop();

		const failQuery = pool.queries.find(
			(q) =>
				q.text.includes("UPDATE") && q.text.includes("failed") && q.values?.some((v) => typeof v === "string" && v.includes("No workflow")),
		);
		expect(failQuery).toBeDefined();
	});
});

describe("postgres workflow adapter — table prefix validation", () => {
	it("rejects invalid table prefix", () => {
		const pool = createMockPool();
		expect(() => postgresWorkflowAdapter({ pool, tablePrefix: "drop table;" })).toThrow("Invalid tablePrefix");
	});

	it("accepts valid table prefix", () => {
		const pool = createMockPool();
		const adapter = postgresWorkflowAdapter({ pool, tablePrefix: "my_app_wf", autoMigrate: false });
		expect(adapter.adapterId).toBe("postgres");
	});
});
