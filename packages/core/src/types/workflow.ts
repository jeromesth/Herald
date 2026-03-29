import type { z } from "zod";

/**
 * Notification channel types supported by Herald.
 */
export type ChannelType = "in_app" | "email" | "sms" | "push" | "chat" | "webhook";

/**
 * Message delivery status — tracks the lifecycle of a sent message.
 */
export type DeliveryStatus = "queued" | "sent" | "delivered" | "bounced" | "failed";

/**
 * Step types within a notification workflow.
 */
export type StepType = ChannelType | "delay" | "digest" | "branch" | "throttle" | "fetch";

/**
 * Delay step configuration.
 */
export interface DelayConfig {
	amount: number;
	unit: "seconds" | "minutes" | "hours" | "days";
}

/**
 * Digest/batch step configuration.
 */
export interface DigestConfig {
	window: number;
	unit: "seconds" | "minutes" | "hours";
	key?: string;
}

/**
 * Throttle step configuration.
 */
export interface ThrottleConfig {
	key: string;
	limit: number;
	window: number;
	unit: "seconds" | "minutes" | "hours";
}

/**
 * Throttle step result.
 */
export interface ThrottleResult {
	throttled: boolean;
	count: number;
	limit: number;
}

/**
 * Fetch step configuration.
 */
export interface FetchConfig {
	url: string;
	method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
	headers?: Record<string, string>;
	body?: unknown;
	timeout?: number;
}

/**
 * Fetch step result.
 */
export interface FetchResult {
	status: number;
	data: unknown;
	headers: Record<string, string>;
}

/**
 * A regular (non-branch) workflow step with a handler.
 */
export interface ActionStep {
	stepId: string;
	type: Exclude<StepType, "branch">;
	handler: (context: StepContext) => Promise<StepResult>;
	conditions?: StepCondition[];
	conditionMode?: "all" | "any";
}

/**
 * A conditional branch within a branch step.
 */
export interface BranchDefinition {
	key: string;
	conditions: StepCondition[];
	conditionMode?: "all" | "any";
	steps: WorkflowStep[];
}

/**
 * A branch step — declarative conditional routing within workflows.
 * The engine evaluates each branch's conditions in order and executes
 * the first matching branch's steps. No handler — branching is an
 * engine primitive, not user-land code.
 */
export interface BranchStep {
	stepId: string;
	type: "branch";
	branches: BranchDefinition[];
	defaultBranch?: string;
}

/**
 * A single step in a notification workflow.
 * Either an action step (with handler) or a branch step (declarative routing).
 */
export type WorkflowStep = ActionStep | BranchStep;

/**
 * Context passed to step handler functions.
 */
export interface StepContext {
	subscriber: SubscriberData;
	payload: Record<string, unknown>;
	step: {
		delay: (config: DelayConfig) => Promise<void>;
		digest: (config: DigestConfig) => Promise<DigestedEvent[]>;
		throttle: (config: ThrottleConfig) => Promise<ThrottleResult>;
		fetch: (config: FetchConfig) => Promise<FetchResult>;
	};
}

/**
 * Result returned from a step handler.
 */
export interface StepResult {
	subject?: string;
	body?: string;
	data?: Record<string, unknown>;
	actionUrl?: string;
	avatar?: string;
	/** Internal control-flow metadata for adapters. Not user-facing. */
	_internal?: {
		throttled?: boolean;
		fetchResult?: unknown;
	};
}

/**
 * A digested event entry.
 */
export interface DigestedEvent {
	payload: Record<string, unknown>;
	timestamp: Date;
}

/**
 * Condition to evaluate before executing a step.
 */
export interface StepCondition {
	field: string;
	operator: "eq" | "ne" | "gt" | "lt" | "in" | "not_in" | "exists";
	value: unknown;
}

/**
 * Subscriber data available in workflow context.
 */
export interface SubscriberData {
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
}

/**
 * Full notification workflow definition.
 */
export interface NotificationWorkflow<TPayload extends z.ZodType = z.ZodType> {
	id: string;
	name: string;
	description?: string;
	tags?: string[];
	critical?: boolean;
	purpose?: string;
	payloadSchema?: TPayload;
	preferences?: WorkflowPreferences;
	steps: WorkflowStep[];
}

/**
 * Default channel preferences for a workflow.
 */
export interface WorkflowPreferences {
	channels?: Partial<Record<ChannelType, { enabled: boolean }>>;
}

/**
 * Workflow adapter interface — abstracts the underlying workflow engine
 * (Inngest, Temporal, Upstash Workflow, Trigger.dev, etc.)
 */
export interface WorkflowAdapter {
	/**
	 * Unique identifier for this adapter.
	 */
	readonly adapterId: string;

	/**
	 * Register a notification workflow with the underlying engine.
	 */
	registerWorkflow(workflow: NotificationWorkflow): void;

	/**
	 * Trigger a workflow execution for given recipients.
	 */
	trigger(args: TriggerArgs): Promise<TriggerResult>;

	/**
	 * Cancel an in-flight workflow execution.
	 */
	cancel(args: CancelArgs): Promise<void>;

	/**
	 * Get the HTTP handler for the workflow engine (e.g., Inngest serve handler).
	 * Returns null if the adapter doesn't need an HTTP endpoint.
	 */
	getHandler(): WorkflowHandler | null;
}

export interface TriggerArgs {
	workflowId: string;
	to: string | string[];
	payload: Record<string, unknown>;
	actor?: string;
	tenant?: string;
	transactionId?: string;
	overrides?: Record<string, unknown>;
}

export interface TriggerResult {
	transactionId: string;
	status: "triggered" | "queued";
}

export interface CancelArgs {
	workflowId: string;
	transactionId: string;
}

export type WorkflowHandler = {
	path: string;
	handler: (request: Request) => Promise<Response>;
};
