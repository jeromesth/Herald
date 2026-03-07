import assert from "node:assert/strict";
import { type DataTable, Given, Then, When } from "@cucumber/cucumber";
import { memoryAdapter } from "../../src/adapters/database/memory.js";
import type { DatabaseAdapter, Where, WhereOperator } from "../../src/types/adapter.js";
import { coerceValue, tableToObject, tableToRecords } from "../support/helpers.js";

interface HeraldWorld {
	db: DatabaseAdapter;
	result: Record<string, unknown> | null;
	results: Record<string, unknown>[];
	count: number;
	error: Error | null;
}

Given("a fresh database adapter", function (this: HeraldWorld) {
	this.db = memoryAdapter();
	this.result = null;
	this.results = [];
	this.count = 0;
	this.error = null;
});

Given("the following {string} records exist:", async function (this: HeraldWorld, model: string, table: DataTable) {
	const records = tableToRecords(table);
	for (const data of records) {
		await this.db.create({ model, data });
	}
});

// === CREATE ===

When("I create a {string} with data:", async function (this: HeraldWorld, model: string, table: DataTable) {
	const data = tableToObject(table);
	this.result = await this.db.create({ model, data });
});

When(
	"I create a {string} with data and select {string}:",
	async function (this: HeraldWorld, model: string, selectStr: string, table: DataTable) {
		const data = tableToObject(table);
		const select = selectStr.split(",").map((s) => s.trim());
		this.result = await this.db.create({ model, data, select });
	},
);

// === FIND ONE ===

When("I find one {string} where {string} equals {string}", async function (this: HeraldWorld, model: string, field: string, value: string) {
	this.result = await this.db.findOne({
		model,
		where: [{ field, value: coerceValue(value) }],
	});
});

When(
	"I find one {string} where {string} equals {string} and {string} equals {string}",
	async function (this: HeraldWorld, model: string, field1: string, value1: string, field2: string, value2: string) {
		this.result = await this.db.findOne({
			model,
			where: [
				{ field: field1, value: coerceValue(value1) },
				{ field: field2, value: coerceValue(value2) },
			],
		});
	},
);

When(
	"I find one {string} where {string} equals {string} with select {string}",
	async function (this: HeraldWorld, model: string, field: string, value: string, selectStr: string) {
		const select = selectStr.split(",").map((s) => s.trim());
		this.result = await this.db.findOne({
			model,
			where: [{ field, value: coerceValue(value) }],
			select,
		});
	},
);

// === FIND MANY ===

When("I find many {string}", async function (this: HeraldWorld, model: string) {
	this.results = await this.db.findMany({ model });
});

When(
	"I find many {string} where {string} equals {string}",
	async function (this: HeraldWorld, model: string, field: string, value: string) {
		this.results = await this.db.findMany({
			model,
			where: [{ field, value: coerceValue(value) }],
		});
	},
);

When("I find many {string} with limit {int}", async function (this: HeraldWorld, model: string, limit: number) {
	this.results = await this.db.findMany({ model, limit });
});

When(
	"I find many {string} with limit {int} and offset {int}",
	async function (this: HeraldWorld, model: string, limit: number, offset: number) {
		this.results = await this.db.findMany({ model, limit, offset });
	},
);

When(
	"I find many {string} sorted by {string} {string}",
	async function (this: HeraldWorld, model: string, field: string, direction: string) {
		this.results = await this.db.findMany({
			model,
			sortBy: { field, direction: direction as "asc" | "desc" },
		});
	},
);

When(
	"I find many {string} with select {string} and limit {int}",
	async function (this: HeraldWorld, model: string, selectStr: string, limit: number) {
		const select = selectStr.split(",").map((s) => s.trim());
		this.results = await this.db.findMany({ model, select, limit });
	},
);

// === FIND MANY WITH OPERATORS ===

When("I find many {string} where {string} eq {string}", async function (this: HeraldWorld, model: string, field: string, operand: string) {
	this.results = await this.db.findMany({
		model,
		where: [{ field, value: coerceValue(operand), operator: "eq" }],
	});
});

