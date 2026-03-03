/**
 * Database field attribute configuration.
 * Follows the same pattern as better-auth's field attribute system.
 */
export type FieldType = "string" | "number" | "boolean" | "date" | "json";

export interface FieldAttribute {
	type: FieldType;
	required?: boolean;
	unique?: boolean;
	index?: boolean;
	defaultValue?: unknown;
	references?: {
		model: string;
		field: string;
		onDelete?: "cascade" | "set null" | "no action";
	};
	returned?: boolean;
	transform?: {
		input?: (value: unknown) => unknown;
		output?: (value: unknown) => unknown;
	};
}

export interface ModelDefinition {
	fields: Record<string, FieldAttribute>;
	modelName?: string;
	disableMigrations?: boolean;
	order?: number;
}

export type HeraldDBSchema = Record<string, ModelDefinition>;

/**
 * Plugin schema extension — plugins can add new tables or extend existing ones.
 */
export type HeraldPluginDBSchema = Record<
	string,
	{
		fields: Record<string, FieldAttribute>;
		modelName?: string;
		disableMigrations?: boolean;
	}
>;
