/**
 * In-memory database adapter for Herald.
 * Used for testing and development — not for production.
 */
import type { DatabaseAdapter, Where } from "../../types/adapter.js";

export function memoryAdapter(): DatabaseAdapter {
	const store = new Map<string, Map<string, Record<string, unknown>>>();

	function getTable(model: string): Map<string, Record<string, unknown>> {
		if (!store.has(model)) {
			store.set(model, new Map());
		}
		return store.get(model)!;
	}

	function matchesWhere(record: Record<string, unknown>, where: Where[]): boolean {
		return where.every((clause) => {
			const value = record[clause.field];
			const operator = clause.operator ?? "eq";

			switch (operator) {
				case "eq":
					return value === clause.value;
				case "ne":
					return value !== clause.value;
				case "lt":
					return (value as number) < (clause.value as number);
				case "lte":
					return (value as number) <= (clause.value as number);
				case "gt":
					return (value as number) > (clause.value as number);
				case "gte":
					return (value as number) >= (clause.value as number);
				case "in":
					return (clause.value as unknown[]).includes(value);
				case "not_in":
					return !(clause.value as unknown[]).includes(value);
				case "contains":
					return typeof value === "string" && value.includes(clause.value as string);
				case "starts_with":
					return typeof value === "string" && value.startsWith(clause.value as string);
				case "ends_with":
					return typeof value === "string" && value.endsWith(clause.value as string);
				default:
					return false;
			}
		});
	}

	function applySelect(
		record: Record<string, unknown>,
		select?: string[],
	): Record<string, unknown> {
		if (!select || select.length === 0) return { ...record };
		const result: Record<string, unknown> = {};
		for (const field of select) {
			result[field] = record[field];
		}
		return result;
	}

	return {
		async create<T>(args: {
			model: string;
			data: Record<string, unknown>;
			select?: string[];
		}): Promise<T> {
			const table = getTable(args.model);
			const id = (args.data.id as string) ?? crypto.randomUUID();
			const record = { ...args.data, id };
			table.set(id, record);
			return applySelect(record, args.select) as T;
		},

		async findOne<T>(args: {
			model: string;
			where: Where[];
			select?: string[];
		}): Promise<T | null> {
			const table = getTable(args.model);
			for (const record of table.values()) {
				if (matchesWhere(record, args.where)) {
					return applySelect(record, args.select) as T;
				}
			}
			return null;
		},

		async findMany<T>(args: {
			model: string;
			where?: Where[];
			limit?: number;
			offset?: number;
			sortBy?: { field: string; direction: "asc" | "desc" };
			select?: string[];
		}): Promise<T[]> {
			const table = getTable(args.model);
			let results = Array.from(table.values());

			if (args.where) {
				results = results.filter((r) => matchesWhere(r, args.where!));
			}

			if (args.sortBy) {
				const { field, direction } = args.sortBy;
				results.sort((a, b) => {
					const aVal = a[field];
					const bVal = b[field];
					if (aVal === bVal) return 0;
					if (aVal == null) return 1;
					if (bVal == null) return -1;

					const comparison = aVal < bVal ? -1 : 1;
					return direction === "asc" ? comparison : -comparison;
				});
			}

			const offset = args.offset ?? 0;
			const limit = args.limit ?? 100;
			results = results.slice(offset, offset + limit);

			return results.map((r) => applySelect(r, args.select) as T);
		},

		async count(args: {
			model: string;
			where?: Where[];
		}): Promise<number> {
			const table = getTable(args.model);
			if (!args.where) return table.size;

			let count = 0;
			for (const record of table.values()) {
				if (matchesWhere(record, args.where)) count++;
			}
			return count;
		},

		async update<T>(args: {
			model: string;
			where: Where[];
			update: Record<string, unknown>;
		}): Promise<T> {
			const table = getTable(args.model);
			for (const [id, record] of table.entries()) {
				if (matchesWhere(record, args.where)) {
					const updated = { ...record, ...args.update };
					table.set(id, updated);
					return updated as T;
				}
			}
			throw new Error(`Record not found for update in "${args.model}"`);
		},

		async updateMany(args: {
			model: string;
			where?: Where[];
			update: Record<string, unknown>;
		}): Promise<number> {
			const table = getTable(args.model);
			let count = 0;

			for (const [id, record] of table.entries()) {
				if (!args.where || matchesWhere(record, args.where)) {
					table.set(id, { ...record, ...args.update });
					count++;
				}
			}
			return count;
		},

		async delete(args: {
			model: string;
			where: Where[];
		}): Promise<void> {
			const table = getTable(args.model);
			for (const [id, record] of table.entries()) {
				if (matchesWhere(record, args.where)) {
					table.delete(id);
					return;
				}
			}
			throw new Error(`Record not found for delete in "${args.model}"`);
		},

		async deleteMany(args: {
			model: string;
			where?: Where[];
		}): Promise<number> {
			const table = getTable(args.model);
			let count = 0;

			const toDelete: string[] = [];
			for (const [id, record] of table.entries()) {
				if (!args.where || matchesWhere(record, args.where)) {
					toDelete.push(id);
				}
			}

			for (const id of toDelete) {
				table.delete(id);
				count++;
			}

			return count;
		},
	};
}
