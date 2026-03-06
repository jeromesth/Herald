import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzleAdapter } from "../src/adapters/database/drizzle/adapter.js";
import type { DatabaseAdapter } from "../src/types/adapter.js";

/**
 * Creates a mock Drizzle DB instance that captures query chain calls.
 * Each method returns a chainable builder, and terminal methods resolve with configured data.
 */
function createMockDb(options?: { returnData?: unknown[]; countResult?: number }) {
	const returnData = options?.returnData ?? [];
	const countResult = options?.countResult ?? 0;

	const calls: { method: string; args: unknown[] }[] = [];

	function createChain(startMethod: string, startArgs: unknown[]) {
		calls.push({ method: startMethod, args: startArgs });

		const chain: Record<string, unknown> = {};
		const chainMethods = ["from", "where", "limit", "offset", "orderBy", "values", "set", "returning"];

		for (const method of chainMethods) {
			chain[method] = (...args: unknown[]) => {
				calls.push({ method, args });
				if (method === "returning") {
					return Promise.resolve(returnData);
				}
				return chain;
			};
		}

		// Make chain thenable for queries without .returning()
		chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
			return Promise.resolve(returnData).then(resolve, reject);
		};

		return chain;
	}

	const db = {
		select: (...args: unknown[]) => createChain("select", args),
		insert: (...args: unknown[]) => createChain("insert", args),
		update: (...args: unknown[]) => createChain("update", args),
		delete: (...args: unknown[]) => createChain("delete", args),
	};

	return { db, calls };
}

