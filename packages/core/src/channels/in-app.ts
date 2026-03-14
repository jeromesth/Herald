import type { SSEManager } from "../realtime/sse.js";
/**
 * In-app notification provider.
 * Stores notifications in the database and emits real-time events via SSE.
 */
import type { DatabaseAdapter } from "../types/adapter.js";
import type { ChannelProvider, ChannelProviderMessage, ChannelProviderResult } from "./provider.js";

export interface InAppProviderConfig {
	db: DatabaseAdapter;
	generateId: () => string;
	sse?: SSEManager;
}

export class InAppProvider implements ChannelProvider {
	readonly providerId = "in_app";
	readonly channelType = "in_app" as const;

	private db: DatabaseAdapter;
	private generateId: () => string;
	private sse?: SSEManager;

	constructor(config: InAppProviderConfig) {
		this.db = config.db;
		this.generateId = config.generateId;
		this.sse = config.sse;
	}

	async send(message: ChannelProviderMessage): Promise<ChannelProviderResult> {
		const id = this.generateId();
		const now = new Date();

		const workflowId = message.data?.workflowId;
		if (typeof workflowId !== "string" || !workflowId) {
			console.warn("[herald] InAppProvider: missing workflowId in message data");
		}

		const notification = {
			id,
			subscriberId: message.subscriberId,
			workflowId: typeof workflowId === "string" && workflowId ? workflowId : "unknown",
			channel: "in_app",
			subject: message.subject,
			body: message.body,
			actionUrl: message.actionUrl,
			avatar: message.avatar,
			data: message.data,
			read: false,
			seen: false,
			archived: false,
			deliveryStatus: "delivered",
			transactionId: typeof message.data?.transactionId === "string" ? message.data.transactionId : id,
			actorId: message.data?.actorId as string | undefined,
			tenantId: message.data?.tenantId as string | undefined,
			createdAt: now,
		};

		await this.db.create({ model: "notification", data: notification });

		// Emit real-time event if SSE is configured
		if (this.sse) {
			this.sse.emit(message.subscriberId, {
				type: "notification:new",
				data: notification,
			});
		}

		return { messageId: id, status: "sent" };
	}
}
