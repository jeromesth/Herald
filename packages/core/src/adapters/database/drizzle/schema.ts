/**
 * Drizzle ORM schema definitions for Herald.
 *
 * Maps Herald's core schema to Drizzle pgTable definitions.
 * Use these tables with drizzleAdapter() for PostgreSQL databases.
 *
 * @example
 * ```ts
 * import { heraldSchema } from "@herald/core/drizzle";
 * import { drizzle } from "drizzle-orm/node-postgres";
 *
 * const db = drizzle(pool, { schema: heraldSchema });
 * ```
 */
import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const subscribers = pgTable(
	"subscribers",
	{
		id: text("id").primaryKey(),
		externalId: text("external_id").notNull().unique(),
		email: text("email"),
		phone: text("phone"),
		firstName: text("first_name"),
		lastName: text("last_name"),
		avatar: text("avatar"),
		locale: text("locale"),
		timezone: text("timezone"),
		data: jsonb("data"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [uniqueIndex("subscribers_external_id_idx").on(table.externalId), index("subscribers_email_idx").on(table.email)],
);

export const notifications = pgTable(
	"notifications",
	{
		id: text("id").primaryKey(),
		subscriberId: text("subscriber_id")
			.notNull()
			.references(() => subscribers.id, { onDelete: "cascade" }),
		workflowId: text("workflow_id").notNull(),
		channel: text("channel").notNull(),
		subject: text("subject"),
		body: text("body").notNull(),
		actionUrl: text("action_url"),
		avatar: text("avatar"),
		data: jsonb("data"),
		read: boolean("read").notNull().default(false),
		seen: boolean("seen").notNull().default(false),
		archived: boolean("archived").notNull().default(false),
		deliveryStatus: text("delivery_status").notNull().default("queued"),
		transactionId: text("transaction_id").notNull(),
		actorId: text("actor_id"),
		tenantId: text("tenant_id"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		readAt: timestamp("read_at", { withTimezone: true }),
		seenAt: timestamp("seen_at", { withTimezone: true }),
		archivedAt: timestamp("archived_at", { withTimezone: true }),
	},
	(table) => [
		index("notifications_subscriber_id_idx").on(table.subscriberId),
		index("notifications_workflow_id_idx").on(table.workflowId),
		index("notifications_transaction_id_idx").on(table.transactionId),
		index("notifications_tenant_id_idx").on(table.tenantId),
	],
);

export const topics = pgTable(
	"topics",
	{
		id: text("id").primaryKey(),
		key: text("key").notNull().unique(),
		name: text("name").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [uniqueIndex("topics_key_idx").on(table.key)],
);

export const topicSubscribers = pgTable(
	"topic_subscribers",
	{
		id: text("id").primaryKey(),
		topicId: text("topic_id")
			.notNull()
			.references(() => topics.id, { onDelete: "cascade" }),
		subscriberId: text("subscriber_id")
			.notNull()
			.references(() => subscribers.id, { onDelete: "cascade" }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		index("topic_subscribers_topic_id_idx").on(table.topicId),
		index("topic_subscribers_subscriber_id_idx").on(table.subscriberId),
	],
);

export const preferences = pgTable(
	"preferences",
	{
		id: text("id").primaryKey(),
		subscriberId: text("subscriber_id")
			.notNull()
			.references(() => subscribers.id, { onDelete: "cascade" }),
		channels: jsonb("channels"),
		workflows: jsonb("workflows"),
		categories: jsonb("categories"),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [index("preferences_subscriber_id_idx").on(table.subscriberId)],
);

export const channels = pgTable("channels", {
	id: text("id").primaryKey(),
	type: text("type").notNull(),
	provider: text("provider").notNull(),
	name: text("name").notNull(),
	config: jsonb("config"),
	enabled: boolean("enabled").notNull().default(true),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const heraldSchema = {
	subscribers,
	notifications,
	topics,
	topicSubscribers,
	preferences,
	channels,
};
