import type { HeraldContext, NotificationRecord } from "../../types/config.js";
import { jsonResponse, parseJsonBody } from "../router.js";

export const notificationRoutes = [
	{
		method: "GET",
		pattern: "/notifications/:subscriberId",
		handler: async (request: Request, ctx: HeraldContext, params: Record<string, string>) => {
			const url = new URL(request.url);
			const rawLimit = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);
			const limit = Math.min(Math.max(Number.isNaN(rawLimit) ? 20 : rawLimit, 1), 200);
			const rawOffset = Number.parseInt(url.searchParams.get("offset") ?? "0", 10);
			const offset = Math.max(Number.isNaN(rawOffset) ? 0 : rawOffset, 0);
			const read = url.searchParams.has("read") ? url.searchParams.get("read") !== "false" : undefined;
			const seen = url.searchParams.has("seen") ? url.searchParams.get("seen") !== "false" : undefined;
			const archived = url.searchParams.has("archived") ? url.searchParams.get("archived") !== "false" : undefined;

			// Resolve subscriber internal ID from external ID
			const subscriber = await ctx.db.findOne<{ id: string }>({
				model: "subscriber",
				where: [{ field: "externalId", value: params.subscriberId }],
				select: ["id"],
			});

			if (!subscriber) {
				return jsonResponse({ error: "Subscriber not found" }, 404);
			}

			const where: { field: string; value: unknown }[] = [{ field: "subscriberId", value: subscriber.id }];

			if (read !== undefined) where.push({ field: "read", value: read });
			if (seen !== undefined) where.push({ field: "seen", value: seen });
			if (archived !== undefined) where.push({ field: "archived", value: archived });

			const [notifications, totalCount] = await Promise.all([
				ctx.db.findMany<NotificationRecord>({
					model: "notification",
					where,
					limit,
					offset,
					sortBy: { field: "createdAt", direction: "desc" },
				}),
				ctx.db.count({ model: "notification", where }),
			]);

			return jsonResponse({
				notifications,
				totalCount,
				hasMore: offset + limit < totalCount,
			});
		},
	},
	{
		method: "GET",
		pattern: "/notifications/:subscriberId/count",
		handler: async (request: Request, ctx: HeraldContext, params: Record<string, string>) => {
			const url = new URL(request.url);
			const read = url.searchParams.has("read") ? url.searchParams.get("read") !== "false" : undefined;

			const subscriber = await ctx.db.findOne<{ id: string }>({
				model: "subscriber",
				where: [{ field: "externalId", value: params.subscriberId }],
				select: ["id"],
			});

			if (!subscriber) {
				return jsonResponse({ error: "Subscriber not found" }, 404);
			}

			const where: { field: string; value: unknown }[] = [{ field: "subscriberId", value: subscriber.id }];

			if (read !== undefined) where.push({ field: "read", value: read });

			const count = await ctx.db.count({ model: "notification", where });

			return jsonResponse({ count });
		},
	},
	{
		method: "POST",
		pattern: "/notifications/mark",
		handler: async (request: Request, ctx: HeraldContext) => {
			const body = await parseJsonBody<{
				ids: string[];
				action: "read" | "seen" | "archived";
			}>(request);

			if (!body.ids?.length) {
				return jsonResponse({ error: "ids array is required" }, 400);
			}
			if (!body.action || !["read", "seen", "archived"].includes(body.action)) {
				return jsonResponse({ error: "action must be 'read', 'seen', or 'archived'" }, 400);
			}

			const now = new Date();
			const updates: Record<string, unknown> = {};

			switch (body.action) {
				case "read":
					updates.read = true;
					updates.readAt = now;
					break;
				case "seen":
					updates.seen = true;
					updates.seenAt = now;
					break;
				case "archived":
					updates.archived = true;
					updates.archivedAt = now;
					break;
			}

			const count = await ctx.db.updateMany({
				model: "notification",
				where: [{ field: "id", value: body.ids, operator: "in" }],
				update: updates,
			});

			return jsonResponse({ status: "updated", count });
		},
	},
	{
		method: "POST",
		pattern: "/notifications/mark-all-read",
		handler: async (request: Request, ctx: HeraldContext) => {
			const body = await parseJsonBody<{ subscriberId: string }>(request);

			if (!body.subscriberId) {
				return jsonResponse({ error: "subscriberId is required" }, 400);
			}

			const subscriber = await ctx.db.findOne<{ id: string }>({
				model: "subscriber",
				where: [{ field: "externalId", value: body.subscriberId }],
				select: ["id"],
			});

			if (!subscriber) {
				return jsonResponse({ error: "Subscriber not found" }, 404);
			}

			const now = new Date();
			const count = await ctx.db.updateMany({
				model: "notification",
				where: [
					{ field: "subscriberId", value: subscriber.id },
					{ field: "read", value: false },
				],
				update: { read: true, readAt: now },
			});

			return jsonResponse({ status: "updated", count });
		},
	},
];
