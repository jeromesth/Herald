import type { DatabaseAdapter } from "../types/adapter.js";
import type {
	CategoryPreference,
	DefaultPreferences,
	HeraldContext,
	OperatorPreferences,
	PreferenceCondition,
	PreferenceRecord,
	WorkflowChannelPreference,
} from "../types/config.js";
import type { ChannelType, NotificationWorkflow, SubscriberData } from "../types/workflow.js";
import { conditionsPass, resolvePath } from "./conditions.js";
import { resolveSubscriberInternalId } from "./subscriber.js";

/**
 * Deep merge two plain objects. Nested objects are recursively merged rather than overwritten.
 * Primitive values in `patch` overwrite values in `base`.
 */
export function deepMerge<T extends Record<string, unknown>>(base: T | undefined, patch: T | undefined): T {
	if (!base) return (patch ?? {}) as T;
	if (!patch) return base;

	const result = { ...base } as Record<string, unknown>;
	for (const key of Object.keys(patch)) {
		const baseVal = result[key];
		const patchVal = (patch as Record<string, unknown>)[key];

		if (
			patchVal !== null &&
			typeof patchVal === "object" &&
			!Array.isArray(patchVal) &&
			baseVal !== null &&
			typeof baseVal === "object" &&
			!Array.isArray(baseVal)
		) {
			result[key] = deepMerge(baseVal as Record<string, unknown>, patchVal as Record<string, unknown>);
		} else {
			result[key] = patchVal;
		}
	}
	return result as T;
}

export interface WorkflowMeta {
	workflowId: string;
	critical?: boolean;
	purpose?: string;
	category?: string;
	preferences?: {
		channels?: Partial<Record<ChannelType, { enabled: boolean; readOnly?: boolean }>>;
		conditions?: PreferenceCondition[];
	};
}

export interface PreferenceGateResult {
	allowed: boolean;
	reason: string;
}

export interface ConditionContext {
	subscriber: SubscriberData;
	payload: Record<string, unknown>;
}

/**
 * Input for the preference gate evaluation.
 */
export interface PreferenceGateInput {
	subscriberPrefs?: PreferenceRecord;
	workflowMeta: WorkflowMeta;
	channel: ChannelType;
	defaultPreferences?: DefaultPreferences;
	operatorPreferences?: OperatorPreferences;
	conditionContext?: ConditionContext;
}

/**
 * 12-level preference gate:
 *
 *  1. Critical bypass
 *  2. Operator enforced overrides
 *  3. ReadOnly channel controls
 *  4. Channel kill switch
 *  5. Workflow-specific preference
 *  6. Category preference (with channel granularity)
 *  7. Purpose-level preference
 *  8. Preference conditions
 *  9. Workflow author defaults
 * 10. Config/operator default per-workflow
 * 11. Config/operator default per-channel
 * 12. Default allow
 */
