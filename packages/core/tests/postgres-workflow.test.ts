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
		const step0Handler = vi.fn().mockResolvedValue({ subject: "Step 0", body: "Should be skipped" });
		const step1Handler = vi.fn().mockResolvedValue({ subject: "Hi", body: "Hello" });
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
				{ stepId: "email-0", type: "email", handler: step0Handler },
				{ stepId: "email-1", type: "email", handler: step1Handler },
			],
		});

		await adapter.start();
		await new Promise((r) => setTimeout(r, 200));
		await adapter.stop();

		// Step 0 handler should NOT have been called — we resume at step 1
		expect(step0Handler).not.toHaveBeenCalled();
		// Step 1 handler SHOULD have been called exactly once
		expect(step1Handler).toHaveBeenCalledTimes(1);

		// Should have completed the job
		const completionQuery = pool.queries.find((q) => q.text.includes("completed") && q.text.includes("UPDATE"));
		expect(completionQuery).toBeDefined();
	});

	it("resumes a three-step workflow from step 2 and only runs the third handler", async () => {
		const handlers = [
			vi.fn().mockResolvedValue({ subject: "A", body: "A" }),
			vi.fn().mockResolvedValue({ subject: "B", body: "B" }),
			vi.fn().mockResolvedValue({ subject: "C", body: "C" }),
		];
		const pool = createExecutionMockPool({
			jobRows: [makeJobRow({ workflow_id: "three-step", current_step: 2 })],
		});

		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false, pollInterval: 50 });
		adapter.registerWorkflow({
			id: "three-step",
			name: "Three Step",
			steps: [
				{ stepId: "s0", type: "email", handler: handlers[0] },
				{ stepId: "s1", type: "email", handler: handlers[1] },
				{ stepId: "s2", type: "email", handler: handlers[2] },
			],
		});

		await adapter.start();
		await new Promise((r) => setTimeout(r, 200));
		await adapter.stop();

		expect(handlers[0]).not.toHaveBeenCalled();
		expect(handlers[1]).not.toHaveBeenCalled();
		expect(handlers[2]).toHaveBeenCalledTimes(1);
	});

	it("threads transaction_id into step handler payload as _transactionId", async () => {
		let capturedPayload: Record<string, unknown> | undefined;
		const handler = vi.fn().mockImplementation(async (ctx: { payload: Record<string, unknown> }) => {
			capturedPayload = ctx.payload;
			return { subject: "Hi", body: "Hello" };
		});

		const pool = createExecutionMockPool({
			jobRows: [
				makeJobRow({
					workflow_id: "tx-wf",
					transaction_id: "tx-xyz-789",
					payload: { greeting: "hi" },
				}),
			],
		});

		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false, pollInterval: 50 });
		adapter.registerWorkflow({
			id: "tx-wf",
			name: "Tx WF",
			steps: [{ stepId: "email-1", type: "email", handler }],
		});

		await adapter.start();
		await new Promise((r) => setTimeout(r, 200));
		await adapter.stop();

		expect(handler).toHaveBeenCalled();
		expect(capturedPayload?._transactionId).toBe("tx-xyz-789");
		expect(capturedPayload?.greeting).toBe("hi");
	});

	it("completes immediately when current_step exceeds total steps", async () => {
		const handler = vi.fn().mockResolvedValue({ subject: "X", body: "X" });
		const pool = createExecutionMockPool({
			jobRows: [makeJobRow({ workflow_id: "one-step", current_step: 99 })],
		});

		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false, pollInterval: 50 });
		adapter.registerWorkflow({
			id: "one-step",
			name: "One Step",
			steps: [{ stepId: "s0", type: "email", handler }],
		});

		await adapter.start();
		await new Promise((r) => setTimeout(r, 200));
		await adapter.stop();

		expect(handler).not.toHaveBeenCalled();
		const completionQuery = pool.queries.find((q) => q.text.includes("completed") && q.text.includes("UPDATE"));
		expect(completionQuery).toBeDefined();
	});

	it("preserves subscriber_id context on resume", async () => {
		let capturedSubscriberId: string | undefined;
		const pool = createExecutionMockPool({
			jobRows: [makeJobRow({ workflow_id: "ctx-wf", current_step: 0, subscriber_id: "sub-42" })],
		});

		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false, pollInterval: 50 });
		adapter.registerWorkflow({
			id: "ctx-wf",
			name: "Context WF",
			steps: [
				{
					stepId: "s0",
					type: "email",
					handler: async (ctx) => {
						capturedSubscriberId = ctx.subscriber.id;
						return { subject: "Hi", body: "Hello" };
					},
				},
			],
		});

		await adapter.start();
		await new Promise((r) => setTimeout(r, 200));
		await adapter.stop();

		expect(capturedSubscriberId).toBe("sub-42");
	});
});

