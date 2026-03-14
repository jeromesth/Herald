import type { DataTable } from "@cucumber/cucumber";

/**
 * Convert a Cucumber DataTable with "field" and "value" columns to a plain object.
 */
export function tableToObject(table: DataTable): Record<string, unknown> {
	const obj: Record<string, unknown> = {};
	for (const row of table.hashes()) {
		obj[row.field] = coerceValue(row.value);
	}
	return obj;
}

/**
 * Convert a Cucumber DataTable with header row to an array of objects.
 * Coerces values to appropriate types.
 */
export function tableToRecords(table: DataTable): Record<string, unknown>[] {
	return table.hashes().map((row) => {
		const record: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(row)) {
			record[key] = coerceValue(value);
		}
		return record;
	});
}

/**
 * Coerce string values from Gherkin tables to appropriate JS types.
 */
export function coerceValue(value: string): unknown {
	if (value === "true") return true;
	if (value === "false") return false;
	if (value === "null") return null;
	if (value === "undefined") return undefined;
	const num = Number(value);
	if (!Number.isNaN(num) && value.trim() !== "") return num;
	return value;
}
