import { HeraldNotFoundError, HeraldValidationError } from "../errors.js";
import type { ActivityEventInput, ActivityLogRecord } from "../types/activity.js";
import type { HeraldContext, NotificationRecord } from "../types/config.js";
import { type DeliveryStatus, asChannelType } from "../types/workflow.js";
import { emitEvent } from "./emit-event.js";

/**
 * Valid delivery status transitions. Each key maps to the set of statuses
 * it can transition to. Prevents nonsensical backward transitions like
 * "delivered" → "queued".
 */
const VALID_TRANSITIONS: Record<string, Set<DeliveryStatus>> = {
	queued: new Set(["sent", "failed"]),
	sent: new Set(["delivered", "bounced", "failed"]),
	delivered: new Set<DeliveryStatus>(),
	bounced: new Set<DeliveryStatus>(),
	failed: new Set(["queued", "sent"]),
};

/**
 * Validate whether a delivery status transition is allowed.
 * Returns an error message if invalid, or undefined if valid.
 */
export function validateStatusTransition(from: string, to: string): string | undefined {
	const allowed = VALID_TRANSITIONS[from];
	if (!allowed) {
		return `Invalid status transition: unknown current status "${from}". Known statuses: ${Object.keys(VALID_TRANSITIONS).join(", ")}`;
	}
	if (!allowed.has(to as DeliveryStatus)) {
		return `Invalid status transition: "${from}" → "${to}". Allowed transitions from "${from}": ${allowed.size > 0 ? [...allowed].join(", ") : "none (terminal state)"}`;
	}
	return undefined;
}

/**
 * Record an activity event to the database.
 *
 * Errors are logged but never propagated — activity logging must not
 * break the notification delivery pipeline.
 */
export async function recordActivity(ctx: HeraldContext, input: ActivityEventInput): Promise<void> {
	if (!ctx.activityLog) return;

	try {
		await ctx.db.create({
			model: "activityLog",
			data: {
				id: ctx.generateId(),
				transactionId: input.transactionId ?? null,
				workflowId: input.workflowId ?? null,
				subscriberId: input.subscriberId ?? null,
				channel: input.channel ?? null,
				stepId: input.stepId ?? null,
				event: input.event,
				detail: input.detail ?? null,
				createdAt: new Date(),
			},
		});
	} catch (error) {
		console.error("[herald] Failed to record activity event:", input.event, error);
	}
}

/**
 * Query activity log records with optional filters.
 */
export async function queryActivityLog(
	ctx: HeraldContext,
	filters: {
		transactionId?: string;
		workflowId?: string;
		subscriberId?: string;
		event?: string;
		limit?: number;
		offset?: number;
		sortDirection?: "asc" | "desc";
	},
): Promise<{ entries: ActivityLogRecord[]; totalCount: number }> {
	const where: { field: string; value: unknown }[] = [];

	if (filters.transactionId) {
		where.push({ field: "transactionId", value: filters.transactionId });
	}
	if (filters.workflowId) {
		where.push({ field: "workflowId", value: filters.workflowId });
	}
	if (filters.subscriberId) {
		where.push({ field: "subscriberId", value: filters.subscriberId });
	}
	if (filters.event) {
		where.push({ field: "event", value: filters.event });
	}

	const limit = Math.min(Math.max(filters.limit ?? 50, 1), 100);
	const offset = Math.max(filters.offset ?? 0, 0);

	const [entries, totalCount] = await Promise.all([
		ctx.db.findMany<ActivityLogRecord>({
			model: "activityLog",
			where: where.length > 0 ? where : undefined,
			limit,
			offset,
			sortBy: { field: "createdAt", direction: filters.sortDirection ?? "desc" },
		}),
		ctx.db.count({ model: "activityLog", where: where.length > 0 ? where : undefined }),
	]);

	return { entries, totalCount };
}

/**
 * Update a notification's delivery status, validating the transition and
 * emitting `notification.status_changed`. Used by both the `HeraldAPI`
 * method and the observability plugin's `/delivery-status` route.
 *
 * Throws `HeraldNotFoundError` if the notification doesn't exist and
 * `HeraldValidationError` if the transition is disallowed.
 */
export async function updateDeliveryStatusInternal(
	ctx: HeraldContext,
	args: { notificationId: string; status: DeliveryStatus; detail?: Record<string, unknown> },
): Promise<{ previousStatus: string; newStatus: DeliveryStatus }> {
	const notification = await ctx.db.findOne<NotificationRecord>({
		model: "notification",
		where: [{ field: "id", value: args.notificationId }],
	});

	if (!notification) {
		throw new HeraldNotFoundError("notification", `Notification "${args.notificationId}" not found`);
	}

	const transitionError = validateStatusTransition(notification.deliveryStatus, args.status);
	if (transitionError) {
		throw new HeraldValidationError(transitionError);
	}

	await ctx.db.update({
		model: "notification",
		where: [{ field: "id", value: args.notificationId }],
		update: { deliveryStatus: args.status },
	});

	void emitEvent(ctx, {
		event: "notification.status_changed",
		workflowId: notification.workflowId,
		subscriberId: notification.subscriberId,
		transactionId: notification.transactionId,
		channel: asChannelType(notification.channel),
		detail: {
			notificationId: args.notificationId,
			previousStatus: notification.deliveryStatus,
			newStatus: args.status,
			...args.detail,
		},
	});

	return { previousStatus: notification.deliveryStatus, newStatus: args.status };
}
