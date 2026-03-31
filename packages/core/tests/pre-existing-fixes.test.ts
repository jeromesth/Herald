import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { memoryAdapter } from "../src/adapters/database/memory.js";
import { prismaAdapter } from "../src/adapters/database/prisma.js";
import { memoryWorkflowAdapter } from "../src/adapters/workflow/memory.js";
import { HTTPError, parseJsonBody } from "../src/api/router.js";
import { herald } from "../src/core/herald.js";
import { SSEManager } from "../src/realtime/sse.js";
import { renderTemplate } from "../src/templates/engine.js";
import type { TemplateContext } from "../src/templates/engine.js";
import type { Herald, NotificationWorkflow } from "../src/types/index.js";

// ---------------------------------------------------------------------------
// Fix 1: Prototype pollution blocked in template engine resolvePath
// ---------------------------------------------------------------------------
describe("Template Engine — prototype pollution prevention", () => {
	const ctx: TemplateContext = {
		subscriber: { firstName: "Alice" },
		payload: { nested: { value: "safe" } },
	};

	it("blocks __proto__ traversal and returns empty string", () => {
		const result = renderTemplate("{{ payload.__proto__.toString }}", ctx);
		expect(result).toBe("");
	});

	it("blocks constructor traversal", () => {
		const result = renderTemplate("{{ payload.constructor }}", ctx);
		expect(result).toBe("");
	});

	it("blocks prototype traversal", () => {
		const result = renderTemplate("{{ payload.prototype }}", ctx);
		expect(result).toBe("");
	});

	it("blocks __proto__ in nested paths", () => {
		const result = renderTemplate("{{ payload.nested.__proto__.polluted }}", ctx);
		expect(result).toBe("");
	});

	it("still resolves legitimate paths normally", () => {
		const result = renderTemplate("{{ payload.nested.value }}", ctx);
		expect(result).toBe("safe");
	});
});

// ---------------------------------------------------------------------------
// Fix 2: N+1 replaced with updateMany in mark notifications
// ---------------------------------------------------------------------------
describe("markNotifications uses batch update", () => {
	let app: Herald;
	const testWorkflow: NotificationWorkflow = {
		id: "mark-test",
		name: "Mark Test",
		steps: [{ stepId: "send", type: "in_app", handler: async () => ({ body: "Hello" }) }],
	};

	beforeEach(() => {
		app = herald({
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
			workflows: [testWorkflow],
		});
	});

	it("marks multiple notifications in a single batch via API", async () => {
		await app.api.upsertSubscriber({ externalId: "user-1", email: "u@test.com" });

		// Trigger twice to create two notifications
		await app.api.trigger({ workflowId: "mark-test", to: "user-1", payload: {} });
		await app.api.trigger({ workflowId: "mark-test", to: "user-1", payload: {} });

		const { notifications } = await app.api.getNotifications({ subscriberId: "user-1" });
		expect(notifications.length).toBe(2);

		const ids = notifications.map((n) => n.id);
		await app.api.markNotifications({ ids, action: "read" });

		const { notifications: updated } = await app.api.getNotifications({ subscriberId: "user-1" });
		for (const n of updated) {
			expect(n.read).toBe(true);
			expect(n.readAt).toBeDefined();
		}
	});

	it("marks multiple notifications via HTTP route", async () => {
		await app.api.upsertSubscriber({ externalId: "user-1", email: "u@test.com" });
		await app.api.trigger({ workflowId: "mark-test", to: "user-1", payload: {} });
		await app.api.trigger({ workflowId: "mark-test", to: "user-1", payload: {} });

		const { notifications } = await app.api.getNotifications({ subscriberId: "user-1" });
		const ids = notifications.map((n) => n.id);

		const res = await app.handler(
			new Request("https://test.local/api/notifications/notifications/mark", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ids, action: "seen" }),
			}),
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.count).toBe(2);

		const { notifications: updated } = await app.api.getNotifications({ subscriberId: "user-1" });
		for (const n of updated) {
			expect(n.seen).toBe(true);
		}
	});
});

// ---------------------------------------------------------------------------
// Fix 3: Prisma adapter usePlural actually pluralizes model names
// ---------------------------------------------------------------------------
describe("Prisma adapter usePlural", () => {
	it("accesses plural model names when usePlural is true", async () => {
		// Create a mock client that only has plural model names
		const store = new Map<string, Record<string, unknown>>();
		const subscribers = {
			create: async (args: { data: Record<string, unknown> }) => {
				const record = { ...args.data };
				store.set(record.id as string, record);
				return record;
			},
			findFirst: async (args: { where?: Record<string, unknown> }) => {
				for (const record of store.values()) {
					if (!args.where || Object.entries(args.where).every(([k, v]) => record[k] === v)) {
						return record;
					}
				}
				return null;
			},
			findMany: async () => Array.from(store.values()),
			count: async () => store.size,
			update: async () => ({}),
			updateMany: async () => ({ count: 0 }),
			delete: async () => ({}),
			deleteMany: async () => ({ count: 0 }),
		};

		// Client with "subscribers" (plural), no "subscriber" (singular)
		const client = { subscribers } as unknown as Record<string, unknown>;
		const adapter = prismaAdapter(client, { provider: "postgresql", usePlural: true });

		const result = await adapter.create({
			model: "subscriber",
			data: { id: "1", externalId: "test-1", email: "test@test.com" },
		});

		expect(result).toBeDefined();
		expect((result as Record<string, unknown>).externalId).toBe("test-1");
	});

	it("throws when usePlural is true but client only has singular model names", async () => {
		const subscriber = {
			create: async () => ({}),
			findFirst: async () => null,
			findMany: async () => [],
			count: async () => 0,
			update: async () => ({}),
			updateMany: async () => ({ count: 0 }),
			delete: async () => ({}),
			deleteMany: async () => ({ count: 0 }),
		};

		// Client has "subscriber" (singular) but usePlural expects "subscribers"
		const client = { subscriber } as unknown as Record<string, unknown>;
		const adapter = prismaAdapter(client, { provider: "postgresql", usePlural: true });

		await expect(adapter.create({ model: "subscriber", data: { id: "1" } })).rejects.toThrow('Model "subscribers" not found');
	});
});

