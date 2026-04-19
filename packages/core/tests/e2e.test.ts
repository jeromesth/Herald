/**
 * End-to-end tests: full user-facing flows through app.handler and app.api.
 *
 * Each suite exercises a complete scenario from HTTP request to database state,
 * covering gaps that unit tests leave open (topic delivery, CORS, HMAC signing,
 * plugin preference hooks, custom endpoints, basePath, payloadSchema, etc.).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { memoryAdapter } from "../src/adapters/database/memory.js";
import { memoryWorkflowAdapter } from "../src/adapters/workflow/memory.js";
import { herald } from "../src/core/herald.js";
import type { Herald, HeraldPlugin, NotificationWorkflow, WebhookConfig } from "../src/types/index.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const BASE = "https://herald.test";
const PATH = "/api/notifications";

function req(method: string, path: string, body?: unknown, headers?: Record<string, string>): Request {
	return new Request(`${BASE}${PATH}${path}`, {
		method,
		headers: { "Content-Type": "application/json", ...headers },
		body: body != null ? JSON.stringify(body) : undefined,
	});
}

async function json(r: Response) {
	return r.json();
}

async function flushAsync(ms = 30) {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

const inAppWorkflow: NotificationWorkflow = {
	id: "welcome",
	name: "Welcome",
	steps: [
		{
			stepId: "notify",
			type: "in_app",
			handler: async ({ subscriber, payload }) => ({
				subject: "Welcome",
				body: `Hi ${subscriber.externalId}, ref: ${payload.ref ?? "none"}`,
			}),
		},
	],
};

// ─── 1. Full trigger → notify → mark-read flow ───────────────────────────────

describe("E2E: full trigger → notify → mark-read", () => {
	let app: Herald;

	beforeEach(() => {
		app = herald({
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
			workflows: [inAppWorkflow],
			activityLog: true,
		});
	});

	it("delivers an in-app notification and surfaces it via GET then marks it read", async () => {
		await app.api.upsertSubscriber({ externalId: "user-e2e", email: "e2e@test.com" });

		const triggerRes = await app.handler(req("POST", "/trigger", { workflowId: "welcome", to: "user-e2e", payload: { ref: "abc" } }));
		expect(triggerRes.status).toBe(200);
		const { transactionId } = await json(triggerRes);
		expect(typeof transactionId).toBe("string");

		const notifRes = await app.handler(req("GET", "/notifications/user-e2e"));
		expect(notifRes.status).toBe(200);
		const { notifications, totalCount } = await json(notifRes);
		expect(totalCount).toBe(1);
		expect(notifications[0].body).toBe("Hi user-e2e, ref: abc");
		expect(notifications[0].read).toBe(false);

		const notifId = notifications[0].id;
		const markRes = await app.handler(req("POST", "/notifications/mark", { ids: [notifId], action: "read" }));
		expect(markRes.status).toBe(200);

		const afterRes = await app.handler(req("GET", "/notifications/user-e2e?read=true"));
		expect(afterRes.status).toBe(200);
		const afterBody = await json(afterRes);
		expect(afterBody.notifications[0].read).toBe(true);
	});

	it("mark-all-read flips all unread notifications for the subscriber", async () => {
		await app.api.upsertSubscriber({ externalId: "user-bulk-read" });
		await app.api.trigger({ workflowId: "welcome", to: "user-bulk-read", payload: {} });
		await app.api.trigger({ workflowId: "welcome", to: "user-bulk-read", payload: {} });

		const countRes = await app.handler(req("GET", "/notifications/user-bulk-read/count?read=false"));
		expect(countRes.status).toBe(200);
		expect((await json(countRes)).count).toBe(2);

		const markAllRes = await app.handler(req("POST", "/notifications/mark-all-read", { subscriberId: "user-bulk-read" }));
		expect(markAllRes.status).toBe(200);

		const afterCount = await app.handler(req("GET", "/notifications/user-bulk-read/count?read=false"));
		expect((await json(afterCount)).count).toBe(0);
	});
});

// ─── 2. Topics: CRUD + manual fan-out trigger ────────────────────────────────
//
// Herald topics are a subscriber-group management feature. Fan-out (triggering
// to all members) is the caller's responsibility: resolve members from the DB,
// then pass the array of IDs to `trigger`. There is no automatic "topic:X"
// expansion in the trigger path.

describe("E2E: topics — CRUD and fan-out trigger", () => {
	let app: Herald;

	beforeEach(() => {
		app = herald({
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
			workflows: [inAppWorkflow],
		});
	});

	it("creates a topic and lists it", async () => {
		const createRes = await app.handler(req("POST", "/topics", { key: "team-alpha", name: "Team Alpha" }));
		expect(createRes.status).toBe(201);

		const listRes = await app.handler(req("GET", "/topics"));
		expect(listRes.status).toBe(200);
		const body = await json(listRes);
		expect(body.topics.some((t: { key: string }) => t.key === "team-alpha")).toBe(true);
	});

	it("delivers notifications to all topic members via explicit fan-out", async () => {
		const { id: idA } = await app.api.upsertSubscriber({ externalId: "sub-a" });
		const { id: idB } = await app.api.upsertSubscriber({ externalId: "sub-b" });
		const { id: idC } = await app.api.upsertSubscriber({ externalId: "sub-c" });

		// Add members using their internal IDs (as expected by addToTopic)
		await app.api.addToTopic({ topicKey: "crew", subscriberIds: [idA, idB, idC] });

		// Resolve topic members and trigger to the expanded list of externalIds
		const crewTopic = await app.$context.db.findOne<{ id: string }>({ model: "topic", where: [{ field: "key", value: "crew" }] });
		if (!crewTopic) throw new Error("topic 'crew' not found");
		const members = await app.$context.db.findMany<{ subscriberId: string }>({
			model: "topicSubscriber",
			where: [{ field: "topicId", value: crewTopic.id }],
		});
		const recipientIds = members.map((m) => m.subscriberId);

		await app.api.trigger({ workflowId: "welcome", to: recipientIds, payload: {} });

		for (const extId of ["sub-a", "sub-b", "sub-c"]) {
			const notifs = await json(await app.handler(req("GET", `/notifications/${extId}`)));
			expect(notifs.totalCount).toBe(1);
		}
	});

	it("removing a member before fan-out excludes them from delivery", async () => {
		const { id: idStay } = await app.api.upsertSubscriber({ externalId: "member-stay" });
		const { id: idLeave } = await app.api.upsertSubscriber({ externalId: "member-leave" });

		await app.api.addToTopic({ topicKey: "beta", subscriberIds: [idStay, idLeave] });
		await app.api.removeFromTopic({ topicKey: "beta", subscriberIds: [idLeave] });

		// Resolve remaining members
		const betaTopic = await app.$context.db.findOne<{ id: string }>({ model: "topic", where: [{ field: "key", value: "beta" }] });
		if (!betaTopic) throw new Error("topic 'beta' not found");
		const members = await app.$context.db.findMany<{ subscriberId: string }>({
			model: "topicSubscriber",
			where: [{ field: "topicId", value: betaTopic.id }],
		});

		await app.api.trigger({ workflowId: "welcome", to: members.map((m) => m.subscriberId), payload: {} });

		const stayNotifs = await json(await app.handler(req("GET", "/notifications/member-stay")));
		expect(stayNotifs.totalCount).toBe(1);

		const leaveNotifs = await json(await app.handler(req("GET", "/notifications/member-leave")));
		expect(leaveNotifs.totalCount).toBe(0);
	});
});

// ─── 3. Multi-recipient delivery ─────────────────────────────────────────────

describe("E2E: multi-recipient array trigger", () => {
	let app: Herald;

	beforeEach(() => {
		app = herald({
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
			workflows: [inAppWorkflow],
		});
	});

	it("creates a separate notification record for each recipient", async () => {
		const ids = ["rec-1", "rec-2", "rec-3"];
		for (const id of ids) await app.api.upsertSubscriber({ externalId: id });

		const res = await app.handler(req("POST", "/trigger", { workflowId: "welcome", to: ids, payload: {} }));
		expect(res.status).toBe(200);

		for (const id of ids) {
			const notifRes = await json(await app.handler(req("GET", `/notifications/${id}`)));
			expect(notifRes.totalCount).toBe(1);
		}
	});
});

// ─── 4. CORS preflight ───────────────────────────────────────────────────────

describe("E2E: CORS preflight", () => {
	it("responds 204 to OPTIONS with CORS headers when cors:true", async () => {
		const app = herald({
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
			cors: true,
		});

		const res = await app.handler(
			new Request(`${BASE}${PATH}/trigger`, {
				method: "OPTIONS",
				headers: {
					Origin: "https://myapp.com",
					"Access-Control-Request-Method": "POST",
				},
			}),
		);

		expect(res.status).toBe(204);
		expect(res.headers.get("access-control-allow-origin")).toBeTruthy();
		expect(res.headers.get("access-control-allow-methods")).toBeTruthy();
	});

	it("reflects the matched origin when cors is an origin array", async () => {
		const app = herald({
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
			cors: { origin: ["https://allowed.com"] },
		});

		const res = await app.handler(
			new Request(`${BASE}${PATH}/trigger`, {
				method: "OPTIONS",
				headers: { Origin: "https://allowed.com", "Access-Control-Request-Method": "POST" },
			}),
		);

		expect(res.status).toBe(204);
		expect(res.headers.get("access-control-allow-origin")).toBe("https://allowed.com");
	});
});

// ─── 5. Bulk preferences HTTP ────────────────────────────────────────────────

describe("E2E: PUT /preferences/bulk", () => {
	let app: Herald;

	beforeEach(async () => {
		app = herald({
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
		});
		await app.api.upsertSubscriber({ externalId: "pref-user-1" });
		await app.api.upsertSubscriber({ externalId: "pref-user-2" });
	});

	it("updates preferences for multiple subscribers in one request", async () => {
		const res = await app.handler(
			req("PUT", "/preferences/bulk", {
				updates: [
					{ subscriberId: "pref-user-1", channels: { email: false } },
					{ subscriberId: "pref-user-2", channels: { in_app: true } },
				],
			}),
		);

		expect(res.status).toBe(200);
		const body = await json(res);
		expect(body.results).toHaveLength(2);
		expect(body.results.every((r: { error?: string }) => !r.error)).toBe(true);
	});

	it("returns 207 when some subscribers in the bulk update are not found", async () => {
		const res = await app.handler(
			req("PUT", "/preferences/bulk", {
				updates: [
					{ subscriberId: "pref-user-1", channels: { email: false } },
					{ subscriberId: "ghost-user", channels: { email: true } },
				],
			}),
		);

		expect(res.status).toBe(207);
		const body = await json(res);
		const hasSuccess = body.results.some((r: { error?: string }) => !r.error);
		const hasError = body.results.some((r: { error?: string }) => !!r.error);
		expect(hasSuccess).toBe(true);
		expect(hasError).toBe(true);
	});
});

// ─── 6. basePath customisation ───────────────────────────────────────────────

describe("E2E: basePath customisation", () => {
	it("routes requests under the custom basePath", async () => {
		const customPath = "/notify/v2";
		const app = herald({
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
			basePath: customPath,
			workflows: [inAppWorkflow],
		});

		await app.api.upsertSubscriber({ externalId: "path-user" });
		await app.api.trigger({ workflowId: "welcome", to: "path-user", payload: {} });

		const res = await app.handler(new Request(`${BASE}${customPath}/notifications/path-user`));
		expect(res.status).toBe(200);
		const body = await json(res);
		expect(body.totalCount).toBe(1);
	});

	it("returns 404 for requests on the default path when basePath is customised", async () => {
		const app = herald({
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
			basePath: "/custom",
		});

		const res = await app.handler(new Request(`${BASE}/api/notifications/notifications/someone`));
		expect(res.status).toBe(404);
	});
});

// ─── 7. payloadSchema field registration ─────────────────────────────────────
//
// `payloadSchema` is a Zod schema attached to a workflow definition for
// documentation and IDE tooling purposes. The trigger HTTP route does NOT
// validate the incoming payload against it — that is left to the caller.
// These tests confirm the field is accepted at registration time and that
// triggers succeed regardless of payload contents.

describe("E2E: payloadSchema on NotificationWorkflow", () => {
	let app: Herald;

	beforeEach(() => {
		const strictWorkflow: NotificationWorkflow = {
			id: "typed-wf",
			name: "Typed Workflow",
			payloadSchema: z.object({ orderId: z.string(), amount: z.number().positive() }),
			steps: [{ stepId: "notify", type: "in_app", handler: async () => ({ body: "Order confirmed" }) }],
		};

		app = herald({
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
			workflows: [strictWorkflow],
		});
	});

	it("workflow with payloadSchema is registered and trigger returns 200 for valid payload", async () => {
		await app.api.upsertSubscriber({ externalId: "order-user" });
		const res = await app.handler(
			req("POST", "/trigger", {
				workflowId: "typed-wf",
				to: "order-user",
				payload: { orderId: "ORD-42", amount: 99.99 },
			}),
		);
		expect(res.status).toBe(200);
	});

	it("trigger does not enforce payloadSchema at the HTTP layer (caller is responsible for validation)", async () => {
		// Payload deliberately violates the schema (negative amount), but the
		// trigger route does not validate it — this confirms the current contract.
		await app.api.upsertSubscriber({ externalId: "order-user-2" });
		const res = await app.handler(
			req("POST", "/trigger", {
				workflowId: "typed-wf",
				to: "order-user-2",
				payload: { orderId: "ORD-BAD", amount: -5 },
			}),
		);
		expect(res.status).toBe(200);
	});
});

// ─── 8. Webhook HMAC signature ───────────────────────────────────────────────

describe("E2E: webhook HMAC signature", () => {
	let fetchSpy: ReturnType<typeof vi.fn>;
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		fetchSpy = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
		globalThis.fetch = fetchSpy;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("adds X-Herald-Signature and X-Herald-Timestamp headers when a secret is configured", async () => {
		const webhooks: WebhookConfig[] = [{ url: "https://hooks.example.com/test", secret: "super-secret" }];
		const app = herald({
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
			workflows: [inAppWorkflow],
			webhooks,
		});

		await app.api.upsertSubscriber({ externalId: "hook-user" });
		await app.api.trigger({ workflowId: "welcome", to: "hook-user", payload: {} });
		await flushAsync();

		const calls = fetchSpy.mock.calls.filter((c: unknown[]) => c[0] === "https://hooks.example.com/test");
		expect(calls.length).toBeGreaterThan(0);

		const firstCallHeaders = (calls[0] as [string, RequestInit])[1].headers as Record<string, string>;
		expect(firstCallHeaders["X-Herald-Signature"]).toMatch(/^sha256=[0-9a-f]{64}$/);
		expect(firstCallHeaders["X-Herald-Timestamp"]).toBeTruthy();
	});

	it("verifiable: HMAC-SHA256 signature matches expected value", async () => {
		const secret = "verify-me";
		const webhooks: WebhookConfig[] = [{ url: "https://hooks.example.com/verify", secret, events: ["workflow.triggered"] }];
		const app = herald({
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
			workflows: [inAppWorkflow],
			webhooks,
		});

		await app.api.upsertSubscriber({ externalId: "sig-user" });
		await app.api.trigger({ workflowId: "welcome", to: "sig-user", payload: {} });
		await flushAsync();

		const calls = fetchSpy.mock.calls.filter((c: unknown[]) => c[0] === "https://hooks.example.com/verify");
		expect(calls.length).toBeGreaterThan(0);

		const [, init] = calls[0] as [string, RequestInit];
		const headers = init.headers as Record<string, string>;
		const timestamp = headers["X-Herald-Timestamp"];
		const signature = headers["X-Herald-Signature"];
		const body = init.body as string;

		// Re-derive the HMAC to verify correctness
		const encoder = new TextEncoder();
		const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
		const sigBytes = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${body}`));
		const expected = `sha256=${Array.from(new Uint8Array(sigBytes))
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("")}`;

		expect(signature).toBe(expected);
	});
});

// ─── 9. Plugin preference hooks ──────────────────────────────────────────────

describe("E2E: plugin preference hooks", () => {
	it("calls beforePreferenceCheck and afterPreferenceCheck during workflow execution", async () => {
		const beforePreferenceCheck = vi.fn().mockResolvedValue(undefined);
		const afterPreferenceCheck = vi.fn().mockResolvedValue(undefined);

		const plugin: HeraldPlugin = {
			id: "pref-hooks-plugin",
			hooks: { beforePreferenceCheck, afterPreferenceCheck },
		};

		const app = herald({
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
			workflows: [inAppWorkflow],
			plugins: [plugin],
		});

		await app.api.upsertSubscriber({ externalId: "pref-hooks-user" });
		await app.api.trigger({ workflowId: "welcome", to: "pref-hooks-user", payload: {} });

		expect(beforePreferenceCheck).toHaveBeenCalledWith(expect.objectContaining({ workflowId: "welcome", channel: "in_app" }));
		expect(afterPreferenceCheck).toHaveBeenCalledWith(expect.objectContaining({ workflowId: "welcome", channel: "in_app", allowed: true }));
	});

	it("blocks delivery when beforePreferenceCheck returns override:false", async () => {
		const plugin: HeraldPlugin = {
			id: "block-plugin",
			hooks: {
				beforePreferenceCheck: vi.fn().mockResolvedValue({ override: false }),
			},
		};

		const app = herald({
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
			workflows: [inAppWorkflow],
			plugins: [plugin],
		});

		await app.api.upsertSubscriber({ externalId: "blocked-user" });
		await app.api.trigger({ workflowId: "welcome", to: "blocked-user", payload: {} });

		const notifs = await json(await app.handler(req("GET", "/notifications/blocked-user")));
		expect(notifs.totalCount).toBe(0);
	});
});

// ─── 10. Plugin custom endpoints ─────────────────────────────────────────────

describe("E2E: plugin custom endpoints", () => {
	it("exposes a plugin-defined endpoint through app.handler", async () => {
		const plugin: HeraldPlugin = {
			id: "custom-ep",
			endpoints: {
				healthCheck: {
					method: "GET",
					path: "/health",
					handler: async (_req, ctx) => new Response(JSON.stringify({ status: "ok", app: ctx.options.appName }), { status: 200 }),
				},
			},
		};

		const app = herald({
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
			plugins: [plugin],
			appName: "herald-e2e",
		});

		const res = await app.handler(new Request(`${BASE}${PATH}/health`));
		expect(res.status).toBe(200);
		const body = await json(res);
		expect(body.status).toBe("ok");
		expect(body.app).toBe("herald-e2e");
	});
});

// ─── 11. Activity log end-to-end ─────────────────────────────────────────────

describe("E2E: activity log HTTP query", () => {
	let app: Herald;

	beforeEach(() => {
		app = herald({
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
			workflows: [inAppWorkflow],
			activityLog: true,
		});
	});

	it("GET /activity?transactionId= returns events for a triggered workflow", async () => {
		await app.api.upsertSubscriber({ externalId: "activity-user" });
		const { transactionId } = await app.api.trigger({ workflowId: "welcome", to: "activity-user", payload: {} });

		const res = await app.handler(req("GET", `/activity?transactionId=${transactionId}`));
		expect(res.status).toBe(200);
		const body = await json(res);
		expect(body.totalCount).toBeGreaterThan(0);
		const eventTypes = body.entries.map((e: { event: string }) => e.event);
		expect(eventTypes).toContain("workflow.triggered");
	});

	it("GET /activity/:transactionId returns the full trace sorted ascending", async () => {
		await app.api.upsertSubscriber({ externalId: "trace-user" });
		const { transactionId } = await app.api.trigger({ workflowId: "welcome", to: "trace-user", payload: {} });

		const res = await app.handler(req("GET", `/activity/${transactionId}`));
		expect(res.status).toBe(200);
		const body = await json(res);
		expect(Array.isArray(body.entries)).toBe(true);
		expect(body.entries.length).toBeGreaterThan(0);

		const dates = body.entries.map((e: { createdAt: string }) => new Date(e.createdAt).getTime());
		for (let i = 1; i < dates.length; i++) {
			expect(dates[i]).toBeGreaterThanOrEqual(dates[i - 1]);
		}
	});
});

// ─── 12. Delivery status transitions ─────────────────────────────────────────
//
// In-app notifications are created with deliveryStatus = "delivered" (terminal).
// To exercise the state machine we seed a notification in "queued" state directly
// via the DB adapter, then drive it through valid and invalid transitions.

describe("E2E: delivery status state machine", () => {
	let app: Herald;

	beforeEach(() => {
		app = herald({
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
		});
	});

	async function seedQueuedNotification(subscriberExternalId: string): Promise<string> {
		const { id: subscriberId } = await app.api.upsertSubscriber({ externalId: subscriberExternalId });
		const notifId = crypto.randomUUID();
		await app.$context.db.create({
			model: "notification",
			data: {
				id: notifId,
				subscriberId,
				workflowId: "email-wf",
				channel: "email",
				body: "Your order shipped",
				read: false,
				seen: false,
				archived: false,
				deliveryStatus: "queued",
				transactionId: crypto.randomUUID(),
				createdAt: new Date(),
			},
		});
		return notifId;
	}

	it("accepts valid queued → sent transition via POST /delivery-status", async () => {
		const notifId = await seedQueuedNotification("status-user");

		const res = await app.handler(req("POST", "/delivery-status", { notificationId: notifId, status: "sent" }));
		expect(res.status).toBe(200);
	});

	it("chains queued → sent → delivered successfully", async () => {
		const notifId = await seedQueuedNotification("chain-user");

		const r1 = await app.handler(req("POST", "/delivery-status", { notificationId: notifId, status: "sent" }));
		expect(r1.status).toBe(200);

		const r2 = await app.handler(req("POST", "/delivery-status", { notificationId: notifId, status: "delivered" }));
		expect(r2.status).toBe(200);
	});

	it("returns 422 for an invalid transition from a terminal state", async () => {
		const notifId = await seedQueuedNotification("terminal-user");

		// Drive to terminal state
		await app.handler(req("POST", "/delivery-status", { notificationId: notifId, status: "sent" }));
		await app.handler(req("POST", "/delivery-status", { notificationId: notifId, status: "delivered" }));

		// "delivered" is terminal — any further transition must be rejected
		const badRes = await app.handler(req("POST", "/delivery-status", { notificationId: notifId, status: "sent" }));
		expect(badRes.status).toBe(422);
	});
});

// ─── 13. Cancel workflow ──────────────────────────────────────────────────────

describe("E2E: DELETE /trigger/:transactionId", () => {
	it("cancels a triggered workflow without error", async () => {
		const app = herald({
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
			workflows: [inAppWorkflow],
		});

		await app.api.upsertSubscriber({ externalId: "cancel-user" });
		const triggerRes = await app.handler(req("POST", "/trigger", { workflowId: "welcome", to: "cancel-user", payload: {} }));
		const { transactionId } = await json(triggerRes);

		const cancelRes = await app.handler(new Request(`${BASE}${PATH}/trigger/${transactionId}`, { method: "DELETE" }));
		expect(cancelRes.status).toBe(200);
	});
});
