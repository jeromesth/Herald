import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseAdapter } from "../../src/types/adapter.js";

/**
 * Shared contract test suite for DatabaseAdapter implementations.
 * Every adapter must pass all these tests to be considered conformant.
 */
export function runDatabaseAdapterContract(name: string, createAdapter: () => DatabaseAdapter) {
	describe(`DatabaseAdapter contract: ${name}`, () => {
		let db: DatabaseAdapter;

		beforeEach(() => {
			db = createAdapter();
		});

		describe("create", () => {
			it("creates a record and returns it", async () => {
				const result = await db.create({
					model: "subscriber",
					data: { id: "1", externalId: "user-1", email: "test@example.com" },
				});

				expect(result).toEqual({
					id: "1",
					externalId: "user-1",
					email: "test@example.com",
				});
			});

			it("supports select projection", async () => {
				const result = await db.create({
					model: "subscriber",
					data: { id: "1", externalId: "user-1", email: "test@example.com" },
					select: ["id", "email"],
				});

				expect(result).toEqual({ id: "1", email: "test@example.com" });
			});
		});

		describe("findOne", () => {
			it("finds by single where clause", async () => {
				await db.create({
					model: "subscriber",
					data: { id: "1", externalId: "user-1", email: "test@example.com" },
				});

				const result = await db.findOne({
					model: "subscriber",
					where: [{ field: "externalId", value: "user-1" }],
				});

				expect(result).not.toBeNull();
				expect((result as Record<string, unknown>).email).toBe("test@example.com");
			});

			it("finds by multiple where clauses (AND)", async () => {
				await db.create({
					model: "subscriber",
					data: { id: "1", externalId: "user-1", email: "test@example.com" },
				});
				await db.create({
					model: "subscriber",
					data: { id: "2", externalId: "user-2", email: "other@example.com" },
				});

				const result = await db.findOne({
					model: "subscriber",
					where: [
						{ field: "externalId", value: "user-1" },
						{ field: "email", value: "test@example.com" },
					],
				});

				expect(result).not.toBeNull();
				expect((result as Record<string, unknown>).id).toBe("1");
			});

			it("returns null when not found", async () => {
				const result = await db.findOne({
					model: "subscriber",
					where: [{ field: "externalId", value: "nonexistent" }],
				});

				expect(result).toBeNull();
			});

			it("supports select projection", async () => {
				await db.create({
					model: "subscriber",
					data: { id: "1", externalId: "user-1", email: "test@example.com" },
				});

				const result = await db.findOne({
					model: "subscriber",
					where: [{ field: "id", value: "1" }],
					select: ["id", "email"],
				});

				expect(result).toEqual({ id: "1", email: "test@example.com" });
			});
		});

		describe("findMany", () => {
			beforeEach(async () => {
				await db.create({ model: "item", data: { id: "1", name: "Alpha", order: 3 } });
				await db.create({ model: "item", data: { id: "2", name: "Beta", order: 1 } });
				await db.create({ model: "item", data: { id: "3", name: "Gamma", order: 2 } });
			});

			it("returns all records when no where clause", async () => {
				const results = await db.findMany({ model: "item" });
				expect(results).toHaveLength(3);
			});

			it("filters by where clause", async () => {
				const results = await db.findMany({
					model: "item",
					where: [{ field: "name", value: "Beta" }],
				});
				expect(results).toHaveLength(1);
			});

			it("supports limit", async () => {
				const results = await db.findMany({ model: "item", limit: 2 });
				expect(results).toHaveLength(2);
			});

			it("supports offset", async () => {
				const results = await db.findMany({ model: "item", limit: 2, offset: 1 });
				expect(results).toHaveLength(2);
			});

			it("supports sortBy asc", async () => {
				const results = await db.findMany<{ id: string; order: number }>({
					model: "item",
					sortBy: { field: "order", direction: "asc" },
				});
				expect(results[0]!.order).toBe(1);
				expect(results[2]!.order).toBe(3);
			});

			it("supports sortBy desc", async () => {
				const results = await db.findMany<{ id: string; order: number }>({
					model: "item",
					sortBy: { field: "order", direction: "desc" },
				});
				expect(results[0]!.order).toBe(3);
				expect(results[2]!.order).toBe(1);
			});

			it("handles empty results", async () => {
				const results = await db.findMany({
					model: "item",
					where: [{ field: "name", value: "Nonexistent" }],
				});
				expect(results).toEqual([]);
			});

			it("supports select projection", async () => {
				const results = await db.findMany<{ id: string }>({
					model: "item",
					select: ["id"],
					limit: 1,
				});
				expect(results[0]).toEqual({ id: "1" });
			});
		});

		describe("count", () => {
			it("counts all records", async () => {
				await db.create({ model: "item", data: { id: "1" } });
				await db.create({ model: "item", data: { id: "2" } });

				const count = await db.count({ model: "item" });
				expect(count).toBe(2);
			});

			it("counts with where filter", async () => {
				await db.create({ model: "item", data: { id: "1", active: true } });
				await db.create({ model: "item", data: { id: "2", active: false } });

				const count = await db.count({
					model: "item",
					where: [{ field: "active", value: true }],
				});
				expect(count).toBe(1);
			});
		});

		describe("update", () => {
			it("updates single record", async () => {
				await db.create({
					model: "subscriber",
					data: { id: "1", externalId: "user-1", email: "old@example.com" },
				});

				const result = await db.update<Record<string, unknown>>({
					model: "subscriber",
					where: [{ field: "id", value: "1" }],
					update: { email: "new@example.com" },
				});

				expect(result.email).toBe("new@example.com");
			});

			it("returns updated record", async () => {
				await db.create({
					model: "subscriber",
					data: { id: "1", externalId: "user-1", email: "old@example.com" },
				});

				const result = await db.update<Record<string, unknown>>({
					model: "subscriber",
					where: [{ field: "id", value: "1" }],
					update: { email: "new@example.com" },
				});

				expect(result.id).toBe("1");
				expect(result.externalId).toBe("user-1");
			});

			it("throws when record not found", async () => {
				await expect(
					db.update({
						model: "subscriber",
						where: [{ field: "id", value: "nonexistent" }],
						update: { email: "new@example.com" },
					}),
				).rejects.toThrow();
			});
		});

		describe("updateMany", () => {
			it("updates multiple matching records", async () => {
				await db.create({ model: "item", data: { id: "1", active: false } });
				await db.create({ model: "item", data: { id: "2", active: false } });
				await db.create({ model: "item", data: { id: "3", active: true } });

				const count = await db.updateMany({
					model: "item",
					where: [{ field: "active", value: false }],
					update: { active: true },
				});

				expect(count).toBe(2);
			});

			it("returns count of updated records", async () => {
				await db.create({ model: "item", data: { id: "1", status: "pending" } });

				const count = await db.updateMany({
					model: "item",
					where: [{ field: "status", value: "pending" }],
					update: { status: "done" },
				});

				expect(count).toBe(1);
			});
		});

		describe("delete", () => {
			it("deletes single record", async () => {
				await db.create({ model: "subscriber", data: { id: "1", externalId: "user-1" } });

				await db.delete({
					model: "subscriber",
					where: [{ field: "id", value: "1" }],
				});

				const result = await db.findOne({
					model: "subscriber",
					where: [{ field: "id", value: "1" }],
				});
				expect(result).toBeNull();
			});

			it("throws when record not found", async () => {
				await expect(
					db.delete({
						model: "subscriber",
						where: [{ field: "id", value: "nonexistent" }],
					}),
				).rejects.toThrow();
			});
		});

		describe("deleteMany", () => {
			it("deletes multiple matching records", async () => {
				await db.create({ model: "item", data: { id: "1", archived: true } });
				await db.create({ model: "item", data: { id: "2", archived: true } });
				await db.create({ model: "item", data: { id: "3", archived: false } });

				const count = await db.deleteMany({
					model: "item",
					where: [{ field: "archived", value: true }],
				});

				expect(count).toBe(2);
			});

			it("returns count of deleted records", async () => {
				await db.create({ model: "item", data: { id: "1" } });
				await db.create({ model: "item", data: { id: "2" } });

				const count = await db.deleteMany({ model: "item" });
				expect(count).toBe(2);
			});
		});

		describe("where operators", () => {
			beforeEach(async () => {
				await db.create({ model: "item", data: { id: "1", value: 10, name: "hello world" } });
				await db.create({ model: "item", data: { id: "2", value: 20, name: "foo bar" } });
				await db.create({ model: "item", data: { id: "3", value: 30, name: "hello there" } });
			});

			it("supports eq operator", async () => {
				const results = await db.findMany({
					model: "item",
					where: [{ field: "value", value: 10, operator: "eq" }],
				});
				expect(results).toHaveLength(1);
			});

			it("supports ne operator", async () => {
				const results = await db.findMany({
					model: "item",
					where: [{ field: "value", value: 10, operator: "ne" }],
				});
				expect(results).toHaveLength(2);
			});

			it("supports lt operator", async () => {
				const results = await db.findMany({
					model: "item",
					where: [{ field: "value", value: 20, operator: "lt" }],
				});
				expect(results).toHaveLength(1);
			});

			it("supports lte operator", async () => {
				const results = await db.findMany({
					model: "item",
					where: [{ field: "value", value: 20, operator: "lte" }],
				});
				expect(results).toHaveLength(2);
			});

			it("supports gt operator", async () => {
				const results = await db.findMany({
					model: "item",
					where: [{ field: "value", value: 15, operator: "gt" }],
				});
				expect(results).toHaveLength(2);
			});

			it("supports gte operator", async () => {
				const results = await db.findMany({
					model: "item",
					where: [{ field: "value", value: 20, operator: "gte" }],
				});
				expect(results).toHaveLength(2);
			});

			it("supports in operator", async () => {
				const results = await db.findMany({
					model: "item",
					where: [{ field: "value", value: [10, 30], operator: "in" }],
				});
				expect(results).toHaveLength(2);
			});

			it("supports not_in operator", async () => {
				const results = await db.findMany({
					model: "item",
					where: [{ field: "value", value: [10, 30], operator: "not_in" }],
				});
				expect(results).toHaveLength(1);
			});

			it("supports contains operator", async () => {
				const results = await db.findMany({
					model: "item",
					where: [{ field: "name", value: "hello", operator: "contains" }],
				});
				expect(results).toHaveLength(2);
			});

			it("supports starts_with operator", async () => {
				const results = await db.findMany({
					model: "item",
					where: [{ field: "name", value: "hello", operator: "starts_with" }],
				});
				expect(results).toHaveLength(2);
			});

			it("supports ends_with operator", async () => {
				const results = await db.findMany({
					model: "item",
					where: [{ field: "name", value: "bar", operator: "ends_with" }],
				});
				expect(results).toHaveLength(1);
			});
		});

		describe("AND/OR connectors", () => {
			beforeEach(async () => {
				await db.create({ model: "item", data: { id: "1", value: 10, name: "alpha" } });
				await db.create({ model: "item", data: { id: "2", value: 20, name: "beta" } });
				await db.create({ model: "item", data: { id: "3", value: 30, name: "gamma" } });
			});

			it("AND-only conditions", async () => {
				const results = await db.findMany({
					model: "item",
					where: [
						{ field: "value", value: 10 },
						{ field: "name", value: "alpha" },
					],
				});
				expect(results).toHaveLength(1);
			});

			it("OR-only conditions", async () => {
				const results = await db.findMany({
					model: "item",
					where: [
						{ field: "value", value: 10, connector: "OR" },
						{ field: "value", value: 30, connector: "OR" },
					],
				});
				expect(results).toHaveLength(2);
			});

			it("mixed AND+OR conditions", async () => {
				const results = await db.findMany({
					model: "item",
					where: [
						{ field: "name", value: "alpha", connector: "OR" },
						{ field: "name", value: "beta", connector: "OR" },
					],
				});
				expect(results).toHaveLength(2);
			});
		});
	});
}
