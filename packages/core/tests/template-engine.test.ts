import { describe, expect, it } from "vitest";
import { HandlebarsEngine, compileTemplate, renderTemplate } from "../src/templates/engine.js";
import type { TemplateContext } from "../src/templates/engine.js";

const baseContext: TemplateContext = {
	subscriber: {
		firstName: "Alice",
		lastName: "Smith",
		email: "alice@example.com",
		data: { role: "admin" },
	},
	payload: {
		appName: "TestApp",
		amount: 42,
		items: ["one", "two", "three"],
	},
	app: { name: "Herald" },
};

describe("Template Engine — variable interpolation", () => {
	it("resolves simple variables", () => {
		const result = renderTemplate("Hello {{ subscriber.firstName }}!", baseContext);
		expect(result).toBe("Hello Alice!");
	});

	it("resolves nested dot paths", () => {
		const result = renderTemplate("Role: {{ subscriber.data.role }}", baseContext);
		expect(result).toBe("Role: admin");
	});

	it("returns empty string for undefined paths", () => {
		const result = renderTemplate("{{ subscriber.missing }}", baseContext);
		expect(result).toBe("");
	});

	it("HTML-escapes double-brace expressions", () => {
		const ctx: TemplateContext = {
			subscriber: {},
			payload: { html: "<b>bold</b>" },
		};
		const result = renderTemplate("{{ payload.html }}", ctx);
		expect(result).toBe("&lt;b&gt;bold&lt;/b&gt;");
	});

	it("does NOT escape triple-brace expressions", () => {
		const ctx: TemplateContext = {
			subscriber: {},
			payload: { html: "<b>bold</b>" },
		};
		const result = renderTemplate("{{{ payload.html }}}", ctx);
		expect(result).toBe("<b>bold</b>");
	});
});

describe("Template Engine — filters", () => {
	it("applies uppercase filter", () => {
		const result = renderTemplate("{{ subscriber.firstName | uppercase }}", baseContext);
		expect(result).toBe("ALICE");
	});

	it("applies lowercase filter", () => {
		const result = renderTemplate("{{ subscriber.firstName | lowercase }}", baseContext);
		expect(result).toBe("alice");
	});

	it("applies capitalize filter", () => {
		const ctx: TemplateContext = {
			subscriber: {},
			payload: { word: "hello" },
		};
		const result = renderTemplate("{{ payload.word | capitalize }}", ctx);
		expect(result).toBe("Hello");
	});

	it("applies default filter", () => {
		const result = renderTemplate("{{ subscriber.nickname | default Guest }}", baseContext);
		expect(result).toBe("Guest");
	});

	it("applies truncate filter", () => {
		const ctx: TemplateContext = {
			subscriber: {},
			payload: { text: "This is a long piece of text that should be truncated" },
		};
		const result = renderTemplate("{{ payload.text | truncate 20 }}", ctx);
		expect(result).toBe("This is a long piece...");
	});

	it("supports custom filters", () => {
		const result = renderTemplate("{{ payload.amount | double }}", baseContext, {
			double: (v) => String(Number(v) * 2),
		});
		expect(result).toBe("84");
	});
});

describe("Template Engine — block helpers", () => {
	it("renders #if block when truthy", () => {
		const result = renderTemplate(
			"{{#if subscriber.firstName}}Hi {{ subscriber.firstName }}{{/if}}",
			baseContext,
		);
		expect(result).toBe("Hi Alice");
	});

	it("does not render #if block when falsy", () => {
		const result = renderTemplate("{{#if subscriber.missing}}Hidden{{/if}}", baseContext);
		expect(result).toBe("");
	});

	it("renders else branch", () => {
		const result = renderTemplate("{{#if subscriber.missing}}Yes{{else}}No{{/if}}", baseContext);
		expect(result).toBe("No");
	});

	it("iterates #each over arrays", () => {
		const ctx: TemplateContext = {
			subscriber: {},
			payload: {
				users: [{ name: "Alice" }, { name: "Bob" }],
			},
		};
		const result = renderTemplate("{{#each payload.users}}{{ name }} {{/each}}", ctx);
		expect(result).toBe("Alice Bob ");
	});

	it("handles empty arrays in #each", () => {
		const ctx: TemplateContext = {
			subscriber: {},
			payload: { items: [] },
		};
		const result = renderTemplate("{{#each payload.items}}item{{/each}}", ctx);
		expect(result).toBe("");
	});
});

describe("Template Engine — compileTemplate", () => {
	it("returns a reusable render function", () => {
		const render = compileTemplate("Hello {{ subscriber.firstName }}!");
		expect(render(baseContext)).toBe("Hello Alice!");
		expect(
			render({
				subscriber: { firstName: "Bob" },
				payload: {},
			}),
		).toBe("Hello Bob!");
	});
});

// ---------------------------------------------------------------------------
// HandlebarsEngine class tests
// ---------------------------------------------------------------------------

describe("HandlebarsEngine", () => {
	it("renders templates via the render() method", () => {
		const engine = new HandlebarsEngine();
		const result = engine.render("Hello {{ subscriber.firstName }}!", baseContext);
		expect(result).toBe("Hello Alice!");
	});

	it("supports custom filters passed to the constructor", () => {
		const engine = new HandlebarsEngine({
			reverse: (v) =>
				String(v ?? "")
					.split("")
					.reverse()
					.join(""),
		});
		const result = engine.render("{{ subscriber.firstName | reverse }}", baseContext);
		expect(result).toBe("ecilA");
	});

	it("compile() returns a reusable render function", () => {
		const engine = new HandlebarsEngine();
		const render = engine.compile("Hello {{ subscriber.firstName }}!");
		expect(render(baseContext)).toBe("Hello Alice!");
		expect(render({ subscriber: { firstName: "Bob" }, payload: {} })).toBe("Hello Bob!");
	});

	it("compile() preserves custom filters", () => {
		const engine = new HandlebarsEngine({
			shout: (v) => `${String(v ?? "").toUpperCase()}!!!`,
		});
		const render = engine.compile("{{ payload.appName | shout }}");
		expect(render(baseContext)).toBe("TESTAPP!!!");
	});

	it("handles block helpers through the class interface", () => {
		const engine = new HandlebarsEngine();
		const result = engine.render(
			"{{#if subscriber.firstName}}Hi {{ subscriber.firstName }}{{else}}Hi there{{/if}}",
			baseContext,
		);
		expect(result).toBe("Hi Alice");
	});

	it("handles each blocks through the class interface", () => {
		const ctx: TemplateContext = {
			subscriber: {},
			payload: { users: [{ name: "Alice" }, { name: "Bob" }] },
		};
		const engine = new HandlebarsEngine();
		const result = engine.render("{{#each payload.users}}{{ name }} {{/each}}", ctx);
		expect(result).toBe("Alice Bob ");
	});

	it("HTML-escapes by default in double braces", () => {
		const engine = new HandlebarsEngine();
		const ctx: TemplateContext = {
			subscriber: {},
			payload: { html: "<script>alert('xss')</script>" },
		};
		const result = engine.render("{{ payload.html }}", ctx);
		expect(result).not.toContain("<script>");
		expect(result).toContain("&lt;script&gt;");
	});

	it("does not escape triple braces", () => {
		const engine = new HandlebarsEngine();
		const ctx: TemplateContext = {
			subscriber: {},
			payload: { html: "<b>bold</b>" },
		};
		const result = engine.render("{{{ payload.html }}}", ctx);
		expect(result).toBe("<b>bold</b>");
	});
});
