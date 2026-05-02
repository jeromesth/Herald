import { recordActivity } from "../../core/activity.js";
import { emitWebhookEvent } from "../../core/webhooks.js";
import type { ActivityEventInput } from "../../types/activity.js";
import type { HeraldContext } from "../../types/config.js";
import type { HeraldPlugin } from "../../types/plugin.js";
import { observabilityEndpoints } from "./routes.js";
import { observabilitySchema } from "./schema.js";

/** Stable id used for both manual and auto-registered observability plugins. */
export const OBSERVABILITY_PLUGIN_ID = "herald-observability";

/**
 * Observability plugin — records lifecycle events to the activity log table
 * and delivers them to configured webhooks.
 *
 * The plugin subscribes to Herald's `onEvent` hook and fans out to two
 * downstream sinks:
 *
 * - `activityLog` table — written when `HeraldOptions.activityLog === true`
 * - configured webhooks — delivered when `HeraldOptions.webhooks` is non-empty
 *
 * It also contributes the `activityLog` schema and the `/activity`,
 * `/activity/:transactionId`, and `/delivery-status` HTTP endpoints.
 *
 * @example
 * ```ts
 * import { herald, observabilityPlugin } from "@jeromesth/herald";
 *
 * herald({
 *   ...
 *   plugins: [observabilityPlugin()],
 *   activityLog: true,
 *   webhooks: [{ url: "https://example.com/hook", secret: "shh" }],
 * });
 * ```
 *
 * Note: this plugin is auto-registered when `HeraldOptions.activityLog: true`
 * or `HeraldOptions.webhooks` is configured, so most users don't need to add
 * it manually.
 */
export function observabilityPlugin(): HeraldPlugin {
	// Each call creates a fresh closure so concurrent Herald instances don't share state.
	let ctxRef: HeraldContext | undefined;

	return {
		id: OBSERVABILITY_PLUGIN_ID,
		schema: observabilitySchema,
		endpoints: observabilityEndpoints,
		hooks: {
			onEvent: async (event: ActivityEventInput) => {
				if (!ctxRef) return;
				await Promise.allSettled([recordActivity(ctxRef, event), emitWebhookEvent(ctxRef, event)]);
			},
		},
		init: async (ctx: HeraldContext) => {
			ctxRef = ctx;
			return undefined;
		},
	};
}
