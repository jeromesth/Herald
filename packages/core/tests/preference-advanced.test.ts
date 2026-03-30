import { beforeEach, describe, expect, it } from "vitest";
import { memoryAdapter } from "../src/adapters/database/memory.js";
import { memoryWorkflowAdapter } from "../src/adapters/workflow/memory.js";
import { conditionsPass, evaluateCondition, resolvePath } from "../src/core/conditions.js";
import { herald } from "../src/core/herald.js";
import { deepMerge, normalizePreferenceRecord, preferenceGate, stripReadOnlyOverrides } from "../src/core/preferences.js";
import type { ConditionContext, WorkflowMeta } from "../src/core/preferences.js";
import type {
	CategoryPreference,
	Herald,
	NotificationWorkflow,
	OperatorPreferences,
	PreferenceRecord,
	SubscriberData,
} from "../src/types/index.js";

// ---- Feature 1: Category-Channel Granularity ----

describe("category-channel preferences", () => {
	const baseMeta: WorkflowMeta = { workflowId: "promo-email", category: "marketing" };

	it("category disabled — blocked", () => {
		const prefs: PreferenceRecord = {
			subscriberId: "s1",
			categories: { marketing: { enabled: false } },
		};
		const result = preferenceGate({ subscriberPrefs: prefs, workflowMeta: baseMeta, channel: "email" });
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("category");
		expect(result.reason).toContain("marketing");
	});

	it("category enabled but specific channel disabled — blocked for that channel", () => {
		const prefs: PreferenceRecord = {
			subscriberId: "s1",
			categories: { marketing: { enabled: true, channels: { email: false } } },
		};
		const emailResult = preferenceGate({ subscriberPrefs: prefs, workflowMeta: baseMeta, channel: "email" });
		expect(emailResult.allowed).toBe(false);
		expect(emailResult.reason).toContain("channel");
		expect(emailResult.reason).toContain("category");

		const inAppResult = preferenceGate({ subscriberPrefs: prefs, workflowMeta: baseMeta, channel: "in_app" });
		expect(inAppResult.allowed).toBe(true);
	});

	it("category enabled — allowed", () => {
		const prefs: PreferenceRecord = {
			subscriberId: "s1",
			categories: { marketing: { enabled: true } },
		};
		const result = preferenceGate({ subscriberPrefs: prefs, workflowMeta: baseMeta, channel: "email" });
		expect(result.allowed).toBe(true);
	});

	it("no category on workflow — category prefs ignored", () => {
		const prefs: PreferenceRecord = {
			subscriberId: "s1",
			categories: { marketing: { enabled: false } },
		};
		const meta: WorkflowMeta = { workflowId: "promo-email" }; // no category
		const result = preferenceGate({ subscriberPrefs: prefs, workflowMeta: meta, channel: "email" });
		expect(result.allowed).toBe(true);
	});

	it("config default category disabled — blocked", () => {
		const meta: WorkflowMeta = { workflowId: "promo-email", category: "marketing" };
		const defaults = { categories: { marketing: { enabled: false } } };
		const result = preferenceGate({ subscriberPrefs: undefined, workflowMeta: meta, channel: "email", defaultPreferences: defaults });
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("config default disabled category");
	});
});

// ---- Feature 2: ReadOnly Channel Controls ----

describe("readOnly channel controls", () => {
	it("readOnly enabled=true — delivers even if subscriber disabled channel", () => {
		const prefs: PreferenceRecord = {
			subscriberId: "s1",
			channels: { email: false },
		};
		const meta: WorkflowMeta = {
			workflowId: "password-reset",
			preferences: { channels: { email: { enabled: true, readOnly: true } } },
		};
		const result = preferenceGate({ subscriberPrefs: prefs, workflowMeta: meta, channel: "email" });
		expect(result.allowed).toBe(true);
		expect(result.reason).toContain("readOnly");
	});

	it("readOnly enabled=false — blocks even if subscriber enabled channel", () => {
		const prefs: PreferenceRecord = {
			subscriberId: "s1",
			channels: { email: true },
		};
		const meta: WorkflowMeta = {
			workflowId: "legacy-notification",
			preferences: { channels: { email: { enabled: false, readOnly: true } } },
		};
		const result = preferenceGate({ subscriberPrefs: prefs, workflowMeta: meta, channel: "email" });
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("readOnly");
	});

	it("non-readOnly channel — subscriber can override", () => {
		const prefs: PreferenceRecord = {
			subscriberId: "s1",
			channels: { email: false },
		};
		const meta: WorkflowMeta = {
			workflowId: "digest",
			preferences: { channels: { email: { enabled: true } } },
		};
		const result = preferenceGate({ subscriberPrefs: prefs, workflowMeta: meta, channel: "email" });
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("subscriber disabled channel");
	});

	it("critical bypass takes precedence over readOnly", () => {
		const prefs: PreferenceRecord = { subscriberId: "s1", channels: { email: false } };
		const meta: WorkflowMeta = {
			workflowId: "critical-wf",
			critical: true,
			preferences: { channels: { email: { enabled: false, readOnly: true } } },
		};
		const result = preferenceGate({ subscriberPrefs: prefs, workflowMeta: meta, channel: "email" });
		expect(result.allowed).toBe(true);
		expect(result.reason).toBe("critical");
	});

	it("readOnly delivers in integration test", async () => {
		const db = memoryAdapter();
		const workflow = memoryWorkflowAdapter();
		const readOnlyWorkflow: NotificationWorkflow = {
			id: "account-alert",
			name: "Account Alert",
			preferences: { channels: { in_app: { enabled: true, readOnly: true } } },
			steps: [
				{
					stepId: "send-in-app",
					type: "in_app",
					handler: async () => ({ subject: "Alert", body: "Important alert" }),
				},
			],
		};

		const app = herald({ database: db, workflow, workflows: [readOnlyWorkflow] });
		const { id: subscriberId } = await app.api.upsertSubscriber({ externalId: "user-1" });
		await app.api.updatePreferences(subscriberId, { channels: { in_app: false } });

		await app.api.trigger({ workflowId: "account-alert", to: "user-1", payload: {} });

		const { notifications } = await app.api.getNotifications({ subscriberId });
		expect(notifications).toHaveLength(1);
		expect(notifications[0]?.subject).toBe("Alert");
	});
});

