/**
 * Drizzle ORM database adapter for Herald.
 *
 * Translates Herald's generic database operations into Drizzle ORM calls.
 * Follows the same adapter pattern as prismaAdapter.
 *
 * @example
 * ```ts
 * import { drizzle } from "drizzle-orm/node-postgres";
 * import { drizzleAdapter } from "@herald/core/drizzle";
 * import { heraldSchema } from "@herald/core/drizzle";
 *
 * const db = drizzle(pool, { schema: heraldSchema });
 * const adapter = drizzleAdapter(db);
 * ```
 */
import type { SQL, SQLWrapper } from "drizzle-orm";
import { and, asc, desc, eq, gt, gte, inArray, like, lt, lte, ne, notInArray, or, sql } from "drizzle-orm";
import type { PgColumn, PgTableWithColumns } from "drizzle-orm/pg-core";
import type { DatabaseAdapter, Where, WhereOperator } from "../../../types/adapter.js";
import { channels, notifications, preferences, subscribers, topicSubscribers, topics } from "./schema.js";

export interface DrizzleAdapterConfig {
	debugLogs?: boolean;
}

// biome-ignore lint/suspicious/noExplicitAny: Drizzle PgTable generic requires full column config; we constrain via HeraldTable instead
type AnyPgTable = PgTableWithColumns<any>;

type HeraldTable = AnyPgTable & { id: PgColumn };

type DrizzlePgLike = {
	// biome-ignore lint/suspicious/noExplicitAny: Drizzle query builder return types vary by dialect
	select: (fields?: Record<string, unknown>) => any;
	// biome-ignore lint/suspicious/noExplicitAny: Drizzle query builder return types vary by dialect
	insert: (table: AnyPgTable) => any;
	// biome-ignore lint/suspicious/noExplicitAny: Drizzle query builder return types vary by dialect
	update: (table: AnyPgTable) => any;
	// biome-ignore lint/suspicious/noExplicitAny: Drizzle query builder return types vary by dialect
	delete: (table: AnyPgTable) => any;
};

const MODEL_MAP: Record<string, HeraldTable> = {
	subscriber: subscribers,
	notification: notifications,
	topic: topics,
	topicSubscriber: topicSubscribers,
	preference: preferences,
	channel: channels,
};

function getTable(model: string): HeraldTable {
	const table = MODEL_MAP[model];
	if (!table) {
		throw new Error(`[herald/drizzle] Unknown model "${model}". ` + `Available models: ${Object.keys(MODEL_MAP).join(", ")}`);
	}
	return table;
}

function getColumn(table: HeraldTable, field: string): SQLWrapper {
	const col = (table as Record<string, unknown>)[field] as SQLWrapper | undefined;
	if (!col) {
		throw new Error(`[herald/drizzle] Unknown field "${field}" on table`);
	}
	return col;
}

// biome-ignore lint/suspicious/noExplicitAny: Drizzle operator functions accept broad column types
function convertOperator(column: any, value: unknown, operator?: WhereOperator): SQL {
	if (!operator || operator === "eq") return eq(column, value);

	switch (operator) {
		case "ne":
			return ne(column, value);
		case "lt":
			return lt(column, value);
		case "lte":
			return lte(column, value);
		case "gt":
			return gt(column, value);
		case "gte":
			return gte(column, value);
		case "in":
			return inArray(column, value as unknown[]);
		case "not_in":
			return notInArray(column, value as unknown[]);
		case "contains":
			return like(column, `%${value}%`);
		case "starts_with":
			return like(column, `${value}%`);
		case "ends_with":
			return like(column, `%${value}`);
		default:
			throw new Error(`[herald/drizzle] Unsupported operator: ${operator}`);
	}
}

function convertWhere(table: HeraldTable, where: Where[] | undefined): SQL | undefined {
	if (!where || where.length === 0) return undefined;

	const andConditions: SQL[] = [];
	const orConditions: SQL[] = [];

	for (const clause of where) {
		const column = getColumn(table, clause.field);
		const condition = convertOperator(column, clause.value, clause.operator);

		if (clause.connector === "OR") {
			orConditions.push(condition);
		} else {
			andConditions.push(condition);
		}
	}

	if (orConditions.length > 0 && andConditions.length > 0) {
		const orClause = or(...orConditions);
		const combined = and(...andConditions, orClause);
		return combined;
	}

	if (orConditions.length > 0) {
		return or(...orConditions);
	}

	if (andConditions.length === 1) {
		return andConditions[0];
	}

	return and(...andConditions);
}

function applySelect(table: HeraldTable, select?: string[]): Record<string, SQLWrapper> | undefined {
	if (!select || select.length === 0) return undefined;

	const fields: Record<string, SQLWrapper> = {};
	for (const field of select) {
		fields[field] = getColumn(table, field);
	}
	return fields;
}