When("I find many {string} where {string} ne {string}", async function (this: HeraldWorld, model: string, field: string, operand: string) {
	this.results = await this.db.findMany({
		model,
		where: [{ field, value: coerceValue(operand), operator: "ne" }],
	});
});

When("I find many {string} where {string} lt {string}", async function (this: HeraldWorld, model: string, field: string, operand: string) {
	this.results = await this.db.findMany({
		model,
		where: [{ field, value: coerceValue(operand), operator: "lt" }],
	});
});

When("I find many {string} where {string} lte {string}", async function (this: HeraldWorld, model: string, field: string, operand: string) {
	this.results = await this.db.findMany({
		model,
		where: [{ field, value: coerceValue(operand), operator: "lte" }],
	});
});

When("I find many {string} where {string} gt {string}", async function (this: HeraldWorld, model: string, field: string, operand: string) {
	this.results = await this.db.findMany({
		model,
		where: [{ field, value: coerceValue(operand), operator: "gt" }],
	});
});

When("I find many {string} where {string} gte {string}", async function (this: HeraldWorld, model: string, field: string, operand: string) {
	this.results = await this.db.findMany({
		model,
		where: [{ field, value: coerceValue(operand), operator: "gte" }],
	});
});

When("I find many {string} where {string} in {string}", async function (this: HeraldWorld, model: string, field: string, operand: string) {
	const values = operand.split(",").map((s) => coerceValue(s.trim()));
	this.results = await this.db.findMany({
		model,
		where: [{ field, value: values, operator: "in" }],
	});
});

When(
	"I find many {string} where {string} not_in {string}",
	async function (this: HeraldWorld, model: string, field: string, operand: string) {
		const values = operand.split(",").map((s) => coerceValue(s.trim()));
		this.results = await this.db.findMany({
			model,
			where: [{ field, value: values, operator: "not_in" }],
		});
	},
);

When(
	"I find many {string} where {string} contains {string}",
	async function (this: HeraldWorld, model: string, field: string, operand: string) {
		this.results = await this.db.findMany({
			model,
			where: [{ field, value: operand, operator: "contains" }],
		});
	},
);

When(
	"I find many {string} where {string} starts_with {string}",
	async function (this: HeraldWorld, model: string, field: string, operand: string) {
		this.results = await this.db.findMany({
			model,
			where: [{ field, value: operand, operator: "starts_with" }],
		});
	},
);

When(
	"I find many {string} where {string} ends_with {string}",
	async function (this: HeraldWorld, model: string, field: string, operand: string) {
		this.results = await this.db.findMany({
			model,
			where: [{ field, value: operand, operator: "ends_with" }],
		});
	},
);

// === FIND MANY WITH AND/OR ===

When(
	"I find many {string} where {string} equals {string} and {string} equals {string}",
	async function (this: HeraldWorld, model: string, field1: string, value1: string, field2: string, value2: string) {
		this.results = await this.db.findMany({
			model,
			where: [
				{ field: field1, value: coerceValue(value1) },
				{ field: field2, value: coerceValue(value2) },
			],
		});
	},
);

When(
	"I find many {string} where {string} equals {string} or {string} equals {string}",
	async function (this: HeraldWorld, model: string, field1: string, value1: string, field2: string, value2: string) {
		this.results = await this.db.findMany({
			model,
			where: [
				{ field: field1, value: coerceValue(value1), connector: "OR" },
				{ field: field2, value: coerceValue(value2), connector: "OR" },
			],
		});
	},
);

// === COUNT ===

When("I count {string}", async function (this: HeraldWorld, model: string) {
	this.count = await this.db.count({ model });
});

When("I count {string} where {string} equals {string}", async function (this: HeraldWorld, model: string, field: string, value: string) {
	this.count = await this.db.count({
		model,
		where: [{ field, value: coerceValue(value) }],
	});
});

// === UPDATE ===

