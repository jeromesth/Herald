import type { HeraldContext, SubscriberRecord } from "../../types/config.js";
import { jsonResponse, parseJsonBody } from "../router.js";

/** Basic email format check — not exhaustive, just catches obvious mistakes. */
function isValidEmail(value: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

const typeValidators: Record<string, (v: unknown) => boolean> = {
	string: (v) => typeof v === "string",
	number: (v) => typeof v === "number",
	boolean: (v) => typeof v === "boolean",
	json: (v) => v != null && typeof v === "object",
};

function pickConfiguredSubscriberFields(ctx: HeraldContext, body: Record<string, unknown>): Record<string, unknown> {
	const configured = ctx.options.subscriber?.additionalFields;
	if (!configured) return {};

	const result: Record<string, unknown> = {};
	for (const [fieldName, fieldConfig] of Object.entries(configured)) {
		if (fieldName in body) {
			const validator = typeValidators[fieldConfig.type];
			if (validator?.(body[fieldName])) {
				result[fieldName] = body[fieldName];
			}
		}
	}
	return result;
}

export const subscriberRoutes = [
	{
		method: "POST",
		pattern: "/subscribers",
		handler: async (request: Request, ctx: HeraldContext) => {
			const body = await parseJsonBody<Record<string, unknown>>(request);
			const externalId = typeof body.externalId === "string" ? body.externalId : "";
			if (!externalId) {
				return jsonResponse({ error: "externalId is required" }, 400);
			}

			if (typeof body.email === "string" && !isValidEmail(body.email)) {
				return jsonResponse({ error: "Invalid email format" }, 400);
			}

			const subscriberData = {
				externalId,
				email: typeof body.email === "string" ? body.email : undefined,
				phone: typeof body.phone === "string" ? body.phone : undefined,
				firstName: typeof body.firstName === "string" ? body.firstName : undefined,
				lastName: typeof body.lastName === "string" ? body.lastName : undefined,
				avatar: typeof body.avatar === "string" ? body.avatar : undefined,
				locale: typeof body.locale === "string" ? body.locale : undefined,
				timezone: typeof body.timezone === "string" ? body.timezone : undefined,
				data:
					typeof body.data === "object" && body.data != null && !Array.isArray(body.data)
						? (body.data as Record<string, unknown>)
						: undefined,
				...pickConfiguredSubscriberFields(ctx, body),
			};

			const now = new Date();
			const existing = await ctx.db.findOne<SubscriberRecord>({
				model: "subscriber",
				where: [{ field: "externalId", value: externalId }],
			});

			if (existing) {
				const { externalId: _, ...updateFields } = subscriberData;
				await ctx.db.update({
					model: "subscriber",
					where: [{ field: "externalId", value: externalId }],
					update: { ...updateFields, updatedAt: now },
				});
				const updated = await ctx.db.findOne<SubscriberRecord>({
					model: "subscriber",
					where: [{ field: "externalId", value: externalId }],
				});
				return jsonResponse(updated);
			}

			const id = ctx.generateId();
			await ctx.db.create({
				model: "subscriber",
				data: { id, ...subscriberData, createdAt: now, updatedAt: now },
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
		handler: async (_request: Request, ctx: HeraldContext, params: Record<string, string>) => {
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
		handler: async (request: Request, ctx: HeraldContext, params: Record<string, string>) => {
			const body = await parseJsonBody<Record<string, unknown>>(request);
			const now = new Date();

			const existing = await ctx.db.findOne<SubscriberRecord>({
				model: "subscriber",
				where: [{ field: "externalId", value: params.id }],
			});

			if (!existing) {
				return jsonResponse({ error: "Subscriber not found" }, 404);
			}

			if ("email" in body && typeof body.email === "string" && !isValidEmail(body.email)) {
				return jsonResponse({ error: "Invalid email format" }, 400);
			}

			const updateBody: Record<string, unknown> = {};
			const stringFields = ["email", "phone", "firstName", "lastName", "avatar", "locale", "timezone"] as const;
			for (const field of stringFields) {
				if (field in body && typeof body[field] === "string") {
					updateBody[field] = body[field];
				}
			}
			if ("data" in body && typeof body.data === "object" && body.data != null && !Array.isArray(body.data)) {
				updateBody.data = body.data as Record<string, unknown>;
			}
			Object.assign(updateBody, pickConfiguredSubscriberFields(ctx, body));

			await ctx.db.update({
				model: "subscriber",
				where: [{ field: "externalId", value: params.id }],
				update: { ...updateBody, updatedAt: now },
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
		handler: async (_request: Request, ctx: HeraldContext, params: Record<string, string>) => {
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
