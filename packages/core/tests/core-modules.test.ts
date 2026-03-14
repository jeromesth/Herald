import { describe, expect, it, vi } from "vitest";
import { memoryAdapter } from "../src/adapters/database/memory.js";
import type { ChannelProvider } from "../src/channels/provider.js";
import { ChannelRegistry } from "../src/channels/provider.js";
import { initializePlugins } from "../src/core/plugins.js";
import { buildEmailProvider } from "../src/core/providers.js";
import { sendThroughProvider } from "../src/core/send.js";
import { HandlebarsEngine } from "../src/templates/engine.js";
import { LayoutRegistry } from "../src/templates/layouts.js";
import type { HeraldContext } from "../src/types/config.js";

function createMockContext(overrides?: Partial<HeraldContext>): HeraldContext {
	const db = memoryAdapter();
	const channels = new ChannelRegistry();
	const templateEngine = new HandlebarsEngine();
	const layouts = new LayoutRegistry();

	return {
		db,
		workflow: {
			adapterId: "test",
			registerWorkflow: () => {},
			trigger: async () => ({ transactionId: "tx-1", status: "triggered" }),
			cancel: async () => {},
			getHandler: () => null,
		},
		channels,
		options: {
			database: db,
			workflow: {
				adapterId: "test",
				registerWorkflow: () => {},
				trigger: async () => ({ transactionId: "tx-1", status: "triggered" }),
				cancel: async () => {},
				getHandler: () => null,
			},
		},
		generateId: () => crypto.randomUUID(),
		transactionWorkflowMap: new Map(),
		templateEngine,
		layouts,
		...overrides,
	} as HeraldContext;
}

describe("buildEmailProvider", () => {
	it("builds a sendgrid provider", () => {
		const provider = buildEmailProvider({
			provider: "sendgrid",
			apiKey: "sg-key",
			from: "noreply@test.com",
		});
		expect(provider.providerId).toBe("sendgrid");
		expect(provider.channelType).toBe("email");
	});

	it("builds a resend provider", () => {
		const provider = buildEmailProvider({
			provider: "resend",
			apiKey: "re-key",
			from: "noreply@test.com",
		});
		expect(provider.providerId).toBe("resend");
	});

	it("builds a postmark provider", () => {
		const provider = buildEmailProvider({
			provider: "postmark",
			apiKey: "pm-key",
			from: "noreply@test.com",
		});
		expect(provider.providerId).toBe("postmark");
	});

	it("builds an SES provider with send function", () => {
		const provider = buildEmailProvider({
			provider: "ses",
			from: "noreply@test.com",
			send: async () => {},
		});
		expect(provider.providerId).toBe("ses");
	});

	it("builds a custom provider with send function", () => {
		const provider = buildEmailProvider({
			provider: "custom",
			from: "noreply@test.com",
			send: async () => {},
		});
		expect(provider.providerId).toBe("custom");
	});

	it("throws when sendgrid apiKey is missing", () => {
		expect(() => buildEmailProvider({ provider: "sendgrid", from: "noreply@test.com" } as never)).toThrow("apiKey");
	});

	it("throws when resend apiKey is missing", () => {
		expect(() => buildEmailProvider({ provider: "resend", from: "noreply@test.com" } as never)).toThrow("apiKey");
	});

	it("throws when postmark apiKey is missing", () => {
		expect(() => buildEmailProvider({ provider: "postmark", from: "noreply@test.com" } as never)).toThrow("apiKey");
	});

	it("throws when SES send function is missing", () => {
		expect(() => buildEmailProvider({ provider: "ses", from: "noreply@test.com" })).toThrow("send function");
	});

	it("throws when custom send function is missing", () => {
		expect(() => buildEmailProvider({ provider: "custom", from: "noreply@test.com" })).toThrow("send function");
	});

	it("throws for unknown provider", () => {
		expect(() => buildEmailProvider({ provider: "unknown" as never, from: "noreply@test.com" })).toThrow("Unknown email provider");
	});
});

describe("initializePlugins", () => {
	it("does nothing when no plugins are provided", async () => {
		const ctx = createMockContext();
		await initializePlugins(ctx, undefined);
		await initializePlugins(ctx, []);
	});

	it("calls plugin init and merges context", async () => {
		const ctx = createMockContext();
		const plugin = {
			id: "test-plugin",
			init: vi.fn().mockResolvedValue({ context: { customField: "value" } }),
		};

		await initializePlugins(ctx, [plugin]);

		expect(plugin.init).toHaveBeenCalledWith(ctx);
		expect((ctx as Record<string, unknown>).customField).toBe("value");
	});

	it("skips plugins without init", async () => {
		const ctx = createMockContext();
		await initializePlugins(ctx, [{ id: "no-init-plugin" }]);
	});

	it("handles init returning no context", async () => {
		const ctx = createMockContext();
		const plugin = {
			id: "test-plugin",
			init: vi.fn().mockResolvedValue(undefined),
		};
		await initializePlugins(ctx, [plugin]);
	});

	it("throws descriptive error when plugin init fails", async () => {
		const ctx = createMockContext();
		const plugin = {
			id: "broken-plugin",
			init: vi.fn().mockRejectedValue(new Error("init boom")),
		};

		await expect(initializePlugins(ctx, [plugin])).rejects.toThrow('plugin "broken-plugin" init error: init boom');
	});

	it("handles non-Error throws in plugin init", async () => {
		const ctx = createMockContext();
		const plugin = {
			id: "weird-plugin",
			init: vi.fn().mockRejectedValue("string error"),
		};

		await expect(initializePlugins(ctx, [plugin])).rejects.toThrow("string error");
	});
});

