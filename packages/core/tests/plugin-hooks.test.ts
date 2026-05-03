import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryAdapter } from "../src/adapters/database/memory.js";
import { memoryWorkflowAdapter } from "../src/adapters/workflow/memory.js";
import type { ChannelProvider, ChannelProviderMessage, ChannelProviderResult } from "../src/channels/provider.js";
import { herald } from "../src/core/herald.js";
import type { ActivityEventInput, ActivityEventType } from "../src/types/activity.js";
import type { Herald, HeraldPlugin, NotificationWorkflow } from "../src/types/index.js";

const inAppWorkflow: NotificationWorkflow = {
	id: "welcome",
	name: "Welcome",
	steps: [{ stepId: "send-in-app", type: "in_app", handler: async () => ({ body: "Hello" }) }],
};

const noopWorkflow: NotificationWorkflow = {
	id: "noop",
	name: "Noop",
	steps: [{ stepId: "compute", type: "delay", handler: async () => ({ body: "" }) }],
};

const failingProvider: ChannelProvider = {
	providerId: "failing-email",
	channelType: "email",
	async send(_message: ChannelProviderMessage): Promise<ChannelProviderResult> {
		return { messageId: "msg-fail-1", status: "failed", error: "SMTP refused" };
	},
};

const failingEmailWorkflow: NotificationWorkflow = {
	id: "fail-email",
	name: "Failing Email",
	steps: [{ stepId: "send-email", type: "email", handler: async () => ({ subject: "Hi", body: "Hello" }) }],
};

