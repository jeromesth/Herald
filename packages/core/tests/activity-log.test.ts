import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryAdapter } from "../src/adapters/database/memory.js";
import { memoryWorkflowAdapter } from "../src/adapters/workflow/memory.js";
import { herald } from "../src/core/herald.js";
import type { ActivityLogRecord } from "../src/types/activity.js";
import type { Herald, NotificationWorkflow } from "../src/types/index.js";

const testWorkflow: NotificationWorkflow = {
	id: "welcome",
	name: "Welcome",
	steps: [{ stepId: "send-in-app", type: "in_app", handler: async () => ({ body: "Hello!" }) }],
};

describe("Activity Log", () => {
	let app: Herald;

	function makeRequest(method: string, path: string, body?: unknown): Request {
		return new Request(`https://test.local/api/notifications${path}`, {
			method,
			headers: { "Content-Type": "application/json" },
			body: body ? JSON.stringify(body) : undefined,
		});
	}

	describe("when activityLog is enabled", () => {
		beforeEach(() => {
			app = herald({
				database: memoryAdapter(),
				workflow: memoryWorkflowAdapter(),
				workflows: [testWorkflow],
				activityLog: true,
			});
		});

		it("records workflow.triggered and workflow.completed events on trigger", async () => {
			await app.api.upsertSubscriber({ externalId: "user-1", email: "u@test.com" });
			const { transactionId } = await app.api.trigger({
				workflowId: "welcome",
				to: "user-1",
				payload: { key: "val" },
			});

			const { entries } = await app.api.getActivityLog({ transactionId });
			const events = entries.map((e) => e.event);

			expect(events).toContain("workflow.triggered");
			expect(events).toContain("workflow.completed");
		});

		it("records workflow.step.started and workflow.step.completed events", async () => {
			await app.api.upsertSubscriber({ externalId: "user-1", email: "u@test.com" });
			const { transactionId } = await app.api.trigger({
				workflowId: "welcome",
				to: "user-1",
				payload: {},
			});

			const { entries } = await app.api.getActivityLog({ transactionId });
			const events = entries.map((e) => e.event);

			expect(events).toContain("workflow.step.started");
			expect(events).toContain("workflow.step.completed");
		});

		it("records notification.queued and notification.sent events", async () => {
			await app.api.upsertSubscriber({ externalId: "user-1", email: "u@test.com" });
			const { transactionId } = await app.api.trigger({
				workflowId: "welcome",
				to: "user-1",
				payload: {},
			});

			const { entries } = await app.api.getActivityLog({ transactionId });
			const events = entries.map((e) => e.event);

			expect(events).toContain("notification.queued");
			expect(events).toContain("notification.sent");
		});

		it("records notification.blocked when subscriber opts out", async () => {
			await app.api.upsertSubscriber({ externalId: "user-1", email: "u@test.com" });
			await app.api.updatePreferences("user-1", { channels: { in_app: false } });

			await app.api.trigger({
				workflowId: "welcome",
				to: "user-1",
				payload: {},
			});

			const { entries } = await app.api.getActivityLog({ workflowId: "welcome" });
			const events = entries.map((e) => e.event);

			expect(events).toContain("notification.blocked");
		});

		it("does not record step events when conditions cause adapter to skip", async () => {
			const conditionalWorkflow: NotificationWorkflow = {
				id: "conditional",
				name: "Conditional",
				steps: [
					{
						stepId: "guarded-step",
						type: "in_app",
						handler: async () => ({ body: "Gated" }),
						conditions: [{ field: "payload.shouldSend", operator: "eq", value: true }],
					},
				],
			};

			app = herald({
				database: memoryAdapter(),
				workflow: memoryWorkflowAdapter(),
				workflows: [conditionalWorkflow],
				activityLog: true,
			});

			await app.api.upsertSubscriber({ externalId: "user-1", email: "u@test.com" });
			await app.api.trigger({
				workflowId: "conditional",
				to: "user-1",
				payload: { shouldSend: false },
			});

			const { entries } = await app.api.getActivityLog({ workflowId: "conditional" });
			const events = entries.map((e) => e.event);

			// Adapter skips step before handler runs — no step.started or step.completed
			expect(events).not.toContain("workflow.step.started");
			expect(events).not.toContain("workflow.step.completed");
			expect(events).toContain("workflow.triggered");
		});

		it("filters activity log by workflowId", async () => {
			await app.api.upsertSubscriber({ externalId: "user-1", email: "u@test.com" });
			await app.api.trigger({ workflowId: "welcome", to: "user-1", payload: {} });

			const { entries, totalCount } = await app.api.getActivityLog({ workflowId: "welcome" });

			expect(totalCount).toBeGreaterThan(0);
			for (const entry of entries) {
				expect(entry.workflowId).toBe("welcome");
			}
		});

		it("supports pagination in getActivityLog", async () => {
			await app.api.upsertSubscriber({ externalId: "user-1", email: "u@test.com" });
			await app.api.trigger({ workflowId: "welcome", to: "user-1", payload: {} });

			const { entries: page1 } = await app.api.getActivityLog({ workflowId: "welcome", limit: 2, offset: 0 });
			const { entries: page2 } = await app.api.getActivityLog({ workflowId: "welcome", limit: 2, offset: 2 });

			expect(page1.length).toBe(2);
			expect(page2.length).toBeGreaterThan(0);
			expect(page1[0]?.id).not.toBe(page2[0]?.id);
		});
	});

	describe("when activityLog is disabled", () => {
		beforeEach(() => {
			app = herald({
				database: memoryAdapter(),
				workflow: memoryWorkflowAdapter(),
				workflows: [testWorkflow],
			});
		});

		it("does not record events", async () => {
			await app.api.upsertSubscriber({ externalId: "user-1", email: "u@test.com" });
			await app.api.trigger({ workflowId: "welcome", to: "user-1", payload: {} });

			const { entries, totalCount } = await app.api.getActivityLog({});

			expect(totalCount).toBe(0);
			expect(entries).toEqual([]);
		});
	});

	describe("Activity Log API routes", () => {
		beforeEach(() => {
			app = herald({
				database: memoryAdapter(),
				workflow: memoryWorkflowAdapter(),
				workflows: [testWorkflow],
				activityLog: true,
			});
		});

		it("GET /activity returns paginated activity entries", async () => {
			await app.api.upsertSubscriber({ externalId: "user-1", email: "u@test.com" });
			await app.api.trigger({ workflowId: "welcome", to: "user-1", payload: {} });

			const res = await app.handler(makeRequest("GET", "/activity?workflowId=welcome&limit=10"));
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.entries.length).toBeGreaterThan(0);
			expect(body.totalCount).toBeGreaterThan(0);
		});

		it("GET /activity/:transactionId returns timeline for a transaction", async () => {
			await app.api.upsertSubscriber({ externalId: "user-1", email: "u@test.com" });
			const { transactionId } = await app.api.trigger({ workflowId: "welcome", to: "user-1", payload: {} });

			const res = await app.handler(makeRequest("GET", `/activity/${transactionId}`));
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.entries.length).toBeGreaterThan(0);
			// Response includes totalCount matching entries length
			expect(body.totalCount).toBe(body.entries.length);
			// Timeline should be chronological (asc)
			for (let i = 1; i < body.entries.length; i++) {
				expect(new Date(body.entries[i].createdAt).getTime()).toBeGreaterThanOrEqual(new Date(body.entries[i - 1].createdAt).getTime());
			}
		});
	});
});
