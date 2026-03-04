/**
 * Server-Sent Events (SSE) manager for real-time in-app notifications.
 * Manages subscriber connections and broadcasts events.
 */

export interface SSEEvent {
	type: string;
	data: unknown;
}

interface SSEConnection {
	subscriberId: string;
	controller: ReadableStreamDefaultController;
	createdAt: Date;
}

/**
 * SSE manager that tracks active subscriber connections and broadcasts events.
 */
export class SSEManager {
	private connections = new Map<string, Set<SSEConnection>>();
	private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
	private heartbeatMs: number;
	private encoder = new TextEncoder();

	constructor(options?: { heartbeatMs?: number }) {
		this.heartbeatMs = options?.heartbeatMs ?? 30_000;
	}

	/**
	 * Create a new SSE response for a subscriber.
	 * Returns a standard Response with a ReadableStream body.
	 */
	connect(subscriberId: string): Response {
		let connectionRef: SSEConnection | null = null;

		const stream = new ReadableStream({
			start: (controller) => {
				const connection: SSEConnection = {
					subscriberId,
					controller,
					createdAt: new Date(),
				};
				connectionRef = connection;

				if (!this.connections.has(subscriberId)) {
					this.connections.set(subscriberId, new Set());
				}
				this.connections.get(subscriberId)!.add(connection);

				// Send initial connection event
				this.sendToController(controller, {
					type: "connected",
					data: { subscriberId, timestamp: new Date().toISOString() },
				});

				// Start heartbeat if this is the first connection
				if (!this.heartbeatInterval) {
					this.startHeartbeat();
				}
			},
			cancel: () => {
				// Clean up on disconnect
				this.removeConnection(subscriberId, connectionRef);
			},
		});

		return new Response(stream, {
			status: 200,
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
				"X-Accel-Buffering": "no",
			},
		});
	}

	/**
	 * Emit an event to all connections for a subscriber.
	 */
	emit(subscriberId: string, event: SSEEvent): void {
		const connections = this.connections.get(subscriberId);
		if (!connections) return;

		for (const conn of connections) {
			try {
				this.sendToController(conn.controller, event);
			} catch {
				// Connection is dead, clean it up
				connections.delete(conn);
			}
		}

		// Clean up empty subscriber entries
		if (connections.size === 0) {
			this.connections.delete(subscriberId);
		}
	}

	/**
	 * Broadcast an event to all connected subscribers.
	 */
	broadcast(event: SSEEvent): void {
		for (const subscriberId of this.connections.keys()) {
			this.emit(subscriberId, event);
		}
	}

	/**
	 * Disconnect all connections for a subscriber.
	 */
	disconnect(subscriberId: string): void {
		const connections = this.connections.get(subscriberId);
		if (!connections) return;

		for (const conn of connections) {
			try {
				conn.controller.close();
			} catch {
				// Already closed
			}
		}

		this.connections.delete(subscriberId);
		this.stopHeartbeatIfEmpty();
	}

	/**
	 * Get the number of active connections.
	 */
	get connectionCount(): number {
		let count = 0;
		for (const connections of this.connections.values()) {
			count += connections.size;
		}
		return count;
	}

	/**
	 * Check if a subscriber has active connections.
	 */
	isConnected(subscriberId: string): boolean {
		const connections = this.connections.get(subscriberId);
		return connections != null && connections.size > 0;
	}

	/**
	 * Clean up all connections. Call this on server shutdown.
	 */
	close(): void {
		for (const subscriberId of [...this.connections.keys()]) {
			this.disconnect(subscriberId);
		}
		if (this.heartbeatInterval) {
			clearInterval(this.heartbeatInterval);
			this.heartbeatInterval = null;
		}
	}

	private sendToController(controller: ReadableStreamDefaultController, event: SSEEvent): void {
		const data = JSON.stringify(event.data);
		const message = `event: ${event.type}\ndata: ${data}\n\n`;
		controller.enqueue(this.encoder.encode(message));
	}

	private removeConnection(
		subscriberId: string,
		connection: SSEConnection | null,
	): void {
		const connections = this.connections.get(subscriberId);
		if (!connections) return;

		if (connection) {
			connections.delete(connection);
		}

		if (connections.size === 0) {
			this.connections.delete(subscriberId);
		}

		this.stopHeartbeatIfEmpty();
	}

	private startHeartbeat(): void {
		this.heartbeatInterval = setInterval(() => {
			this.broadcast({ type: "heartbeat", data: { timestamp: new Date().toISOString() } });
		}, this.heartbeatMs);
	}

	private stopHeartbeatIfEmpty(): void {
		if (this.connections.size === 0 && this.heartbeatInterval) {
			clearInterval(this.heartbeatInterval);
			this.heartbeatInterval = null;
		}
	}
}
