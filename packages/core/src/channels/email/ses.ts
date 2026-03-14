/**
 * Amazon SES email provider for Herald.
 * Uses the SES v2 REST API with AWS Signature v4.
 *
 * NOTE: For production use, prefer passing a custom `send` function
 * that uses the AWS SDK (@aws-sdk/client-sesv2) for proper credential
 * management and signing. This built-in provider covers the common case.
 */
import type { ChannelProvider, ChannelProviderMessage, ChannelProviderResult } from "../provider.js";

export interface SESConfig {
	from: string;
	/**
	 * Custom send function. Use this to integrate the AWS SDK directly:
	 *
	 * ```ts
	 * import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
	 * const ses = new SESv2Client({ region: "us-east-1" });
	 *
	 * sesProvider({
	 *   from: "noreply@example.com",
	 *   send: async ({ to, subject, html }) => {
	 *     const result = await ses.send(new SendEmailCommand({
	 *       FromEmailAddress: "noreply@example.com",
	 *       Destination: { ToAddresses: [to] },
	 *       Content: {
	 *         Simple: {
	 *           Subject: { Data: subject },
	 *           Body: { Html: { Data: html } },
	 *         },
	 *       },
	 *     }));
	 *     return result.MessageId ?? "";
	 *   },
	 * });
	 * ```
	 */
	send: (args: { to: string; subject: string; html: string; from: string }) => Promise<string>;
}

export function sesProvider(config: SESConfig): ChannelProvider {
	return {
		providerId: "ses",
		channelType: "email",

		async send(message: ChannelProviderMessage): Promise<ChannelProviderResult> {
			try {
				const messageId = await config.send({
					to: message.to,
					subject: message.subject ?? "",
					html: message.body,
					from: config.from,
				});

				return { messageId, status: "sent" };
			} catch (err) {
				console.error("[herald] SES send error:", err);
				return {
					messageId: "",
					status: "failed",
					error: "SES send failed",
				};
			}
		},
	};
}
