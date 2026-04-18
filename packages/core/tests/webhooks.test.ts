import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryAdapter } from "../src/adapters/database/memory.js";
import { memoryWorkflowAdapter } from "../src/adapters/workflow/memory.js";
import { herald } from "../src/core/herald.js";
import type { WebhookConfig, WebhookEventPayload } from "../src/types/activity.js";
import type { Herald, NotificationWorkflow } from "../src/types/index.js";

const testWorkflow: NotificationWorkflow = {
	id: "welcome",
	name: "Welcome",
	steps: [{ stepId: "send-in-app", type: "in_app", handler: async () => ({ body: "Hello!" }) }],
};

// Yield the event loop so fire-and-forget webhook deliveries complete.
async function flushWebhooks() {
	await new Promise((r) => setTimeout(r, 20));
}

describe("Webhook Events", () => {
	let app: Herald;
	let fetchSpy: ReturnType<typeof vi.fn>;
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
		globalThis.fetch = fetchSpy;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("sends webhook events to configured endpoints on trigger", async () => {
		const webhooks: WebhookConfig[] = [{ url: "https://hooks.example.com/herald" }];

		app = herald({
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
			workflows: [testWorkflow],
			webhooks,
		});

		await app.api.upsertSubscriber({ externalId: "user-1", email: "u@test.com" });
		await app.api.trigger({ workflowId: "welcome", to: "user-1", payload: {} });
		await flushWebhooks();

		// Should have called fetch multiple times for different events
		expect(fetchSpy).toHaveBeenCalled();

		const calls = fetchSpy.mock.calls;
		const payloads: WebhookEventPayload[] = calls
			.filter((call: unknown[]) => call[0] === "https://hooks.example.com/herald")
			.map((call: unknown[]) => JSON.parse((call[1] as { body: string }).body));

		const eventTypes = payloads.map((p) => p.event);
		expect(eventTypes).toContain("workflow.triggered");
		expect(eventTypes).toContain("notification.sent");
	});

	it("filters events by webhook config", async () => {
		const webhooks: WebhookConfig[] = [{ url: "https://hooks.example.com/herald", events: ["notification.sent"] }];

		app = herald({
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
			workflows: [testWorkflow],
			webhooks,
		});

		await app.api.upsertSubscriber({ externalId: "user-1", email: "u@test.com" });
		await app.api.trigger({ workflowId: "welcome", to: "user-1", payload: {} });
		await flushWebhooks();

		const calls = fetchSpy.mock.calls;
		const payloads: WebhookEventPayload[] = calls
			.filter((call: unknown[]) => call[0] === "https://hooks.example.com/herald")
			.map((call: unknown[]) => JSON.parse((call[1] as { body: string }).body));

		for (const payload of payloads) {
			expect(payload.event).toBe("notification.sent");
		}
	});

	it("includes custom headers in webhook requests", async () => {
		const webhooks: WebhookConfig[] = [
			{
				url: "https://hooks.example.com/herald",
				headers: { "X-Custom-Header": "test-value" },
				events: ["workflow.triggered"],
			},
		];

		app = herald({
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
			workflows: [testWorkflow],
			webhooks,
		});

		await app.api.upsertSubscriber({ externalId: "user-1", email: "u@test.com" });
		await app.api.trigger({ workflowId: "welcome", to: "user-1", payload: {} });
		await flushWebhooks();

		const matchedCall = fetchSpy.mock.calls.find((call: unknown[]) => call[0] === "https://hooks.example.com/herald");
		expect(matchedCall).toBeDefined();

		const requestInit = (matchedCall as unknown[])[1] as { headers: Record<string, string> };
		expect(requestInit.headers["X-Custom-Header"]).toBe("test-value");
	});

	it("includes HMAC signature when secret is configured", async () => {
		const webhooks: WebhookConfig[] = [
			{
				url: "https://hooks.example.com/herald",
				secret: "test-secret",
				events: ["workflow.triggered"],
			},
		];

		app = herald({
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
			workflows: [testWorkflow],
			webhooks,
		});

		await app.api.upsertSubscriber({ externalId: "user-1", email: "u@test.com" });
		await app.api.trigger({ workflowId: "welcome", to: "user-1", payload: {} });
		await flushWebhooks();

		const matchedCall = fetchSpy.mock.calls.find((call: unknown[]) => call[0] === "https://hooks.example.com/herald");
		expect(matchedCall).toBeDefined();

		const requestInit = (matchedCall as unknown[])[1] as { headers: Record<string, string> };
		expect(requestInit.headers["X-Herald-Signature"]).toBeDefined();
		expect(requestInit.headers["X-Herald-Signature"]).toMatch(/^sha256=[a-f0-9]+$/);
	});

	it("does not throw when webhook delivery fails", async () => {
		fetchSpy.mockRejectedValue(new Error("Network error"));

		const webhooks: WebhookConfig[] = [{ url: "https://hooks.example.com/herald" }];

		app = herald({
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
			workflows: [testWorkflow],
			webhooks,
		});

		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await app.api.upsertSubscriber({ externalId: "user-1", email: "u@test.com" });

		// Should not throw even if webhooks fail
		await expect(app.api.trigger({ workflowId: "welcome", to: "user-1", payload: {} })).resolves.toBeDefined();

		consoleSpy.mockRestore();
	});

	it("sends events to multiple webhook endpoints", async () => {
		const webhooks: WebhookConfig[] = [
			{ url: "https://hooks1.example.com/herald", events: ["workflow.triggered"] },
			{ url: "https://hooks2.example.com/herald", events: ["workflow.triggered"] },
		];

		app = herald({
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
			workflows: [testWorkflow],
			webhooks,
		});

		await app.api.upsertSubscriber({ externalId: "user-1", email: "u@test.com" });
		await app.api.trigger({ workflowId: "welcome", to: "user-1", payload: {} });
		await flushWebhooks();

		const urls = fetchSpy.mock.calls.map((call: unknown[]) => call[0]);
		expect(urls).toContain("https://hooks1.example.com/herald");
		expect(urls).toContain("https://hooks2.example.com/herald");
	});

	it("does not block api.trigger on slow webhook delivery", async () => {
		// Webhook that takes 2s to respond — should NOT block trigger from resolving.
		let resolveSlow: (value: Response) => void = () => {};
		const slowPromise = new Promise<Response>((resolve) => {
			resolveSlow = resolve;
		});
		fetchSpy.mockReturnValue(slowPromise);

		const webhooks: WebhookConfig[] = [{ url: "https://hooks.example.com/slow" }];

		app = herald({
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
			workflows: [testWorkflow],
			webhooks,
		});

		await app.api.upsertSubscriber({ externalId: "user-1", email: "u@test.com" });

		const start = Date.now();
		await app.api.trigger({ workflowId: "welcome", to: "user-1", payload: {} });
		const elapsed = Date.now() - start;

		// trigger must resolve quickly even though webhook is still pending
		expect(elapsed).toBeLessThan(500);

		// cleanup
		resolveSlow(new Response("ok", { status: 200 }));
	});

	it("logs error and continues when webhook returns non-200 response", async () => {
		const webhooks: WebhookConfig[] = [{ url: "https://hooks.example.com/fail" }];

		fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Internal Server Error", { status: 500 }));

		app = herald({
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
			workflows: [testWorkflow],
			webhooks,
		});

		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await app.api.upsertSubscriber({ externalId: "user-1", email: "u@test.com" });

		// Should not throw despite webhook returning 500
		await expect(app.api.trigger({ workflowId: "welcome", to: "user-1", payload: {} })).resolves.toBeDefined();

		// Give fire-and-forget time to complete
		await new Promise((r) => setTimeout(r, 50));

		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("[herald] Webhook delivery failed"));
		consoleSpy.mockRestore();
	});
});