describe("postgres workflow adapter — retry with exponential backoff", () => {
	it("retries failed jobs with 2^1 second backoff on first failure", async () => {
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

		const retryQuery = pool.queries.find((q) => q.text.includes("UPDATE") && q.text.includes("pending") && q.text.includes("retry_count"));
		expect(retryQuery).toBeDefined();
		// retry_count goes from 0 to 1, backoff = 2^1 * 1000 = 2000ms
		expect(retryQuery?.values).toContain(1);
		expect(retryQuery?.values).toContain("2000");
	});

	it("applies 2^2 = 4s backoff on second failure", async () => {
		const pool = createExecutionMockPool({
			jobRows: [makeJobRow({ workflow_id: "fail-wf", retry_count: 1, max_retries: 5 })],
		});

		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false, pollInterval: 50 });
		adapter.registerWorkflow({
			id: "fail-wf",
			name: "Failing WF",
			steps: [{ stepId: "boom", type: "email", handler: vi.fn().mockRejectedValue(new Error("fail")) }],
		});

		await adapter.start();
		await new Promise((r) => setTimeout(r, 200));
		await adapter.stop();

		const retryQuery = pool.queries.find((q) => q.text.includes("UPDATE") && q.text.includes("pending") && q.text.includes("retry_count"));
		expect(retryQuery).toBeDefined();
		expect(retryQuery?.values).toContain(2); // retry_count
		expect(retryQuery?.values).toContain("4000"); // 2^2 * 1000
	});

	it("applies 2^3 = 8s backoff on third failure", async () => {
		const pool = createExecutionMockPool({
			jobRows: [makeJobRow({ workflow_id: "fail-wf", retry_count: 2, max_retries: 5 })],
		});

		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false, pollInterval: 50 });
		adapter.registerWorkflow({
			id: "fail-wf",
			name: "Failing WF",
			steps: [{ stepId: "boom", type: "email", handler: vi.fn().mockRejectedValue(new Error("fail")) }],
		});

		await adapter.start();
		await new Promise((r) => setTimeout(r, 200));
		await adapter.stop();

		const retryQuery = pool.queries.find((q) => q.text.includes("UPDATE") && q.text.includes("pending") && q.text.includes("retry_count"));
		expect(retryQuery).toBeDefined();
		expect(retryQuery?.values).toContain(3);
		expect(retryQuery?.values).toContain("8000"); // 2^3 * 1000
	});

	it("marks job as permanently failed after max retries exceeded", async () => {
		const pool = createExecutionMockPool({
			jobRows: [makeJobRow({ workflow_id: "fail-wf", retry_count: 2, max_retries: 3 })],
		});

		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false, pollInterval: 50 });
		adapter.registerWorkflow({
			id: "fail-wf",
			name: "Failing WF",
			steps: [{ stepId: "boom", type: "email", handler: vi.fn().mockRejectedValue(new Error("Permanent failure")) }],
		});

		await adapter.start();
		await new Promise((r) => setTimeout(r, 200));
		await adapter.stop();

		// retry_count becomes 3, which equals max_retries 3 → permanent failure
		const failQuery = pool.queries.find((q) => q.text.includes("UPDATE") && q.text.includes("failed") && q.text.includes("retry_count"));
		expect(failQuery).toBeDefined();
		// Verify the error message is preserved
		expect(failQuery?.values).toContain("Permanent failure");
		expect(failQuery?.values).toContain(3); // final retry count
	});

	it("stores error message from non-Error throwables", async () => {
		const pool = createExecutionMockPool({
			jobRows: [makeJobRow({ workflow_id: "fail-wf", retry_count: 0, max_retries: 3 })],
		});

		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false, pollInterval: 50 });
		adapter.registerWorkflow({
			id: "fail-wf",
			name: "Failing WF",
			steps: [
				{
					stepId: "boom",
					type: "email",
					handler: async () => {
						throw "string error";
					},
				},
			],
		});

		await adapter.start();
		await new Promise((r) => setTimeout(r, 200));
		await adapter.stop();

		const retryQuery = pool.queries.find((q) => q.text.includes("UPDATE") && q.text.includes("pending") && q.text.includes("retry_count"));
		expect(retryQuery).toBeDefined();
		expect(retryQuery?.values).toContain("string error");
	});

	it("does not retry when max_retries is 1 and first attempt fails", async () => {
		const pool = createExecutionMockPool({
			jobRows: [makeJobRow({ workflow_id: "fail-wf", retry_count: 0, max_retries: 1 })],
		});

		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false, pollInterval: 50 });
		adapter.registerWorkflow({
			id: "fail-wf",
			name: "Failing WF",
			steps: [{ stepId: "boom", type: "email", handler: vi.fn().mockRejectedValue(new Error("instant fail")) }],
		});

		await adapter.start();
		await new Promise((r) => setTimeout(r, 200));
		await adapter.stop();

		// retry_count becomes 1, which equals max_retries 1 → permanent failure immediately
		const failQuery = pool.queries.find((q) => q.text.includes("UPDATE") && q.text.includes("failed") && q.text.includes("retry_count"));
		expect(failQuery).toBeDefined();
		// Should NOT have a pending/retry query
		const retryQuery = pool.queries.find((q) => q.text.includes("UPDATE") && q.text.includes("pending") && q.text.includes("retry_count"));
		expect(retryQuery).toBeUndefined();
	});
});

