import { describe, expect, it } from "vitest";
import { memoryWorkflowAdapter } from "../src/adapters/workflow/memory.js";
import { conditionsPass, resolveBranch, wrapWorkflow } from "../src/core/workflow-runtime.js";
import type { HeraldContext } from "../src/types/config.js";
import type { ActionStep, BranchDefinition, BranchStep, NotificationWorkflow, StepContext, WorkflowStep } from "../src/types/workflow.js";

function makeContext(
	payload: Record<string, unknown> = {},
	subscriber: { id: string; externalId: string } = { id: "sub-1", externalId: "ext-1" },
): StepContext {
	return {
		payload,
		subscriber,
		step: {
			delay: async () => {},
			digest: async () => [],
			throttle: async (c) => ({ throttled: false, count: 0, limit: c.limit }),
			fetch: async () => ({ status: 200, data: null, headers: {} }),
		},
	};
}

// ---------------------------------------------------------------------------
// resolveBranch — branch condition evaluation
// ---------------------------------------------------------------------------

describe("resolveBranch", () => {
	it("returns steps of the first branch whose conditions pass", () => {
		const emailStep: ActionStep = {
			stepId: "send-email",
			type: "email",
			handler: async () => ({ subject: "Hi", body: "Hello" }),
		};
		const branch: BranchStep = {
			stepId: "check-plan",
			type: "branch",
			branches: [
				{
					key: "premium",
					conditions: [{ field: "payload.plan", operator: "eq", value: "pro" }],
					steps: [emailStep],
				},
			],
		};

		const ctx = makeContext({ plan: "pro" });
		const result = resolveBranch(branch, ctx);
		expect(result).toEqual([emailStep]);
	});

	it("evaluates branches in order and picks the first match", () => {
		const stepA: ActionStep = {
			stepId: "step-a",
			type: "in_app",
			handler: async () => ({ body: "A" }),
		};
		const stepB: ActionStep = {
			stepId: "step-b",
			type: "in_app",
			handler: async () => ({ body: "B" }),
		};
		const branch: BranchStep = {
			stepId: "multi-branch",
			type: "branch",
			branches: [
				{
					key: "first",
					conditions: [{ field: "payload.score", operator: "gt", value: 50 }],
					steps: [stepA],
				},
				{
					key: "second",
					conditions: [{ field: "payload.score", operator: "gt", value: 10 }],
					steps: [stepB],
				},
			],
		};

		// score=100 matches both — should pick "first"
		const ctx = makeContext({ score: 100 });
		const result = resolveBranch(branch, ctx);
		expect(result).toEqual([stepA]);
	});

	it("returns defaultBranch steps when no conditions match", () => {
		const fallbackStep: ActionStep = {
			stepId: "fallback",
			type: "in_app",
			handler: async () => ({ body: "fallback" }),
		};
		const branch: BranchStep = {
			stepId: "with-default",
			type: "branch",
			branches: [
				{
					key: "premium",
					conditions: [{ field: "payload.plan", operator: "eq", value: "pro" }],
					steps: [{ stepId: "pro-step", type: "in_app", handler: async () => ({ body: "pro" }) }],
				},
				{
					key: "fallback",
					conditions: [{ field: "payload.plan", operator: "eq", value: "fallback-only" }],
					steps: [fallbackStep],
				},
			],
			defaultBranch: "fallback",
		};

		// No branch conditions match — should use defaultBranch
		const ctx = makeContext({ plan: "free" });
		const result = resolveBranch(branch, ctx);
		expect(result).toEqual([fallbackStep]);
	});

	it("returns empty array when no conditions match and no defaultBranch", () => {
		const branch: BranchStep = {
			stepId: "no-default",
			type: "branch",
			branches: [
				{
					key: "premium",
					conditions: [{ field: "payload.plan", operator: "eq", value: "pro" }],
					steps: [{ stepId: "pro-step", type: "in_app", handler: async () => ({ body: "pro" }) }],
				},
			],
		};

		const ctx = makeContext({ plan: "free" });
		const result = resolveBranch(branch, ctx);
		expect(result).toEqual([]);
	});

	it("supports conditionMode 'any' on a branch", () => {
		const step: ActionStep = {
			stepId: "matched",
			type: "in_app",
			handler: async () => ({ body: "matched" }),
		};
		const branch: BranchStep = {
			stepId: "any-mode",
			type: "branch",
			branches: [
				{
					key: "flexible",
					conditions: [
						{ field: "payload.plan", operator: "eq", value: "pro" },
						{ field: "payload.plan", operator: "eq", value: "enterprise" },
					],
					conditionMode: "any",
					steps: [step],
				},
			],
		};

		// "enterprise" matches the second condition — "any" mode should pass
		const ctx = makeContext({ plan: "enterprise" });
		const result = resolveBranch(branch, ctx);
		expect(result).toEqual([step]);
	});

	it("resolves conditions against subscriber fields", () => {
		const step: ActionStep = {
			stepId: "sub-match",
			type: "in_app",
			handler: async () => ({ body: "matched" }),
		};
		const branch: BranchStep = {
			stepId: "sub-branch",
			type: "branch",
			branches: [
				{
					key: "known-user",
					conditions: [{ field: "subscriber.externalId", operator: "eq", value: "ext-1" }],
					steps: [step],
				},
			],
		};

		const ctx = makeContext();
		const result = resolveBranch(branch, ctx);
		expect(result).toEqual([step]);
	});
});

