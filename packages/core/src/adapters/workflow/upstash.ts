/**
 * Upstash Workflow adapter for Herald.
 *
 * Translates Herald notification workflows into Upstash Workflow functions
 * backed by QStash for durable, serverless step execution.
 *
 * @example
 * ```ts
 * import { upstashWorkflowAdapter } from "@herald/core/upstash";
 *
 * const workflow = upstashWorkflowAdapter({
 *   token: process.env.QSTASH_TOKEN,
 *   url: process.env.QSTASH_URL,
 * });
 * ```
 */
import { isBranchStep, resolveBranch } from "../../core/workflow-runtime.js";
import type {
	ActionStep,
	CancelArgs,
	NotificationWorkflow,
	StepContext,
	TriggerArgs,
	TriggerResult,
	WorkflowAdapter,
	WorkflowHandler,
	WorkflowStep,
} from "../../types/workflow.js";

export interface UpstashWorkflowConfig {
	/** QStash URL. @default "https://qstash.upstash.io" */
	url?: string;
	/** QStash token. */
	token?: string;
	/** Path where the Upstash serve endpoint is mounted. @default "/api/herald" */
	servePath?: string;
	/** Number of retries per step. @default 3 */
	retries?: number;
}

interface UpstashContextLike {
	run: <T>(stepId: string, fn: () => Promise<T>) => Promise<T>;
	sleep: (stepId: string, seconds: number) => Promise<void>;
	call: <T>(
		stepId: string,
		config: {
			url: string;
			method?: string;
			body?: unknown;
			headers?: Record<string, string>;
		},
	) => Promise<T>;
}

type WorkflowEntry = {
	workflow: NotificationWorkflow;
	execute: (context: UpstashContextLike, data: Record<string, unknown>) => Promise<unknown>;
};

export function upstashWorkflowAdapter(config: UpstashWorkflowConfig): WorkflowAdapter {
	const { url = "https://qstash.upstash.io", token = "", servePath = "/api/herald", retries = 3 } = config;

	const registeredWorkflows = new Map<string, WorkflowEntry>();

	return {
		adapterId: "upstash",

		registerWorkflow(workflow: NotificationWorkflow): void {
			const execute = async (context: UpstashContextLike, data: Record<string, unknown>) => {
				const payload = (data.payload ?? {}) as Record<string, unknown>;
				const recipients = data.recipients as string[];
				const handlerPayload = { ...payload };

				for (const subscriberId of recipients) {
					const stepQueue: WorkflowStep[] = [...workflow.steps];

					while (stepQueue.length > 0) {
						const workflowStep = stepQueue.shift();
						if (!workflowStep) break;
						const subscriberCtx = { id: subscriberId, externalId: subscriberId };
						const noopStep = {
							delay: async () => {},
							digest: async () => [] as { payload: Record<string, unknown>; timestamp: Date }[],
							throttle: async (c: { limit: number }) => ({
								throttled: false as boolean,
								count: 0,
								limit: c.limit,
							}),
							fetch: async () => ({
								status: 200 as number,
								data: null as unknown,
								headers: {} as Record<string, string>,
							}),
						};

						// Handle branch steps — resolve and splice into queue
						if (isBranchStep(workflowStep)) {
							const branchCtx: StepContext = {
								subscriber: subscriberCtx,
								payload: handlerPayload,
								step: noopStep,
							};
							const branchSteps = resolveBranch(workflowStep, branchCtx);
							stepQueue.unshift(...branchSteps);
							continue;
						}

						const actionStep = workflowStep as ActionStep;

						if (actionStep.type === "delay") {
							const delayConfig = await context.run(`${actionStep.stepId}-config-${subscriberId}`, async () => {
								return actionStep.handler({
									subscriber: subscriberCtx,
									payload: handlerPayload,
									step: {
										...noopStep,
										delay: async (c) => c as unknown as undefined,
									},
								});
							});

							if (delayConfig?.data) {
								const d = delayConfig.data as { amount?: number; unit?: string };
								const unitToSeconds: Record<string, number> = {
									seconds: 1,
									minutes: 60,
									hours: 3600,
									days: 86400,
								};
								const seconds = (d.amount ?? 1) * (unitToSeconds[d.unit ?? "hours"] ?? 3600);
								await context.sleep(`${actionStep.stepId}-wait-${subscriberId}`, seconds);
							}
							continue;
						}

						if (actionStep.type === "fetch") {
							const result = await context.run(`${actionStep.stepId}-${subscriberId}`, async () => {
								return actionStep.handler({
									subscriber: subscriberCtx,
									payload: handlerPayload,
									step: noopStep,
								});
							});

							if (result?._internal?.fetchResult != null && typeof result._internal.fetchResult === "object") {
								Object.assign(handlerPayload, result._internal.fetchResult);
							}
							continue;
						}

						if (actionStep.type === "throttle") {
							const result = await context.run(`${actionStep.stepId}-${subscriberId}`, async () => {
								return actionStep.handler({
									subscriber: subscriberCtx,
									payload: handlerPayload,
									step: noopStep,
								});
							});

							if (result?._internal?.throttled) {
								return { status: "throttled", workflowId: workflow.id };
							}
							continue;
						}

						// Regular channel steps (in_app, email, sms, push, chat, webhook) and digest
						await context.run(`${actionStep.stepId}-${subscriberId}`, async () => {
							return actionStep.handler({
								subscriber: subscriberCtx,
								payload: handlerPayload,
								step: noopStep,
							});
						});
					}
				}

				return { status: "completed", workflowId: workflow.id };
			};

			registeredWorkflows.set(workflow.id, { workflow, execute });
		},

		async trigger(args: TriggerArgs): Promise<TriggerResult> {
			const transactionId = args.transactionId ?? crypto.randomUUID();
			const recipients = Array.isArray(args.to) ? args.to : [args.to];

			const body = JSON.stringify({
				workflowId: args.workflowId,
				recipients,
				payload: args.payload,
				actor: args.actor,
				tenant: args.tenant,
				transactionId,
				overrides: args.overrides,
			});

			await fetch(`${url}/v2/publish/${servePath}`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
					"Upstash-Retries": String(retries),
				},
				body,
			});

			return {
				transactionId,
				status: "triggered",
			};
		},

		async cancel(args: CancelArgs): Promise<void> {
			await fetch(`${url}/v2/cancel/${args.transactionId}`, {
				method: "DELETE",
				headers: {
					Authorization: `Bearer ${token}`,
				},
			});
		},

		getHandler(): WorkflowHandler | null {
			if (registeredWorkflows.size === 0) return null;

			return {
				path: servePath,
				handler: async (request: Request) => {
					try {
						const data = (await request.json()) as Record<string, unknown>;
						const workflowId = data.workflowId as string;

						const entry = registeredWorkflows.get(workflowId);
						if (!entry) {
							return new Response(JSON.stringify({ error: `Unknown workflow: ${workflowId}` }), {
								status: 404,
								headers: { "Content-Type": "application/json" },
							});
						}

						// In production, the Upstash SDK provides the context.
						// This handler is called by Upstash's infrastructure.
						// The context is extracted from the request by the Upstash serve() wrapper.
						// For direct use, callers should wrap this with @upstash/workflow's serve().
						return new Response(JSON.stringify({ status: "accepted", workflowId }), {
							status: 200,
							headers: { "Content-Type": "application/json" },
						});
					} catch (error) {
						const message = error instanceof Error ? error.message : "Internal server error";
						return new Response(JSON.stringify({ error: message }), { status: 500, headers: { "Content-Type": "application/json" } });
					}
				},
			};
		},
	};
}
