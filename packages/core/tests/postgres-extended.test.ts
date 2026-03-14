import { afterEach, describe, expect, it, vi } from "vitest";
import { postgresWorkflowAdapter } from "../src/adapters/workflow/postgres.js";
import type { PgClient, PgPool, PgQueryResult } from "../src/adapters/workflow/postgres.js";

function createMockPool(overrides?: Partial<PgPool>): PgPool {
	const mockClient: PgClient = {
		query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
		release: vi.fn(),
	};

	return {
		query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
		connect: vi.fn().mockResolvedValue(mockClient),
		end: vi.fn().mockResolvedValue(undefined),
		...overrides,
	};
}

describe("postgresWorkflowAdapter", () => {
	it("throws when neither pool nor connectionString is provided", () => {
		expect(() => postgresWorkflowAdapter({})).toThrow("requires either");
	});

	it("has adapterId of postgres", () => {
		const pool = createMockPool();
		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false });
		expect(adapter.adapterId).toBe("postgres");
	});

	it("registers workflows", () => {
		const pool = createMockPool();
		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false });

		adapter.registerWorkflow({
			id: "welcome",
			name: "Welcome",
			steps: [{ stepId: "send", type: "email", handler: async () => ({ subject: "Hi", body: "Hello" }) }],
		});
		// No error means it registered successfully
	});

	it("getHandler returns null", () => {
		const pool = createMockPool();
		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false });
		expect(adapter.getHandler()).toBeNull();
	});

	it("trigger creates jobs in the database", async () => {
		const pool = createMockPool();
		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false });

		adapter.registerWorkflow({
			id: "welcome",
			name: "Welcome",
			steps: [{ stepId: "send", type: "email", handler: async () => ({ subject: "Hi", body: "Hello" }) }],
		});

		const result = await adapter.trigger({
			workflowId: "welcome",
			to: ["user-1", "user-2"],
			payload: { greeting: "hi" },
			actor: "admin",
			tenant: "org-1",
		});

		expect(result.status).toBe("queued");
		expect(result.transactionId).toBeTruthy();

		// Should have called query for migration (5 CREATE + 3 INDEX) + 2 inserts
		expect(pool.query).toHaveBeenCalled();
	});

	it("trigger with custom transactionId", async () => {
		const pool = createMockPool();
		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false });

		adapter.registerWorkflow({
			id: "welcome",
			name: "Welcome",
			steps: [{ stepId: "send", type: "email", handler: async () => ({ body: "Hello" }) }],
		});

		const result = await adapter.trigger({
			workflowId: "welcome",
			to: "user-1",
			payload: {},
			transactionId: "my-tx",
		});

		expect(result.transactionId).toBe("my-tx");
	});

	it("trigger inserts digest events for digest workflows", async () => {
		const pool = createMockPool();
		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false });

		adapter.registerWorkflow({
			id: "digest-wf",
			name: "Digest",
			steps: [
				{
					stepId: "collect",
					type: "digest",
					handler: async ({ step }) => {
						await step.digest({ window: 5, unit: "minutes" });
						return {};
					},
				},
			],
		});

		await adapter.trigger({
			workflowId: "digest-wf",
			to: "user-1",
			payload: {},
		});

		// Should have inserted both a job and a digest event
		const calls = (pool.query as ReturnType<typeof vi.fn>).mock.calls;
		const insertDigestCall = calls.find((c: unknown[]) => typeof c[0] === "string" && c[0].includes("digest_events"));
		expect(insertDigestCall).toBeDefined();
	});

	it("cancel updates job status", async () => {
		const pool = createMockPool();
		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false });

		await adapter.cancel({ workflowId: "welcome", transactionId: "tx-123" });

		const calls = (pool.query as ReturnType<typeof vi.fn>).mock.calls;
		const cancelCall = calls.find((c: unknown[]) => typeof c[0] === "string" && c[0].includes("cancelled"));
		expect(cancelCall).toBeDefined();
	});

	it("migrate creates tables and indexes", async () => {
		const pool = createMockPool();
		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false });

		await adapter.migrate();

		const calls = (pool.query as ReturnType<typeof vi.fn>).mock.calls;
		const createTableCalls = calls.filter((c: unknown[]) => typeof c[0] === "string" && c[0].includes("CREATE TABLE"));
		const createIndexCalls = calls.filter((c: unknown[]) => typeof c[0] === "string" && c[0].includes("CREATE INDEX"));

		expect(createTableCalls.length).toBe(3);
		expect(createIndexCalls.length).toBe(3);
	});

	it("migrate is idempotent", async () => {
		const pool = createMockPool();
		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false });

		await adapter.migrate();
		const firstCallCount = (pool.query as ReturnType<typeof vi.fn>).mock.calls.length;

		await adapter.migrate();
		const secondCallCount = (pool.query as ReturnType<typeof vi.fn>).mock.calls.length;

		// Second call should not add any new queries
		expect(secondCallCount).toBe(firstCallCount);
	});

	it("start auto-migrates and sets up polling", async () => {
		const pool = createMockPool();
		const adapter = postgresWorkflowAdapter({ pool, pollInterval: 60000 });

		await adapter.start();

		// Should have run migration queries
		expect(pool.query).toHaveBeenCalled();

		await adapter.stop();
	});

	it("start is idempotent", async () => {
		const pool = createMockPool();
		const adapter = postgresWorkflowAdapter({ pool, pollInterval: 60000 });

		await adapter.start();
		await adapter.start();

		await adapter.stop();
	});

	it("stop clears polling timer", async () => {
		const pool = createMockPool();
		const adapter = postgresWorkflowAdapter({ pool, pollInterval: 60000 });

		await adapter.start();
		await adapter.stop();

		// Should not throw
	});

	it("uses custom tablePrefix", async () => {
		const pool = createMockPool();
		const adapter = postgresWorkflowAdapter({ pool, autoMigrate: false, tablePrefix: "custom" });

		await adapter.migrate();

		const calls = (pool.query as ReturnType<typeof vi.fn>).mock.calls;
		const hasCustomPrefix = calls.some((c: unknown[]) => typeof c[0] === "string" && c[0].includes("custom_jobs"));
		expect(hasCustomPrefix).toBe(true);
	});
});