// ---- Feature 3: Operator-Level Preference Overrides ----

describe("operator-level preference overrides", () => {
	it("enforced channel override blocks despite subscriber enabling", () => {
		const prefs: PreferenceRecord = {
			subscriberId: "s1",
			channels: { sms: true },
		};
		const opPrefs: OperatorPreferences = {
			channels: { sms: { enabled: false, enforce: true } },
		};
		const meta: WorkflowMeta = { workflowId: "sms-workflow" };
		const result = preferenceGate({ subscriberPrefs: prefs, workflowMeta: meta, channel: "sms", operatorPreferences: opPrefs });
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("operator enforced");
	});

	it("enforced workflow override allows despite subscriber disabling", () => {
		const prefs: PreferenceRecord = {
			subscriberId: "s1",
			workflows: { "mandatory-wf": { enabled: false } },
		};
		const opPrefs: OperatorPreferences = {
			workflows: { "mandatory-wf": { enabled: true, enforce: true } },
		};
		const meta: WorkflowMeta = { workflowId: "mandatory-wf" };
		const result = preferenceGate({ subscriberPrefs: prefs, workflowMeta: meta, channel: "email", operatorPreferences: opPrefs });
		expect(result.allowed).toBe(true);
		expect(result.reason).toContain("operator enforced");
	});

	it("non-enforced operator default acts as fallback", () => {
		const opPrefs: OperatorPreferences = {
			channels: { push: { enabled: false } },
		};
		const meta: WorkflowMeta = { workflowId: "push-wf" };
		// No subscriber prefs, no config defaults — operator default kicks in
		const result = preferenceGate({ subscriberPrefs: undefined, workflowMeta: meta, channel: "push", operatorPreferences: opPrefs });
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("operator default");
	});

	it("subscriber can override non-enforced operator default", () => {
		const prefs: PreferenceRecord = {
			subscriberId: "s1",
			channels: { push: true },
		};
		const opPrefs: OperatorPreferences = {
			channels: { push: { enabled: false } },
		};
		const meta: WorkflowMeta = { workflowId: "push-wf" };
		const result = preferenceGate({ subscriberPrefs: prefs, workflowMeta: meta, channel: "push", operatorPreferences: opPrefs });
		expect(result.allowed).toBe(true);
	});

	it("enforced category override", () => {
		const opPrefs: OperatorPreferences = {
			categories: { billing: { enabled: true, enforce: true } },
		};
		const prefs: PreferenceRecord = {
			subscriberId: "s1",
			categories: { billing: { enabled: false } },
		};
		const meta: WorkflowMeta = { workflowId: "invoice", category: "billing" };
		const result = preferenceGate({ subscriberPrefs: prefs, workflowMeta: meta, channel: "email", operatorPreferences: opPrefs });
		expect(result.allowed).toBe(true);
		expect(result.reason).toContain("operator enforced category");
	});

	it("enforced purpose override", () => {
		const opPrefs: OperatorPreferences = {
			purposes: { transactional: { enabled: true, enforce: true } },
		};
		const prefs: PreferenceRecord = {
			subscriberId: "s1",
			purposes: { transactional: false },
		};
		const meta: WorkflowMeta = { workflowId: "receipt", purpose: "transactional" };
		const result = preferenceGate({ subscriberPrefs: prefs, workflowMeta: meta, channel: "email", operatorPreferences: opPrefs });
		expect(result.allowed).toBe(true);
		expect(result.reason).toContain("operator enforced purpose");
	});

	it("when channel and workflow are both enforce:true and conflict, channel tier wins (checked first)", () => {
		const opPrefs: OperatorPreferences = {
			channels: { email: { enabled: false, enforce: true } },
			workflows: { invoice: { enabled: true, enforce: true } },
		};
		const meta: WorkflowMeta = { workflowId: "invoice" };
		const result = preferenceGate({ subscriberPrefs: undefined, workflowMeta: meta, channel: "email", operatorPreferences: opPrefs });
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("operator enforced channel");
	});

	it("when channel enforce enables and workflow enforce disables, channel tier still wins (same ordering)", () => {
		const opPrefs: OperatorPreferences = {
			channels: { email: { enabled: true, enforce: true } },
			workflows: { invoice: { enabled: false, enforce: true } },
		};
		const meta: WorkflowMeta = { workflowId: "invoice" };
		const result = preferenceGate({ subscriberPrefs: undefined, workflowMeta: meta, channel: "email", operatorPreferences: opPrefs });
		expect(result.allowed).toBe(true);
		expect(result.reason).toContain("operator enforced channel");
	});

	it("critical bypass takes precedence over operator overrides", () => {
		const opPrefs: OperatorPreferences = {
			channels: { email: { enabled: false, enforce: true } },
		};
		const meta: WorkflowMeta = { workflowId: "critical-wf", critical: true };
		const result = preferenceGate({ subscriberPrefs: undefined, workflowMeta: meta, channel: "email", operatorPreferences: opPrefs });
		expect(result.allowed).toBe(true);
		expect(result.reason).toBe("critical");
	});

	it("operator preferences wired through herald integration", async () => {
		const db = memoryAdapter();
		const wf = memoryWorkflowAdapter();
		const testWorkflow: NotificationWorkflow = {
			id: "test-wf",
			name: "Test",
			steps: [{ stepId: "send-email", type: "email", handler: async () => ({ subject: "Hi", body: "Test" }) }],
		};

		const app = herald({
			database: db,
			workflow: wf,
			workflows: [testWorkflow],
			channels: { email: { provider: "custom", from: "test@test.com", send: async () => {} } },
			operatorPreferences: { channels: { email: { enabled: false, enforce: true } } },
		});

		const { id: subscriberId } = await app.api.upsertSubscriber({ externalId: "user-1", email: "a@b.com" });
		await app.api.trigger({ workflowId: "test-wf", to: "user-1", payload: {} });

		// Email should be blocked by operator override
		const { notifications } = await app.api.getNotifications({ subscriberId });
		expect(notifications).toHaveLength(0);
	});
});

