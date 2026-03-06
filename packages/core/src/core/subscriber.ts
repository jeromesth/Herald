import type { HeraldContext, SubscriberRecord } from "../types/config.js";
import type { ChannelType, StepContext } from "../types/workflow.js";

export async function resolveSubscriberByAnyId(
	db: HeraldContext["db"],
	value: string,
): Promise<SubscriberRecord | null> {
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

export async function resolveSubscriberInternalId(
	db: HeraldContext["db"],
	value: string,
): Promise<string | null> {
	const subscriber = await resolveSubscriberByAnyId(db, value);
	return subscriber?.id ?? null;
}

export async function resolveSubscriberForStep(
	ctx: HeraldContext,
	subscriber: StepContext["subscriber"],
): Promise<SubscriberRecord | null> {
	return resolveSubscriberByAnyId(ctx.db, subscriber.externalId ?? subscriber.id);
}

export function resolveRecipient(
	channel: ChannelType,
	subscriber: SubscriberRecord,
): string | null {
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
