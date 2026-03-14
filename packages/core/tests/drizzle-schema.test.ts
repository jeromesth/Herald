import { describe, expect, it } from "vitest";
import {
	channels,
	heraldSchema,
	notifications,
	preferences,
	subscribers,
	topicSubscribers,
	topics,
} from "../src/adapters/database/drizzle/schema.js";

describe("Drizzle schema definitions", () => {
	it("exports all expected tables", () => {
		expect(heraldSchema.subscribers).toBe(subscribers);
		expect(heraldSchema.notifications).toBe(notifications);
		expect(heraldSchema.topics).toBe(topics);
		expect(heraldSchema.topicSubscribers).toBe(topicSubscribers);
		expect(heraldSchema.preferences).toBe(preferences);
		expect(heraldSchema.channels).toBe(channels);
	});

	it("subscribers table has expected columns", () => {
		expect(subscribers.id).toBeDefined();
		expect(subscribers.externalId).toBeDefined();
		expect(subscribers.email).toBeDefined();
		expect(subscribers.phone).toBeDefined();
		expect(subscribers.firstName).toBeDefined();
		expect(subscribers.lastName).toBeDefined();
		expect(subscribers.avatar).toBeDefined();
		expect(subscribers.locale).toBeDefined();
		expect(subscribers.timezone).toBeDefined();
		expect(subscribers.data).toBeDefined();
		expect(subscribers.createdAt).toBeDefined();
		expect(subscribers.updatedAt).toBeDefined();
	});

	it("notifications table has expected columns", () => {
		expect(notifications.id).toBeDefined();
		expect(notifications.subscriberId).toBeDefined();
		expect(notifications.workflowId).toBeDefined();
		expect(notifications.channel).toBeDefined();
		expect(notifications.subject).toBeDefined();
		expect(notifications.body).toBeDefined();
		expect(notifications.read).toBeDefined();
		expect(notifications.seen).toBeDefined();
		expect(notifications.archived).toBeDefined();
		expect(notifications.deliveryStatus).toBeDefined();
		expect(notifications.transactionId).toBeDefined();
	});

	it("topics table has expected columns", () => {
		expect(topics.id).toBeDefined();
		expect(topics.key).toBeDefined();
		expect(topics.name).toBeDefined();
	});

	it("topicSubscribers table has expected columns", () => {
		expect(topicSubscribers.id).toBeDefined();
		expect(topicSubscribers.topicId).toBeDefined();
		expect(topicSubscribers.subscriberId).toBeDefined();
	});

	it("preferences table has expected columns", () => {
		expect(preferences.id).toBeDefined();
		expect(preferences.subscriberId).toBeDefined();
		expect(preferences.channels).toBeDefined();
		expect(preferences.workflows).toBeDefined();
		expect(preferences.purposes).toBeDefined();
	});

	it("channels table has expected columns", () => {
		expect(channels.id).toBeDefined();
		expect(channels.type).toBeDefined();
		expect(channels.provider).toBeDefined();
		expect(channels.name).toBeDefined();
		expect(channels.config).toBeDefined();
		expect(channels.enabled).toBeDefined();
	});
});
