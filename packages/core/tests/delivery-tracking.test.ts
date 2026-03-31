import { beforeEach, describe, expect, it } from "vitest";
import { memoryAdapter } from "../src/adapters/database/memory.js";
import { memoryWorkflowAdapter } from "../src/adapters/workflow/memory.js";
import { herald } from "../src/core/herald.js";
import type { Herald, NotificationRecord, NotificationWorkflow } from "../src/types/index.js";

const testWorkflow: NotificationWorkflow = {
	id: "welcome",
	name: "Welcome",
	steps: [{ stepId: "send-in-app", type: "in_app", handler: async () => ({ body: "Hello!" }) }],
};

describe("Delivery Tracking", () => {
	let app: Herald;

	function makeRequest(method: string, path: string, body?: unknown): Request {
		return new Request(`https://test.local/api/notifications${path}`, {
			method,
			headers: { "Content-Type": "application/json" },
			body: body ? JSON.stringify(body) : undefined,
		});
	}

	beforeEach(() => {
		app = herald({
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
			workflows: [testWorkflow],
			activityLog: true,
		});
	});

	it("updates delivery status via API method", async () => {
		await app.api.upsertSubscriber({ externalId: "user-1", email: "u@test.com" });
		await app.api.trigger({ workflowId: "welcome", to: "user-1", payload: {} });

		const { notifications } = await app.api.getNotifications({ subscriberId: "user-1" });
		expect(notifications.length).toBeGreaterThan(0);
		const notification = notifications[0] as NotificationRecord;

		// Set to "sent" first so we can transition to "delivered"
		await app.$context.db.update({
			model: "notification",
			where: [{ field: "id", value: notification.id }],
			update: { deliveryStatus: "sent" },
		});

		await app.api.updateDeliveryStatus({
			notificationId: notification.id,
			status: "delivered",
		});

		const { notifications: updated } = await app.api.getNotifications({ subscriberId: "user-1" });
		expect(updated[0]?.deliveryStatus).toBe("delivered");
	});

	it("records notification.status_changed event on status update", async () => {
		await app.api.upsertSubscriber({ externalId: "user-1", email: "u@test.com" });
		await app.api.trigger({ workflowId: "welcome", to: "user-1", payload: {} });

		const { notifications } = await app.api.getNotifications({ subscriberId: "user-1" });
		const notification = notifications[0] as NotificationRecord;

		// Set to "sent" so we can transition to "bounced"
		await app.$context.db.update({
			model: "notification",
			where: [{ field: "id", value: notification.id }],
			update: { deliveryStatus: "sent" },
		});

		await app.api.updateDeliveryStatus({
			notificationId: notification.id,
			status: "bounced",
			detail: { reason: "mailbox full" },
		});

		const { entries } = await app.api.getActivityLog({ workflowId: "welcome" });
		const statusChangedEvents = entries.filter((e) => e.event === "notification.status_changed");

		expect(statusChangedEvents.length).toBeGreaterThan(0);
		const event = statusChangedEvents[0] as (typeof statusChangedEvents)[number];
		expect(event.detail?.previousStatus).toBe("sent");
		expect(event.detail?.newStatus).toBe("bounced");
		expect(event.detail?.reason).toBe("mailbox full");
	});

	it("emits event with undefined channel when notification has unknown channel type", async () => {
		await app.api.upsertSubscriber({ externalId: "user-1", email: "u@test.com" });
		await app.api.trigger({ workflowId: "welcome", to: "user-1", payload: {} });

		const { notifications } = await app.api.getNotifications({ subscriberId: "user-1" });
		const notification = notifications[0] as NotificationRecord;

		// Set to "sent" with an invalid channel to simulate a custom/unknown channel type
		await app.$context.db.update({
			model: "notification",
			where: [{ field: "id", value: notification.id }],
			update: { channel: "carrier_pigeon", deliveryStatus: "sent" },
		});

		await app.api.updateDeliveryStatus({
			notificationId: notification.id,
			status: "delivered",
		});

		const { entries } = await app.api.getActivityLog({ workflowId: "welcome" });
		const statusEvent = entries.find((e) => e.event === "notification.status_changed");

		expect(statusEvent).toBeDefined();
		// Invalid channel should be undefined, not blindly cast
		expect(statusEvent?.channel).toBeNull();
	});

	it("rejects invalid status transitions", async () => {
		await app.api.upsertSubscriber({ externalId: "user-1", email: "u@test.com" });
		await app.api.trigger({ workflowId: "welcome", to: "user-1", payload: {} });

		const { notifications } = await app.api.getNotifications({ subscriberId: "user-1" });
		const notification = notifications[0] as NotificationRecord;

		// In-app provider sets deliveryStatus to "delivered" which is terminal
		await expect(
			app.api.updateDeliveryStatus({
				notificationId: notification.id,
				status: "queued",
			}),
		).rejects.toThrow(/invalid status transition/i);
	});

	it("rejects invalid status transitions via HTTP route", async () => {
		await app.api.upsertSubscriber({ externalId: "user-1", email: "u@test.com" });
		await app.api.trigger({ workflowId: "welcome", to: "user-1", payload: {} });

		const { notifications } = await app.api.getNotifications({ subscriberId: "user-1" });
		const notification = notifications[0] as NotificationRecord;

		const res = await app.handler(
			makeRequest("POST", "/delivery-status", {
				notificationId: notification.id,
				status: "queued",
			}),
		);

		expect(res.status).toBe(422);
	});

	it("updateDeliveryStatus API emits event with correct detail", async () => {
		await app.api.upsertSubscriber({ externalId: "user-1", email: "u@test.com" });
		await app.api.trigger({ workflowId: "welcome", to: "user-1", payload: {} });

		const { notifications } = await app.api.getNotifications({ subscriberId: "user-1" });
		const notification = notifications[0] as NotificationRecord;

		// Set to "sent" so we can transition
		await app.$context.db.update({
			model: "notification",
			where: [{ field: "id", value: notification.id }],
			update: { deliveryStatus: "sent" },
		});

		await app.api.updateDeliveryStatus({
			notificationId: notification.id,
			status: "delivered",
			detail: { provider: "test-provider" },
		});

		const { entries } = await app.api.getActivityLog({ workflowId: "welcome" });
		const statusEvent = entries.find((e) => e.event === "notification.status_changed");

		expect(statusEvent).toBeDefined();
		expect(statusEvent?.detail?.notificationId).toBe(notification.id);
		expect(statusEvent?.detail?.previousStatus).toBe("sent");
		expect(statusEvent?.detail?.newStatus).toBe("delivered");
		expect(statusEvent?.detail?.provider).toBe("test-provider");
	});

	it("throws when updating non-existent notification", async () => {
		await expect(
			app.api.updateDeliveryStatus({
				notificationId: "non-existent",
				status: "delivered",
			}),
		).rejects.toThrow(/not found/i);
	});

	describe("POST /delivery-status route", () => {
		it("updates delivery status via HTTP endpoint", async () => {
			await app.api.upsertSubscriber({ externalId: "user-1", email: "u@test.com" });
			await app.api.trigger({ workflowId: "welcome", to: "user-1", payload: {} });

			const { notifications } = await app.api.getNotifications({ subscriberId: "user-1" });
			const notification = notifications[0] as NotificationRecord;

			// Set to "sent" so we can transition to "delivered"
			await app.$context.db.update({
				model: "notification",
				where: [{ field: "id", value: notification.id }],
				update: { deliveryStatus: "sent" },
			});

			const res = await app.handler(
				makeRequest("POST", "/delivery-status", {
					notificationId: notification.id,
					status: "delivered",
				}),
			);
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.deliveryStatus).toBe("delivered");
		});

		it("returns 400 for invalid status", async () => {
			const res = await app.handler(
				makeRequest("POST", "/delivery-status", {
					notificationId: "some-id",
					status: "invalid-status",
				}),
			);

			expect(res.status).toBe(400);
		});

		it("returns 400 for missing notificationId", async () => {
			const res = await app.handler(
				makeRequest("POST", "/delivery-status", {
					status: "delivered",
				}),
			);

			expect(res.status).toBe(400);
		});

		it("handles unknown channel type gracefully in delivery-status route", async () => {
			await app.api.upsertSubscriber({ externalId: "user-1", email: "u@test.com" });
			await app.api.trigger({ workflowId: "welcome", to: "user-1", payload: {} });

			const { notifications } = await app.api.getNotifications({ subscriberId: "user-1" });
			const notification = notifications[0] as NotificationRecord;

			// Set to "sent" with an invalid channel value
			await app.$context.db.update({
				model: "notification",
				where: [{ field: "id", value: notification.id }],
				update: { channel: "unknown_channel", deliveryStatus: "sent" },
			});

			const res = await app.handler(
				makeRequest("POST", "/delivery-status", {
					notificationId: notification.id,
					status: "delivered",
				}),
			);

			expect(res.status).toBe(200);

			const { entries } = await app.api.getActivityLog({ workflowId: "welcome" });
			const statusEvent = entries.find((e) => e.event === "notification.status_changed");
			expect(statusEvent).toBeDefined();
			expect(statusEvent?.channel).toBeNull();
		});

		it("returns 404 for non-existent notification", async () => {
			const res = await app.handler(
				makeRequest("POST", "/delivery-status", {
					notificationId: "non-existent",
					status: "delivered",
				}),
			);

			expect(res.status).toBe(404);
		});
	});
});