describe("drizzleAdapter", () => {
	describe("create", () => {
		it("creates a record and returns it", async () => {
			const record = { id: "1", externalId: "user-1", email: "test@example.com" };
			const { db } = createMockDb({ returnData: [record] });
			const adapter = drizzleAdapter(db);

			const result = await adapter.create({
				model: "subscriber",
				data: record,
			});

			expect(result).toEqual(record);
		});

		it("applies select projection on create", async () => {
			const record = { id: "1", externalId: "user-1", email: "test@example.com" };
			const { db } = createMockDb({ returnData: [record] });
			const adapter = drizzleAdapter(db);

			const result = await adapter.create({
				model: "subscriber",
				data: record,
				select: ["id", "email"],
			});

			expect(result).toEqual({ id: "1", email: "test@example.com" });
		});
	});

	describe("findOne", () => {
		it("finds a record by where clause", async () => {
			const record = { id: "1", externalId: "user-1", email: "test@example.com" };
			const { db } = createMockDb({ returnData: [record] });
			const adapter = drizzleAdapter(db);

			const result = await adapter.findOne({
				model: "subscriber",
				where: [{ field: "externalId", value: "user-1" }],
			});

			expect(result).toEqual(record);
		});

		it("finds with multiple where clauses", async () => {
			const record = { id: "1", externalId: "user-1", email: "test@example.com" };
			const { db } = createMockDb({ returnData: [record] });
			const adapter = drizzleAdapter(db);

			const result = await adapter.findOne({
				model: "subscriber",
				where: [
					{ field: "externalId", value: "user-1" },
					{ field: "email", value: "test@example.com" },
				],
			});

			expect(result).toEqual(record);
		});

		it("returns null when not found", async () => {
			const { db } = createMockDb({ returnData: [] });
			const adapter = drizzleAdapter(db);

			const result = await adapter.findOne({
				model: "subscriber",
				where: [{ field: "externalId", value: "nonexistent" }],
			});

			expect(result).toBeNull();
		});
	});

	describe("findMany", () => {
		it("returns all records", async () => {
			const records = [
				{ id: "1", name: "Alpha" },
				{ id: "2", name: "Beta" },
			];
			const { db } = createMockDb({ returnData: records });
			const adapter = drizzleAdapter(db);

			const results = await adapter.findMany({ model: "subscriber" });
			expect(results).toHaveLength(2);
		});

		it("filters by where clause", async () => {
			const records = [{ id: "2", name: "Beta" }];
			const { db, calls } = createMockDb({ returnData: records });
			const adapter = drizzleAdapter(db);

			const results = await adapter.findMany({
				model: "subscriber",
				where: [{ field: "firstName", value: "Beta" }],
			});

			expect(results).toHaveLength(1);
			expect(calls.some((c) => c.method === "where")).toBe(true);
		});

		it("applies sort, limit, and offset", async () => {
			const { db, calls } = createMockDb({ returnData: [] });
			const adapter = drizzleAdapter(db);

			await adapter.findMany({
				model: "subscriber",
				sortBy: { field: "createdAt", direction: "desc" },
				limit: 10,
				offset: 5,
			});

			expect(calls.some((c) => c.method === "orderBy")).toBe(true);
			expect(calls.some((c) => c.method === "limit")).toBe(true);
			expect(calls.some((c) => c.method === "offset")).toBe(true);
		});

		it("handles empty results", async () => {
			const { db } = createMockDb({ returnData: [] });
			const adapter = drizzleAdapter(db);

			const results = await adapter.findMany({ model: "subscriber" });
			expect(results).toEqual([]);
		});
	});

	describe("count", () => {
		it("counts records", async () => {
			const { db } = createMockDb({ returnData: [{ count: 5 }] });
			const adapter = drizzleAdapter(db);

			const count = await adapter.count({ model: "subscriber" });
			expect(count).toBe(5);
		});

		it("counts with where clause", async () => {
			const { db, calls } = createMockDb({ returnData: [{ count: 2 }] });
			const adapter = drizzleAdapter(db);

			const count = await adapter.count({
				model: "subscriber",
				where: [{ field: "email", value: "test@example.com" }],
			});

			expect(count).toBe(2);
			expect(calls.some((c) => c.method === "where")).toBe(true);
		});
	});

	describe("update", () => {
		it("updates a single record", async () => {
			const updated = { id: "1", externalId: "user-1", email: "new@example.com" };
			const { db } = createMockDb({ returnData: [{ id: "1" }] });
			const adapter = drizzleAdapter(db);

			// Override the update chain to return updated data
			const originalUpdate = db.update;
			db.update = (...args: unknown[]) => {
				const chain = originalUpdate(...args);
				chain.set = (...setArgs: unknown[]) => {
					return {
						where: (..._whereArgs: unknown[]) => ({
							returning: () => Promise.resolve([updated]),
						}),
					};
				};
				return chain;
			};

			const result = await adapter.update({
				model: "subscriber",
				where: [{ field: "id", value: "1" }],
				update: { email: "new@example.com" },
			});

			expect(result).toEqual(updated);
		});

		it("throws when record not found for update", async () => {
			const { db } = createMockDb({ returnData: [] });
			const adapter = drizzleAdapter(db);

			await expect(
				adapter.update({
					model: "subscriber",
					where: [{ field: "id", value: "nonexistent" }],
					update: { email: "new@example.com" },
				}),
			).rejects.toThrow("Record not found for update");
		});
	});

	describe("updateMany", () => {
		it("updates multiple records and returns count", async () => {
			const records = [{ id: "1" }, { id: "2" }, { id: "3" }];
			const { db } = createMockDb({ returnData: records });
			const adapter = drizzleAdapter(db);

			const count = await adapter.updateMany({
				model: "notification",
				where: [{ field: "read", value: false }],
				update: { read: true },
			});

			expect(count).toBe(3);
		});
	});

	describe("delete", () => {
		it("deletes a single record", async () => {
			const { db } = createMockDb({ returnData: [{ id: "1" }] });
			const adapter = drizzleAdapter(db);

			// Override delete chain
			const originalDelete = db.delete;
			db.delete = (...args: unknown[]) => {
				const chain = originalDelete(...args);
				chain.where = () => Promise.resolve();
				return chain;
			};

			await expect(
				adapter.delete({
					model: "subscriber",
					where: [{ field: "id", value: "1" }],
				}),
			).resolves.toBeUndefined();
		});

		it("throws when record not found for delete", async () => {
			const { db } = createMockDb({ returnData: [] });
			const adapter = drizzleAdapter(db);

			await expect(
				adapter.delete({
					model: "subscriber",
					where: [{ field: "id", value: "nonexistent" }],
				}),
			).rejects.toThrow("Record not found for delete");
		});
	});

	describe("deleteMany", () => {
		it("deletes multiple records and returns count", async () => {
			const records = [{ id: "1" }, { id: "2" }];
			const { db } = createMockDb({ returnData: records });
			const adapter = drizzleAdapter(db);

			const count = await adapter.deleteMany({
				model: "notification",
				where: [{ field: "archived", value: true }],
			});

			expect(count).toBe(2);
		});
	});

	describe("where translation", () => {
		// These tests verify the adapter doesn't throw for each operator.
		// Actual SQL translation is validated by Drizzle ORM itself.
		const operators = [
			{ op: "eq" as const, value: "test" },
			{ op: "ne" as const, value: "test" },
			{ op: "lt" as const, value: 10 },
			{ op: "lte" as const, value: 10 },
			{ op: "gt" as const, value: 10 },
			{ op: "gte" as const, value: 10 },
			{ op: "in" as const, value: ["a", "b"] },
			{ op: "not_in" as const, value: ["a", "b"] },
			{ op: "contains" as const, value: "test" },
			{ op: "starts_with" as const, value: "test" },
			{ op: "ends_with" as const, value: "test" },
		];

		for (const { op, value } of operators) {
			it(`supports ${op} operator`, async () => {
				const { db } = createMockDb({ returnData: [] });
				const adapter = drizzleAdapter(db);

				await expect(
					adapter.findMany({
						model: "subscriber",
						where: [{ field: "email", value, operator: op }],
					}),
				).resolves.toEqual([]);
			});
		}
	});

	describe("AND/OR connectors", () => {
		it("handles AND-only conditions", async () => {
			const { db, calls } = createMockDb({ returnData: [] });
			const adapter = drizzleAdapter(db);

			await adapter.findMany({
				model: "subscriber",
				where: [
					{ field: "email", value: "test@example.com" },
					{ field: "firstName", value: "Test" },
				],
			});

			expect(calls.some((c) => c.method === "where")).toBe(true);
		});

		it("handles OR-only conditions", async () => {
			const { db, calls } = createMockDb({ returnData: [] });
			const adapter = drizzleAdapter(db);

			await adapter.findMany({
				model: "subscriber",
				where: [
					{ field: "email", value: "a@example.com", connector: "OR" },
					{ field: "email", value: "b@example.com", connector: "OR" },
				],
			});

			expect(calls.some((c) => c.method === "where")).toBe(true);
		});

		it("handles mixed AND/OR conditions", async () => {
			const { db, calls } = createMockDb({ returnData: [] });
			const adapter = drizzleAdapter(db);

			await adapter.findMany({
				model: "subscriber",
				where: [
					{ field: "firstName", value: "Test" },
					{ field: "email", value: "a@example.com", connector: "OR" },
					{ field: "email", value: "b@example.com", connector: "OR" },
				],
			});

			expect(calls.some((c) => c.method === "where")).toBe(true);
		});
	});

	describe("error handling", () => {
		it("throws for unknown model", async () => {
			const { db } = createMockDb();
			const adapter = drizzleAdapter(db);

			await expect(
				adapter.findOne({
					model: "nonexistent",
					where: [{ field: "id", value: "1" }],
				}),
			).rejects.toThrow('Unknown model "nonexistent"');
		});
	});
});
