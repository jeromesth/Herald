import { beforeEach, describe, expect, it } from "vitest";
import { memoryAdapter } from "../src/adapters/database/memory.js";
import type { DatabaseAdapter } from "../src/types/adapter.js";
import { runDatabaseAdapterContract } from "./contracts/database-adapter.contract.js";

runDatabaseAdapterContract("memoryAdapter", () => memoryAdapter());

describe("memoryAdapter — Date comparison operators", () => {
	let db: DatabaseAdapter;

	beforeEach(async () => {
		db = memoryAdapter();
		await db.create({ model: "event", data: { id: "1", createdAt: new Date("2024-01-01T00:00:00Z") } });
		await db.create({ model: "event", data: { id: "2", createdAt: new Date("2024-06-01T00:00:00Z") } });
		await db.create({ model: "event", data: { id: "3", createdAt: new Date("2024-12-01T00:00:00Z") } });
	});

	it("supports lt operator with Date values", async () => {
		const results = await db.findMany({
			model: "event",
			where: [{ field: "createdAt", value: new Date("2024-06-01T00:00:00Z"), operator: "lt" }],
		});
		expect(results).toHaveLength(1);
	});

	it("supports lte operator with Date values", async () => {
		const results = await db.findMany({
			model: "event",
			where: [{ field: "createdAt", value: new Date("2024-06-01T00:00:00Z"), operator: "lte" }],
		});
		expect(results).toHaveLength(2);
	});

	it("supports gt operator with Date values", async () => {
		const results = await db.findMany({
			model: "event",
			where: [{ field: "createdAt", value: new Date("2024-06-01T00:00:00Z"), operator: "gt" }],
		});
		expect(results).toHaveLength(1);
	});

	it("supports gte operator with Date values", async () => {
		const results = await db.findMany({
			model: "event",
			where: [{ field: "createdAt", value: new Date("2024-06-01T00:00:00Z"), operator: "gte" }],
		});
		expect(results).toHaveLength(2);
	});

	it("returns false when comparing incompatible types (string vs number)", async () => {
		await db.create({ model: "mixed", data: { id: "a", value: "10" } });
		await db.create({ model: "mixed", data: { id: "b", value: 10 } });

		const results = await db.findMany({
			model: "mixed",
			where: [{ field: "value", value: 5, operator: "gt" }],
		});
		// Only the numeric 10 should match — the string "10" must not coerce.
		expect(results).toHaveLength(1);
		expect(results[0].id).toBe("b");
	});
});
