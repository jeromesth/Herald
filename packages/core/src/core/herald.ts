import type {
	Herald,
	HeraldAPI,
	HeraldContext,
	HeraldOptions,
	NotificationRecord,
	PreferenceRecord,
	SubscriberRecord,
} from "../types/config.js";
import { coreSchema, mergeSchemas } from "../db/schema.js";
import { createRouter } from "../api/router.js";
import { ChannelRegistry } from "../channels/provider.js";
import { InAppProvider } from "../channels/in-app.js";
import { SSEManager } from "../realtime/sse.js";
import { LayoutRegistry } from "../templates/layouts.js";
import { HandlebarsEngine } from "../templates/engine.js";
import type { TemplateEngine } from "../templates/types.js";
import { buildEmailProvider } from "./providers.js";
import { initializePlugins } from "./plugins.js";
import { wrapWorkflow } from "./workflow-runtime.js";
import { defaultPreferenceRecord } from "./preferences.js";
import { resolveSubscriberInternalId } from "./subscriber.js";
import { sendThroughProvider } from "./send.js";

/**
 * Create a Herald notification system instance.
 *
 * @example
 * ```ts
 * import { herald } from "@herald/core";
 * import { prismaAdapter } from "@herald/core/prisma";
 * import { inngestAdapter } from "@herald/core/inngest";
 *
 * const notifications = herald({
 *   database: prismaAdapter(prisma),
 *   workflow: inngestAdapter({ client: inngest }),
 *   workflows: [commentWorkflow, mentionWorkflow],
 *   channels: {
 *     email: { provider: "resend", from: "noreply@example.com", apiKey: "re_..." },
 *   },
 *   realtime: true,
 * });
 *
 * // Mount the HTTP handler
 * app.all("/api/notifications/*", notifications.handler);
 * ```
 */
export function herald(options: HeraldOptions): Herald {
	const generateId = options.advanced?.generateId ?? (() => crypto.randomUUID());

	// Set up channel registry
	const channels = new ChannelRegistry();

	// Set up SSE if enabled
	let sse: SSEManager | undefined;
	if (options.realtime) {
		const sseOpts = typeof options.realtime === "object" ? options.realtime : {};
		sse = new SSEManager(sseOpts);
	}

	// Register in-app provider (always available)
	const inAppEnabled = options.channels?.inApp?.enabled !== false;
	if (inAppEnabled) {
		channels.register(
			new InAppProvider({ db: options.database, generateId, sse }),
		);
	}

	// Register email provider from config
	if (options.channels?.email) {
		channels.register(buildEmailProvider(options.channels.email));
	}

	// Register custom providers
	if (options.providers) {
		for (const provider of options.providers) {
			channels.register(provider);
		}
	}

	// Set up template engine (pluggable, defaults to Handlebars)
	const templateEngine: TemplateEngine =
		options.templateEngine ?? new HandlebarsEngine(options.templateFilters);

	// Set up layout registry
	const layoutRegistry = new LayoutRegistry();
	if (options.layouts) {
		for (const layout of options.layouts) {
			layoutRegistry.register(layout);
		}
	}

	// Merge plugin schemas
	const pluginSchemas = options.plugins?.map((p) => p.schema);
	const fullSchema = mergeSchemas(coreSchema, ...(pluginSchemas ?? []));

	const ctx: HeraldContext = {
		options,
		db: options.database,
		workflow: options.workflow,
		generateId,
		channels,
		layouts: layoutRegistry,
		templateEngine,
		schema: fullSchema,
		transactionWorkflowMap: new Map<string, string>(),
		sse,
	};

	const pluginsReady = initializePlugins(ctx, options.plugins);

	// Register workflows with wrapped handlers that can execute channel delivery.
	if (options.workflows) {
		for (const workflow of options.workflows) {
			options.workflow.registerWorkflow(wrapWorkflow(workflow, ctx));
		}
	}

	const api = createAPI(ctx, pluginsReady);
	const router = createRouter(ctx, options.plugins, pluginsReady);
	const workflowHandlerInfo = options.workflow.getHandler();

	return {
		handler: router,
		api,
		workflow: workflowHandlerInfo,
		workflowHandler: workflowHandlerInfo ? workflowHandlerInfo.handler : null,
		$context: ctx,
	};
}

