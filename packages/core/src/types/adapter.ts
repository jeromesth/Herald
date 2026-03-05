/**
 * Database adapter interface.
 * Mirrors better-auth's adapter pattern for full compatibility
 * with their ecosystem of adapters.
 */

export type WhereOperator = "eq" | "ne" | "lt" | "lte" | "gt" | "gte" | "in" | "not_in" | "contains" | "starts_with" | "ends_with";

export interface Where {
	field: string;
	value: unknown;
	operator?: WhereOperator;
	connector?: "AND" | "OR";
}

export interface SortBy {
	field: string;
	direction: "asc" | "desc";
}

export interface DatabaseAdapter {
	create<T = Record<string, unknown>>(args: {
		model: string;
		data: Record<string, unknown>;
		select?: string[];
	}): Promise<T>;

	findOne<T = Record<string, unknown>>(args: {
		model: string;
		where: Where[];
		select?: string[];
	}): Promise<T | null>;

	findMany<T = Record<string, unknown>>(args: {
		model: string;
		where?: Where[];
		limit?: number;
		offset?: number;
		sortBy?: SortBy;
		select?: string[];
	}): Promise<T[]>;

	count(args: {
		model: string;
		where?: Where[];
	}): Promise<number>;

	update<T = Record<string, unknown>>(args: {
		model: string;
		where: Where[];
		update: Record<string, unknown>;
	}): Promise<T>;

	updateMany(args: {
		model: string;
		where?: Where[];
		update: Record<string, unknown>;
	}): Promise<number>;

	delete(args: {
		model: string;
		where: Where[];
	}): Promise<void>;

	deleteMany(args: {
		model: string;
		where?: Where[];
	}): Promise<number>;
}
