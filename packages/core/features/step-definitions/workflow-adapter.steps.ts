import assert from "node:assert/strict";
import { type DataTable, Given, Then, When } from "@cucumber/cucumber";
import { memoryWorkflowAdapter } from "../../src/adapters/workflow/memory.js";
import type { NotificationWorkflow, TriggerResult, WorkflowAdapter } from "../../src/types/workflow.js";
import { tableToObject } from "../support/helpers.js";

interface WorkflowWorld {
	adapter: WorkflowAdapter;
	triggerResult: TriggerResult | null;
	error: Error | null;
}

function createTestWorkflow(id: string): NotificationWorkflow {
	return {
		id,
		name: `Test Workflow ${id}`,
		steps: [
			{
				stepId: "send-email",
				type: "email",
				handler: async ({ subscriber, payload }) => ({
					subject: `Welcome ${subscriber.externalId}`,
					body: `Hello from ${payload.app ?? "test"}`,
				}),
			},
		],
	};
}

Given("a fresh workflow adapter", function (this: WorkflowWorld) {
	this.adapter = memoryWorkflowAdapter();
	this.triggerResult = null;
	this.error = null;
});

Given("a registered workflow with ID {string}", function (this: WorkflowWorld, id: string) {
	this.adapter.registerWorkflow(createTestWorkflow(id));
});

Given("I have triggered {string} for recipient {string}", async function (this: WorkflowWorld, workflowId: string, recipient: string) {
	this.triggerResult = await this.adapter.trigger({
		workflowId,
		to: recipient,
		payload: {},
	});
});

// === REGISTER ===

When("I register a workflow with ID {string}", function (this: WorkflowWorld, id: string) {
	this.adapter.registerWorkflow(createTestWorkflow(id));
});

// === TRIGGER ===

When(
	"I trigger {string} for recipient {string} with payload:",
	async function (this: WorkflowWorld, workflowId: string, recipient: string, table: DataTable) {
		const payload = tableToObject(table);
		this.triggerResult = await this.adapter.trigger({
			workflowId,
			to: recipient,
			payload,
		});
	},
);

When(
	"I trigger {string} for recipient {string} with empty payload",
	async function (this: WorkflowWorld, workflowId: string, recipient: string) {
		this.triggerResult = await this.adapter.trigger({
			workflowId,
			to: recipient,
			payload: {},
		});
	},
);

When(
	"I trigger {string} for recipient {string} with transactionId {string}",
	async function (this: WorkflowWorld, workflowId: string, recipient: string, transactionId: string) {
		this.triggerResult = await this.adapter.trigger({
			workflowId,
			to: recipient,
			payload: {},
			transactionId,
		});
	},
);

When(
	"I trigger {string} for recipients {string} with empty payload",
	async function (this: WorkflowWorld, workflowId: string, recipientStr: string) {
		const recipients = recipientStr.split(",").map((s) => s.trim());
		this.triggerResult = await this.adapter.trigger({
			workflowId,
			to: recipients,
			payload: {},
		});
	},
);

// === CANCEL ===

When("I cancel {string} with the triggered transactionId", async function (this: WorkflowWorld, workflowId: string) {
	assert.ok(this.triggerResult, "No trigger result available");
	try {
		await this.adapter.cancel({
			workflowId,
			transactionId: this.triggerResult.transactionId,
		});
	} catch (err) {
		this.error = err as Error;
	}
});

When("I cancel {string} with transactionId {string}", async function (this: WorkflowWorld, workflowId: string, transactionId: string) {
	try {
		await this.adapter.cancel({ workflowId, transactionId });
	} catch (err) {
		this.error = err as Error;
	}
});

// === THEN ASSERTIONS ===

Then("the adapter ID should be a non-empty string", function (this: WorkflowWorld) {
	assert.ok(this.adapter.adapterId, "Expected adapter ID to be non-empty");
	assert.strictEqual(typeof this.adapter.adapterId, "string");
});

Then("the workflow should be accepted without error", function (this: WorkflowWorld) {
	// If we reached here without throwing, the workflow was accepted
	assert.ok(true);
});

Then("both workflows should be accepted without error", function (this: WorkflowWorld) {
	// If we reached here without throwing, both workflows were accepted
	assert.ok(true);
});

Then("the result should have a non-empty transactionId", function (this: WorkflowWorld) {
	assert.ok(this.triggerResult, "Expected a trigger result");
	assert.ok(this.triggerResult.transactionId, "Expected non-empty transactionId");
	assert.strictEqual(typeof this.triggerResult.transactionId, "string");
});

Then("the status should be {string} or {string}", function (this: WorkflowWorld, status1: string, status2: string) {
	assert.ok(this.triggerResult, "Expected a trigger result");
	assert.ok(
		this.triggerResult.status === status1 || this.triggerResult.status === status2,
		`Expected status to be "${status1}" or "${status2}", got "${this.triggerResult.status}"`,
	);
});

Then("the transactionId should be {string}", function (this: WorkflowWorld, expected: string) {
	assert.ok(this.triggerResult, "Expected a trigger result");
	assert.strictEqual(this.triggerResult.transactionId, expected);
});

Then("it should resolve without error", function (this: WorkflowWorld) {
	assert.strictEqual(this.error, null, `Expected no error but got: ${this.error?.message}`);
});

Then("getHandler should return null or a handler with path and function", function (this: WorkflowWorld) {
	const handler = this.adapter.getHandler();
	if (handler !== null) {
		assert.ok(handler.path, "Expected handler to have a path");
		assert.strictEqual(typeof handler.handler, "function", "Expected handler.handler to be a function");
	} else {
		assert.strictEqual(handler, null);
	}
});
