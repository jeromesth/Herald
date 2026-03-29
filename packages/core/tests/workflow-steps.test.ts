import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryWorkflowAdapter } from "../src/adapters/workflow/memory.js";
import { checkThrottle, performFetch, toMs } from "../src/core/workflow-runtime.js";
import type { HeraldContext } from "../src/types/config.js";
import type { NotificationWorkflow, StepResult } from "../src/types/workflow.js";

function makeThrottleCtx(): HeraldContext {
	return {
		throttleState: new Map(),
	} as unknown as HeraldContext;
}

describe("toMs", () => {
	it("converts seconds", () => {
		expect(toMs(5, "seconds")).toBe(5000);
	});

	it("converts minutes", () => {
		expect(toMs(2, "minutes")).toBe(120_000);
	});

	it("converts hours", () => {
		expect(toMs(1, "hours")).toBe(3_600_000);
	});

	it("converts days", () => {
		expect(toMs(1, "days")).toBe(86_400_000);
	});
});

describe("checkThrottle", () => {
	it("allows first request", () => {
		const ctx = makeThrottleCtx();
		const result = checkThrottle(ctx, { key: "k", limit: 3, window: 1, unit: "hours" });
		expect(result).toEqual({ throttled: false, count: 1, limit: 3 });
	});

	it("allows requests up to the limit", () => {
		const ctx = makeThrottleCtx();
		const config = { key: "k", limit: 3, window: 1, unit: "hours" as const };
		checkThrottle(ctx, config);
		checkThrottle(ctx, config);
		const third = checkThrottle(ctx, config);
		expect(third).toEqual({ throttled: false, count: 3, limit: 3 });
	});

	it("throttles after exceeding limit", () => {
		const ctx = makeThrottleCtx();
		const config = { key: "k", limit: 2, window: 1, unit: "hours" as const };
		checkThrottle(ctx, config);
		checkThrottle(ctx, config);
		const result = checkThrottle(ctx, config);
		expect(result.throttled).toBe(true);
		expect(result.count).toBe(3);
	});

	it("resets after window expires", () => {
		const ctx = makeThrottleCtx();
		const config = { key: "k", limit: 1, window: 1, unit: "seconds" as const };
		checkThrottle(ctx, config);

		// Simulate window expiration
		const state = ctx.throttleState.get("k");
		expect(state).toBeDefined();
		if (state) state.windowStart = Date.now() - 2000;

		const result = checkThrottle(ctx, config);
		expect(result.throttled).toBe(false);
		expect(result.count).toBe(1);
	});

	it("uses separate keys independently", () => {
		const ctx = makeThrottleCtx();
		const configA = { key: "a", limit: 1, window: 1, unit: "hours" as const };
		const configB = { key: "b", limit: 1, window: 1, unit: "hours" as const };
		checkThrottle(ctx, configA);
		checkThrottle(ctx, configA);
		const resultB = checkThrottle(ctx, configB);
		expect(resultB.throttled).toBe(false);
	});
});

describe("performFetch", () => {
	let fetchSpy: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchSpy = vi.fn();
		vi.stubGlobal("fetch", fetchSpy);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("makes a GET request by default", async () => {
		fetchSpy.mockResolvedValue({
			status: 200,
			json: async () => ({ ok: true }),
			headers: new Headers({ "content-type": "application/json" }),
		});

		const result = await performFetch({ url: "https://example.com/api" });
		expect(result.status).toBe(200);
		expect(result.data).toEqual({ ok: true });
		expect(fetchSpy).toHaveBeenCalledWith("https://example.com/api", expect.objectContaining({ method: "GET" }));
	});

	it("sends POST with body", async () => {
		fetchSpy.mockResolvedValue({
			status: 201,
			json: async () => ({ id: 1 }),
			headers: new Headers(),
		});

		await performFetch({
			url: "https://example.com/api",
			method: "POST",
			headers: { "content-type": "application/json" },
			body: { name: "test" },
		});

		expect(fetchSpy).toHaveBeenCalledWith(
			"https://example.com/api",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ name: "test" }),
				headers: { "content-type": "application/json" },
			}),
		);
	});

	it("returns null data when response is not JSON", async () => {
		fetchSpy.mockResolvedValue({
			status: 200,
			json: async () => {
				throw new Error("not json");
			},
			headers: new Headers(),
		});

		const result = await performFetch({ url: "https://example.com/text" });
		expect(result.data).toBeNull();
	});

	it("aborts request when timeout is exceeded", async () => {
		fetchSpy.mockImplementation(async (_url: string, opts: { signal: AbortSignal }) => {
			// Simulate a slow request that gets aborted
			return new Promise((_resolve, reject) => {
				opts.signal.addEventListener("abort", () => {
					reject(new DOMException("The operation was aborted.", "AbortError"));
				});
			});
		});

		await expect(performFetch({ url: "https://example.com/slow", timeout: 1 })).rejects.toThrow("aborted");
	});
});

