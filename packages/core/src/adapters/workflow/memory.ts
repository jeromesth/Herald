import { checkThrottle, isBranchStep, performFetch, resolveBranch, stepConditionsPass } from "../../core/workflow-runtime.js";
import type { HeraldContext } from "../../types/config.js";
/**
 * In-memory workflow adapter for Herald.
 * Used for testing and development — not for production.
 * Executes workflow steps synchronously without a real workflow engine.
 */
import type {
	ActionStep,
	CancelArgs,
	DigestedEvent,
	NotificationWorkflow,
	StepContext,
	StepResult,
	TriggerArgs,
	TriggerResult,
	WorkflowAdapter,
	WorkflowHandler,
	WorkflowStep,
} from "../../types/workflow.js";

export interface MemoryWorkflowEvent {
	workflowId: string;
	transactionId: string;
	recipients: string[];
	payload: Record<string, unknown>;
	actor?: string;
	tenant?: string;
}

export function memoryWorkflowAdapter(heraldCtx?: HeraldContext): WorkflowAdapter & {
	events: MemoryWorkflowEvent[];
	workflows: Map<string, NotificationWorkflow>;
	digestBuffer: Map<string, DigestedEvent[]>;
	addDigestEvent: (key: string, event: DigestedEvent) => void;
} {
	const workflows = new Map<string, NotificationWorkflow>();
	const events: MemoryWorkflowEvent[] = [];
	const digestBuffer = new Map<string, DigestedEvent[]>();

	function addDigestEvent(key: string, event: DigestedEvent): void {
		const existing = digestBuffer.get(key) ?? [];
		existing.push(event);
		digestBuffer.set(key, existing);
	}

	return {
		adapterId: "memory",
		events,
		workflows,
		digestBuffer,
		addDigestEvent,

		registerWorkflow(workflow: NotificationWorkflow): void {
			workflows.set(workflow.id, workflow);
		},

		async trigger(args: TriggerArgs): Promise<TriggerResult> {
			const transactionId = args.transactionId ?? crypto.randomUUID();
			const recipients = Array.isArray(args.to) ? args.to : [args.to];
			const handlerPayload = { ...args.payload, _transactionId: transactionId };

			events.push({
				workflowId: args.workflowId,
				transactionId,
				recipients,
				payload: args.payload,
				actor: args.actor,
				tenant: args.tenant,
			});

			// Execute steps synchronously for testing
			const workflow = workflows.get(args.workflowId);
			if (!workflow) {
				console.warn(
					`[herald] Memory adapter: no workflow registered with id "${args.workflowId}". ` +
						`Registered: [${[...workflows.keys()].join(", ")}]`,
				);
			}
			if (workflow) {
				for (const recipient of recipients) {
					const stepQueue: WorkflowStep[] = [...workflow.steps];
					let aborted = false;

					while (stepQueue.length > 0 && !aborted) {
						const step = stepQueue.shift();
						if (!step) break;

						if (isBranchStep(step)) {
							const ctx: StepContext = {
								subscriber: { id: recipient, externalId: recipient },
								payload: handlerPayload,
								step: {
									delay: async () => {},
									digest: async () => [],
									throttle: async (c) => ({ throttled: false, count: 0, limit: c.limit }),
									fetch: async () => ({ status: 200, data: null, headers: {} }),
								},
							};
							const branchSteps = resolveBranch(step, ctx);
							stepQueue.unshift(...branchSteps);
							continue;
						}

						const actionStep = step as ActionStep;

						// Check step-level conditions
						if (actionStep.conditions?.length) {
							const condCtx: StepContext = {
								subscriber: { id: recipient, externalId: recipient },
								payload: handlerPayload,
								step: {
									delay: async () => {},
									digest: async () => [],
									throttle: async (c) => ({ throttled: false, count: 0, limit: c.limit }),
									fetch: async () => ({ status: 200, data: null, headers: {} }),
								},
							};
							if (!stepConditionsPass(actionStep.conditions, condCtx, actionStep.conditionMode)) {
								continue;
							}
						}

						const result = await actionStep.handler({
							subscriber: { id: recipient, externalId: recipient },
							payload: handlerPayload,
							step: {
								delay: async () => {},
								digest: async (config) => {
									const key = config.key ?? `${args.workflowId}:${actionStep.stepId}`;
									const collected = digestBuffer.get(key) ?? [];
									digestBuffer.delete(key);
									return collected;
								},
								throttle: async (config) => {
									if (!heraldCtx) {
										return { throttled: false, count: 1, limit: config.limit };
									}
									return checkThrottle(heraldCtx, config);
								},
								fetch: async (config) => {
									return performFetch(config);
								},
							},
						});

						if (actionStep.type === "throttle" && result._internal?.throttled) {
							aborted = true;
						}

						if (actionStep.type === "fetch" && result._internal?.fetchResult != null) {
							if (typeof result._internal.fetchResult === "object") {
								Object.assign(handlerPayload, result._internal.fetchResult);
							}
						}
					}
				}
			}

			return { transactionId, status: "triggered" };
		},

		async cancel(_args: CancelArgs): Promise<void> {
			// No-op for memory adapter
		},

		getHandler(): WorkflowHandler | null {
			return null;
		},
	};
}
