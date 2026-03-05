import { renderEmail } from "../templates/layouts.js";
import type { TemplateContext } from "../templates/types.js";
import type { HeraldContext } from "../types/config.js";
import type { ChannelType } from "../types/workflow.js";
import { resolveSubscriberByAnyId } from "./subscriber.js";

export interface ProviderSendArgs {
	channel: ChannelType;
	subscriberId: string;
	to: string;
	subject?: string;
	body: string;
	actionUrl?: string;
	layoutId?: string;
	data?: Record<string, unknown>;
}

function applyBeforeSendPatch(
	message: ProviderSendArgs,
	patch: Record<string, unknown> | void,
): void {
	if (!patch) return;

	const knownKeys = new Set(["to", "subject", "body", "actionUrl", "layoutId", "data"]);

	if (typeof patch.to === "string") {
		message.to = patch.to;
	}
	if (typeof patch.subject === "string") {
		message.subject = patch.subject;
	}
	if (typeof patch.body === "string") {
		message.body = patch.body;
	}
	if (typeof patch.actionUrl === "string") {
		message.actionUrl = patch.actionUrl;
	}
	if (typeof patch.layoutId === "string") {
		message.layoutId = patch.layoutId;
	}
	if (patch.data && typeof patch.data === "object" && !Array.isArray(patch.data)) {
		message.data = {
			...(message.data ?? {}),
			...(patch.data as Record<string, unknown>),
		};
	}

	const extra: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(patch)) {
		if (!knownKeys.has(key)) {
			extra[key] = value;
		}
	}
	if (Object.keys(extra).length > 0) {
		message.data = {
			...(message.data ?? {}),
			...extra,
		};
	}
}

function resolveTemplatePayload(data?: Record<string, unknown>): Record<string, unknown> {
	if (!data) {
		return {};
	}

	const payload = data.payload;
	if (payload && typeof payload === "object" && !Array.isArray(payload)) {
		return payload as Record<string, unknown>;
	}

	return data;
}

export async function sendThroughProvider(
	ctx: HeraldContext,
	initialMessage: ProviderSendArgs,
): Promise<{ messageId: string; status: string }> {
	const provider = ctx.channels.get(initialMessage.channel);
	if (!provider) {
		throw new Error(`No provider registered for channel "${initialMessage.channel}"`);
	}

	const message: ProviderSendArgs = {
		...initialMessage,
		data: initialMessage.data ? { ...initialMessage.data } : undefined,
	};

	// Run beforeSend hooks and allow hooks to mutate message content.
	if (ctx.options.plugins) {
		for (const plugin of ctx.options.plugins) {
			if (plugin.hooks?.beforeSend) {
				const patch = await plugin.hooks.beforeSend({
					subscriberId: message.subscriberId,
					channel: message.channel,
					content: {
						to: message.to,
						subject: message.subject,
						body: message.body,
						actionUrl: message.actionUrl,
						layoutId: message.layoutId,
						...(message.data ?? {}),
					},
				});
				applyBeforeSendPatch(message, patch);
			}
		}
	}

	const subscriber = await resolveSubscriberByAnyId(ctx.db, message.subscriberId);
	if (!subscriber) {
		console.warn(
			`[herald] Subscriber "${message.subscriberId}" not found. Template rendering will use limited context.`,
		);
	}
	const templateContext: TemplateContext = {
		subscriber: (subscriber ?? {
			id: message.subscriberId,
			externalId: message.subscriberId,
		}) as unknown as Record<string, unknown>,
		payload: resolveTemplatePayload(message.data),
		app: { name: ctx.options.appName },
		...(message.data ?? {}),
	};

	// Template rendering is applied before provider.send.
	if (message.channel === "email") {
		const layout = message.layoutId
			? (ctx.layouts.get(message.layoutId) ?? ctx.layouts.getDefault())
			: ctx.layouts.getDefault();
		const rendered = renderEmail({
			layout,
			subject: message.subject ?? "",
			body: message.body,
			context: templateContext,
		});
		message.subject = rendered.subject;
		message.body = rendered.html;
		if (rendered.text) {
			message.data = {
				...(message.data ?? {}),
				text: rendered.text,
			};
		}
	} else {
		if (message.subject) {
			message.subject = ctx.templateEngine.render(message.subject, templateContext);
		}
		message.body = ctx.templateEngine.render(message.body, templateContext);
	}

	const result = await provider.send({
		subscriberId: message.subscriberId,
		to: message.to,
		subject: message.subject,
		body: message.body,
		actionUrl: message.actionUrl,
		data: message.data,
	});

	if (result.status === "failed") {
		console.error(
			`[herald] Provider "${provider.providerId}" failed to send to ${message.to}: ${result.error ?? "unknown error"}`,
		);
	}

	// Run afterSend hooks
	if (ctx.options.plugins) {
		for (const plugin of ctx.options.plugins) {
			if (plugin.hooks?.afterSend) {
				await plugin.hooks.afterSend({
					subscriberId: message.subscriberId,
					channel: message.channel,
					messageId: result.messageId,
					status: result.status,
				});
			}
		}
	}

	return { messageId: result.messageId, status: result.status };
}
