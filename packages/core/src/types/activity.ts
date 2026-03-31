import type { ChannelType } from "./workflow.js";

/**
 * Activity event types representing notification lifecycle stages.
 *
 * Naming convention: `object.action` where:
 * - **object** is a first-class Herald domain entity (workflow, workflow.step, notification)
 * - **action** is past tense describing what happened
 *
 * | Event                         | When it fires                                          |
 * |-------------------------------|--------------------------------------------------------|
 * | workflow.triggered            | Workflow trigger API is called                         |
 * | workflow.dispatched           | Workflow handed off to the workflow engine              |
 * | workflow.step.started         | A workflow step begins execution                       |
 * | workflow.step.completed       | A workflow step finishes execution                     |
 * | notification.queued           | Notification enters the send pipeline (pre-provider)   |
 * | notification.sent             | Provider successfully accepted the notification        |
 * | notification.delivered        | External confirmation of delivery (via status update)  |
 * | notification.failed           | Provider returned a failure                            |
 * | notification.bounced          | Delivery bounced (via status update)                   |
 * | notification.blocked          | Preference gate blocked delivery to subscriber         |
 * | notification.status_changed   | Delivery status updated via API                        |
 */
export const ACTIVITY_EVENT_TYPES = [
	"workflow.triggered",
	"workflow.dispatched",
	"workflow.step.started",
	"workflow.step.completed",
	"notification.queued",
	"notification.sent",
	"notification.delivered",
	"notification.failed",
	"notification.bounced",
	"notification.blocked",
	"notification.status_changed",
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
