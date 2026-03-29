/**
 * Shared condition evaluation logic used by both workflow step conditions
 * and preference conditions.
 */

export interface Condition {
	field: string;
	operator: "eq" | "ne" | "gt" | "lt" | "in" | "not_in" | "exists";
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

/**
 * Evaluate a single condition against a value resolver.
 */
export function evaluateCondition(condition: Condition, actualValue: unknown): boolean {
	switch (condition.operator) {
		case "eq":
			return actualValue === condition.value;
		case "ne":
			return actualValue !== condition.value;
		case "gt":
			return Number(actualValue) > Number(condition.value);
		case "lt":
			return Number(actualValue) < Number(condition.value);
		case "in":
			return Array.isArray(condition.value) && condition.value.includes(actualValue);
		case "not_in":
			return Array.isArray(condition.value) && !condition.value.includes(actualValue);
		case "exists":
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
