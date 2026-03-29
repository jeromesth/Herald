import type { HeraldContext, PreferenceRecord } from "../types/config.js";
import type {
	ActionStep,
	BranchStep,
	ChannelType,
	FetchConfig,
	FetchResult,
	NotificationWorkflow,
	StepCondition,
	StepContext,
	StepResult,
	ThrottleConfig,
	ThrottleResult,
	WorkflowStep,
} from "../types/workflow.js";
import { conditionsPass, resolvePath } from "./conditions.js";
import type { WorkflowMeta } from "./preferences.js";
import { normalizePreferenceRecord, preferenceGate } from "./preferences.js";
import { sendThroughProvider } from "./send.js";
import { resolveRecipient, resolveSubscriberForStep } from "./subscriber.js";

export function wrapWorkflow(workflow: NotificationWorkflow, ctx: HeraldContext): NotificationWorkflow {
	const meta: WorkflowMeta = {
		workflowId: workflow.id,
		critical: workflow.critical,
		purpose: workflow.purpose,
		category: workflow.category,
		preferences: workflow.preferences,
	};
	return {
		...workflow,
		steps: wrapSteps(meta, workflow.steps, ctx),
	};
}

function wrapSteps(meta: WorkflowMeta, steps: WorkflowStep[], ctx: HeraldContext): WorkflowStep[] {
	return steps.map((step) => {
		if (isBranchStep(step)) {
			return {
				...step,
				branches: step.branches.map((branch) => ({
					...branch,
					steps: wrapSteps(meta, branch.steps, ctx),
				})),
			};
		}
		return wrapStep(meta, step, ctx);
	});
}

function wrapStep(workflowMeta: WorkflowMeta, step: ActionStep, ctx: HeraldContext) {
	const originalHandler = step.handler;

	return {
		...step,
		handler: async (context: StepContext): Promise<StepResult> => {
			if (!stepConditionsPass(step.conditions, context, step.conditionMode)) {
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
			let subscriberPrefs: PreferenceRecord | null = null;
			try {
				const raw = await ctx.db.findOne<PreferenceRecord>({
					model: "preference",
					where: [{ field: "subscriberId", value: subscriber.id }],
				});
				subscriberPrefs = raw ? normalizePreferenceRecord(raw) : null;
			} catch (error) {
				console.error(
					`[herald] Workflow "${workflowMeta.workflowId}" step "${step.stepId}": failed to load preferences for subscriber "${subscriber.id}", proceeding with defaults`,
					error,
				);
			}

			// Run beforePreferenceCheck plugin hooks
			let pluginOverride: boolean | undefined;
			if (ctx.options.plugins) {
				for (const plugin of ctx.options.plugins) {
					if (plugin.hooks?.beforePreferenceCheck) {
						try {
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
										`[herald] Workflow "${workflowMeta.workflowId}" step "${step.stepId}": blocked by plugin "${plugin.id}" beforePreferenceCheck`,
									);
									await runAfterPreferenceHooks(ctx, subscriber.id, workflowMeta.workflowId, step.type, false, "plugin override");
									return result;
								}
								// override === true: skip preference gate, allow delivery
								console.info(
									`[herald] Workflow "${workflowMeta.workflowId}" step "${step.stepId}": delivery forced by plugin "${plugin.id}" beforePreferenceCheck`,
								);
								pluginOverride = true;
								await runAfterPreferenceHooks(ctx, subscriber.id, workflowMeta.workflowId, step.type, true, "plugin override");
								break;
							}
						} catch (error) {
							console.error(
								`[herald] Plugin "${plugin.id}" beforePreferenceCheck hook threw for workflow "${workflowMeta.workflowId}" step "${step.stepId}":`,
								error,
							);
						}
					}
				}
			}

			if (!pluginOverride) {
				const gateResult = preferenceGate({
					subscriberPrefs: subscriberPrefs ?? undefined,
					workflowMeta,
					channel: step.type,
					defaultPreferences: ctx.options.defaultPreferences,
					operatorPreferences: ctx.options.operatorPreferences,
					conditionContext: { subscriber: context.subscriber, payload: context.payload },
				});

				// Run afterPreferenceCheck plugin hooks
				await runAfterPreferenceHooks(ctx, subscriber.id, workflowMeta.workflowId, step.type, gateResult.allowed, gateResult.reason);

				if (!gateResult.allowed) {
					console.info(`[herald] Workflow "${workflowMeta.workflowId}" step "${step.stepId}": delivery blocked — ${gateResult.reason}`);
					return result;
				}
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
			try {
				await plugin.hooks.afterPreferenceCheck({ subscriberId, workflowId, channel, allowed, reason });
			} catch (error) {
				console.error(`[herald] Plugin "${plugin.id}" afterPreferenceCheck hook threw:`, error);
			}
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

export function stepConditionsPass(conditions: StepCondition[] | undefined, context: StepContext, mode: "all" | "any" = "all"): boolean {
	return conditionsPass(conditions, (field) => resolveStepConditionValue(field, context), mode);
}

function resolveStepConditionValue(field: string, context: StepContext): unknown {
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

export function isBranchStep(step: WorkflowStep): step is BranchStep {
	return step.type === "branch";
}

export function resolveBranch(step: BranchStep, context: StepContext): WorkflowStep[] {
	for (const branch of step.branches) {
		if (conditionsPass(branch.conditions, context, branch.conditionMode)) {
			return branch.steps;
		}
	}

	if (step.defaultBranch) {
		const fallback = step.branches.find((b) => b.key === step.defaultBranch);
		if (fallback) {
			return fallback.steps;
		}
	}

	return [];
}

export function toMs(amount: number, unit: "seconds" | "minutes" | "hours" | "days"): number {
	const multipliers = { seconds: 1000, minutes: 60_000, hours: 3_600_000, days: 86_400_000 };
	return amount * multipliers[unit];
}

export function checkThrottle(ctx: HeraldContext, config: ThrottleConfig): ThrottleResult {
	const now = Date.now();
	const windowMs = toMs(config.window, config.unit);
	const state = ctx.throttleState.get(config.key);

	// Periodically clean up expired throttle entries to prevent unbounded memory growth
	if (ctx.throttleState.size > 1000) {
		for (const [key, entry] of ctx.throttleState) {
			if (now - entry.windowStart >= windowMs * 2) {
				ctx.throttleState.delete(key);
			}
		}
	}

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
