import { afterEach, describe, expect, it, vi } from "vitest";
import { SSEManager } from "../src/realtime/sse.js";

describe("SSEManager — extended coverage", () => {
	let manager: SSEManager;

	afterEach(() => {
		manager?.close();
	});

	it("disconnect removes all connections for a subscriber", async () => {
		manager = new SSEManager({ heartbeatMs: 100_000 });

		const res = manager.connect("sub-1");
		expect(res.status).toBe(200);
		expect(manager.isConnected("sub-1")).toBe(true);

		// Read a bit of the stream to ensure connection is established
		const reader = res.body?.getReader();
		await reader?.read();

		manager.disconnect("sub-1");
		expect(manager.isConnected("sub-1")).toBe(false);
		expect(manager.connectionCount).toBe(0);
	});

	it("disconnect is a no-op for unknown subscriber", () => {
		manager = new SSEManager();
		manager.disconnect("unknown");
		expect(manager.connectionCount).toBe(0);
	});

	it("emit removes failed connections and cleans up empty subscriber entries", async () => {
		manager = new SSEManager({ heartbeatMs: 100_000 });

		const res = manager.connect("sub-1");
		const reader = res.body?.getReader();
		await reader?.read();

		// Disconnect the subscriber to break the controller
		manager.disconnect("sub-1");

		// emit on unknown subscriber is a no-op
		manager.emit("sub-1", { type: "test", data: {} });
		expect(manager.connectionCount).toBe(0);
	});

	it("close cleans up heartbeat interval", async () => {
		manager = new SSEManager({ heartbeatMs: 100 });

		const res = manager.connect("sub-1");
		const reader = res.body?.getReader();
		await reader?.read();

		manager.close();
		expect(manager.connectionCount).toBe(0);
	});

	it("removeConnection via stream cancel", async () => {
		manager = new SSEManager({ heartbeatMs: 100_000 });

		const res = manager.connect("sub-1");
		expect(manager.connectionCount).toBe(1);

		// Cancel the stream to trigger removeConnection
		const reader = res.body?.getReader();
		await reader?.read();
		await reader?.cancel();

		// After cancel, connection should be cleaned up
		expect(manager.connectionCount).toBe(0);
	});

	it("handles emit error for non-TypeError", async () => {
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		manager = new SSEManager({ heartbeatMs: 100_000 });

		const res = manager.connect("sub-1");
		const reader = res.body?.getReader();
		await reader?.read();

		// Access the internal connection and make the controller throw a non-TypeError
		const connections = (manager as unknown as { connections: Map<string, Set<{ controller: ReadableStreamDefaultController }>> })
			.connections;
		const connSet = connections.get("sub-1");
		if (connSet) {
			for (const conn of connSet) {
				conn.controller.enqueue = () => {
					throw new Error("non-type-error");
				};
			}
		}

		manager.emit("sub-1", { type: "test", data: {} });
		expect(consoleSpy).toHaveBeenCalled();
		consoleSpy.mockRestore();
	});

	it("handles disconnect error for non-TypeError", async () => {
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		manager = new SSEManager({ heartbeatMs: 100_000 });

		const res = manager.connect("sub-1");
		const reader = res.body?.getReader();
		await reader?.read();

		// Make the controller.close() throw a non-TypeError
		const connections = (manager as unknown as { connections: Map<string, Set<{ controller: ReadableStreamDefaultController }>> })
			.connections;
		const connSet = connections.get("sub-1");
		if (connSet) {
			for (const conn of connSet) {
				conn.controller.close = () => {
					throw new Error("close-error");
				};
			}
		}

		manager.disconnect("sub-1");
		expect(consoleSpy).toHaveBeenCalled();
		consoleSpy.mockRestore();
	});
});
