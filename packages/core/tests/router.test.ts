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
			handler: async () => ({
				body: "Test message",
			}),
		},
	],
};

describe("HTTP Router", () => {
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

	describe("POST /trigger", () => {
		it("triggers a workflow", async () => {
			const res = await app.handler(
				makeRequest("POST", "/trigger", {
					workflowId: "test-notif",
					to: "user-1",
					payload: { key: "value" },
				}),
			);

			expect(res.status).toBe(200);
			const body = await json(res);
			expect(body.transactionId).toBeDefined();
			expect(body.status).toBe("triggered");
		});

		it("returns 400 when workflowId is missing", async () => {
			const res = await app.handler(makeRequest("POST", "/trigger", { to: "user-1" }));

			expect(res.status).toBe(400);
		});

		it("returns 400 for invalid JSON body", async () => {
			const req = new Request(`${origin}${basePath}/trigger`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: "{invalid",
			});

			const res = await app.handler(req);
			expect(res.status).toBe(400);
		});
	});

	describe("POST /subscribers", () => {
		it("creates a subscriber", async () => {
			const res = await app.handler(
				makeRequest("POST", "/subscribers", {
					externalId: "user-1",
					email: "alice@example.com",
					firstName: "Alice",
				}),
			);

			expect(res.status).toBe(201);
			const body = await json(res);
			expect(body.externalId).toBe("user-1");
			expect(body.email).toBe("alice@example.com");
		});

		it("returns 400 when externalId is missing", async () => {
			const res = await app.handler(makeRequest("POST", "/subscribers", { email: "test@example.com" }));

			expect(res.status).toBe(400);
		});
	});

	describe("GET /subscribers/:id", () => {
		it("retrieves a subscriber", async () => {
			await app.handler(
				makeRequest("POST", "/subscribers", {
					externalId: "user-1",
					email: "alice@example.com",
				}),
			);

			const res = await app.handler(makeRequest("GET", "/subscribers/user-1"));

			expect(res.status).toBe(200);
			const body = await json(res);
			expect(body.email).toBe("alice@example.com");
		});

		it("returns 404 for unknown subscriber", async () => {
			const res = await app.handler(makeRequest("GET", "/subscribers/unknown"));
			expect(res.status).toBe(404);
		});
	});

	describe("DELETE /subscribers/:id", () => {
		it("deletes a subscriber", async () => {
			await app.handler(
				makeRequest("POST", "/subscribers", {
					externalId: "user-1",
					email: "alice@example.com",
				}),
			);

			const res = await app.handler(makeRequest("DELETE", "/subscribers/user-1"));
			expect(res.status).toBe(200);

			const check = await app.handler(makeRequest("GET", "/subscribers/user-1"));
			expect(check.status).toBe(404);
		});
	});

	describe("POST /topics", () => {
		it("creates a topic", async () => {
			const res = await app.handler(
				makeRequest("POST", "/topics", {
					key: "project:abc",
					name: "Project ABC",
				}),
			);

			expect(res.status).toBe(201);
			const body = await json(res);
			expect(body.key).toBe("project:abc");
		});

		it("returns 409 for duplicate topic", async () => {
			await app.handler(makeRequest("POST", "/topics", { key: "project:abc", name: "ABC" }));

			const res = await app.handler(makeRequest("POST", "/topics", { key: "project:abc", name: "ABC" }));

			expect(res.status).toBe(409);
		});
	});

	describe("POST /notifications/mark", () => {
		it("marks notifications", async () => {
			// Create subscriber and notification
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

			const res = await app.handler(
				makeRequest("POST", "/notifications/mark", {
					ids: [notifId],
					action: "read",
				}),
			);

			expect(res.status).toBe(200);
		});
	});

	describe("404 for unknown routes", () => {
		it("returns 404 for unmatched routes", async () => {
			const res = await app.handler(makeRequest("GET", "/nonexistent"));
			expect(res.status).toBe(404);
		});
	});
});
