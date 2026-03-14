import { memoryWorkflowAdapter } from "../src/adapters/workflow/memory.js";
import { runWorkflowAdapterContract } from "./contracts/workflow-adapter.contract.js";

runWorkflowAdapterContract("memoryWorkflowAdapter", () => memoryWorkflowAdapter());
