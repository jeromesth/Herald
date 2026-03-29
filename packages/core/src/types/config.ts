import type { ChannelProvider, ChannelRegistry } from "../channels/provider.js";
import type { SSEManager } from "../realtime/sse.js";
import type { TemplateFilter } from "../templates/engine.js";
import type { EmailLayout, LayoutRegistry } from "../templates/layouts.js";
import type { TemplateEngine } from "../templates/types.js";
import type { DatabaseAdapter } from "./adapter.js";
import type { HeraldPlugin } from "./plugin.js";
import type { HeraldDBSchema } from "./schema.js";
import type { ChannelType, NotificationWorkflow, WorkflowAdapter } from "./workflow.js";
import type { WorkflowHandler } from "./workflow.js";

/**
 * The single, comprehensive configuration object for Herald.
 * Inspired by better-auth's `betterAuth()` options pattern.
 */
export interface HeraldOptions {
	/**
	 * Application name, used in notification templates.
	 */
	appName?: string;

	/**
	 * Base URL for API endpoints.
	 * @default "/api/notifications"
	 */
	basePath?: string;

	/**
	 * Database adapter — bring your own ORM.
	 * Use `herald/prisma`, `herald/drizzle`, etc.
	 */
	database: DatabaseAdapter;

	/**
	 * Workflow engine adapter — bring your own workflow system.
	 * Use `herald/inngest`, `herald/temporal`, etc.
	 */
	workflow: WorkflowAdapter;

	/**
	 * Notification workflows defined for this application.
	 */
	workflows?: NotificationWorkflow[];

	/**
	 * Channel configurations for delivery.
	 */
	channels?: ChannelConfig;

	/**
	 * Plugins to extend Herald functionality.
	 */
	plugins?: HeraldPlugin[];

	/**
	 * Default preferences for all subscribers.
	 */
	defaultPreferences?: DefaultPreferences;

	/**
	 * Operator-level preferences that can enforce or override subscriber settings.
	 */
	operatorPreferences?: OperatorPreferences;

	/**
	 * Subscriber configuration.
	 */
	subscriber?: {
		/** Additional custom fields to store on subscriber records. */
		additionalFields?: Record<string, { type: "string" | "number" | "boolean" | "json" }>;
	};

	/**
	 * Email layout configuration.
	 */
	layouts?: EmailLayout[];

	/**
	 * Custom template filters available in all templates.
	 * Only used by the built-in HandlebarsEngine.
	 */
	templateFilters?: Record<string, TemplateFilter>;

	/**
	 * Custom template engine. Defaults to the built-in HandlebarsEngine.
	 * Implement the `TemplateEngine` interface to use React Email, MJML, etc.
	 */
	templateEngine?: TemplateEngine;

	/**
	 * Enable real-time in-app notifications via SSE.
	 */
	realtime?: boolean | { heartbeatMs?: number };

	/**
	 * CORS configuration for API responses.
	 * Set to `true` to allow all origins, or provide specific options.
	 */
	cors?: boolean | CorsConfig;

	/**
	 * Custom channel providers (alternative to channels config).
	 * Directly provide ChannelProvider instances.
	 */
	providers?: ChannelProvider[];

	/**
	 * Advanced configuration options.
	 */
	advanced?: {
		/** Generate unique IDs. Defaults to crypto.randomUUID(). */
		generateId?: () => string;
	};
}

/**
 * CORS configuration for Herald API responses.
 */
export interface CorsConfig {
	/** Allowed origins. Use `"*"` for all origins. @default "*" */
	origin?: string | string[];
	/** Allowed HTTP methods. @default ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] */
	methods?: string[];
	/** Allowed headers. @default ["Content-Type", "Authorization"] */
	allowedHeaders?: string[];
	/** Max age for preflight cache in seconds. @default 86400 */
	maxAge?: number;
}

/**
 * Channel provider configuration.
 */
export interface ChannelConfig {
	email?: EmailChannelConfig;
	inApp?: InAppChannelConfig;
	sms?: SmsChannelConfig;
	push?: PushChannelConfig;
}

