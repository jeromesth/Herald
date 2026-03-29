import { describe, expect, it } from "vitest";
import { prismaAdapter } from "../src/adapters/database/prisma.js";
import { runDatabaseAdapterContract } from "./contracts/database-adapter.contract.js";

/**
 * In-memory mock Prisma client that implements the delegate pattern.
 * Each model key returns an object with create, findFirst, findMany, count, update, updateMany, delete, deleteMany.
 */
function createMockPrismaClient() {
	const store = new Map<string, Map<string, Record<string, unknown>>>();

	function getTable(model: string): Map<string, Record<string, unknown>> {
		if (!store.has(model)) {
			store.set(model, new Map());
		}
		return store.get(model) as Map<string, Record<string, unknown>>;
	}

	function matchesPrismaWhere(record: Record<string, unknown>, where: Record<string, unknown> | undefined): boolean {
		if (!where) return true;

		for (const [key, condition] of Object.entries(where)) {
			if (key === "AND") {
				const andConditions = condition as Record<string, unknown>[];
				if (!andConditions.every((c) => matchesPrismaWhere(record, c))) return false;
				continue;
			}
			if (key === "OR") {
				const orConditions = condition as Record<string, unknown>[];
				if (!orConditions.some((c) => matchesPrismaWhere(record, c))) return false;
				continue;
			}

			const fieldValue = record[key];

			if (condition === null || condition === undefined || typeof condition !== "object") {
				if (fieldValue !== condition) return false;
				continue;
			}

			const ops = condition as Record<string, unknown>;
			for (const [op, opVal] of Object.entries(ops)) {
				switch (op) {
					case "not":
						if (fieldValue === opVal) return false;
						break;
					case "lt":
						if (!((fieldValue as number) < (opVal as number))) return false;
						break;
					case "lte":
						if (!((fieldValue as number) <= (opVal as number))) return false;
						break;
					case "gt":
						if (!((fieldValue as number) > (opVal as number))) return false;
						break;
					case "gte":
						if (!((fieldValue as number) >= (opVal as number))) return false;
						break;
					case "in":
						if (!(opVal as unknown[]).includes(fieldValue)) return false;
						break;
					case "notIn":
						if ((opVal as unknown[]).includes(fieldValue)) return false;
						break;
					case "contains":
						if (typeof fieldValue !== "string" || !fieldValue.includes(opVal as string)) return false;
						break;
					case "startsWith":
						if (typeof fieldValue !== "string" || !fieldValue.startsWith(opVal as string)) return false;
						break;
					case "endsWith":
						if (typeof fieldValue !== "string" || !fieldValue.endsWith(opVal as string)) return false;
						break;
				}
			}
		}
		return true;
	}

	function applySelect(record: Record<string, unknown>, select?: Record<string, true>): Record<string, unknown> {
		if (!select) return { ...record };
		const result: Record<string, unknown> = {};
		for (const field of Object.keys(select)) {
			result[field] = record[field];
		}
		return result;
	}

	function createDelegate(model: string) {
		return {
			async create(args: { data: Record<string, unknown>; select?: Record<string, true> }) {
				const table = getTable(model);
				const id = (args.data.id as string) ?? crypto.randomUUID();
				const record = { ...args.data, id };
				table.set(id, record);
				return applySelect(record, args.select);
			},

			async findFirst(args: { where?: Record<string, unknown>; select?: Record<string, true> }) {
				const table = getTable(model);
				for (const record of table.values()) {
					if (matchesPrismaWhere(record, args.where)) {
						return applySelect(record, args.select);
					}
				}
				return null;
			},

			async findMany(args: {
				where?: Record<string, unknown>;
				take?: number;
				skip?: number;
				orderBy?: Record<string, string>;
				select?: Record<string, true>;
			}) {
				const table = getTable(model);
				let results = Array.from(table.values());

				if (args.where) {
					results = results.filter((r) => matchesPrismaWhere(r, args.where));
				}

				if (args.orderBy) {
					const [field, direction] = Object.entries(args.orderBy)[0] as [string, string];
					results.sort((a, b) => {
						const aVal = a[field];
						const bVal = b[field];
						if (aVal === bVal) return 0;
						if (aVal == null) return 1;
						if (bVal == null) return -1;
						const cmp = aVal < bVal ? -1 : 1;
						return direction === "asc" ? cmp : -cmp;
					});
				}

				const skip = args.skip ?? 0;
				const take = args.take ?? 100;
				results = results.slice(skip, skip + take);

				return results.map((r) => applySelect(r, args.select));
			},

			async count(args: { where?: Record<string, unknown> }) {
				const table = getTable(model);
				if (!args.where) return table.size;
				let count = 0;
				for (const record of table.values()) {
					if (matchesPrismaWhere(record, args.where)) count++;
				}
				return count;
			},

			async update(args: { where: Record<string, unknown>; data: Record<string, unknown> }) {
				const table = getTable(model);
				for (const [id, record] of table.entries()) {
					if (matchesPrismaWhere(record, args.where)) {
						const updated = { ...record, ...args.data };
						table.set(id, updated);
						return updated;
					}
				}
				throw new Error(`Record not found for update in "${model}"`);
			},

			async updateMany(args: { where?: Record<string, unknown>; data: Record<string, unknown> }) {
				const table = getTable(model);
				let count = 0;
				for (const [id, record] of table.entries()) {
					if (matchesPrismaWhere(record, args.where)) {
						table.set(id, { ...record, ...args.data });
						count++;
					}
				}
				return { count };
			},

			async delete(args: { where: Record<string, unknown> }) {
				const table = getTable(model);
				for (const [id, record] of table.entries()) {
					if (matchesPrismaWhere(record, args.where)) {
						table.delete(id);
						return record;
					}
				}
				throw new Error(`Record not found for delete in "${model}"`);
			},

			async deleteMany(args: { where?: Record<string, unknown> }) {
				const table = getTable(model);
				let count = 0;
				const toDelete: string[] = [];
				for (const [id, record] of table.entries()) {
					if (matchesPrismaWhere(record, args.where)) {
						toDelete.push(id);
					}
				}
				for (const id of toDelete) {
					table.delete(id);
					count++;
				}
				return { count };
			},
		};
	}

	// Return a Proxy that dynamically creates delegates for any model name
	return new Proxy({} as Record<string, unknown>, {
		get(_target, prop: string) {
			if (prop === "$transaction" || prop.startsWith("$")) return undefined;
			return createDelegate(prop);
		},
	});
}

runDatabaseAdapterContract("prismaAdapter", () => {
	const client = createMockPrismaClient();
	return prismaAdapter(client, { provider: "postgresql" });
});

describe("prismaAdapter: error handling", () => {
	it("throws for unknown model (no Prisma delegate)", async () => {
		// Create a client that only has "subscriber" model
		const client = { subscriber: createMockPrismaClient().subscriber } as Record<string, unknown>;
		const adapter = prismaAdapter(client, { provider: "postgresql" });

		await expect(
			adapter.findOne({
				model: "nonexistent",
				where: [{ field: "id", value: "1" }],
			}),
		).rejects.toThrow('Model "nonexistent" not found');
	});
});

describe("prismaAdapter: debugLogs", () => {
	it("logs operations when debugLogs is enabled", async () => {
		const client = createMockPrismaClient();
		const adapter = prismaAdapter(client, { provider: "postgresql", debugLogs: true });

		// Perform an operation — should not throw with debug logging enabled
		const result = await adapter.create({
			model: "subscriber",
			data: { externalId: "debug-test" },
		});
		expect(result).toBeDefined();
	});
});
