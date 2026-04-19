import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { defineEmailTemplate } from "../src/define.js";
import { REACT_EMAIL_LAYOUT_ID } from "../src/layout.js";
import { renderReactEmail } from "../src/render.js";

interface OrderProps {
	orderNumber: string;
	customerName: string;
}

const OrderShippedEmail = defineEmailTemplate<OrderProps>({
	id: "order-shipped",
	subject: (p) => `Order ${p.orderNumber} shipped`,
	preview: (p) => `Good news, ${p.customerName}`,
	Component: ({ orderNumber, customerName }) =>
		createElement(
			"html",
			null,
			createElement(
				"body",
				null,
				createElement("h1", null, `Thanks, ${customerName}`),
				createElement("p", null, `Your order ${orderNumber} is on its way.`),
			),
		),
});

describe("renderReactEmail", () => {
	it("renders to HTML and tags the pass-through layout", async () => {
		const result = await renderReactEmail(OrderShippedEmail, {
			orderNumber: "A-100",
			customerName: "Ada",
		});

		expect(result.subject).toBe("Order A-100 shipped");
		expect(result.body).toContain("Thanks, Ada");
		expect(result.body).toContain("A-100");
		expect(result.data.layoutId).toBe(REACT_EMAIL_LAYOUT_ID);
	});

	it("produces a plain-text fallback by default", async () => {
		const result = await renderReactEmail(OrderShippedEmail, {
			orderNumber: "A-101",
			customerName: "Grace",
		});

		expect(result.data.text.toLowerCase()).toContain("grace");
		expect(result.data.text).toContain("A-101");
		expect(result.data.text).not.toContain("<html>");
	});

	it("skips plain-text rendering when disabled", async () => {
		const result = await renderReactEmail(OrderShippedEmail, { orderNumber: "A-102", customerName: "Hedy" }, { plainText: false });

		expect(result.data.text).toBe("");
	});

	it("forwards preview text to data when the template defines one", async () => {
		const result = await renderReactEmail(OrderShippedEmail, {
			orderNumber: "A-103",
			customerName: "Lin",
		});

		expect(result.data.preview).toBe("Good news, Lin");
	});

	it("omits preview when the template does not define one", async () => {
		const NoPreview = defineEmailTemplate<{ name: string }>({
			subject: "Hi",
			Component: ({ name }) => createElement("html", null, createElement("p", null, name)),
		});

		const result = await renderReactEmail(NoPreview, { name: "Mu" });
		expect(result.data.preview).toBeUndefined();
	});
});
