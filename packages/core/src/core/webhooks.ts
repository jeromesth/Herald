import type { ActivityEventInput, WebhookConfig, WebhookEventPayload } from "../types/activity.js";
import type { HeraldContext } from "../types/config.js";

/**
 * Emit a webhook event to all configured endpoints.
 *
 * Delivery is fire-and-forget — errors are logged but never propagated.
 * Each webhook endpoint is called concurrently.
 */
export async function emitWebhookEvent(ctx: HeraldContext, input: ActivityEventInput): Promise<void> {
	const webhooks = ctx.options.webhooks;
	if (!webhooks || webhooks.length === 0) return;

	const payload: WebhookEventPayload = {
		id: ctx.generateId(),
		event: input.event,
		timestamp: new Date().toISOString(),
		data: {
			transactionId: input.transactionId,
			workflowId: input.workflowId,
			subscriberId: input.subscriberId,
			channel: input.channel,
			stepId: input.stepId,
			detail: input.detail,
		},
	};

	const body = JSON.stringify(payload);

	await Promise.allSettled(
		webhooks.filter((webhook) => shouldSendToWebhook(webhook, input.event)).map((webhook) => deliverWebhook(webhook, body, payload)),
	);
}

function shouldSendToWebhook(webhook: WebhookConfig, event: string): boolean {
	if (!webhook.events || webhook.events.length === 0) return true;
	return (webhook.events as string[]).includes(event);
}

async function deliverWebhook(webhook: WebhookConfig, body: string, payload: WebhookEventPayload): Promise<void> {
	try {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			...webhook.headers,
		};

		if (webhook.secret) {
			// Sign `${timestamp}.${body}` so consumers can reject replayed payloads
			// outside an acceptable clock-skew window.
			const timestamp = Math.floor(Date.now() / 1000).toString();
			const signature = await computeHmacSignature(webhook.secret, `${timestamp}.${body}`);
			headers["X-Herald-Timestamp"] = timestamp;
			headers["X-Herald-Signature"] = signature;
		}

		const response = await fetch(webhook.url, {
			method: "POST",
			headers,
			body,
			signal: AbortSignal.timeout(10_000),
		});

		if (!response.ok) {
			console.error(`[herald] Webhook delivery failed to ${webhook.url}: HTTP ${response.status}`);
		}
	} catch (error) {
		console.error(`[herald] Webhook delivery failed to ${webhook.url}:`, error);
	}
}

/**
 * Compute HMAC-SHA256 signature for webhook payload verification.
 */
async function computeHmacSignature(secret: string, body: string): Promise<string> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
	const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
	return `sha256=${Array.from(new Uint8Array(signature))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("")}`;
}
