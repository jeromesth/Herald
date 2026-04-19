import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { defineEmailTemplate } from "../src/define.js";

interface WelcomeProps {
	name: string;
}

describe("defineEmailTemplate", () => {
	it("normalizes a static subject string into a function", () => {
		const template = defineEmailTemplate<WelcomeProps>({
			subject: "Welcome aboard",
			Component: ({ name }) => createElement("h1", null, `Hi ${name}`),
		});

		expect(template.subject({ name: "Ada" })).toBe("Welcome aboard");
	});

	it("passes props to a subject function", () => {
		const template = defineEmailTemplate<WelcomeProps>({
			subject: (props) => `Welcome, ${props.name}!`,
			Component: ({ name }) => createElement("h1", null, `Hi ${name}`),
		});

		expect(template.subject({ name: "Ada" })).toBe("Welcome, Ada!");
	});

	it("builds a React element with the supplied props", () => {
		const template = defineEmailTemplate<WelcomeProps>({
			id: "welcome",
			subject: "Hello",
			Component: ({ name }) => createElement("h1", null, `Hi ${name}`),
		});

		const element = template.createElement({ name: "Ada" });
		expect(element.props).toEqual({ name: "Ada" });
		expect(template.id).toBe("welcome");
	});

	it("normalizes a static preview string into a function", () => {
		const template = defineEmailTemplate<WelcomeProps>({
			subject: "Hello",
			preview: "See what's inside",
			Component: ({ name }) => createElement("p", null, name),
		});

		expect(template.preview?.({ name: "Ada" })).toBe("See what's inside");
	});

	it("omits preview when not configured", () => {
		const template = defineEmailTemplate<WelcomeProps>({
			subject: "Hello",
			Component: ({ name }) => createElement("p", null, name),
		});

		expect(template.preview).toBeUndefined();
	});
});
