import type { HeraldContext, SubscriberRecord } from "../../types/config.js";
import { jsonResponse, parseJsonBody } from "../router.js";

export const subscriberRoutes = [
	{
		method: "POST",
		pattern: "/subscribers",
		handler: async (request: Request, ctx: HeraldContext) => {
			const body = await parseJsonBody<{
				externalId: string;
				email?: string;
				phone?: string;
				firstName?: string;
				lastName?: string;
				avatar?: string;
				locale?: string;
				timezone?: string;
				data?: Record<string, unknown>;
			}>(request);

			if (!body.externalId) {
				return jsonResponse({ error: "externalId is required" }, 400);
			}

			const now = new Date();
			const existing = await ctx.db.findOne<SubscriberRecord>({
				model: "subscriber",
				where: [{ field: "externalId", value: body.externalId }],
			});

			if (existing) {
				const { externalId: _, ...updateFields } = body;
				await ctx.db.update({
					model: "subscriber",
					where: [{ field: "externalId", value: body.externalId }],
					update: { ...updateFields, updatedAt: now },
				});
				const updated = await ctx.db.findOne<SubscriberRecord>({
					model: "subscriber",
					where: [{ field: "externalId", value: body.externalId }],
				});
				return jsonResponse(updated);
			}

			const id = ctx.generateId();
			await ctx.db.create({
				model: "subscriber",
				data: { id, ...body, createdAt: now, updatedAt: now },
			});

			const created = await ctx.db.findOne<SubscriberRecord>({
				model: "subscriber",
				where: [{ field: "id", value: id }],
			});

			return jsonResponse(created, 201);
		},
	},
	{
		method: "GET",
		pattern: "/subscribers/:id",
		handler: async (
			_request: Request,
			ctx: HeraldContext,
			params: Record<string, string>,
		) => {
			const subscriber = await ctx.db.findOne<SubscriberRecord>({
				model: "subscriber",
				where: [{ field: "externalId", value: params.id }],
			});

			if (!subscriber) {
				return jsonResponse({ error: "Subscriber not found" }, 404);
			}

			return jsonResponse(subscriber);
		},
	},
	{
		method: "PATCH",
		pattern: "/subscribers/:id",
		handler: async (
			request: Request,
			ctx: HeraldContext,
			params: Record<string, string>,
		) => {
			const body = await parseJsonBody(request);
			const now = new Date();

			const existing = await ctx.db.findOne<SubscriberRecord>({
				model: "subscriber",
				where: [{ field: "externalId", value: params.id }],
			});

			if (!existing) {
				return jsonResponse({ error: "Subscriber not found" }, 404);
			}

			await ctx.db.update({
				model: "subscriber",
				where: [{ field: "externalId", value: params.id }],
				update: { ...body, updatedAt: now },
			});

			const updated = await ctx.db.findOne<SubscriberRecord>({
				model: "subscriber",
				where: [{ field: "externalId", value: params.id }],
			});

			return jsonResponse(updated);
		},
	},
	{
		method: "DELETE",
		pattern: "/subscribers/:id",
		handler: async (
			_request: Request,
			ctx: HeraldContext,
			params: Record<string, string>,
		) => {
			const existing = await ctx.db.findOne<SubscriberRecord>({
				model: "subscriber",
				where: [{ field: "externalId", value: params.id }],
			});

			if (!existing) {
				return jsonResponse({ error: "Subscriber not found" }, 404);
			}

			await ctx.db.delete({
				model: "subscriber",
				where: [{ field: "externalId", value: params.id }],
			});

			return jsonResponse({ status: "deleted" });
		},
	},
];
