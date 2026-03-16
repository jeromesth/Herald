/**
 * Herald error hierarchy.
 *
 * All Herald-specific errors extend `HeraldError` so consumers can catch the
 * entire family with a single `instanceof` check. Subclasses carry a `code`
 * property for programmatic switching without inspecting messages.
 */

export class HeraldError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = "HeraldError";
		this.code = code;
	}
}

/** Thrown when adapter configuration is invalid or missing. */
export class HeraldConfigError extends HeraldError {
	constructor(message: string) {
		super("CONFIG_ERROR", message);
		this.name = "HeraldConfigError";
	}
}

/** Thrown when a database record is not found where one was expected. */
export class HeraldNotFoundError extends HeraldError {
	readonly model: string;

	constructor(model: string, message?: string) {
		super("NOT_FOUND", message ?? `Record not found in "${model}"`);
		this.name = "HeraldNotFoundError";
		this.model = model;
	}
}

/** Thrown when input validation fails (e.g. invalid table prefix, bad email format). */
export class HeraldValidationError extends HeraldError {
	constructor(message: string) {
		super("VALIDATION_ERROR", message);
		this.name = "HeraldValidationError";
	}
}

/** Thrown when a required provider or adapter is missing. */
export class HeraldProviderError extends HeraldError {
	constructor(message: string) {
		super("PROVIDER_ERROR", message);
		this.name = "HeraldProviderError";
	}
}

/** Thrown when a plugin violates safety constraints. */
export class HeraldPluginError extends HeraldError {
	readonly pluginId: string;

	constructor(pluginId: string, message: string) {
		super("PLUGIN_ERROR", message);
		this.name = "HeraldPluginError";
		this.pluginId = pluginId;
	}
}
