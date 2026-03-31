import { createRouter } from "../api/router.js";
import { InAppProvider } from "../channels/in-app.js";
import { ChannelRegistry } from "../channels/provider.js";
import { coreSchema, mergeSchemas } from "../db/schema.js";
import { SSEManager } from "../realtime/sse.js";
import { HandlebarsEngine } from "../templates/engine.js";
import { LayoutRegistry } from "../templates/layouts.js";
import type { TemplateEngine } from "../templates/types.js";
import type {
	Herald,
	HeraldAPI,
	HeraldContext,
	HeraldOptions,
	NotificationRecord,
	PreferenceRecord,
	SubscriberRecord,
} from "../types/config.js";
import { queryActivityLog } from "./activity.js";
import { emitEvent } from "./emit-event.js";
import { initializePlugins } from "./plugins.js";
import {
	buildReadOnlyChannels,
	bulkUpdatePreferencesInternal,
	defaultPreferenceRecord,
	normalizePreferenceRecord,
	stripReadOnlyOverrides,
	upsertPreferenceInternal,
} from "./preferences.js";
import { buildEmailProvider } from "./providers.js";
import { sendThroughProvider } from "./send.js";
import { resolveSubscriberInternalId } from "./subscriber.js";
import { wrapWorkflow } from "./workflow-runtime.js";

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
		channels.register(new InAppProvider({ db: options.database, generateId, sse }));
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
	const templateEngine: TemplateEngine = options.templateEngine ?? new HandlebarsEngine(options.templateFilters);

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
		throttleState: new Map(),
		sse,
		readOnlyChannels: buildReadOnlyChannels(options.workflows),
		activityLog: options.activityLog === true,
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

			try {
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

				await emitEvent(ctx, {
					event: "workflow.triggered",
					workflowId: args.workflowId,
					transactionId,
					detail: { to: args.to },
				});

				await workflow.trigger({
					...args,
					transactionId,
				});

				void emitEvent(ctx, {
					event: "workflow.completed",
					workflowId: args.workflowId,
					transactionId,
				});

				// Run afterTrigger hooks — errors are logged but do not propagate since trigger already succeeded
				if (ctx.options.plugins) {
					for (const plugin of ctx.options.plugins) {
						if (plugin.hooks?.afterTrigger) {
							try {
								await plugin.hooks.afterTrigger({
									workflowId: args.workflowId,
									transactionId,
								});
							} catch (hookError) {
								console.error(`[herald] Plugin "${plugin.id}" afterTrigger hook threw:`, hookError);
							}
						}
					}
				}
			} finally {
				ctx.transactionWorkflowMap.delete(transactionId);
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
			const subscriberId = (await resolveSubscriberInternalId(db, args.subscriberId)) ?? args.subscriberId;

			const where: { field: string; value: unknown }[] = [{ field: "subscriberId", value: subscriberId }];

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
			const internalSubscriberId = (await resolveSubscriberInternalId(db, subscriberId)) ?? subscriberId;

			const pref = await db.findOne<PreferenceRecord>({
				model: "preference",
				where: [{ field: "subscriberId", value: internalSubscriberId }],
			});

			return pref ? normalizePreferenceRecord(pref) : defaultPreferenceRecord(ctx, internalSubscriberId);
		},

		async updatePreferences(subscriberId, rawPreferences) {
			await pluginsReady;
			const preferences = stripReadOnlyOverrides(rawPreferences, ctx.readOnlyChannels);
			const internalSubscriberId = (await resolveSubscriberInternalId(db, subscriberId)) ?? subscriberId;
			const { record } = await upsertPreferenceInternal(db, ctx, generateId, internalSubscriberId, preferences);
			return record;
		},

		async bulkUpdatePreferences(updates) {
			await pluginsReady;
			return bulkUpdatePreferencesInternal(db, ctx, generateId, updates);
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

		async getActivityLog(args) {
			await pluginsReady;
			return queryActivityLog(ctx, args);
		},

		async updateDeliveryStatus(args) {
			await pluginsReady;
			const notification = await db.findOne<NotificationRecord>({
				model: "notification",
				where: [{ field: "id", value: args.notificationId }],
			});

			if (!notification) {
				throw new (await import("../errors.js")).HeraldNotFoundError("notification", `Notification "${args.notificationId}" not found`);
			}

			await db.update({
				model: "notification",
				where: [{ field: "id", value: args.notificationId }],
				update: { deliveryStatus: args.status },
			});

			await emitEvent(ctx, {
				event: "delivery.status_changed",
				workflowId: notification.workflowId,
				subscriberId: notification.subscriberId,
				transactionId: notification.transactionId,
				channel: notification.channel as import("../types/workflow.js").ChannelType,
				detail: {
					notificationId: args.notificationId,
					previousStatus: notification.deliveryStatus,
					newStatus: args.status,
					...args.detail,
				},
			});
		},
	};
}
