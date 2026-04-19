import { describe, expect, it } from "vitest";
import { LayoutRegistry, renderEmail } from "../../core/src/templates/layouts.js";
import type { HeraldContext } from "../../core/src/types/config.js";
import { REACT_EMAIL_LAYOUT_ID, reactEmailLayout } from "../src/layout.js";
import { reactEmailPlugin } from "../src/plugin.js";

function makeFakeContext(): HeraldContext {
	const layouts = new LayoutRegistry();
	return { layouts } as unknown as HeraldContext;
}

describe("reactEmailPlugin", () => {
	it("has a stable id", () => {
		expect(reactEmailPlugin().id).toBe("react-email");
	});

	it("registers the pass-through layout on init", async () => {
		const ctx = makeFakeContext();
		const plugin = reactEmailPlugin();

		expect(ctx.layouts.get(REACT_EMAIL_LAYOUT_ID)).toBeUndefined();
		await plugin.init?.(ctx);

		expect(ctx.layouts.get(REACT_EMAIL_LAYOUT_ID)).toEqual(reactEmailLayout);
	});

	it("pass-through layout leaves React-rendered body unchanged", async () => {
		const ctx = makeFakeContext();
		await reactEmailPlugin().init?.(ctx);

		const layout = ctx.layouts.get(REACT_EMAIL_LAYOUT_ID);
		expect(layout).toBeDefined();

		const reactBody = "<!doctype html><html><body><h1>Hi Ada</h1></body></html>";
		const rendered = renderEmail({
			layout,
			subject: "Welcome",
			body: reactBody,
			context: { subscriber: { name: "Ada" }, payload: {} },
		});

		expect(rendered.html).toBe(reactBody);
		expect(rendered.subject).toBe("Welcome");
	});
});
