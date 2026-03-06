/**
 * Inngest workflow adapter for Herald.
 *
 * Translates Herald notification workflows into Inngest functions with
 * durable step execution, automatic retries, and scheduling.
 *
 * @example
 * ```ts
 * import { Inngest } from "inngest";
 * import { inngestAdapter } from "@herald/core/inngest";
 *
 * const inngest = new Inngest({ id: "my-app" });
 * const workflow = inngestAdapter({ client: inngest });
 * ```
 */
import type {
	CancelArgs,
	NotificationWorkflow,
	TriggerArgs,
	TriggerResult,
	WorkflowAdapter,
	WorkflowHandler,
} from "../../types/workflow.js";

/**
 * Inngest client interface — we accept any Inngest client instance.
 * This avoids a hard dependency on a specific Inngest SDK version.
 */
interface InngestClientLike {
	id: string;
	send: (event: InngestEvent | InngestEvent[]) => Promise<unknown>;
	createFunction: (config: InngestFunctionConfig, trigger: InngestTrigger, handler: InngestHandler) => InngestFunction;
}

interface InngestEvent {
	name: string;
	data: Record<string, unknown>;
	id?: string;
}

interface InngestFunctionConfig {
	id: string;
	name?: string;
	retries?: number;
	cancelOn?: Array<{
		event: string;
		if?: string;
	}>;
}

interface InngestTrigger {
	event: string;
}

interface InngestStepTools {
	run: <T>(id: string, fn: () => Promise<T>) => Promise<T>;
	sleep: (id: string, duration: string) => Promise<void>;
	sleepUntil: (id: string, date: string | Date) => Promise<void>;
	sendEvent: (id: string, event: InngestEvent | InngestEvent[]) => Promise<unknown>;
	waitForEvent: (id: string, opts: { event: string; timeout: string; if?: string }) => Promise<InngestEvent | null>;
}

type InngestHandler = (args: {
	event: InngestEvent;
	step: InngestStepTools;
	runId: string;
}) => Promise<unknown>;

type InngestFunction = unknown;
type InngestAdapter = WorkflowAdapter & { __functions?: InngestFunction[] };

/**
 * Serve function type — we accept any serve implementation.
 */
type ServeFn = (args: {
	client: InngestClientLike;
	functions: InngestFunction[];
}) => { GET: unknown; POST: unknown; PUT: unknown };

export interface InngestAdapterConfig {
	/**
	 * The Inngest client instance.
	 */
	client: InngestClientLike;

	/**
	 * The path where the Inngest serve endpoint is mounted.
	 * @default "/api/inngest"
	 */
	servePath?: string;

	/**
	 * The serve function from the appropriate Inngest framework adapter.
	 * If not provided, the adapter won't expose an HTTP handler.
	 */
	serve?: ServeFn;

	/**
	 * Base event name prefix for Herald events.
	 * @default "herald"
	 */
	eventPrefix?: string;

	/**
	 * Number of retries per step.
	 * @default 3
	 */
	retries?: number;
}

/**
 * Create a Herald workflow adapter backed by Inngest.
 */
