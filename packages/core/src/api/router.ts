import type { HeraldContext } from "../types/config.js";
import type { HeraldPlugin } from "../types/plugin.js";
import { subscriberRoutes } from "./routes/subscribers.js";
import { notificationRoutes } from "./routes/notifications.js";
import { preferenceRoutes } from "./routes/preferences.js";
import { topicRoutes } from "./routes/topics.js";
import { triggerRoutes } from "./routes/trigger.js";
import { realtimeRoutes } from "./routes/realtime.js";

interface Route {
	method: string;
	pattern: string;
	handler: (request: Request, ctx: HeraldContext, params: Record<string, string>) => Promise<Response>;
}

export class HTTPError extends Error {
	status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = "HTTPError";
		this.status = status;
	}
}

/**
 * Create the HTTP router for Herald API endpoints.
 */
export function createRouter(
	ctx: HeraldContext,
	plugins?: HeraldPlugin[],
	pluginsReady?: Promise<void>,
): (request: Request) => Promise<Response> {
	const basePath = ctx.options.basePath ?? "/api/notifications";

	const routes: Route[] = [
		...triggerRoutes,
		...subscriberRoutes,
		...notificationRoutes,
		...preferenceRoutes,
		...topicRoutes,
		...realtimeRoutes,
	];

	// Add plugin routes
	if (plugins) {
		for (const plugin of plugins) {
			if (plugin.endpoints) {
				for (const [, endpoint] of Object.entries(plugin.endpoints)) {
					routes.push({
						method: endpoint.method,
						pattern: endpoint.path,
						handler: (req) => endpoint.handler(req, ctx),
					});
				}
			}
		}
	}

	return async (request: Request): Promise<Response> => {
		if (pluginsReady) {
			await pluginsReady;
		}

		const url = new URL(request.url);
		const path = url.pathname.replace(basePath, "").replace(/\/$/, "") || "/";
		const method = request.method.toUpperCase();

		for (const route of routes) {
			if (route.method !== method) continue;

			const params = matchRoute(route.pattern, path);
			if (params !== null) {
				try {
					return await route.handler(request, ctx, params);
				} catch (error) {
					if (error instanceof HTTPError) {
						return jsonResponse({ error: error.message }, error.status);
					}
					const message = error instanceof Error ? error.message : "Internal server error";
					return jsonResponse({ error: message }, 500);
				}
			}
		}

		return jsonResponse({ error: "Not found" }, 404);
	};
}

/**
 * Match a route pattern against a path, extracting named parameters.
 * Supports patterns like `/subscribers/:id/preferences`.
 */
function matchRoute(pattern: string, path: string): Record<string, string> | null {
	const patternParts = pattern.split("/").filter(Boolean);
	const pathParts = path.split("/").filter(Boolean);

	if (patternParts.length !== pathParts.length) return null;

	const params: Record<string, string> = {};

	for (let i = 0; i < patternParts.length; i++) {
		const patternPart = patternParts[i]!;
		const pathPart = pathParts[i]!;

		if (patternPart.startsWith(":")) {
			params[patternPart.slice(1)] = pathPart;
		} else if (patternPart !== pathPart) {
			return null;
		}
	}

	return params;
}

export function jsonResponse(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

export async function parseJsonBody<T = Record<string, unknown>>(
	request: Request,
): Promise<T> {
	const text = await request.text();
	if (!text) return {} as T;
	try {
		return JSON.parse(text) as T;
	} catch {
		throw new HTTPError(400, "Invalid JSON body");
	}
}