// ---- Feature 4: Preference Conditions ----

describe("shared conditions utility", () => {
	it("resolvePath extracts nested values", () => {
		const obj = { a: { b: { c: 42 } } };
		expect(resolvePath(obj, "a.b.c")).toBe(42);
	});

	it("resolvePath returns undefined for missing path", () => {
		expect(resolvePath({}, "a.b.c")).toBeUndefined();
	});

	it("evaluateCondition — eq", () => {
		expect(evaluateCondition({ field: "x", operator: "eq", value: 42 }, 42)).toBe(true);
		expect(evaluateCondition({ field: "x", operator: "eq", value: 42 }, 43)).toBe(false);
	});

	it("evaluateCondition — ne", () => {
		expect(evaluateCondition({ field: "x", operator: "ne", value: "a" }, "b")).toBe(true);
	});

	it("evaluateCondition — gt/lt", () => {
		expect(evaluateCondition({ field: "x", operator: "gt", value: 10 }, 20)).toBe(true);
		expect(evaluateCondition({ field: "x", operator: "lt", value: 10 }, 5)).toBe(true);
		expect(evaluateCondition({ field: "x", operator: "gt", value: 10 }, "20")).toBe(true);
	});

	it("evaluateCondition — gt/lt throw when operands are not finite numbers", () => {
		expect(() => evaluateCondition({ field: "score", operator: "gt", value: 5 }, "hello")).toThrow(TypeError);
		expect(() => evaluateCondition({ field: "score", operator: "lt", value: 5 }, "hello")).toThrow(TypeError);
		expect(() => evaluateCondition({ field: "score", operator: "gt", value: "nope" }, 10)).toThrow(TypeError);
		expect(() => evaluateCondition({ field: "score", operator: "lt", value: Number.NaN }, 10)).toThrow(TypeError);
	});

	it("evaluateCondition — in/not_in", () => {
		expect(evaluateCondition({ field: "x", operator: "in", value: ["a", "b"] }, "a")).toBe(true);
		expect(evaluateCondition({ field: "x", operator: "not_in", value: ["a", "b"] }, "c")).toBe(true);
	});

	it("evaluateCondition — exists", () => {
		expect(evaluateCondition({ field: "x", operator: "exists", value: true }, "hello")).toBe(true);
		expect(evaluateCondition({ field: "x", operator: "exists", value: true }, undefined)).toBe(false);
	});

	it("evaluateCondition — eq with undefined actual value", () => {
		expect(evaluateCondition({ field: "x", operator: "eq", value: "pro" }, undefined)).toBe(false);
		expect(evaluateCondition({ field: "x", operator: "eq", value: undefined }, undefined)).toBe(true);
	});

	it("evaluateCondition — ne/gt/lt/in/not_in with undefined actual value", () => {
		expect(evaluateCondition({ field: "x", operator: "ne", value: "free" }, undefined)).toBe(true);
		expect(evaluateCondition({ field: "x", operator: "gt", value: 0 }, undefined)).toBe(false);
		expect(evaluateCondition({ field: "x", operator: "lt", value: 0 }, undefined)).toBe(false);
		expect(evaluateCondition({ field: "x", operator: "in", value: ["a", "b"] }, undefined)).toBe(false);
		expect(evaluateCondition({ field: "x", operator: "not_in", value: ["a", "b"] }, undefined)).toBe(true);
	});

	it("conditionsPass — all mode (default)", () => {
		const conditions = [
			{ field: "a", operator: "eq" as const, value: 1 },
			{ field: "b", operator: "eq" as const, value: 2 },
		];
		const resolve = (f: string) => (f === "a" ? 1 : f === "b" ? 2 : undefined);
		expect(conditionsPass(conditions, resolve)).toBe(true);
	});

	it("conditionsPass — any mode", () => {
		const conditions = [
			{ field: "a", operator: "eq" as const, value: 1 },
			{ field: "b", operator: "eq" as const, value: 99 },
		];
		const resolve = (f: string) => (f === "a" ? 1 : f === "b" ? 2 : undefined);
		expect(conditionsPass(conditions, resolve, "any")).toBe(true);
	});

	it("conditionsPass — empty conditions returns true", () => {
		expect(conditionsPass(undefined, () => undefined)).toBe(true);
		expect(conditionsPass([], () => undefined)).toBe(true);
	});
});

