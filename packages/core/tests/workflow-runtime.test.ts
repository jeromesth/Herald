import { describe, expect, it } from "vitest";
import { conditionsPass } from "../src/core/workflow-runtime.js";
import type { StepCondition, StepContext } from "../src/types/workflow.js";

function makeContext(
	payload: Record<string, unknown> = {},
	subscriber: { id: string; externalId: string } = { id: "sub-1", externalId: "ext-1" },
): StepContext {
	return {
		payload,
		subscriber,
		step: {
			delay: async () => {},
			digest: async () => [],
		},
	};
}

describe("conditionsPass", () => {
	it("returns true when no conditions", () => {
		expect(conditionsPass(undefined, makeContext())).toBe(true);
		expect(conditionsPass([], makeContext())).toBe(true);
	});

	describe("eq operator", () => {
		it("passes when values are equal", () => {
			const conditions: StepCondition[] = [{ field: "payload.plan", operator: "eq", value: "pro" }];
			expect(conditionsPass(conditions, makeContext({ plan: "pro" }))).toBe(true);
		});

		it("fails when values differ", () => {
			const conditions: StepCondition[] = [{ field: "payload.plan", operator: "eq", value: "pro" }];
			expect(conditionsPass(conditions, makeContext({ plan: "free" }))).toBe(false);
		});
	});

	describe("ne operator", () => {
		it("passes when values differ", () => {
			const conditions: StepCondition[] = [
				{ field: "payload.plan", operator: "ne", value: "free" },
			];
			expect(conditionsPass(conditions, makeContext({ plan: "pro" }))).toBe(true);
		});

		it("fails when values are equal", () => {
			const conditions: StepCondition[] = [{ field: "payload.plan", operator: "ne", value: "pro" }];
			expect(conditionsPass(conditions, makeContext({ plan: "pro" }))).toBe(false);
		});
	});

	describe("gt operator", () => {
		it("passes when actual > expected", () => {
			const conditions: StepCondition[] = [{ field: "payload.score", operator: "gt", value: 50 }];
			expect(conditionsPass(conditions, makeContext({ score: 100 }))).toBe(true);
		});

		it("fails when actual <= expected", () => {
			const conditions: StepCondition[] = [{ field: "payload.score", operator: "gt", value: 50 }];
			expect(conditionsPass(conditions, makeContext({ score: 50 }))).toBe(false);
			expect(conditionsPass(conditions, makeContext({ score: 10 }))).toBe(false);
		});
	});

	describe("lt operator", () => {
		it("passes when actual < expected", () => {
			const conditions: StepCondition[] = [{ field: "payload.score", operator: "lt", value: 50 }];
			expect(conditionsPass(conditions, makeContext({ score: 10 }))).toBe(true);
		});

		it("fails when actual >= expected", () => {
			const conditions: StepCondition[] = [{ field: "payload.score", operator: "lt", value: 50 }];
			expect(conditionsPass(conditions, makeContext({ score: 50 }))).toBe(false);
		});
	});

	describe("in operator", () => {
		it("passes when value is in array", () => {
			const conditions: StepCondition[] = [
				{ field: "payload.plan", operator: "in", value: ["pro", "enterprise"] },
			];
			expect(conditionsPass(conditions, makeContext({ plan: "pro" }))).toBe(true);
		});

		it("fails when value is not in array", () => {
			const conditions: StepCondition[] = [
				{ field: "payload.plan", operator: "in", value: ["pro", "enterprise"] },
			];
			expect(conditionsPass(conditions, makeContext({ plan: "free" }))).toBe(false);
		});

		it("fails when value is not an array", () => {
			const conditions: StepCondition[] = [
				{ field: "payload.plan", operator: "in", value: "not-array" },
			];
			expect(conditionsPass(conditions, makeContext({ plan: "pro" }))).toBe(false);
		});
	});

	describe("not_in operator", () => {
		it("passes when value is not in array", () => {
			const conditions: StepCondition[] = [
				{ field: "payload.plan", operator: "not_in", value: ["free", "trial"] },
			];
			expect(conditionsPass(conditions, makeContext({ plan: "pro" }))).toBe(true);
		});

		it("fails when value is in array", () => {
			const conditions: StepCondition[] = [
				{ field: "payload.plan", operator: "not_in", value: ["free", "trial"] },
			];
			expect(conditionsPass(conditions, makeContext({ plan: "free" }))).toBe(false);
		});
	});

	describe("exists operator", () => {
		it("passes when field exists and is not null", () => {
			const conditions: StepCondition[] = [
				{ field: "payload.name", operator: "exists", value: true },
			];
			expect(conditionsPass(conditions, makeContext({ name: "Alice" }))).toBe(true);
		});

		it("passes for falsy but existing values", () => {
			const conditions: StepCondition[] = [
				{ field: "payload.count", operator: "exists", value: true },
			];
			expect(conditionsPass(conditions, makeContext({ count: 0 }))).toBe(true);
			expect(conditionsPass(conditions, makeContext({ count: "" }))).toBe(true);
			expect(conditionsPass(conditions, makeContext({ count: false }))).toBe(true);
		});

		it("fails when field is undefined", () => {
			const conditions: StepCondition[] = [
				{ field: "payload.missing", operator: "exists", value: true },
			];
			expect(conditionsPass(conditions, makeContext({}))).toBe(false);
		});

		it("fails when field is null", () => {
			const conditions: StepCondition[] = [
				{ field: "payload.val", operator: "exists", value: true },
			];
			expect(conditionsPass(conditions, makeContext({ val: null }))).toBe(false);
		});
	});

	describe("field resolution", () => {
		it("resolves payload. prefixed fields", () => {
			const conditions: StepCondition[] = [
				{ field: "payload.nested.value", operator: "eq", value: "deep" },
			];
			expect(conditionsPass(conditions, makeContext({ nested: { value: "deep" } }))).toBe(true);
		});

		it("resolves subscriber. prefixed fields", () => {
			const conditions: StepCondition[] = [
				{ field: "subscriber.externalId", operator: "eq", value: "ext-1" },
			];
			expect(conditionsPass(conditions, makeContext())).toBe(true);
		});

		it("resolves bare field names from payload", () => {
			const conditions: StepCondition[] = [{ field: "plan", operator: "eq", value: "pro" }];
			expect(conditionsPass(conditions, makeContext({ plan: "pro" }))).toBe(true);
		});
	});

	describe("multiple conditions (AND logic)", () => {
		it("requires all conditions to pass", () => {
			const conditions: StepCondition[] = [
				{ field: "payload.plan", operator: "eq", value: "pro" },
				{ field: "payload.active", operator: "eq", value: true },
			];
			expect(conditionsPass(conditions, makeContext({ plan: "pro", active: true }))).toBe(true);
			expect(conditionsPass(conditions, makeContext({ plan: "pro", active: false }))).toBe(false);
		});
	});

	describe("unknown operator", () => {
		it("returns false for unsupported operators", () => {
			const conditions: StepCondition[] = [
				{ field: "payload.name", operator: "contains" as StepCondition["operator"], value: "test" },
			];
			expect(conditionsPass(conditions, makeContext({ name: "test" }))).toBe(false);
		});
	});
});
