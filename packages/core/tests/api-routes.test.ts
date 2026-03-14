import { beforeEach, describe, expect, it } from "vitest";
import { memoryAdapter } from "../src/adapters/database/memory.js";
import { memoryWorkflowAdapter } from "../src/adapters/workflow/memory.js";
import { herald } from "../src/core/herald.js";
import type { Herald, NotificationWorkflow } from "../src/types/index.js";

const testWorkflow: NotificationWorkflow = {
	id: "test-notif",
	name: "Test Notification",
	steps: [
		{
			stepId: "send-in-app",
			type: "in_app",
			handler: async () => ({ body: "Test message" }),
		},
	],
};

describe("API Routes — extended coverage", () => {
	let app: Herald;
	const origin = "https://herald.test";
	const basePath = "/api/notifications";

	function makeRequest(method: string, path: string, body?: unknown): Request {
		return new Request(`${origin}${basePath}${path}`, {
			method,
			headers: { "Content-Type": "application/json" },
			body: body ? JSON.stringify(body) : undefined,
		});
	}

	async function json(response: Response) {
		return response.json();
	}

	beforeEach(() => {
		app = herald({
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
			workflows: [testWorkflow],
		});
	});

	// ─── Trigger routes ───

	describe("POST /trigger", () => {
		it("returns 400 when to is missing", async () => {
			const res = await app.handler(makeRequest("POST", "/trigger", { workflowId: "test-notif" }));
			expect(res.status).toBe(400);
			const body = await json(res);
			expect(body.error).toContain("to");
		});
	});

	describe("POST /trigger/bulk", () => {
		it("triggers multiple workflows", async () => {
			const res = await app.handler(
				makeRequest("POST", "/trigger/bulk", {
					events: [
						{ workflowId: "test-notif", to: "user-1", payload: {} },
						{ workflowId: "test-notif", to: "user-2", payload: {} },
					],
				}),
			);

			expect(res.status).toBe(200);
			const body = await json(res);
			expect(body.results).toHaveLength(2);
			expect(body.results[0]?.status).toBe("triggered");
			expect(body.results[1]?.status).toBe("triggered");
		});

		it("returns 400 when events array is missing", async () => {
			const res = await app.handler(makeRequest("POST", "/trigger/bulk", {}));
			expect(res.status).toBe(400);
		});

		it("reports failed events individually", async () => {
			const res = await app.handler(
				makeRequest("POST", "/trigger/bulk", {
					events: [
						{ workflowId: "nonexistent-workflow", to: "user-1", payload: {} },
						{ workflowId: "test-notif", to: "user-2", payload: {} },
					],
				}),
			);

			expect(res.status).toBe(200);
			const body = await json(res);
			expect(body.results).toHaveLength(2);
		});
	});

	describe("DELETE /trigger/:transactionId", () => {
		it("cancels a workflow with workflowId query param", async () => {
			const res = await app.handler(makeRequest("DELETE", "/trigger/tx-123?workflowId=test-notif"));

			expect(res.status).toBe(200);
			const body = await json(res);
			expect(body.status).toBe("cancelled");
		});

		it("returns 404 when workflowId cannot be resolved", async () => {
			const res = await app.handler(makeRequest("DELETE", "/trigger/unknown-tx"));
			expect(res.status).toBe(404);
		});

		it("resolves workflowId from persisted notifications", async () => {
			await app.api.upsertSubscriber({ externalId: "user-1" });
			const subscriber = await app.api.getSubscriber("user-1");

			await app.$context.db.create({
				model: "notification",
				data: {
					id: crypto.randomUUID(),
					subscriberId: subscriber?.id,
					workflowId: "test-notif",
					channel: "in_app",
					body: "Test",
					read: false,
					seen: false,
					archived: false,
					deliveryStatus: "delivered",
					transactionId: "persisted-tx",
					createdAt: new Date(),
				},
			});

			const res = await app.handler(makeRequest("DELETE", "/trigger/persisted-tx"));
			expect(res.status).toBe(200);
			const body = await json(res);
			expect(body.status).toBe("cancelled");
		});
	});

	// ─── Notification routes ───

	describe("GET /notifications/:subscriberId", () => {
		it("returns notifications for a subscriber", async () => {
			await app.api.upsertSubscriber({ externalId: "user-1" });
			const subscriber = await app.api.getSubscriber("user-1");

			await app.$context.db.create({
				model: "notification",
				data: {
					id: crypto.randomUUID(),
					subscriberId: subscriber?.id,
					workflowId: "test",
					channel: "in_app",
					body: "Hello",
					read: false,
					seen: false,
					archived: false,
					deliveryStatus: "delivered",
					transactionId: "tx-1",
					createdAt: new Date(),
				},
			});

			const res = await app.handler(makeRequest("GET", "/notifications/user-1"));
			expect(res.status).toBe(200);
			const body = await json(res);
			expect(body.notifications).toHaveLength(1);
			expect(body.totalCount).toBe(1);
			expect(body.hasMore).toBe(false);
		});

		it("returns 404 for unknown subscriber", async () => {
			const res = await app.handler(makeRequest("GET", "/notifications/unknown"));
			expect(res.status).toBe(404);
		});

		it("supports filtering by read status", async () => {
			await app.api.upsertSubscriber({ externalId: "user-1" });
			const subscriber = await app.api.getSubscriber("user-1");

			await app.$context.db.create({
				model: "notification",
				data: {
					id: crypto.randomUUID(),
					subscriberId: subscriber?.id,
					workflowId: "test",
					channel: "in_app",
					body: "Read msg",
					read: true,
					seen: false,
					archived: false,
					deliveryStatus: "delivered",
					transactionId: "tx-1",
					createdAt: new Date(),
				},
			});

			const res = await app.handler(makeRequest("GET", "/notifications/user-1?read=false"));
			expect(res.status).toBe(200);
			const body = await json(res);
			expect(body.notifications).toHaveLength(0);
		});

		it("supports filtering by seen and archived", async () => {
			await app.api.upsertSubscriber({ externalId: "user-1" });
			const res = await app.handler(makeRequest("GET", "/notifications/user-1?seen=true&archived=false"));
			expect(res.status).toBe(200);
		});
	});

	describe("GET /notifications/:subscriberId/count", () => {
		it("returns count of notifications", async () => {
			await app.api.upsertSubscriber({ externalId: "user-1" });
			const res = await app.handler(makeRequest("GET", "/notifications/user-1/count"));
			expect(res.status).toBe(200);
			const body = await json(res);
			expect(body.count).toBe(0);
		});

		it("returns 404 for unknown subscriber", async () => {
			const res = await app.handler(makeRequest("GET", "/notifications/unknown/count"));
			expect(res.status).toBe(404);
		});

		it("supports read filter on count", async () => {
			await app.api.upsertSubscriber({ externalId: "user-1" });
			const res = await app.handler(makeRequest("GET", "/notifications/user-1/count?read=false"));
			expect(res.status).toBe(200);
			const body = await json(res);
			expect(body.count).toBe(0);
		});
	});

	describe("POST /notifications/mark", () => {
		it("returns 400 when ids are missing", async () => {
			const res = await app.handler(makeRequest("POST", "/notifications/mark", { action: "read" }));
			expect(res.status).toBe(400);
		});

		it("returns 400 for invalid action", async () => {
			const res = await app.handler(makeRequest("POST", "/notifications/mark", { ids: ["id-1"], action: "invalid" }));
			expect(res.status).toBe(400);
		});

		it("marks notifications as seen", async () => {
			await app.api.upsertSubscriber({ externalId: "user-1" });
			const subscriber = await app.api.getSubscriber("user-1");
			const notifId = crypto.randomUUID();

			await app.$context.db.create({
				model: "notification",
				data: {
					id: notifId,
					subscriberId: subscriber?.id,
					workflowId: "test",
					channel: "in_app",
					body: "Test",
					read: false,
					seen: false,
					archived: false,
					deliveryStatus: "delivered",
					transactionId: "tx-1",
					createdAt: new Date(),
				},
			});

			const res = await app.handler(makeRequest("POST", "/notifications/mark", { ids: [notifId], action: "seen" }));
			expect(res.status).toBe(200);
			const body = await json(res);
			expect(body.status).toBe("updated");
		});

		it("marks notifications as archived", async () => {
			await app.api.upsertSubscriber({ externalId: "user-1" });
			const subscriber = await app.api.getSubscriber("user-1");
			const notifId = crypto.randomUUID();

			await app.$context.db.create({
				model: "notification",
				data: {
					id: notifId,
					subscriberId: subscriber?.id,
					workflowId: "test",
					channel: "in_app",
					body: "Test",
					read: false,
					seen: false,
					archived: false,
					deliveryStatus: "delivered",
					transactionId: "tx-1",
					createdAt: new Date(),
				},
			});

			const res = await app.handler(makeRequest("POST", "/notifications/mark", { ids: [notifId], action: "archived" }));
			expect(res.status).toBe(200);
		});
	});

	describe("POST /notifications/mark-all-read", () => {
		it("marks all notifications as read for a subscriber", async () => {
			await app.api.upsertSubscriber({ externalId: "user-1" });
			const subscriber = await app.api.getSubscriber("user-1");

			await app.$context.db.create({
				model: "notification",
				data: {
					id: crypto.randomUUID(),
					subscriberId: subscriber?.id,
					workflowId: "test",
					channel: "in_app",
					body: "Test",
					read: false,
					seen: false,
					archived: false,
					deliveryStatus: "delivered",
					transactionId: "tx-1",
					createdAt: new Date(),
				},
			});

			const res = await app.handler(makeRequest("POST", "/notifications/mark-all-read", { subscriberId: "user-1" }));
			expect(res.status).toBe(200);
			const body = await json(res);
			expect(body.status).toBe("updated");
			expect(body.count).toBe(1);
		});

		it("returns 400 when subscriberId is missing", async () => {
			const res = await app.handler(makeRequest("POST", "/notifications/mark-all-read", {}));
			expect(res.status).toBe(400);
		});

		it("returns 404 for unknown subscriber", async () => {
			const res = await app.handler(makeRequest("POST", "/notifications/mark-all-read", { subscriberId: "unknown" }));
			expect(res.status).toBe(404);
		});
	});

	// ─── Subscriber routes ───

	describe("POST /subscribers (upsert)", () => {
		it("updates existing subscriber", async () => {
			await app.handler(makeRequest("POST", "/subscribers", { externalId: "user-1", email: "old@example.com" }));
			const res = await app.handler(makeRequest("POST", "/subscribers", { externalId: "user-1", email: "new@example.com" }));

			expect(res.status).toBe(200);
			const body = await json(res);
			expect(body.email).toBe("new@example.com");
		});
	});

	describe("PATCH /subscribers/:id", () => {
		it("partially updates a subscriber", async () => {
			await app.handler(
				makeRequest("POST", "/subscribers", {
					externalId: "user-1",
					email: "alice@example.com",
					firstName: "Alice",
				}),
			);

			const res = await app.handler(makeRequest("PATCH", "/subscribers/user-1", { firstName: "Bob" }));

			expect(res.status).toBe(200);
			const body = await json(res);
			expect(body.firstName).toBe("Bob");
			expect(body.email).toBe("alice@example.com");
		});

		it("returns 404 for unknown subscriber", async () => {
			const res = await app.handler(makeRequest("PATCH", "/subscribers/unknown", { email: "a@b.com" }));
			expect(res.status).toBe(404);
		});

		it("supports updating data field", async () => {
			await app.handler(makeRequest("POST", "/subscribers", { externalId: "user-1" }));

			const res = await app.handler(makeRequest("PATCH", "/subscribers/user-1", { data: { role: "admin" } }));

			expect(res.status).toBe(200);
			const body = await json(res);
			expect(body.data).toEqual({ role: "admin" });
		});
	});

	describe("DELETE /subscribers/:id", () => {
		it("returns 404 for unknown subscriber", async () => {
			const res = await app.handler(makeRequest("DELETE", "/subscribers/unknown"));
			expect(res.status).toBe(404);
		});
	});

	// ─── Topic routes ───

	describe("POST /topics", () => {
		it("returns 400 when key is missing", async () => {
			const res = await app.handler(makeRequest("POST", "/topics", { name: "Test" }));
			expect(res.status).toBe(400);
		});
	});

	describe("GET /topics", () => {
		it("lists topics with pagination", async () => {
			await app.handler(makeRequest("POST", "/topics", { key: "topic-1", name: "Topic 1" }));
			await app.handler(makeRequest("POST", "/topics", { key: "topic-2", name: "Topic 2" }));

			const res = await app.handler(makeRequest("GET", "/topics?limit=10&offset=0"));
			expect(res.status).toBe(200);
			const body = await json(res);
			expect(body.topics).toHaveLength(2);
		});
	});

	describe("GET /topics/:key", () => {
		it("retrieves a topic", async () => {
			await app.handler(makeRequest("POST", "/topics", { key: "my-topic", name: "My Topic" }));
			const res = await app.handler(makeRequest("GET", "/topics/my-topic"));
			expect(res.status).toBe(200);
			const body = await json(res);
			expect(body.key).toBe("my-topic");
		});

		it("returns 404 for unknown topic", async () => {
			const res = await app.handler(makeRequest("GET", "/topics/unknown"));
			expect(res.status).toBe(404);
		});
	});

	describe("DELETE /topics/:key", () => {
		it("deletes a topic", async () => {
			await app.handler(makeRequest("POST", "/topics", { key: "to-delete", name: "Delete me" }));
			const res = await app.handler(makeRequest("DELETE", "/topics/to-delete"));
			expect(res.status).toBe(200);
			const body = await json(res);
			expect(body.status).toBe("deleted");
		});

		it("returns 404 for unknown topic", async () => {
			const res = await app.handler(makeRequest("DELETE", "/topics/unknown"));
			expect(res.status).toBe(404);
		});
	});

	describe("POST /topics/:key/subscribers", () => {
		it("adds subscribers to a topic", async () => {
			await app.handler(makeRequest("POST", "/topics", { key: "my-topic", name: "Topic" }));
			await app.handler(makeRequest("POST", "/subscribers", { externalId: "user-1" }));
			const subscriber = await app.api.getSubscriber("user-1");

			const res = await app.handler(makeRequest("POST", "/topics/my-topic/subscribers", { subscriberIds: [subscriber?.id] }));
			expect(res.status).toBe(200);
			const body = await json(res);
			expect(body.status).toBe("added");
			expect(body.count).toBe(1);
		});

		it("skips duplicate subscriber additions", async () => {
			await app.handler(makeRequest("POST", "/topics", { key: "my-topic", name: "Topic" }));
			await app.handler(makeRequest("POST", "/subscribers", { externalId: "user-1" }));
			const subscriber = await app.api.getSubscriber("user-1");

			await app.handler(makeRequest("POST", "/topics/my-topic/subscribers", { subscriberIds: [subscriber?.id] }));
			const res = await app.handler(makeRequest("POST", "/topics/my-topic/subscribers", { subscriberIds: [subscriber?.id] }));
			const body = await json(res);
			expect(body.count).toBe(0);
		});

		it("returns 400 when subscriberIds is missing", async () => {
			await app.handler(makeRequest("POST", "/topics", { key: "my-topic", name: "Topic" }));
			const res = await app.handler(makeRequest("POST", "/topics/my-topic/subscribers", {}));
			expect(res.status).toBe(400);
		});

		it("returns 404 for unknown topic", async () => {
			const res = await app.handler(makeRequest("POST", "/topics/unknown/subscribers", { subscriberIds: ["sub-1"] }));
			expect(res.status).toBe(404);
		});
	});

	describe("DELETE /topics/:key/subscribers", () => {
		it("removes subscribers from a topic", async () => {
			await app.handler(makeRequest("POST", "/topics", { key: "my-topic", name: "Topic" }));
			await app.handler(makeRequest("POST", "/subscribers", { externalId: "user-1" }));
			const subscriber = await app.api.getSubscriber("user-1");

			await app.handler(makeRequest("POST", "/topics/my-topic/subscribers", { subscriberIds: [subscriber?.id] }));
			const res = await app.handler(makeRequest("DELETE", "/topics/my-topic/subscribers", { subscriberIds: [subscriber?.id] }));
			expect(res.status).toBe(200);
			const body = await json(res);
			expect(body.status).toBe("removed");
			expect(body.count).toBe(1);
		});

		it("skips not-found subscribers silently", async () => {
			await app.handler(makeRequest("POST", "/topics", { key: "my-topic", name: "Topic" }));
			const res = await app.handler(makeRequest("DELETE", "/topics/my-topic/subscribers", { subscriberIds: ["nonexistent"] }));
			expect(res.status).toBe(200);
			const body = await json(res);
			expect(body.count).toBe(0);
		});

		it("returns 400 when subscriberIds is missing", async () => {
			await app.handler(makeRequest("POST", "/topics", { key: "my-topic", name: "Topic" }));
			const res = await app.handler(makeRequest("DELETE", "/topics/my-topic/subscribers", {}));
			expect(res.status).toBe(400);
		});

		it("returns 404 for unknown topic", async () => {
			const res = await app.handler(makeRequest("DELETE", "/topics/unknown/subscribers", { subscriberIds: ["sub-1"] }));
			expect(res.status).toBe(404);
		});
	});

	// ─── Preference routes ───

	describe("GET /subscribers/:id/preferences", () => {
		it("returns default preferences for subscriber with no prefs", async () => {
			await app.handler(makeRequest("POST", "/subscribers", { externalId: "user-1" }));
			const res = await app.handler(makeRequest("GET", "/subscribers/user-1/preferences"));
			expect(res.status).toBe(200);
			const body = await json(res);
			expect(body.subscriberId).toBeDefined();
		});

		it("returns 404 for unknown subscriber", async () => {
			const res = await app.handler(makeRequest("GET", "/subscribers/unknown/preferences"));
			expect(res.status).toBe(404);
		});
	});

	describe("PUT /subscribers/:id/preferences", () => {
		it("creates preferences for subscriber", async () => {
			await app.handler(makeRequest("POST", "/subscribers", { externalId: "user-1" }));
			const res = await app.handler(
				makeRequest("PUT", "/subscribers/user-1/preferences", {
					channels: { email: false },
				}),
			);
			expect(res.status).toBe(201);
			const body = await json(res);
			expect(body.channels.email).toBe(false);
		});

		it("updates existing preferences", async () => {
			await app.handler(makeRequest("POST", "/subscribers", { externalId: "user-1" }));
			await app.handler(
				makeRequest("PUT", "/subscribers/user-1/preferences", {
					channels: { email: true },
				}),
			);
			const res = await app.handler(
				makeRequest("PUT", "/subscribers/user-1/preferences", {
					channels: { email: false, sms: true },
				}),
			);
			expect(res.status).toBe(200);
			const body = await json(res);
			expect(body.channels.email).toBe(false);
			expect(body.channels.sms).toBe(true);
		});

		it("returns 404 for unknown subscriber", async () => {
			const res = await app.handler(makeRequest("PUT", "/subscribers/unknown/preferences", { channels: {} }));
			expect(res.status).toBe(404);
		});
	});
});
