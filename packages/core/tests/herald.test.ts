import { describe, expect, it, beforeEach } from "vitest";
import { herald } from "../src/core/herald.js";
import { memoryAdapter } from "../src/adapters/database/memory.js";
import { memoryWorkflowAdapter } from "../src/adapters/workflow/memory.js";
import type { Herald, NotificationWorkflow } from "../src/types/index.js";

const testWorkflow: NotificationWorkflow = {
	id: "welcome",
	name: "Welcome Notification",
	steps: [
		{
			stepId: "send-in-app",
			type: "in_app",
			handler: async ({ subscriber, payload }) => ({
				subject: "Welcome!",
				body: `Hello ${subscriber.externalId}, welcome to ${payload.appName}!`,
			}),
		},
	],
};

describe("herald()", () => {
	let app: Herald;
	let db: ReturnType<typeof memoryAdapter>;
	let workflow: ReturnType<typeof memoryWorkflowAdapter>;

	beforeEach(() => {
		db = memoryAdapter();
		workflow = memoryWorkflowAdapter();
		app = herald({
			appName: "TestApp",
			database: db,
			workflow,
			workflows: [testWorkflow],
		});
	});

	it("creates a herald instance with handler and api", () => {
		expect(app.handler).toBeDefined();
		expect(app.api).toBeDefined();
		expect(app.$context).toBeDefined();
	});

	it("registers workflows with the workflow adapter", () => {
		expect(workflow.workflows.has("welcome")).toBe(true);
	});
});

describe("herald.api — subscribers", () => {
	let app: Herald;

	beforeEach(() => {
		app = herald({
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
		});
	});

	it("upserts and retrieves a subscriber", async () => {
		const result = await app.api.upsertSubscriber({
			externalId: "user-1",
			email: "alice@example.com",
			firstName: "Alice",
		});

		expect(result.id).toBeDefined();

		const subscriber = await app.api.getSubscriber("user-1");
		expect(subscriber).not.toBeNull();
		expect(subscriber!.email).toBe("alice@example.com");
		expect(subscriber!.firstName).toBe("Alice");
	});

	it("updates an existing subscriber on upsert", async () => {
		await app.api.upsertSubscriber({
			externalId: "user-1",
			email: "alice@example.com",
			firstName: "Alice",
		});

		await app.api.upsertSubscriber({
			externalId: "user-1",
			email: "alice-new@example.com",
		});

		const subscriber = await app.api.getSubscriber("user-1");
		expect(subscriber!.email).toBe("alice-new@example.com");
	});

	it("deletes a subscriber", async () => {
		await app.api.upsertSubscriber({
			externalId: "user-1",
			email: "alice@example.com",
		});

		await app.api.deleteSubscriber("user-1");

		const subscriber = await app.api.getSubscriber("user-1");
		expect(subscriber).toBeNull();
	});
});

describe("herald.api — trigger", () => {
	let app: Herald;
	let workflow: ReturnType<typeof memoryWorkflowAdapter>;

	beforeEach(() => {
		workflow = memoryWorkflowAdapter();
		app = herald({
			database: memoryAdapter(),
			workflow,
			workflows: [testWorkflow],
		});
	});

	it("triggers a workflow and returns a transactionId", async () => {
		const result = await app.api.trigger({
			workflowId: "welcome",
			to: "user-1",
			payload: { appName: "TestApp" },
		});

		expect(result.transactionId).toBeDefined();
		expect(workflow.events).toHaveLength(1);
		expect(workflow.events[0]!.workflowId).toBe("welcome");
		expect(workflow.events[0]!.recipients).toEqual(["user-1"]);
	});

	it("supports triggering for multiple recipients", async () => {
		const result = await app.api.trigger({
			workflowId: "welcome",
			to: ["user-1", "user-2", "user-3"],
			payload: { appName: "TestApp" },
		});

		expect(result.transactionId).toBeDefined();
		expect(workflow.events[0]!.recipients).toEqual(["user-1", "user-2", "user-3"]);
	});

	it("uses a custom transactionId when provided", async () => {
		const result = await app.api.trigger({
			workflowId: "welcome",
			to: "user-1",
			payload: {},
			transactionId: "custom-tx-123",
		});

		expect(result.transactionId).toBe("custom-tx-123");
	});

	it("executes channel delivery from workflow steps", async () => {
		const { id: subscriberId } = await app.api.upsertSubscriber({
			externalId: "user-1",
			email: "alice@example.com",
		});

		await app.api.trigger({
			workflowId: "welcome",
			to: "user-1",
			payload: { appName: "TestApp" },
		});

		const notifications = await app.api.getNotifications({ subscriberId });
		expect(notifications.totalCount).toBe(1);
		expect(notifications.notifications[0]!.subject).toBe("Welcome!");
	});
});

