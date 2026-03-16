/**
 * Prisma database adapter for Herald.
 *
 * Translates Herald's generic database operations into Prisma Client calls.
 * Follows better-auth's adapter pattern — wraps Prisma behind a standardized interface.
 *
 * @example
 * ```ts
 * import { PrismaClient } from "@prisma/client";
 * import { prismaAdapter } from "@herald/core/prisma";
 *
 * const prisma = new PrismaClient();
 * const adapter = prismaAdapter(prisma, { provider: "postgresql" });
 * ```
 */
import { HeraldNotFoundError, HeraldValidationError } from "../../errors.js";
import type { DatabaseAdapter, Where, WhereOperator } from "../../types/adapter.js";

export interface PrismaAdapterConfig {
	/**
	 * The database provider powering Prisma.
	 */
	provider: "postgresql" | "mysql" | "sqlite" | "mongodb";

	/**
	 * Use plural model names (e.g., "subscribers" instead of "subscriber").
	 * @default false
	 */
	usePlural?: boolean;

	/**
	 * Enable debug logging for adapter operations.
	 * @default false
	 */
	debugLogs?: boolean;
}

// Prisma client type — we accept any Prisma client instance
type PrismaClientLike = Record<string, unknown> & {
	$transaction?: <T>(fn: (tx: PrismaClientLike) => Promise<T>) => Promise<T>;
};

/**
 * Create a Herald database adapter backed by Prisma.
 */
