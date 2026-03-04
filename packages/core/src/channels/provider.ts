/**
 * Channel provider interface — standardized send() contract for all channels.
 * Each provider (SendGrid, Resend, etc.) implements this interface.
 */

export interface ChannelProviderMessage {
	/** Recipient subscriber ID. */
	subscriberId: string;
	/** Recipient email/phone/token depending on channel. */
	to: string;
	/** Rendered subject line. */
	subject?: string;
	/** Rendered body content (HTML for email, plain text for others). */
	body: string;
	/** Sender address (email from, SMS from number, etc.). */
	from?: string;
	/** Action URL for click-through. */
	actionUrl?: string;
	/** Avatar URL. */
	avatar?: string;
	/** Additional channel-specific data. */
	data?: Record<string, unknown>;
}

export interface ChannelProviderResult {
	/** Provider-assigned message ID. */
	messageId: string;
	/** Delivery status after send attempt. */
	status: "sent" | "queued" | "failed";
	/** Error details if status is "failed". */
	error?: string;
}

/**
 * A channel provider handles delivery for a specific channel type.
 */
export interface ChannelProvider {
	/** Unique provider identifier (e.g., "sendgrid", "resend"). */
	readonly providerId: string;
	/** Channel type this provider handles. */
	readonly channelType: "email" | "in_app" | "sms" | "push" | "chat" | "webhook";
	/** Send a message through this provider. */
	send(message: ChannelProviderMessage): Promise<ChannelProviderResult>;
}

/**
 * Registry that holds configured channel providers keyed by channel type.
 */
export class ChannelRegistry {
	private providers = new Map<string, ChannelProvider>();

	register(provider: ChannelProvider): void {
		this.providers.set(provider.channelType, provider);
	}

	get(channelType: string): ChannelProvider | undefined {
		return this.providers.get(channelType);
	}

	has(channelType: string): boolean {
		return this.providers.has(channelType);
	}

	all(): Map<string, ChannelProvider> {
		return new Map(this.providers);
	}
}
