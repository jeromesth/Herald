import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { memoryAdapter } from "../../src/adapters/database/memory.js";
import { memoryWorkflowAdapter } from "../../src/adapters/workflow/memory.js";
import { herald } from "../../src/core/herald.js";
import { resolveRecipient, resolveSubscriberByAnyId } from "../../src/core/subscriber.js";
import type { Herald, HeraldAPI, NotificationRecord, PreferenceRecord, SubscriberRecord } from "../../src/types/config.js";
import type { HeraldPlugin } from "../../src/types/plugin.js";
import type { ChannelType, NotificationWorkflow } from "../../src/types/workflow.js";

interface CoreWorld {
	herald: Herald;
	api: HeraldAPI;
	subscriber: SubscriberRecord | null;
	subscriberInternalId: string | null;
	notifications: NotificationRecord[];
	notificationIds: string[];
	totalCount: number;
	triggerResult: { transactionId: string } | null;
	preferences: PreferenceRecord | null;
	resolvedRecipient: string | null;
	pluginCalls: Record<string, unknown[]>;
	plugin: HeraldPlugin | null;
}

function createWelcomeWorkflow(): NotificationWorkflow {
	return {
		id: "welcome",
		name: "Welcome Workflow",
		steps: [
			{
				stepId: "in-app",
				type: "in_app" as const,
				handler: async ({ subscriber }) => ({
					subject: "Welcome",
					body: `Welcome ${subscriber.externalId}!`,
				}),
			},
		],
	};
}

function createHeraldInstance(opts?: {
	workflows?: NotificationWorkflow[];
	defaultPreferences?: { channels?: Partial<Record<string, boolean>> };
	plugins?: HeraldPlugin[];
}): Herald {
	const db = memoryAdapter();
	const workflow = memoryWorkflowAdapter();
	return herald({
		database: db,
		workflow,
		workflows: opts?.workflows ?? [createWelcomeWorkflow()],
		defaultPreferences: opts?.defaultPreferences,
		plugins: opts?.plugins,
	});
}

// === GIVEN: Herald setup ===

Given("a fresh Herald instance", function (this: CoreWorld) {
	this.herald = createHeraldInstance();
	this.api = this.herald.api;
	this.subscriber = null;
	this.subscriberInternalId = null;
	this.notifications = [];
	this.notificationIds = [];
	this.totalCount = 0;
	this.triggerResult = null;
	this.preferences = null;
	this.resolvedRecipient = null;
	this.pluginCalls = {};
	this.plugin = null;
});

Given("a fresh Herald instance with a {string} workflow", function (this: CoreWorld, workflowId: string) {
	const workflow: NotificationWorkflow = {
		id: workflowId,
		name: `${workflowId} Workflow`,
		steps: [
			{
				stepId: "in-app",
				type: "in_app" as const,
				handler: async ({ subscriber }) => ({
					subject: `${workflowId} notification`,
					body: `Hello ${subscriber.externalId}`,
				}),
			},
		],
	};
	this.herald = createHeraldInstance({ workflows: [workflow] });
	this.api = this.herald.api;
	this.subscriber = null;
	this.subscriberInternalId = null;
	this.notifications = [];
	this.notificationIds = [];
	this.totalCount = 0;
	this.triggerResult = null;
	this.preferences = null;
	this.resolvedRecipient = null;
	this.pluginCalls = {};
	this.plugin = null;
});

Given("a Herald instance with default preferences disabling {string}", function (this: CoreWorld, channel: string) {
	this.herald = createHeraldInstance({
		defaultPreferences: { channels: { [channel]: false } },
	});
	this.api = this.herald.api;
});

Given("a fresh Herald instance with the plugin and a {string} workflow", function (this: CoreWorld, workflowId: string) {
	assert.ok(this.plugin, "Plugin must be created first");
	const workflow: NotificationWorkflow = {
		id: workflowId,
		name: `${workflowId} Workflow`,
		steps: [
			{
				stepId: "in-app",
				type: "in_app" as const,
				handler: async ({ subscriber }) => ({
					subject: `${workflowId} notification`,
					body: `Hello ${subscriber.externalId}`,
				}),
			},
		],
	};
	this.herald = createHeraldInstance({ workflows: [workflow], plugins: [this.plugin] });
	this.api = this.herald.api;
});

// === GIVEN: Subscribers ===

Given("a subscriber {string} exists with email {string}", async function (this: CoreWorld, externalId: string, email: string) {
	const result = await this.api.upsertSubscriber({ externalId, email });
	this.subscriberInternalId = result.id;
});

Given(
	"a subscriber {string} exists with email {string} and phone {string}",
	async function (this: CoreWorld, externalId: string, email: string, phone: string) {
		const result = await this.api.upsertSubscriber({ externalId, email, phone });
		this.subscriberInternalId = result.id;
	},
);

