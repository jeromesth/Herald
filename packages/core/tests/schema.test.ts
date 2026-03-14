import { describe, expect, it } from "vitest";
import { coreSchema, mergeSchemas } from "../src/db/schema.js";

describe("coreSchema", () => {
	it("defines all required core tables", () => {
		expect(coreSchema.subscriber).toBeDefined();
		expect(coreSchema.notification).toBeDefined();
		expect(coreSchema.topic).toBeDefined();
		expect(coreSchema.topicSubscriber).toBeDefined();
		expect(coreSchema.preference).toBeDefined();
		expect(coreSchema.channel).toBeDefined();
	});

	it("subscriber has required fields", () => {
		const fields = coreSchema.subscriber?.fields;
		expect(fields.id).toBeDefined();
		expect(fields.externalId).toBeDefined();
		expect(fields.email).toBeDefined();
		expect(fields.phone).toBeDefined();
		expect(fields.firstName).toBeDefined();
		expect(fields.lastName).toBeDefined();
		expect(fields.createdAt).toBeDefined();
		expect(fields.updatedAt).toBeDefined();
	});

	it("notification has required fields", () => {
		const fields = coreSchema.notification?.fields;
		expect(fields.id).toBeDefined();
		expect(fields.subscriberId).toBeDefined();
		expect(fields.workflowId).toBeDefined();
		expect(fields.channel).toBeDefined();
		expect(fields.body).toBeDefined();
		expect(fields.read).toBeDefined();
		expect(fields.seen).toBeDefined();
		expect(fields.deliveryStatus).toBeDefined();
		expect(fields.transactionId).toBeDefined();
	});

	it("notification.subscriberId references subscriber", () => {
		const ref = coreSchema.notification?.fields.subscriberId?.references;
		expect(ref).toBeDefined();
		expect(ref?.model).toBe("subscriber");
		expect(ref?.field).toBe("id");
		expect(ref?.onDelete).toBe("cascade");
	});
});

describe("mergeSchemas", () => {
	it("merges plugin schemas into core schema", () => {
		const plugin = {
			subscriber: {
				fields: {
					companyName: { type: "string" as const, required: false },
				},
			},
		};

		const merged = mergeSchemas(coreSchema, plugin);

		expect(merged.subscriber?.fields.companyName).toBeDefined();
		expect(merged.subscriber?.fields.email).toBeDefined(); // core field still exists
	});

	it("adds new tables from plugins", () => {
		const plugin = {
			auditLog: {
				fields: {
					id: { type: "string" as const, required: true },
					action: { type: "string" as const, required: true },
					timestamp: { type: "date" as const, required: true },
				},
			},
		};

		const merged = mergeSchemas(coreSchema, plugin);
		expect(merged.auditLog).toBeDefined();
		expect(merged.auditLog?.fields.action).toBeDefined();
	});

	it("handles undefined extensions gracefully", () => {
		const merged = mergeSchemas(coreSchema, undefined, undefined);
		expect(Object.keys(merged)).toEqual(Object.keys(coreSchema));
	});
});