describe("sendThroughProvider", () => {
	it("sends message through registered provider", async () => {
		const mockProvider: ChannelProvider = {
			providerId: "test-provider",
			channelType: "in_app",
			send: vi.fn().mockResolvedValue({ messageId: "msg-1", status: "sent" }),
		};

		const ctx = createMockContext();
		ctx.channels.register(mockProvider);

		const result = await sendThroughProvider(ctx, {
			channel: "in_app",
			subscriberId: "sub-1",
			to: "sub-1",
			body: "Hello {{payload.name}}",
			data: { payload: { name: "World" } },
		});

		expect(result.messageId).toBe("msg-1");
		expect(result.status).toBe("sent");
	});

	it("throws when no provider is registered for channel", async () => {
		const ctx = createMockContext();

		await expect(
			sendThroughProvider(ctx, {
				channel: "sms",
				subscriberId: "sub-1",
				to: "sub-1",
				body: "Hello",
			}),
		).rejects.toThrow('No provider registered for channel "sms"');
	});

	it("runs beforeSend and afterSend plugin hooks", async () => {
		const mockProvider: ChannelProvider = {
			providerId: "test-provider",
			channelType: "in_app",
			send: vi.fn().mockResolvedValue({ messageId: "msg-1", status: "sent" }),
		};

		const beforeSend = vi.fn().mockResolvedValue({ subject: "Modified Subject" });
		const afterSend = vi.fn();

		const ctx = createMockContext({
			options: {
				database: memoryAdapter(),
				workflow: {
					adapterId: "test",
					registerWorkflow: () => {},
					trigger: async () => ({ transactionId: "tx-1", status: "triggered" }),
					cancel: async () => {},
					getHandler: () => null,
				},
				plugins: [
					{
						id: "hook-plugin",
						hooks: { beforeSend, afterSend },
					},
				],
			},
		} as Partial<HeraldContext>);
		ctx.channels.register(mockProvider);

		await sendThroughProvider(ctx, {
			channel: "in_app",
			subscriberId: "sub-1",
			to: "sub-1",
			body: "Test",
		});

		expect(beforeSend).toHaveBeenCalledOnce();
		expect(afterSend).toHaveBeenCalledOnce();
	});

	it("logs error when provider send fails", async () => {
		const mockProvider: ChannelProvider = {
			providerId: "test-provider",
			channelType: "in_app",
			send: vi.fn().mockResolvedValue({ messageId: "", status: "failed", error: "send error" }),
		};

		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const ctx = createMockContext();
		ctx.channels.register(mockProvider);

		const result = await sendThroughProvider(ctx, {
			channel: "in_app",
			subscriberId: "sub-1",
			to: "sub-1",
			body: "Test",
		});

		expect(result.status).toBe("failed");
		expect(consoleSpy).toHaveBeenCalled();
		consoleSpy.mockRestore();
	});

	it("applies beforeSend patches including data and extra keys", async () => {
		const mockProvider: ChannelProvider = {
			providerId: "test-provider",
			channelType: "in_app",
			send: vi.fn().mockResolvedValue({ messageId: "msg-1", status: "sent" }),
		};

		const ctx = createMockContext({
			options: {
				database: memoryAdapter(),
				workflow: {
					adapterId: "test",
					registerWorkflow: () => {},
					trigger: async () => ({ transactionId: "tx-1", status: "triggered" }),
					cancel: async () => {},
					getHandler: () => null,
				},
				plugins: [
					{
						id: "patch-plugin",
						hooks: {
							beforeSend: vi.fn().mockResolvedValue({
								to: "new-to",
								body: "new-body",
								actionUrl: "https://action.url",
								layoutId: "custom-layout",
								data: { extra: "value" },
								unknownKey: "extra-data",
							}),
						},
					},
				],
			},
		} as Partial<HeraldContext>);
		ctx.channels.register(mockProvider);

		await sendThroughProvider(ctx, {
			channel: "in_app",
			subscriberId: "sub-1",
			to: "sub-1",
			body: "Original",
		});

		const sentCall = (mockProvider.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
		expect(sentCall.to).toBe("new-to");
	});

	it("renders email templates with layout", async () => {
		const mockProvider: ChannelProvider = {
			providerId: "test-email",
			channelType: "email",
			send: vi.fn().mockResolvedValue({ messageId: "msg-1", status: "sent" }),
		};

		const ctx = createMockContext();
		ctx.channels.register(mockProvider);

		await sendThroughProvider(ctx, {
			channel: "email",
			subscriberId: "sub-1",
			to: "user@test.com",
			subject: "Hello",
			body: "<p>Test body</p>",
		});

		expect(mockProvider.send).toHaveBeenCalledOnce();
	});

	it("renders non-email templates with template engine", async () => {
		const mockProvider: ChannelProvider = {
			providerId: "test-sms",
			channelType: "sms",
			send: vi.fn().mockResolvedValue({ messageId: "msg-1", status: "sent" }),
		};

		const ctx = createMockContext();
		ctx.channels.register(mockProvider);

		await sendThroughProvider(ctx, {
			channel: "sms",
			subscriberId: "sub-1",
			to: "+1234567890",
			subject: "Subject: {{payload.name}}",
			body: "Hello {{payload.name}}",
			data: { payload: { name: "World" } },
		});

		const sentCall = (mockProvider.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
		expect(sentCall.body).toBe("Hello World");
		expect(sentCall.subject).toBe("Subject: World");
	});
});
