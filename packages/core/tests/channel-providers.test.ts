import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryAdapter } from "../src/adapters/database/memory.js";
import { InAppProvider } from "../src/channels/in-app.js";
import type { ChannelProvider, ChannelProviderMessage, ChannelProviderResult } from "../src/channels/provider.js";
import { ChannelRegistry } from "../src/channels/provider.js";
import { SSEManager } from "../src/realtime/sse.js";

function createMockProvider(providerId: string, channelType: string): ChannelProvider & { calls: ChannelProviderMessage[] } {
	const calls: ChannelProviderMessage[] = [];
	return {
		providerId,
		channelType: channelType as ChannelProvider["channelType"],
		calls,
		async send(message: ChannelProviderMessage): Promise<ChannelProviderResult> {
			calls.push(message);
			return { messageId: `msg-${calls.length}`, status: "sent" };
		},
	};
}

describe("ChannelRegistry", () => {
	it("registers and retrieves providers", () => {
		const registry = new ChannelRegistry();
		const provider = createMockProvider("test", "email");

		registry.register(provider);

		expect(registry.has("email")).toBe(true);
		expect(registry.get("email")).toBe(provider);
	});

	it("returns undefined for unregistered channels", () => {
		const registry = new ChannelRegistry();
		expect(registry.get("sms")).toBeUndefined();
		expect(registry.has("sms")).toBe(false);
	});

	it("lists all providers", () => {
		const registry = new ChannelRegistry();
		registry.register(createMockProvider("email-provider", "email"));
		registry.register(createMockProvider("sms-provider", "sms"));

		const all = registry.all();
		expect(all.size).toBe(2);
	});

	it("overwrites provider for same channel type", () => {
		const registry = new ChannelRegistry();
		const first = createMockProvider("first", "email");
		const second = createMockProvider("second", "email");

		registry.register(first);
		registry.register(second);

		expect(registry.get("email")?.providerId).toBe("second");
	});
});

describe("InAppProvider", () => {
	let db: ReturnType<typeof memoryAdapter>;

	beforeEach(() => {
		db = memoryAdapter();
	});

	it("creates a notification record in the database", async () => {
		const provider = new InAppProvider({
			db,
			generateId: () => "notif-1",
		});

		const result = await provider.send({
			subscriberId: "sub-1",
			to: "sub-1",
			subject: "Welcome!",
			body: "Hello world",
			data: { workflowId: "welcome", transactionId: "tx-1" },
		});

		expect(result.status).toBe("sent");
		expect(result.messageId).toBe("notif-1");

		const notification = await db.findOne({
			model: "notification",
			where: [{ field: "id", value: "notif-1" }],
		});
		expect(notification).not.toBeNull();
		expect((notification as Record<string, unknown>).body).toBe("Hello world");
		expect((notification as Record<string, unknown>).channel).toBe("in_app");
		expect((notification as Record<string, unknown>).deliveryStatus).toBe("delivered");
	});

	it("emits SSE event when SSE manager is configured", async () => {
		const sse = new SSEManager();
		const emitSpy = vi.spyOn(sse, "emit");

		const provider = new InAppProvider({
			db,
			generateId: () => "notif-2",
			sse,
		});

		await provider.send({
			subscriberId: "sub-1",
			to: "sub-1",
			body: "Notification body",
			data: { workflowId: "test" },
		});

		expect(emitSpy).toHaveBeenCalledWith(
			"sub-1",
			expect.objectContaining({
				type: "notification:new",
			}),
		);

		sse.close();
	});
});
