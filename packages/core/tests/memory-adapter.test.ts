import { memoryAdapter } from "../src/adapters/database/memory.js";
import { runDatabaseAdapterContract } from "./contracts/database-adapter.contract.js";

runDatabaseAdapterContract("memoryAdapter", () => memoryAdapter());