export function preferenceGate(input: PreferenceGateInput): PreferenceGateResult {
	const { subscriberPrefs, workflowMeta, channel, defaultPreferences, operatorPreferences, conditionContext } = input;
	// 1. Critical bypass
	if (workflowMeta.critical) {
		return { allowed: true, reason: "critical" };
	}

	// 2. Operator enforced overrides
	// Priority within this tier: channel > workflow > category > purpose.
	// When two enforce:true rules conflict (e.g., channel disabled + workflow enabled),
	// the broader scope (channel) wins because it's checked first.
	if (operatorPreferences) {
		// Check enforced channel override (broadest scope)
		const opChannel = operatorPreferences.channels?.[channel];
		if (opChannel?.enforce) {
			return {
				allowed: opChannel.enabled,
				reason: opChannel.enabled ? `operator enforced channel "${channel}" enabled` : `operator enforced channel "${channel}" disabled`,
			};
		}

		// Check enforced workflow override
		const opWorkflow = operatorPreferences.workflows?.[workflowMeta.workflowId];
		if (opWorkflow?.enforce) {
			return {
				allowed: opWorkflow.enabled,
				reason: opWorkflow.enabled
					? `operator enforced workflow "${workflowMeta.workflowId}" enabled`
					: `operator enforced workflow "${workflowMeta.workflowId}" disabled`,
			};
		}

		// Check enforced category override
		if (workflowMeta.category) {
			const opCategory = operatorPreferences.categories?.[workflowMeta.category];
			if (opCategory?.enforce) {
				return {
					allowed: opCategory.enabled,
					reason: opCategory.enabled
						? `operator enforced category "${workflowMeta.category}" enabled`
						: `operator enforced category "${workflowMeta.category}" disabled`,
				};
			}
		}

		// Check enforced purpose override
		if (workflowMeta.purpose) {
			const opPurpose = operatorPreferences.purposes?.[workflowMeta.purpose];
			if (opPurpose?.enforce) {
				return {
					allowed: opPurpose.enabled,
					reason: opPurpose.enabled
						? `operator enforced purpose "${workflowMeta.purpose}" enabled`
						: `operator enforced purpose "${workflowMeta.purpose}" disabled`,
				};
			}
		}
	}

	// 3. ReadOnly channel controls
	const authorChannelPref = workflowMeta.preferences?.channels?.[channel];
	if (authorChannelPref?.readOnly) {
		return {
			allowed: authorChannelPref.enabled,
			reason: authorChannelPref.enabled
				? `readOnly channel "${channel}" for workflow "${workflowMeta.workflowId}" enabled`
				: `readOnly channel "${channel}" for workflow "${workflowMeta.workflowId}" disabled`,
		};
	}

	// 4. Global channel kill switch
	if (subscriberPrefs?.channels?.[channel] === false) {
		return { allowed: false, reason: `subscriber disabled channel "${channel}"` };
	}

	// 5. Workflow-specific preference
	const workflowPref = subscriberPrefs?.workflows?.[workflowMeta.workflowId];
	if (workflowPref !== undefined) {
		const wcp = workflowPref;
		if (!wcp.enabled) {
			return { allowed: false, reason: `subscriber disabled workflow "${workflowMeta.workflowId}"` };
		}
		if (wcp.channels?.[channel] === false) {
			return { allowed: false, reason: `subscriber disabled channel "${channel}" for workflow "${workflowMeta.workflowId}"` };
		}
		// Check subscriber-level workflow conditions
		if (wcp.conditions?.length && conditionContext) {
			const condResult = evaluatePreferenceConditions(wcp.conditions, conditionContext);
			if (!condResult) {
				return {
					allowed: false,
					reason: `subscriber workflow "${workflowMeta.workflowId}" condition not met`,
				};
			}
		}
		return { allowed: true, reason: `subscriber enabled workflow "${workflowMeta.workflowId}"` };
	}

	// 6. Category preference (short-circuits to allow, like workflow preferences at level 5)
	if (workflowMeta.category) {
		const categoryPref = subscriberPrefs?.categories?.[workflowMeta.category];
		if (categoryPref !== undefined) {
			const cp = categoryPref;
			if (!cp.enabled) {
				return { allowed: false, reason: `subscriber disabled category "${workflowMeta.category}"` };
			}
			if (cp.channels?.[channel] === false) {
				return { allowed: false, reason: `subscriber disabled channel "${channel}" for category "${workflowMeta.category}"` };
			}
			return { allowed: true, reason: `subscriber enabled category "${workflowMeta.category}"` };
		}
	}

	// 7. Purpose-level preference
	if (workflowMeta.purpose && subscriberPrefs?.purposes?.[workflowMeta.purpose] === false) {
		return { allowed: false, reason: `subscriber disabled purpose "${workflowMeta.purpose}"` };
	}

	// 8. Preference conditions (workflow-level conditions from author)
	if (workflowMeta.preferences?.conditions?.length && conditionContext) {
		const condResult = evaluatePreferenceConditions(workflowMeta.preferences.conditions, conditionContext);
		if (!condResult) {
			return { allowed: false, reason: `workflow "${workflowMeta.workflowId}" preference condition not met` };
		}
	}

	// 9. Workflow author channel default (non-readOnly)
	if (authorChannelPref && !authorChannelPref.enabled) {
		return { allowed: false, reason: `workflow author disabled channel "${channel}"` };
	}

	// 10. Config/operator default per-workflow
	const subscriberWorkflowExplicit = subscriberPrefs?.workflows?.[workflowMeta.workflowId] !== undefined;
	if (!subscriberWorkflowExplicit) {
		const defaultWorkflowPref = defaultPreferences?.workflows?.[workflowMeta.workflowId];
		if (defaultWorkflowPref && !defaultWorkflowPref.enabled) {
			return { allowed: false, reason: `config default disabled workflow "${workflowMeta.workflowId}"` };
		}
		const opDefaultWorkflow = operatorPreferences?.workflows?.[workflowMeta.workflowId];
		if (opDefaultWorkflow && !opDefaultWorkflow.enforce && !opDefaultWorkflow.enabled) {
			return { allowed: false, reason: `operator default disabled workflow "${workflowMeta.workflowId}"` };
		}
	}

	// Config default per-purpose
	if (workflowMeta.purpose && defaultPreferences?.purposes?.[workflowMeta.purpose] === false) {
		return { allowed: false, reason: `config default disabled purpose "${workflowMeta.purpose}"` };
	}

	// Config default per-category
	if (workflowMeta.category) {
		const defaultCatPref = defaultPreferences?.categories?.[workflowMeta.category];
		if (defaultCatPref && !defaultCatPref.enabled) {
			return { allowed: false, reason: `config default disabled category "${workflowMeta.category}"` };
		}
	}

	// 11. Config/operator default per-channel
	// If subscriber explicitly set a channel preference, it takes precedence over non-enforced defaults
	const subscriberChannelExplicit = subscriberPrefs?.channels?.[channel] !== undefined;
	if (!subscriberChannelExplicit) {
		if (defaultPreferences?.channels?.[channel] === false) {
			return { allowed: false, reason: `config default disabled channel "${channel}"` };
		}
		const opDefaultChannel = operatorPreferences?.channels?.[channel];
		if (opDefaultChannel && !opDefaultChannel.enforce && !opDefaultChannel.enabled) {
			return { allowed: false, reason: `operator default disabled channel "${channel}"` };
		}
	}

	// 12. Default allow
	return { allowed: true, reason: "default" };
}

