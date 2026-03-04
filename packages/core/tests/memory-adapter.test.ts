import { describe, expect, it, beforeEach } from "vitest";
import { memoryAdapter } from "../src/adapters/database/memory.js";
import type { DatabaseAdapter } from "../src/types/adapter.js";

describe("memoryAdapter", () => {
	let db: DatabaseAdapter;

	beforeEach(() => {
		db = memoryAdapter();
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

		it("supports select", async () => {
			const result = await db.create({
				model: "subscriber",
				data: { id: "1", externalId: "user-1", email: "test@example.com" },
				select: ["id", "email"],
			});

			expect(result).toEqual({ id: "1", email: "test@example.com" });
		});
	});

	describe("findOne", () => {
		it("finds a record by where clause", async () => {
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

		it("returns null when not found", async () => {
			const result = await db.findOne({
				model: "subscriber",
				where: [{ field: "externalId", value: "nonexistent" }],
			});

			expect(result).toBeNull();
		});
	});

	describe("findMany", () => {
		beforeEach(async () => {
			await db.create({
				model: "item",
				data: { id: "1", name: "Alpha", order: 3 },
			});
			await db.create({
				model: "item",
				data: { id: "2", name: "Beta", order: 1 },
			});
			await db.create({
				model: "item",
				data: { id: "3", name: "Gamma", order: 2 },
			});
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

		it("supports limit and offset", async () => {
			const results = await db.findMany({
				model: "item",
				limit: 2,
				offset: 1,
			});
			expect(results).toHaveLength(2);
		});

		it("supports sorting", async () => {
			const results = await db.findMany<{ id: string; order: number }>({
				model: "item",
				sortBy: { field: "order", direction: "asc" },
			});
			expect(results[0]!.order).toBe(1);
			expect(results[2]!.order).toBe(3);
		});
	});

	describe("count", () => {
		it("counts all records", async () => {
			await db.create({ model: "item", data: { id: "1" } });
			await db.create({ model: "item", data: { id: "2" } });

			const count = await db.count({ model: "item" });
			expect(count).toBe(2);
		});

		it("counts with where clause", async () => {
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
		it("updates a record", async () => {
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

		it("throws when record not found", async () => {
			await expect(
				db.update({
					model: "subscriber",
					where: [{ field: "id", value: "nonexistent" }],
					update: { email: "new@example.com" },
				}),
			).rejects.toThrow("Record not found");
		});
	});

	describe("delete", () => {
		it("deletes a record", async () => {
			await db.create({
				model: "subscriber",
				data: { id: "1", externalId: "user-1" },
			});

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
	});

	describe("where operators", () => {
		beforeEach(async () => {
			await db.create({ model: "item", data: { id: "1", value: 10, name: "hello world" } });
			await db.create({ model: "item", data: { id: "2", value: 20, name: "foo bar" } });
			await db.create({ model: "item", data: { id: "3", value: 30, name: "hello there" } });
		});

		it("supports ne operator", async () => {
			const results = await db.findMany({
				model: "item",
				where: [{ field: "value", value: 10, operator: "ne" }],
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

		it("supports in operator", async () => {
			const results = await db.findMany({
				model: "item",
				where: [{ field: "value", value: [10, 30], operator: "in" }],
			});
			expect(results).toHaveLength(2);
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

		it("supports OR connector semantics", async () => {
			const results = await db.findMany({
				model: "item",
				where: [
					{ field: "value", value: 10, connector: "OR" },
					{ field: "value", value: 30, connector: "OR" },
				],
			});
			expect(results).toHaveLength(2);
		});
	});
});