// ---------------------------------------------------------------------------
// Basic branch execution (memory adapter)
// ---------------------------------------------------------------------------

describe("branch step — memory adapter", () => {
	it("executes the correct branch based on payload conditions", async () => {
		const stepsCalled: string[] = [];

		const workflow: NotificationWorkflow = {
			id: "branch-wf",
			name: "Branch Workflow",
			steps: [
				{
					stepId: "route",
					type: "branch",
					branches: [
						{
							key: "premium",
							conditions: [{ field: "payload.plan", operator: "eq", value: "pro" }],
							steps: [
								{
									stepId: "pro-email",
									type: "email",
									handler: async () => {
										stepsCalled.push("pro-email");
										return { subject: "Pro!", body: "Welcome pro user" };
									},
								},
							],
						},
						{
							key: "free",
							conditions: [{ field: "payload.plan", operator: "eq", value: "free" }],
							steps: [
								{
									stepId: "free-email",
									type: "email",
									handler: async () => {
										stepsCalled.push("free-email");
										return { subject: "Hi!", body: "Welcome free user" };
									},
								},
							],
						},
					],
				} as WorkflowStep,
			],
		};

		const adapter = memoryWorkflowAdapter();
		adapter.registerWorkflow(workflow);
		await adapter.trigger({ workflowId: "branch-wf", to: "user-1", payload: { plan: "pro" } });

		expect(stepsCalled).toEqual(["pro-email"]);
	});

	it("executes the default branch when no conditions match", async () => {
		const stepsCalled: string[] = [];

		const workflow: NotificationWorkflow = {
			id: "default-branch-wf",
			name: "Default Branch",
			steps: [
				{
					stepId: "route",
					type: "branch",
					branches: [
						{
							key: "premium",
							conditions: [{ field: "payload.plan", operator: "eq", value: "pro" }],
							steps: [
								{
									stepId: "pro-step",
									type: "in_app",
									handler: async () => {
										stepsCalled.push("pro-step");
										return { body: "pro" };
									},
								},
							],
						},
						{
							key: "fallback",
							conditions: [],
							steps: [
								{
									stepId: "fallback-step",
									type: "in_app",
									handler: async () => {
										stepsCalled.push("fallback-step");
										return { body: "fallback" };
									},
								},
							],
						},
					],
					defaultBranch: "fallback",
				} as WorkflowStep,
			],
		};

		const adapter = memoryWorkflowAdapter();
		adapter.registerWorkflow(workflow);
		await adapter.trigger({ workflowId: "default-branch-wf", to: "user-1", payload: { plan: "unknown" } });

		expect(stepsCalled).toEqual(["fallback-step"]);
	});

	it("skips all branch steps when no branch matches and no default", async () => {
		const stepsCalled: string[] = [];

		const workflow: NotificationWorkflow = {
			id: "no-match-wf",
			name: "No Match",
			steps: [
				{
					stepId: "route",
					type: "branch",
					branches: [
						{
							key: "premium",
							conditions: [{ field: "payload.plan", operator: "eq", value: "pro" }],
							steps: [
								{
									stepId: "pro-step",
									type: "in_app",
									handler: async () => {
										stepsCalled.push("pro-step");
										return { body: "pro" };
									},
								},
							],
						},
					],
				} as WorkflowStep,
				{
					stepId: "after-branch",
					type: "in_app",
					handler: async () => {
						stepsCalled.push("after-branch");
						return { body: "after" };
					},
				},
			],
		};

		const adapter = memoryWorkflowAdapter();
		adapter.registerWorkflow(workflow);
		await adapter.trigger({ workflowId: "no-match-wf", to: "user-1", payload: { plan: "free" } });

		expect(stepsCalled).toEqual(["after-branch"]);
	});

	it("continues to steps after the branch step", async () => {
		const stepsCalled: string[] = [];

		const workflow: NotificationWorkflow = {
			id: "continue-wf",
			name: "Continue After Branch",
			steps: [
				{
					stepId: "route",
					type: "branch",
					branches: [
						{
							key: "match",
							conditions: [{ field: "payload.active", operator: "eq", value: true }],
							steps: [
								{
									stepId: "branch-step",
									type: "in_app",
									handler: async () => {
										stepsCalled.push("branch-step");
										return { body: "from branch" };
									},
								},
							],
						},
					],
				} as WorkflowStep,
				{
					stepId: "final-step",
					type: "in_app",
					handler: async () => {
						stepsCalled.push("final-step");
						return { body: "final" };
					},
				},
			],
		};

		const adapter = memoryWorkflowAdapter();
		adapter.registerWorkflow(workflow);
		await adapter.trigger({ workflowId: "continue-wf", to: "user-1", payload: { active: true } });

		expect(stepsCalled).toEqual(["branch-step", "final-step"]);
	});

	it("executes all sub-steps in the selected branch sequentially", async () => {
		const stepsCalled: string[] = [];

		const workflow: NotificationWorkflow = {
			id: "multi-sub-wf",
			name: "Multi Sub Steps",
			steps: [
				{
					stepId: "route",
					type: "branch",
					branches: [
						{
							key: "match",
							conditions: [{ field: "payload.go", operator: "eq", value: true }],
							steps: [
								{
									stepId: "sub-1",
									type: "in_app",
									handler: async () => {
										stepsCalled.push("sub-1");
										return { body: "1" };
									},
								},
								{
									stepId: "sub-2",
									type: "in_app",
									handler: async () => {
										stepsCalled.push("sub-2");
										return { body: "2" };
									},
								},
								{
									stepId: "sub-3",
									type: "in_app",
									handler: async () => {
										stepsCalled.push("sub-3");
										return { body: "3" };
									},
								},
							],
						},
					],
				} as WorkflowStep,
			],
		};

		const adapter = memoryWorkflowAdapter();
		adapter.registerWorkflow(workflow);
		await adapter.trigger({ workflowId: "multi-sub-wf", to: "user-1", payload: { go: true } });

		expect(stepsCalled).toEqual(["sub-1", "sub-2", "sub-3"]);
	});

	it("payload modifications from fetch in branch persist to later steps", async () => {
		const fetchSpy = vi.fn().mockResolvedValue({
			status: 200,
			json: async () => ({ userName: "Alice" }),
			headers: new Headers(),
		});
		vi.stubGlobal("fetch", fetchSpy);

		let receivedPayload: Record<string, unknown> = {};

		const workflow: NotificationWorkflow = {
			id: "fetch-branch-wf",
			name: "Fetch in Branch",
			steps: [
				{
					stepId: "route",
					type: "branch",
					branches: [
						{
							key: "match",
							conditions: [{ field: "payload.go", operator: "eq", value: true }],
							steps: [
								{
									stepId: "fetch-step",
									type: "fetch",
									handler: async ({ step }) => {
										const result = await step.fetch({ url: "https://api.example.com/user" });
										return { body: "", _internal: { fetchResult: result.data } };
									},
								},
							],
						},
					],
				} as WorkflowStep,
				{
					stepId: "after-step",
					type: "in_app",
					handler: async ({ payload }) => {
						receivedPayload = payload;
						return { body: "after" };
					},
				},
			],
		};

		const adapter = memoryWorkflowAdapter();
		adapter.registerWorkflow(workflow);
		await adapter.trigger({ workflowId: "fetch-branch-wf", to: "user-1", payload: { go: true } });

		expect(receivedPayload.userName).toBe("Alice");
		expect(receivedPayload.go).toBe(true);

		vi.restoreAllMocks();
	});

	it("throttle inside a branch breaks remaining branch steps", async () => {
		const ctx = {
			throttleState: new Map(),
		} as unknown as import("../src/types/config.js").HeraldContext;

		const stepsCalled: string[] = [];

		const workflow: NotificationWorkflow = {
			id: "throttle-branch-wf",
			name: "Throttle in Branch",
			steps: [
				{
					stepId: "route",
					type: "branch",
					branches: [
						{
							key: "match",
							conditions: [{ field: "payload.go", operator: "eq", value: true }],
							steps: [
								{
									stepId: "throttle-step",
									type: "throttle",
									handler: async ({ step }) => {
										const r = await step.throttle({ key: "t", limit: 1, window: 1, unit: "hours" });
										stepsCalled.push("throttle-step");
										if (r.throttled) {
											return { body: "throttled", _internal: { throttled: true } };
										}
										return { body: "ok" };
									},
								},
								{
									stepId: "after-throttle",
									type: "in_app",
									handler: async () => {
										stepsCalled.push("after-throttle");
										return { body: "after" };
									},
								},
							],
						},
					],
				} as WorkflowStep,
			],
		};

		const adapter = memoryWorkflowAdapter(ctx);
		adapter.registerWorkflow(workflow);

		// First trigger — within limit
		await adapter.trigger({ workflowId: "throttle-branch-wf", to: "user-1", payload: { go: true } });
		expect(stepsCalled).toEqual(["throttle-step", "after-throttle"]);

		stepsCalled.length = 0;

		// Second trigger — throttled, should break
		await adapter.trigger({ workflowId: "throttle-branch-wf", to: "user-1", payload: { go: true } });
		expect(stepsCalled).toEqual(["throttle-step"]);
	});

	it("delay inside a branch executes without error", async () => {
		const stepsCalled: string[] = [];

		const workflow: NotificationWorkflow = {
			id: "delay-branch-wf",
			name: "Delay in Branch",
			steps: [
				{
					stepId: "route",
					type: "branch",
					branches: [
						{
							key: "match",
							conditions: [{ field: "payload.go", operator: "eq", value: true }],
							steps: [
								{
									stepId: "delay-step",
									type: "delay",
									handler: async ({ step }) => {
										await step.delay({ amount: 1, unit: "hours" });
										stepsCalled.push("delay-step");
										return { body: "delayed" };
									},
								},
								{
									stepId: "after-delay",
									type: "in_app",
									handler: async () => {
										stepsCalled.push("after-delay");
										return { body: "after" };
									},
								},
							],
						},
					],
				} as WorkflowStep,
			],
		};

		const adapter = memoryWorkflowAdapter();
		adapter.registerWorkflow(workflow);
		await adapter.trigger({ workflowId: "delay-branch-wf", to: "user-1", payload: { go: true } });

		expect(stepsCalled).toEqual(["delay-step", "after-delay"]);
	});

	it("supports nested branches (branch inside branch)", async () => {
		const stepsCalled: string[] = [];

		const workflow: NotificationWorkflow = {
			id: "nested-branch-wf",
			name: "Nested Branch",
			steps: [
				{
					stepId: "outer-route",
					type: "branch",
					branches: [
						{
							key: "premium",
							conditions: [{ field: "payload.plan", operator: "eq", value: "pro" }],
							steps: [
								{
									stepId: "inner-route",
									type: "branch",
									branches: [
										{
											key: "high-value",
											conditions: [{ field: "payload.value", operator: "gt", value: 100 }],
											steps: [
												{
													stepId: "vip-step",
													type: "in_app",
													handler: async () => {
														stepsCalled.push("vip-step");
														return { body: "VIP" };
													},
												},
											],
										},
										{
											key: "regular",
											conditions: [{ field: "payload.value", operator: "lt", value: 100 }],
											steps: [
												{
													stepId: "regular-step",
													type: "in_app",
													handler: async () => {
														stepsCalled.push("regular-step");
														return { body: "regular" };
													},
												},
											],
										},
									],
								} as WorkflowStep,
							],
						},
					],
				} as WorkflowStep,
			],
		};

		const adapter = memoryWorkflowAdapter();
		adapter.registerWorkflow(workflow);
		await adapter.trigger({
			workflowId: "nested-branch-wf",
			to: "user-1",
			payload: { plan: "pro", value: 200 },
		});

		expect(stepsCalled).toEqual(["vip-step"]);
	});

	it("conditions on sub-steps within a branch are evaluated", async () => {
		const stepsCalled: string[] = [];

		const workflow: NotificationWorkflow = {
			id: "conditioned-sub-wf",
			name: "Conditioned Sub Steps",
			steps: [
				{
					stepId: "route",
					type: "branch",
					branches: [
						{
							key: "match",
							conditions: [{ field: "payload.go", operator: "eq", value: true }],
							steps: [
								{
									stepId: "conditional-step",
									type: "in_app",
									conditions: [{ field: "payload.extra", operator: "eq", value: true }],
									handler: async () => {
										stepsCalled.push("conditional-step");
										return { body: "conditional" };
									},
								},
								{
									stepId: "always-step",
									type: "in_app",
									handler: async () => {
										stepsCalled.push("always-step");
										return { body: "always" };
									},
								},
							],
						},
					],
				} as WorkflowStep,
			],
		};

		const adapter = memoryWorkflowAdapter();
		adapter.registerWorkflow(workflow);
		// extra is false, so conditional-step should be skipped by its own conditions
		await adapter.trigger({ workflowId: "conditioned-sub-wf", to: "user-1", payload: { go: true, extra: false } });

		expect(stepsCalled).toEqual(["always-step"]);
	});
});