function pickFields(record: Record<string, unknown>, select?: string[]): Record<string, unknown> {
	if (!select || select.length === 0) return record;
	const result: Record<string, unknown> = {};
	for (const field of select) {
		if (field in record) {
			result[field] = record[field];
		}
	}
	return result;
}

export function drizzleAdapter(db: DrizzlePgLike, config?: DrizzleAdapterConfig): DatabaseAdapter {
	const debugLog = config?.debugLogs ? (op: string, args: unknown) => console.debug(`[herald/drizzle] ${op}:`, args) : undefined;

	return {
		async create<T>(args: {
			model: string;
			data: Record<string, unknown>;
			select?: string[];
		}): Promise<T> {
			debugLog?.("create", { model: args.model, data: args.data });
			const table = getTable(args.model);

			const [result] = await db.insert(table).values(args.data).returning();

			return pickFields(result as Record<string, unknown>, args.select) as T;
		},

		async findOne<T>(args: {
			model: string;
			where: Where[];
			select?: string[];
		}): Promise<T | null> {
			debugLog?.("findOne", { model: args.model, where: args.where });
			const table = getTable(args.model);
			const whereClause = convertWhere(table, args.where);
			const selectFields = applySelect(table, args.select);

			const query = selectFields ? db.select(selectFields) : db.select();
			const results = await query.from(table).where(whereClause).limit(1);

			if (!results || results.length === 0) return null;
			return results[0] as T;
		},

		async findMany<T>(args: {
			model: string;
			where?: Where[];
			limit?: number;
			offset?: number;
			sortBy?: { field: string; direction: "asc" | "desc" };
			select?: string[];
		}): Promise<T[]> {
			debugLog?.("findMany", { model: args.model, where: args.where });
			const table = getTable(args.model);
			const whereClause = convertWhere(table, args.where);
			const selectFields = applySelect(table, args.select);

			let query = selectFields ? db.select(selectFields).from(table) : db.select().from(table);

			if (whereClause) {
				query = query.where(whereClause);
			}

			if (args.sortBy) {
				const column = getColumn(table, args.sortBy.field);
				// biome-ignore lint/suspicious/noExplicitAny: Drizzle column type for orderBy
				query = query.orderBy(args.sortBy.direction === "asc" ? asc(column as any) : desc(column as any));
			}

			query = query.limit(args.limit ?? 100).offset(args.offset ?? 0);

			return (await query) as T[];
		},

		async count(args: {
			model: string;
			where?: Where[];
		}): Promise<number> {
			debugLog?.("count", { model: args.model, where: args.where });
			const table = getTable(args.model);
			const whereClause = convertWhere(table, args.where);

			let query = db.select({ count: sql<number>`count(*)` }).from(table);

			if (whereClause) {
				query = query.where(whereClause);
			}

			const [result] = await query;
			return Number(result?.count ?? 0);
		},

		async update<T>(args: {
			model: string;
			where: Where[];
			update: Record<string, unknown>;
		}): Promise<T> {
			debugLog?.("update", { model: args.model, where: args.where });
			const table = getTable(args.model);
			const whereClause = convertWhere(table, args.where);

			// Find record first, then update by id (same pattern as Prisma adapter)
			const existing = await db.select({ id: table.id }).from(table).where(whereClause).limit(1);

			if (!existing || existing.length === 0) {
				throw new Error(`[herald/drizzle] Record not found for update in "${args.model}"`);
			}

			const [result] = await db.update(table).set(args.update).where(eq(table.id, existing[0].id)).returning();

			return result as T;
		},

		async updateMany(args: {
			model: string;
			where?: Where[];
			update: Record<string, unknown>;
		}): Promise<number> {
			debugLog?.("updateMany", { model: args.model, where: args.where });
			const table = getTable(args.model);
			const whereClause = convertWhere(table, args.where);

			let query = db.update(table).set(args.update);

			if (whereClause) {
				query = query.where(whereClause);
			}

			const results = await query.returning();
			return Array.isArray(results) ? results.length : 0;
		},

		async delete(args: {
			model: string;
			where: Where[];
		}): Promise<void> {
			debugLog?.("delete", { model: args.model, where: args.where });
			const table = getTable(args.model);
			const whereClause = convertWhere(table, args.where);

			// Find record first, then delete by id
			const existing = await db.select({ id: table.id }).from(table).where(whereClause).limit(1);

			if (!existing || existing.length === 0) {
				throw new Error(`[herald/drizzle] Record not found for delete in "${args.model}"`);
			}

			await db.delete(table).where(eq(table.id, existing[0].id));
		},

		async deleteMany(args: {
			model: string;
			where?: Where[];
		}): Promise<number> {
			debugLog?.("deleteMany", { model: args.model, where: args.where });
			const table = getTable(args.model);
			const whereClause = convertWhere(table, args.where);

			let query = db.delete(table);

			if (whereClause) {
				query = query.where(whereClause);
			}

			const results = await query.returning();
			return Array.isArray(results) ? results.length : 0;
		},
	};
}
