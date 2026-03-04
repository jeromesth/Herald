// Core
export { herald } from "./core/herald.js";

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
	ChannelConfig,
	EmailChannelConfig,
	InAppChannelConfig,
	SmsChannelConfig,
	PushChannelConfig,
	DefaultPreferences,
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
