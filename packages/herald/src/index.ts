// Core
export { herald } from "./core/herald.js";

// Schema
export { coreSchema, mergeSchemas } from "./db/schema.js";

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
} from "./types/index.js";