// === GIVEN: Workflows/Triggers ===

Given("I trigger the {string} workflow for subscriber {string}", async function (this: CoreWorld, workflowId: string, externalId: string) {
	await this.api.upsertSubscriber({ externalId, email: `${externalId}@example.com` });
	this.triggerResult = await this.api.trigger({ workflowId, to: externalId, payload: {} });
});

Given(
	"I trigger the {string} workflow for subscriber {string} {int} times",
	async function (this: CoreWorld, workflowId: string, externalId: string, times: number) {
		await this.api.upsertSubscriber({ externalId, email: `${externalId}@example.com` });
		for (let i = 0; i < times; i++) {
			await this.api.trigger({ workflowId, to: externalId, payload: {} });
		}
	},
);

Given("I have the first notification ID for subscriber {string}", async function (this: CoreWorld, externalId: string) {
	const { notifications } = await this.api.getNotifications({ subscriberId: externalId });
	assert.ok(notifications.length > 0, "Expected at least one notification");
	this.notificationIds = [notifications[0]!.id];
});

Given("I have all notification IDs for subscriber {string}", async function (this: CoreWorld, externalId: string) {
	const { notifications } = await this.api.getNotifications({ subscriberId: externalId });
	this.notificationIds = notifications.map((n) => n.id);
});

// === GIVEN: Plugins ===

Given("a plugin with a {string} hook that records calls", function (this: CoreWorld, hookName: string) {
	this.pluginCalls = { [hookName]: [] };
	const calls = this.pluginCalls;
	this.plugin = {
		id: "test-plugin",
		hooks: {
			[hookName]: async (args: unknown) => {
				calls[hookName]!.push(args);
			},
		},
	};
});

Given("a plugin with an {string} hook that records calls", function (this: CoreWorld, hookName: string) {
	this.pluginCalls = { [hookName]: [] };
	const calls = this.pluginCalls;
	this.plugin = {
		id: "test-plugin",
		hooks: {
			[hookName]: async (args: unknown) => {
				calls[hookName]!.push(args);
			},
		},
	};
});

// === WHEN: Subscriber operations ===

When(
	"I upsert a subscriber with externalId {string} and email {string}",
	async function (this: CoreWorld, externalId: string, email: string) {
		const result = await this.api.upsertSubscriber({ externalId, email });
		this.subscriberInternalId = result.id;
	},
);

When("I upsert subscriber {string} with only email {string}", async function (this: CoreWorld, externalId: string, email: string) {
	await this.api.upsertSubscriber({ externalId, email });
});

When("I get subscriber {string}", async function (this: CoreWorld, externalId: string) {
	this.subscriber = await this.api.getSubscriber(externalId);
});

When("I delete subscriber {string}", async function (this: CoreWorld, externalId: string) {
	await this.api.deleteSubscriber(externalId);
});

When("I resolve subscriber by value {string}", async function (this: CoreWorld, value: string) {
	this.subscriber = await resolveSubscriberByAnyId(this.herald.$context.db, value);
});

When("I resolve subscriber by its internal ID", async function (this: CoreWorld) {
	assert.ok(this.subscriberInternalId, "Internal ID must be set first");
	this.subscriber = await resolveSubscriberByAnyId(this.herald.$context.db, this.subscriberInternalId);
});

When("I resolve the recipient for channel {string}", async function (this: CoreWorld, channel: string) {
	assert.ok(this.subscriberInternalId, "Subscriber must exist first");
	const subscriber = await resolveSubscriberByAnyId(this.herald.$context.db, this.subscriberInternalId);
	assert.ok(subscriber, "Subscriber must be resolvable");
	this.subscriber = subscriber;
	this.resolvedRecipient = resolveRecipient(channel as ChannelType, subscriber);
});

// === WHEN: Notification operations ===

When("I list notifications for subscriber {string}", async function (this: CoreWorld, externalId: string) {
	const result = await this.api.getNotifications({ subscriberId: externalId });
	this.notifications = result.notifications;
	this.totalCount = result.totalCount;
});

When("I list notifications for subscriber {string} with limit {int}", async function (this: CoreWorld, externalId: string, limit: number) {
	const result = await this.api.getNotifications({ subscriberId: externalId, limit });
	this.notifications = result.notifications;
	this.totalCount = result.totalCount;
});

When(
	"I list notifications for subscriber {string} with limit {int} and offset {int}",
	async function (this: CoreWorld, externalId: string, limit: number, offset: number) {
		const result = await this.api.getNotifications({ subscriberId: externalId, limit, offset });
		this.notifications = result.notifications;
		this.totalCount = result.totalCount;
	},
);