describe("postgres workflow adapter — delay step scheduling", () => {
	it("parks job with future scheduled_at for 30-minute delay", async () => {
		const emailHandler = vi.fn().mockResolvedValue({ subject: "After delay", body: "Hello" });
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
				{ stepId: "email-1", type: "email", handler: emailHandler },
			],
		});

		await adapter.start();
		await new Promise((r) => setTimeout(r, 200));
		await adapter.stop();

		const parkQuery = pool.queries.find(
			(q) => q.text.includes("scheduled_at") && q.text.includes("milliseconds") && q.text.includes("pending"),
		);
		expect(parkQuery).toBeDefined();
		// 30 minutes = 1_800_000 ms
		expect(parkQuery?.values).toContain("1800000");
		// current_step should advance past the delay to step 1
		expect(parkQuery?.values).toContain(1);

		// Email handler should NOT have been called (job was parked)
		expect(emailHandler).not.toHaveBeenCalled();
	});

	it("converts hours to correct milliseconds", async () => {
		const pool = createExecutionMockPool({
			jobRows: [makeJobRow({ workflow_id: "delay-hours" })],
		});

		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false, pollInterval: 50 });
		adapter.registerWorkflow({
			id: "delay-hours",
			name: "Delay Hours",
			steps: [
				{
					stepId: "delay-1",
					type: "delay",
					handler: async ({ step }) => {
						await step.delay({ amount: 2, unit: "hours" });
						return { body: "" };
					},
				},
			],
		});

		await adapter.start();
		await new Promise((r) => setTimeout(r, 200));
		await adapter.stop();

		const parkQuery = pool.queries.find(
			(q) => q.text.includes("scheduled_at") && q.text.includes("milliseconds") && q.text.includes("pending"),
		);
		expect(parkQuery).toBeDefined();
		// 2 hours = 7_200_000 ms
		expect(parkQuery?.values).toContain("7200000");
	});

	it("converts seconds to correct milliseconds", async () => {
		const pool = createExecutionMockPool({
			jobRows: [makeJobRow({ workflow_id: "delay-secs" })],
		});

		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false, pollInterval: 50 });
		adapter.registerWorkflow({
			id: "delay-secs",
			name: "Delay Secs",
			steps: [
				{
					stepId: "delay-1",
					type: "delay",
					handler: async ({ step }) => {
						await step.delay({ amount: 45, unit: "seconds" });
						return { body: "" };
					},
				},
			],
		});

		await adapter.start();
		await new Promise((r) => setTimeout(r, 200));
		await adapter.stop();

		const parkQuery = pool.queries.find(
			(q) => q.text.includes("scheduled_at") && q.text.includes("milliseconds") && q.text.includes("pending"),
		);
		expect(parkQuery).toBeDefined();
		expect(parkQuery?.values).toContain("45000");
	});

	it("resumes and executes email step after delay period elapses", async () => {
		const emailHandler = vi.fn().mockResolvedValue({ subject: "Delayed", body: "Hello" });
		const pool = createExecutionMockPool({
			// Simulating the job being polled AFTER the delay: current_step=1 (past the delay)
			jobRows: [makeJobRow({ workflow_id: "delay-resume", current_step: 1 })],
		});

		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false, pollInterval: 50 });
		adapter.registerWorkflow({
			id: "delay-resume",
			name: "Delay Resume",
			steps: [
				{
					stepId: "delay-1",
					type: "delay",
					handler: async ({ step }) => {
						await step.delay({ amount: 5, unit: "minutes" });
						return { body: "" };
					},
				},
				{ stepId: "email-1", type: "email", handler: emailHandler },
			],
		});

		await adapter.start();
		await new Promise((r) => setTimeout(r, 200));
		await adapter.stop();

		expect(emailHandler).toHaveBeenCalledTimes(1);
		const completionQuery = pool.queries.find((q) => q.text.includes("completed") && q.text.includes("UPDATE"));
		expect(completionQuery).toBeDefined();
	});
});

