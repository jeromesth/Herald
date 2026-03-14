import assert from "node:assert/strict";
import { type DataTable, Given, Then, When } from "@cucumber/cucumber";
import { HandlebarsEngine } from "../../src/templates/engine.js";
import type { TemplateContext } from "../../src/templates/types.js";

interface TemplateWorld {
	engine: HandlebarsEngine;
	rendered: string;
}

Given("a HandlebarsEngine", function (this: TemplateWorld) {
	this.engine = new HandlebarsEngine();
	this.rendered = "";
});

When("I render {string} with name {string}", function (this: TemplateWorld, template: string, name: string) {
	this.rendered = this.engine.render(template, { name } as TemplateContext);
});

When("I render {string} with subscriber firstName {string}", function (this: TemplateWorld, template: string, firstName: string) {
	this.rendered = this.engine.render(template, { subscriber: { firstName } } as TemplateContext);
});

When("I render {string} with content {string}", function (this: TemplateWorld, template: string, content: string) {
	this.rendered = this.engine.render(template, { content } as TemplateContext);
});

When("I render {string} with active {word}", function (this: TemplateWorld, template: string, activeStr: string) {
	const active = activeStr === "true";
	this.rendered = this.engine.render(template, { active } as TemplateContext);
});

When("I render {string} with items", function (this: TemplateWorld, template: string, table: DataTable) {
	const items = table.hashes();
	this.rendered = this.engine.render(template, { items } as TemplateContext);
});

When("I render {string} with no variables", function (this: TemplateWorld, template: string) {
	this.rendered = this.engine.render(template, {} as TemplateContext);
});

When("I render {string} with text {string}", function (this: TemplateWorld, template: string, text: string) {
	this.rendered = this.engine.render(template, { text } as TemplateContext);
});

Then("the rendered output should be {string}", function (this: TemplateWorld, expected: string) {
	assert.strictEqual(this.rendered, expected);
});
