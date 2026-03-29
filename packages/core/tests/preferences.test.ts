import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryAdapter } from "../src/adapters/database/memory.js";
import { memoryWorkflowAdapter } from "../src/adapters/workflow/memory.js";
import { herald } from "../src/core/herald.js";
import { preferenceGate } from "../src/core/preferences.js";
import type { WorkflowMeta } from "../src/core/preferences.js";
import type { Herald, NotificationWorkflow, PreferenceRecord } from "../src/types/index.js";

// ---- Unit tests for preferenceGate() ----

describe("preferenceGate()", () => {
	const baseMeta: WorkflowMeta = { workflowId: "comment-reply" };

	it("allows delivery when no preferences are set", () => {
		const result = preferenceGate({ subscriberPrefs: undefined, workflowMeta: baseMeta, channel: "email" });
		expect(result).toEqual({ allowed: true, reason: "default" });
	});

	it("critical bypass — always allowed", () => {
		const prefs: PreferenceRecord = { subscriberId: "s1", channels: { email: false }, purposes: { social: false } };
		const meta: WorkflowMeta = { workflowId: "password-reset", critical: true };
		const result = preferenceGate({ subscriberPrefs: prefs, workflowMeta: meta, channel: "email" });
		expect(result).toEqual({ allowed: true, reason: "critical" });
	});

	it("channel disabled — blocked", () => {
		const prefs: PreferenceRecord = { subscriberId: "s1", channels: { email: false } };
		const result = preferenceGate({ subscriberPrefs: prefs, workflowMeta: baseMeta, channel: "email" });
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("channel");
	});

	it("purpose disabled — blocked", () => {
		const prefs: PreferenceRecord = { subscriberId: "s1", purposes: { social: false } };
		const meta: WorkflowMeta = { workflowId: "like-notification", purpose: "social" };
		const result = preferenceGate({ subscriberPrefs: prefs, workflowMeta: meta, channel: "in_app" });
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("purpose");
	});

	it("workflow disabled — blocked", () => {
		const prefs: PreferenceRecord = { subscriberId: "s1", workflows: { "comment-reply": { enabled: false } } };
		const result = preferenceGate({ subscriberPrefs: prefs, workflowMeta: baseMeta, channel: "email" });
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("workflow");
	});

	it("workflow enabled overrides purpose disabled", () => {
		const prefs: PreferenceRecord = {
			subscriberId: "s1",
			purposes: { social: false },
			workflows: { "comment-reply": { enabled: true } },
		};
		const meta: WorkflowMeta = { workflowId: "comment-reply", purpose: "social" };
		const result = preferenceGate({ subscriberPrefs: prefs, workflowMeta: meta, channel: "email" });
		expect(result.allowed).toBe(true);
		expect(result.reason).toContain("workflow");
	});

	it("per-workflow-channel override — email blocked, in_app allowed", () => {
		const prefs: PreferenceRecord = {
			subscriberId: "s1",
			workflows: {
				"comment-reply": { enabled: true, channels: { email: false } },
			},
		};
		const emailResult = preferenceGate({ subscriberPrefs: prefs, workflowMeta: baseMeta, channel: "email" });
		expect(emailResult.allowed).toBe(false);
		expect(emailResult.reason).toContain("channel");
		expect(emailResult.reason).toContain("workflow");

		const inAppResult = preferenceGate({ subscriberPrefs: prefs, workflowMeta: baseMeta, channel: "in_app" });
		expect(inAppResult.allowed).toBe(true);
	});

	it("workflow-author channel default — blocked", () => {
		const meta: WorkflowMeta = {
			workflowId: "digest",
			preferences: { channels: { sms: { enabled: false } } },
		};
		const result = preferenceGate({ subscriberPrefs: undefined, workflowMeta: meta, channel: "sms" });
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("workflow author");
	});

	it("config default per-purpose — marketing defaults false", () => {
		const defaults = { purposes: { marketing: false } };
		const meta: WorkflowMeta = { workflowId: "promo", purpose: "marketing" };
		const result = preferenceGate({ subscriberPrefs: undefined, workflowMeta: meta, channel: "email", defaultPreferences: defaults });
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("config default");
	});

	it("config default per-channel — blocked", () => {
		const defaults = { channels: { sms: false as const } };
		const result = preferenceGate({ subscriberPrefs: undefined, workflowMeta: baseMeta, channel: "sms", defaultPreferences: defaults });
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("config default");
	});

	it("explicit subscriber true overrides config default false", () => {
		const prefs: PreferenceRecord = { subscriberId: "s1", workflows: { promo: { enabled: true } } };
		const defaults = { workflows: { promo: { enabled: false } } };
		const meta: WorkflowMeta = { workflowId: "promo" };
		const result = preferenceGate({ subscriberPrefs: prefs, workflowMeta: meta, channel: "email", defaultPreferences: defaults });
		expect(result.allowed).toBe(true);
	});

	it("explicit subscriber purpose true overrides config default purpose false", () => {
		const prefs: PreferenceRecord = { subscriberId: "s1", purposes: { marketing: true } };
		const defaults = { purposes: { marketing: false } };
		const meta: WorkflowMeta = { workflowId: "promo", purpose: "marketing" };
		const result = preferenceGate({ subscriberPrefs: prefs, workflowMeta: meta, channel: "email", defaultPreferences: defaults });
		expect(result.allowed).toBe(true);
	});

	it("explicit subscriber purpose true overrides operator non-enforced purpose default false", () => {
		const prefs: PreferenceRecord = { subscriberId: "s1", purposes: { marketing: true } };
		const opPrefs = { purposes: { marketing: { enabled: false } } };
		const meta: WorkflowMeta = { workflowId: "promo", purpose: "marketing" };
		const result = preferenceGate({
			subscriberPrefs: prefs,
			workflowMeta: meta,
			channel: "email",
			operatorPreferences: opPrefs,
		});
		expect(result.allowed).toBe(true);
	});

	it("operator non-enforced category default disabled blocks when subscriber has no category pref", () => {
		const opPrefs = { categories: { billing: { enabled: false } } };
		const meta: WorkflowMeta = { workflowId: "invoice", category: "billing" };
		const result = preferenceGate({
			subscriberPrefs: undefined,
			workflowMeta: meta,
			channel: "email",
			operatorPreferences: opPrefs,
		});
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("operator default disabled category");
	});

	it("explicit subscriber category enabled overrides operator non-enforced category default disabled", () => {
		const prefs: PreferenceRecord = { subscriberId: "s1", categories: { billing: { enabled: true } } };
		const opPrefs = { categories: { billing: { enabled: false } } };
		const meta: WorkflowMeta = { workflowId: "invoice", category: "billing" };
		const result = preferenceGate({
			subscriberPrefs: prefs,
			workflowMeta: meta,
			channel: "email",
			operatorPreferences: opPrefs,
		});
		expect(result.allowed).toBe(true);
	});

	it("channel kill switch (step 4) beats workflow enable (step 5)", () => {
		const prefs: PreferenceRecord = {
			subscriberId: "s1",
			channels: { email: false },
			workflows: { "comment-reply": { enabled: true } },
		};
		const result = preferenceGate({ subscriberPrefs: prefs, workflowMeta: baseMeta, channel: "email" });
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("subscriber disabled channel");
	});

	it("config default per-workflow blocks delivery (step 10)", () => {
		const defaults = { workflows: { digest: { enabled: false } } };
		const meta: WorkflowMeta = { workflowId: "digest" };
		const result = preferenceGate({ subscriberPrefs: undefined, workflowMeta: meta, channel: "email", defaultPreferences: defaults });
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("config default disabled workflow");
	});

	it("WorkflowChannelPreference with enabled: false blocks like boolean false", () => {
		const prefs: PreferenceRecord = {
			subscriberId: "s1",
			workflows: { "comment-reply": { enabled: false } },
		};
		const result = preferenceGate({ subscriberPrefs: prefs, workflowMeta: baseMeta, channel: "email" });
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("subscriber disabled workflow");
	});
});

