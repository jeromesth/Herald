import type { HeraldContext, PreferenceRecord } from "../types/config.js";

export function defaultPreferenceRecord(ctx: HeraldContext, subscriberId: string): PreferenceRecord {
	return {
		subscriberId,
		channels: { ...(ctx.options.defaultPreferences?.channels ?? {}) },
		workflows: { ...(ctx.options.defaultPreferences?.workflows ?? {}) },
		categories: { ...(ctx.options.defaultPreferences?.categories ?? {}) },
	};
}