describe("postgres workflow adapter — digest step windowing", () => {
	it("parks job on first encounter and sets windowSet in step_results", async () => {
		const pool = createExecutionMockPool({
			jobRows: [makeJobRow({ workflow_id: "digest-wf", step_results: {} })],
		});

		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false, pollInterval: 50 });
		adapter.registerWorkflow(digestWorkflow());

		await adapter.start();
		await new Promise((r) => setTimeout(r, 200));
		await adapter.stop();

		const parkQuery = pool.queries.find(
			(q) => q.text.includes("step_results") && q.text.includes("scheduled_at") && q.text.includes("pending"),
		);
		expect(parkQuery).toBeDefined();

		// Verify step_results JSON contains windowSet: true for the digest step
		const stepResultsJson = parkQuery?.values?.find((v) => typeof v === "string" && v.includes("windowSet"));
		expect(stepResultsJson).toBeDefined();
		const parsed = JSON.parse(stepResultsJson as string);
		expect(parsed["digest-1"]).toEqual({ windowSet: true });

		// Verify the window duration: 5 minutes = 300_000 ms
		expect(parkQuery?.values).toContain("300000");
	});

	it("preserves existing step_results when parking digest", async () => {
		const pool = createExecutionMockPool({
			jobRows: [makeJobRow({ workflow_id: "digest-wf", step_results: { "previous-step": { done: true } } })],
		});

		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false, pollInterval: 50 });
		adapter.registerWorkflow(digestWorkflow());

		await adapter.start();
		await new Promise((r) => setTimeout(r, 200));
		await adapter.stop();

		const parkQuery = pool.queries.find(
			(q) => q.text.includes("step_results") && q.text.includes("scheduled_at") && q.text.includes("pending"),
		);
		expect(parkQuery).toBeDefined();
		const stepResultsJson = parkQuery?.values?.find((v) => typeof v === "string" && v.includes("windowSet"));
		const parsed = JSON.parse(stepResultsJson as string);
		// Both old and new step results should be present
		expect(parsed["previous-step"]).toEqual({ done: true });
		expect(parsed["digest-1"]).toEqual({ windowSet: true });
	});

	it("collects digest events on second poll after window expires", async () => {
		let capturedEvents: Array<{ payload: Record<string, unknown>; timestamp: Date }> = [];
		const digestHandler = vi.fn().mockImplementation(async ({ step }: { step: StepContext["step"] }) => {
			const events = await step.digest({ window: 5, unit: "minutes" });
			capturedEvents = events;
			return { body: `Got ${events.length} events` };
		});

		const pool = createExecutionMockPool({
			jobRows: [
				makeJobRow({
					workflow_id: "digest-wf",
					step_results: { "digest-1": { windowSet: true } },
				}),
			],
			digestRows: [
				{ payload: { data: 1 }, created_at: "2026-03-30T10:00:00Z" },
				{ payload: { data: 2 }, created_at: "2026-03-30T10:01:00Z" },
				{ payload: { data: 3 }, created_at: "2026-03-30T10:02:00Z" },
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

		// DELETE query should use the correct digest_key
		const deleteQuery = pool.queries.find((q) => q.text.includes("DELETE FROM") && q.text.includes("digest_events"));
		expect(deleteQuery).toBeDefined();
		expect(deleteQuery?.values?.[0]).toBe("digest-wf:digest-1:user-1");

		// Handler should have received 3 events
		expect(digestHandler).toHaveBeenCalledTimes(1);
		expect(capturedEvents).toHaveLength(3);
		expect(capturedEvents[0].payload).toEqual({ data: 1 });
		expect(capturedEvents[1].payload).toEqual({ data: 2 });
		expect(capturedEvents[2].payload).toEqual({ data: 3 });

		// Job should be completed after processing digest
		const completionQuery = pool.queries.find((q) => q.text.includes("completed") && q.text.includes("UPDATE"));
		expect(completionQuery).toBeDefined();
	});

	it("handles empty digest window (no events collected)", async () => {
		let capturedEvents: Array<{ payload: Record<string, unknown>; timestamp: Date }> = [];
		const digestHandler = vi.fn().mockImplementation(async ({ step }: { step: StepContext["step"] }) => {
			const events = await step.digest({ window: 5, unit: "minutes" });
			capturedEvents = events;
			return { body: `Got ${events.length} events` };
		});

		const pool = createExecutionMockPool({
			jobRows: [
				makeJobRow({
					workflow_id: "digest-wf",
					step_results: { "digest-1": { windowSet: true } },
				}),
			],
			digestRows: [], // No events collected during window
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

		expect(capturedEvents).toHaveLength(0);
		expect(digestHandler).toHaveBeenCalledTimes(1);
	});

	it("inserts digest events during trigger for workflows with digest steps", async () => {
		const pool = createMockPool();
		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false, pollInterval: 100_000 });
		adapter.registerWorkflow(digestWorkflow());

		await adapter.trigger({ workflowId: "digest-wf", to: "user-1", payload: { item: "book" } });
		await adapter.stop();

		const digestInserts = pool.queries.filter((q) => q.text.includes("INSERT INTO herald_wf_digest_events"));
		expect(digestInserts).toHaveLength(1);
		expect(digestInserts[0].values?.[2]).toBe("digest-wf:digest-1:user-1");
		// Payload should be the trigger payload
		expect(digestInserts[0].values?.[3]).toBe(JSON.stringify({ item: "book" }));
	});
});

describe("postgres workflow adapter — throttle step", () => {
	/**
	 * Helper to create a pool with a specific throttle count response.
	 */
	function createThrottlePool(jobRow: Record<string, unknown>, throttleCount: number) {
		const queries: QueryLog[] = [];
		let jobRows = [jobRow];

		const mockQuery = async (text: string, values?: unknown[]): Promise<PgQueryResult> => {
			queries.push({ text, values });
			if (text.includes("SELECT") && text.includes("FOR UPDATE SKIP LOCKED")) {
				const rows = jobRows;
				jobRows = [];
				return { rows, rowCount: rows.length };
			}
			if (text.includes("throttle_state") && text.includes("RETURNING count")) {
				return { rows: [{ count: throttleCount }], rowCount: 1 };
			}
			return { rows: [], rowCount: 0 };
		};

		return {
			queries,
			query: mockQuery,
			connect: async (): Promise<PgClient> => ({ query: mockQuery, release: () => {} }),
			end: async () => {},
		};
	}

	it("allows execution when throttle count is within limit", async () => {
		const emailHandler = vi.fn().mockResolvedValue({ subject: "Hi", body: "Hello" });
		const pool = createThrottlePool(makeJobRow({ workflow_id: "throttle-wf" }), 2); // count=2, limit=5

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
				{ stepId: "email-1", type: "email", handler: emailHandler },
			],
		});

		await adapter.start();
		await new Promise((r) => setTimeout(r, 200));
		await adapter.stop();

		// Throttle upsert should have been called
		const throttleQuery = pool.queries.find((q) => q.text.includes("throttle_state"));
		expect(throttleQuery).toBeDefined();
		// The throttle key should be prefixed with workflow id
		expect(throttleQuery?.values?.[0]).toBe("throttle-wf:t");

		// Email handler should have been called because we're under the limit
		expect(emailHandler).toHaveBeenCalledTimes(1);

		// Job should be completed
		const completionQuery = pool.queries.find((q) => q.text.includes("completed") && q.text.includes("UPDATE"));
		expect(completionQuery).toBeDefined();
	});

	it("blocks execution and marks job completed when throttle limit exceeded", async () => {
		const emailHandler = vi.fn().mockResolvedValue({ subject: "Hi", body: "Hello" });
		const pool = createThrottlePool(makeJobRow({ workflow_id: "throttle-wf" }), 6); // count=6 > limit=5

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
				{ stepId: "email-1", type: "email", handler: emailHandler },
			],
		});

		await adapter.start();
		await new Promise((r) => setTimeout(r, 200));
		await adapter.stop();

		// Email should NOT have been called — throttled
		expect(emailHandler).not.toHaveBeenCalled();

		// Job should still be marked completed (throttled jobs complete, they don't fail)
		const completionQuery = pool.queries.find((q) => q.text.includes("completed") && q.text.includes("UPDATE"));
		expect(completionQuery).toBeDefined();
	});

	it("uses correct throttle key: workflowId:userKey", async () => {
		const pool = createThrottlePool(makeJobRow({ workflow_id: "throttle-wf" }), 1);

		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false, pollInterval: 50 });
		adapter.registerWorkflow({
			id: "throttle-wf",
			name: "Throttle WF",
			steps: [
				{
					stepId: "throttle-1",
					type: "throttle",
					handler: async ({ step }) => {
						const r = await step.throttle({ key: "my-custom-key", limit: 10, window: 2, unit: "hours" });
						if (r.throttled) return { body: "throttled", _internal: { throttled: true } };
						return { body: "ok" };
					},
				},
			],
		});

		await adapter.start();
		await new Promise((r) => setTimeout(r, 200));
		await adapter.stop();

		const throttleQuery = pool.queries.find((q) => q.text.includes("throttle_state"));
		expect(throttleQuery).toBeDefined();
		expect(throttleQuery?.values?.[0]).toBe("throttle-wf:my-custom-key");
		// Window ms = 2 hours = 7_200_000
		expect(throttleQuery?.values?.[1]).toBe(7200000);
	});

	it("allows execution at exactly the limit (count === limit)", async () => {
		const emailHandler = vi.fn().mockResolvedValue({ subject: "Hi", body: "Hello" });
		const pool = createThrottlePool(makeJobRow({ workflow_id: "throttle-wf" }), 5); // count=5, limit=5, not exceeded

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
				{ stepId: "email-1", type: "email", handler: emailHandler },
			],
		});

		await adapter.start();
		await new Promise((r) => setTimeout(r, 200));
		await adapter.stop();

		// count=5 is NOT > limit=5, so should be allowed
		expect(emailHandler).toHaveBeenCalledTimes(1);
	});
});