export function inngestAdapter(config: InngestAdapterConfig): WorkflowAdapter {
	const { client, servePath = "/api/inngest", eventPrefix = "herald", retries = 3 } = config;

	const registeredFunctions: InngestFunction[] = [];
	const workflows = new Map<string, NotificationWorkflow>();
	const adapter: InngestAdapter = {
		adapterId: "inngest",

		registerWorkflow(workflow: NotificationWorkflow): void {
			workflows.set(workflow.id, workflow);
			const eventName = `${eventPrefix}/workflow.${workflow.id}`;

			const fn = client.createFunction(
				{
					id: `${eventPrefix}-${workflow.id}`,
					name: workflow.name,
					retries,
					cancelOn: [
						{
							event: `${eventPrefix}/workflow.cancel`,
							if: "async.data.transactionId == event.data.transactionId",
						},
					],
				},
				{ event: eventName },
				async ({ event, step }) => {
					const payload = (event.data.payload ?? {}) as Record<string, unknown>;
					const recipients = event.data.recipients as string[];

					const handlerPayload = { ...payload };

					// Execute workflow steps for each recipient
					for (const subscriberId of recipients) {
						for (const workflowStep of workflow.steps) {
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

							if (workflowStep.type === "delay") {
								const delayConfig = await step.run(`${workflowStep.stepId}-config-${subscriberId}`, async () => {
									return workflowStep.handler({
										subscriber: subscriberCtx,
										payload: handlerPayload,
										step: { ...noopStep, delay: async (c) => c as unknown as undefined },
									});
								});

								if (delayConfig?.data) {
									const d = delayConfig.data as { amount?: number; unit?: string };
									const duration = `${d.amount ?? 1} ${d.unit ?? "hours"}`;
									await step.sleep(`${workflowStep.stepId}-wait-${subscriberId}`, duration);
								}
								continue;
							}

							if (workflowStep.type === "digest") {
								const digestConfig = await step.run(`${workflowStep.stepId}-config-${subscriberId}`, async () => {
									let capturedConfig: { window?: number; unit?: string } = {};
									await workflowStep.handler({
										subscriber: subscriberCtx,
										payload: handlerPayload,
										step: {
											...noopStep,
											digest: async (c) => {
												capturedConfig = c;
												return [];
											},
										},
									});
									return capturedConfig;
								});

								const timeout = `${digestConfig.window ?? 5} ${digestConfig.unit ?? "minutes"}`;
								const digestEventName = `${eventPrefix}/digest.${workflow.id}.${workflowStep.stepId}`;

								// Collect events during the digest window
								const collected: InngestEvent[] = [];
								let incoming: InngestEvent | null = null;
								do {
									incoming = await step.waitForEvent(`${workflowStep.stepId}-wait-${subscriberId}-${collected.length}`, {
										event: digestEventName,
										timeout,
										if: `async.data.subscriberId == '${subscriberId}'`,
									});
									if (incoming) collected.push(incoming);
								} while (incoming);

								// Re-run handler with collected events
								await step.run(`${workflowStep.stepId}-process-${subscriberId}`, async () => {
									const events = collected.map((e) => ({
										payload: (e.data.payload ?? {}) as Record<string, unknown>,
										timestamp: new Date((e.data.timestamp as string) ?? Date.now()),
									}));
									return workflowStep.handler({
										subscriber: subscriberCtx,
										payload: handlerPayload,
										step: { ...noopStep, digest: async () => events },
									});
								});
								continue;
							}

							if (workflowStep.type === "throttle") {
								const result = await step.run(`${workflowStep.stepId}-${subscriberId}`, async () => {
									return workflowStep.handler({
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

							if (workflowStep.type === "fetch") {
								const result = await step.run(`${workflowStep.stepId}-${subscriberId}`, async () => {
									return workflowStep.handler({
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

							await step.run(`${workflowStep.stepId}-${subscriberId}`, async () => {
								const result = await workflowStep.handler({
									subscriber: subscriberCtx,
									payload: handlerPayload,
									step: noopStep,
								});

								await client.send({
									name: `${eventPrefix}/step.completed`,
									data: {
										workflowId: workflow.id,
										stepId: workflowStep.stepId,
										subscriberId,
										channel: workflowStep.type,
										result,
										transactionId: event.data.transactionId as string,
									},
								});

								return result;
							});
						}
					}

					return { status: "completed", workflowId: workflow.id };
				},
			);

			registeredFunctions.push(fn);
		},

		async trigger(args: TriggerArgs): Promise<TriggerResult> {
			const transactionId = args.transactionId ?? crypto.randomUUID();
			const recipients = Array.isArray(args.to) ? args.to : [args.to];
			const eventName = `${eventPrefix}/workflow.${args.workflowId}`;

			const eventsToSend: InngestEvent[] = [
				{
					name: eventName,
					data: {
						workflowId: args.workflowId,
						recipients,
						payload: args.payload,
						actor: args.actor,
						tenant: args.tenant,
						transactionId,
						overrides: args.overrides,
					},
					id: transactionId,
				},
			];

			// Route digest events for workflows with digest steps
			const workflow = workflows.get(args.workflowId);
			if (workflow) {
				for (const ws of workflow.steps) {
					if (ws.type === "digest") {
						for (const subscriberId of recipients) {
							eventsToSend.push({
								name: `${eventPrefix}/digest.${args.workflowId}.${ws.stepId}`,
								data: {
									subscriberId,
									payload: args.payload,
									timestamp: new Date().toISOString(),
								},
							});
						}
					}
				}
			}

			await client.send(eventsToSend);

			return {
				transactionId,
				status: "triggered",
			};
		},

		async cancel(args: CancelArgs): Promise<void> {
			await client.send({
				name: `${eventPrefix}/workflow.cancel`,
				data: {
					workflowId: args.workflowId,
					transactionId: args.transactionId,
				},
			});
		},

		getHandler(): WorkflowHandler | null {
			if (!config.serve) return null;

			const serveResult = config.serve({
				client,
				functions: registeredFunctions,
			});

			return {
				path: servePath,
				handler: async (request: Request) => {
					const method = request.method.toUpperCase();
					const handlerFn = method === "GET" ? serveResult.GET : method === "PUT" ? serveResult.PUT : serveResult.POST;

					return (handlerFn as (req: Request) => Promise<Response>)(request);
				},
			};
		},
	};

	adapter.__functions = registeredFunctions;
	return adapter;
}

/**
 * Helper to get the registered Inngest functions for use with serve().
 * Useful when you need to pass functions to your own serve() setup.
 */
export function getInngestFunctions(adapter: WorkflowAdapter): InngestFunction[] {
	if (adapter.adapterId !== "inngest") {
		throw new Error("getInngestFunctions can only be used with the Inngest adapter");
	}

	return (adapter as Partial<InngestAdapter>).__functions ?? [];
}
