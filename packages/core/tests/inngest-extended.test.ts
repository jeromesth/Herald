import { describe, expect, it, vi } from "vitest";
import { getInngestFunctions, inngestAdapter } from "../src/adapters/workflow/inngest.js";
import type { NotificationWorkflow } from "../src/types/workflow.js";

function createMockInngestClient() {
	return {
		id: "test-app",
		send: vi.fn().mockResolvedValue(undefined),
		createFunction: vi.fn().mockReturnValue({ id: "mock-fn" }),
	};
}

const testWorkflow: NotificationWorkflow = {
	id: "welcome",
	name: "Welcome",
	steps: [{ stepId: "send-email", type: "email", handler: async () => ({ subject: "Hi", body: "Hello" }) }],
};

const digestWorkflow: NotificationWorkflow = {
	id: "digest-test",
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
		{ stepId: "send-email", type: "email", handler: async () => ({ subject: "Digest", body: "Summary" }) },
	],
};

describe("inngestAdapter — extended", () => {
	it("registers workflows and creates Inngest functions", () => {
		const client = createMockInngestClient();
		const adapter = inngestAdapter({ client });

		adapter.registerWorkflow(testWorkflow);
		expect(client.createFunction).toHaveBeenCalledOnce();

		const [config, trigger] = client.createFunction.mock.calls[0];
		expect(config.id).toBe("herald-welcome");
		expect(config.name).toBe("Welcome");
		expect(trigger.event).toBe("herald/workflow.welcome");
	});

	it("trigger sends events via Inngest client", async () => {
		const client = createMockInngestClient();
		const adapter = inngestAdapter({ client });
		adapter.registerWorkflow(testWorkflow);

		const result = await adapter.trigger({
			workflowId: "welcome",
			to: "user-1",
			payload: { key: "val" },
		});

		expect(result.status).toBe("triggered");
		expect(result.transactionId).toBeTruthy();
		expect(client.send).toHaveBeenCalledOnce();
	});

	it("trigger sends multiple events for digest workflows", async () => {
		const client = createMockInngestClient();
		const adapter = inngestAdapter({ client });
		adapter.registerWorkflow(digestWorkflow);

		await adapter.trigger({
			workflowId: "digest-test",
			to: ["user-1", "user-2"],
			payload: { data: "test" },
		});

		const sentEvents = client.send.mock.calls[0][0];
		// 1 workflow event + 2 digest events (one per recipient)
		expect(sentEvents).toHaveLength(3);
	});

	it("trigger uses custom transactionId", async () => {
		const client = createMockInngestClient();
		const adapter = inngestAdapter({ client });
		adapter.registerWorkflow(testWorkflow);

		const result = await adapter.trigger({
			workflowId: "welcome",
			to: "user-1",
			payload: {},
			transactionId: "custom-tx",
		});

		expect(result.transactionId).toBe("custom-tx");
	});

	it("trigger supports actor, tenant, and overrides", async () => {
		const client = createMockInngestClient();
		const adapter = inngestAdapter({ client });
		adapter.registerWorkflow(testWorkflow);

		await adapter.trigger({
			workflowId: "welcome",
			to: "user-1",
			payload: {},
			actor: "admin",
			tenant: "org-1",
			overrides: { priority: "high" },
		});

		const sentEvents = client.send.mock.calls[0][0];
		expect(sentEvents[0].data.actor).toBe("admin");
		expect(sentEvents[0].data.tenant).toBe("org-1");
		expect(sentEvents[0].data.overrides).toEqual({ priority: "high" });
	});

	it("cancel sends cancel event", async () => {
		const client = createMockInngestClient();
		const adapter = inngestAdapter({ client });

		await adapter.cancel({
			workflowId: "welcome",
			transactionId: "tx-123",
		});

		expect(client.send).toHaveBeenCalledOnce();
		const event = client.send.mock.calls[0][0];
		expect(event.name).toBe("herald/workflow.cancel");
		expect(event.data.transactionId).toBe("tx-123");
	});

	it("getHandler returns null when serve is not provided", () => {
		const client = createMockInngestClient();
		const adapter = inngestAdapter({ client });
		expect(adapter.getHandler()).toBeNull();
	});

	it("getHandler returns handler when serve is provided", () => {
		const client = createMockInngestClient();
		const mockServe = vi.fn().mockReturnValue({
			GET: vi.fn(),
			POST: vi.fn(),
			PUT: vi.fn(),
		});

		const adapter = inngestAdapter({ client, serve: mockServe });
		adapter.registerWorkflow(testWorkflow);

		const handler = adapter.getHandler();
		expect(handler).not.toBeNull();
		expect(handler?.path).toBe("/api/inngest");
	});

	it("getHandler routes requests by method", async () => {
		const client = createMockInngestClient();
		const mockGet = vi.fn().mockResolvedValue(new Response("ok"));
		const mockPost = vi.fn().mockResolvedValue(new Response("ok"));
		const mockPut = vi.fn().mockResolvedValue(new Response("ok"));
		const mockServe = vi.fn().mockReturnValue({
			GET: mockGet,
			POST: mockPost,
			PUT: mockPut,
		});

		const adapter = inngestAdapter({ client, serve: mockServe });
		adapter.registerWorkflow(testWorkflow);

		const handler = adapter.getHandler();

		await handler?.handler(new Request("https://test.com/api/inngest", { method: "GET" }));
		expect(mockGet).toHaveBeenCalledOnce();

		await handler?.handler(new Request("https://test.com/api/inngest", { method: "POST" }));
		expect(mockPost).toHaveBeenCalledOnce();

		await handler?.handler(new Request("https://test.com/api/inngest", { method: "PUT" }));
		expect(mockPut).toHaveBeenCalledOnce();
	});

	it("uses custom eventPrefix and servePath", () => {
		const client = createMockInngestClient();
		const adapter = inngestAdapter({
			client,
			eventPrefix: "myapp",
			servePath: "/webhooks/inngest",
		});

		adapter.registerWorkflow(testWorkflow);

		const [config, trigger] = client.createFunction.mock.calls[0];
		expect(config.id).toBe("myapp-welcome");
		expect(trigger.event).toBe("myapp/workflow.welcome");
	});

	it("adapterId is inngest", () => {
		const client = createMockInngestClient();
		const adapter = inngestAdapter({ client });
		expect(adapter.adapterId).toBe("inngest");
	});

	it("threads transactionId into step handler payload as _transactionId", async () => {
		const client = createMockInngestClient();
		const adapter = inngestAdapter({ client });

		let capturedPayload: Record<string, unknown> | undefined;

		const captureWorkflow: NotificationWorkflow = {
			id: "capture",
			name: "Capture",
			steps: [
				{
					stepId: "send-email",
					type: "email",
					handler: async ({ payload }) => {
						capturedPayload = payload;
						return { subject: "Hi", body: "Hello" };
					},
				},
			],
		};

		adapter.registerWorkflow(captureWorkflow);

		const handlerFn = client.createFunction.mock.calls[0][2];
		const mockStep = {
			run: vi.fn().mockImplementation(async (_id: string, fn: () => Promise<unknown>) => fn()),
			sleep: vi.fn().mockResolvedValue(undefined),
			sleepUntil: vi.fn().mockResolvedValue(undefined),
			sendEvent: vi.fn().mockResolvedValue(undefined),
			waitForEvent: vi.fn().mockResolvedValue(null),
		};

		await handlerFn({
			event: {
				name: "herald/workflow.capture",
				data: {
					workflowId: "capture",
					recipients: ["user-1"],
					payload: { greeting: "hi" },
					transactionId: "tx-abc-123",
				},
			},
			step: mockStep,
			runId: "run-1",
		});

		expect(capturedPayload).toBeDefined();
		expect(capturedPayload?._transactionId).toBe("tx-abc-123");
		// User payload must be preserved alongside the system-injected transactionId
		expect(capturedPayload?.greeting).toBe("hi");
	});

	it("executes workflow handler with all step types", async () => {
		const client = createMockInngestClient();
		const adapter = inngestAdapter({ client });

		const delayWorkflow: NotificationWorkflow = {
			id: "multi-step",
			name: "Multi Step",
			steps: [
				{
					stepId: "delay-step",
					type: "delay",
					handler: async ({ step }) => {
						await step.delay({ amount: 1, unit: "hours" });
						return { data: { amount: 1, unit: "hours" } };
					},
				},
				{
					stepId: "throttle-step",
					type: "throttle",
					handler: async ({ step }) => {
						const result = await step.throttle({ key: "k", limit: 10, window: 1, unit: "hours" });
						return { _internal: { throttled: result.throttled } };
					},
				},
				{
					stepId: "fetch-step",
					type: "fetch",
					handler: async ({ step }) => {
						await step.fetch({ url: "https://api.test/data" });
						return { _internal: { fetchResult: { apiData: true } } };
					},
				},
				{
					stepId: "send-email",
					type: "email",
					handler: async () => ({ subject: "Hi", body: "Hello" }),
				},
			],
		};

		adapter.registerWorkflow(delayWorkflow);

		// Get the handler function that was passed to createFunction
		const handlerFn = client.createFunction.mock.calls[0][2];

		const mockStep = {
			run: vi.fn().mockImplementation(async (_id: string, fn: () => Promise<unknown>) => fn()),
			sleep: vi.fn().mockResolvedValue(undefined),
			sleepUntil: vi.fn().mockResolvedValue(undefined),
			sendEvent: vi.fn().mockResolvedValue(undefined),
			waitForEvent: vi.fn().mockResolvedValue(null),
		};

		const result = await handlerFn({
			event: {
				name: "herald/workflow.multi-step",
				data: {
					workflowId: "multi-step",
					recipients: ["user-1"],
					payload: {},
					transactionId: "tx-1",
				},
			},
			step: mockStep,
			runId: "run-1",
		});

		expect(result).toEqual({ status: "completed", workflowId: "multi-step" });
		expect(mockStep.sleep).toHaveBeenCalled();
	});
});

describe("getInngestFunctions", () => {
	it("returns registered functions", () => {
		const client = createMockInngestClient();
		const adapter = inngestAdapter({ client });
		adapter.registerWorkflow(testWorkflow);

		const fns = getInngestFunctions(adapter);
		expect(fns).toHaveLength(1);
	});

	it("throws for non-inngest adapter", () => {
		const adapter = { adapterId: "other" };
		expect(() => getInngestFunctions(adapter as never)).toThrow("Inngest adapter");
	});
});
