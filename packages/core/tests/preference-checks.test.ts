import { describe, expect, it } from "vitest";
import {
	authorChannelDefault,
	categoryPreference,
	channelKillSwitch,
	criticalBypass,
	defaultCategory,
	defaultChannelPref,
	defaultPurpose,
	defaultWorkflow,
	operatorEnforced,
	preferenceChecks,
	preferenceGate,
	purposePreference,
	readOnlyChannel,
	workflowConditions,
	workflowPreference,
} from "../src/core/preferences.js";
import type { PreferenceCheck, PreferenceGateInput, WorkflowMeta } from "../src/core/preferences.js";
import type { NotificationWorkflow, SubscriberData } from "../src/types/workflow.js";

// ---- Item #16: Chain array integrity ----

describe("preferenceChecks chain integrity", () => {
	it("has exactly 13 checks in the correct order", () => {
		expect(preferenceChecks).toHaveLength(13);
		expect(preferenceChecks[0]).toBe(criticalBypass);
		expect(preferenceChecks[1]).toBe(operatorEnforced);
		expect(preferenceChecks[2]).toBe(readOnlyChannel);
		expect(preferenceChecks[3]).toBe(channelKillSwitch);
		expect(preferenceChecks[4]).toBe(workflowPreference);
		expect(preferenceChecks[5]).toBe(categoryPreference);
		expect(preferenceChecks[6]).toBe(purposePreference);
		expect(preferenceChecks[7]).toBe(workflowConditions);
		expect(preferenceChecks[8]).toBe(authorChannelDefault);
		expect(preferenceChecks[9]).toBe(defaultWorkflow);
		expect(preferenceChecks[10]).toBe(defaultPurpose);
		expect(preferenceChecks[11]).toBe(defaultCategory);
		expect(preferenceChecks[12]).toBe(defaultChannelPref);
	});

	it("is frozen and cannot be mutated", () => {
		expect(() => {
			(preferenceChecks as PreferenceCheck[]).push(criticalBypass);
		}).toThrow();
	});
});

// ---- Item #15: Individual check function tests ----
// ---- Item #17: readOnly + authorChannelDefault ordering ----

