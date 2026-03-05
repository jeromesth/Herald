/**
 * Real-time SSE routes for live notification feeds.
 */
import type { HeraldContext } from "../../types/config.js";
import { jsonResponse } from "../router.js";

export const realtimeRoutes = [
	{
		method: "GET",
		pattern: "/notifications/:subscriberId/stream",
		handler: async (_request: Request, ctx: HeraldContext, params: Record<string, string>) => {
			if (!ctx.sse) {
				return jsonResponse({ error: "Real-time not enabled" }, 501);
			}

			// Resolve subscriber
			const subscriber = await ctx.db.findOne<{ id: string }>({
				model: "subscriber",
				where: [{ field: "externalId", value: params.subscriberId }],
				select: ["id"],
			});

			if (!subscriber) {
				return jsonResponse({ error: "Subscriber not found" }, 404);
			}

			return ctx.sse.connect(subscriber.id);
		},
	},
];
