import type { ActivityEventInput } from "../types/activity.js";
import type { HeraldContext } from "../types/config.js";
import { recordActivity } from "./activity.js";
import { emitWebhookEvent } from "./webhooks.js";

/**
 * Emit a lifecycle event — records to activity log and delivers to webhooks.
 *
 * Both operations are fire-and-forget: errors are logged, never propagated.
 * This function must never throw, as it's called from the critical delivery path.
 */
export async function emitEvent(ctx: HeraldContext, input: ActivityEventInput): Promise<void> {
	await Promise.allSettled([recordActivity(ctx, input), emitWebhookEvent(ctx, input)]);
}
