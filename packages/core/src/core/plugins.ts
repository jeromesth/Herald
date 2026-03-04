import type { HeraldContext, HeraldOptions } from "../types/config.js";

export async function initializePlugins(
	ctx: HeraldContext,
	plugins?: HeraldOptions["plugins"],
): Promise<void> {
	if (!plugins?.length) {
		return;
	}

	for (const plugin of plugins) {
		if (!plugin.init) continue;

		try {
			const initResult = await plugin.init(ctx);
			if (initResult?.context) {
				Object.assign(ctx, initResult.context);
			}
		} catch (err) {
			throw new Error(
				`Herald initialization failed: plugin "${plugin.id}" init error: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}
}