describe("preference conditions in preferenceGate", () => {
	it("workflow-level condition blocks when not met", () => {
		const meta: WorkflowMeta = {
			workflowId: "premium-feature",
			preferences: {
				conditions: [{ field: "subscriber.data.plan", operator: "ne", value: "free" }],
			},
		};
		const condCtx: ConditionContext = {
			subscriber: { id: "s1", externalId: "e1", data: { plan: "free" } },
			payload: {},
		};
		const result = preferenceGate({ subscriberPrefs: undefined, workflowMeta: meta, channel: "email", conditionContext: condCtx });
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("condition not met");
	});

	it("workflow-level condition allows when met", () => {
		const meta: WorkflowMeta = {
			workflowId: "premium-feature",
			preferences: {
				conditions: [{ field: "subscriber.data.plan", operator: "ne", value: "free" }],
			},
		};
		const condCtx: ConditionContext = {
			subscriber: { id: "s1", externalId: "e1", data: { plan: "pro" } },
			payload: {},
		};
		const result = preferenceGate({ subscriberPrefs: undefined, workflowMeta: meta, channel: "email", conditionContext: condCtx });
		expect(result.allowed).toBe(true);
	});

	it("subscriber-level workflow condition blocks", () => {
		const prefs: PreferenceRecord = {
			subscriberId: "s1",
			workflows: {
				"feature-update": {
					enabled: true,
					conditions: [{ field: "payload.priority", operator: "eq", value: "high" }],
				},
			},
		};
		const meta: WorkflowMeta = { workflowId: "feature-update" };
		const condCtx: ConditionContext = {
			subscriber: { id: "s1", externalId: "e1" },
			payload: { priority: "low" },
		};
		const result = preferenceGate({ subscriberPrefs: prefs, workflowMeta: meta, channel: "email", conditionContext: condCtx });
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("condition not met");
	});

	it("subscriber-level workflow condition allows when met", () => {
		const prefs: PreferenceRecord = {
			subscriberId: "s1",
			workflows: {
				"feature-update": {
					enabled: true,
					conditions: [{ field: "payload.priority", operator: "eq", value: "high" }],
				},
			},
		};
		const meta: WorkflowMeta = { workflowId: "feature-update" };
		const condCtx: ConditionContext = {
			subscriber: { id: "s1", externalId: "e1" },
			payload: { priority: "high" },
		};
		const result = preferenceGate({ subscriberPrefs: prefs, workflowMeta: meta, channel: "email", conditionContext: condCtx });
		expect(result.allowed).toBe(true);
	});

	it("conditions not evaluated when conditionContext is not provided", () => {
		const meta: WorkflowMeta = {
			workflowId: "premium-feature",
			preferences: {
				conditions: [{ field: "subscriber.data.plan", operator: "ne", value: "free" }],
			},
		};
		// No conditionContext — conditions should be skipped, gate passes
		const result = preferenceGate({ subscriberPrefs: undefined, workflowMeta: meta, channel: "email" });
		expect(result.allowed).toBe(true);
	});

	it("workflow condition on missing nested path — exists is false, comparisons do not match absent plan", () => {
		const meta: WorkflowMeta = {
			workflowId: "tiered",
			preferences: {
				conditions: [
					{ field: "subscriber.data.plan", operator: "exists", value: true },
					{ field: "subscriber.data.plan", operator: "eq", value: "pro" },
				],
			},
		};
		const condCtx: ConditionContext = {
			subscriber: { id: "s1", externalId: "e1" },
			payload: {},
		};
		const existsOnly = preferenceGate({
			subscriberPrefs: undefined,
			workflowMeta: {
				...meta,
				preferences: { conditions: [{ field: "subscriber.data.plan", operator: "exists", value: true }] },
			},
			channel: "email",
			conditionContext: condCtx,
		});
		expect(existsOnly.allowed).toBe(false);

		const eqResult = preferenceGate({
			subscriberPrefs: undefined,
			workflowMeta: meta,
			channel: "email",
			conditionContext: condCtx,
		});
		expect(eqResult.allowed).toBe(false);
	});
});

// ---- Feature 5: Bulk Preference API ----