// ---- Integration tests ----

describe("preference enforcement — integration", () => {
	let app: Herald;
	let db: ReturnType<typeof memoryAdapter>;
	let workflow: ReturnType<typeof memoryWorkflowAdapter>;

	const emailWorkflow: NotificationWorkflow = {
		id: "welcome-email",
		name: "Welcome Email",
		steps: [
			{
				stepId: "send-email",
				type: "email",
				handler: async () => ({
					subject: "Welcome!",
					body: "Hello!",
				}),
			},
			{
				stepId: "send-in-app",
				type: "in_app",
				handler: async () => ({
					subject: "Welcome!",
					body: "Hello in-app!",
				}),
			},
		],
	};

	const criticalWorkflow: NotificationWorkflow = {
		id: "password-reset",
		name: "Password Reset",
		critical: true,
		steps: [
			{
				stepId: "send-in-app",
				type: "in_app",
				handler: async () => ({
					subject: "Password Reset",
					body: "Reset your password",
				}),
			},
		],
	};

	beforeEach(() => {
		db = memoryAdapter();
		workflow = memoryWorkflowAdapter();
		app = herald({
			database: db,
			workflow,
			workflows: [emailWorkflow, criticalWorkflow],
		});
	});

	it("email step skipped when subscriber disables email channel", async () => {
		const { id: subscriberId } = await app.api.upsertSubscriber({
			externalId: "user-1",
			email: "alice@example.com",
		});

		await app.api.updatePreferences(subscriberId, {
			channels: { email: false },
		});

		await app.api.trigger({
			workflowId: "welcome-email",
			to: "user-1",
			payload: {},
		});

		const { notifications } = await app.api.getNotifications({ subscriberId });
		// Only the in_app notification should be delivered, email should be blocked
		expect(notifications).toHaveLength(1);
		expect(notifications[0]?.channel).toBe("in_app");
	});

	it("critical workflow delivers despite all prefs disabled", async () => {
		const { id: subscriberId } = await app.api.upsertSubscriber({
			externalId: "user-1",
		});

		await app.api.updatePreferences(subscriberId, {
			channels: { in_app: false, email: false },
			workflows: { "password-reset": { enabled: false } },
		});

		await app.api.trigger({
			workflowId: "password-reset",
			to: "user-1",
			payload: {},
		});

		const { notifications } = await app.api.getNotifications({ subscriberId });
		expect(notifications).toHaveLength(1);
		expect(notifications[0]?.subject).toBe("Password Reset");
	});

	it("plugin beforePreferenceCheck can override to block", async () => {
		const pluginDb = memoryAdapter();
		const pluginWorkflow = memoryWorkflowAdapter();
		const pluginApp = herald({
			database: pluginDb,
			workflow: pluginWorkflow,
			workflows: [emailWorkflow],
			plugins: [
				{
					id: "block-plugin",
					hooks: {
						beforePreferenceCheck: async () => ({ override: false }),
					},
				},
			],
		});

		const { id: subscriberId } = await pluginApp.api.upsertSubscriber({
			externalId: "user-1",
			email: "alice@example.com",
		});

		await pluginApp.api.trigger({
			workflowId: "welcome-email",
			to: "user-1",
			payload: {},
		});

		const { notifications } = await pluginApp.api.getNotifications({ subscriberId });
		expect(notifications).toHaveLength(0);
	});

	it("plugin beforePreferenceCheck can override to force allow", async () => {
		const inAppOnlyWorkflow: NotificationWorkflow = {
			id: "notify",
			name: "Notify",
			steps: [{ stepId: "send-in-app", type: "in_app", handler: async () => ({ subject: "Hi", body: "Hello" }) }],
		};
		const pluginDb = memoryAdapter();
		const pluginWorkflow = memoryWorkflowAdapter();
		const pluginApp = herald({
			database: pluginDb,
			workflow: pluginWorkflow,
			workflows: [inAppOnlyWorkflow],
			plugins: [
				{
					id: "force-allow-plugin",
					hooks: {
						beforePreferenceCheck: async () => ({ override: true }),
					},
				},
			],
		});

		const { id: subscriberId } = await pluginApp.api.upsertSubscriber({ externalId: "user-1" });

		// Disable in_app channel — plugin should override
		await pluginApp.api.updatePreferences(subscriberId, { channels: { in_app: false } });

		await pluginApp.api.trigger({ workflowId: "notify", to: "user-1", payload: {} });

		const { notifications } = await pluginApp.api.getNotifications({ subscriberId });
		expect(notifications).toHaveLength(1);
	});

	it("plugin hook that throws does not block delivery", async () => {
		const inAppOnlyWorkflow: NotificationWorkflow = {
			id: "notify",
			name: "Notify",
			steps: [{ stepId: "send-in-app", type: "in_app", handler: async () => ({ subject: "Hi", body: "Hello" }) }],
		};
		const pluginDb = memoryAdapter();
		const pluginWorkflow = memoryWorkflowAdapter();
		const pluginApp = herald({
			database: pluginDb,
			workflow: pluginWorkflow,
			workflows: [inAppOnlyWorkflow],
			plugins: [
				{
					id: "broken-plugin",
					hooks: {
						beforePreferenceCheck: async () => {
							throw new Error("plugin exploded");
						},
					},
				},
			],
		});

		const { id: subscriberId } = await pluginApp.api.upsertSubscriber({ externalId: "user-1" });

		await pluginApp.api.trigger({ workflowId: "notify", to: "user-1", payload: {} });

		// Delivery should still proceed despite plugin error
		const { notifications } = await pluginApp.api.getNotifications({ subscriberId });
		expect(notifications).toHaveLength(1);
	});

	it("beforePreferenceCheck receives category and purpose from workflow", async () => {
		const categorizedWorkflow: NotificationWorkflow = {
			id: "promo-email",
			name: "Promo",
			category: "marketing",
			purpose: "promotional",
			steps: [{ stepId: "send-email", type: "email", handler: async () => ({ subject: "Hi", body: "Promo" }) }],
		};
		const beforeHook = vi.fn();
		const pluginDb = memoryAdapter();
		const pluginWorkflow = memoryWorkflowAdapter();
		const pluginApp = herald({
			database: pluginDb,
			workflow: pluginWorkflow,
			workflows: [categorizedWorkflow],
			channels: { email: { provider: "custom", from: "noreply@test.com", send: async () => {} } },
			plugins: [
				{
					id: "category-spy",
					hooks: { beforePreferenceCheck: beforeHook },
				},
			],
		});

		const { id: subscriberId } = await pluginApp.api.upsertSubscriber({
			externalId: "user-1",
			email: "user@test.com",
		});

		await pluginApp.api.trigger({ workflowId: "promo-email", to: "user-1", payload: {} });

		expect(beforeHook).toHaveBeenCalled();
		expect(beforeHook).toHaveBeenCalledWith(
			expect.objectContaining({
				subscriberId,
				workflowId: "promo-email",
				channel: "email",
				category: "marketing",
				purpose: "promotional",
			}),
		);
	});

	it("afterPreferenceCheck hook receives correct arguments", async () => {
		const inAppOnlyWorkflow: NotificationWorkflow = {
			id: "notify",
			name: "Notify",
			steps: [{ stepId: "send-in-app", type: "in_app", handler: async () => ({ subject: "Hi", body: "Hello" }) }],
		};
		const afterHook = vi.fn();
		const pluginDb = memoryAdapter();
		const pluginWorkflow = memoryWorkflowAdapter();
		const pluginApp = herald({
			database: pluginDb,
			workflow: pluginWorkflow,
			workflows: [inAppOnlyWorkflow],
			plugins: [
				{
					id: "spy-plugin",
					hooks: {
						afterPreferenceCheck: afterHook,
					},
				},
			],
		});

		const { id: subscriberId } = await pluginApp.api.upsertSubscriber({ externalId: "user-1" });

		await pluginApp.api.trigger({ workflowId: "notify", to: "user-1", payload: {} });

		expect(afterHook).toHaveBeenCalledOnce();
		const firstCall = afterHook.mock.calls[0]?.[0];
		expect(firstCall).toMatchObject({
			subscriberId,
			workflowId: "notify",
			channel: "in_app",
			allowed: true,
		});
		expect(firstCall.reason).toBeDefined();
	});
});
