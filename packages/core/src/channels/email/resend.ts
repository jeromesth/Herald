/**
 * Resend email provider for Herald.
 */
import type {
	ChannelProvider,
	ChannelProviderMessage,
	ChannelProviderResult,
} from "../provider.js";

export interface ResendConfig {
	apiKey: string;
	from: string;
	/** Optional API endpoint override (for testing). */
	apiUrl?: string;
}

export function resendProvider(config: ResendConfig): ChannelProvider {
	const apiUrl = config.apiUrl ?? "https://api.resend.com/emails";

	return {
		providerId: "resend",
		channelType: "email",

		async send(message: ChannelProviderMessage): Promise<ChannelProviderResult> {
			const payload = {
				from: config.from,
				to: [message.to],
				subject: message.subject ?? "",
				html: message.body,
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
					error: `Resend error ${response.status}: ${errorBody}`,
				};
			}

			const result = (await response.json()) as { id: string };
			return { messageId: result.id, status: "sent" };
		},
	};
}