// ---------------------------------------------------------------------------
// Fix 4: NaN bypass in parseJsonBody Content-Length check
// ---------------------------------------------------------------------------
describe("parseJsonBody Content-Length NaN rejection", () => {
	it("rejects non-numeric Content-Length header", async () => {
		const request = new Request("https://test.local/api/test", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Content-Length": "not-a-number",
			},
			body: JSON.stringify({ key: "value" }),
		});

		await expect(parseJsonBody(request)).rejects.toThrow();
	});

	it("rejects Content-Length with text prefix", async () => {
		const request = new Request("https://test.local/api/test", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Content-Length": "abc123",
			},
			body: JSON.stringify({ key: "value" }),
		});

		await expect(parseJsonBody(request)).rejects.toThrow();
	});

	it("accepts valid numeric Content-Length", async () => {
		const body = JSON.stringify({ key: "value" });
		const request = new Request("https://test.local/api/test", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Content-Length": String(body.length),
			},
			body,
		});

		const result = await parseJsonBody(request);
		expect(result).toEqual({ key: "value" });
	});
});

// ---------------------------------------------------------------------------
// Fix 5: instanceof HeraldNotFoundError in topic subscriber removal
// (tested indirectly — removing a subscriber not in a topic should not throw)
// ---------------------------------------------------------------------------
describe("Topic subscriber removal error handling", () => {
	let app: Herald;

	beforeEach(() => {
		app = herald({
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
			workflows: [],
		});
	});

	it("gracefully handles removing a subscriber not in a topic", async () => {
		// Create topic
		await app.handler(
			new Request("https://test.local/api/notifications/topics", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ key: "project:abc", name: "Project ABC" }),
			}),
		);

		// Try removing a subscriber that was never added — should not throw
		const res = await app.handler(
			new Request("https://test.local/api/notifications/topics/project:abc/subscribers", {
				method: "DELETE",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ subscriberIds: ["non-existent-subscriber"] }),
			}),
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.count).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Fix 6: Unsafe numeric casts in memory adapter matchesWhere
// ---------------------------------------------------------------------------
describe("Memory adapter numeric comparison safety", () => {
	it("returns false for lt/gt/lte/gte when values are not numbers", async () => {
		const db = memoryAdapter();

		await db.create({
			model: "subscriber",
			data: { id: "1", externalId: "user-1", name: "Alice" },
		});

		// Using gt operator on a string field — should not match (not crash)
		const results = await db.findMany({
			model: "subscriber",
			where: [{ field: "name", value: 10, operator: "gt" }],
		});

		expect(results).toEqual([]);
	});

	it("correctly compares numeric values with lt operator", async () => {
		const db = memoryAdapter();

		await db.create({ model: "subscriber", data: { id: "1", externalId: "u1", score: 10 } });
		await db.create({ model: "subscriber", data: { id: "2", externalId: "u2", score: 20 } });
		await db.create({ model: "subscriber", data: { id: "3", externalId: "u3", score: 30 } });

		const results = await db.findMany({
			model: "subscriber",
			where: [{ field: "score", value: 25, operator: "lt" }],
		});

		expect(results.length).toBe(2);
	});

	it("returns false when record value is null and operator is gte", async () => {
		const db = memoryAdapter();

		await db.create({
			model: "subscriber",
			data: { id: "1", externalId: "user-1", score: null },
		});

		const results = await db.findMany({
			model: "subscriber",
			where: [{ field: "score", value: 0, operator: "gte" }],
		});

		expect(results).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Fix 7: SSE emit — no Set mutation during iteration
// ---------------------------------------------------------------------------
describe("SSE emit does not skip connections on error", () => {
	let sse: SSEManager;

	afterEach(() => {
		sse?.close();
	});

	it("cleans up failed connections without skipping subsequent ones", async () => {
		sse = new SSEManager();

		// Connect 3 streams for the same subscriber
		const res1 = sse.connect("sub-1");
		const res2 = sse.connect("sub-1");
		const res3 = sse.connect("sub-1");

		expect(sse.connectionCount).toBe(3);

		// Cancel first two streams to make their controllers fail on enqueue
		const reader1 = res1.body?.getReader();
		const reader2 = res2.body?.getReader();
		const reader3 = res3.body?.getReader();

		// Read the initial "connected" events
		await reader1?.read();
		await reader2?.read();
		await reader3?.read();

		// Cancel readers 1 and 2 to force their controllers to error on next write
		await reader1?.cancel();
		await reader2?.cancel();

		// Emit an event — should deliver to reader3 and clean up 1 and 2
		sse.emit("sub-1", { type: "test", data: { msg: "hello" } });

		// The third connection should still receive the event
		const { value } = await (reader3 as ReadableStreamDefaultReader<Uint8Array>).read();
		const text = new TextDecoder().decode(value);
		expect(text).toContain("event: test");
		expect(text).toContain('"msg":"hello"');

		reader3?.releaseLock();
	});
});