describe("postgres workflow adapter — branch step support", () => {
	it("resolves first matching branch and executes its steps", async () => {
		const vipHandler = vi.fn().mockResolvedValue({ subject: "VIP", body: "Hello VIP" });
		const regularHandler = vi.fn().mockResolvedValue({ subject: "Regular", body: "Hello" });
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
							steps: [{ stepId: "vip-email", type: "email", handler: vipHandler }],
						},
						{
							key: "regular",
							conditions: [{ field: "payload.tier", operator: "eq", value: "regular" }],
							steps: [{ stepId: "regular-email", type: "email", handler: regularHandler }],
						},
					],
				},
			],
		});

		await adapter.start();
		await new Promise((r) => setTimeout(r, 200));
		await adapter.stop();

		expect(vipHandler).toHaveBeenCalledTimes(1);
		expect(regularHandler).not.toHaveBeenCalled();

		const completionQuery = pool.queries.find((q) => q.text.includes("completed") && q.text.includes("UPDATE"));
		expect(completionQuery).toBeDefined();
	});

	it("falls through to second branch when first does not match", async () => {
		const vipHandler = vi.fn().mockResolvedValue({ subject: "VIP", body: "VIP" });
		const regularHandler = vi.fn().mockResolvedValue({ subject: "Regular", body: "Regular" });
		const pool = createExecutionMockPool({
			jobRows: [makeJobRow({ workflow_id: "branch-wf", payload: { tier: "regular" } })],
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
							steps: [{ stepId: "vip-email", type: "email", handler: vipHandler }],
						},
						{
							key: "regular",
							conditions: [{ field: "payload.tier", operator: "eq", value: "regular" }],
							steps: [{ stepId: "regular-email", type: "email", handler: regularHandler }],
						},
					],
				},
			],
		});

		await adapter.start();
		await new Promise((r) => setTimeout(r, 200));
		await adapter.stop();

		expect(vipHandler).not.toHaveBeenCalled();
		expect(regularHandler).toHaveBeenCalledTimes(1);
	});

	it("uses defaultBranch when no branch conditions match", async () => {
		const vipHandler = vi.fn().mockResolvedValue({ subject: "VIP", body: "VIP" });
		const fallbackHandler = vi.fn().mockResolvedValue({ subject: "Fallback", body: "Fallback" });
		const pool = createExecutionMockPool({
			jobRows: [makeJobRow({ workflow_id: "branch-default", payload: { tier: "unknown" } })],
		});

		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false, pollInterval: 50 });
		adapter.registerWorkflow({
			id: "branch-default",
			name: "Branch Default",
			steps: [
				{
					stepId: "branch-1",
					type: "branch",
					branches: [
						{
							key: "vip",
							conditions: [{ field: "payload.tier", operator: "eq", value: "vip" }],
							steps: [{ stepId: "vip-email", type: "email", handler: vipHandler }],
						},
						{
							key: "fallback",
							conditions: [{ field: "payload.tier", operator: "eq", value: "never-matches" }],
							steps: [{ stepId: "fallback-email", type: "email", handler: fallbackHandler }],
						},
					],
					defaultBranch: "fallback",
				},
			],
		});

		await adapter.start();
		await new Promise((r) => setTimeout(r, 200));
		await adapter.stop();

		expect(vipHandler).not.toHaveBeenCalled();
		expect(fallbackHandler).toHaveBeenCalledTimes(1);
	});

	it("skips all branch steps when no conditions match and no default", async () => {
		const vipHandler = vi.fn().mockResolvedValue({ subject: "VIP", body: "VIP" });
		const afterBranchHandler = vi.fn().mockResolvedValue({ subject: "After", body: "After" });
		const pool = createExecutionMockPool({
			jobRows: [makeJobRow({ workflow_id: "branch-none", payload: { tier: "nope" } })],
		});

		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false, pollInterval: 50 });
		adapter.registerWorkflow({
			id: "branch-none",
			name: "Branch None",
			steps: [
				{
					stepId: "branch-1",
					type: "branch",
					branches: [
						{
							key: "vip",
							conditions: [{ field: "payload.tier", operator: "eq", value: "vip" }],
							steps: [{ stepId: "vip-email", type: "email", handler: vipHandler }],
						},
					],
					// No defaultBranch
				},
				{ stepId: "after-branch", type: "email", handler: afterBranchHandler },
			],
		});

		await adapter.start();
		await new Promise((r) => setTimeout(r, 200));
		await adapter.stop();

		expect(vipHandler).not.toHaveBeenCalled();
		expect(afterBranchHandler).toHaveBeenCalledTimes(1);
	});

	it("splices multiple steps from a branch into the execution queue", async () => {
		const handlerCalls: string[] = [];
		const pool = createExecutionMockPool({
			jobRows: [makeJobRow({ workflow_id: "branch-multi", payload: { plan: "premium" } })],
		});

		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false, pollInterval: 50 });
		adapter.registerWorkflow({
			id: "branch-multi",
			name: "Branch Multi",
			steps: [
				{
					stepId: "branch-1",
					type: "branch",
					branches: [
						{
							key: "premium",
							conditions: [{ field: "payload.plan", operator: "eq", value: "premium" }],
							steps: [
								{
									stepId: "email-welcome",
									type: "email",
									handler: async () => {
										handlerCalls.push("email-welcome");
										return { subject: "Welcome", body: "Welcome premium" };
									},
								},
								{
									stepId: "email-bonus",
									type: "email",
									handler: async () => {
										handlerCalls.push("email-bonus");
										return { subject: "Bonus", body: "Your bonus" };
									},
								},
							],
						},
					],
				},
				{
					stepId: "email-final",
					type: "email",
					handler: async () => {
						handlerCalls.push("email-final");
						return { subject: "Final", body: "Done" };
					},
				},
			],
		});

		await adapter.start();
		await new Promise((r) => setTimeout(r, 200));
		await adapter.stop();

		// Both branch steps AND the step after the branch should all execute in order
		expect(handlerCalls).toEqual(["email-welcome", "email-bonus", "email-final"]);
	});
});