describe("memory adapter — workflow steps", () => {
	describe("delay step", () => {
		it("executes delay handler and continues to subsequent steps", async () => {
			const stepsCalled: string[] = [];
			const workflow: NotificationWorkflow = {
				id: "delay-wf",
				name: "Delay Workflow",
				steps: [
					{
						stepId: "delay-1",
						type: "delay",
						handler: async ({ step }) => {
							await step.delay({ amount: 1, unit: "hours" });
							stepsCalled.push("delay-1");
							return { body: "delayed" };
						},
					},
					{
						stepId: "email-1",
						type: "email",
						handler: async () => {
							stepsCalled.push("email-1");
							return { subject: "Hi", body: "Hello" };
						},
					},
				],
			};

			const adapter = memoryWorkflowAdapter();
			adapter.registerWorkflow(workflow);
			await adapter.trigger({ workflowId: "delay-wf", to: "user-1", payload: {} });

			expect(stepsCalled).toEqual(["delay-1", "email-1"]);
		});
	});

	describe("digest step", () => {
		it("collects buffered events via addDigestEvent", async () => {
			let digestedEvents: unknown[] = [];
			const workflow: NotificationWorkflow = {
				id: "digest-wf",
				name: "Digest Workflow",
				steps: [
					{
						stepId: "digest-1",
						type: "digest",
						handler: async ({ step }) => {
							const events = await step.digest({ window: 5, unit: "minutes" });
							digestedEvents = events;
							return { body: `Got ${events.length} events` };
						},
					},
				],
			};

			const adapter = memoryWorkflowAdapter();
			adapter.registerWorkflow(workflow);

			// Buffer some events before triggering
			adapter.addDigestEvent("digest-wf:digest-1", {
				payload: { comment: "first" },
				timestamp: new Date(),
			});
			adapter.addDigestEvent("digest-wf:digest-1", {
				payload: { comment: "second" },
				timestamp: new Date(),
			});

			await adapter.trigger({ workflowId: "digest-wf", to: "user-1", payload: {} });

			expect(digestedEvents).toHaveLength(2);
			expect((digestedEvents[0] as { payload: { comment: string } }).payload.comment).toBe("first");
		});

		it("returns empty array when no events buffered", async () => {
			let digestedEvents: unknown[] = [];
			const workflow: NotificationWorkflow = {
				id: "digest-wf",
				name: "Digest Workflow",
				steps: [
					{
						stepId: "digest-1",
						type: "digest",
						handler: async ({ step }) => {
							digestedEvents = await step.digest({ window: 5, unit: "minutes" });
							return { body: "" };
						},
					},
				],
			};

			const adapter = memoryWorkflowAdapter();
			adapter.registerWorkflow(workflow);
			await adapter.trigger({ workflowId: "digest-wf", to: "user-1", payload: {} });

			expect(digestedEvents).toEqual([]);
		});
	});

	describe("throttle step", () => {
		it("allows requests within the limit", async () => {
			const ctx = makeThrottleCtx();
			const results: StepResult[] = [];

			const workflow: NotificationWorkflow = {
				id: "throttle-wf",
				name: "Throttle Workflow",
				steps: [
					{
						stepId: "throttle-1",
						type: "throttle",
						handler: async ({ step }) => {
							const r = await step.throttle({ key: "t", limit: 2, window: 1, unit: "hours" });
							if (r.throttled) {
								return { body: "throttled", _internal: { throttled: true } };
							}
							return { body: "ok" };
						},
					},
					{
						stepId: "email-1",
						type: "email",
						handler: async () => {
							return { subject: "Hi", body: "Hello" };
						},
					},
				],
			};

			const adapter = memoryWorkflowAdapter(ctx);
			adapter.registerWorkflow(workflow);

			// First trigger — should pass through
			await adapter.trigger({ workflowId: "throttle-wf", to: "user-1", payload: {} });
			// Second — still within limit
			await adapter.trigger({ workflowId: "throttle-wf", to: "user-1", payload: {} });

			// Both should have triggered (2 events)
			expect(adapter.events).toHaveLength(2);
		});

		it("breaks step loop when throttled", async () => {
			const ctx = makeThrottleCtx();
			const stepsCalled: string[] = [];

			const workflow: NotificationWorkflow = {
				id: "throttle-wf",
				name: "Throttle Workflow",
				steps: [
					{
						stepId: "throttle-1",
						type: "throttle",
						handler: async ({ step }) => {
							const r = await step.throttle({ key: "t", limit: 1, window: 1, unit: "hours" });
							stepsCalled.push("throttle-1");
							if (r.throttled) {
								return { body: "throttled", _internal: { throttled: true } };
							}
							return { body: "ok" };
						},
					},
					{
						stepId: "email-1",
						type: "email",
						handler: async () => {
							stepsCalled.push("email-1");
							return { subject: "Hi", body: "Hello" };
						},
					},
				],
			};

			const adapter = memoryWorkflowAdapter(ctx);
			adapter.registerWorkflow(workflow);

			await adapter.trigger({ workflowId: "throttle-wf", to: "user-1", payload: {} });
			stepsCalled.length = 0; // Reset

			await adapter.trigger({ workflowId: "throttle-wf", to: "user-1", payload: {} });

			// Second trigger: throttle step runs, but email step should be skipped
			expect(stepsCalled).toEqual(["throttle-1"]);
		});
	});

	describe("fetch step", () => {
		let fetchSpy: ReturnType<typeof vi.fn>;

		beforeEach(() => {
			fetchSpy = vi.fn();
			vi.stubGlobal("fetch", fetchSpy);
		});

		afterEach(() => {
			vi.restoreAllMocks();
		});

		it("makes a fetch request and provides result data", async () => {
			fetchSpy.mockResolvedValue({
				status: 200,
				json: async () => ({ userName: "Alice" }),
				headers: new Headers(),
			});

			let fetchResult: unknown;
			const workflow: NotificationWorkflow = {
				id: "fetch-wf",
				name: "Fetch Workflow",
				steps: [
					{
						stepId: "fetch-1",
						type: "fetch",
						handler: async ({ step }) => {
							const result = await step.fetch({ url: "https://api.example.com/user/1" });
							fetchResult = result;
							return { body: "", _internal: { fetchResult: result.data } };
						},
					},
				],
			};

			const adapter = memoryWorkflowAdapter();
			adapter.registerWorkflow(workflow);
			await adapter.trigger({ workflowId: "fetch-wf", to: "user-1", payload: {} });

			expect(fetchSpy).toHaveBeenCalled();
			expect(fetchResult).toMatchObject({ status: 200, data: { userName: "Alice" } });
		});

		it("merges fetch result into payload for subsequent steps", async () => {
			fetchSpy.mockResolvedValue({
				status: 200,
				json: async () => ({ userName: "Alice" }),
				headers: new Headers(),
			});

			let receivedPayload: Record<string, unknown> = {};
			const workflow: NotificationWorkflow = {
				id: "fetch-merge-wf",
				name: "Fetch Merge Workflow",
				steps: [
					{
						stepId: "fetch-1",
						type: "fetch",
						handler: async ({ step }) => {
							const result = await step.fetch({ url: "https://api.example.com/user/1" });
							return { body: "", _internal: { fetchResult: result.data } };
						},
					},
					{
						stepId: "email-1",
						type: "email",
						handler: async ({ payload }) => {
							receivedPayload = payload;
							return { subject: "Hi", body: "Hello" };
						},
					},
				],
			};

			const adapter = memoryWorkflowAdapter();
			adapter.registerWorkflow(workflow);
			await adapter.trigger({
				workflowId: "fetch-merge-wf",
				to: "user-1",
				payload: { existing: true },
			});

			expect(receivedPayload.existing).toBe(true);
			expect(receivedPayload.userName).toBe("Alice");
		});
	});

	describe("integration: multi-step workflow", () => {
		let fetchSpy: ReturnType<typeof vi.fn>;

		beforeEach(() => {
			fetchSpy = vi.fn();
			vi.stubGlobal("fetch", fetchSpy);
		});

		afterEach(() => {
			vi.restoreAllMocks();
		});

		it("executes delay → fetch → email pipeline", async () => {
			fetchSpy.mockResolvedValue({
				status: 200,
				json: async () => ({ templateId: "welcome" }),
				headers: new Headers(),
			});

			const stepsCalled: string[] = [];
			const workflow: NotificationWorkflow = {
				id: "multi-wf",
				name: "Multi-Step",
				steps: [
					{
						stepId: "delay-1",
						type: "delay",
						handler: async ({ step }) => {
							await step.delay({ amount: 30, unit: "minutes" });
							stepsCalled.push("delay-1");
							return { body: "" };
						},
					},
					{
						stepId: "fetch-1",
						type: "fetch",
						handler: async ({ step }) => {
							const result = await step.fetch({ url: "https://api.example.com/template" });
							stepsCalled.push("fetch-1");
							return { body: "", _internal: { fetchResult: result.data } };
						},
					},
					{
						stepId: "email-1",
						type: "email",
						handler: async ({ payload }) => {
							stepsCalled.push("email-1");
							return { subject: "Welcome", body: `Template: ${payload.templateId}` };
						},
					},
				],
			};

			const adapter = memoryWorkflowAdapter();
			adapter.registerWorkflow(workflow);
			await adapter.trigger({ workflowId: "multi-wf", to: "user-1", payload: {} });

			expect(stepsCalled).toEqual(["delay-1", "fetch-1", "email-1"]);
		});
	});
});
