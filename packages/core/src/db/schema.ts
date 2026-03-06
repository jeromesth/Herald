import type { HeraldDBSchema } from "../types/schema.js";

/**
 * Core Herald database schema.
 * These are the minimum tables required for a viable notification system,
 * derived from analysis of Novu and Knock.app data models.
 */
export const coreSchema: HeraldDBSchema = {
	subscriber: {
		fields: {
			id: { type: "string", required: true, unique: true },
			externalId: { type: "string", required: true, unique: true, index: true },
			email: { type: "string", required: false, index: true },
			phone: { type: "string", required: false },
			firstName: { type: "string", required: false },
			lastName: { type: "string", required: false },
			avatar: { type: "string", required: false },
			locale: { type: "string", required: false },
			timezone: { type: "string", required: false },
			data: { type: "json", required: false },
			createdAt: { type: "date", required: true },
			updatedAt: { type: "date", required: true },
		},
		order: 1,
	},

	notification: {
		fields: {
			id: { type: "string", required: true, unique: true },
			subscriberId: {
				type: "string",
				required: true,
				index: true,
				references: { model: "subscriber", field: "id", onDelete: "cascade" },
			},
			workflowId: { type: "string", required: true, index: true },
			channel: { type: "string", required: true },
			subject: { type: "string", required: false },
			body: { type: "string", required: true },
			actionUrl: { type: "string", required: false },
			avatar: { type: "string", required: false },
			data: { type: "json", required: false },
			read: { type: "boolean", required: true, defaultValue: false },
			seen: { type: "boolean", required: true, defaultValue: false },
			archived: { type: "boolean", required: true, defaultValue: false },
			deliveryStatus: { type: "string", required: true, defaultValue: "queued" },
			transactionId: { type: "string", required: true, index: true },
			actorId: { type: "string", required: false },
			tenantId: { type: "string", required: false, index: true },
			createdAt: { type: "date", required: true },
			readAt: { type: "date", required: false },
			seenAt: { type: "date", required: false },
			archivedAt: { type: "date", required: false },
		},
		order: 2,
	},

	topic: {
		fields: {
			id: { type: "string", required: true, unique: true },
			key: { type: "string", required: true, unique: true, index: true },
			name: { type: "string", required: true },
			createdAt: { type: "date", required: true },
			updatedAt: { type: "date", required: true },
		},
		order: 3,
	},

	topicSubscriber: {
		fields: {
			id: { type: "string", required: true, unique: true },
			topicId: {
				type: "string",
				required: true,
				index: true,
				references: { model: "topic", field: "id", onDelete: "cascade" },
			},
			subscriberId: {
				type: "string",
				required: true,
				index: true,
				references: { model: "subscriber", field: "id", onDelete: "cascade" },
			},
			createdAt: { type: "date", required: true },
		},
		order: 4,
	},

	preference: {
		fields: {
			id: { type: "string", required: true, unique: true },
			subscriberId: {
				type: "string",
				required: true,
				index: true,
				references: { model: "subscriber", field: "id", onDelete: "cascade" },
			},
			channels: { type: "json", required: false },
			workflows: { type: "json", required: false },
			purposes: { type: "json", required: false },
			updatedAt: { type: "date", required: true },
		},
		order: 5,
	},

	channel: {
		fields: {
			id: { type: "string", required: true, unique: true },
			type: { type: "string", required: true },
			provider: { type: "string", required: true },
			name: { type: "string", required: true },
			config: { type: "json", required: false, returned: false },
			enabled: { type: "boolean", required: true, defaultValue: true },
			createdAt: { type: "date", required: true },
			updatedAt: { type: "date", required: true },
		},
		order: 6,
	},
};

/**
 * Merge plugin schemas into the core schema.
 */
export function mergeSchemas(base: HeraldDBSchema, ...extensions: (HeraldDBSchema | undefined)[]): HeraldDBSchema {
	const merged = { ...base };

	for (const extension of extensions) {
		if (!extension) continue;

		for (const [tableName, tableDefinition] of Object.entries(extension)) {
			if (merged[tableName]) {
				merged[tableName] = {
					...merged[tableName],
					fields: {
						...merged[tableName].fields,
						...tableDefinition.fields,
					},
				};
			} else {
				merged[tableName] = tableDefinition;
			}
		}
	}

	return merged;
}
