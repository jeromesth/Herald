import type { HeraldPlugin } from "heraldjs";
import type { HeraldContext } from "heraldjs";
import { reactEmailLayout } from "./layout.js";

/**
 * Herald plugin that wires up the React Email integration.
 *
 * At init time it registers the pass-through `react-email` layout, which is
 * what `renderReactEmail` targets via `data.layoutId`. With the plugin
 * installed, React-rendered HTML is delivered unmodified; without it, the
 * email would be wrapped in Herald's default layout shell.
 *
 * @example
 * ```ts
 * import { herald } from "heraldjs";
 * import { reactEmailPlugin } from "@herald/react-email";
 *
 * const app = herald({
 *   database,
 *   workflow,
 *   plugins: [reactEmailPlugin()],
 * });
 * ```
 */
export function reactEmailPlugin(): HeraldPlugin {
	return {
		id: "react-email",
		init: (ctx: HeraldContext) => {
			ctx.layouts.register(reactEmailLayout);
			return undefined;
		},
	};
}