When(
	"I list notifications for subscriber {string} filtered by read {word}",
	async function (this: CoreWorld, externalId: string, readStr: string) {
		const result = await this.api.getNotifications({ subscriberId: externalId, read: readStr === "true" });
		this.notifications = result.notifications;
		this.totalCount = result.totalCount;
	},
);

When(
	"I list notifications for subscriber {string} filtered by seen {word}",
	async function (this: CoreWorld, externalId: string, seenStr: string) {
		const result = await this.api.getNotifications({ subscriberId: externalId, seen: seenStr === "true" });
		this.notifications = result.notifications;
		this.totalCount = result.totalCount;
	},
);

When(
	"I list notifications for subscriber {string} filtered by archived {word}",
	async function (this: CoreWorld, externalId: string, archivedStr: string) {
		const result = await this.api.getNotifications({ subscriberId: externalId, archived: archivedStr === "true" });
		this.notifications = result.notifications;
		this.totalCount = result.totalCount;
	},
);

When("I mark the notification as {string}", async function (this: CoreWorld, action: string) {
	assert.ok(this.notificationIds.length > 0, "Must have notification IDs");
	await this.api.markNotifications({ ids: this.notificationIds, action: action as "read" | "seen" | "archived" });
});

When("I mark all notifications as {string}", async function (this: CoreWorld, action: string) {
	assert.ok(this.notificationIds.length > 0, "Must have notification IDs");
	await this.api.markNotifications({ ids: this.notificationIds, action: action as "read" | "seen" | "archived" });
});

// === WHEN: Preference operations ===

When("I get preferences for subscriber {string}", async function (this: CoreWorld, externalId: string) {
	this.preferences = await this.api.getPreferences(externalId);
});

When(
	"I update preferences for subscriber {string} setting channel {string} to {word}",
	async function (this: CoreWorld, externalId: string, channel: string, valueStr: string) {
		this.preferences = await this.api.updatePreferences(externalId, {
			channels: { [channel]: valueStr === "true" },
		});
	},
);

When(
	"I update preferences for subscriber {string} setting workflow {string} to {word}",
	async function (this: CoreWorld, externalId: string, workflowId: string, valueStr: string) {
		this.preferences = await this.api.updatePreferences(externalId, {
			workflows: { [workflowId]: valueStr === "true" },
		});
	},
);

When(
	"I update preferences for subscriber {string} setting category {string} to {word}",
	async function (this: CoreWorld, externalId: string, category: string, valueStr: string) {
		this.preferences = await this.api.updatePreferences(externalId, {
			categories: { [category]: valueStr === "true" },
		});
	},
);

// === WHEN: Trigger operations ===

When("I trigger workflow {string} for subscriber {string}", async function (this: CoreWorld, workflowId: string, externalId: string) {
	await this.api.upsertSubscriber({ externalId, email: `${externalId}@example.com` });
	this.triggerResult = await this.api.trigger({ workflowId, to: externalId, payload: {} });
});

When(
	"I trigger workflow {string} for subscriber {string} with transactionId {string}",
	async function (this: CoreWorld, workflowId: string, externalId: string, transactionId: string) {
		await this.api.upsertSubscriber({ externalId, email: `${externalId}@example.com` });
		this.triggerResult = await this.api.trigger({ workflowId, to: externalId, payload: {}, transactionId });
	},
);

When("I trigger workflow {string} for subscribers {string}", async function (this: CoreWorld, workflowId: string, externalIds: string) {
	const ids = externalIds.split(",").map((s) => s.trim());
	for (const id of ids) {
		await this.api.upsertSubscriber({ externalId: id, email: `${id}@example.com` });
	}
	this.triggerResult = await this.api.trigger({ workflowId, to: ids, payload: {} });
});

// === THEN: Subscriber assertions ===

Then("the upsert should return an internal ID", function (this: CoreWorld) {
	assert.ok(this.subscriberInternalId, "Expected an internal ID");
	assert.strictEqual(typeof this.subscriberInternalId, "string");
});

Then("I should be able to retrieve subscriber {string}", async function (this: CoreWorld, externalId: string) {
	const subscriber = await this.api.getSubscriber(externalId);
	assert.ok(subscriber, `Expected subscriber "${externalId}" to exist`);
});

Then("the subscriber should have externalId {string}", function (this: CoreWorld, externalId: string) {
	assert.ok(this.subscriber, "Expected a subscriber");
	assert.strictEqual(this.subscriber.externalId, externalId);
});

Then("the subscriber should have email {string}", function (this: CoreWorld, email: string) {
	assert.ok(this.subscriber, "Expected a subscriber");
	assert.strictEqual(this.subscriber.email, email);
});

Then("the subscriber should be null", function (this: CoreWorld) {
	assert.strictEqual(this.subscriber, null);
});

