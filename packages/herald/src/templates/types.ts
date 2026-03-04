/**
 * Template engine interface for Herald.
 *
 * Herald ships with a built-in Handlebars-style engine, but the template
 * engine is fully pluggable. Swap it out for React Email, MJML, or anything
 * else by implementing this interface.
 *
 * @example Using the built-in Handlebars engine (default):
 * ```ts
 * herald({ ... }); // uses HandlebarsEngine automatically
 * ```
 *
 * @example Bringing your own engine:
 * ```ts
 * import { render } from "@react-email/render";
 *
 * herald({
 *   templateEngine: {
 *     render: (template, context) => render(MyEmail(context)),
 *   },
 * });
 * ```
 */
export interface TemplateEngine {
	/** Render a template string with the given context. */
	render(template: string, context: TemplateContext): string;

	/**
	 * Optionally compile a template into a reusable render function.
	 * Engines that support pre-compilation can implement this for better
	 * performance when the same template is rendered many times.
	 */
	compile?(template: string): (context: TemplateContext) => string;
}

export interface TemplateContext {
	subscriber: Record<string, unknown>;
	payload: Record<string, unknown>;
	app?: Record<string, unknown>;
	[key: string]: unknown;
}