export function prismaAdapter(prisma: PrismaClientLike, config: PrismaAdapterConfig): DatabaseAdapter {
	const debugLog = config.debugLogs ? (op: string, args: unknown) => console.debug(`[herald/prisma] ${op}:`, args) : undefined;

	function getModelDelegate(client: PrismaClientLike, model: string) {
		const modelName = config.usePlural ? model : model;
		const delegate = client[modelName] as
			| {
					create: (args: unknown) => Promise<unknown>;
					findFirst: (args: unknown) => Promise<unknown>;
					findMany: (args: unknown) => Promise<unknown[]>;
					count: (args: unknown) => Promise<number>;
					update: (args: unknown) => Promise<unknown>;
					updateMany: (args: unknown) => Promise<{ count: number }>;
					delete: (args: unknown) => Promise<unknown>;
					deleteMany: (args: unknown) => Promise<{ count: number }>;
			  }
			| undefined;

		if (!delegate) {
			throw new HeraldValidationError(
				`[herald/prisma] Model "${modelName}" not found in Prisma Client. ` +
					`Make sure your Prisma schema includes a model named "${modelName}".`,
			);
		}

		return delegate;
	}

	function convertWhere(where: Where[] | undefined): Record<string, unknown> | undefined {
		if (!where || where.length === 0) return undefined;

		const andConditions: Record<string, unknown>[] = [];
		const orConditions: Record<string, unknown>[] = [];

		for (const clause of where) {
			const condition = convertOperator(clause.field, clause.value, clause.operator);

			if (clause.connector === "OR") {
				orConditions.push(condition);
			} else {
				andConditions.push(condition);
			}
		}

		if (orConditions.length > 0 && andConditions.length > 0) {
			return {
				AND: [...andConditions, { OR: orConditions }],
			};
		}

		if (orConditions.length > 0) {
			return { OR: orConditions };
		}

		if (andConditions.length === 1) {
			return andConditions[0];
		}

		return { AND: andConditions };
	}

	function convertOperator(field: string, value: unknown, operator?: WhereOperator): Record<string, unknown> {
		if (!operator || operator === "eq") {
			return { [field]: value };
		}

		const operatorMap: Record<string, string> = {
			ne: "not",
			lt: "lt",
			lte: "lte",
			gt: "gt",
			gte: "gte",
			in: "in",
			not_in: "notIn",
			contains: "contains",
			starts_with: "startsWith",
			ends_with: "endsWith",
		};

		const prismaOp = operatorMap[operator];
		if (!prismaOp) {
			throw new HeraldValidationError(`[herald/prisma] Unsupported operator: ${operator}`);
		}

		return { [field]: { [prismaOp]: value } };
	}

	function convertSelect(select?: string[]): Record<string, true> | undefined {
		if (!select || select.length === 0) return undefined;

		const selectObj: Record<string, true> = {};
		for (const field of select) {
			selectObj[field] = true;
		}
		return selectObj;
	}

	function createAdapter(client: PrismaClientLike): DatabaseAdapter {
		return {
			async create<T>(args: {
				model: string;
				data: Record<string, unknown>;
				select?: string[];
			}): Promise<T> {
				debugLog?.("create", { model: args.model, data: args.data });
				const delegate = getModelDelegate(client, args.model);

				const result = await delegate.create({
					data: args.data,
					select: convertSelect(args.select),
				});

				return result as T;
			},

			async findOne<T>(args: {
				model: string;
				where: Where[];
				select?: string[];
			}): Promise<T | null> {
				debugLog?.("findOne", { model: args.model, where: args.where });
				const delegate = getModelDelegate(client, args.model);

				const result = await delegate.findFirst({
					where: convertWhere(args.where),
					select: convertSelect(args.select),
				});

				return (result as T) ?? null;
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
				const delegate = getModelDelegate(client, args.model);

				const result = await delegate.findMany({
					where: convertWhere(args.where),
					take: args.limit ?? 100,
					skip: args.offset ?? 0,
					orderBy: args.sortBy ? { [args.sortBy.field]: args.sortBy.direction } : undefined,
					select: convertSelect(args.select),
				});

				return result as T[];
			},

			async count(args: {
				model: string;
				where?: Where[];
			}): Promise<number> {
				debugLog?.("count", { model: args.model, where: args.where });
				const delegate = getModelDelegate(client, args.model);

				return delegate.count({
					where: convertWhere(args.where),
				});
			},

			async update<T>(args: {
				model: string;
				where: Where[];
				update: Record<string, unknown>;
			}): Promise<T> {
				debugLog?.("update", { model: args.model, where: args.where });
				const delegate = getModelDelegate(client, args.model);

				// Prisma's `update` requires a unique field at the root.
				// We use `findFirst` then `update` with the found record's ID.
				const existing = (await delegate.findFirst({
					where: convertWhere(args.where),
					select: { id: true },
				})) as { id: string } | null;

				if (!existing) {
					throw new HeraldNotFoundError(args.model, `[herald/prisma] Record not found for update in "${args.model}"`);
				}

				const result = await delegate.update({
					where: { id: existing.id },
					data: args.update,
				});

				return result as T;
			},

			async updateMany(args: {
				model: string;
				where?: Where[];
				update: Record<string, unknown>;
			}): Promise<number> {
				debugLog?.("updateMany", { model: args.model, where: args.where });
				const delegate = getModelDelegate(client, args.model);

				const result = await delegate.updateMany({
					where: convertWhere(args.where),
					data: args.update,
				});

				return result.count;
			},

			async delete(args: {
				model: string;
				where: Where[];
			}): Promise<void> {
				debugLog?.("delete", { model: args.model, where: args.where });
				const delegate = getModelDelegate(client, args.model);

				// Same pattern as update — find first then delete by unique ID
				const existing = (await delegate.findFirst({
					where: convertWhere(args.where),
					select: { id: true },
				})) as { id: string } | null;

				if (!existing) {
					throw new HeraldNotFoundError(args.model, `[herald/prisma] Record not found for delete in "${args.model}"`);
				}

				await delegate.delete({
					where: { id: existing.id },
				});
			},

			async deleteMany(args: {
				model: string;
				where?: Where[];
			}): Promise<number> {
				debugLog?.("deleteMany", { model: args.model, where: args.where });
				const delegate = getModelDelegate(client, args.model);

				const result = await delegate.deleteMany({
					where: convertWhere(args.where),
				});

				return result.count;
			},
		};
	}

	return createAdapter(prisma);
}
