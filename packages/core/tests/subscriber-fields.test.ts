import { beforeEach, describe, expect, it } from "vitest";
import { memoryAdapter } from "../src/adapters/database/memory.js";
import { memoryWorkflowAdapter } from "../src/adapters/workflow/memory.js";
import { herald } from "../src/core/herald.js";
import type { Herald, NotificationWorkflow } from "../src/types/index.js";

const testWorkflow: NotificationWorkflow = {
	id: "test-notif",
	name: "Test",
	steps: [{ stepId: "send-in-app", type: "in_app", handler: async () => ({ body: "Test" }) }],
};

describe("Subscriber routes — additional fields", () => {
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

	async function json(response: Response) {
		return response.json();
	}

	beforeEach(() => {
		app = herald({
			database: memoryAdapter(),
			workflow: memoryWorkflowAdapter(),
			workflows: [testWorkflow],
			subscriber: {
				additionalFields: {
					company: { type: "string" },
					age: { type: "number" },
					active: { type: "boolean" },
					metadata: { type: "json" },
				},
			},
		});
	});

	it("creates subscriber with configured additional fields", async () => {
		const res = await app.handler(
			makeRequest("POST", "/subscribers", {
				externalId: "user-1",
				company: "Acme",
				age: 30,
				active: true,
				metadata: { role: "admin" },
			}),
		);

		expect(res.status).toBe(201);
		const body = await json(res);
		expect(body.company).toBe("Acme");
		expect(body.age).toBe(30);
		expect(body.active).toBe(true);
		expect(body.metadata).toEqual({ role: "admin" });
	});

	it("ignores additional fields with wrong types", async () => {
		const res = await app.handler(
			makeRequest("POST", "/subscribers", {
				externalId: "user-1",
				company: 123, // should be string
				age: "thirty", // should be number
			}),
		);

		expect(res.status).toBe(201);
		const body = await json(res);
		expect(body.company).toBeUndefined();
		expect(body.age).toBeUndefined();
	});

	it("updates subscriber with configured additional fields via PATCH", async () => {
		await app.handler(makeRequest("POST", "/subscribers", { externalId: "user-1", company: "Acme" }));

		const res = await app.handler(makeRequest("PATCH", "/subscribers/user-1", { company: "NewCo", age: 25 }));

		expect(res.status).toBe(200);
		const body = await json(res);
		expect(body.company).toBe("NewCo");
		expect(body.age).toBe(25);
	});

	it("ignores fields not in additionalFields config", async () => {
		const res = await app.handler(
			makeRequest("POST", "/subscribers", {
				externalId: "user-1",
				unknownField: "should-be-ignored",
			}),
		);

		expect(res.status).toBe(201);
		const body = await json(res);
		expect(body.unknownField).toBeUndefined();
	});
});
