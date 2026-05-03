import { describe, expect, it, vi } from "vitest";
import { memoryAdapter } from "../src/adapters/database/memory.js";
import { memoryWorkflowAdapter } from "../src/adapters/workflow/memory.js";
import { herald } from "../src/core/herald.js";
import { OBSERVABILITY_PLUGIN_ID, observabilityPlugin } from "../src/plugins/observability/index.js";
import type { ActivityEventInput, WebhookEventPayload } from "../src/types/activity.js";
import type { HeraldPlugin, NotificationWorkflow } from "../src/types/index.js";

const inAppWorkflow: NotificationWorkflow = {
	id: "welcome",
	name: "Welcome",
	steps: [{ stepId: "send-in-app", type: "in_app", handler: async () => ({ body: "Hello" }) }],
};

describe("observability plugin", () => {
	describe("auto-registration", () => {
		it("auto-registers the plugin when activityLog: true", () => {
			const app = herald({
				database: memoryAdapter(),
				workflow: memoryWorkflowAdapter(),
				workflows: [inAppWorkflow],
				activityLog: true,
			});

			const ids = app.$context.options.plugins?.map((p) => p.id) ?? [];
			expect(ids).toContain(OBSERVABILITY_PLUGIN_ID);
		});

		it("auto-registers the plugin when webhooks are configured", () => {
			const app = herald({
				database: memoryAdapter(),
				workflow: memoryWorkflowAdapter(),
				workflows: [inAppWorkflow],
				webhooks: [{ url: "https://example.test/hook" }],
			});

			const ids = app.$context.options.plugins?.map((p) => p.id) ?? [];
			expect(ids).toContain(OBSERVABILITY_PLUGIN_ID);
		});

		it("does not auto-register when neither activityLog nor webhooks are set", () => {
			const app = herald({
				database: memoryAdapter(),
				workflow: memoryWorkflowAdapter(),
				workflows: [inAppWorkflow],
			});

			const ids = app.$context.options.plugins?.map((p) => p.id) ?? [];
			expect(ids).not.toContain(OBSERVABILITY_PLUGIN_ID);
		});

		it("does not double-register when the user already provided observabilityPlugin", () => {
			const app = herald({
				database: memoryAdapter(),
				workflow: memoryWorkflowAdapter(),
				workflows: [inAppWorkflow],
				activityLog: true,
				plugins: [observabilityPlugin()],
			});

			const ids = app.$context.options.plugins?.map((p) => p.id) ?? [];
			expect(ids.filter((id) => id === OBSERVABILITY_PLUGIN_ID)).toHaveLength(1);
		});
	});

	describe("schema contribution", () => {
		it("merges activityLog into the active schema only when registered", () => {
			const without = herald({
				database: memoryAdapter(),
				workflow: memoryWorkflowAdapter(),
				workflows: [inAppWorkflow],
			});
			expect(without.$context.schema.activityLog).toBeUndefined();

			const withPlugin = herald({
				database: memoryAdapter(),
				workflow: memoryWorkflowAdapter(),
				workflows: [inAppWorkflow],
				activityLog: true,
			});
			expect(withPlugin.$context.schema.activityLog).toBeDefined();
		});
	});

	describe("plugin endpoints — parity with prior core routes", () => {
		function makeRequest(method: string, path: string, body?: unknown): Request {
			return new Request(`https://test.local/api/notifications${path}`, {
				method,
				headers: { "Content-Type": "application/json" },
				body: body ? JSON.stringify(body) : undefined,
			});
		}

		it("exposes /activity, /activity/:transactionId, and /delivery-status when activityLog: true", async () => {
			const app = herald({
				database: memoryAdapter(),
				workflow: memoryWorkflowAdapter(),
				workflows: [inAppWorkflow],
				activityLog: true,
			});

			await app.api.upsertSubscriber({ externalId: "u-1", email: "u@test.com" });
			const { transactionId } = await app.api.trigger({ workflowId: "welcome", to: "u-1", payload: {} });

			const list = await app.handler(makeRequest("GET", "/activity"));
			expect(list.status).toBe(200);

			const trace = await app.handler(makeRequest("GET", `/activity/${transactionId}`));
			expect(trace.status).toBe(200);
			const traceBody = await trace.json();
			expect(traceBody.entries.length).toBeGreaterThan(0);
		});

		it("returns 404 for activity endpoints when plugin is not registered", async () => {
			const app = herald({
				database: memoryAdapter(),
				workflow: memoryWorkflowAdapter(),
				workflows: [inAppWorkflow],
			});

			const res = await app.handler(makeRequest("GET", "/activity"));
			expect(res.status).toBe(404);
		});
	});

	describe("onEvent fan-out", () => {
		it("records events through the plugin path, parity with v0.6 behavior", async () => {
			const app = herald({
				database: memoryAdapter(),
				workflow: memoryWorkflowAdapter(),
				workflows: [inAppWorkflow],
				activityLog: true,
			});

			await app.api.upsertSubscriber({ externalId: "u-1", email: "u@test.com" });
			const { transactionId } = await app.api.trigger({ workflowId: "welcome", to: "u-1", payload: {} });

			const { entries } = await app.api.getActivityLog({ transactionId });
			const events = entries.map((e) => e.event);
			expect(events).toContain("workflow.triggered");
			expect(events).toContain("workflow.dispatched");
			expect(events).toContain("notification.sent");
		});

		it("delivers webhooks through the plugin path", async () => {
			const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
			vi.stubGlobal("fetch", fetchMock);

			try {
				const app = herald({
					database: memoryAdapter(),
					workflow: memoryWorkflowAdapter(),
					workflows: [inAppWorkflow],
					webhooks: [{ url: "https://example.test/hook" }],
				});

				await app.api.upsertSubscriber({ externalId: "u-1", email: "u@test.com" });
				await app.api.trigger({ workflowId: "welcome", to: "u-1", payload: {} });

				expect(fetchMock).toHaveBeenCalled();
				const firstCallBody = fetchMock.mock.calls[0]?.[1]?.body as string;
				const parsed = JSON.parse(firstCallBody) as WebhookEventPayload;
				expect(parsed.event).toBeDefined();
				expect(parsed.data).toBeDefined();
			} finally {
				vi.unstubAllGlobals();
			}
		});

		it("coexists with user-supplied plugins that subscribe to onEvent", async () => {
			const userOnEvent = vi.fn();
			const customPlugin: HeraldPlugin = { id: "custom-observer", hooks: { onEvent: userOnEvent } };

			const app = herald({
				database: memoryAdapter(),
				workflow: memoryWorkflowAdapter(),
				workflows: [inAppWorkflow],
				activityLog: true,
				plugins: [customPlugin],
			});

			await app.api.upsertSubscriber({ externalId: "u-1", email: "u@test.com" });
			const { transactionId } = await app.api.trigger({ workflowId: "welcome", to: "u-1", payload: {} });

			expect(userOnEvent).toHaveBeenCalled();
			const events = userOnEvent.mock.calls.map((c) => (c[0] as ActivityEventInput).event);
			expect(events).toContain("workflow.triggered");

			const { entries } = await app.api.getActivityLog({ transactionId });
			expect(entries.length).toBeGreaterThan(0);
		});
	});

	describe("api back-compat", () => {
		it("preserves api.getActivityLog when activityLog is enabled", async () => {
			const app = herald({
				database: memoryAdapter(),
				workflow: memoryWorkflowAdapter(),
				workflows: [inAppWorkflow],
				activityLog: true,
			});

			await app.api.upsertSubscriber({ externalId: "u-1", email: "u@test.com" });
			const { transactionId } = await app.api.trigger({ workflowId: "welcome", to: "u-1", payload: {} });

			const { entries } = await app.api.getActivityLog({ transactionId });
			expect(entries.length).toBeGreaterThan(0);
		});

		it("preserves api.updateDeliveryStatus emitting status_changed via onEvent", async () => {
			const onEvent = vi.fn();
			const app = herald({
				database: memoryAdapter(),
				workflow: memoryWorkflowAdapter(),
				workflows: [inAppWorkflow],
				activityLog: true,
				plugins: [{ id: "observer", hooks: { onEvent } }],
			});

			await app.api.upsertSubscriber({ externalId: "u-1", email: "u@test.com" });
			await app.api.trigger({ workflowId: "welcome", to: "u-1", payload: {} });
			const { notifications } = await app.api.getNotifications({ subscriberId: "u-1" });
			const seedNotificationId = notifications[0]?.id;
			expect(seedNotificationId).toBeDefined();

			// In-app notifications start in "delivered" terminal state. Seed a "queued" one to drive transitions.
			const { id: subscriberId } = await app.api.upsertSubscriber({ externalId: "u-2", email: "u2@test.com" });
			const seedId = crypto.randomUUID();
			await app.$context.db.create({
				model: "notification",
				data: {
					id: seedId,
					subscriberId,
					workflowId: "welcome",
					channel: "email",
					body: "x",
					read: false,
					seen: false,
					archived: false,
					deliveryStatus: "queued",
					transactionId: crypto.randomUUID(),
					createdAt: new Date(),
				},
			});

			onEvent.mockClear();
			await app.api.updateDeliveryStatus({ notificationId: seedId, status: "sent" });

			const events = onEvent.mock.calls.map((c) => (c[0] as ActivityEventInput).event);
			expect(events).toContain("notification.status_changed");
		});
	});
});
