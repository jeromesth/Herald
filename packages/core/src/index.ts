// Core
export { herald } from "./core/herald.js";
export { preferenceGate, deepMerge } from "./core/preferences.js";

// Errors
export {
	HeraldError,
	HeraldConfigError,
	HeraldNotFoundError,
	HeraldValidationError,
	HeraldProviderError,
	HeraldPluginError,
} from "./errors.js";
export type { WorkflowMeta, PreferenceGateResult, ConditionContext, PreferenceGateInput } from "./core/preferences.js";
export { conditionsPass, evaluateCondition, resolvePath } from "./core/conditions.js";
export type { Condition } from "./core/conditions.js";

// Schema
export { coreSchema, mergeSchemas } from "./db/schema.js";

// Testing / local development adapters
export { memoryAdapter, memoryWorkflowAdapter } from "./adapters/memory.js";

// Channels
export { ChannelRegistry } from "./channels/provider.js";
export { InAppProvider } from "./channels/in-app.js";

// Templates
export { renderTemplate, compileTemplate, HandlebarsEngine } from "./templates/engine.js";
export { renderEmail, defaultEmailLayout, LayoutRegistry } from "./templates/layouts.js";

// Real-time
export { SSEManager } from "./realtime/sse.js";

// Types — re-export everything
export type {
	// Adapter types
	DatabaseAdapter,
	Where,
	WhereOperator,
	SortBy,
	// Schema types
	FieldType,
	FieldAttribute,
	ModelDefinition,
	HeraldDBSchema,
	HeraldPluginDBSchema,
	// Workflow types
	ChannelType,
	DeliveryStatus,
	StepType,
	DelayConfig,
	DigestConfig,
	ThrottleConfig,
	ThrottleResult,
	FetchConfig,
	FetchResult,
	ActionStep,
	BranchStep,
	BranchDefinition,
	WorkflowStep,
	StepContext,
	StepResult,
	DigestedEvent,
	StepCondition,
	SubscriberData,
	NotificationWorkflow,
	WorkflowPreferences,
	WorkflowAdapter,
	TriggerArgs,
	TriggerResult,
	CancelArgs,
	WorkflowHandler,
	// Plugin types
	HeraldPlugin,
	PluginEndpoint,
	PluginInitResult,
	// Config types
	HeraldOptions,
	HeraldContext,
	Herald,
	HeraldAPI,
	CorsConfig,
	ChannelConfig,
	EmailChannelConfig,
	InAppChannelConfig,
	SmsChannelConfig,
	PushChannelConfig,
	DefaultPreferences,
	WorkflowChannelPreference,
	CategoryPreference,
	PreferenceCondition,
	OperatorPreferences,
	PreferenceOverride,
	SubscriberRecord,
	NotificationRecord,
	PreferenceRecord,
	// Channel provider types
	ChannelProvider,
	ChannelProviderMessage,
	ChannelProviderResult,
	// Template types
	TemplateEngine,
	TemplateFilter,
	TemplateContext,
	// Email layout types
	EmailLayout,
	RenderedEmail,
	// Real-time types
	SSEEvent,
} from "./types/index.js";
