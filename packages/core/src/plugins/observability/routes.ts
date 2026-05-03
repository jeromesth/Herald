import { HTTPError, jsonResponse, parseJsonBody } from "../../api/router.js";
import { queryActivityLog, updateDeliveryStatusInternal } from "../../core/activity.js";
import { HeraldNotFoundError, HeraldValidationError } from "../../errors.js";
import type { HeraldContext } from "../../types/config.js";
import type { PluginEndpoint } from "../../types/plugin.js";
import type { DeliveryStatus } from "../../types/workflow.js";

const VALID_DELIVERY_STATUSES = new Set(["queued", "sent", "delivered", "bounced", "failed"]);

// Default page sizes are intentionally different per route:
// - /activity (global timeline) defaults to 50 for cheap list-style browsing
// - /activity/:transactionId (single-trace view) defaults to 100 because a
//   single workflow run typically emits a handful of events and we'd like the
//   whole trace on one page when possible. Both cap at 100.
export const observabilityEndpoints: Record<string, PluginEndpoint> = {
	listActivity: {
		method: "GET",
		path: "/activity",
		handler: async (request: Request, ctx: HeraldContext) => {
			const url = new URL(request.url);
			const rawLimit = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
			const rawOffset = Number.parseInt(url.searchParams.get("offset") ?? "0", 10);

			const limit = Math.min(Math.max(Number.isNaN(rawLimit) ? 50 : rawLimit, 1), 100);
			const offset = Math.max(Number.isNaN(rawOffset) ? 0 : rawOffset, 0);

			const { entries, totalCount } = await queryActivityLog(ctx, {
				transactionId: url.searchParams.get("transactionId") ?? undefined,
				workflowId: url.searchParams.get("workflowId") ?? undefined,
				subscriberId: url.searchParams.get("subscriberId") ?? undefined,
				event: url.searchParams.get("event") ?? undefined,
				limit,
				offset,
			});

			return jsonResponse({
				entries,
				totalCount,
				hasMore: offset + limit < totalCount,
			});
		},
	},

	getActivityByTransaction: {
		method: "GET",
		path: "/activity/:transactionId",
		handler: async (request: Request, ctx: HeraldContext, params: Record<string, string>) => {
			const url = new URL(request.url);
			const rawLimit = Number.parseInt(url.searchParams.get("limit") ?? "100", 10);
			const rawOffset = Number.parseInt(url.searchParams.get("offset") ?? "0", 10);

			const limit = Math.min(Math.max(Number.isNaN(rawLimit) ? 100 : rawLimit, 1), 100);
			const offset = Math.max(Number.isNaN(rawOffset) ? 0 : rawOffset, 0);

			const { entries, totalCount } = await queryActivityLog(ctx, {
				transactionId: params.transactionId,
				limit,
				offset,
				sortDirection: "asc",
			});

			return jsonResponse({ entries, totalCount, hasMore: offset + limit < totalCount });
		},
	},

	updateDeliveryStatus: {
		method: "POST",
		path: "/delivery-status",
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
			const validatedStatus = body.status as DeliveryStatus;

			try {
				await updateDeliveryStatusInternal(ctx, {
					notificationId: body.notificationId,
					status: validatedStatus,
					detail: body.detail,
				});
			} catch (err) {
				if (err instanceof HeraldNotFoundError) {
					throw new HTTPError(404, err.message);
				}
				if (err instanceof HeraldValidationError) {
					throw new HTTPError(422, err.message);
				}
				throw err;
			}

			return jsonResponse({ status: "updated", deliveryStatus: validatedStatus });
		},
	},
};
