import type { DefaultPreferences, HeraldContext, PreferenceRecord, WorkflowChannelPreference } from "../types/config.js";
import type { ChannelType } from "../types/workflow.js";

export interface WorkflowMeta {
	workflowId: string;
	critical?: boolean;
	purpose?: string;
	preferences?: {
		channels?: Partial<Record<ChannelType, { enabled: boolean }>>;
	};
}

export interface PreferenceGateResult {
	allowed: boolean;
	reason: string;
}

export function preferenceGate(
	subscriberPrefs: PreferenceRecord | undefined,
	workflowMeta: WorkflowMeta,
	channel: ChannelType,
	defaultPreferences?: DefaultPreferences,
): PreferenceGateResult {
	// 1. Critical bypass
	if (workflowMeta.critical) {
		return { allowed: true, reason: "critical" };
	}

	// 2. Global channel kill switch
	if (subscriberPrefs?.channels?.[channel] === false) {
		return { allowed: false, reason: `subscriber disabled channel "${channel}"` };
	}

	// 3. Workflow-specific preference (most specific subscriber choice)
	const workflowPref = subscriberPrefs?.workflows?.[workflowMeta.workflowId];
	if (workflowPref !== undefined) {
		if (workflowPref === false) {
			return { allowed: false, reason: `subscriber disabled workflow "${workflowMeta.workflowId}"` };
		}
		if (workflowPref === true) {
			return { allowed: true, reason: `subscriber enabled workflow "${workflowMeta.workflowId}"` };
		}
		// WorkflowChannelPreference object
		if (typeof workflowPref === "object" && workflowPref !== null && "enabled" in workflowPref) {
			const wcp = workflowPref as WorkflowChannelPreference;
			if (!wcp.enabled) {
				return { allowed: false, reason: `subscriber disabled workflow "${workflowMeta.workflowId}"` };
			}
			if (wcp.channels?.[channel] === false) {
				return { allowed: false, reason: `subscriber disabled channel "${channel}" for workflow "${workflowMeta.workflowId}"` };
			}
			return { allowed: true, reason: `subscriber enabled workflow "${workflowMeta.workflowId}"` };
		}
		// Unrecognized preference value — default to allow
		return { allowed: true, reason: "default" };
	}

	// 4. Purpose-level preference
	if (workflowMeta.purpose && subscriberPrefs?.purposes?.[workflowMeta.purpose] === false) {
		return { allowed: false, reason: `subscriber disabled purpose "${workflowMeta.purpose}"` };
	}

	// 5. Workflow-author channel default
	const authorChannelPref = workflowMeta.preferences?.channels?.[channel];
	if (authorChannelPref && !authorChannelPref.enabled) {
		return { allowed: false, reason: `workflow author disabled channel "${channel}"` };
	}

	// 6. Config default per-workflow
	if (defaultPreferences?.workflows?.[workflowMeta.workflowId] === false) {
		return { allowed: false, reason: `config default disabled workflow "${workflowMeta.workflowId}"` };
	}

	// 7. Config default per-purpose
	if (workflowMeta.purpose && defaultPreferences?.purposes?.[workflowMeta.purpose] === false) {
		return { allowed: false, reason: `config default disabled purpose "${workflowMeta.purpose}"` };
	}

	// 8. Config default per-channel
	if (defaultPreferences?.channels?.[channel] === false) {
		return { allowed: false, reason: `config default disabled channel "${channel}"` };
	}

	// 9. Default allow
	return { allowed: true, reason: "default" };
}

export function defaultPreferenceRecord(ctx: HeraldContext, subscriberId: string): PreferenceRecord {
	return {
		subscriberId,
		channels: { ...(ctx.options.defaultPreferences?.channels ?? {}) },
		workflows: { ...(ctx.options.defaultPreferences?.workflows ?? {}) },
		purposes: { ...(ctx.options.defaultPreferences?.purposes ?? {}) },
	};
}
