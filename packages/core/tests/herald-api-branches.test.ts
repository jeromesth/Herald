import { beforeEach, describe, expect, it } from "vitest";
import { memoryAdapter } from "../src/adapters/database/memory.js";
import { memoryWorkflowAdapter } from "../src/adapters/workflow/memory.js";
import { herald } from "../src/core/herald.js";
import type { Herald, NotificationWorkflow } from "../src/types/index.js";

const testWorkflow: NotificationWorkflow = {
	id: "test-notif",
	name: "Test",
	steps: [{ stepId: "send-in-app", type: "in_app", handler: async () => ({ body: "Test" }) }],
};

describe("Herald API — branch coverage", () => {
	let app: Herald;

	beforeEach(() => {
		app = herald({
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
			workflows: [testWorkflow],
		});
	});

	async function createNotification() {
		await app.api.upsertSubscriber({ externalId: "user-1" });
		const subscriber = await app.api.getSubscriber("user-1");
		const notifId = crypto.randomUUID();

		await app.$context.db.create({
			model: "notification",
			data: {
				id: notifId,
				subscriberId: subscriber?.id,
				workflowId: "test",
				channel: "in_app",
				body: "Test",
				read: false,
				seen: false,
				archived: false,
				deliveryStatus: "delivered",
				transactionId: "tx-1",
				createdAt: new Date(),
			},
		});

		return { notifId, subscriberId: subscriber?.id };
	}

	describe("getNotifications", () => {
		it("filters by seen status", async () => {
			await createNotification();
			const subscriber = await app.api.getSubscriber("user-1");
			const result = await app.api.getNotifications({
				subscriberId: subscriber?.id ?? "",
				seen: false,
			});
			expect(result.notifications).toHaveLength(1);
		});

		it("filters by archived status", async () => {
			await createNotification();
			const subscriber = await app.api.getSubscriber("user-1");
			const result = await app.api.getNotifications({
				subscriberId: subscriber?.id ?? "",
				archived: false,
			});
			expect(result.notifications).toHaveLength(1);
		});

		it("filters by read status", async () => {
			await createNotification();
			const subscriber = await app.api.getSubscriber("user-1");
			const result = await app.api.getNotifications({
				subscriberId: subscriber?.id ?? "",
				read: false,
			});
			expect(result.notifications).toHaveLength(1);
		});
	});

	describe("markNotifications", () => {
		it("marks as seen", async () => {
			const { notifId } = await createNotification();
			await app.api.markNotifications({ ids: [notifId], action: "seen" });
		});

		it("marks as archived", async () => {
			const { notifId } = await createNotification();
			await app.api.markNotifications({ ids: [notifId], action: "archived" });
		});

		it("marks as read", async () => {
			const { notifId } = await createNotification();
			await app.api.markNotifications({ ids: [notifId], action: "read" });
		});
	});

	describe("renderTemplate", () => {
		it("renders a template with subscriber context", () => {
			const result = app.api.renderTemplate({
				template: "Hello {{subscriber.firstName}}!",
				subscriber: { firstName: "Alice" },
				payload: {},
			});
			expect(result).toBe("Hello Alice!");
		});
	});
});
