import type { DatabaseAdapter } from "../types/adapter.js";
import type { HeraldContext, SubscriberRecord } from "../types/config.js";
import type { ChannelType, StepContext } from "../types/workflow.js";

export async function resolveSubscriberByAnyId(db: HeraldContext["db"], value: string): Promise<SubscriberRecord | null> {
	const byExternalId = await db.findOne<SubscriberRecord>({
		model: "subscriber",
		where: [{ field: "externalId", value }],
	});
	if (byExternalId) {
		return byExternalId;
	}

	return db.findOne<SubscriberRecord>({
		model: "subscriber",
		where: [{ field: "id", value }],
	});
}

export async function resolveSubscriberInternalId(db: HeraldContext["db"], value: string): Promise<string | null> {
	const subscriber = await resolveSubscriberByAnyId(db, value);
	return subscriber?.id ?? null;
}

/**
 * Batch-resolve external IDs and/or internal subscriber IDs to internal `subscriber.id` values.
 * Per-key semantics match {@link resolveSubscriberInternalId}: `externalId` is tried before `id`.
 */
export async function resolveSubscriberInternalIdsMap(db: DatabaseAdapter, ids: string[]): Promise<Map<string, string>> {
	const unique = [...new Set(ids)];
	const result = new Map<string, string>();
	if (unique.length === 0) {
		return result;
	}

	const byExternal = await db.findMany<SubscriberRecord>({
		model: "subscriber",
		where: [{ field: "externalId", operator: "in", value: unique }],
		select: ["id", "externalId"],
	});
	for (const row of byExternal) {
		result.set(row.externalId, row.id);
	}

	const remaining = unique.filter((id) => !result.has(id));
	if (remaining.length === 0) {
		return result;
	}

	const byId = await db.findMany<SubscriberRecord>({
		model: "subscriber",
		where: [{ field: "id", operator: "in", value: remaining }],
		select: ["id"],
	});
	const foundIds = new Set(byId.map((r) => r.id));
	for (const id of remaining) {
		if (foundIds.has(id)) {
			result.set(id, id);
		}
	}

	return result;
}

export async function resolveSubscriberForStep(
	ctx: HeraldContext,
	subscriber: StepContext["subscriber"],
): Promise<SubscriberRecord | null> {
	return resolveSubscriberByAnyId(ctx.db, subscriber.externalId ?? subscriber.id);
}

export function resolveRecipient(channel: ChannelType, subscriber: SubscriberRecord): string | null {
	switch (channel) {
		case "in_app":
			return subscriber.id;
		case "email":
			return subscriber.email ?? null;
		case "sms":
			return subscriber.phone ?? null;
		case "push":
		case "chat":
		case "webhook":
			return subscriber.externalId;
		default:
			return null;
	}
}