function evaluatePreferenceConditions(conditions: PreferenceCondition[], context: ConditionContext): boolean {
	return conditionsPass(conditions, (field) => {
		if (field.startsWith("subscriber.")) {
			return resolvePath(context.subscriber as unknown as Record<string, unknown>, field.slice("subscriber.".length));
		}
		if (field.startsWith("payload.")) {
			return resolvePath(context.payload, field.slice("payload.".length));
		}
		// Unrecognized prefix — return undefined rather than guessing
		return undefined;
	});
}

export function defaultPreferenceRecord(ctx: HeraldContext, subscriberId: string): PreferenceRecord {
	return {
		subscriberId,
		channels: { ...(ctx.options.defaultPreferences?.channels ?? {}) },
		workflows: { ...(ctx.options.defaultPreferences?.workflows ?? {}) },
		categories: { ...(ctx.options.defaultPreferences?.categories ?? {}) },
		purposes: { ...(ctx.options.defaultPreferences?.purposes ?? {}) },
	};
}

/**
 * Normalize a preference record loaded from the database, coercing legacy boolean
 * values in `workflows` and `categories` to the current object form.
 *
 * Pre-v0.5 data may store `workflows: { "wf": true }` or `categories: { "cat": true }`,
 * which this function converts to `{ enabled: true }` / `{ enabled: false }`.
 */
