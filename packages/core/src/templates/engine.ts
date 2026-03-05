/**
 * Template rendering engine for Herald.
 * Supports Handlebars-style variable interpolation with helpers.
 *
 * Syntax:
 *   {{ variable }}           — simple interpolation (HTML-escaped in email)
 *   {{{ variable }}}         — raw interpolation (no escaping)
 *   {{#if condition}}...{{/if}}           — conditional blocks
 *   {{#if condition}}...{{else}}...{{/if}} — if/else
 *   {{#each items}}...{{/each}}           — iteration
 *   {{ subscriber.firstName }}             — dot-path access
 *   {{ payload.amount | uppercase }}       — pipe filters
 */

import type { TemplateContext, TemplateEngine } from "./types.js";

export type { TemplateContext } from "./types.js";

export type TemplateFilter = (value: unknown, ...args: string[]) => string;

const builtinFilters: Record<string, TemplateFilter> = {
	uppercase: (v) => String(v ?? "").toUpperCase(),
	lowercase: (v) => String(v ?? "").toLowerCase(),
	capitalize: (v) => {
		const s = String(v ?? "");
		return s.charAt(0).toUpperCase() + s.slice(1);
	},
	default: (v, fallback) => (v == null || v === "" ? (fallback ?? "") : String(v)),
	truncate: (v, len) => {
		const s = String(v ?? "");
		const n = Number.parseInt(len ?? "50", 10);
		return s.length > n ? `${s.slice(0, n)}...` : s;
	},
};

/**
 * Resolve a dot-separated path from a context object.
 */
function resolvePath(context: Record<string, unknown>, path: string): unknown {
	const parts = path.trim().split(".");
	let current: unknown = context;
	for (const part of parts) {
		if (current == null || typeof current !== "object") return undefined;
		current = (current as Record<string, unknown>)[part];
	}
	return current;
}

/**
 * Escape HTML special characters for safe email content.
 */
function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/**
 * Process a single expression: resolve the variable and apply filters.
 */
function processExpression(
	expr: string,
	context: TemplateContext,
	filters: Record<string, TemplateFilter>,
): string {
	const parts = expr.split("|").map((p) => p.trim());
	const varPath = parts[0]!;
	let value = resolvePath(context as Record<string, unknown>, varPath);

	for (let i = 1; i < parts.length; i++) {
		const filterExpr = parts[i]!.trim();
		const [filterName, ...filterArgs] = filterExpr.split(/\s+/);
		const filter = filters[filterName!] ?? builtinFilters[filterName!];
		if (filter) {
			value = filter(value, ...filterArgs);
		}
	}

	return value == null ? "" : String(value);
}

/**
 * Process block helpers (if, each).
 */
function processBlocks(
	template: string,
	context: TemplateContext,
	filters: Record<string, TemplateFilter>,
): string {
	// Process {{#each items}}...{{/each}}
	template = template.replace(
		/\{\{#each\s+([^}]+)\}\}([\s\S]*?)\{\{\/each\}\}/g,
		(_match, path: string, body: string) => {
			const items = resolvePath(context as Record<string, unknown>, path.trim());
			if (!Array.isArray(items)) return "";

			return items
				.map((item, index) => {
					const itemContext: TemplateContext = {
						...context,
						this: item as Record<string, unknown>,
						"@index": index,
						"@first": index === 0,
						"@last": index === items.length - 1,
					};
					// If item is an object, spread its properties for direct access
					if (item != null && typeof item === "object") {
						Object.assign(itemContext, item);
					}
					return renderTemplate(body, itemContext, filters);
				})
				.join("");
		},
	);

	// Process {{#if condition}}...{{else}}...{{/if}}
	template = template.replace(
		/\{\{#if\s+([^}]+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
		(_match, condition: string, body: string) => {
			const value = resolvePath(context as Record<string, unknown>, condition.trim());
			const isTruthy = value != null && value !== false && value !== 0 && value !== "";

			const elseParts = body.split(/\{\{else\}\}/);
			if (isTruthy) {
				return renderTemplate(elseParts[0]!, context, filters);
			}
			return elseParts[1] ? renderTemplate(elseParts[1], context, filters) : "";
		},
	);

	return template;
}

/**
 * Render a template string with the given context.
 */
export function renderTemplate(
	template: string,
	context: TemplateContext,
	customFilters?: Record<string, TemplateFilter>,
): string {
	const filters = { ...builtinFilters, ...customFilters };

	// Process block helpers first
	let result = processBlocks(template, context, filters);

	// Process raw interpolation {{{ }}} — no HTML escaping
	result = result.replace(/\{\{\{\s*([^}]+?)\s*\}\}\}/g, (_match, expr: string) => {
		return processExpression(expr, context, filters);
	});

	// Process escaped interpolation {{ }} — HTML-escaped
	result = result.replace(/\{\{\s*([^#/][^}]*?)\s*\}\}/g, (_match, expr: string) => {
		return escapeHtml(processExpression(expr, context, filters));
	});

	return result;
}

/**
 * Create a reusable compiled template function.
 */
export function compileTemplate(
	template: string,
	customFilters?: Record<string, TemplateFilter>,
): (context: TemplateContext) => string {
	return (context: TemplateContext) => renderTemplate(template, context, customFilters);
}

/**
 * Built-in Handlebars-style template engine.
 *
 * Implements the pluggable `TemplateEngine` interface so it can be swapped
 * for React Email, MJML, or any other rendering approach.
 */
export class HandlebarsEngine implements TemplateEngine {
	private filters: Record<string, TemplateFilter>;

	constructor(customFilters?: Record<string, TemplateFilter>) {
		this.filters = { ...customFilters };
	}

	render(template: string, context: TemplateContext): string {
		return renderTemplate(template, context, this.filters);
	}

	compile(template: string): (context: TemplateContext) => string {
		return compileTemplate(template, this.filters);
	}
}
