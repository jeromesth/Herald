import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryAdapter } from "../src/adapters/database/memory.js";
import { memoryWorkflowAdapter } from "../src/adapters/workflow/memory.js";
import { herald } from "../src/core/herald.js";
import type { Herald, HeraldPlugin, NotificationWorkflow } from "../src/types/index.js";

const testWorkflow: NotificationWorkflow = {
	id: "test-notif",
	name: "Test",
	steps: [{ stepId: "send-in-app", type: "in_app", handler: async () => ({ body: "Test" }) }],
};

describe("Trigger routes — plugin hooks", () => {
	let app: Herald;
	const origin = "https://herald.test";
	const basePath = "/api/notifications";

	const beforeTrigger = vi.fn();
	const afterTrigger = vi.fn();

	function makeRequest(method: string, path: string, body?: unknown): Request {
		return new Request(`${origin}${basePath}${path}`, {
			method,
			headers: { "Content-Type": "application/json" },
			body: body ? JSON.stringify(body) : undefined,
		});
	}

	async function json(response: Response) {
		return response.json();
	}

	beforeEach(() => {
		beforeTrigger.mockReset();
		afterTrigger.mockReset();

		const plugin: HeraldPlugin = {
			id: "test-plugin",
			hooks: { beforeTrigger, afterTrigger },
		};

		app = herald({
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
			workflows: [testWorkflow],
			plugins: [plugin],
		});
	});

	it("runs beforeTrigger and afterTrigger hooks on POST /trigger", async () => {
		const res = await app.handler(
			makeRequest("POST", "/trigger", {
				workflowId: "test-notif",
				to: "user-1",
				payload: { key: "val" },
			}),
		);

		expect(res.status).toBe(200);
		expect(beforeTrigger).toHaveBeenCalledOnce();
		expect(afterTrigger).toHaveBeenCalledOnce();
	});

	it("runs beforeTrigger and afterTrigger hooks on POST /trigger/bulk", async () => {
		const res = await app.handler(
			makeRequest("POST", "/trigger/bulk", {
				events: [
					{ workflowId: "test-notif", to: "user-1", payload: {} },
					{ workflowId: "test-notif", to: "user-2", payload: {} },
				],
			}),
		);

		expect(res.status).toBe(200);
		const body = await json(res);
		expect(body.results).toHaveLength(2);
		expect(beforeTrigger).toHaveBeenCalledTimes(2);
		expect(afterTrigger).toHaveBeenCalledTimes(2);
	});

	it("handles failed bulk events gracefully", async () => {
		// Trigger with a nonexistent workflow to cause failure
		const res = await app.handler(
			makeRequest("POST", "/trigger/bulk", {
				events: [{ workflowId: "nonexistent", to: "user-1", payload: {} }],
			}),
		);

		expect(res.status).toBe(200);
		const body = await json(res);
		expect(body.results[0]?.status).toBe("triggered");
	});
});
