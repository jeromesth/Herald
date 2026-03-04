import { describe, expect, it, beforeEach } from "vitest";
import { memoryAdapter } from "../src/adapters/database/memory.js";
import type { SubscriberRecord } from "../src/types/config.js";
import {
	resolveSubscriberByAnyId,
	resolveRecipient,
} from "../src/core/subscriber.js";

describe("resolveSubscriberByAnyId", () => {
	let db: ReturnType<typeof memoryAdapter>;

	beforeEach(() => {
		db = memoryAdapter();
	});

	it("finds subscriber by externalId", async () => {
		await db.create({
			model: "subscriber",
			data: { id: "internal-1", externalId: "ext-1", email: "a@b.com" },
		});

		const result = await resolveSubscriberByAnyId(db, "ext-1");
		expect(result).not.toBeNull();
		expect(result!.id).toBe("internal-1");
	});

	it("falls back to id when externalId not found", async () => {
		await db.create({
			model: "subscriber",
			data: { id: "internal-1", externalId: "ext-1", email: "a@b.com" },
		});

		const result = await resolveSubscriberByAnyId(db, "internal-1");
		expect(result).not.toBeNull();
		expect(result!.externalId).toBe("ext-1");
	});

	it("returns null when neither id nor externalId match", async () => {
		const result = await resolveSubscriberByAnyId(db, "nonexistent");
		expect(result).toBeNull();
	});
});

describe("resolveRecipient", () => {
	const subscriber: SubscriberRecord = {
		id: "internal-1",
		externalId: "ext-1",
		email: "test@example.com",
		phone: "+1234567890",
		createdAt: new Date(),
		updatedAt: new Date(),
	};

	it("returns subscriber.id for in_app channel", () => {
		expect(resolveRecipient("in_app", subscriber)).toBe("internal-1");
	});

	it("returns subscriber.email for email channel", () => {
		expect(resolveRecipient("email", subscriber)).toBe("test@example.com");
	});

	it("returns null when subscriber has no email", () => {
		const noEmail = { ...subscriber, email: undefined };
		expect(resolveRecipient("email", noEmail)).toBeNull();
	});

	it("returns subscriber.phone for sms channel", () => {
		expect(resolveRecipient("sms", subscriber)).toBe("+1234567890");
	});

	it("returns null when subscriber has no phone", () => {
		const noPhone = { ...subscriber, phone: undefined };
		expect(resolveRecipient("sms", noPhone)).toBeNull();
	});

	it("returns externalId for push channel", () => {
		expect(resolveRecipient("push", subscriber)).toBe("ext-1");
	});

	it("returns externalId for chat channel", () => {
		expect(resolveRecipient("chat", subscriber)).toBe("ext-1");
	});

	it("returns externalId for webhook channel", () => {
		expect(resolveRecipient("webhook", subscriber)).toBe("ext-1");
	});
});
