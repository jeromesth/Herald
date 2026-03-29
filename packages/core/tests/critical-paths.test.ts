import { beforeEach, describe, expect, it } from "vitest";
import { memoryAdapter } from "../src/adapters/database/memory.js";
import { memoryWorkflowAdapter } from "../src/adapters/workflow/memory.js";
import { HTTPError, buildCorsHeaders, parseJsonBody } from "../src/api/router.js";
import { herald } from "../src/core/herald.js";
import type { Herald, HeraldPlugin, NotificationWorkflow } from "../src/types/index.js";

const testWorkflow: NotificationWorkflow = {
	id: "test-notif",
	name: "Test Notification",
	steps: [
		{
			stepId: "send-in-app",
			type: "in_app",
			handler: async () => ({ body: "Test message" }),
		},
	],
};

// ---------------------------------------------------------------------------
// CORS — security-critical multi-origin reflection
// ---------------------------------------------------------------------------

describe("buildCorsHeaders — multi-origin CORS", () => {
	it("reflects the request origin when it matches the allow-list", () => {
		const headers = buildCorsHeaders({ origin: ["https://a.com", "https://b.com"] }, "https://b.com");
		expect(headers["Access-Control-Allow-Origin"]).toBe("https://b.com");
		expect(headers.Vary).toBe("Origin");
	});

	it("falls back to first configured origin when request origin is not in allow-list", () => {
		const headers = buildCorsHeaders({ origin: ["https://a.com", "https://b.com"] }, "https://evil.com");
		expect(headers["Access-Control-Allow-Origin"]).toBe("https://a.com");
		expect(headers.Vary).toBe("Origin");
	});

	it("falls back to first configured origin when no request origin is provided", () => {
		const headers = buildCorsHeaders({ origin: ["https://a.com", "https://b.com"] }, null);
		expect(headers["Access-Control-Allow-Origin"]).toBe("https://a.com");
		expect(headers.Vary).toBe("Origin");
	});

	it("returns empty headers when cors is disabled", () => {
		expect(buildCorsHeaders(undefined)).toEqual({});
		expect(buildCorsHeaders(false)).toEqual({});
	});
});

// ---------------------------------------------------------------------------
// parseJsonBody — DoS protection via request size limits
// ---------------------------------------------------------------------------

describe("parseJsonBody — size limits", () => {
	it("rejects requests exceeding Content-Length limit", async () => {
		const request = new Request("https://test.com", {
			method: "POST",
			headers: { "Content-Length": String(2 * 1024 * 1024) },
			body: "{}",
		});

		await expect(parseJsonBody(request)).rejects.toThrow("Request body too large");
		await expect(parseJsonBody(request)).rejects.toThrow(expect.objectContaining({ status: 413 }));
	});

	it("rejects requests with body exceeding size after reading", async () => {
		const hugeBody = "x".repeat(1024 * 1024 + 1);
		const request = new Request("https://test.com", {
			method: "POST",
			body: hugeBody,
		});

		await expect(parseJsonBody(request)).rejects.toThrow("Request body too large");
	});

	it("returns empty object when body is empty", async () => {
		const request = new Request("https://test.com", {
			method: "POST",
			body: "",
		});

		const result = await parseJsonBody(request);
		expect(result).toEqual({});
	});

	it("rejects invalid JSON with 400", async () => {
		const request = new Request("https://test.com", {
			method: "POST",
			body: "not-json{",
		});

		await expect(parseJsonBody(request)).rejects.toThrow("Invalid JSON body");
	});
});

// ---------------------------------------------------------------------------
// Router — error handling (HTTPError vs generic 500)
// ---------------------------------------------------------------------------

describe("router — error handling", () => {
	let app: Herald;
	const origin = "https://herald.test";
	const basePath = "/api/notifications";

	function makeRequest(method: string, path: string, body?: unknown): Request {
		return new Request(`${origin}${basePath}${path}`, {
			method,
			headers: { "Content-Type": "application/json" },
			body: body ? JSON.stringify(body) : undefined,
		});
	}

	it("returns generic 500 without leaking internal error details", async () => {
		const failingWorkflow: NotificationWorkflow = {
			id: "fail-wf",
			name: "Failing Workflow",
			steps: [
				{
					stepId: "boom",
					type: "in_app",
					handler: async () => {
						throw new Error("SECRET_INTERNAL_DB_PASSWORD_123");
					},
				},
			],
		};

		// Use a workflow adapter that triggers synchronously and propagates errors
		app = herald({
			appName: "TestApp",
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
			workflows: [failingWorkflow],
		});

		const res = await app.handler(makeRequest("POST", "/trigger", { workflowId: "fail-wf", to: "user-1", payload: {} }));

		// Should NOT contain the internal error message in the response body
		const text = await res.text();
		expect(text).not.toContain("SECRET_INTERNAL_DB_PASSWORD");
	});

	it("returns 404 for unknown routes", async () => {
		app = herald({
			appName: "TestApp",
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
			workflows: [testWorkflow],
		});

		const res = await app.handler(makeRequest("GET", "/nonexistent"));
		expect(res.status).toBe(404);
	});
});

// ---------------------------------------------------------------------------
// Trigger — afterTrigger plugin error handling
// ---------------------------------------------------------------------------

describe("trigger — plugin hook error handling", () => {
	it("does not fail the request when afterTrigger plugin hook throws", async () => {
		const crashPlugin: HeraldPlugin = {
			id: "crash-plugin",
			name: "Crash Plugin",
			hooks: {
				afterTrigger: async () => {
					throw new Error("plugin crash");
				},
			},
		};

		const app = herald({
			appName: "TestApp",
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
			workflows: [testWorkflow],
			plugins: [crashPlugin],
		});

		const res = await app.handler(
			new Request("https://test.com/api/notifications/trigger", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ workflowId: "test-notif", to: "user-1", payload: {} }),
			}),
		);

		// Request should succeed despite the plugin throwing
		expect(res.status).toBe(200);
	});
});
