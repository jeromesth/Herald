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

		const initResult = await plugin.init(ctx);
		if (initResult?.context) {
			Object.assign(ctx, initResult.context);
		}
	}
}
