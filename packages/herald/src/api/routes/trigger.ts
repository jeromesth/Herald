import type { HeraldContext } from "../../types/config.js";
import { jsonResponse, parseJsonBody } from "../router.js";

export const triggerRoutes = [
	{
		method: "POST",
		pattern: "/trigger",
		handler: async (request: Request, ctx: HeraldContext) => {
			const body = await parseJsonBody<{
				workflowId: string;
				to: string | string[];
				payload?: Record<string, unknown>;
				actor?: string;
				tenant?: string;
				transactionId?: string;
			}>(request);

			if (!body.workflowId) {
				return jsonResponse({ error: "workflowId is required" }, 400);
			}
			if (!body.to) {
				return jsonResponse({ error: "to is required" }, 400);
			}

			const transactionId = body.transactionId ?? ctx.generateId();

			// Run plugin beforeTrigger hooks
			if (ctx.options.plugins) {
				for (const plugin of ctx.options.plugins) {
					if (plugin.hooks?.beforeTrigger) {
						await plugin.hooks.beforeTrigger({
							workflowId: body.workflowId,
							to: body.to,
							payload: body.payload ?? {},
						});
					}
				}
			}

			await ctx.workflow.trigger({
				workflowId: body.workflowId,
				to: body.to,
				payload: body.payload ?? {},
				actor: body.actor,
				tenant: body.tenant,
				transactionId,
			});

			// Run plugin afterTrigger hooks
			if (ctx.options.plugins) {
				for (const plugin of ctx.options.plugins) {
					if (plugin.hooks?.afterTrigger) {
						await plugin.hooks.afterTrigger({
							workflowId: body.workflowId,
							transactionId,
						});
					}
				}
			}

			return jsonResponse({ transactionId, status: "triggered" });
		},
	},
	{
		method: "POST",
		pattern: "/trigger/bulk",
		handler: async (request: Request, ctx: HeraldContext) => {
			const body = await parseJsonBody<{
				events: Array<{
					workflowId: string;
					to: string | string[];
					payload?: Record<string, unknown>;
					actor?: string;
					tenant?: string;
				}>;
			}>(request);

			if (!body.events?.length) {
				return jsonResponse({ error: "events array is required" }, 400);
			}

			const results = await Promise.all(
				body.events.map(async (event) => {
					const transactionId = ctx.generateId();
					await ctx.workflow.trigger({
						workflowId: event.workflowId,
						to: event.to,
						payload: event.payload ?? {},
						actor: event.actor,
						tenant: event.tenant,
						transactionId,
					});
					return { transactionId, workflowId: event.workflowId, status: "triggered" as const };
				}),
			);

			return jsonResponse({ results });
		},
	},
	{
		method: "DELETE",
		pattern: "/trigger/:transactionId",
		handler: async (
			_request: Request,
			ctx: HeraldContext,
			params: Record<string, string>,
		) => {
			const transactionId = params.transactionId;
			if (!transactionId) {
				return jsonResponse({ error: "transactionId is required" }, 400);
			}

			// Find associated notifications to determine the workflow
			const notifications = await ctx.db.findMany<{ workflowId: string }>({
				model: "notification",
				where: [{ field: "transactionId", value: transactionId }],
				limit: 1,
			});

			if (notifications.length > 0 && notifications[0]) {
				await ctx.workflow.cancel({
					workflowId: notifications[0].workflowId,
					transactionId,
				});
			}

			return jsonResponse({ status: "cancelled" });
		},
	},
];
