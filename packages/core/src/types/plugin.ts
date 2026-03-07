import type { HeraldContext } from "./config.js";
import type { HeraldPluginDBSchema } from "./schema.js";

/**
 * Herald plugin interface.
 * Follows better-auth's plugin architecture — plugins can extend
 * the schema, add endpoints, and hook into the lifecycle.
 */
export interface HeraldPlugin {
	/**
	 * Unique plugin identifier.
	 */
	id: string;

	/**
	 * Called during Herald initialization. Can extend the context or options.
	 */
	init?: (ctx: HeraldContext) => Promise<PluginInitResult | undefined> | PluginInitResult | undefined;

	/**
	 * REST API endpoints provided by this plugin.
	 */
	endpoints?: Record<string, PluginEndpoint>;

	/**
	 * Database schema extensions — add new tables or extend existing ones.
	 */
	schema?: HeraldPluginDBSchema;

	/**
	 * Lifecycle hooks for intercepting operations.
	 */
	hooks?: {
		beforeTrigger?: (args: {
			workflowId: string;
			to: string | string[];
			payload: Record<string, unknown>;
		}) => Promise<void>;

		afterTrigger?: (args: {
			workflowId: string;
			transactionId: string;
		}) => Promise<void>;

		beforeSend?: (args: {
			subscriberId: string;
			channel: string;
			content: Record<string, unknown>;
		}) => Promise<Record<string, unknown> | undefined>;

		afterSend?: (args: {
			subscriberId: string;
			channel: string;
			messageId: string;
			status: string;
		}) => Promise<void>;
	};
}

export interface PluginInitResult {
	context?: Record<string, unknown>;
}

export interface PluginEndpoint {
	method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
	path: string;
	handler: (request: Request, ctx: HeraldContext) => Promise<Response>;
}
