/**
 * Shared condition evaluation logic used by both workflow step conditions
 * and preference conditions.
 */

/** Single source of truth for allowed `operator` values (runtime switch + Zod, etc.). */
export const CONDITION_OPERATORS = ["eq", "ne", "gt", "lt", "in", "not_in", "exists"] as const;

export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

export interface Condition {
	field: string;
	operator: ConditionOperator;
	value: unknown;
}

/**
 * Resolve a dot-separated path (e.g. "subscriber.data.plan") from a nested object.
 */
export function resolvePath(source: Record<string, unknown>, path: string): unknown {
	const parts = path.split(".").filter(Boolean);
	let current: unknown = source;

	for (const part of parts) {
		if (current == null || typeof current !== "object") {
			return undefined;
		}
		current = (current as Record<string, unknown>)[part];
	}

	return current;
}

function assertFiniteComparableNumber(value: unknown, condition: Condition, role: "condition value" | "resolved value"): number {
	const n = Number(value);
	if (!Number.isFinite(n)) {
		throw new TypeError(
			`[herald] Condition on field "${condition.field}" uses operator "${condition.operator}" with non-finite numeric ${role}: ${JSON.stringify(value)}`,
		);
	}
	return n;
}

/**
 * For gt/lt, undefined/null actual means the condition is not satisfied (same as before, but without NaN).
 * Any other non-numeric value throws so mis-typed fields do not silently compare as false.
 */
function numericActualForOrderComparison(actualValue: unknown, condition: Condition): number | null {
	if (actualValue === undefined || actualValue === null) {
		return null;
	}
	return assertFiniteComparableNumber(actualValue, condition, "resolved value");
}

/**
 * Evaluate a single condition against a value resolver.
 */
export function evaluateCondition(condition: Condition, actualValue: unknown): boolean {
	switch (condition.operator) {
		case "eq":
			return actualValue === condition.value;
		case "ne":
			return actualValue !== condition.value;
		case "gt": {
			const threshold = assertFiniteComparableNumber(condition.value, condition, "condition value");
			const left = numericActualForOrderComparison(actualValue, condition);
			if (left === null) {
				return false;
			}
			return left > threshold;
		}
		case "lt": {
			const threshold = assertFiniteComparableNumber(condition.value, condition, "condition value");
			const left = numericActualForOrderComparison(actualValue, condition);
			if (left === null) {
				return false;
			}
			return left < threshold;
		}
		case "in":
			return Array.isArray(condition.value) && condition.value.includes(actualValue);
		case "not_in":
			return Array.isArray(condition.value) && !condition.value.includes(actualValue);
		case "exists":
			// When value is false, asserts the field does NOT exist (undefined/null)
			if (condition.value === false) {
				return actualValue === undefined || actualValue === null;
			}
			return actualValue !== undefined && actualValue !== null;
		default:
			return false;
	}
}

/**
 * Evaluate conditions against a context object. Returns true if all/any conditions pass.
 */
export function conditionsPass(
	conditions: Condition[] | undefined,
	resolveValue: (field: string) => unknown,
	mode: "all" | "any" = "all",
): boolean {
	if (!conditions?.length) {
		return true;
	}

	const check = mode === "any" ? conditions.some.bind(conditions) : conditions.every.bind(conditions);
	return check((condition: Condition) => {
		const actualValue = resolveValue(condition.field);
		return evaluateCondition(condition, actualValue);
	});
}
