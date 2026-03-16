import type { HeraldContext } from "../../types/config.js";
import type { HeraldPlugin } from "../../types/plugin.js";
import { jsonResponse, parseJsonBody } from "../router.js";

type PluginHooks = NonNullable<HeraldPlugin["hooks"]>;
type HookArgs<K extends keyof PluginHooks> = PluginHooks[K] extends ((a: infer A) => unknown) | undefined ? A : never;

/**
 * Run a named plugin hook across all configured plugins.
 * `beforeTrigger` hooks throw on failure (caller decides whether to abort).
 * `afterTrigger` hooks are fire-and-forget — errors are logged but never propagate.
 */
async function runPluginHook<K extends "beforeTrigger" | "afterTrigger">(
	plugins: HeraldPlugin[] | undefined,
	hookName: K,
	args: HookArgs<K>,
): Promise<void> {
	if (!plugins) return;
	for (const plugin of plugins) {
		const hookFn = plugin.hooks?.[hookName] as ((a: typeof args) => Promise<void>) | undefined;
		if (!hookFn) continue;

		if (hookName === "afterTrigger") {
			try {
				await hookFn(args);
			} catch (hookError) {
				console.error(`[herald] Plugin "${plugin.id}" ${hookName} hook threw:`, hookError);
			}
		} else {
			await hookFn(args);
		}
	}
}

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

			if (!body.workflowId || typeof body.workflowId !== "string") {
				return jsonResponse({ error: "workflowId is required and must be a string" }, 400);
			}
			if (!body.to) {
				return jsonResponse({ error: "to is required" }, 400);
			}
			if (typeof body.to !== "string" && !Array.isArray(body.to)) {
				return jsonResponse({ error: "to must be a string or array of strings" }, 400);
			}
			if (Array.isArray(body.to) && !body.to.every((item) => typeof item === "string")) {
				return jsonResponse({ error: "to must be a string or array of strings" }, 400);
			}

			const transactionId = body.transactionId ?? ctx.generateId();
			ctx.transactionWorkflowMap.set(transactionId, body.workflowId);

			try {
				await runPluginHook(ctx.options.plugins, "beforeTrigger", {
					workflowId: body.workflowId,
					to: body.to,
					payload: body.payload ?? {},
				});

				await ctx.workflow.trigger({
					workflowId: body.workflowId,
					to: body.to,
					payload: body.payload ?? {},
					actor: body.actor,
					tenant: body.tenant,
					transactionId,
				});

				await runPluginHook(ctx.options.plugins, "afterTrigger", {
					workflowId: body.workflowId,
					transactionId,
				});

				return jsonResponse({ transactionId, status: "triggered" });
			} finally {
				// Clean up transaction map after trigger completes (memory adapter
				// executes synchronously, so the workflow is done at this point).
				// For async adapters like Inngest, the cancel endpoint also accepts
				// workflowId as a query param, so the map entry is not required.
				ctx.transactionWorkflowMap.delete(transactionId);
			}
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

			if (!Array.isArray(body.events) || body.events.length === 0) {
				return jsonResponse({ error: "events must be a non-empty array" }, 400);
			}

			const settled = await Promise.allSettled(
				body.events.map(async (event) => {
					const transactionId = ctx.generateId();
					ctx.transactionWorkflowMap.set(transactionId, event.workflowId);

					try {
						await runPluginHook(ctx.options.plugins, "beforeTrigger", {
							workflowId: event.workflowId,
							to: event.to,
							payload: event.payload ?? {},
						});

						await ctx.workflow.trigger({
							workflowId: event.workflowId,
							to: event.to,
							payload: event.payload ?? {},
							actor: event.actor,
							tenant: event.tenant,
							transactionId,
						});

						await runPluginHook(ctx.options.plugins, "afterTrigger", {
							workflowId: event.workflowId,
							transactionId,
						});

						return { transactionId, workflowId: event.workflowId, status: "triggered" as const };
					} finally {
						ctx.transactionWorkflowMap.delete(transactionId);
					}
				}),
			);

			const results = settled.map((result, index) => {
				if (result.status === "fulfilled") return result.value;
				return {
					workflowId: body.events[index]?.workflowId,
					status: "failed" as const,
					error: result.reason instanceof Error ? result.reason.message : "Unknown error",
				};
			});

			return jsonResponse({ results });
		},
	},
	{
		method: "DELETE",
		pattern: "/trigger/:transactionId",
		handler: async (request: Request, ctx: HeraldContext, params: Record<string, string>) => {
			const transactionId = params.transactionId;
			if (!transactionId) {
				return jsonResponse({ error: "transactionId is required" }, 400);
			}

			const url = new URL(request.url);
			const workflowIdFromQuery = url.searchParams.get("workflowId");
			const workflowIdFromMemory = ctx.transactionWorkflowMap.get(transactionId);

			let workflowId = workflowIdFromQuery ?? workflowIdFromMemory;
			if (!workflowId) {
				// Fallback to persisted notifications for transactions created by older versions.
				const notifications = await ctx.db.findMany<{ workflowId: string }>({
					model: "notification",
					where: [{ field: "transactionId", value: transactionId }],
					limit: 1,
				});
				workflowId = notifications[0]?.workflowId;
			}

			if (!workflowId) {
				return jsonResponse(
					{
						error: "Could not resolve workflowId for this transaction. Provide workflowId as a query parameter.",
					},
					404,
				);
			}

			await ctx.workflow.cancel({
				workflowId,
				transactionId,
			});
			ctx.transactionWorkflowMap.delete(transactionId);

			return jsonResponse({ status: "cancelled" });
		},
	},
];
