/**
 * SendGrid email provider for Herald.
 */
import type {
	ChannelProvider,
	ChannelProviderMessage,
	ChannelProviderResult,
} from "../provider.js";

export interface SendGridConfig {
	apiKey: string;
	from: string;
	/** Optional SendGrid API endpoint override (for testing). */
	apiUrl?: string;
}

export function sendgridProvider(config: SendGridConfig): ChannelProvider {
	const apiUrl = config.apiUrl ?? "https://api.sendgrid.com/v3/mail/send";

	return {
		providerId: "sendgrid",
		channelType: "email",

		async send(message: ChannelProviderMessage): Promise<ChannelProviderResult> {
			const payload = {
				personalizations: [{ to: [{ email: message.to }] }],
				from: { email: config.from },
				subject: message.subject ?? "",
				content: [{ type: "text/html", value: message.body }],
			};

			const response = await fetch(apiUrl, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${config.apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(payload),
			});

			if (!response.ok) {
				const errorBody = await response.text();
				return {
					messageId: "",
					status: "failed",
					error: `SendGrid error ${response.status}: ${errorBody}`,
				};
			}

			const messageId = response.headers.get("X-Message-Id") ?? crypto.randomUUID();
			return { messageId, status: "sent" };
		},
	};
}
