import { describe, expect, it } from "vitest";
import { deepMerge } from "../src/core/preferences.js";

describe("deepMerge()", () => {
	it("returns empty object when both inputs are undefined", () => {
		expect(deepMerge(undefined, undefined)).toEqual({});
	});

	it("returns patch when base is undefined", () => {
		const patch = { a: 1, b: "two" };
		expect(deepMerge(undefined, patch)).toEqual(patch);
	});

	it("returns base when patch is undefined", () => {
		const base = { a: 1, b: "two" };
		expect(deepMerge(base, undefined)).toEqual(base);
	});

	it("does not mutate the base object", () => {
		const base = { a: 1, nested: { x: 10 } };
		const patch = { a: 2, nested: { y: 20 } };
		const result = deepMerge(base, patch);

		expect(base.a).toBe(1);
		expect((base.nested as Record<string, unknown>).y).toBeUndefined();
		expect(result).not.toBe(base);
	});

	it("overwrites primitive values from patch", () => {
		expect(deepMerge({ a: 1, b: "old" }, { a: 99, b: "new" })).toEqual({ a: 99, b: "new" });
	});

	it("adds new keys from patch", () => {
		expect(deepMerge({ a: 1 }, { b: 2 } as Record<string, unknown>)).toEqual({ a: 1, b: 2 });
	});

	it("deep merges nested objects", () => {
		const base = { channels: { email: true, sms: false } };
		const patch = { channels: { sms: true, push: true } };
		expect(deepMerge(base, patch)).toEqual({
			channels: { email: true, sms: true, push: true },
		});
	});

	it("deep merges multiple levels of nesting", () => {
		const base = { a: { b: { c: 1, d: 2 }, e: 3 } };
		const patch = { a: { b: { c: 99 } } };
		expect(deepMerge(base, patch)).toEqual({
			a: { b: { c: 99, d: 2 }, e: 3 },
		});
	});

	it("replaces arrays (does not merge them)", () => {
		const base = { tags: ["a", "b"] };
		const patch = { tags: ["c"] };
		expect(deepMerge(base, patch)).toEqual({ tags: ["c"] });
	});

	it("replaces an object with an array from patch", () => {
		const base = { data: { nested: true } } as Record<string, unknown>;
		const patch = { data: [1, 2, 3] } as Record<string, unknown>;
		expect(deepMerge(base, patch)).toEqual({ data: [1, 2, 3] });
	});

	it("replaces an array with an object from patch", () => {
		const base = { data: [1, 2, 3] } as Record<string, unknown>;
		const patch = { data: { nested: true } } as Record<string, unknown>;
		expect(deepMerge(base, patch)).toEqual({ data: { nested: true } });
	});

	it("handles null values in patch — overwrites base", () => {
		const base = { a: { nested: true } } as Record<string, unknown>;
		const patch = { a: null } as Record<string, unknown>;
		expect(deepMerge(base, patch)).toEqual({ a: null });
	});

	it("handles null values in base — patch overwrites", () => {
		const base = { a: null } as Record<string, unknown>;
		const patch = { a: { nested: true } } as Record<string, unknown>;
		expect(deepMerge(base, patch)).toEqual({ a: { nested: true } });
	});

	it("handles boolean values correctly (does not treat as objects)", () => {
		const base = { enabled: true };
		const patch = { enabled: false };
		expect(deepMerge(base, patch)).toEqual({ enabled: false });
	});

	it("overwrites a nested object with a primitive", () => {
		const base = { config: { debug: true } } as Record<string, unknown>;
		const patch = { config: "simple" } as Record<string, unknown>;
		expect(deepMerge(base, patch)).toEqual({ config: "simple" });
	});

	it("overwrites a primitive with a nested object", () => {
		const base = { config: "simple" } as Record<string, unknown>;
		const patch = { config: { debug: true } } as Record<string, unknown>;
		expect(deepMerge(base, patch)).toEqual({ config: { debug: true } });
	});

	it("works with empty objects", () => {
		expect(deepMerge({}, { a: 1 })).toEqual({ a: 1 });
		expect(deepMerge({ a: 1 }, {})).toEqual({ a: 1 });
		expect(deepMerge({}, {})).toEqual({});
	});

	it("realistic preference merge scenario", () => {
		const existing = {
			subscriberId: "sub-1",
			channels: { email: true, sms: false },
			workflows: { digest: true },
			purposes: { marketing: false },
		};
		const update = {
			channels: { sms: true, push: true },
			workflows: { "welcome-email": false },
		};
		const result = deepMerge(existing, update as typeof existing);
		expect(result).toEqual({
			subscriberId: "sub-1",
			channels: { email: true, sms: true, push: true },
			workflows: { digest: true, "welcome-email": false },
			purposes: { marketing: false },
		});
	});
});