describe("Plugin hooks — onEvent / onStepStart / onStepComplete / onSendFailure", () => {
	let app: Herald;

	describe("onEvent", () => {
		it("fires for every lifecycle event in a successful in-app delivery", async () => {
			const onEvent = vi.fn();
			const plugin: HeraldPlugin = { id: "obs", hooks: { onEvent } };

			app = herald({
				database: memoryAdapter(),
				workflow: memoryWorkflowAdapter(),
				workflows: [inAppWorkflow],
				plugins: [plugin],
			});

			await app.api.upsertSubscriber({ externalId: "user-1", email: "u@test.com" });
			await app.api.trigger({ workflowId: "welcome", to: "user-1", payload: {} });

			const events = onEvent.mock.calls.map((c) => (c[0] as ActivityEventInput).event);
			expect(events).toContain("workflow.triggered");
			expect(events).toContain("workflow.dispatched");
			expect(events).toContain("workflow.step.started");
			expect(events).toContain("workflow.step.completed");
			expect(events).toContain("notification.queued");
			expect(events).toContain("notification.sent");
		});

		it("fires independently of activity log being enabled", async () => {
			const onEvent = vi.fn();
			const plugin: HeraldPlugin = { id: "obs", hooks: { onEvent } };

			app = herald({
				database: memoryAdapter(),
				workflow: memoryWorkflowAdapter(),
				workflows: [inAppWorkflow],
				plugins: [plugin],
				// activityLog intentionally omitted
			});

			await app.api.upsertSubscriber({ externalId: "user-1", email: "u@test.com" });
			await app.api.trigger({ workflowId: "welcome", to: "user-1", payload: {} });

			expect(onEvent).toHaveBeenCalled();
		});

		it("forwards the full ActivityEventInput shape", async () => {
			const onEvent = vi.fn<(event: ActivityEventInput) => Promise<void>>();
			const plugin: HeraldPlugin = { id: "obs", hooks: { onEvent } };

			app = herald({
				database: memoryAdapter(),
				workflow: memoryWorkflowAdapter(),
				workflows: [inAppWorkflow],
				plugins: [plugin],
			});

			await app.api.upsertSubscriber({ externalId: "user-1", email: "u@test.com" });
			const { transactionId } = await app.api.trigger({ workflowId: "welcome", to: "user-1", payload: { foo: "bar" } });

			const triggered = onEvent.mock.calls.find((c) => c[0].event === "workflow.triggered")?.[0];
			expect(triggered).toBeDefined();
			expect(triggered?.workflowId).toBe("welcome");
			expect(triggered?.transactionId).toBe(transactionId);
		});

		it("does not break delivery when an onEvent hook throws", async () => {
			const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
			const onEvent = vi.fn().mockRejectedValue(new Error("boom"));
			const plugin: HeraldPlugin = { id: "obs", hooks: { onEvent } };

			app = herald({
				database: memoryAdapter(),
				workflow: memoryWorkflowAdapter(),
				workflows: [inAppWorkflow],
				plugins: [plugin],
			});

			await app.api.upsertSubscriber({ externalId: "user-1", email: "u@test.com" });
			await expect(app.api.trigger({ workflowId: "welcome", to: "user-1", payload: {} })).resolves.toBeDefined();

			expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Plugin "obs" onEvent hook threw'), expect.any(Error));
			consoleSpy.mockRestore();
		});

		it("passes HeraldContext as the second argument", async () => {
			const onEvent = vi.fn<(event: ActivityEventInput, ctx: unknown) => Promise<void>>();
			const plugin: HeraldPlugin = { id: "obs", hooks: { onEvent } };

			app = herald({
				database: memoryAdapter(),
				workflow: memoryWorkflowAdapter(),
				workflows: [inAppWorkflow],
				plugins: [plugin],
			});

			await app.api.upsertSubscriber({ externalId: "user-1", email: "u@test.com" });
			await app.api.trigger({ workflowId: "welcome", to: "user-1", payload: {} });

			expect(onEvent).toHaveBeenCalled();
			const ctxArg = onEvent.mock.calls[0]?.[1] as { db?: unknown; options?: unknown };
			expect(ctxArg.db).toBeDefined();
			expect(ctxArg.options).toBeDefined();
		});

		it("fans out to all plugins independently", async () => {
			const a = vi.fn();
			const b = vi.fn();

			app = herald({
				database: memoryAdapter(),
				workflow: memoryWorkflowAdapter(),
				workflows: [inAppWorkflow],
				plugins: [
					{ id: "a", hooks: { onEvent: a } },
					{ id: "b", hooks: { onEvent: b } },
				],
			});

			await app.api.upsertSubscriber({ externalId: "user-1", email: "u@test.com" });
			await app.api.trigger({ workflowId: "welcome", to: "user-1", payload: {} });

			expect(a).toHaveBeenCalled();
			expect(b).toHaveBeenCalled();

			const aEvents = new Set(a.mock.calls.map((c) => (c[0] as ActivityEventInput).event));
			const bEvents = new Set(b.mock.calls.map((c) => (c[0] as ActivityEventInput).event));
			const expected: ActivityEventType = "notification.sent";
			expect(aEvents.has(expected)).toBe(true);
			expect(bEvents.has(expected)).toBe(true);
		});
	});

	describe("onStepStart / onStepComplete", () => {
		it("fires onStepStart before the handler and onStepComplete after for channel steps", async () => {
			const order: string[] = [];
			const plugin: HeraldPlugin = {
				id: "step-tracer",
				hooks: {
					onStepStart: async (args) => {
						order.push(`start:${args.stepId}:${args.channel ?? "none"}`);
					},
					onStepComplete: async (args) => {
						order.push(`complete:${args.stepId}:${args.channel ?? "none"}`);
					},
				},
			};

			app = herald({
				database: memoryAdapter(),
				workflow: memoryWorkflowAdapter(),
				workflows: [inAppWorkflow],
				plugins: [plugin],
			});

			await app.api.upsertSubscriber({ externalId: "user-1", email: "u@test.com" });
			await app.api.trigger({ workflowId: "welcome", to: "user-1", payload: {} });

			expect(order).toContain("start:send-in-app:in_app");
			expect(order).toContain("complete:send-in-app:in_app");
			expect(order.indexOf("start:send-in-app:in_app")).toBeLessThan(order.indexOf("complete:send-in-app:in_app"));
		});

		it("fires onStepStart/onStepComplete for non-channel steps without channel arg", async () => {
			const onStepStart = vi.fn();
			const onStepComplete = vi.fn();
			const plugin: HeraldPlugin = { id: "tracer", hooks: { onStepStart, onStepComplete } };

			app = herald({
				database: memoryAdapter(),
				workflow: memoryWorkflowAdapter(),
				workflows: [noopWorkflow],
				plugins: [plugin],
			});

			await app.api.upsertSubscriber({ externalId: "user-1", email: "u@test.com" });
			await app.api.trigger({ workflowId: "noop", to: "user-1", payload: {} });

			expect(onStepStart).toHaveBeenCalledWith(expect.objectContaining({ stepId: "compute", workflowId: "noop" }), expect.anything());
			expect(onStepStart.mock.calls[0]?.[0]?.channel).toBeUndefined();
			expect(onStepComplete).toHaveBeenCalledWith(expect.objectContaining({ stepId: "compute", workflowId: "noop" }), expect.anything());
			expect(onStepComplete.mock.calls[0]?.[0]?.channel).toBeUndefined();
		});

		it("does not fire onStepComplete on channel step when delivery is blocked by preferences", async () => {
			const onStepStart = vi.fn();
			const onStepComplete = vi.fn();
			const plugin: HeraldPlugin = { id: "tracer", hooks: { onStepStart, onStepComplete } };

			app = herald({
				database: memoryAdapter(),
				workflow: memoryWorkflowAdapter(),
				workflows: [inAppWorkflow],
				plugins: [plugin],
			});

			await app.api.upsertSubscriber({ externalId: "user-1", email: "u@test.com" });
			await app.api.updatePreferences("user-1", { channels: { in_app: false } });
			await app.api.trigger({ workflowId: "welcome", to: "user-1", payload: {} });

			expect(onStepStart).toHaveBeenCalled();
			// Step exits early via notification.blocked; complete only fires on success path.
			expect(onStepComplete).not.toHaveBeenCalled();
		});

		it("does not break delivery when onStepStart throws", async () => {
			const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
			const plugin: HeraldPlugin = {
				id: "broken",
				hooks: {
					onStepStart: async () => {
						throw new Error("boom");
					},
				},
			};

			app = herald({
				database: memoryAdapter(),
				workflow: memoryWorkflowAdapter(),
				workflows: [inAppWorkflow],
				plugins: [plugin],
			});

			await app.api.upsertSubscriber({ externalId: "user-1", email: "u@test.com" });
			await expect(app.api.trigger({ workflowId: "welcome", to: "user-1", payload: {} })).resolves.toBeDefined();

			expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Plugin "broken" onStepStart hook threw'), expect.any(Error));
			consoleSpy.mockRestore();
		});
	});

	describe("onSendFailure", () => {
		it("fires when the provider returns a failed result", async () => {
			const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
			const onSendFailure = vi.fn();
			const plugin: HeraldPlugin = { id: "alerts", hooks: { onSendFailure } };

			app = herald({
				database: memoryAdapter(),
				workflow: memoryWorkflowAdapter(),
				workflows: [failingEmailWorkflow],
				providers: [failingProvider],
				plugins: [plugin],
			});

			await app.api.upsertSubscriber({ externalId: "user-1", email: "u@test.com" });
			await app.api.trigger({ workflowId: "fail-email", to: "user-1", payload: {} });

			expect(onSendFailure).toHaveBeenCalledWith(
				expect.objectContaining({
					subscriberId: expect.any(String),
					channel: "email",
					messageId: "msg-fail-1",
					error: "SMTP refused",
					workflowId: "fail-email",
				}),
				expect.anything(),
			);
			consoleSpy.mockRestore();
		});

		it("does not fire on successful sends", async () => {
			const onSendFailure = vi.fn();
			const plugin: HeraldPlugin = { id: "alerts", hooks: { onSendFailure } };

			app = herald({
				database: memoryAdapter(),
				workflow: memoryWorkflowAdapter(),
				workflows: [inAppWorkflow],
				plugins: [plugin],
			});

			await app.api.upsertSubscriber({ externalId: "user-1", email: "u@test.com" });
			await app.api.trigger({ workflowId: "welcome", to: "user-1", payload: {} });

			expect(onSendFailure).not.toHaveBeenCalled();
		});

		it("does not break delivery when onSendFailure throws", async () => {
			const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
			const plugin: HeraldPlugin = {
				id: "broken-alerts",
				hooks: {
					onSendFailure: async () => {
						throw new Error("alerting service down");
					},
				},
			};

			app = herald({
				database: memoryAdapter(),
				workflow: memoryWorkflowAdapter(),
				workflows: [failingEmailWorkflow],
				providers: [failingProvider],
				plugins: [plugin],
			});

			await app.api.upsertSubscriber({ externalId: "user-1", email: "u@test.com" });
			await expect(app.api.trigger({ workflowId: "fail-email", to: "user-1", payload: {} })).resolves.toBeDefined();

			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining('Plugin "broken-alerts" onSendFailure hook threw'),
				expect.any(Error),
			);
			consoleSpy.mockRestore();
		});
	});
});