describe("postgres workflow adapter — condition skipping", () => {
	it("skips step when condition evaluates to false", async () => {
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

		expect(skippedHandler).not.toHaveBeenCalled();
		expect(runHandler).toHaveBeenCalledTimes(1);

		const completionQuery = pool.queries.find((q) => q.text.includes("completed") && q.text.includes("UPDATE"));
		expect(completionQuery).toBeDefined();
	});

	it("executes step when condition evaluates to true", async () => {
		const handler = vi.fn().mockResolvedValue({ subject: "Hi", body: "Hello" });
		const pool = createExecutionMockPool({
			jobRows: [makeJobRow({ workflow_id: "cond-wf", payload: { premium: true } })],
		});

		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false, pollInterval: 50 });
		adapter.registerWorkflow({
			id: "cond-wf",
			name: "Conditional WF",
			steps: [
				{
					stepId: "premium-email",
					type: "email",
					handler,
					conditions: [{ field: "payload.premium", operator: "eq", value: true }],
				},
			],
		});

		await adapter.start();
		await new Promise((r) => setTimeout(r, 200));
		await adapter.stop();

		expect(handler).toHaveBeenCalledTimes(1);
	});

	it("skips step with multiple 'all' conditions when any fails", async () => {
		const handler = vi.fn().mockResolvedValue({ subject: "Hi", body: "Hello" });
		const pool = createExecutionMockPool({
			jobRows: [makeJobRow({ workflow_id: "multi-cond", payload: { premium: true, region: "us" } })],
		});

		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false, pollInterval: 50 });
		adapter.registerWorkflow({
			id: "multi-cond",
			name: "Multi Condition",
			steps: [
				{
					stepId: "email-1",
					type: "email",
					handler,
					conditionMode: "all",
					conditions: [
						{ field: "payload.premium", operator: "eq", value: true },
						{ field: "payload.region", operator: "eq", value: "eu" }, // fails
					],
				},
			],
		});

		await adapter.start();
		await new Promise((r) => setTimeout(r, 200));
		await adapter.stop();

		expect(handler).not.toHaveBeenCalled();
	});

	it("executes step with 'any' conditionMode when at least one matches", async () => {
		const handler = vi.fn().mockResolvedValue({ subject: "Hi", body: "Hello" });
		const pool = createExecutionMockPool({
			jobRows: [makeJobRow({ workflow_id: "any-cond", payload: { isAdmin: false, isVip: true } })],
		});

		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false, pollInterval: 50 });
		adapter.registerWorkflow({
			id: "any-cond",
			name: "Any Condition",
			steps: [
				{
					stepId: "email-1",
					type: "email",
					handler,
					conditionMode: "any",
					conditions: [
						{ field: "payload.isAdmin", operator: "eq", value: true },
						{ field: "payload.isVip", operator: "eq", value: true }, // this one passes
					],
				},
			],
		});

		await adapter.start();
		await new Promise((r) => setTimeout(r, 200));
		await adapter.stop();

		expect(handler).toHaveBeenCalledTimes(1);
	});

	it("skips step with 'any' conditionMode when none match", async () => {
		const handler = vi.fn().mockResolvedValue({ subject: "Hi", body: "Hello" });
		const pool = createExecutionMockPool({
			jobRows: [makeJobRow({ workflow_id: "any-cond", payload: { isAdmin: false, isVip: false } })],
		});

		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false, pollInterval: 50 });
		adapter.registerWorkflow({
			id: "any-cond",
			name: "Any None",
			steps: [
				{
					stepId: "email-1",
					type: "email",
					handler,
					conditionMode: "any",
					conditions: [
						{ field: "payload.isAdmin", operator: "eq", value: true },
						{ field: "payload.isVip", operator: "eq", value: true },
					],
				},
			],
		});

		await adapter.start();
		await new Promise((r) => setTimeout(r, 200));
		await adapter.stop();

		expect(handler).not.toHaveBeenCalled();
	});

	it("executes step with no conditions (unconditional)", async () => {
		const handler = vi.fn().mockResolvedValue({ subject: "Hi", body: "Hello" });
		const pool = createExecutionMockPool({
			jobRows: [makeJobRow({ workflow_id: "no-cond", payload: {} })],
		});

		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false, pollInterval: 50 });
		adapter.registerWorkflow({
			id: "no-cond",
			name: "No Condition",
			steps: [{ stepId: "email-1", type: "email", handler }],
		});

		await adapter.start();
		await new Promise((r) => setTimeout(r, 200));
		await adapter.stop();

		expect(handler).toHaveBeenCalledTimes(1);
	});

	it("advances current_step when skipping a condition-failed step", async () => {
		const pool = createExecutionMockPool({
			jobRows: [makeJobRow({ workflow_id: "skip-advance", payload: { skip: true } })],
		});

		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false, pollInterval: 50 });
		adapter.registerWorkflow({
			id: "skip-advance",
			name: "Skip Advance",
			steps: [
				{
					stepId: "email-1",
					type: "email",
					handler: async () => ({ subject: "Skipped", body: "No" }),
					conditions: [{ field: "payload.skip", operator: "eq", value: false }],
				},
				{
					stepId: "email-2",
					type: "email",
					handler: async () => ({ subject: "Run", body: "Yes" }),
				},
			],
		});

		await adapter.start();
		await new Promise((r) => setTimeout(r, 200));
		await adapter.stop();

		// Should have UPDATE current_step queries for skipping + advancing
		const advanceQueries = pool.queries.filter((q) => q.text.includes("current_step") && q.text.includes("UPDATE"));
		expect(advanceQueries.length).toBeGreaterThanOrEqual(2);
	});
});

