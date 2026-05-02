import type { HeraldPluginDBSchema } from "../../types/schema.js";

/**
 * Schema contributed by the observability plugin.
 *
 * Provides the `activityLog` table for lifecycle event records.
 * The table is registered through `plugin.schema` and merged into the
 * full Herald schema at init.
 */
export const observabilitySchema: HeraldPluginDBSchema = {
	activityLog: {
		fields: {
			id: { type: "string", required: true, unique: true },
			transactionId: { type: "string", required: false, index: true },
			workflowId: { type: "string", required: false, index: true },
			subscriberId: { type: "string", required: false, index: true },
			channel: { type: "string", required: false },
			stepId: { type: "string", required: false },
			event: { type: "string", required: true, index: true },
			detail: { type: "json", required: false },
			createdAt: { type: "date", required: true, index: true },
		},
	},
};
