import { describe, expect, it } from "vitest";
import type { TemplateContext } from "../src/templates/engine.js";
import { LayoutRegistry, defaultEmailLayout, renderEmail } from "../src/templates/layouts.js";
import type { EmailLayout } from "../src/templates/layouts.js";

const baseContext: TemplateContext = {
	subscriber: { firstName: "Alice", email: "alice@example.com" },
	payload: { message: "Your order has shipped!" },
	app: { name: "TestApp" },
};

describe("renderEmail", () => {
	it("renders subject and body with template variables", () => {
		const result = renderEmail({
			subject: "Hello {{ subscriber.firstName }}",
			body: "<p>{{ payload.message }}</p>",
			context: baseContext,
		});

		expect(result.subject).toBe("Hello Alice");
		expect(result.html).toContain("<p>Your order has shipped!</p>");
		expect(result.html).toContain("<!DOCTYPE html>");
	});

	it("includes app name in layout header", () => {
		const result = renderEmail({
			subject: "Test",
			body: "Body",
			context: baseContext,
		});

		expect(result.html).toContain("TestApp");
	});

	it("renders plain text version", () => {
		const result = renderEmail({
			subject: "Test",
			body: "Plain text body",
			context: baseContext,
		});

		expect(result.text).toBeDefined();
		expect(result.text).toContain("Plain text body");
		expect(result.text).toContain("TestApp");
	});

	it("uses a custom layout", () => {
		const customLayout: EmailLayout = {
			id: "simple",
			html: "<html><body>{{{ content }}}</body></html>",
		};

		const result = renderEmail({
			layout: customLayout,
			subject: "Test",
			body: "<h1>Hello {{ subscriber.firstName }}</h1>",
			context: baseContext,
		});

		expect(result.html).toBe("<html><body><h1>Hello Alice</h1></body></html>");
		expect(result.text).toBeUndefined();
	});

	it("renders unsubscribe link when provided", () => {
		const ctx: TemplateContext = {
			...baseContext,
			unsubscribeUrl: "https://example.com/unsubscribe",
		};

		const result = renderEmail({
			subject: "Test",
			body: "Body",
			context: ctx,
		});

		expect(result.html).toContain("https://example.com/unsubscribe");
		expect(result.html).toContain("Unsubscribe");
	});
});

describe("defaultEmailLayout", () => {
	it("has the expected structure", () => {
		expect(defaultEmailLayout.id).toBe("default");
		expect(defaultEmailLayout.html).toContain("<!DOCTYPE html>");
		expect(defaultEmailLayout.html).toContain("{{{ content }}}");
		expect(defaultEmailLayout.text).toBeDefined();
		expect(defaultEmailLayout.text).toContain("{{ content }}");
	});
});

describe("LayoutRegistry", () => {
	it("includes default layout", () => {
		const registry = new LayoutRegistry();
		const layout = registry.get("default");
		expect(layout).toBeDefined();
		expect(layout?.id).toBe("default");
	});

	it("registers and retrieves custom layouts", () => {
		const registry = new LayoutRegistry();
		const custom: EmailLayout = {
			id: "marketing",
			html: "<html>{{{ content }}}</html>",
		};

		registry.register(custom);

		const retrieved = registry.get("marketing");
		expect(retrieved).toBeDefined();
		expect(retrieved?.id).toBe("marketing");
	});

	it("returns default layout from getDefault()", () => {
		const registry = new LayoutRegistry();
		const layout = registry.getDefault();
		expect(layout.id).toBe("default");
	});
});
