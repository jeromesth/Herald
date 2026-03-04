import type { HeraldContext } from "../types/config.js";
import type {
	ChannelType,
	NotificationWorkflow,
	StepCondition,
	StepContext,
	StepResult,
} from "../types/workflow.js";
import { sendThroughProvider } from "./send.js";
import { resolveRecipient, resolveSubscriberForStep } from "./subscriber.js";

export function wrapWorkflow(
	workflow: NotificationWorkflow,
	ctx: HeraldContext,
): NotificationWorkflow {
	return {
		...workflow,
		steps: workflow.steps.map((step) => wrapStep(workflow.id, step, ctx)),
	};
}

function wrapStep(
	workflowId: string,
	step: NotificationWorkflow["steps"][number],
	ctx: HeraldContext,
) {
	const originalHandler = step.handler;

	return {
		...step,
		handler: async (context: StepContext): Promise<StepResult> => {
			if (!conditionsPass(step.conditions, context)) {
				return { body: "" };
			}

			const result = await originalHandler(context);

			if (!isChannelStep(step.type)) {
				return result;
			}

			const subscriber = await resolveSubscriberForStep(ctx, context.subscriber);
			if (!subscriber) {
				console.warn(
					`[herald] Workflow "${workflowId}" step "${step.stepId}": subscriber "${context.subscriber.externalId}" not found, skipping delivery`,
				);
				return result;
			}

			const recipient = resolveRecipient(step.type, subscriber);
			if (!recipient) {
				console.warn(
					`[herald] Workflow "${workflowId}" step "${step.stepId}": subscriber "${subscriber.externalId}" has no recipient for channel "${step.type}", skipping delivery`,
				);
				return result;
			}

			await sendThroughProvider(ctx, {
				channel: step.type,
				subscriberId: subscriber.id,
				to: recipient,
				subject: result.subject,
				body: result.body ?? "",
				actionUrl: result.actionUrl,
				layoutId: typeof result.data?.layoutId === "string" ? result.data.layoutId : undefined,
				data: {
					...result.data,
					workflowId,
					payload: context.payload,
				},
			});

			return result;
		},
	};
}

function isChannelStep(stepType: string): stepType is ChannelType {
	return (
		stepType === "in_app" ||
		stepType === "email" ||
		stepType === "sms" ||
		stepType === "push" ||
		stepType === "chat" ||
		stepType === "webhook"
	);
}

function conditionsPass(
	conditions: StepCondition[] | undefined,
	context: StepContext,
): boolean {
	if (!conditions?.length) {
		return true;
	}

	return conditions.every((condition) => {
		const actualValue = resolveConditionValue(condition.field, context);

		switch (condition.operator) {
			case "eq":
				return actualValue === condition.value;
			case "ne":
				return actualValue !== condition.value;
			case "gt":
				return Number(actualValue) > Number(condition.value);
			case "lt":
				return Number(actualValue) < Number(condition.value);
			case "in":
				return Array.isArray(condition.value) && condition.value.includes(actualValue);
			case "not_in":
				return Array.isArray(condition.value) && !condition.value.includes(actualValue);
			case "exists":
				return actualValue !== undefined && actualValue !== null;
			default:
				return false;
		}
	});
}

function resolveConditionValue(field: string, context: StepContext): unknown {
	if (field.startsWith("payload.")) {
		return resolvePath(context.payload, field.slice("payload.".length));
	}

	if (field.startsWith("subscriber.")) {
		return resolvePath(
			context.subscriber as unknown as Record<string, unknown>,
			field.slice("subscriber.".length),
		);
	}

	const payloadValue = resolvePath(context.payload, field);
	if (payloadValue !== undefined) {
		return payloadValue;
	}

	return resolvePath(
		{
			payload: context.payload,
			subscriber: context.subscriber,
		},
		field,
	);
}

function resolvePath(source: Record<string, unknown>, path: string): unknown {
	const parts = path.split(".").filter(Boolean);
	let current: unknown = source;

	for (const part of parts) {
		if (current == null || typeof current !== "object") {
			return undefined;
		}
		current = (current as Record<string, unknown>)[part];
	}

	return current;
}
