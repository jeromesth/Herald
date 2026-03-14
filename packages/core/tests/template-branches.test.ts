import { describe, expect, it } from "vitest";
import { renderTemplate } from "../src/templates/engine.js";
import type { TemplateContext } from "../src/templates/engine.js";

const ctx: TemplateContext = {
	subscriber: { firstName: "Alice" },
	payload: { items: [{ name: "A" }, { name: "B" }], empty: [], count: 3, flag: true, zero: 0 },
	app: { name: "Test" },
};

describe("Template Engine — branch coverage", () => {
	describe("builtin filters", () => {
		it("uppercase filter", () => {
			expect(renderTemplate("{{ subscriber.firstName | uppercase }}", ctx)).toBe("ALICE");
		});

		it("lowercase filter", () => {
			expect(renderTemplate("{{ subscriber.firstName | lowercase }}", ctx)).toBe("alice");
		});

		it("capitalize filter", () => {
			const c = { ...ctx, payload: { ...ctx.payload, word: "hello" } };
			expect(renderTemplate("{{ payload.word | capitalize }}", c)).toBe("Hello");
		});

		it("default filter with value", () => {
			expect(renderTemplate("{{ subscriber.firstName | default Anon }}", ctx)).toBe("Alice");
		});

		it("default filter with null value", () => {
			expect(renderTemplate("{{ missing | default Anon }}", ctx)).toBe("Anon");
		});

		it("default filter with empty string", () => {
			const c = { ...ctx, payload: { ...ctx.payload, empty: "" } };
			expect(renderTemplate("{{ payload.empty | default N/A }}", c)).toBe("N/A");
		});

		it("truncate filter", () => {
			const c = { ...ctx, payload: { ...ctx.payload, long: "This is a very long text that should be truncated" } };
			expect(renderTemplate("{{ payload.long | truncate 10 }}", c)).toBe("This is a ...");
		});

		it("truncate filter with short string", () => {
			expect(renderTemplate("{{ subscriber.firstName | truncate 50 }}", ctx)).toBe("Alice");
		});

		it("filters with null value", () => {
			expect(renderTemplate("{{ missing | uppercase }}", ctx)).toBe("");
		});
	});

	describe("#each block", () => {
		it("iterates object items with property access", () => {
			const result = renderTemplate("{{#each payload.items}}{{ name }},{{/each}}", ctx);
			expect(result).toBe("A,B,");
		});

		it("handles non-array value", () => {
			expect(renderTemplate("{{#each payload.count}}item{{/each}}", ctx)).toBe("");
		});

		it("provides @index, @first, @last", () => {
			const c = { ...ctx, payload: { ...ctx.payload, nums: [10, 20, 30] } };
			const result = renderTemplate("{{#each payload.nums}}{{@index}}{{/each}}", c);
			expect(result).toBe("012");
		});
	});

	describe("#if block", () => {
		it("renders else branch when condition is falsy", () => {
			expect(renderTemplate("{{#if missing}}yes{{else}}no{{/if}}", ctx)).toBe("no");
		});

		it("renders if branch when condition is truthy", () => {
			expect(renderTemplate("{{#if payload.flag}}yes{{else}}no{{/if}}", ctx)).toBe("yes");
		});

		it("renders nothing for falsy without else", () => {
			expect(renderTemplate("{{#if missing}}yes{{/if}}", ctx)).toBe("");
		});

		it("treats 0 as falsy", () => {
			expect(renderTemplate("{{#if payload.zero}}yes{{else}}no{{/if}}", ctx)).toBe("no");
		});

		it("treats empty string as falsy", () => {
			const c = { ...ctx, payload: { ...ctx.payload, blank: "" } };
			expect(renderTemplate("{{#if payload.blank}}yes{{else}}no{{/if}}", c)).toBe("no");
		});
	});

	describe("raw interpolation", () => {
		it("does not escape HTML in triple braces", () => {
			const c = { ...ctx, payload: { ...ctx.payload, html: "<b>bold</b>" } };
			expect(renderTemplate("{{{ payload.html }}}", c)).toBe("<b>bold</b>");
		});

		it("escapes HTML in double braces", () => {
			const c = { ...ctx, payload: { ...ctx.payload, html: "<b>bold</b>" } };
			expect(renderTemplate("{{ payload.html }}", c)).toBe("&lt;b&gt;bold&lt;/b&gt;");
		});
	});
});
