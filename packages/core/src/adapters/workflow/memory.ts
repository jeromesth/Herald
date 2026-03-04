/**
 * In-memory workflow adapter for Herald.
 * Used for testing and development — not for production.
 * Executes workflow steps synchronously without a real workflow engine.
 */
import type {
	CancelArgs,
	NotificationWorkflow,
	TriggerArgs,
	TriggerResult,
	WorkflowAdapter,
	WorkflowHandler,
} from "../../types/workflow.js";

export interface MemoryWorkflowEvent {
	workflowId: string;
	transactionId: string;
	recipients: string[];
	payload: Record<string, unknown>;
	actor?: string;
	tenant?: string;
}

export function memoryWorkflowAdapter(): WorkflowAdapter & {
	events: MemoryWorkflowEvent[];
	workflows: Map<string, NotificationWorkflow>;
} {
	const workflows = new Map<string, NotificationWorkflow>();
	const events: MemoryWorkflowEvent[] = [];

	return {
		adapterId: "memory",
		events,
		workflows,

		registerWorkflow(workflow: NotificationWorkflow): void {
			workflows.set(workflow.id, workflow);
		},

		async trigger(args: TriggerArgs): Promise<TriggerResult> {
			const transactionId = args.transactionId ?? crypto.randomUUID();
			const recipients = Array.isArray(args.to) ? args.to : [args.to];
			const handlerPayload = {
				...args.payload,
				_herald: {
					transactionId,
					workflowId: args.workflowId,
					actor: args.actor,
					tenant: args.tenant,
				},
			};

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
			if (workflow) {
				for (const recipient of recipients) {
					for (const step of workflow.steps) {
						await step.handler({
							subscriber: { id: recipient, externalId: recipient },
							payload: handlerPayload,
							step: {
								delay: async () => {},
								digest: async () => [],
							},
						});
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
