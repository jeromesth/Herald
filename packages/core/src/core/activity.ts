import type { ActivityEventInput, ActivityLogRecord } from "../types/activity.js";
import type { HeraldContext } from "../types/config.js";

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
			sortBy: { field: "createdAt", direction: "desc" },
		}),
		ctx.db.count({ model: "activityLog", where: where.length > 0 ? where : undefined }),
	]);

	return { entries, totalCount };
}