// ---------------------------------------------------------------------------
// wrapWorkflow — branch step integration
// ---------------------------------------------------------------------------

describe("wrapWorkflow with branch steps", () => {
	function makeMinimalHeraldCtx(): HeraldContext {
		return {
			db: {
				findOne: async () => null,
				findMany: async () => [],
				create: async () => ({}),
				update: async () => ({}),
				delete: async () => {},
			},
			options: {},
			channels: { get: () => undefined },
			throttleState: new Map(),
		} as unknown as HeraldContext;
	}

	it("recursively wraps action steps inside branches", () => {
		const workflow: NotificationWorkflow = {
			id: "wrap-branch-wf",
			name: "Wrap Branch",
			steps: [
				{
					stepId: "route",
					type: "branch",
					branches: [
						{
							key: "a",
							conditions: [{ field: "payload.x", operator: "eq", value: 1 }],
							steps: [
								{
									stepId: "inner-email",
									type: "email",
									handler: async () => ({ subject: "Hi", body: "Hello" }),
								},
							],
						},
					],
				} as WorkflowStep,
			],
		};

		const ctx = makeMinimalHeraldCtx();
		const wrapped = wrapWorkflow(workflow, ctx);

		// The branch step should still be a branch step
		expect(wrapped.steps[0]?.type).toBe("branch");

		// The inner step should be wrapped (handler replaced)
		const branchStep = wrapped.steps[0] as BranchStep;
		const innerStep = branchStep.branches[0]?.steps[0] as ActionStep;
		expect(innerStep.stepId).toBe("inner-email");
		// Wrapped handler is different from original
		expect(innerStep.handler).toBeDefined();
		expect(innerStep.handler).not.toBe(workflow.steps[0]);
	});
});
