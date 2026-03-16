import { HeraldPluginError } from "../errors.js";
import type { HeraldContext, HeraldOptions } from "../types/config.js";

/** Keys that plugins are NOT allowed to overwrite on HeraldContext. */
const PROTECTED_CONTEXT_KEYS = new Set<string>([
	"db",
	"workflow",
	"generateId",
	"channels",
	"options",
	"schema",
	"transactionWorkflowMap",
	"throttleState",
]);

export async function initializePlugins(ctx: HeraldContext, plugins?: HeraldOptions["plugins"]): Promise<void> {
	if (!plugins?.length) {
		return;
	}

	for (const plugin of plugins) {
		if (!plugin.init) continue;

		try {
			const initResult = await plugin.init(ctx);
			if (initResult?.context) {
				for (const key of Object.keys(initResult.context)) {
					if (PROTECTED_CONTEXT_KEYS.has(key)) {
						console.warn(`[herald] Plugin "${plugin.id}" attempted to overwrite protected context key "${key}" — ignored`);
						continue;
					}
					(ctx as unknown as Record<string, unknown>)[key] = (initResult.context as Record<string, unknown>)[key];
				}
			}
		} catch (err) {
			throw new HeraldPluginError(
				plugin.id,
				`Herald initialization failed: plugin "${plugin.id}" init error: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}
}
