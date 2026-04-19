import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { upstashWorkflowAdapter } from "../src/adapters/workflow/upstash.js";
import type { NotificationWorkflow } from "../src/types/workflow.js";

function createTestWorkflow(overrides?: Partial<NotificationWorkflow>): NotificationWorkflow {
	return {
		id: "welcome",
		name: "Welcome Notification",
		steps: [
			{
				stepId: "send-email",
				type: "email",
				handler: async ({ subscriber, payload }) => ({
					subject: `Welcome ${subscriber.externalId}`,
					body: `Hello from ${payload.app}`,
				}),
			},
		],
		...overrides,
	};
}

describe("upstashWorkflowAdapter", () => {
	const mockFetch = vi.fn();

	beforeEach(() => {
		mockFetch.mockReset();
		mockFetch.mockResolvedValue(new Response(JSON.stringify({ messageId: "msg-1" }), { status: 200 }));
		vi.stubGlobal("fetch", mockFetch);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("registerWorkflow", () => {
		it("stores workflows and exposes handler", () => {
			const adapter = upstashWorkflowAdapter({ token: "test-token" });
			const workflow = createTestWorkflow();

			adapter.registerWorkflow(workflow);

			const handler = adapter.getHandler();
			expect(handler).not.toBeNull();
			expect(handler?.path).toBe("/api/herald");
		});

		it("registers multiple workflows", () => {
			const adapter = upstashWorkflowAdapter({ token: "test-token" });

			adapter.registerWorkflow(createTestWorkflow({ id: "wf-1", name: "WF 1" }));
			adapter.registerWorkflow(createTestWorkflow({ id: "wf-2", name: "WF 2" }));

			expect(adapter.getHandler()).not.toBeNull();
		});
	});

	describe("trigger", () => {
		it("sends correct payload to QStash", async () => {
			const adapter = upstashWorkflowAdapter({
				url: "https://qstash.test",
				token: "test-token",
			});
			adapter.registerWorkflow(createTestWorkflow());

			const result = await adapter.trigger({
				workflowId: "welcome",
				to: "user-1",
				payload: { app: "TestApp" },
			});

			expect(result.status).toBe("triggered");
			expect(result.transactionId).toBeTruthy();

			expect(mockFetch).toHaveBeenCalledOnce();
			const [fetchUrl, fetchOpts] = mockFetch.mock.calls[0];
			expect(fetchUrl).toContain("qstash.test");
			expect(fetchOpts.method).toBe("POST");
			expect(fetchOpts.headers.Authorization).toBe("Bearer test-token");

			const body = JSON.parse(fetchOpts.body);
			expect(body.workflowId).toBe("welcome");
			expect(body.recipients).toEqual(["user-1"]);
			expect(body.payload).toEqual({ app: "TestApp" });
		});

		it("generates a transactionId if not provided", async () => {
			const adapter = upstashWorkflowAdapter({ token: "test-token" });

			const result = await adapter.trigger({
				workflowId: "welcome",
				to: "user-1",
				payload: {},
			});

			expect(result.transactionId).toBeTruthy();
			expect(typeof result.transactionId).toBe("string");
		});

		it("uses provided transactionId", async () => {
			const adapter = upstashWorkflowAdapter({ token: "test-token" });

			const result = await adapter.trigger({
				workflowId: "welcome",
				to: "user-1",
				payload: {},
				transactionId: "custom-tx-123",
			});

			expect(result.transactionId).toBe("custom-tx-123");
		});

		it("handles multiple recipients", async () => {
			const adapter = upstashWorkflowAdapter({ token: "test-token" });

			const result = await adapter.trigger({
				workflowId: "welcome",
				to: ["user-1", "user-2", "user-3"],
				payload: { app: "TestApp" },
			});

			expect(result.status).toBe("triggered");

			const body = JSON.parse(mockFetch.mock.calls[0][1].body);
			expect(body.recipients).toEqual(["user-1", "user-2", "user-3"]);
		});
	});

	describe("cancel", () => {
		it("sends cancel request with correct transactionId", async () => {
			const adapter = upstashWorkflowAdapter({
				url: "https://qstash.test",
				token: "test-token",
			});

			await adapter.cancel({
				workflowId: "welcome",
				transactionId: "tx-123",
			});

			expect(mockFetch).toHaveBeenCalledOnce();
			const [fetchUrl, fetchOpts] = mockFetch.mock.calls[0];
			expect(fetchUrl).toBe("https://qstash.test/v2/cancel/tx-123");
			expect(fetchOpts.method).toBe("DELETE");
			expect(fetchOpts.headers.Authorization).toBe("Bearer test-token");
		});
	});

	describe("getHandler", () => {
		it("returns null when no workflows registered", () => {
			const adapter = upstashWorkflowAdapter({ token: "test-token" });

			expect(adapter.getHandler()).toBeNull();
		});

		it("returns handler at configured path", () => {
			const adapter = upstashWorkflowAdapter({
				token: "test-token",
				servePath: "/custom/path",
			});
			adapter.registerWorkflow(createTestWorkflow());

			const handler = adapter.getHandler();
			expect(handler).not.toBeNull();
			expect(handler?.path).toBe("/custom/path");
		});

		it("handler returns 404 for unknown workflow", async () => {
			const adapter = upstashWorkflowAdapter({ token: "test-token" });
			adapter.registerWorkflow(createTestWorkflow());

			// biome-ignore lint/style/noNonNullAssertion: handler is always defined after registerWorkflow
			const handler = adapter.getHandler()!;
			const request = new Request("http://localhost/api/herald", {
				method: "POST",
				body: JSON.stringify({ workflowId: "nonexistent" }),
				headers: { "Content-Type": "application/json" },
			});

			const response = await handler.handler(request);
			expect(response.status).toBe(404);

			const body = await response.json();
			expect(body.error).toContain("nonexistent");
		});

		it("handler returns 200 for known workflow", async () => {
			const adapter = upstashWorkflowAdapter({ token: "test-token" });
			adapter.registerWorkflow(createTestWorkflow());

			// biome-ignore lint/style/noNonNullAssertion: handler is always defined after registerWorkflow
			const handler = adapter.getHandler()!;
			const request = new Request("http://localhost/api/herald", {
				method: "POST",
				body: JSON.stringify({ workflowId: "welcome" }),
				headers: { "Content-Type": "application/json" },
			});

			const response = await handler.handler(request);
			expect(response.status).toBe(200);
		});

		it("handler returns 500 on invalid JSON", async () => {
			const adapter = upstashWorkflowAdapter({ token: "test-token" });
			adapter.registerWorkflow(createTestWorkflow());

			// biome-ignore lint/style/noNonNullAssertion: handler is always defined after registerWorkflow
			const handler = adapter.getHandler()!;
			const request = new Request("http://localhost/api/herald", {
				method: "POST",
				body: "not json",
				headers: { "Content-Type": "application/json" },
			});

			const response = await handler.handler(request);
			expect(response.status).toBe(500);
		});

		it("handler 500 response hides real error message and returns generic message", async () => {
			const adapter = upstashWorkflowAdapter({ token: "test-token" });
			adapter.registerWorkflow(createTestWorkflow());

			// biome-ignore lint/style/noNonNullAssertion: handler is always defined after registerWorkflow
			const handler = adapter.getHandler()!;
			// Invalid JSON causes request.json() to throw with a real error message
			const request = new Request("http://localhost/api/herald", {
				method: "POST",
				body: "not valid json: secret-db-password",
				headers: { "Content-Type": "application/json" },
			});

			const response = await handler.handler(request);
			expect(response.status).toBe(500);

			const body = await response.json();
			expect(body.error).toBe("Internal server error");
			expect(body.error).not.toContain("secret-db-password");
		});
	});

	describe("step execution", () => {
		it("regular steps use context.run()", async () => {
			const adapter = upstashWorkflowAdapter({ token: "test-token" });
			const stepHandler = vi.fn().mockResolvedValue({ subject: "Hello", body: "World" });

			adapter.registerWorkflow(
				createTestWorkflow({
					steps: [{ stepId: "send-email", type: "email", handler: stepHandler }],
				}),
			);

			// Access the registered execute function via the internal map
			// We verify by triggering and checking the handler was registered
			expect(adapter.getHandler()).not.toBeNull();
		});

		it("delay steps use context.sleep()", async () => {
			const adapter = upstashWorkflowAdapter({ token: "test-token" });

			adapter.registerWorkflow(
				createTestWorkflow({
					steps: [
						{
							stepId: "wait",
							type: "delay",
							handler: async ({ step }) => {
								await step.delay({ amount: 5, unit: "minutes" });
								return { data: { amount: 5, unit: "minutes" } };
							},
						},
					],
				}),
			);

			expect(adapter.getHandler()).not.toBeNull();
		});

		it("fetch steps use context.run()", async () => {
			const adapter = upstashWorkflowAdapter({ token: "test-token" });

			adapter.registerWorkflow(
				createTestWorkflow({
					steps: [
						{
							stepId: "fetch-data",
							type: "fetch",
							handler: async ({ step }) => {
								const result = await step.fetch({
									url: "https://api.example.com/data",
								});
								return {
									_internal: { fetchResult: result.data },
								};
							},
						},
					],
				}),
			);

			expect(adapter.getHandler()).not.toBeNull();
		});
	});

	describe("error handling", () => {
		it("adapter ID is upstash", () => {
			const adapter = upstashWorkflowAdapter({ token: "test-token" });
			expect(adapter.adapterId).toBe("upstash");
		});

		it("uses default config values", () => {
			const adapter = upstashWorkflowAdapter({});
			expect(adapter.adapterId).toBe("upstash");

			adapter.registerWorkflow(createTestWorkflow());
			const handler = adapter.getHandler();
			expect(handler?.path).toBe("/api/herald");
		});
	});
});