Then("subscriber {string} should no longer exist", async function (this: CoreWorld, externalId: string) {
	const subscriber = await this.api.getSubscriber(externalId);
	assert.strictEqual(subscriber, null, `Expected subscriber "${externalId}" to be deleted`);
});

Then("subscriber {string} should have email {string}", async function (this: CoreWorld, externalId: string, email: string) {
	const subscriber = await this.api.getSubscriber(externalId);
	assert.ok(subscriber, `Expected subscriber "${externalId}" to exist`);
	assert.strictEqual(subscriber.email, email);
});

Then("subscriber {string} should have phone {string}", async function (this: CoreWorld, externalId: string, phone: string) {
	const subscriber = await this.api.getSubscriber(externalId);
	assert.ok(subscriber, `Expected subscriber "${externalId}" to exist`);
	assert.strictEqual(subscriber.phone, phone);
});

Then("the resolved subscriber should have externalId {string}", function (this: CoreWorld, externalId: string) {
	assert.ok(this.subscriber, "Expected a resolved subscriber");
	assert.strictEqual(this.subscriber.externalId, externalId);
});

Then("the recipient should be {string}", function (this: CoreWorld, expected: string) {
	assert.strictEqual(this.resolvedRecipient, expected);
});

Then("the recipient should be the subscriber's internal ID", function (this: CoreWorld) {
	assert.ok(this.subscriberInternalId, "Expected internal ID to be set");
	assert.strictEqual(this.resolvedRecipient, this.subscriberInternalId);
});

Then("the recipient should be null", function (this: CoreWorld) {
	assert.strictEqual(this.resolvedRecipient, null);
});

// === THEN: Notification assertions ===

Then("I should receive {int} notification(s)", function (this: CoreWorld, count: number) {
	assert.strictEqual(this.notifications.length, count, `Expected ${count} notifications, got ${this.notifications.length}`);
});

Then("I should receive at least {int} notification(s)", function (this: CoreWorld, min: number) {
	assert.ok(this.notifications.length >= min, `Expected at least ${min} notifications, got ${this.notifications.length}`);
});

Then("the total count should be {int}", function (this: CoreWorld, count: number) {
	assert.strictEqual(this.totalCount, count);
});

// === THEN: Preference assertions ===

Then("the preferences should have subscriberId matching {string}", function (this: CoreWorld, externalId: string) {
	assert.ok(this.preferences, "Expected preferences");
	assert.ok(this.preferences.subscriberId, "Expected subscriberId on preferences");
});

Then("the preferences channels should be empty", function (this: CoreWorld) {
	assert.ok(this.preferences, "Expected preferences");
	assert.deepStrictEqual(this.preferences.channels, {});
});

Then("the preferences channel {string} should be {word}", function (this: CoreWorld, channel: string, valueStr: string) {
	assert.ok(this.preferences, "Expected preferences");
	const expected = valueStr === "true";
	assert.strictEqual(this.preferences.channels?.[channel], expected);
});

Then("the returned preferences channel {string} should be {word}", function (this: CoreWorld, channel: string, valueStr: string) {
	assert.ok(this.preferences, "Expected preferences");
	const expected = valueStr === "true";
	assert.strictEqual(this.preferences.channels?.[channel], expected);
});

Then("the returned preferences workflow {string} should be {word}", function (this: CoreWorld, workflowId: string, valueStr: string) {
	assert.ok(this.preferences, "Expected preferences");
	const expected = valueStr === "true";
	assert.strictEqual(this.preferences.workflows?.[workflowId], expected);
});

Then("the returned preferences category {string} should be {word}", function (this: CoreWorld, category: string, valueStr: string) {
	assert.ok(this.preferences, "Expected preferences");
	const expected = valueStr === "true";
	assert.strictEqual(this.preferences.categories?.[category], expected);
});

// === THEN: Trigger assertions ===

Then("the trigger result should have a transactionId", function (this: CoreWorld) {
	assert.ok(this.triggerResult, "Expected a trigger result");
	assert.ok(this.triggerResult.transactionId, "Expected a transactionId");
	assert.strictEqual(typeof this.triggerResult.transactionId, "string");
});

Then("the trigger transactionId should be {string}", function (this: CoreWorld, expected: string) {
	assert.ok(this.triggerResult, "Expected a trigger result");
	assert.strictEqual(this.triggerResult.transactionId, expected);
});

// === THEN: Plugin assertions ===

Then("the {string} hook should have been called", function (this: CoreWorld, hookName: string) {
	assert.ok(this.pluginCalls[hookName], `Expected "${hookName}" calls to be tracked`);
	assert.ok(this.pluginCalls[hookName]!.length > 0, `Expected "${hookName}" hook to have been called at least once`);
});
