import { bulkUpdatePreferencesInternal, deepMerge } from "../../core/preferences.js";
import type { CategoryPreference, HeraldContext, PreferenceRecord, WorkflowChannelPreference } from "../../types/config.js";
import type { ChannelType } from "../../types/workflow.js";
import { jsonResponse, parseJsonBody } from "../router.js";

function getReadOnlyChannels(ctx: HeraldContext): Record<string, Partial<Record<ChannelType, boolean>>> {
	const result: Record<string, Partial<Record<ChannelType, boolean>>> = {};
	for (const wf of ctx.options.workflows ?? []) {
		if (wf.preferences?.channels) {
			const readOnlyMap: Partial<Record<ChannelType, boolean>> = {};
			let hasReadOnly = false;
			for (const [ch, pref] of Object.entries(wf.preferences.channels)) {
				if (pref?.readOnly) {
					readOnlyMap[ch as ChannelType] = true;
					hasReadOnly = true;
				}
			}
			if (hasReadOnly) {
				result[wf.id] = readOnlyMap;
			}
		}
	}
	return result;
}

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

			const readOnlyChannels = getReadOnlyChannels(ctx);

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
			const body = await parseJsonBody<{
				channels?: Record<string, boolean>;
				workflows?: Record<string, WorkflowChannelPreference>;
				categories?: Record<string, CategoryPreference>;
				purposes?: Record<string, boolean>;
			}>(request);

			const subscriber = await ctx.db.findOne<{ id: string }>({
				model: "subscriber",
				where: [{ field: "externalId", value: params.id }],
				select: ["id"],
			});

			if (!subscriber) {
				return jsonResponse({ error: "Subscriber not found" }, 404);
			}

			const now = new Date();
			const existing = await ctx.db.findOne<PreferenceRecord & { id: string }>({
				model: "preference",
				where: [{ field: "subscriberId", value: subscriber.id }],
			});

			if (existing) {
				const merged = {
					channels: deepMerge(existing.channels, body.channels),
					workflows: deepMerge(existing.workflows, body.workflows),
					categories: deepMerge(existing.categories, body.categories),
					purposes: deepMerge(existing.purposes, body.purposes),
					updatedAt: now,
				};

				await ctx.db.update({
					model: "preference",
					where: [{ field: "subscriberId", value: subscriber.id }],
					update: merged,
				});

				return jsonResponse({
					subscriberId: subscriber.id,
					...merged,
				});
			}

			const id = ctx.generateId();
			const defaultChannels = ctx.options.defaultPreferences?.channels ?? {};
			const defaultWorkflows = ctx.options.defaultPreferences?.workflows ?? {};
			const defaultCategories = ctx.options.defaultPreferences?.categories ?? {};
			const defaultPurposes = ctx.options.defaultPreferences?.purposes ?? {};
			const newPref = {
				id,
				subscriberId: subscriber.id,
				channels: { ...defaultChannels, ...(body.channels ?? {}) },
				workflows: { ...defaultWorkflows, ...(body.workflows ?? {}) },
				categories: { ...defaultCategories, ...(body.categories ?? {}) },
				purposes: { ...defaultPurposes, ...(body.purposes ?? {}) },
				updatedAt: now,
			};

			await ctx.db.create({ model: "preference", data: newPref });

			return jsonResponse(newPref, 201);
		},
	},
	{
		method: "PUT",
		pattern: "/preferences/bulk",
		handler: async (request: Request, ctx: HeraldContext) => {
			const body = await parseJsonBody<{
				updates: Array<{
					subscriberId: string;
					channels?: Record<string, boolean>;
					workflows?: Record<string, WorkflowChannelPreference>;
					categories?: Record<string, CategoryPreference>;
					purposes?: Record<string, boolean>;
				}>;
			}>(request);

			if (!body.updates || !Array.isArray(body.updates)) {
				return jsonResponse({ error: "Missing 'updates' array" }, 400);
			}

			if (body.updates.length > 100) {
				return jsonResponse({ error: "Maximum 100 updates per request" }, 400);
			}

			// Reshape flat REST body into the internal { subscriberId, preferences } format
			const normalized = body.updates.map((u) => ({
				subscriberId: u.subscriberId,
				preferences: {
					channels: u.channels,
					workflows: u.workflows,
					categories: u.categories,
					purposes: u.purposes,
				},
			}));

			const results = await bulkUpdatePreferencesInternal(ctx.db, ctx, ctx.generateId, normalized);
			const hasErrors = results.some((r) => r.error);

			return jsonResponse({ results }, hasErrors ? 207 : 200);
		},
	},
];
