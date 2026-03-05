export type {
	DatabaseAdapter,
	Where,
	WhereOperator,
	SortBy,
} from "./adapter.js";

export type {
	FieldType,
	FieldAttribute,
	ModelDefinition,
	HeraldDBSchema,
	HeraldPluginDBSchema,
} from "./schema.js";

export type {
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
} from "./workflow.js";

export type {
	HeraldPlugin,
	PluginEndpoint,
	PluginInitResult,
} from "./plugin.js";

export type {
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
} from "./config.js";

export type {
	ChannelProvider,
	ChannelProviderMessage,
	ChannelProviderResult,
} from "../channels/provider.js";

export type {
	TemplateFilter,
	TemplateContext,
} from "../templates/engine.js";

export type { TemplateEngine } from "../templates/types.js";

export type {
	EmailLayout,
	RenderedEmail,
} from "../templates/layouts.js";

export type { SSEEvent } from "../realtime/sse.js";
