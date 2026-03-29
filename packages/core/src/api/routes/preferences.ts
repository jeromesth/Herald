import { z } from "zod";
import { CONDITION_OPERATORS } from "../../core/conditions.js";
import {
	type PreferencePatch,
	bulkUpdatePreferencesInternal,
	stripReadOnlyOverrides,
	upsertPreferenceInternal,
} from "../../core/preferences.js";
import type { HeraldContext, PreferenceRecord } from "../../types/config.js";
import { CHANNEL_TYPES } from "../../types/workflow.js";
import { jsonResponse, parseJsonBody } from "../router.js";

const channelTypeSchema = z.enum(CHANNEL_TYPES);

const preferenceConditionSchema = z.object({
	field: z.string().min(1),
	operator: z.enum(CONDITION_OPERATORS),
	/** Omitted in JSON is allowed; evaluators treat missing like `undefined`. */
	value: z.unknown().optional(),
});

const workflowChannelPreferenceSchema = z
	.object({
		enabled: z.boolean(),
		channels: z.record(channelTypeSchema, z.boolean()).optional(),
		conditions: z.array(preferenceConditionSchema).optional(),
	})
	.strict();

const categoryPreferenceSchema = z
	.object({
		enabled: z.boolean(),
		channels: z.record(channelTypeSchema, z.boolean()).optional(),
	})
	.strict();

const putPreferencesBodySchema = z
	.object({
		channels: z.record(channelTypeSchema, z.boolean()).optional(),
		workflows: z.record(z.string().min(1), workflowChannelPreferenceSchema).optional(),
		categories: z.record(z.string().min(1), categoryPreferenceSchema).optional(),
		purposes: z.record(z.string().min(1), z.boolean()).optional(),
	})
	.strict();

const bulkPreferencesBodySchema = z
	.object({
		updates: z
			.array(
				z
					.object({
						subscriberId: z.string().min(1),
						channels: z.record(channelTypeSchema, z.boolean()).optional(),
						workflows: z.record(z.string().min(1), workflowChannelPreferenceSchema).optional(),
						categories: z.record(z.string().min(1), categoryPreferenceSchema).optional(),
						purposes: z.record(z.string().min(1), z.boolean()).optional(),
					})
					.strict(),
			)
			.min(0)
			.max(100),
	})
	.strict();

export const preferenceRoutes = [
	{
		method: "GET",
		pattern: "/subscribers/:id/preferences",
		handler: async (_request: Request, ctx: HeraldContext, params: Record<string, string>) => {
			const subscriber = await ctx.db.findOne<{ id: string }>({
				model: "subscriber",
				where: [{ field: "externalId", value: params.id }],
				select: ["id"],
			});

			if (!subscriber) {
				return jsonResponse({ error: "Subscriber not found" }, 404);
			}

			const pref = await ctx.db.findOne<PreferenceRecord>({
				model: "preference",
				where: [{ field: "subscriberId", value: subscriber.id }],
			});

			const readOnlyChannels = ctx.readOnlyChannels;

			return jsonResponse({
				...(pref ?? {
					subscriberId: subscriber.id,
					channels: { ...(ctx.options.defaultPreferences?.channels ?? {}) },
					workflows: { ...(ctx.options.defaultPreferences?.workflows ?? {}) },
					categories: { ...(ctx.options.defaultPreferences?.categories ?? {}) },
					purposes: { ...(ctx.options.defaultPreferences?.purposes ?? {}) },
				}),
				readOnlyChannels,
			});
		},
	},
	{
		method: "PUT",
		pattern: "/subscribers/:id/preferences",
		handler: async (request: Request, ctx: HeraldContext, params: Record<string, string>) => {
			const raw = await parseJsonBody(request);
			const parsed = putPreferencesBodySchema.safeParse(raw);
			if (!parsed.success) {
				return jsonResponse({ error: "Invalid request body", issues: parsed.error.issues }, 400);
			}
			const body = parsed.data;

			const sanitized = stripReadOnlyOverrides(body as PreferencePatch, ctx.readOnlyChannels);

			const subscriber = await ctx.db.findOne<{ id: string }>({
				model: "subscriber",
				where: [{ field: "externalId", value: params.id }],
				select: ["id"],
			});

			if (!subscriber) {
				return jsonResponse({ error: "Subscriber not found" }, 404);
			}

			const { record, createdRowId, updatedAt } = await upsertPreferenceInternal(ctx.db, ctx, ctx.generateId, subscriber.id, sanitized);

			if (createdRowId) {
				return jsonResponse({ id: createdRowId, ...record, updatedAt }, 201);
			}

			return jsonResponse({ ...record, updatedAt });
		},
	},
	{
		method: "PUT",
		pattern: "/preferences/bulk",
		handler: async (request: Request, ctx: HeraldContext) => {
			const raw = await parseJsonBody(request);
			const parsed = bulkPreferencesBodySchema.safeParse(raw);
			if (!parsed.success) {
				return jsonResponse({ error: "Invalid request body", issues: parsed.error.issues }, 400);
			}
			const body = parsed.data;

			const normalized: Array<{ subscriberId: string; preferences: Partial<PreferenceRecord> }> = body.updates.map((u) => ({
				subscriberId: u.subscriberId,
				preferences: {
					channels: u.channels,
					workflows: u.workflows,
					categories: u.categories,
					purposes: u.purposes,
				} as Partial<PreferenceRecord>,
			}));

			const results = await bulkUpdatePreferencesInternal(ctx.db, ctx, ctx.generateId, normalized);
			const hasErrors = results.some((r) => r.error);

			return jsonResponse({ results }, hasErrors ? 207 : 200);
		},
	},
];