describe("bulk preference updates", () => {
	let app: Herald;

	beforeEach(async () => {
		const db = memoryAdapter();
		const wf = memoryWorkflowAdapter();
		app = herald({ database: db, workflow: wf, workflows: [] });

		await app.api.upsertSubscriber({ externalId: "user-1" });
		await app.api.upsertSubscriber({ externalId: "user-2" });
		await app.api.upsertSubscriber({ externalId: "user-3" });
	});

	it("bulkUpdatePreferences updates multiple subscribers", async () => {
		const results = await app.api.bulkUpdatePreferences([
			{ subscriberId: "user-1", preferences: { channels: { email: false } } },
			{ subscriberId: "user-2", preferences: { channels: { sms: false } } },
		]);

		expect(results).toHaveLength(2);
		expect(results[0]?.preferences?.channels?.email).toBe(false);
		expect(results[1]?.preferences?.channels?.sms).toBe(false);
		expect(results[0]?.error).toBeUndefined();
		expect(results[1]?.error).toBeUndefined();
	});

	it("bulkUpdatePreferences chains patches for the same subscriber in order", async () => {
		const results = await app.api.bulkUpdatePreferences([
			{ subscriberId: "user-1", preferences: { channels: { email: false } } },
			{ subscriberId: "user-1", preferences: { channels: { sms: false } } },
		]);

		expect(results).toHaveLength(2);
		expect(results[0]?.preferences?.channels?.email).toBe(false);
		expect(results[1]?.preferences?.channels?.email).toBe(false);
		expect(results[1]?.preferences?.channels?.sms).toBe(false);
		expect(results[0]?.error).toBeUndefined();
		expect(results[1]?.error).toBeUndefined();
	});

	it("bulkUpdatePreferences reports errors for unknown subscribers", async () => {
		const results = await app.api.bulkUpdatePreferences([
			{ subscriberId: "user-1", preferences: { channels: { email: false } } },
			{ subscriberId: "nonexistent", preferences: { channels: { sms: false } } },
		]);

		expect(results).toHaveLength(2);
		expect(results[0]?.preferences).toBeDefined();
		expect(results[1]?.error).toBeDefined();
	});

	it("bulkUpdatePreferences rejects more than 100 updates", async () => {
		const updates = Array.from({ length: 101 }, (_, i) => ({
			subscriberId: `user-${i}`,
			preferences: { channels: { email: false } },
		}));

		await expect(app.api.bulkUpdatePreferences(updates)).rejects.toThrow("maximum of 100");
	});

	it("bulkUpdatePreferences accepts empty updates array", async () => {
		const results = await app.api.bulkUpdatePreferences([]);
		expect(results).toEqual([]);
	});

	it("bulk REST endpoint works", async () => {
		const basePath = "/api/notifications";
		const request = new Request(`http://localhost${basePath}/preferences/bulk`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				updates: [
					{ subscriberId: "user-1", channels: { email: false } },
					{ subscriberId: "user-2", channels: { push: true } },
				],
			}),
		});

		const response = await app.handler(request);
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.results).toHaveLength(2);
	});

	it("bulk REST endpoint returns 207 for partial failures", async () => {
		const basePath = "/api/notifications";
		const request = new Request(`http://localhost${basePath}/preferences/bulk`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				updates: [
					{ subscriberId: "user-1", channels: { email: false } },
					{ subscriberId: "unknown-user", channels: { email: false } },
				],
			}),
		});

		const response = await app.handler(request);
		expect(response.status).toBe(207);
		const body = await response.json();
		expect(body.results[0].preferences).toBeDefined();
		expect(body.results[1].error).toBe("Subscriber not found");
	});

	it("bulk REST endpoint returns 400 for missing updates array", async () => {
		const basePath = "/api/notifications";
		const request = new Request(`http://localhost${basePath}/preferences/bulk`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});

		const response = await app.handler(request);
		expect(response.status).toBe(400);
	});

	it("bulk REST endpoint accepts empty updates array", async () => {
		const basePath = "/api/notifications";
		const request = new Request(`http://localhost${basePath}/preferences/bulk`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ updates: [] }),
		});

		const response = await app.handler(request);
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.results).toEqual([]);
	});

	it("bulk REST endpoint returns 400 for invalid payload shapes", async () => {
		const basePath = "/api/notifications";
		const request = new Request(`http://localhost${basePath}/preferences/bulk`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				updates: [{ subscriberId: "user-1", channels: { email: "no" } }],
			}),
		});

		const response = await app.handler(request);
		expect(response.status).toBe(400);
	});
});

// ---- ReadOnly metadata in GET response ----

describe("readOnly metadata in preference GET response", () => {
	it("includes readOnlyChannels in GET response", async () => {
		const db = memoryAdapter();
		const wf = memoryWorkflowAdapter();
		const readOnlyWorkflow: NotificationWorkflow = {
			id: "account-alert",
			name: "Account Alert",
			preferences: { channels: { email: { enabled: true, readOnly: true }, in_app: { enabled: true } } },
			steps: [{ stepId: "send", type: "email", handler: async () => ({ subject: "Hi", body: "Test" }) }],
		};

		const app = herald({ database: db, workflow: wf, workflows: [readOnlyWorkflow] });
		await app.api.upsertSubscriber({ externalId: "user-1" });

		const response = await app.handler(new Request("http://localhost/api/notifications/subscribers/user-1/preferences"));
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.readOnlyChannels).toBeDefined();
		expect(body.readOnlyChannels["account-alert"]?.email).toBe(true);
		expect(body.readOnlyChannels["account-alert"]?.in_app).toBeUndefined();
	});
});

// ---- Edge case: Operator enforced vs ReadOnly interaction ----

