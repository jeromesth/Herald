import { deepMerge } from "../../core/preferences.js";
import type { HeraldContext, PreferenceRecord, WorkflowChannelPreference } from "../../types/config.js";
import { jsonResponse, parseJsonBody } from "../router.js";

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

			return jsonResponse(
				pref ?? {
					subscriberId: subscriber.id,
					channels: { ...(ctx.options.defaultPreferences?.channels ?? {}) },
					workflows: { ...(ctx.options.defaultPreferences?.workflows ?? {}) },
					purposes: { ...(ctx.options.defaultPreferences?.purposes ?? {}) },
				},
			);
		},
	},
	{
		method: "PUT",
		pattern: "/subscribers/:id/preferences",
		handler: async (request: Request, ctx: HeraldContext, params: Record<string, string>) => {
			const body = await parseJsonBody<{
				channels?: Record<string, boolean>;
				workflows?: Record<string, boolean | WorkflowChannelPreference>;
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
			const defaultPurposes = ctx.options.defaultPreferences?.purposes ?? {};
			const newPref = {
				id,
				subscriberId: subscriber.id,
				channels: { ...defaultChannels, ...(body.channels ?? {}) },
				workflows: { ...defaultWorkflows, ...(body.workflows ?? {}) },
				purposes: { ...defaultPurposes, ...(body.purposes ?? {}) },
				updatedAt: now,
			};

			await ctx.db.create({ model: "preference", data: newPref });

			return jsonResponse(newPref, 201);
		},
	},
];