export function normalizePreferenceRecord(pref: PreferenceRecord): PreferenceRecord {
	let normalized = pref;

	if (pref.workflows) {
		const normalizedWorkflows: Record<string, WorkflowChannelPreference> = {};
		for (const [key, val] of Object.entries(pref.workflows)) {
			if (typeof val === "boolean") {
				normalizedWorkflows[key] = { enabled: val };
			} else {
				normalizedWorkflows[key] = val as WorkflowChannelPreference;
			}
		}
		normalized = { ...normalized, workflows: normalizedWorkflows };
	}

	if (pref.categories) {
		const normalizedCategories: Record<string, CategoryPreference> = {};
		for (const [key, val] of Object.entries(pref.categories)) {
			if (typeof val === "boolean") {
				normalizedCategories[key] = { enabled: val };
			} else {
				normalizedCategories[key] = val as CategoryPreference;
			}
		}
		normalized = { ...normalized, categories: normalizedCategories };
	}

	return normalized;
}

/**
 * Build a map of workflow ID → readOnly channels. Computed once at init.
 */
export function buildReadOnlyChannels(workflows?: NotificationWorkflow[]): Record<string, Partial<Record<ChannelType, boolean>>> {
	const result: Record<string, Partial<Record<ChannelType, boolean>>> = {};
	for (const wf of workflows ?? []) {
		if (wf.preferences?.channels) {
			const readOnlyMap: Partial<Record<ChannelType, boolean>> = {};
			let hasReadOnly = false;
			for (const [ch, pref] of Object.entries(wf.preferences.channels)) {
				if (pref?.readOnly) {
					readOnlyMap[ch as ChannelType] = true;
					hasReadOnly = true;
				}
			}
			if (hasReadOnly) {
				result[wf.id] = readOnlyMap;
			}
		}
	}
	return result;
}

/**
 * Strip preference overrides for channels that are marked readOnly by workflow authors.
 * This prevents subscribers from storing contradictory state.
 */
export function stripReadOnlyOverrides(
	preferences: Partial<PreferenceRecord>,
	readOnlyChannels: Record<string, Partial<Record<ChannelType, boolean>>>,
): Partial<PreferenceRecord> {
	if (!preferences.workflows || Object.keys(readOnlyChannels).length === 0) {
		return preferences;
	}

	const sanitizedWorkflows = { ...preferences.workflows };
	for (const [workflowId, roChannels] of Object.entries(readOnlyChannels)) {
		const wfPref = sanitizedWorkflows[workflowId];
		if (wfPref?.channels) {
			const sanitizedChannels = { ...wfPref.channels };
			for (const ch of Object.keys(roChannels)) {
				delete sanitizedChannels[ch as ChannelType];
			}
			sanitizedWorkflows[workflowId] = { ...wfPref, channels: sanitizedChannels };
		}
	}

	return { ...preferences, workflows: sanitizedWorkflows };
}

export type PreferencePatch = Partial<Pick<PreferenceRecord, "channels" | "workflows" | "categories" | "purposes">>;

export interface UpsertPreferenceResult {
	record: PreferenceRecord;
	/** Present when a new preference row was inserted (for REST 201 bodies). */
	createdRowId?: string;
	updatedAt: Date;
}

/**
 * Merge `patch` into an existing preference row or create one with config defaults.
 * Used by the programmatic API, REST handlers, and bulk updates so merge semantics stay identical.
 */
export async function upsertPreferenceInternal(
	db: DatabaseAdapter,
	ctx: HeraldContext,
	generateId: () => string,
	internalSubscriberId: string,
	patch: PreferencePatch,
): Promise<UpsertPreferenceResult> {
	const now = new Date();
	const existing = await db.findOne<PreferenceRecord>({
		model: "preference",
		where: [{ field: "subscriberId", value: internalSubscriberId }],
	});

	if (existing) {
		const record: PreferenceRecord = {
			subscriberId: internalSubscriberId,
			channels: deepMerge(existing.channels, patch.channels),
			workflows: deepMerge(existing.workflows, patch.workflows),
			categories: deepMerge(existing.categories, patch.categories),
			purposes: deepMerge(existing.purposes, patch.purposes),
		};
		await db.update({
			model: "preference",
			where: [{ field: "subscriberId", value: internalSubscriberId }],
			update: { ...record, updatedAt: now },
		});
		return { record, updatedAt: now };
	}

	const id = generateId();
	const defaults = defaultPreferenceRecord(ctx, internalSubscriberId);
	const record: PreferenceRecord = {
		subscriberId: internalSubscriberId,
		channels: deepMerge(defaults.channels, patch.channels),
		workflows: deepMerge(defaults.workflows, patch.workflows),
		categories: deepMerge(defaults.categories, patch.categories),
		purposes: deepMerge(defaults.purposes, patch.purposes),
	};
	await db.create({ model: "preference", data: { id, ...record, updatedAt: now } });
	return { record, createdRowId: id, updatedAt: now };
}