describe("operator enforced vs readOnly interaction", () => {
	// Operator tier is step 2; readOnly author defaults are step 3 — enforced operator always wins when both apply.

	it("operator enforced disable takes precedence over readOnly enable", () => {
		const opPrefs: OperatorPreferences = {
			channels: { email: { enabled: false, enforce: true } },
		};
		const meta: WorkflowMeta = {
			workflowId: "alerts",
			preferences: { channels: { email: { enabled: true, readOnly: true } } },
		};
		const result = preferenceGate({ workflowMeta: meta, channel: "email", operatorPreferences: opPrefs });
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("operator enforced");
	});

	it("operator enforced enable takes precedence over readOnly disable", () => {
		const opPrefs: OperatorPreferences = {
			channels: { email: { enabled: true, enforce: true } },
		};
		const meta: WorkflowMeta = {
			workflowId: "legacy",
			preferences: { channels: { email: { enabled: false, readOnly: true } } },
		};
		const result = preferenceGate({ workflowMeta: meta, channel: "email", operatorPreferences: opPrefs });
		expect(result.allowed).toBe(true);
		expect(result.reason).toContain("operator enforced");
	});
});

// ---- Edge case: Category enabled short-circuits to allow ----

describe("category enabled short-circuits to allow", () => {
	it("category enabled overrides purpose disabled below it", () => {
		const prefs: PreferenceRecord = {
			subscriberId: "s1",
			categories: { marketing: { enabled: true } },
			purposes: { promotional: false },
		};
		const meta: WorkflowMeta = { workflowId: "promo", category: "marketing", purpose: "promotional" };
		const result = preferenceGate({ subscriberPrefs: prefs, workflowMeta: meta, channel: "email" });
		expect(result.allowed).toBe(true);
		expect(result.reason).toContain("subscriber enabled category");
	});

	it("purpose disabled blocks when workflow has category but subscriber never set category (step 6 skipped, step 7 applies)", () => {
		const prefs: PreferenceRecord = {
			subscriberId: "s1",
			purposes: { promotional: false },
		};
		const meta: WorkflowMeta = { workflowId: "promo", category: "marketing", purpose: "promotional" };
		const result = preferenceGate({ subscriberPrefs: prefs, workflowMeta: meta, channel: "email" });
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("purpose");
		expect(result.reason).toContain("promotional");
	});

	it("category enabled overrides config default disabled below it", () => {
		const prefs: PreferenceRecord = {
			subscriberId: "s1",
			categories: { marketing: { enabled: true } },
		};
		const meta: WorkflowMeta = { workflowId: "promo", category: "marketing" };
		const defaults = { channels: { email: false as const } };
		const result = preferenceGate({ subscriberPrefs: prefs, workflowMeta: meta, channel: "email", defaultPreferences: defaults });
		expect(result.allowed).toBe(true);
		expect(result.reason).toContain("subscriber enabled category");
	});
});

// ---- Edge case: exists operator with value: false ----

describe("exists operator with value: false", () => {
	it("value: false checks for non-existence", () => {
		expect(evaluateCondition({ field: "x", operator: "exists", value: false }, undefined)).toBe(true);
		expect(evaluateCondition({ field: "x", operator: "exists", value: false }, null)).toBe(true);
	});

	it("value: false fails when field exists", () => {
		expect(evaluateCondition({ field: "x", operator: "exists", value: false }, "hello")).toBe(false);
		expect(evaluateCondition({ field: "x", operator: "exists", value: false }, 0)).toBe(false);
	});
});

// ---- Edge case: Boolean-to-object migration normalizer ----

describe("normalizePreferenceRecord", () => {
	it("coerces boolean workflow values to object form", () => {
		const raw = {
			subscriberId: "s1",
			workflows: { "wf-1": true, "wf-2": false },
		} as unknown as PreferenceRecord;

		const normalized = normalizePreferenceRecord(raw);
		expect(normalized.workflows?.["wf-1"]).toEqual({ enabled: true });
		expect(normalized.workflows?.["wf-2"]).toEqual({ enabled: false });
	});

	it("coerces boolean category values to object form", () => {
		const raw = {
			subscriberId: "s1",
			categories: { marketing: true, billing: false },
		} as unknown as PreferenceRecord;

		const normalized = normalizePreferenceRecord(raw);
		expect(normalized.categories?.marketing).toEqual({ enabled: true });
		expect(normalized.categories?.billing).toEqual({ enabled: false });
	});

	it("leaves already-normalized values unchanged", () => {
		const raw: PreferenceRecord = {
			subscriberId: "s1",
			workflows: { "wf-1": { enabled: true, channels: { email: false } } },
			categories: { marketing: { enabled: true, channels: { sms: false } } },
		};

		const normalized = normalizePreferenceRecord(raw);
		expect(normalized.workflows?.["wf-1"]).toEqual({ enabled: true, channels: { email: false } });
		expect(normalized.categories?.marketing).toEqual({ enabled: true, channels: { sms: false } });
	});

	it("handles missing workflows and categories gracefully", () => {
		const raw: PreferenceRecord = { subscriberId: "s1" };
		const normalized = normalizePreferenceRecord(raw);
		expect(normalized).toEqual(raw);
	});
});

// ---- Edge case: readOnly enforcement at API write layer ----

