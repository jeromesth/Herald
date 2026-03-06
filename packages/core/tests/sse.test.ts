import { afterEach, describe, expect, it } from "vitest";
import { SSEManager } from "../src/realtime/sse.js";

describe("SSEManager", () => {
	let sse: SSEManager;

	afterEach(() => {
		sse?.close();
	});

	it("creates an SSE response with correct headers", () => {
		sse = new SSEManager();
		const response = sse.connect("sub-1");

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("text/event-stream");
		expect(response.headers.get("Cache-Control")).toBe("no-cache");
	});

	it("tracks connection status", () => {
		sse = new SSEManager();
		expect(sse.isConnected("sub-1")).toBe(false);

		sse.connect("sub-1");

		expect(sse.isConnected("sub-1")).toBe(true);
		expect(sse.connectionCount).toBe(1);
	});

	it("supports multiple connections per subscriber", () => {
		sse = new SSEManager();
		sse.connect("sub-1");
		sse.connect("sub-1");

		expect(sse.connectionCount).toBe(2);
		expect(sse.isConnected("sub-1")).toBe(true);
	});

	it("disconnects a subscriber", () => {
		sse = new SSEManager();
		sse.connect("sub-1");

		expect(sse.isConnected("sub-1")).toBe(true);

		sse.disconnect("sub-1");

		expect(sse.isConnected("sub-1")).toBe(false);
		expect(sse.connectionCount).toBe(0);
	});

	it("closes all connections", () => {
		sse = new SSEManager();
		sse.connect("sub-1");
		sse.connect("sub-2");
		sse.connect("sub-3");

		expect(sse.connectionCount).toBe(3);

		sse.close();

		expect(sse.connectionCount).toBe(0);
	});

	it("handles disconnect for non-existent subscriber", () => {
		sse = new SSEManager();
		// Should not throw
		sse.disconnect("non-existent");
	});

	it("emits events to connected subscribers", async () => {
		sse = new SSEManager();
		const response = sse.connect("sub-1");

		// Emit an event
		sse.emit("sub-1", { type: "test", data: { message: "hello" } });

		// Read from the stream
		const reader = response.body?.getReader();
		const decoder = new TextDecoder();

		// Read the connected event + test event
		const chunks: string[] = [];
		for (let i = 0; i < 2; i++) {
			const { value } = await reader.read();
			if (value) {
				chunks.push(decoder.decode(value));
			}
		}

		const output = chunks.join("");
		expect(output).toContain("event: connected");
		expect(output).toContain("event: test");
		expect(output).toContain('"message":"hello"');

		reader.releaseLock();
	});

	it("broadcasts to all subscribers", async () => {
		sse = new SSEManager();
		const res1 = sse.connect("sub-1");
		const res2 = sse.connect("sub-2");

		sse.broadcast({ type: "announce", data: { text: "global" } });

		// Both streams should have the broadcast event
		const reader1 = res1.body?.getReader();
		const reader2 = res2.body?.getReader();
		const decoder = new TextDecoder();

		// Read connected + broadcast for each
		const chunks1: string[] = [];
		const chunks2: string[] = [];
		for (let i = 0; i < 2; i++) {
			const { value: v1 } = await reader1.read();
			if (v1) chunks1.push(decoder.decode(v1));
			const { value: v2 } = await reader2.read();
			if (v2) chunks2.push(decoder.decode(v2));
		}

		expect(chunks1.join("")).toContain("event: announce");
		expect(chunks2.join("")).toContain("event: announce");

		reader1.releaseLock();
		reader2.releaseLock();
	});
});
