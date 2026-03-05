import { postmarkProvider } from "../channels/email/postmark.js";
import { resendProvider } from "../channels/email/resend.js";
import { sendgridProvider } from "../channels/email/sendgrid.js";
import { sesProvider } from "../channels/email/ses.js";
import type {
	ChannelProvider,
	ChannelProviderMessage,
	ChannelProviderResult,
} from "../channels/provider.js";
/**
 * Build a ChannelProvider from the EmailChannelConfig shorthand.
 */
import type { EmailChannelConfig } from "../types/config.js";

function requireApiKey(config: EmailChannelConfig, providerName: string): string {
	if (!config.apiKey) {
		throw new Error(`${providerName} provider requires an apiKey`);
	}
	return config.apiKey;
}

export function buildEmailProvider(config: EmailChannelConfig): ChannelProvider {
	switch (config.provider) {
		case "sendgrid":
			return sendgridProvider({
				apiKey: requireApiKey(config, "SendGrid"),
				from: config.from,
			});

		case "resend":
			return resendProvider({
				apiKey: requireApiKey(config, "Resend"),
				from: config.from,
			});

		case "postmark":
			return postmarkProvider({
				serverToken: requireApiKey(config, "Postmark"),
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
			throw new Error(
				`Unknown email provider "${config.provider}". Supported providers: sendgrid, resend, postmark, ses, custom`,
			);
	}
}

function createCustomEmailProvider(config: EmailChannelConfig): ChannelProvider {
	return {
		providerId: "custom",
		channelType: "email",
		async send(message: ChannelProviderMessage): Promise<ChannelProviderResult> {
			await config.send!({
				to: message.to,
				subject: message.subject ?? "",
				body: message.body,
				from: config.from,
			});
			return { messageId: crypto.randomUUID(), status: "sent" };
		},
	};
}
