import type { ChannelType } from "./workflow.js";

/**
 * Activity event types representing notification lifecycle stages.
 */
export const ACTIVITY_EVENT_TYPES = [
	"workflow.triggered",
	"workflow.completed",
	"workflow.step.started",
	"workflow.step.completed",
	"notification.sending",
	"notification.sent",
	"notification.delivered",
	"notification.failed",
	"notification.bounced",
	"preference.blocked",
	"delivery.status_changed",
] as const;

export type ActivityEventType = (typeof ACTIVITY_EVENT_TYPES)[number];

/**
 * Activity log record stored in the database.
 */
export interface ActivityLogRecord {
	id: string;
	transactionId?: string;
	workflowId?: string;
	subscriberId?: string;
	channel?: ChannelType;
	stepId?: string;
	event: ActivityEventType;
	detail?: Record<string, unknown>;
	createdAt: Date;
}

/**
 * Input for recording an activity event (id and createdAt are generated).
 */
export interface ActivityEventInput {
	transactionId?: string;
	workflowId?: string;
	subscriberId?: string;
	channel?: ChannelType;
	stepId?: string;
	event: ActivityEventType;
	detail?: Record<string, unknown>;
}

/**
 * Webhook endpoint configuration.
 */
export interface WebhookConfig {
	/** URL to send webhook events to. */
	url: string;
	/** Secret for HMAC-SHA256 signature verification. */
	secret?: string;
	/** Filter to specific event types. If omitted, all events are sent. */
	events?: ActivityEventType[];
	/** Custom headers to include in webhook requests. */
	headers?: Record<string, string>;
}

/**
 * Webhook event payload sent to configured endpoints.
 */
export interface WebhookEventPayload {
	id: string;
	event: ActivityEventType;
	timestamp: string;
	data: {
		transactionId?: string;
		workflowId?: string;
		subscriberId?: string;
		channel?: ChannelType;
		stepId?: string;
		detail?: Record<string, unknown>;
	};
}
