import type { HeraldContext, PreferenceRecord } from "../types/config.js";
import type {
	ChannelType,
	FetchConfig,
	FetchResult,
	NotificationWorkflow,
	StepCondition,
	StepContext,
	StepResult,
	ThrottleConfig,
	ThrottleResult,
} from "../types/workflow.js";
import type { WorkflowMeta } from "./preferences.js";
import { preferenceGate } from "./preferences.js";
import { sendThroughProvider } from "./send.js";
import { resolveRecipient, resolveSubscriberForStep } from "./subscriber.js";

export function wrapWorkflow(workflow: NotificationWorkflow, ctx: HeraldContext): NotificationWorkflow {
	const meta: WorkflowMeta = {
		workflowId: workflow.id,
		critical: workflow.critical,
		purpose: workflow.purpose,
		preferences: workflow.preferences,
	};
	return {
		...workflow,
		steps: workflow.steps.map((step) => wrapStep(meta, step, ctx)),
	};
}

function wrapStep(workflowMeta: WorkflowMeta, step: NotificationWorkflow["steps"][number], ctx: HeraldContext) {
	const originalHandler = step.handler;

	return {
		...step,
		handler: async (context: StepContext): Promise<StepResult> => {
			if (!conditionsPass(step.conditions, context, step.conditionMode)) {
				return { body: "" };
			}

			const result = await originalHandler(context);

			if (!isChannelStep(step.type)) {
				return result;
			}

			const subscriber = await resolveSubscriberForStep(ctx, context.subscriber);
			if (!subscriber) {
				console.warn(
					`[herald] Workflow "${workflowMeta.workflowId}" step "${step.stepId}": subscriber "${context.subscriber.externalId}" not found, skipping delivery`,
				);
				return result;
			}

			// Load subscriber preferences and run preference gate
			const subscriberPrefs = await ctx.db.findOne<PreferenceRecord>({
				model: "preference",
				where: [{ field: "subscriberId", value: subscriber.id }],
			});

			// Run beforePreferenceCheck plugin hooks
			if (ctx.options.plugins) {
				for (const plugin of ctx.options.plugins) {
					if (plugin.hooks?.beforePreferenceCheck) {
						const hookResult = await plugin.hooks.beforePreferenceCheck({
							subscriberId: subscriber.id,
							workflowId: workflowMeta.workflowId,
							channel: step.type,
							purpose: workflowMeta.purpose,
							critical: workflowMeta.critical,
						});
						if (hookResult?.override !== undefined) {
							if (!hookResult.override) {
								console.info(
									`[herald] Workflow "${workflowMeta.workflowId}" step "${step.stepId}": blocked by plugin beforePreferenceCheck`,
								);
								return result;
							}
							// override === true: skip preference gate, allow delivery
							await runAfterPreferenceHooks(ctx, subscriber.id, workflowMeta.workflowId, step.type, true, "plugin override");
							break;
						}
					}
				}
			}

			const gateResult = preferenceGate(subscriberPrefs ?? undefined, workflowMeta, step.type, ctx.options.defaultPreferences);

			// Run afterPreferenceCheck plugin hooks
			await runAfterPreferenceHooks(ctx, subscriber.id, workflowMeta.workflowId, step.type, gateResult.allowed, gateResult.reason);

			if (!gateResult.allowed) {
				console.info(`[herald] Workflow "${workflowMeta.workflowId}" step "${step.stepId}": delivery blocked — ${gateResult.reason}`);
				return result;
			}

			const recipient = resolveRecipient(step.type, subscriber);
			if (!recipient) {
				console.warn(
					`[herald] Workflow "${workflowMeta.workflowId}" step "${step.stepId}": subscriber "${subscriber.externalId}" has no recipient for channel "${step.type}", skipping delivery`,
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
					workflowId: workflowMeta.workflowId,
					payload: context.payload,
				},
			});

			return result;
		},
	};
}

async function runAfterPreferenceHooks(
	ctx: HeraldContext,
	subscriberId: string,
	workflowId: string,
	channel: ChannelType,
	allowed: boolean,
	reason: string,
): Promise<void> {
	if (!ctx.options.plugins) return;
	for (const plugin of ctx.options.plugins) {
		if (plugin.hooks?.afterPreferenceCheck) {
			await plugin.hooks.afterPreferenceCheck({ subscriberId, workflowId, channel, allowed, reason });
		}
	}
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

export function conditionsPass(conditions: StepCondition[] | undefined, context: StepContext, mode: "all" | "any" = "all"): boolean {
	if (!conditions?.length) {
		return true;
	}

	const check = mode === "any" ? conditions.some.bind(conditions) : conditions.every.bind(conditions);
	return check((condition: StepCondition) => {
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
		return resolvePath(context.subscriber as unknown as Record<string, unknown>, field.slice("subscriber.".length));
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

export function toMs(amount: number, unit: "seconds" | "minutes" | "hours" | "days"): number {
	const multipliers = { seconds: 1000, minutes: 60_000, hours: 3_600_000, days: 86_400_000 };
	return amount * multipliers[unit];
}

export function checkThrottle(ctx: HeraldContext, config: ThrottleConfig): ThrottleResult {
	const now = Date.now();
	const windowMs = toMs(config.window, config.unit);
	const state = ctx.throttleState.get(config.key);

	if (!state || now - state.windowStart >= windowMs) {
		ctx.throttleState.set(config.key, { count: 1, windowStart: now });
		return { throttled: false, count: 1, limit: config.limit };
	}

	state.count += 1;
	if (state.count > config.limit) {
		return { throttled: true, count: state.count, limit: config.limit };
	}

	return { throttled: false, count: state.count, limit: config.limit };
}

export async function performFetch(config: FetchConfig): Promise<FetchResult> {
	const controller = new AbortController();
	const timeoutId = config.timeout ? setTimeout(() => controller.abort(), config.timeout) : undefined;

	try {
		const response = await fetch(config.url, {
			method: config.method ?? "GET",
			headers: config.headers,
			body: config.body != null ? JSON.stringify(config.body) : undefined,
			signal: controller.signal,
		});

		const responseHeaders: Record<string, string> = {};
		response.headers.forEach((value, key) => {
			responseHeaders[key] = value;
		});

		const data = await response.json().catch(() => null);

		return { status: response.status, data, headers: responseHeaders };
	} finally {
		if (timeoutId !== undefined) clearTimeout(timeoutId);
	}
}
