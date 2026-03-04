import type { HeraldContext, PreferenceRecord } from "../../types/config.js";
import { jsonResponse, parseJsonBody } from "../router.js";

export const preferenceRoutes = [
	{
		method: "GET",
		pattern: "/subscribers/:id/preferences",
		handler: async (
			_request: Request,
			ctx: HeraldContext,
			params: Record<string, string>,
		) => {
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
					channels: {},
					workflows: {},
					categories: {},
				},
			);
		},
	},
	{
		method: "PUT",
		pattern: "/subscribers/:id/preferences",
		handler: async (
			request: Request,
			ctx: HeraldContext,
			params: Record<string, string>,
		) => {
			const body = await parseJsonBody<{
				channels?: Record<string, boolean>;
				workflows?: Record<string, boolean>;
				categories?: Record<string, boolean>;
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
					channels: { ...existing.channels, ...body.channels },
					workflows: { ...existing.workflows, ...body.workflows },
					categories: { ...existing.categories, ...body.categories },
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
			const newPref = {
				id,
				subscriberId: subscriber.id,
				channels: body.channels ?? {},
				workflows: body.workflows ?? {},
				categories: body.categories ?? {},
				updatedAt: now,
			};

			await ctx.db.create({ model: "preference", data: newPref });

			return jsonResponse(newPref, 201);
		},
	},
];