describe("readOnly enforcement at API write layer", () => {
	it("deepMerge replaces workflow conditions when patch includes an explicit conditions array", async () => {
		const db = memoryAdapter();
		const wf = memoryWorkflowAdapter();
		const workflow: NotificationWorkflow = {
			id: "wf-cond",
			name: "WF",
			steps: [{ stepId: "send", type: "email", handler: async () => ({ subject: "Hi", body: "Test" }) }],
		};

		const app = herald({
			database: db,
			workflow: wf,
			workflows: [workflow],
			channels: { email: { provider: "custom", from: "a@b.com", send: async () => {} } },
		});
		const { id: subscriberId } = await app.api.upsertSubscriber({ externalId: "user-1" });

		await app.api.updatePreferences(subscriberId, {
			workflows: {
				"wf-cond": {
					enabled: true,
					conditions: [{ field: "payload.x", operator: "eq", value: 1 }],
				},
			},
		});

		await app.api.updatePreferences(subscriberId, {
			workflows: { "wf-cond": { enabled: true, conditions: [] } },
		});

		const prefs = await app.api.getPreferences(subscriberId);
		expect(prefs.workflows?.["wf-cond"]?.conditions).toEqual([]);
	});

	it("strips readOnly global channel contradictions from updatePreferences", async () => {
		const db = memoryAdapter();
		const wf = memoryWorkflowAdapter();
		const workflow: NotificationWorkflow = {
			id: "secure-alerts",
			name: "Secure Alerts",
			preferences: { channels: { email: { enabled: true, readOnly: true } } },
			steps: [{ stepId: "send", type: "email", handler: async () => ({ subject: "Alert", body: "Test" }) }],
		};

		const app = herald({ database: db, workflow: wf, workflows: [workflow] });
		const { id: subscriberId } = await app.api.upsertSubscriber({ externalId: "user-1" });

		// Try to set global channel email=false which contradicts readOnly email=true
		await app.api.updatePreferences(subscriberId, { channels: { email: false } });

		const prefs = await app.api.getPreferences(subscriberId);
		// The global email=false should be stripped since email is readOnly for secure-alerts
		expect(prefs.channels?.email).toBeUndefined();
	});

	it("strips readOnly channel overrides from updatePreferences", async () => {
		const db = memoryAdapter();
		const wf = memoryWorkflowAdapter();
		const workflow: NotificationWorkflow = {
			id: "secure-alerts",
			name: "Secure Alerts",
			preferences: { channels: { email: { enabled: true, readOnly: true } } },
			steps: [{ stepId: "send", type: "email", handler: async () => ({ subject: "Alert", body: "Test" }) }],
		};

		const app = herald({ database: db, workflow: wf, workflows: [workflow] });
		const { id: subscriberId } = await app.api.upsertSubscriber({ externalId: "user-1" });

		// Try to override the readOnly channel via workflow-specific preferences
		await app.api.updatePreferences(subscriberId, {
			workflows: { "secure-alerts": { enabled: true, channels: { email: false } } },
		});

		const prefs = await app.api.getPreferences(subscriberId);
		// The email channel override for secure-alerts should have been stripped
		expect(prefs.workflows?.["secure-alerts"]?.channels?.email).toBeUndefined();
	});
});

// ---- Item #7: deepMerge non-POJO safety ----

describe("deepMerge non-POJO handling", () => {
	it("treats Date instances as primitives, not objects to recurse into", () => {
		const base = { createdAt: new Date("2025-01-01") } as Record<string, unknown>;
		const patch = { createdAt: new Date("2026-01-01") } as Record<string, unknown>;
		const result = deepMerge(base, patch);
		expect(result.createdAt).toBeInstanceOf(Date);
		expect((result.createdAt as Date).toISOString()).toBe("2026-01-01T00:00:00.000Z");
	});

	it("does not spread RegExp or Map instances", () => {
		const base = { pattern: /abc/ } as Record<string, unknown>;
		const patch = { pattern: /xyz/ } as Record<string, unknown>;
		const result = deepMerge(base, patch);
		expect(result.pattern).toBeInstanceOf(RegExp);
		expect((result.pattern as RegExp).source).toBe("xyz");
	});
});

// ---- Item #8: normalizePreferenceRecord validation ----

describe("normalizePreferenceRecord validation", () => {
	it("drops non-boolean non-object workflow values", () => {
		// biome-ignore lint/suspicious/noExplicitAny: testing invalid data from corrupt database
		const raw = { subscriberId: "s1", workflows: { wf: "garbage" as any } };
		const result = normalizePreferenceRecord(raw);
		expect(result.workflows?.wf).toBeUndefined();
	});

	it("drops non-boolean non-object category values", () => {
		// biome-ignore lint/suspicious/noExplicitAny: testing invalid data from corrupt database
		const raw = { subscriberId: "s1", categories: { cat: 42 as any } };
		const result = normalizePreferenceRecord(raw);
		expect(result.categories?.cat).toBeUndefined();
	});

	it("preserves valid boolean and object values", () => {
		const raw: PreferenceRecord = {
			subscriberId: "s1",
			// biome-ignore lint/suspicious/noExplicitAny: testing legacy boolean format
			workflows: { wf: true as any, wf2: { enabled: false } },
			// biome-ignore lint/suspicious/noExplicitAny: testing legacy boolean format
			categories: { cat: false as any, cat2: { enabled: true } },
		};
		const result = normalizePreferenceRecord(raw);
		expect(result.workflows?.wf).toEqual({ enabled: true });
		expect(result.workflows?.wf2).toEqual({ enabled: false });
		expect(result.categories?.cat).toEqual({ enabled: false });
		expect(result.categories?.cat2).toEqual({ enabled: true });
	});
});