function createAPI(ctx: HeraldContext, pluginsReady: Promise<void>): HeraldAPI {
	const { db, workflow, generateId } = ctx;

	return {
		async trigger(args) {
			await pluginsReady;
			const transactionId = args.transactionId ?? generateId();
			ctx.transactionWorkflowMap.set(transactionId, args.workflowId);

			// Run beforeTrigger hooks
			if (ctx.options.plugins) {
				for (const plugin of ctx.options.plugins) {
					if (plugin.hooks?.beforeTrigger) {
						await plugin.hooks.beforeTrigger({
							workflowId: args.workflowId,
							to: args.to,
							payload: args.payload,
						});
					}
				}
			}

			await workflow.trigger({
				...args,
				transactionId,
			});

			// Run afterTrigger hooks
			if (ctx.options.plugins) {
				for (const plugin of ctx.options.plugins) {
					if (plugin.hooks?.afterTrigger) {
						await plugin.hooks.afterTrigger({
							workflowId: args.workflowId,
							transactionId,
						});
					}
				}
			}

			return { transactionId };
		},

		async upsertSubscriber(args) {
			await pluginsReady;
			const now = new Date();
			const existing = await db.findOne<SubscriberRecord>({
				model: "subscriber",
				where: [{ field: "externalId", value: args.externalId }],
			});

			if (existing) {
				const { externalId: _, ...updateFields } = args;
				await db.update({
					model: "subscriber",
					where: [{ field: "externalId", value: args.externalId }],
					update: { ...updateFields, updatedAt: now },
				});
				return { id: existing.id };
			}

			const id = generateId();
			await db.create({
				model: "subscriber",
				data: {
					id,
					...args,
					createdAt: now,
					updatedAt: now,
				},
			});
			return { id };
		},

		async getSubscriber(externalId) {
			await pluginsReady;
			return db.findOne<SubscriberRecord>({
				model: "subscriber",
				where: [{ field: "externalId", value: externalId }],
			});
		},

		async deleteSubscriber(externalId) {
			await pluginsReady;
			await db.delete({
				model: "subscriber",
				where: [{ field: "externalId", value: externalId }],
			});
		},

		async getNotifications(args) {
			await pluginsReady;
			const subscriberId = await resolveSubscriberInternalId(db, args.subscriberId) ?? args.subscriberId;

			const where: { field: string; value: unknown }[] = [
				{ field: "subscriberId", value: subscriberId },
			];

			if (args.read !== undefined) {
				where.push({ field: "read", value: args.read });
			}
			if (args.seen !== undefined) {
				where.push({ field: "seen", value: args.seen });
			}
			if (args.archived !== undefined) {
				where.push({ field: "archived", value: args.archived });
			}

			const [notifications, totalCount] = await Promise.all([
				db.findMany<NotificationRecord>({
					model: "notification",
					where,
					limit: args.limit ?? 20,
					offset: args.offset ?? 0,
					sortBy: { field: "createdAt", direction: "desc" },
				}),
				db.count({ model: "notification", where }),
			]);

			return { notifications, totalCount };
		},

		async markNotifications(args) {
			await pluginsReady;
			const now = new Date();
			const updates: Record<string, unknown> = {};

			switch (args.action) {
				case "read":
					updates.read = true;
					updates.readAt = now;
					break;
				case "seen":
					updates.seen = true;
					updates.seenAt = now;
					break;
				case "archived":
					updates.archived = true;
					updates.archivedAt = now;
					break;
			}

			for (const id of args.ids) {
				await db.update({
					model: "notification",
					where: [{ field: "id", value: id }],
					update: updates,
				});
			}
		},

		async getPreferences(subscriberId) {
			await pluginsReady;
			const internalSubscriberId = await resolveSubscriberInternalId(db, subscriberId) ?? subscriberId;

			const pref = await db.findOne<PreferenceRecord>({
				model: "preference",
				where: [{ field: "subscriberId", value: internalSubscriberId }],
			});

			return pref ?? defaultPreferenceRecord(ctx, internalSubscriberId);
		},

		async updatePreferences(subscriberId, preferences) {
			await pluginsReady;
			const internalSubscriberId = await resolveSubscriberInternalId(db, subscriberId) ?? subscriberId;
			const now = new Date();
			const existing = await db.findOne<PreferenceRecord>({
				model: "preference",
				where: [{ field: "subscriberId", value: internalSubscriberId }],
			});

			if (existing) {
				const merged: PreferenceRecord = {
					subscriberId: internalSubscriberId,
					channels: { ...existing.channels, ...preferences.channels },
					workflows: { ...existing.workflows, ...preferences.workflows },
					categories: { ...existing.categories, ...preferences.categories },
				};

				await db.update({
					model: "preference",
					where: [{ field: "subscriberId", value: internalSubscriberId }],
					update: { ...merged, updatedAt: now },
				});

				return merged;
			}

			const id = ctx.generateId();
			const defaults = defaultPreferenceRecord(ctx, internalSubscriberId);
			const newPref: PreferenceRecord = {
				subscriberId: internalSubscriberId,
				channels: { ...defaults.channels, ...preferences.channels },
				workflows: { ...defaults.workflows, ...preferences.workflows },
				categories: { ...defaults.categories, ...preferences.categories },
			};

			await db.create({
				model: "preference",
				data: { id, ...newPref, updatedAt: now },
			});

			return newPref;
		},

		async addToTopic(args) {
			await pluginsReady;
			const now = new Date();

			// Ensure topic exists
			let topic = await db.findOne({
				model: "topic",
				where: [{ field: "key", value: args.topicKey }],
			});

			if (!topic) {
				await db.create({
					model: "topic",
					data: {
						id: generateId(),
						key: args.topicKey,
						name: args.topicKey,
						createdAt: now,
						updatedAt: now,
					},
				});
				topic = await db.findOne({
					model: "topic",
					where: [{ field: "key", value: args.topicKey }],
				});
			}

			const topicRecord = topic as { id: string };

			for (const subscriberId of args.subscriberIds) {
				const existing = await db.findOne({
					model: "topicSubscriber",
					where: [
						{ field: "topicId", value: topicRecord.id },
						{ field: "subscriberId", value: subscriberId },
					],
				});

				if (!existing) {
					await db.create({
						model: "topicSubscriber",
						data: {
							id: generateId(),
							topicId: topicRecord.id,
							subscriberId,
							createdAt: now,
						},
					});
				}
			}
		},

		async removeFromTopic(args) {
			await pluginsReady;
			const topic = (await db.findOne({
				model: "topic",
				where: [{ field: "key", value: args.topicKey }],
			})) as { id: string } | null;

			if (!topic) return;

			for (const subscriberId of args.subscriberIds) {
				await db.delete({
					model: "topicSubscriber",
					where: [
						{ field: "topicId", value: topic.id },
						{ field: "subscriberId", value: subscriberId },
					],
				});
			}
		},

		async send(args) {
			await pluginsReady;
			const result = await sendThroughProvider(ctx, args);
			return { messageId: result.messageId, status: result.status };
		},

		renderTemplate(args) {
			return ctx.templateEngine.render(args.template, {
				subscriber: args.subscriber,
				payload: args.payload,
				app: { name: ctx.options.appName },
			});
		},
	};
}