export interface EmailChannelConfig {
	provider: "sendgrid" | "resend" | "postmark" | "ses" | "custom";
	from: string;
	apiKey?: string;
	send?: (args: {
		to: string;
		subject: string;
		body: string;
		from: string;
	}) => Promise<void>;
}

export interface InAppChannelConfig {
	enabled?: boolean;
}

export interface SmsChannelConfig {
	provider: "twilio" | "vonage" | "custom";
	from: string;
	apiKey?: string;
	send?: (args: { to: string; body: string; from: string }) => Promise<void>;
}

export interface PushChannelConfig {
	provider: "fcm" | "apns" | "expo" | "custom";
	credentials?: Record<string, unknown>;
	send?: (args: {
		token: string;
		title: string;
		body: string;
		data?: Record<string, unknown>;
	}) => Promise<void>;
}

/**
 * Default notification preferences.
 */
export interface DefaultPreferences {
	channels?: Partial<Record<ChannelType, boolean>>;
	workflows?: Partial<Record<string, WorkflowChannelPreference>>;
	categories?: Partial<Record<string, CategoryPreference>>;
	purposes?: Partial<Record<string, boolean>>;
}

/**
 * Category preference with optional per-channel granularity.
 */
export interface CategoryPreference {
	enabled: boolean;
	channels?: Partial<Record<ChannelType, boolean>>;
}

/**
 * Preference condition for dynamic evaluation based on subscriber/payload data.
 * Type alias for the shared Condition interface in conditions.ts.
 */
export type PreferenceCondition = import("../core/conditions.js").Condition;

/**
 * Operator-level preferences that can override subscriber preferences.
 *
 * When multiple `enforce: true` overrides conflict, evaluation priority is:
 * channel > workflow > category > purpose (broadest scope wins).
 */
export interface OperatorPreferences {
	channels?: Partial<Record<ChannelType, PreferenceOverride>>;
	workflows?: Partial<Record<string, PreferenceOverride>>;
	categories?: Partial<Record<string, PreferenceOverride>>;
	purposes?: Partial<Record<string, PreferenceOverride>>;
}

/**
 * A single preference override entry. When `enforce` is true, subscribers cannot override.
 */
export interface PreferenceOverride {
	enabled: boolean;
	enforce?: boolean;
}

/**
 * The internal Herald context, available to plugins and handlers.
 */
export interface HeraldContext {
	options: HeraldOptions;
	db: DatabaseAdapter;
	workflow: WorkflowAdapter;
	generateId: () => string;
	channels: ChannelRegistry;
	layouts: LayoutRegistry;
	templateEngine: TemplateEngine;
	schema: HeraldDBSchema;
	transactionWorkflowMap: Map<string, string>;
	throttleState: Map<string, { count: number; windowStart: number }>;
	sse?: SSEManager;
	/** Precomputed map of workflow ID → channels that are readOnly. Computed once at init. */
	readOnlyChannels: Record<string, Partial<Record<ChannelType, boolean>>>;
}

/**
 * The Herald instance returned from `herald()`.
 */
export interface Herald {
	/**
	 * HTTP handler for notification API endpoints.
	 * Mount this in your framework: `app.all("/api/notifications/*", herald.handler)`.
	 */
	handler: (request: Request) => Promise<Response>;

	/**
	 * Programmatic API for server-side usage.
	 */
	api: HeraldAPI;

	/**
	 * Workflow handler info for framework mounting.
	 */
	workflow: WorkflowHandler | null;

	/**
	 * The underlying workflow handler, if the adapter requires one.
	 * @deprecated Use `workflow` instead.
	 */
	workflowHandler: ((request: Request) => Promise<Response>) | null;

	/**
	 * Raw context for advanced usage.
	 */
	$context: HeraldContext;
}

/**
 * Programmatic server-side API.
 */
export interface HeraldAPI {
	/** Trigger a notification workflow. */
	trigger: (args: {
		workflowId: string;
		to: string | string[];
		payload: Record<string, unknown>;
		actor?: string;
		tenant?: string;
		transactionId?: string;
	}) => Promise<{ transactionId: string }>;