When(
	"I update {string} where {string} equals {string} with:",
	async function (this: HeraldWorld, model: string, field: string, value: string, table: DataTable) {
		const update = tableToObject(table);
		try {
			this.result = await this.db.update({
				model,
				where: [{ field, value: coerceValue(value) }],
				update,
			});
		} catch (err) {
			this.error = err as Error;
		}
	},
);

// === UPDATE MANY ===

When(
	"I update many {string} where {string} equals {string} with:",
	async function (this: HeraldWorld, model: string, field: string, value: string, table: DataTable) {
		const update = tableToObject(table);
		this.count = await this.db.updateMany({
			model,
			where: [{ field, value: coerceValue(value) }],
			update,
		});
	},
);

// === DELETE ===

When("I delete {string} where {string} equals {string}", async function (this: HeraldWorld, model: string, field: string, value: string) {
	try {
		await this.db.delete({
			model,
			where: [{ field, value: coerceValue(value) }],
		});
	} catch (err) {
		this.error = err as Error;
	}
});

// === DELETE MANY ===

When(
	"I delete many {string} where {string} equals {string}",
	async function (this: HeraldWorld, model: string, field: string, value: string) {
		this.count = await this.db.deleteMany({
			model,
			where: [{ field, value: coerceValue(value) }],
		});
	},
);

When("I delete many {string}", async function (this: HeraldWorld, model: string) {
	this.count = await this.db.deleteMany({ model });
});

// === THEN ASSERTIONS ===

Then("the result should contain:", function (this: HeraldWorld, table: DataTable) {
	assert.ok(this.result, "Expected a result but got null/undefined");
	const expected = tableToObject(table);
	for (const [key, value] of Object.entries(expected)) {
		assert.deepStrictEqual(this.result[key], value, `Expected ${key} to be ${value}, got ${this.result[key]}`);
	}
});

Then("the result should not contain field {string}", function (this: HeraldWorld, field: string) {
	assert.ok(this.result, "Expected a result but got null/undefined");
	assert.ok(!(field in this.result), `Expected result to not contain field "${field}"`);
});

Then("the result should not be null", function (this: HeraldWorld) {
	assert.ok(this.result !== null, "Expected result to not be null");
});

Then("the result should be null", function (this: HeraldWorld) {
	assert.strictEqual(this.result, null, "Expected result to be null");
});

Then("the result field {string} should equal {string}", function (this: HeraldWorld, field: string, value: string) {
	assert.ok(this.result, "Expected a result but got null/undefined");
	assert.deepStrictEqual(this.result[field], coerceValue(value));
});

Then("I should get {int} result(s)", function (this: HeraldWorld, count: number) {
	assert.strictEqual(this.results.length, count, `Expected ${count} results, got ${this.results.length}`);
});

Then("the first result field {string} should equal {string}", function (this: HeraldWorld, field: string, value: string) {
	assert.ok(this.results.length > 0, "Expected at least one result");
	assert.deepStrictEqual(this.results[0]![field], coerceValue(value));
});

Then("the last result field {string} should equal {string}", function (this: HeraldWorld, field: string, value: string) {
	assert.ok(this.results.length > 0, "Expected at least one result");
	assert.deepStrictEqual(this.results[this.results.length - 1]![field], coerceValue(value));
});

Then("the first result should only contain field {string}", function (this: HeraldWorld, field: string) {
	assert.ok(this.results.length > 0, "Expected at least one result");
	const keys = Object.keys(this.results[0]!);
	assert.deepStrictEqual(keys, [field], `Expected only field "${field}", got ${JSON.stringify(keys)}`);
});

Then("the count should be {int}", function (this: HeraldWorld, expected: number) {
	assert.strictEqual(this.count, expected);
});

Then("it should throw an error", function (this: HeraldWorld) {
	assert.ok(this.error, "Expected an error to be thrown");
});

Then("the update count should be {int}", function (this: HeraldWorld, expected: number) {
	assert.strictEqual(this.count, expected);
});

Then("the delete count should be {int}", function (this: HeraldWorld, expected: number) {
	assert.strictEqual(this.count, expected);
});
