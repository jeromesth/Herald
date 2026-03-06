import { beforeEach, describe, expect, it } from "vitest";
import type { NotificationWorkflow, WorkflowAdapter } from "../../src/types/workflow.js";

function createTestWorkflow(overrides?: Partial<NotificationWorkflow>): NotificationWorkflow {
	return {
		id: "welcome",
		name: "Welcome Notification",
		steps: [
			{
				stepId: "send-email",
				type: "email",
				handler: async ({ subscriber, payload }) => ({
					subject: `Welcome ${subscriber.externalId}`,
					body: `Hello from ${payload.app}`,
				}),
			},
		],
		...overrides,
	};
}

/**
 * Shared contract test suite for WorkflowAdapter implementations.
 * Every adapter must pass all these tests to be considered conformant.
 */
export function runWorkflowAdapterContract(name: string, createAdapter: () => WorkflowAdapter) {
	describe(`WorkflowAdapter contract: ${name}`, () => {
		let adapter: WorkflowAdapter;

		beforeEach(() => {
			adapter = createAdapter();
		});

		describe("adapterId", () => {
			it("returns non-empty string identifier", () => {
				expect(adapter.adapterId).toBeTruthy();
				expect(typeof adapter.adapterId).toBe("string");
			});
		});

		describe("registerWorkflow", () => {
			it("stores workflow for later trigger", () => {
				const workflow = createTestWorkflow();
				adapter.registerWorkflow(workflow);
				// Should not throw — workflow is accepted
			});

			it("can register multiple workflows", () => {
				adapter.registerWorkflow(createTestWorkflow({ id: "wf-1", name: "WF 1" }));
				adapter.registerWorkflow(createTestWorkflow({ id: "wf-2", name: "WF 2" }));
				// Should not throw — both workflows are accepted
			});
		});

		describe("trigger", () => {
			it("returns transactionId and status", async () => {
				adapter.registerWorkflow(createTestWorkflow());

				const result = await adapter.trigger({
					workflowId: "welcome",
					to: "user-1",
					payload: { app: "TestApp" },
				});

				expect(result.transactionId).toBeTruthy();
				expect(["triggered", "queued"]).toContain(result.status);
			});

			it("generates transactionId if not provided", async () => {
				adapter.registerWorkflow(createTestWorkflow());

				const result = await adapter.trigger({
					workflowId: "welcome",
					to: "user-1",
					payload: {},
				});

				expect(result.transactionId).toBeTruthy();
				expect(typeof result.transactionId).toBe("string");
			});

			it("uses provided transactionId when given", async () => {
				adapter.registerWorkflow(createTestWorkflow());

				const result = await adapter.trigger({
					workflowId: "welcome",
					to: "user-1",
					payload: {},
					transactionId: "custom-tx-123",
				});

				expect(result.transactionId).toBe("custom-tx-123");
			});

			it("handles single recipient", async () => {
				adapter.registerWorkflow(createTestWorkflow());

				const result = await adapter.trigger({
					workflowId: "welcome",
					to: "user-1",
					payload: {},
				});

				expect(result.transactionId).toBeTruthy();
			});

			it("handles array of recipients", async () => {
				adapter.registerWorkflow(createTestWorkflow());

				const result = await adapter.trigger({
					workflowId: "welcome",
					to: ["user-1", "user-2", "user-3"],
					payload: {},
				});

				expect(result.transactionId).toBeTruthy();
				expect(["triggered", "queued"]).toContain(result.status);
			});
		});

		describe("cancel", () => {
			it("sends cancellation for given transactionId", async () => {
				adapter.registerWorkflow(createTestWorkflow());

				const { transactionId } = await adapter.trigger({
					workflowId: "welcome",
					to: "user-1",
					payload: {},
				});

				await expect(
					adapter.cancel({
						workflowId: "welcome",
						transactionId,
					}),
				).resolves.toBeUndefined();
			});

			it("does not throw for unknown transactionId", async () => {
				await expect(
					adapter.cancel({
						workflowId: "welcome",
						transactionId: "nonexistent-tx",
					}),
				).resolves.toBeUndefined();
			});
		});

		describe("getHandler", () => {
			it("returns null or handler object", () => {
				const handler = adapter.getHandler();
				if (handler !== null) {
					expect(handler.path).toBeTruthy();
					expect(typeof handler.handler).toBe("function");
				} else {
					expect(handler).toBeNull();
				}
			});
		});
	});
}
