/**
 * Build a ChannelProvider from the EmailChannelConfig shorthand.
 */
import type { EmailChannelConfig } from "../types/config.js";
import type { ChannelProvider, ChannelProviderMessage, ChannelProviderResult } from "../channels/provider.js";
import { sendgridProvider } from "../channels/email/sendgrid.js";
import { resendProvider } from "../channels/email/resend.js";
import { postmarkProvider } from "../channels/email/postmark.js";
import { sesProvider } from "../channels/email/ses.js";

export function buildEmailProvider(config: EmailChannelConfig): ChannelProvider | null {
	switch (config.provider) {
		case "sendgrid":
			return sendgridProvider({
				apiKey: config.apiKey!,
				from: config.from,
			});

		case "resend":
			return resendProvider({
				apiKey: config.apiKey!,
				from: config.from,
			});

		case "postmark":
			return postmarkProvider({
				serverToken: config.apiKey!,
				from: config.from,
			});

		case "ses":
			if (!config.send) {
				throw new Error("SES provider requires a custom send function");
			}
			return sesProvider({
				from: config.from,
				send: async ({ to, subject, html }) => {
					await config.send!({ to, subject, body: html, from: config.from });
					return crypto.randomUUID();
				},
			});

		case "custom":
			if (!config.send) {
				throw new Error("Custom email provider requires a send function");
			}
			return createCustomEmailProvider(config);

		default:
			return null;
	}
}

function createCustomEmailProvider(config: EmailChannelConfig): ChannelProvider {
	return {
		providerId: "custom",
		channelType: "email",
		async send(message: ChannelProviderMessage): Promise<ChannelProviderResult> {
			try {
				await config.send!({
					to: message.to,
					subject: message.subject ?? "",
					body: message.body,
					from: config.from,
				});
				return { messageId: crypto.randomUUID(), status: "sent" };
			} catch (err) {
				return {
					messageId: "",
					status: "failed",
					error: err instanceof Error ? err.message : "Send failed",
				};
			}
		},
	};
}
