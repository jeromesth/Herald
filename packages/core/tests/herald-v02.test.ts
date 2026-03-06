import { beforeEach, describe, expect, it } from "vitest";
import { memoryAdapter } from "../src/adapters/database/memory.js";
import { memoryWorkflowAdapter } from "../src/adapters/workflow/memory.js";
import type { ChannelProvider, ChannelProviderMessage, ChannelProviderResult } from "../src/channels/provider.js";
import { herald } from "../src/core/herald.js";
import type { Herald } from "../src/types/index.js";

function createMockEmailProvider(): ChannelProvider & { calls: ChannelProviderMessage[] } {
	const calls: ChannelProviderMessage[] = [];
	return {
		providerId: "mock-email",
		channelType: "email",
		calls,
		async send(message: ChannelProviderMessage): Promise<ChannelProviderResult> {
			calls.push(message);
			return { messageId: `email-${calls.length}`, status: "sent" };
		},
	};
}

describe("herald v0.2 — channel providers", () => {
	let app: Herald;
	let emailProvider: ReturnType<typeof createMockEmailProvider>;

	beforeEach(() => {
		emailProvider = createMockEmailProvider();
		app = herald({
			appName: "TestApp",
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
			providers: [emailProvider],
		});
	});

	it("registers custom providers via the providers option", () => {
		expect(app.$context.channels.has("email")).toBe(true);
		expect(app.$context.channels.get("email")!.providerId).toBe("mock-email");
	});

	it("always registers the in-app provider", () => {
		expect(app.$context.channels.has("in_app")).toBe(true);
	});

	it("sends through a channel provider via api.send", async () => {
		const result = await app.api.send({
			channel: "email",
			subscriberId: "sub-1",
			to: "alice@example.com",
			subject: "Test",
			body: "<p>Hello</p>",
		});

		expect(result.status).toBe("sent");
		expect(result.messageId).toBe("email-1");
		expect(emailProvider.calls).toHaveLength(1);
		expect(emailProvider.calls[0]!.to).toBe("alice@example.com");
	});

	it("throws for unregistered channel", async () => {
		await expect(
			app.api.send({
				channel: "sms",
				subscriberId: "sub-1",
				to: "+1234567890",
				body: "Hello",
			}),
		).rejects.toThrow('No provider registered for channel "sms"');
	});

	it("runs beforeSend/afterSend hooks", async () => {
		const hookCalls: string[] = [];
		const plugin = {
			id: "send-hooks",
			hooks: {
				beforeSend: async () => {
					hookCalls.push("before");
				},
				afterSend: async () => {
					hookCalls.push("after");
				},
			},
		};

		app = herald({
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
			providers: [emailProvider],
			plugins: [plugin],
		});

		await app.api.send({
			channel: "email",
			subscriberId: "sub-1",
			to: "alice@example.com",
			body: "Test",
		});

		expect(hookCalls).toEqual(["before", "after"]);
	});
});

describe("herald v0.2 — in-app provider integration", () => {
	let app: Herald;

	beforeEach(() => {
		app = herald({
			appName: "TestApp",
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
		});
	});

	it("sends in-app notification and stores in database", async () => {
		const { id: subscriberId } = await app.api.upsertSubscriber({
			externalId: "user-1",
		});

		const result = await app.api.send({
			channel: "in_app",
			subscriberId,
			to: subscriberId,
			subject: "Welcome",
			body: "Hello from Herald!",
			data: { workflowId: "welcome", transactionId: "tx-1" },
		});

		expect(result.status).toBe("sent");

		const notifications = await app.api.getNotifications({ subscriberId });
		expect(notifications.totalCount).toBe(1);
		expect(notifications.notifications[0]!.body).toBe("Hello from Herald!");
	});
});

describe("herald v0.2 — SSE realtime", () => {
	it("enables SSE when realtime is true", () => {
		const app = herald({
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
			realtime: true,
		});

		expect(app.$context.sse).toBeDefined();
	});

	it("disables SSE by default", () => {
		const app = herald({
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
		});

		expect(app.$context.sse).toBeUndefined();
	});

	it("enables SSE with custom heartbeat", () => {
		const app = herald({
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
			realtime: { heartbeatMs: 5000 },
		});

		expect(app.$context.sse).toBeDefined();
	});
});

describe("herald v0.2 — template rendering API", () => {
	let app: Herald;

	beforeEach(() => {
		app = herald({
			appName: "MyApp",
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
		});
	});

	it("renders templates through the API", () => {
		const result = app.api.renderTemplate({
			template: "Hello {{ subscriber.firstName }}, welcome to {{ app.name }}!",
			subscriber: { firstName: "Alice" },
			payload: {},
		});

		expect(result).toBe("Hello Alice, welcome to MyApp!");
	});

	it("renders templates with payload data", () => {
		const result = app.api.renderTemplate({
			template: "Your order #{{ payload.orderId }} has shipped.",
			subscriber: {},
			payload: { orderId: "12345" },
		});

		expect(result).toBe("Your order #12345 has shipped.");
	});
});

describe("herald v0.2 — email channel config shorthand", () => {
	it("builds custom email provider from channels config", async () => {
		const sentEmails: unknown[] = [];

		const app = herald({
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
			channels: {
				email: {
					provider: "custom",
					from: "noreply@example.com",
					send: async (args) => {
						sentEmails.push(args);
					},
				},
			},
		});

		expect(app.$context.channels.has("email")).toBe(true);

		await app.api.send({
			channel: "email",
			subscriberId: "sub-1",
			to: "alice@example.com",
			subject: "Test",
			body: "<p>Hello</p>",
		});

		expect(sentEmails).toHaveLength(1);
		expect((sentEmails[0] as Record<string, unknown>).to).toBe("alice@example.com");
	});

	it("can disable in-app provider", () => {
		const app = herald({
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
			channels: { inApp: { enabled: false } },
		});

		expect(app.$context.channels.has("in_app")).toBe(false);
	});
});

describe("herald v0.2 — SSE route", () => {
	it("returns 501 when realtime is not enabled", async () => {
		const app = herald({
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
		});

		const response = await app.handler(new Request("http://localhost/api/notifications/notifications/user-1/stream"));

		expect(response.status).toBe(501);
	});

	it("returns 404 for unknown subscriber", async () => {
		const app = herald({
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
			realtime: true,
		});

		const response = await app.handler(new Request("http://localhost/api/notifications/notifications/unknown/stream"));

		expect(response.status).toBe(404);
		app.$context.sse?.close();
	});

	it("returns SSE stream for valid subscriber", async () => {
		const app = herald({
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
			realtime: true,
		});

		await app.api.upsertSubscriber({ externalId: "user-1" });

		const response = await app.handler(new Request("http://localhost/api/notifications/notifications/user-1/stream"));

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("text/event-stream");

		app.$context.sse?.close();
	});
});