	/** Create or update a subscriber. */
	upsertSubscriber: (args: {
		externalId: string;
		email?: string;
		phone?: string;
		firstName?: string;
		lastName?: string;
		avatar?: string;
		locale?: string;
		timezone?: string;
		data?: Record<string, unknown>;
		[key: string]: unknown;
	}) => Promise<{ id: string }>;

	/** Get a subscriber by external ID. */
	getSubscriber: (externalId: string) => Promise<SubscriberRecord | null>;

	/** Delete a subscriber. */
	deleteSubscriber: (externalId: string) => Promise<void>;

	/** List notifications for a subscriber (in-app inbox). */
	getNotifications: (args: {
		/** Subscriber external ID (preferred) or internal ID. */
		subscriberId: string;
		limit?: number;
		offset?: number;
		read?: boolean;
		seen?: boolean;
		archived?: boolean;
	}) => Promise<{ notifications: NotificationRecord[]; totalCount: number }>;

	/** Mark notifications as read/seen/archived. */
	markNotifications: (args: {
		ids: string[];
		action: "read" | "seen" | "archived";
	}) => Promise<void>;

	/** Get subscriber preferences. */
	getPreferences: (subscriberId: string) => Promise<PreferenceRecord>;

	/** Update subscriber preferences. */
	updatePreferences: (subscriberId: string, preferences: Partial<PreferenceRecord>) => Promise<PreferenceRecord>;

	/** Bulk update preferences for multiple subscribers (max 100). */
	bulkUpdatePreferences: (
		updates: Array<{ subscriberId: string; preferences: Partial<PreferenceRecord> }>,
	) => Promise<Array<{ subscriberId: string; preferences?: PreferenceRecord; error?: string }>>;

	/** Add subscribers to a topic. */
	addToTopic: (args: {
		topicKey: string;
		subscriberIds: string[];
	}) => Promise<void>;

	/** Remove subscribers from a topic. */
	removeFromTopic: (args: {
		topicKey: string;
		subscriberIds: string[];
	}) => Promise<void>;

	/** Send a notification directly through a channel provider. */
	send: (args: {
		channel: ChannelType;
		subscriberId: string;
		to: string;
		subject?: string;
		body: string;
		actionUrl?: string;
		layoutId?: string;
		data?: Record<string, unknown>;
	}) => Promise<{ messageId: string; status: string }>;

	/** Render a template with the given context. */
	renderTemplate: (args: {
		template: string;
		subscriber: Record<string, unknown>;
		payload: Record<string, unknown>;
	}) => string;
}

// ---- Record types for API responses ----

export interface SubscriberRecord {
	id: string;
	externalId: string;
	email?: string;
	phone?: string;
	firstName?: string;
	lastName?: string;
	avatar?: string;
	locale?: string;
	timezone?: string;
	data?: Record<string, unknown>;
	createdAt: Date;
	updatedAt: Date;
}

export interface NotificationRecord {
	id: string;
	subscriberId: string;
	workflowId: string;
	channel: string;
	subject?: string;
	body: string;
	actionUrl?: string;
	avatar?: string;
	data?: Record<string, unknown>;
	read: boolean;
	seen: boolean;
	archived: boolean;
	deliveryStatus: string;
	transactionId: string;
	createdAt: Date;
	readAt?: Date;
	seenAt?: Date;
	archivedAt?: Date;
}

/**
 * Per-workflow channel preference override.
 */
export interface WorkflowChannelPreference {
	enabled: boolean;
	channels?: Partial<Record<ChannelType, boolean>>;
	conditions?: PreferenceCondition[];
}

export interface PreferenceRecord {
	subscriberId: string;
	channels?: Partial<Record<ChannelType, boolean>>;
	workflows?: Partial<Record<string, WorkflowChannelPreference>>;
	categories?: Partial<Record<string, CategoryPreference>>;
	purposes?: Partial<Record<string, boolean>>;
}