type BulkPreferenceUpdateInput = { subscriberId: string; preferences: Partial<PreferenceRecord> };

type BulkPreferenceItemSuccess = { subscriberId: string; preferences: PreferenceRecord };
type BulkPreferenceItemFailure = { subscriberId: string; error: string };
type BulkPreferenceItemResult = BulkPreferenceItemSuccess | BulkPreferenceItemFailure;

function sanitizeBulkPreferenceUpdate(
	raw: BulkPreferenceUpdateInput,
	readOnlyChannels: HeraldContext["readOnlyChannels"],
): BulkPreferenceUpdateInput {
	return {
		...raw,
		preferences: stripReadOnlyOverrides(raw.preferences, readOnlyChannels),
	};
}

async function processSingleBulkPreferenceUpdate(
	db: DatabaseAdapter,
	ctx: HeraldContext,
	generateId: () => string,
	update: BulkPreferenceUpdateInput,
): Promise<BulkPreferenceItemResult> {
	try {
		const internalId = await resolveSubscriberInternalId(db, update.subscriberId);
		if (!internalId) {
			return { subscriberId: update.subscriberId, error: "Subscriber not found" };
		}
		const { record } = await upsertPreferenceInternal(db, ctx, generateId, internalId, update.preferences);
		return { subscriberId: update.subscriberId, preferences: record };
	} catch (err) {
		console.error(`[herald] bulkUpdatePreferences failed for subscriber "${update.subscriberId}":`, err);
		return { subscriberId: update.subscriberId, error: "Update failed" };
	}
}

function mapSettledBulkResultToRow(
	settled: PromiseSettledResult<BulkPreferenceItemResult>,
	fallbackSubscriberId: string,
): { subscriberId: string; preferences?: PreferenceRecord; error?: string } {
	if (settled.status === "fulfilled") {
		const value = settled.value;
		if ("error" in value) {
			return { subscriberId: value.subscriberId, error: value.error };
		}
		return { subscriberId: value.subscriberId, preferences: value.preferences };
	}

	console.error(`[herald] bulkUpdatePreferences unexpected rejection for subscriber "${fallbackSubscriberId}":`, settled.reason);
	return { subscriberId: fallbackSubscriberId, error: "Update failed" };
}

/**
 * Shared bulk update logic used by both the programmatic API and REST endpoint.
 * Runs each update concurrently via Promise.allSettled (CODING_STANDARDS bulk guidance).
 */
export async function bulkUpdatePreferencesInternal(
	db: DatabaseAdapter,
	ctx: HeraldContext,
	generateId: () => string,
	updates: BulkPreferenceUpdateInput[],
): Promise<Array<{ subscriberId: string; preferences?: PreferenceRecord; error?: string }>> {
	if (updates.length > 100) {
		throw new Error("bulkUpdatePreferences supports a maximum of 100 updates per call");
	}

	const tasks = updates.map((rawUpdate) => {
		const sanitized = sanitizeBulkPreferenceUpdate(rawUpdate, ctx.readOnlyChannels);
		return processSingleBulkPreferenceUpdate(db, ctx, generateId, sanitized);
	});

	const settled = await Promise.allSettled(tasks);

	return settled.map((s, i) => mapSettledBulkResultToRow(s, updates[i]?.subscriberId ?? "unknown"));
}
