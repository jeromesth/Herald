import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryAdapter } from "../src/adapters/database/memory.js";
import { memoryWorkflowAdapter } from "../src/adapters/workflow/memory.js";
import { herald } from "../src/core/herald.js";
import type { Herald, HeraldPlugin, NotificationWorkflow } from "../src/types/index.js";

const testWorkflow: NotificationWorkflow = {
	id: "test-notif",
	name: "Test",
	steps: [{ stepId: "send-in-app", type: "in_app", handler: async () => ({ body: "Test" }) }],
};

describe("Router — branch coverage", () => {
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

	describe("plugin endpoints", () => {
		it("registers and routes to plugin endpoints", async () => {
			const plugin: HeraldPlugin = {
				id: "test-plugin",
				endpoints: {
					status: {
						method: "GET",
						path: "/plugin/status",
						handler: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
					},
				},
			};

			const app = herald({
				database: memoryAdapter(),
				workflow: memoryWorkflowAdapter(),
				workflows: [testWorkflow],
				plugins: [plugin],
			});

			const res = await app.handler(makeRequest("GET", "/plugin/status"));
			expect(res.status).toBe(200);
			const body = await json(res);
			expect(body.ok).toBe(true);
		});
	});

	describe("error handling", () => {
		it("returns 500 for unhandled route errors", async () => {
			const failingWorkflow: NotificationWorkflow = {
				id: "failing",
				name: "Failing",
				steps: [
					{
						stepId: "fail",
						type: "in_app",
						handler: async () => {
							throw new Error("unexpected");
						},
					},
				],
			};

			const plugin: HeraldPlugin = {
				id: "error-plugin",
				endpoints: {
					crash: {
						method: "POST",
						path: "/crash",
						handler: async () => {
							throw new Error("boom");
						},
					},
				},
			};

			const app = herald({
				database: memoryAdapter(),
				workflow: memoryWorkflowAdapter(),
				workflows: [failingWorkflow],
				plugins: [plugin],
			});

			const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
			const res = await app.handler(makeRequest("POST", "/crash"));
			expect(res.status).toBe(500);
			const body = await json(res);
			expect(body.error).toBe("Internal server error");
			consoleSpy.mockRestore();
		});

		it("returns 404 for unknown routes", async () => {
			const app = herald({
				database: memoryAdapter(),
				workflow: memoryWorkflowAdapter(),
				workflows: [testWorkflow],
			});

			const res = await app.handler(makeRequest("GET", "/nonexistent/path"));
			expect(res.status).toBe(404);
		});

		it("handles HTTPError thrown from routes (invalid JSON body)", async () => {
			const app = herald({
				database: memoryAdapter(),
				workflow: memoryWorkflowAdapter(),
				workflows: [testWorkflow],
			});

			const req = new Request(`${origin}${basePath}/trigger`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: "not valid json",
			});

			const res = await app.handler(req);
			expect(res.status).toBe(400);
			const body = await json(res);
			expect(body.error).toContain("Invalid JSON");
		});
	});

	describe("subscriber upsert with various field types", () => {
		it("filters out non-string fields for email/phone/etc", async () => {
			const app = herald({
				database: memoryAdapter(),
				workflow: memoryWorkflowAdapter(),
				workflows: [testWorkflow],
			});

			const res = await app.handler(
				makeRequest("POST", "/subscribers", {
					externalId: "user-fields",
					email: 12345,
					phone: true,
					firstName: null,
					lastName: "Smith",
					data: { key: "value" },
				}),
			);

			expect([200, 201]).toContain(res.status);
			const body = await json(res);
			expect(body.lastName).toBe("Smith");
			// non-string values should be filtered out
			expect(body.email).toBeUndefined();
			expect(body.phone).toBeUndefined();
		});

		it("ignores data when it is not an object", async () => {
			const app = herald({
				database: memoryAdapter(),
				workflow: memoryWorkflowAdapter(),
				workflows: [testWorkflow],
			});

			const res = await app.handler(
				makeRequest("POST", "/subscribers", {
					externalId: "user-bad-data",
					data: "not-an-object",
				}),
			);

			expect([200, 201]).toContain(res.status);
		});

		it("ignores data when it is an array", async () => {
			const app = herald({
				database: memoryAdapter(),
				workflow: memoryWorkflowAdapter(),
				workflows: [testWorkflow],
			});

			const res = await app.handler(
				makeRequest("POST", "/subscribers", {
					externalId: "user-array-data",
					data: [1, 2, 3],
				}),
			);

			expect([200, 201]).toContain(res.status);
		});
	});

	describe("preferences with defaults", () => {
		it("merges default preferences when creating new preferences", async () => {
			const app = herald({
				database: memoryAdapter(),
				workflow: memoryWorkflowAdapter(),
				workflows: [testWorkflow],
				defaultPreferences: {
					channels: { email: true, sms: false },
					workflows: { "test-notif": { enabled: true } },
					purposes: { marketing: false },
				},
			});

			await app.api.upsertSubscriber({ externalId: "user-pref" });

			const res = await app.handler(
				makeRequest("PUT", "/subscribers/user-pref/preferences", {
					channels: { push: true },
				}),
			);

			expect(res.status).toBe(201);
			const body = await json(res);
			expect(body.channels.email).toBe(true);
			expect(body.channels.push).toBe(true);
			expect(body.purposes.marketing).toBe(false);
		});
	});
});
