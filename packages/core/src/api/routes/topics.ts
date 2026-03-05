import type { HeraldContext } from "../../types/config.js";
import { jsonResponse, parseJsonBody } from "../router.js";

interface TopicRecord {
	id: string;
	key: string;
	name: string;
	createdAt: Date;
	updatedAt: Date;
}

export const topicRoutes = [
	{
		method: "POST",
		pattern: "/topics",
		handler: async (request: Request, ctx: HeraldContext) => {
			const body = await parseJsonBody<{
				key: string;
				name: string;
			}>(request);

			if (!body.key) {
				return jsonResponse({ error: "key is required" }, 400);
			}

			const existing = await ctx.db.findOne<TopicRecord>({
				model: "topic",
				where: [{ field: "key", value: body.key }],
			});

			if (existing) {
				return jsonResponse({ error: "Topic already exists" }, 409);
			}

			const now = new Date();
			const id = ctx.generateId();

			await ctx.db.create({
				model: "topic",
				data: {
					id,
					key: body.key,
					name: body.name || body.key,
					createdAt: now,
					updatedAt: now,
				},
			});

			const created = await ctx.db.findOne<TopicRecord>({
				model: "topic",
				where: [{ field: "id", value: id }],
			});

			return jsonResponse(created, 201);
		},
	},
	{
		method: "GET",
		pattern: "/topics",
		handler: async (request: Request, ctx: HeraldContext) => {
			const url = new URL(request.url);
			const limit = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
			const offset = Number.parseInt(url.searchParams.get("offset") ?? "0", 10);

			const topics = await ctx.db.findMany<TopicRecord>({
				model: "topic",
				limit,
				offset,
				sortBy: { field: "createdAt", direction: "desc" },
			});

			return jsonResponse({ topics });
		},
	},
	{
		method: "GET",
		pattern: "/topics/:key",
		handler: async (_request: Request, ctx: HeraldContext, params: Record<string, string>) => {
			const topic = await ctx.db.findOne<TopicRecord>({
				model: "topic",
				where: [{ field: "key", value: params.key }],
			});

			if (!topic) {
				return jsonResponse({ error: "Topic not found" }, 404);
			}

			return jsonResponse(topic);
		},
	},
	{
		method: "DELETE",
		pattern: "/topics/:key",
		handler: async (_request: Request, ctx: HeraldContext, params: Record<string, string>) => {
			const topic = await ctx.db.findOne<TopicRecord>({
				model: "topic",
				where: [{ field: "key", value: params.key }],
			});

			if (!topic) {
				return jsonResponse({ error: "Topic not found" }, 404);
			}

			await ctx.db.delete({
				model: "topic",
				where: [{ field: "key", value: params.key }],
			});

			return jsonResponse({ status: "deleted" });
		},
	},
	{
		method: "POST",
		pattern: "/topics/:key/subscribers",
		handler: async (request: Request, ctx: HeraldContext, params: Record<string, string>) => {
			const body = await parseJsonBody<{ subscriberIds: string[] }>(request);

			if (!body.subscriberIds?.length) {
				return jsonResponse({ error: "subscriberIds array is required" }, 400);
			}

			const topic = await ctx.db.findOne<TopicRecord>({
				model: "topic",
				where: [{ field: "key", value: params.key }],
			});

			if (!topic) {
				return jsonResponse({ error: "Topic not found" }, 404);
			}

			const now = new Date();
			let added = 0;

			for (const subscriberId of body.subscriberIds) {
				const existing = await ctx.db.findOne({
					model: "topicSubscriber",
					where: [
						{ field: "topicId", value: topic.id },
						{ field: "subscriberId", value: subscriberId },
					],
				});

				if (!existing) {
					await ctx.db.create({
						model: "topicSubscriber",
						data: {
							id: ctx.generateId(),
							topicId: topic.id,
							subscriberId,
							createdAt: now,
						},
					});
					added++;
				}
			}

			return jsonResponse({ status: "added", count: added });
		},
	},
	{
		method: "DELETE",
		pattern: "/topics/:key/subscribers",
		handler: async (request: Request, ctx: HeraldContext, params: Record<string, string>) => {
			const body = await parseJsonBody<{ subscriberIds: string[] }>(request);

			if (!body.subscriberIds?.length) {
				return jsonResponse({ error: "subscriberIds array is required" }, 400);
			}

			const topic = await ctx.db.findOne<TopicRecord>({
				model: "topic",
				where: [{ field: "key", value: params.key }],
			});

			if (!topic) {
				return jsonResponse({ error: "Topic not found" }, 404);
			}

			let removed = 0;

			for (const subscriberId of body.subscriberIds) {
				try {
					await ctx.db.delete({
						model: "topicSubscriber",
						where: [
							{ field: "topicId", value: topic.id },
							{ field: "subscriberId", value: subscriberId },
						],
					});
					removed++;
				} catch {
					// Subscriber was not in topic, skip
				}
			}

			return jsonResponse({ status: "removed", count: removed });
		},
	},
];
