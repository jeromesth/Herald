import type { ActivityEventInput } from "../types/activity.js";
import type { HeraldContext } from "../types/config.js";

/**
 * Emit a lifecycle event by fanning it out to every plugin's `onEvent` hook.
 *
 * Activity-log persistence and webhook delivery live in the observability
 * plugin (auto-registered when `activityLog` or `webhooks` is configured),
 * which subscribes via `onEvent`. Custom plugins can subscribe to the same
 * stream for analytics, audit logs, etc.
 *
 * Errors thrown by hooks are logged and never propagated — `emitEvent` is
 * called from the critical delivery path and must never throw.
 */
export async function emitEvent(ctx: HeraldContext, input: ActivityEventInput): Promise<void> {
	const plugins = ctx.options.plugins;
	if (!plugins || plugins.length === 0) return;

	await Promise.allSettled(
		plugins
			.filter((plugin) => plugin.hooks?.onEvent)
			.map(async (plugin) => {
				try {
					// biome-ignore lint/style/noNonNullAssertion: filtered above
					await plugin.hooks!.onEvent!(input);
				} catch (error) {
					console.error(`[herald] Plugin "${plugin.id}" onEvent hook threw for event "${input.event}":`, error);
				}
			}),
	);
}
