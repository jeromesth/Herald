import { inngestAdapter } from "../src/adapters/workflow/inngest.js";
import { runWorkflowAdapterContract } from "./contracts/workflow-adapter.contract.js";

/**
 * Mock Inngest client that records events and function registrations.
 */
function createMockInngestClient() {
	const sentEvents: unknown[] = [];
	const functions: unknown[] = [];

	return {
		id: "test-app",
		sentEvents,
		functions,

		async send(event: unknown) {
			if (Array.isArray(event)) {
				sentEvents.push(...event);
			} else {
				sentEvents.push(event);
			}
			return { ids: ["mock-event-id"] };
		},

		createFunction(config: unknown, trigger: unknown, handler: unknown) {
			const fn = { config, trigger, handler };
			functions.push(fn);
			return fn;
		},
	};
}

runWorkflowAdapterContract("inngestAdapter", () => {
	const client = createMockInngestClient();
	return inngestAdapter({ client });
});
