import type { CorsConfig, HeraldContext } from "../types/config.js";
import type { HeraldPlugin } from "../types/plugin.js";
import { activityRoutes } from "./routes/activity.js";
import { notificationRoutes } from "./routes/notifications.js";
import { preferenceRoutes } from "./routes/preferences.js";
import { realtimeRoutes } from "./routes/realtime.js";
import { subscriberRoutes } from "./routes/subscribers.js";
import { topicRoutes } from "./routes/topics.js";
import { triggerRoutes } from "./routes/trigger.js";

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
		...activityRoutes,
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

	// Initialize CORS config
	setCorsConfig(ctx.options.cors);

	return async (request: Request): Promise<Response> => {
		if (pluginsReady) {
			await pluginsReady;
		}

		// Handle CORS preflight requests
		if (request.method === "OPTIONS" && ctx.options.cors) {
			const requestOrigin = request.headers.get("origin");
			return new Response(null, { status: 204, headers: buildCorsHeaders(ctx.options.cors, requestOrigin) });
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
					console.error("[herald] Unhandled route error:", error);
					return jsonResponse({ error: "Internal server error" }, 500);
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
		const patternPart = patternParts[i] as string;
		const pathPart = pathParts[i] as string;

		if (patternPart.startsWith(":")) {
			params[patternPart.slice(1)] = pathPart;
		} else if (patternPart !== pathPart) {
			return null;
		}
	}

	return params;
}

/**
 * Build CORS response headers from config.
 *
 * NOTE: Most CORS libraries (e.g. `cors` on npm) are Express/Connect middleware
 * and require `req`/`res` objects. Herald uses web-standard Request/Response,
 * so we implement CORS directly. The logic here is intentionally simple —
 * Herald is a notification API, not a general-purpose web framework.
 *
 * Key behaviour:
 * - `cors: true` → wildcard origin, standard methods/headers.
 * - `cors: { origin: ["https://a.com", "https://b.com"] }` → the first
 *   matching origin is reflected (per the spec, `Access-Control-Allow-Origin`
 *   only accepts a single origin or `*`). A `Vary: Origin` header is added
 *   so caches don't serve the wrong origin.
 */
export function buildCorsHeaders(corsOption: boolean | CorsConfig | undefined, requestOrigin?: string | null): Record<string, string> {
	if (!corsOption) return {};

	const config: CorsConfig = corsOption === true ? {} : corsOption;
	const configuredOrigin = config.origin ?? "*";
	const methods = config.methods ?? ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
	const allowedHeaders = config.allowedHeaders ?? ["Content-Type", "Authorization"];
	const maxAge = config.maxAge ?? 86400;

	let resolvedOrigin: string;
	const headers: Record<string, string> = {};

	if (Array.isArray(configuredOrigin)) {
		// Per spec, Access-Control-Allow-Origin must be a single origin or "*".
		// Reflect the request origin if it's in the allow-list.
		if (requestOrigin && configuredOrigin.includes(requestOrigin)) {
			resolvedOrigin = requestOrigin;
		} else {
			resolvedOrigin = configuredOrigin[0] ?? "*";
		}
		headers.Vary = "Origin";
	} else {
		resolvedOrigin = configuredOrigin;
	}

	headers["Access-Control-Allow-Origin"] = resolvedOrigin;
	headers["Access-Control-Allow-Methods"] = methods.join(", ");
	headers["Access-Control-Allow-Headers"] = allowedHeaders.join(", ");
	headers["Access-Control-Max-Age"] = String(maxAge);

	return headers;
}

/** Active CORS config — set once by createRouter. */
let activeCorsConfig: boolean | CorsConfig | undefined;

export function setCorsConfig(corsOption: boolean | CorsConfig | undefined): void {
	activeCorsConfig = corsOption;
}

export function jsonResponse(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json", ...buildCorsHeaders(activeCorsConfig) },
	});
}

/** Maximum allowed JSON body size (1 MB). */
const MAX_BODY_SIZE = 1024 * 1024;

export async function parseJsonBody<T = Record<string, unknown>>(request: Request): Promise<T> {
	const contentLength = request.headers.get("content-length");
	if (contentLength && Number.parseInt(contentLength, 10) > MAX_BODY_SIZE) {
		throw new HTTPError(413, "Request body too large");
	}

	const text = await request.text();
	if (text.length > MAX_BODY_SIZE) {
		throw new HTTPError(413, "Request body too large");
	}
	if (!text) return {} as T;
	try {
		return JSON.parse(text) as T;
	} catch {
		throw new HTTPError(400, "Invalid JSON body");
	}
}
