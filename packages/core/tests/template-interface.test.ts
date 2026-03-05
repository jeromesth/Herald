import { beforeEach, describe, expect, it } from "vitest";
import { HandlebarsEngine } from "../src/templates/engine.js";
import type { TemplateContext, TemplateEngine } from "../src/templates/types.js";

// ---------------------------------------------------------------------------
// Shared context fixtures
// ---------------------------------------------------------------------------
const baseContext: TemplateContext = {
	subscriber: {
		firstName: "Alice",
		lastName: "Smith",
		email: "alice@example.com",
	},
	payload: {
		orderId: "ORD-123",
		amount: 49.99,
		items: [{ name: "Widget" }, { name: "Gadget" }],
	},
	app: { name: "TestApp" },
};

// ---------------------------------------------------------------------------
// Contract: any TemplateEngine implementation must satisfy these behaviors
// ---------------------------------------------------------------------------
function templateEngineContract(name: string, factory: () => TemplateEngine) {
	describe(`TemplateEngine contract — ${name}`, () => {
		let engine: TemplateEngine;

		beforeEach(() => {
			engine = factory();
		});

		// ---- render() ----

		describe("render()", () => {
			it("should return a string", () => {
				const result = engine.render("hello", baseContext);
				expect(typeof result).toBe("string");
			});

			it("should return the template unchanged when no expressions are present", () => {
				const result = engine.render("plain text, no vars", baseContext);
				expect(result).toBe("plain text, no vars");
			});

			it("should interpolate context values into the template", () => {
				const result = engine.render(
					"Hi {{ subscriber.firstName }}, order {{ payload.orderId }} confirmed.",
					baseContext,
				);
				expect(result).toContain("Alice");
				expect(result).toContain("ORD-123");
			});

			it("should return empty string for missing values (not throw)", () => {
				const result = engine.render("{{ subscriber.nonexistent }}", baseContext);
				expect(result).toBe("");
			});

			it("should handle an empty template", () => {
				const result = engine.render("", baseContext);
				expect(result).toBe("");
			});

			it("should handle a minimal context", () => {
				const minimal: TemplateContext = { subscriber: {}, payload: {} };
				const result = engine.render("hello", minimal);
				expect(result).toBe("hello");
			});
		});

		// ---- compile() (optional) ----

		describe("compile()", () => {
			it("if implemented, should return a function", () => {
				if (!engine.compile) return;
				const fn = engine.compile("Hello {{ subscriber.firstName }}!");
				expect(typeof fn).toBe("function");
			});

			it("if implemented, compiled function should produce the same result as render()", () => {
				if (!engine.compile) return;
				const template = "Hi {{ subscriber.firstName }}, order {{ payload.orderId }}.";
				const compiled = engine.compile(template);
				const rendered = engine.render(template, baseContext);
				expect(compiled(baseContext)).toBe(rendered);
			});

			it("if implemented, compiled function should be reusable across different contexts", () => {
				if (!engine.compile) return;
				const compiled = engine.compile("Hello {{ subscriber.firstName }}!");
				const a = compiled({ subscriber: { firstName: "Alice" }, payload: {} });
				const b = compiled({ subscriber: { firstName: "Bob" }, payload: {} });
				expect(a).not.toBe(b);
				expect(a).toContain("Alice");
				expect(b).toContain("Bob");
			});
		});
	});
}

// ---------------------------------------------------------------------------
// Run the contract against the built-in HandlebarsEngine
// ---------------------------------------------------------------------------
templateEngineContract("HandlebarsEngine", () => new HandlebarsEngine());

// ---------------------------------------------------------------------------
// Run the contract against a minimal custom engine (proves pluggability)
// ---------------------------------------------------------------------------
class MinimalEngine implements TemplateEngine {
	render(template: string, context: TemplateContext): string {
		// Simple regex-based interpolation — just enough to pass the contract
		return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, expr: string) => {
			const parts = expr.trim().split(".");
			let current: unknown = context;
			for (const part of parts) {
				if (current == null || typeof current !== "object") return "";
				current = (current as Record<string, unknown>)[part];
			}
			return current == null ? "" : String(current);
		});
	}
}

templateEngineContract("MinimalEngine (custom)", () => new MinimalEngine());

// ---------------------------------------------------------------------------
// Pluggability: verify Herald accepts any TemplateEngine at the type level
// ---------------------------------------------------------------------------
describe("TemplateEngine pluggability", () => {
	it("HandlebarsEngine satisfies the TemplateEngine interface", () => {
		const engine: TemplateEngine = new HandlebarsEngine();
		expect(engine.render).toBeDefined();
	});

	it("a custom engine satisfies the TemplateEngine interface", () => {
		const engine: TemplateEngine = new MinimalEngine();
		expect(engine.render).toBeDefined();
	});

	it("an inline object literal satisfies the TemplateEngine interface", () => {
		const engine: TemplateEngine = {
			render: (template, _context) => template,
		};
		expect(engine.render("test", { subscriber: {}, payload: {} })).toBe("test");
	});
});
