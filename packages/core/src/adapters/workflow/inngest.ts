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
	createFunction: (
		config: InngestFunctionConfig,
		trigger: InngestTrigger,
		handler: InngestHandler,
	) => InngestFunction;
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
	const {
		client,
		servePath = "/api/inngest",
		eventPrefix = "herald",
		retries = 3,
	} = config;

	const registeredFunctions: InngestFunction[] = [];
	const adapter: InngestAdapter = {
		adapterId: "inngest",

		registerWorkflow(workflow: NotificationWorkflow): void {
			const eventName = `${eventPrefix}/workflow.${workflow.id}`;

			const fn = client.createFunction(
				{
					id: `${eventPrefix}-${workflow.id}`,
					name: workflow.name,
					retries,
					cancelOn: [
						{
							event: `${eventPrefix}/workflow.cancel`,
							if: `async.data.transactionId == event.data.transactionId`,
						},
					],
				},
				{ event: eventName },
				async ({ event, step }) => {
					const payload = (event.data.payload ?? {}) as Record<string, unknown>;
					const recipients = event.data.recipients as string[];

					// Execute workflow steps for each recipient
					for (const subscriberId of recipients) {
						for (const workflowStep of workflow.steps) {
							if (workflowStep.type === "delay") {
								const delayConfig = await step.run(
									`${workflowStep.stepId}-config-${subscriberId}`,
									async () => {
										const result = await workflowStep.handler({
											subscriber: {
												id: subscriberId,
												externalId: subscriberId,
											},
											payload,
											step: {
												delay: async (c) => c as unknown as void,
												digest: async () => [],
											},
										});
										return result;
									},
								);

								if (delayConfig?.data) {
									const d = delayConfig.data as { amount?: number; unit?: string };
									const duration = `${d.amount ?? 1} ${d.unit ?? "hours"}`;
									await step.sleep(`${workflowStep.stepId}-wait-${subscriberId}`, duration);
								}
								continue;
							}

							await step.run(
								`${workflowStep.stepId}-${subscriberId}`,
								async () => {
									const result = await workflowStep.handler({
										subscriber: {
											id: subscriberId,
											externalId: subscriberId,
										},
										payload,
										step: {
											delay: async () => {},
											digest: async () => [],
										},
									});

									// Emit a step completion event for tracking
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
								},
							);
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

			await client.send({
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
			});

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
					const handlerFn = method === "GET"
						? serveResult.GET
						: method === "PUT"
							? serveResult.PUT
							: serveResult.POST;

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
