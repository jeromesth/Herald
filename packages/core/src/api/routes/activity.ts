import { queryActivityLog, validateStatusTransition } from "../../core/activity.js";
import { emitEvent } from "../../core/emit-event.js";
import type { HeraldContext, NotificationRecord } from "../../types/config.js";
import { CHANNEL_TYPES, type ChannelType, type DeliveryStatus } from "../../types/workflow.js";
import { HTTPError, jsonResponse, parseJsonBody } from "../router.js";

const VALID_DELIVERY_STATUSES = new Set(["queued", "sent", "delivered", "bounced", "failed"]);

export const activityRoutes = [
	{
		method: "GET",
		pattern: "/activity",
		handler: async (request: Request, ctx: HeraldContext) => {
			const url = new URL(request.url);
			const rawLimit = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
			const rawOffset = Number.parseInt(url.searchParams.get("offset") ?? "0", 10);

			const { entries, totalCount } = await queryActivityLog(ctx, {
				transactionId: url.searchParams.get("transactionId") ?? undefined,
				workflowId: url.searchParams.get("workflowId") ?? undefined,
				subscriberId: url.searchParams.get("subscriberId") ?? undefined,
				event: url.searchParams.get("event") ?? undefined,
				limit: Number.isNaN(rawLimit) ? 50 : rawLimit,
				offset: Number.isNaN(rawOffset) ? 0 : rawOffset,
			});

			const limit = Math.min(Math.max(Number.isNaN(rawLimit) ? 50 : rawLimit, 1), 100);
			const offset = Math.max(Number.isNaN(rawOffset) ? 0 : rawOffset, 0);

			return jsonResponse({
				entries,
				totalCount,
				hasMore: offset + limit < totalCount,
			});
		},
	},
	{
		method: "GET",
		pattern: "/activity/:transactionId",
		handler: async (_request: Request, ctx: HeraldContext, params: Record<string, string>) => {
			const { entries, totalCount } = await queryActivityLog(ctx, {
				transactionId: params.transactionId,
				limit: 100,
				sortDirection: "asc",
			});

			return jsonResponse({ entries, totalCount });
		},
	},
	{
		method: "POST",
		pattern: "/delivery-status",
		handler: async (request: Request, ctx: HeraldContext) => {
			const body = await parseJsonBody<{
				notificationId: string;
				status: string;
				detail?: Record<string, unknown>;
			}>(request);

			if (!body.notificationId) {
				throw new HTTPError(400, "notificationId is required");
			}
			if (!body.status || !VALID_DELIVERY_STATUSES.has(body.status)) {
				throw new HTTPError(400, `status must be one of: ${[...VALID_DELIVERY_STATUSES].join(", ")}`);
			}

			const notification = await ctx.db.findOne<NotificationRecord>({
				model: "notification",
				where: [{ field: "id", value: body.notificationId }],
			});

			if (!notification) {
				throw new HTTPError(404, `Notification "${body.notificationId}" not found`);
			}

			const transitionError = validateStatusTransition(notification.deliveryStatus, body.status);
			if (transitionError) {
				throw new HTTPError(422, transitionError);
			}

			await ctx.db.update({
				model: "notification",
				where: [{ field: "id", value: body.notificationId }],
				update: { deliveryStatus: body.status },
			});

			await emitEvent(ctx, {
				event: "notification.status_changed",
				workflowId: notification.workflowId,
				subscriberId: notification.subscriberId,
				transactionId: notification.transactionId,
				channel: (CHANNEL_TYPES as readonly string[]).includes(notification.channel) ? (notification.channel as ChannelType) : undefined,
				detail: {
					notificationId: body.notificationId,
					previousStatus: notification.deliveryStatus,
					newStatus: body.status,
					...body.detail,
				},
			});

			return jsonResponse({ status: "updated", deliveryStatus: body.status as DeliveryStatus });
		},
	},
];