describe("individual check functions", () => {
	const baseMeta: WorkflowMeta = { workflowId: "wf-1" };
	const baseInput: PreferenceGateInput = { workflowMeta: baseMeta, channel: "email" };

	// -- criticalBypass --
	describe("criticalBypass", () => {
		it("returns allowed when critical is true", () => {
			const result = criticalBypass({ ...baseInput, workflowMeta: { ...baseMeta, critical: true } });
			expect(result).toEqual({ allowed: true, reason: "critical" });
		});

		it("returns null when not critical", () => {
			expect(criticalBypass(baseInput)).toBeNull();
		});
	});

	// -- operatorEnforced --
	describe("operatorEnforced", () => {
		it("returns null when no operator preferences", () => {
			expect(operatorEnforced(baseInput)).toBeNull();
		});

		it("enforced channel blocks despite other preferences", () => {
			const result = operatorEnforced({
				...baseInput,
				operatorPreferences: { channels: { email: { enabled: false, enforce: true } } },
			});
			expect(result).toEqual({ allowed: false, reason: 'operator enforced channel "email" disabled' });
		});

		it("enforced workflow allows", () => {
			const result = operatorEnforced({
				...baseInput,
				operatorPreferences: { workflows: { "wf-1": { enabled: true, enforce: true } } },
			});
			expect(result).toEqual({ allowed: true, reason: 'operator enforced workflow "wf-1" enabled' });
		});

		it("enforced category blocks", () => {
			const result = operatorEnforced({
				...baseInput,
				workflowMeta: { ...baseMeta, category: "promo" },
				operatorPreferences: { categories: { promo: { enabled: false, enforce: true } } },
			});
			expect(result).toEqual({ allowed: false, reason: 'operator enforced category "promo" disabled' });
		});

		it("enforced purpose blocks", () => {
			const result = operatorEnforced({
				...baseInput,
				workflowMeta: { ...baseMeta, purpose: "marketing" },
				operatorPreferences: { purposes: { marketing: { enabled: false, enforce: true } } },
			});
			expect(result).toEqual({ allowed: false, reason: 'operator enforced purpose "marketing" disabled' });
		});

		it("channel enforcement wins over workflow enforcement", () => {
			const result = operatorEnforced({
				...baseInput,
				operatorPreferences: {
					channels: { email: { enabled: false, enforce: true } },
					workflows: { "wf-1": { enabled: true, enforce: true } },
				},
			});
			expect(result).not.toBeNull();
			expect(result?.allowed).toBe(false);
			expect(result?.reason).toContain("channel");
		});

		it("non-enforced operator preferences return null", () => {
			const result = operatorEnforced({
				...baseInput,
				operatorPreferences: { channels: { email: { enabled: false } } },
			});
			expect(result).toBeNull();
		});
	});

	// -- readOnlyChannel --
	describe("readOnlyChannel", () => {
		it("returns null when no readOnly", () => {
			expect(readOnlyChannel(baseInput)).toBeNull();
		});

		it("forces delivery when readOnly enabled", () => {
			const result = readOnlyChannel({
				...baseInput,
				workflowMeta: { ...baseMeta, preferences: { channels: { email: { enabled: true, readOnly: true } } } },
			});
			expect(result).toEqual({ allowed: true, reason: 'readOnly channel "email" for workflow "wf-1" enabled' });
		});

		it("blocks delivery when readOnly disabled", () => {
			const result = readOnlyChannel({
				...baseInput,
				workflowMeta: { ...baseMeta, preferences: { channels: { email: { enabled: false, readOnly: true } } } },
			});
			expect(result).toEqual({ allowed: false, reason: 'readOnly channel "email" for workflow "wf-1" disabled' });
		});
	});

	// -- channelKillSwitch --
	describe("channelKillSwitch", () => {
		it("returns null when no subscriber prefs", () => {
			expect(channelKillSwitch(baseInput)).toBeNull();
		});

		it("blocks when channel is false", () => {
			const result = channelKillSwitch({ ...baseInput, subscriberPrefs: { subscriberId: "s1", channels: { email: false } } });
			expect(result).toEqual({ allowed: false, reason: 'subscriber disabled channel "email"' });
		});

		it("allows when channel is explicitly true", () => {
			const result = channelKillSwitch({ ...baseInput, subscriberPrefs: { subscriberId: "s1", channels: { email: true } } });
			expect(result).toEqual({ allowed: true, reason: 'subscriber enabled channel "email"' });
		});

		it("returns null when channel is not set", () => {
			const result = channelKillSwitch({ ...baseInput, subscriberPrefs: { subscriberId: "s1", channels: { sms: false } } });
			expect(result).toBeNull();
		});
	});

	// -- workflowPreference --
	describe("workflowPreference", () => {
		it("returns null when no workflow pref set", () => {
			expect(workflowPreference(baseInput)).toBeNull();
		});

		it("blocks when workflow disabled", () => {
			const result = workflowPreference({
				...baseInput,
				subscriberPrefs: { subscriberId: "s1", workflows: { "wf-1": { enabled: false } } },
			});
			expect(result).toEqual({ allowed: false, reason: 'subscriber disabled workflow "wf-1"' });
		});

		it("allows when workflow enabled", () => {
			const result = workflowPreference({
				...baseInput,
				subscriberPrefs: { subscriberId: "s1", workflows: { "wf-1": { enabled: true } } },
			});
			expect(result).toEqual({ allowed: true, reason: 'subscriber enabled workflow "wf-1"' });
		});

		it("blocks when workflow enabled but channel disabled", () => {
			const result = workflowPreference({
				...baseInput,
				subscriberPrefs: { subscriberId: "s1", workflows: { "wf-1": { enabled: true, channels: { email: false } } } },
			});
			expect(result).toEqual({ allowed: false, reason: 'subscriber disabled channel "email" for workflow "wf-1"' });
		});
	});

	// -- categoryPreference --
	describe("categoryPreference", () => {
		it("returns null when no category on workflow", () => {
			expect(categoryPreference(baseInput)).toBeNull();
		});

		it("returns null when category not in subscriber prefs", () => {
			const result = categoryPreference({
				...baseInput,
				workflowMeta: { ...baseMeta, category: "news" },
				subscriberPrefs: { subscriberId: "s1" },
			});
			expect(result).toBeNull();
		});

		it("blocks when category disabled", () => {
			const result = categoryPreference({
				...baseInput,
				workflowMeta: { ...baseMeta, category: "news" },
				subscriberPrefs: { subscriberId: "s1", categories: { news: { enabled: false } } },
			});
			expect(result).toEqual({ allowed: false, reason: 'subscriber disabled category "news"' });
		});

		it("allows when category enabled", () => {
			const result = categoryPreference({
				...baseInput,
				workflowMeta: { ...baseMeta, category: "news" },
				subscriberPrefs: { subscriberId: "s1", categories: { news: { enabled: true } } },
			});
			expect(result).toEqual({ allowed: true, reason: 'subscriber enabled category "news"' });
		});
	});

	// -- purposePreference --
	describe("purposePreference", () => {
		it("returns null when no purpose on workflow", () => {
			expect(purposePreference(baseInput)).toBeNull();
		});

		it("blocks when purpose is false", () => {
			const result = purposePreference({
				...baseInput,
				workflowMeta: { ...baseMeta, purpose: "marketing" },
				subscriberPrefs: { subscriberId: "s1", purposes: { marketing: false } },
			});
			expect(result).toEqual({ allowed: false, reason: 'subscriber disabled purpose "marketing"' });
		});

		it("allows when purpose is explicitly true", () => {
			const result = purposePreference({
				...baseInput,
				workflowMeta: { ...baseMeta, purpose: "marketing" },
				subscriberPrefs: { subscriberId: "s1", purposes: { marketing: true } },
			});
			expect(result).toEqual({ allowed: true, reason: 'subscriber enabled purpose "marketing"' });
		});
	});

	// -- workflowConditions --
	describe("workflowConditions", () => {
		it("returns null when no conditions", () => {
			expect(workflowConditions(baseInput)).toBeNull();
		});

		it("returns null when no conditionContext", () => {
			const result = workflowConditions({
				...baseInput,
				workflowMeta: {
					...baseMeta,
					preferences: { conditions: [{ field: "payload.plan", operator: "eq", value: "pro" }] },
				},
			});
			expect(result).toBeNull();
		});

		it("blocks when condition not met", () => {
			const result = workflowConditions({
				...baseInput,
				workflowMeta: {
					...baseMeta,
					preferences: { conditions: [{ field: "payload.plan", operator: "eq", value: "pro" }] },
				},
				conditionContext: {
					subscriber: { id: "1", externalId: "ext-1" } as SubscriberData,
					payload: { plan: "free" },
				},
			});
			expect(result).toEqual({ allowed: false, reason: 'workflow "wf-1" preference condition not met' });
		});

		it("returns null when condition passes", () => {
			const result = workflowConditions({
				...baseInput,
				workflowMeta: {
					...baseMeta,
					preferences: { conditions: [{ field: "payload.plan", operator: "eq", value: "pro" }] },
				},
				conditionContext: {
					subscriber: { id: "1", externalId: "ext-1" } as SubscriberData,
					payload: { plan: "pro" },
				},
			});
			expect(result).toBeNull();
		});
	});

	// -- authorChannelDefault --
	describe("authorChannelDefault", () => {
		it("returns null when no author pref", () => {
			expect(authorChannelDefault(baseInput)).toBeNull();
		});

		it("blocks when author disabled channel", () => {
			const result = authorChannelDefault({
				...baseInput,
				workflowMeta: { ...baseMeta, preferences: { channels: { email: { enabled: false } } } },
			});
			expect(result).toEqual({ allowed: false, reason: 'workflow author disabled channel "email"' });
		});

		it("returns null when author enabled channel", () => {
			const result = authorChannelDefault({
				...baseInput,
				workflowMeta: { ...baseMeta, preferences: { channels: { email: { enabled: true } } } },
			});
			expect(result).toBeNull();
		});

		// Item #17: readOnly + authorChannelDefault ordering dependency
		it("returns null for readOnly channels (does not double-block)", () => {
			const result = authorChannelDefault({
				...baseInput,
				workflowMeta: { ...baseMeta, preferences: { channels: { email: { enabled: false, readOnly: true } } } },
			});
			expect(result).toBeNull();
		});
	});

	// -- defaultWorkflow --
	describe("defaultWorkflow", () => {
		it("returns null when subscriber has explicit workflow pref", () => {
			const result = defaultWorkflow({
				...baseInput,
				subscriberPrefs: { subscriberId: "s1", workflows: { "wf-1": { enabled: true } } },
				defaultPreferences: { workflows: { "wf-1": { enabled: false } } },
			});
			expect(result).toBeNull();
		});

		it("blocks when config default disables workflow", () => {
			const result = defaultWorkflow({
				...baseInput,
				defaultPreferences: { workflows: { "wf-1": { enabled: false } } },
			});
			expect(result).toEqual({ allowed: false, reason: 'config default disabled workflow "wf-1"' });
		});

		it("blocks when operator non-enforced default disables workflow", () => {
			const result = defaultWorkflow({
				...baseInput,
				operatorPreferences: { workflows: { "wf-1": { enabled: false } } },
			});
			expect(result).toEqual({ allowed: false, reason: 'operator default disabled workflow "wf-1"' });
		});
	});

	// -- defaultPurpose --
	describe("defaultPurpose", () => {
		it("returns null when no purpose on workflow", () => {
			expect(defaultPurpose(baseInput)).toBeNull();
		});

		it("returns null when subscriber has explicit purpose pref", () => {
			const result = defaultPurpose({
				...baseInput,
				workflowMeta: { ...baseMeta, purpose: "marketing" },
				subscriberPrefs: { subscriberId: "s1", purposes: { marketing: true } },
				defaultPreferences: { purposes: { marketing: false } },
			});
			expect(result).toBeNull();
		});

		it("blocks when config default disables purpose", () => {
			const result = defaultPurpose({
				...baseInput,
				workflowMeta: { ...baseMeta, purpose: "marketing" },
				defaultPreferences: { purposes: { marketing: false } },
			});
			expect(result).toEqual({ allowed: false, reason: 'config default disabled purpose "marketing"' });
		});
	});

	// -- defaultCategory --
	describe("defaultCategory", () => {
		it("returns null when no category on workflow", () => {
			expect(defaultCategory(baseInput)).toBeNull();
		});

		it("returns null when subscriber has explicit category pref", () => {
			const result = defaultCategory({
				...baseInput,
				workflowMeta: { ...baseMeta, category: "news" },
				subscriberPrefs: { subscriberId: "s1", categories: { news: { enabled: true } } },
				defaultPreferences: { categories: { news: { enabled: false } } },
			});
			expect(result).toBeNull();
		});

		it("blocks when config default disables category", () => {
			const result = defaultCategory({
				...baseInput,
				workflowMeta: { ...baseMeta, category: "news" },
				defaultPreferences: { categories: { news: { enabled: false } } },
			});
			expect(result).toEqual({ allowed: false, reason: 'config default disabled category "news"' });
		});
	});

	// -- defaultChannelPref --
	describe("defaultChannelPref", () => {
		it("returns null when subscriber has explicit channel pref", () => {
			const result = defaultChannelPref({
				...baseInput,
				subscriberPrefs: { subscriberId: "s1", channels: { email: true } },
				defaultPreferences: { channels: { email: false } },
			});
			expect(result).toBeNull();
		});

		it("blocks when config default disables channel", () => {
			const result = defaultChannelPref({
				...baseInput,
				defaultPreferences: { channels: { email: false } },
			});
			expect(result).toEqual({ allowed: false, reason: 'config default disabled channel "email"' });
		});
	});
});