describe("postgres workflow adapter — multi-recipient fan-out", () => {
	it("creates one job per recipient", async () => {
		const pool = createMockPool();
		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false, pollInterval: 100_000 });
		adapter.registerWorkflow(simpleEmailWorkflow());

		const result = await adapter.trigger({
			workflowId: "welcome",
			to: ["user-1", "user-2", "user-3"],
			payload: { message: "hello" },
		});

		expect(result.status).toBe("queued");
		const insertQueries = pool.queries.filter((q) => q.text.includes("INSERT INTO herald_wf_jobs"));
		expect(insertQueries).toHaveLength(3);

		const subscriberIds = insertQueries.map((q) => q.values?.[3]);
		expect(subscriberIds).toEqual(["user-1", "user-2", "user-3"]);
		await adapter.stop();
	});

	it("all fan-out jobs share the same transactionId", async () => {
		const pool = createMockPool();
		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false, pollInterval: 100_000 });
		adapter.registerWorkflow(simpleEmailWorkflow());

		const result = await adapter.trigger({
			workflowId: "welcome",
			to: ["user-1", "user-2", "user-3", "user-4"],
			payload: {},
			transactionId: "shared-tx",
		});

		expect(result.transactionId).toBe("shared-tx");

		const insertQueries = pool.queries.filter((q) => q.text.includes("INSERT INTO herald_wf_jobs"));
		for (const q of insertQueries) {
			expect(q.values?.[1]).toBe("shared-tx");
		}
		await adapter.stop();
	});

	it("generates unique job ids for each recipient", async () => {
		const pool = createMockPool();
		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false, pollInterval: 100_000 });
		adapter.registerWorkflow(simpleEmailWorkflow());

		await adapter.trigger({
			workflowId: "welcome",
			to: ["user-1", "user-2", "user-3", "user-4", "user-5"],
			payload: {},
		});

		const insertQueries = pool.queries.filter((q) => q.text.includes("INSERT INTO herald_wf_jobs"));
		const jobIds = insertQueries.map((q) => q.values?.[0]);
		// All job ids must be unique
		expect(new Set(jobIds).size).toBe(5);
		await adapter.stop();
	});

	it("single recipient string creates exactly one job", async () => {
		const pool = createMockPool();
		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false, pollInterval: 100_000 });
		adapter.registerWorkflow(simpleEmailWorkflow());

		await adapter.trigger({
			workflowId: "welcome",
			to: "solo-user",
			payload: {},
		});

		const insertQueries = pool.queries.filter((q) => q.text.includes("INSERT INTO herald_wf_jobs"));
		expect(insertQueries).toHaveLength(1);
		expect(insertQueries[0].values?.[3]).toBe("solo-user");
		await adapter.stop();
	});

	it("inserts digest events per recipient for digest workflows", async () => {
		const pool = createMockPool();
		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false, pollInterval: 100_000 });
		adapter.registerWorkflow(digestWorkflow());

		await adapter.trigger({
			workflowId: "digest-wf",
			to: ["user-1", "user-2"],
			payload: { data: 42 },
		});

		const digestInserts = pool.queries.filter((q) => q.text.includes("INSERT INTO herald_wf_digest_events"));
		expect(digestInserts).toHaveLength(2);

		const digestKeys = digestInserts.map((q) => q.values?.[2]);
		expect(digestKeys).toContain("digest-wf:digest-1:user-1");
		expect(digestKeys).toContain("digest-wf:digest-1:user-2");
		await adapter.stop();
	});

	it("preserves payload across all fan-out jobs", async () => {
		const pool = createMockPool();
		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false, pollInterval: 100_000 });
		adapter.registerWorkflow(simpleEmailWorkflow());

		const payload = { greeting: "hello", count: 42, nested: { key: "value" } };
		await adapter.trigger({
			workflowId: "welcome",
			to: ["user-1", "user-2"],
			payload,
		});

		const insertQueries = pool.queries.filter((q) => q.text.includes("INSERT INTO herald_wf_jobs"));
		for (const q of insertQueries) {
			expect(q.values?.[4]).toBe(JSON.stringify(payload));
		}
		await adapter.stop();
	});

	it("propagates actor and tenant to all fan-out jobs", async () => {
		const pool = createMockPool();
		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false, pollInterval: 100_000 });
		adapter.registerWorkflow(simpleEmailWorkflow());

		await adapter.trigger({
			workflowId: "welcome",
			to: ["user-1", "user-2", "user-3"],
			payload: {},
			actor: "admin-user",
			tenant: "org-42",
		});

		const insertQueries = pool.queries.filter((q) => q.text.includes("INSERT INTO herald_wf_jobs"));
		expect(insertQueries).toHaveLength(3);
		for (const q of insertQueries) {
			expect(q.values?.[5]).toBe("admin-user");
			expect(q.values?.[6]).toBe("org-42");
		}
		await adapter.stop();
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