// ---- Item #9: TOCTOU race in upsertPreferenceInternal ----

describe("upsertPreferenceInternal TOCTOU handling", () => {
	it("handles concurrent create race with retry", async () => {
		const db = memoryAdapter();
		const wf = memoryWorkflowAdapter();
		const app = herald({ database: db, workflow: wf, workflows: [] });
		const { id: subscriberId } = await app.api.upsertSubscriber({ externalId: "user-race" });

		// Simulate concurrent preference updates - both should succeed, not throw
		const [result1, result2] = await Promise.all([
			app.api.updatePreferences(subscriberId, { channels: { email: true } }),
			app.api.updatePreferences(subscriberId, { channels: { sms: false } }),
		]);
		expect(result1).toBeDefined();
		expect(result2).toBeDefined();

		const prefs = await app.api.getPreferences(subscriberId);
		// At least one of the updates should be reflected
		expect(prefs.subscriberId).toBeDefined();
	});
});

// ---- Item #10: Bulk update in-memory record stripping undefined ----

describe("bulkUpdatePreferences chained updates consistency", () => {
	it("chained updates for same subscriber produce consistent merged state", async () => {
		const db = memoryAdapter();
		const wf = memoryWorkflowAdapter();
		const app = herald({ database: db, workflow: wf, workflows: [] });
		await app.api.upsertSubscriber({ externalId: "user-chain" });

		const results = await app.api.bulkUpdatePreferences([
			{ subscriberId: "user-chain", preferences: { channels: { email: true } } },
			{ subscriberId: "user-chain", preferences: { channels: { sms: false } } },
			{ subscriberId: "user-chain", preferences: { purposes: { marketing: false } } },
		]);

		expect(results.every((r) => !r.error)).toBe(true);
		const lastResult = results[results.length - 1];
		expect(lastResult.preferences?.channels?.email).toBe(true);
		expect(lastResult.preferences?.channels?.sms).toBe(false);
		expect(lastResult.preferences?.purposes?.marketing).toBe(false);

		// Verify DB is consistent with the last returned record
		const stored = await app.api.getPreferences("user-chain");
		expect(stored.channels?.email).toBe(true);
		expect(stored.channels?.sms).toBe(false);
		expect(stored.purposes?.marketing).toBe(false);
	});
});

// ---- Item #11: Silent field prefix typos in conditions ----

describe("evaluatePreferenceConditions field prefix warning", () => {
	it("workflow condition with unrecognized field prefix logs a warning", async () => {
		const db = memoryAdapter();
		const wf = memoryWorkflowAdapter();
		const workflow: NotificationWorkflow = {
			id: "typo-wf",
			name: "Typo",
			preferences: { conditions: [{ field: "subscribr.plan", operator: "eq", value: "pro" }] },
			steps: [{ stepId: "send", type: "email", handler: async () => ({ subject: "Hi", body: "Test" }) }],
		};
		const warnings: string[] = [];
		const origWarn = console.warn;
		console.warn = (...args: unknown[]) => {
			warnings.push(String(args[0]));
		};
		try {
			const result = preferenceGate({
				workflowMeta: {
					workflowId: "typo-wf",
					preferences: { conditions: [{ field: "subscribr.plan", operator: "eq", value: "pro" }] },
				},
				channel: "email",
				conditionContext: {
					subscriber: { id: "1", externalId: "ext-1" } as SubscriberData,
					payload: {},
				},
			});
			// The condition should fail (field resolves to undefined) and block
			expect(result.allowed).toBe(false);
			// A warning should have been logged about the unrecognized prefix
			expect(warnings.some((w) => w.includes("subscribr.plan"))).toBe(true);
		} finally {
			console.warn = origWarn;
		}
	});
});

// ---- Item #12: Condition mode for preference conditions ----

describe("preference condition mode", () => {
	it("workflow conditions support any mode (allow if any condition passes)", () => {
		const result = preferenceGate({
			workflowMeta: {
				workflowId: "any-mode-wf",
				preferences: {
					conditions: [
						{ field: "payload.plan", operator: "eq", value: "pro" },
						{ field: "payload.plan", operator: "eq", value: "enterprise" },
					],
					conditionMode: "any",
				},
			},
			channel: "email",
			conditionContext: {
				subscriber: { id: "1", externalId: "ext-1" } as SubscriberData,
				payload: { plan: "enterprise" },
			},
		});
		// With "any" mode, one matching condition should be enough
		expect(result.allowed).toBe(true);
	});

	it("workflow conditions default to all mode", () => {
		const result = preferenceGate({
			workflowMeta: {
				workflowId: "all-mode-wf",
				preferences: {
					conditions: [
						{ field: "payload.plan", operator: "eq", value: "pro" },
						{ field: "payload.active", operator: "eq", value: true },
					],
				},
			},
			channel: "email",
			conditionContext: {
				subscriber: { id: "1", externalId: "ext-1" } as SubscriberData,
				payload: { plan: "pro", active: false },
			},
		});
		// With "all" mode, both must pass — active=false fails
		expect(result.allowed).toBe(false);
	});
});
