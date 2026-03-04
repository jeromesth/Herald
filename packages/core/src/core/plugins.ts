import type { HeraldContext, HeraldOptions } from "../types/config.js";

export function initializePlugins(
	ctx: HeraldContext,
	plugins?: HeraldOptions["plugins"],
): Promise<void> {
	if (!plugins?.length) {
		return Promise.resolve();
	}

	return Promise.all(
		plugins.map(async (plugin) => {
			if (!plugin.init) return;

			try {
				const initResult = await plugin.init(ctx);
				if (initResult?.context) {
					Object.assign(ctx, initResult.context);
				}
			} catch (err) {
				console.error(`[herald] Plugin "${plugin.id}" init failed:`, err);
			}
		}),
	).then(() => undefined);
}