// ---- Item #13: WorkflowMeta stays in sync with NotificationWorkflow ----

describe("WorkflowMeta type derivation", () => {
	it("all NotificationWorkflow preference-relevant fields map to WorkflowMeta", () => {
		// This is a compile-time check — if WorkflowMeta drifts from NotificationWorkflow,
		// this construction will fail to typecheck.
		const workflow: NotificationWorkflow = {
			id: "wf-sync-test",
			name: "Sync Test",
			critical: true,
			purpose: "transactional",
			category: "alerts",
			preferences: {
				channels: { email: { enabled: true, readOnly: true } },
				conditions: [{ field: "payload.x", operator: "eq", value: 1 }],
				conditionMode: "any",
			},
			steps: [],
		};

		const meta: WorkflowMeta = {
			workflowId: workflow.id,
			critical: workflow.critical,
			purpose: workflow.purpose,
			category: workflow.category,
			preferences: workflow.preferences,
		};

		expect(meta.workflowId).toBe("wf-sync-test");
		expect(meta.critical).toBe(true);
		expect(meta.purpose).toBe("transactional");
		expect(meta.category).toBe("alerts");
		expect(meta.preferences).toBe(workflow.preferences);
	});
});

// ---- Item #3: Public API exports ----

describe("public API exports", () => {
	it("exports all check functions and the chain from index", async () => {
		const publicAPI = await import("../src/index.js");
		expect(publicAPI.criticalBypass).toBeDefined();
		expect(publicAPI.operatorEnforced).toBeDefined();
		expect(publicAPI.readOnlyChannel).toBeDefined();
		expect(publicAPI.channelKillSwitch).toBeDefined();
		expect(publicAPI.workflowPreference).toBeDefined();
		expect(publicAPI.categoryPreference).toBeDefined();
		expect(publicAPI.purposePreference).toBeDefined();
		expect(publicAPI.workflowConditions).toBeDefined();
		expect(publicAPI.authorChannelDefault).toBeDefined();
		expect(publicAPI.defaultWorkflow).toBeDefined();
		expect(publicAPI.defaultPurpose).toBeDefined();
		expect(publicAPI.defaultCategory).toBeDefined();
		expect(publicAPI.defaultChannelPref).toBeDefined();
		expect(publicAPI.preferenceChecks).toBeDefined();
	});
});