describe("herald.api — preferences", () => {
	let app: Herald;

	beforeEach(() => {
		app = herald({
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
		});
	});

	it("returns default preferences for a subscriber", async () => {
		const { id } = await app.api.upsertSubscriber({ externalId: "user-1" });
		const prefs = await app.api.getPreferences(id);

		expect(prefs.subscriberId).toBe(id);
		expect(prefs.channels).toEqual({});
		expect(prefs.workflows).toEqual({});
	});

	it("updates and retrieves preferences", async () => {
		const { id } = await app.api.upsertSubscriber({ externalId: "user-1" });

		const updated = await app.api.updatePreferences(id, {
			channels: { email: false, in_app: true },
			workflows: { "weekly-digest": false },
		});

		expect(updated.channels).toEqual({ email: false, in_app: true });
		expect(updated.workflows).toEqual({ "weekly-digest": false });

		const retrieved = await app.api.getPreferences(id);
		expect(retrieved.channels).toEqual({ email: false, in_app: true });
	});

	it("merges preferences on update", async () => {
		const { id } = await app.api.upsertSubscriber({ externalId: "user-1" });

		await app.api.updatePreferences(id, {
			channels: { email: false },
		});

		await app.api.updatePreferences(id, {
			channels: { sms: false },
		});

		const prefs = await app.api.getPreferences(id);
		expect(prefs.channels).toEqual({ email: false, sms: false });
	});
});

describe("herald.api — topics", () => {
	let app: Herald;

	beforeEach(() => {
		app = herald({
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
		});
	});

	it("adds subscribers to a topic", async () => {
		const { id: sub1 } = await app.api.upsertSubscriber({ externalId: "user-1" });
		const { id: sub2 } = await app.api.upsertSubscriber({ externalId: "user-2" });

		await app.api.addToTopic({
			topicKey: "project:abc",
			subscriberIds: [sub1, sub2],
		});

		// Topic should have been auto-created
		const topic = await app.$context.db.findOne({
			model: "topic",
			where: [{ field: "key", value: "project:abc" }],
		});
		expect(topic).not.toBeNull();
	});

	it("removes subscribers from a topic", async () => {
		const { id: sub1 } = await app.api.upsertSubscriber({ externalId: "user-1" });

		await app.api.addToTopic({
			topicKey: "project:abc",
			subscriberIds: [sub1],
		});

		await app.api.removeFromTopic({
			topicKey: "project:abc",
			subscriberIds: [sub1],
		});
	});
});

describe("herald.api — notifications", () => {
	let app: Herald;

	beforeEach(() => {
		app = herald({
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
		});
	});

	it("creates and queries notifications", async () => {
		const { id: subscriberId } = await app.api.upsertSubscriber({ externalId: "user-1" });

		// Manually create a notification (simulating what the workflow engine would do)
		await app.$context.db.create({
			model: "notification",
			data: {
				id: crypto.randomUUID(),
				subscriberId,
				workflowId: "welcome",
				channel: "in_app",
				subject: "Welcome!",
				body: "Hello, welcome!",
				read: false,
				seen: false,
				archived: false,
				deliveryStatus: "delivered",
				transactionId: "tx-1",
				createdAt: new Date(),
			},
		});

		const result = await app.api.getNotifications({ subscriberId });
		expect(result.notifications).toHaveLength(1);
		expect(result.totalCount).toBe(1);
		expect(result.notifications[0]!.body).toBe("Hello, welcome!");
	});

	it("marks notifications as read", async () => {
		const { id: subscriberId } = await app.api.upsertSubscriber({ externalId: "user-1" });
		const notifId = crypto.randomUUID();

		await app.$context.db.create({
			model: "notification",
			data: {
				id: notifId,
				subscriberId,
				workflowId: "welcome",
				channel: "in_app",
				body: "Test notification",
				read: false,
				seen: false,
				archived: false,
				deliveryStatus: "delivered",
				transactionId: "tx-1",
				createdAt: new Date(),
			},
		});

		await app.api.markNotifications({ ids: [notifId], action: "read" });

		const result = await app.api.getNotifications({ subscriberId });
		expect(result.notifications[0]!.read).toBe(true);
		expect(result.notifications[0]!.readAt).toBeDefined();
	});
});

describe("herald — plugins", () => {
	it("extends functionality via plugins", async () => {
		const hookCalls: string[] = [];

		const testPlugin = {
			id: "test-plugin",
			hooks: {
				beforeTrigger: async () => {
					hookCalls.push("beforeTrigger");
				},
				afterTrigger: async () => {
					hookCalls.push("afterTrigger");
				},
			},
		};

		const workflow = memoryWorkflowAdapter();
		const app = herald({
			database: memoryAdapter(),
			workflow,
			workflows: [testWorkflow],
			plugins: [testPlugin],
		});

		await app.api.trigger({
			workflowId: "welcome",
			to: "user-1",
			payload: {},
		});

		expect(hookCalls).toEqual(["beforeTrigger", "afterTrigger"]);
	});
});
