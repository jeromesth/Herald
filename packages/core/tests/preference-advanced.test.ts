import { beforeEach, describe, expect, it } from "vitest";
import { memoryAdapter } from "../src/adapters/database/memory.js";
import { memoryWorkflowAdapter } from "../src/adapters/workflow/memory.js";
import { conditionsPass, evaluateCondition, resolvePath } from "../src/core/conditions.js";
import { herald } from "../src/core/herald.js";
import { preferenceGate } from "../src/core/preferences.js";
import type { ConditionContext, WorkflowMeta } from "../src/core/preferences.js";
import type { CategoryPreference, Herald, NotificationWorkflow, OperatorPreferences, PreferenceRecord } from "../src/types/index.js";

// ---- Feature 1: Category-Channel Granularity ----

describe("category-channel preferences", () => {
	const baseMeta: WorkflowMeta = { workflowId: "promo-email", category: "marketing" };

	it("category disabled — blocked", () => {
		const prefs: PreferenceRecord = {
			subscriberId: "s1",
			categories: { marketing: { enabled: false } },
		};
		const result = preferenceGate(prefs, baseMeta, "email");
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("category");
		expect(result.reason).toContain("marketing");
	});

	it("category enabled but specific channel disabled — blocked for that channel", () => {
		const prefs: PreferenceRecord = {
			subscriberId: "s1",
			categories: { marketing: { enabled: true, channels: { email: false } } },
		};
		const emailResult = preferenceGate(prefs, baseMeta, "email");
		expect(emailResult.allowed).toBe(false);
		expect(emailResult.reason).toContain("channel");
		expect(emailResult.reason).toContain("category");

		const inAppResult = preferenceGate(prefs, baseMeta, "in_app");
		expect(inAppResult.allowed).toBe(true);
	});

	it("category enabled — allowed", () => {
		const prefs: PreferenceRecord = {
			subscriberId: "s1",
			categories: { marketing: { enabled: true } },
		};
		const result = preferenceGate(prefs, baseMeta, "email");
		expect(result.allowed).toBe(true);
	});

	it("no category on workflow — category prefs ignored", () => {
		const prefs: PreferenceRecord = {
			subscriberId: "s1",
			categories: { marketing: { enabled: false } },
		};
		const meta: WorkflowMeta = { workflowId: "promo-email" }; // no category
		const result = preferenceGate(prefs, meta, "email");
		expect(result.allowed).toBe(true);
	});

	it("config default category disabled — blocked", () => {
		const meta: WorkflowMeta = { workflowId: "promo-email", category: "marketing" };
		const defaults = { categories: { marketing: { enabled: false } } };
		const result = preferenceGate(undefined, meta, "email", defaults);
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
		const result = preferenceGate(prefs, meta, "email");
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
		const result = preferenceGate(prefs, meta, "email");
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
		const result = preferenceGate(prefs, meta, "email");
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
		const result = preferenceGate(prefs, meta, "email");
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
		const result = preferenceGate(prefs, meta, "sms", undefined, opPrefs);
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
		const result = preferenceGate(prefs, meta, "email", undefined, opPrefs);
		expect(result.allowed).toBe(true);
		expect(result.reason).toContain("operator enforced");
	});

	it("non-enforced operator default acts as fallback", () => {
		const opPrefs: OperatorPreferences = {
			channels: { push: { enabled: false } },
		};
		const meta: WorkflowMeta = { workflowId: "push-wf" };
		// No subscriber prefs, no config defaults — operator default kicks in
		const result = preferenceGate(undefined, meta, "push", undefined, opPrefs);
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
		const result = preferenceGate(prefs, meta, "push", undefined, opPrefs);
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
		const result = preferenceGate(prefs, meta, "email", undefined, opPrefs);
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
		const result = preferenceGate(prefs, meta, "email", undefined, opPrefs);
		expect(result.allowed).toBe(true);
		expect(result.reason).toContain("operator enforced purpose");
	});

	it("critical bypass takes precedence over operator overrides", () => {
		const opPrefs: OperatorPreferences = {
			channels: { email: { enabled: false, enforce: true } },
		};
		const meta: WorkflowMeta = { workflowId: "critical-wf", critical: true };
		const result = preferenceGate(undefined, meta, "email", undefined, opPrefs);
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
	});

	it("evaluateCondition — in/not_in", () => {
		expect(evaluateCondition({ field: "x", operator: "in", value: ["a", "b"] }, "a")).toBe(true);
		expect(evaluateCondition({ field: "x", operator: "not_in", value: ["a", "b"] }, "c")).toBe(true);
	});

	it("evaluateCondition — exists", () => {
		expect(evaluateCondition({ field: "x", operator: "exists", value: true }, "hello")).toBe(true);
		expect(evaluateCondition({ field: "x", operator: "exists", value: true }, undefined)).toBe(false);
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
		const result = preferenceGate(undefined, meta, "email", undefined, undefined, condCtx);
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
		const result = preferenceGate(undefined, meta, "email", undefined, undefined, condCtx);
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
		const result = preferenceGate(prefs, meta, "email", undefined, undefined, condCtx);
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
		const result = preferenceGate(prefs, meta, "email", undefined, undefined, condCtx);
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
		const result = preferenceGate(undefined, meta, "email");
		expect(result.allowed).toBe(true);
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
