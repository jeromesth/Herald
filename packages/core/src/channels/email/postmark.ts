/**
 * Postmark email provider for Herald.
 */
import type { ChannelProvider, ChannelProviderMessage, ChannelProviderResult } from "../provider.js";

export interface PostmarkConfig {
	serverToken: string;
	from: string;
	/** Message stream ID. Defaults to "outbound". */
	messageStream?: string;
	/** Optional API endpoint override (for testing). */
	apiUrl?: string;
}

export function postmarkProvider(config: PostmarkConfig): ChannelProvider {
	const apiUrl = config.apiUrl ?? "https://api.postmarkapp.com/email";

	return {
		providerId: "postmark",
		channelType: "email",

		async send(message: ChannelProviderMessage): Promise<ChannelProviderResult> {
			const payload = {
				From: config.from,
				To: message.to,
				Subject: message.subject ?? "",
				HtmlBody: message.body,
				MessageStream: config.messageStream ?? "outbound",
			};

			const response = await fetch(apiUrl, {
				method: "POST",
				headers: {
					"X-Postmark-Server-Token": config.serverToken,
					"Content-Type": "application/json",
					Accept: "application/json",
				},
				body: JSON.stringify(payload),
			});

			if (!response.ok) {
				const errorBody = await response.text();
				return {
					messageId: "",
					status: "failed",
					error: `Postmark error ${response.status}: ${errorBody}`,
				};
			}

			const result = (await response.json()) as { MessageID: string };
			return { messageId: result.MessageID, status: "sent" };
		},
	};
}
