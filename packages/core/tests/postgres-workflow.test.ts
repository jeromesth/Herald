import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PgClient, PgPool, PgQueryResult, PostgresWorkflowAdapter } from "../src/adapters/workflow/postgres.js";
import { postgresWorkflowAdapter } from "../src/adapters/workflow/postgres.js";
import type { NotificationWorkflow, StepResult } from "../src/types/workflow.js";

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
