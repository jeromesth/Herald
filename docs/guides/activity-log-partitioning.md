# Activity Log Table Partitioning

The `activityLog` table is the highest-volume table in Herald — every notification lifecycle event (trigger, step execution, send, delivery status change) writes a row. At scale, this table can grow rapidly and degrade query performance.

Herald's schema system defines logical table structure but does not manage physical storage concerns like partitioning. This guide covers how to partition the `activityLog` table yourself using your database's native partitioning features.

## When to partition

Consider partitioning when:

- The `activityLog` table exceeds **10M rows** and query latency is climbing
- You want to **drop old data cheaply** by detaching partitions instead of running expensive `DELETE` queries
- Your monitoring shows **sequential scans** on `activityLog` despite the `createdAt` index

## Schema reference

The `activityLog` table has the following columns (your adapter may use snake_case equivalents like `created_at`):

| Column | Type | Indexed | Notes |
|---|---|---|---|
| id | string (UUID) | unique | Primary key |
| transactionId | string | yes | Groups events for one trigger |
| workflowId | string | yes | Filter by workflow |
| subscriberId | string | yes | Filter by subscriber |
| channel | string | no | in_app, email, sms, etc. |
| stepId | string | no | Workflow step identifier |
| event | string | yes | Event type (e.g. notification.sent) |
| detail | json | no | Event-specific metadata |
| createdAt | date | yes | Timestamp, used for sort and range queries |

## PostgreSQL — Range partitioning by month

Range partitioning on `createdAt` is the most effective strategy. Queries almost always filter or sort by time, and old partitions can be detached and archived.

### Step 1: Convert existing table to partitioned

Run this in a migration after Herald has created the table:

```sql
-- Rename the existing table
ALTER TABLE activity_log RENAME TO activity_log_old;

-- Create the partitioned table with the same structure
CREATE TABLE activity_log (
  id            TEXT        NOT NULL,
  transaction_id TEXT,
  workflow_id   TEXT,
  subscriber_id TEXT,
  channel       TEXT,
  step_id       TEXT,
  event         TEXT        NOT NULL,
  detail        JSONB,
  created_at    TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Recreate indexes (each partition gets its own copy)
CREATE INDEX idx_activity_log_transaction_id ON activity_log (transaction_id);
CREATE INDEX idx_activity_log_workflow_id    ON activity_log (workflow_id);
CREATE INDEX idx_activity_log_subscriber_id  ON activity_log (subscriber_id);
CREATE INDEX idx_activity_log_event          ON activity_log (event);
CREATE INDEX idx_activity_log_created_at     ON activity_log (created_at);
```

> **Note:** The primary key must include the partition key (`created_at`). This is a PostgreSQL requirement for partitioned tables.

### Step 2: Create partitions

Create monthly partitions for the current and upcoming months:

```sql
-- Current month
CREATE TABLE activity_log_y2026m03 PARTITION OF activity_log
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');

-- Next month
CREATE TABLE activity_log_y2026m04 PARTITION OF activity_log
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');

-- Add a default partition to catch anything outside defined ranges
CREATE TABLE activity_log_default PARTITION OF activity_log DEFAULT;
```

### Step 3: Migrate existing data

```sql
INSERT INTO activity_log SELECT * FROM activity_log_old;
DROP TABLE activity_log_old;
```

### Step 4: Automate partition creation

Use `pg_cron` or a scheduled job to create partitions ahead of time:

```sql
-- Example: create next month's partition on the 25th of each month
SELECT cron.schedule('create-activity-partition', '0 0 25 * *', $$
  DO $$
  DECLARE
    next_month DATE := date_trunc('month', NOW() + INTERVAL '1 month');
    partition_name TEXT := 'activity_log_y' || to_char(next_month, 'YYYY') || 'm' || to_char(next_month, 'MM');
    start_date TEXT := to_char(next_month, 'YYYY-MM-DD');
    end_date TEXT := to_char(next_month + INTERVAL '1 month', 'YYYY-MM-DD');
  BEGIN
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF activity_log FOR VALUES FROM (%L) TO (%L)',
      partition_name, start_date, end_date
    );
  END $$;
$$);
```

### Retention: drop old partitions

To remove data older than 90 days, detach and drop the partition:

```sql
-- Detach first (non-blocking in PG 14+)
ALTER TABLE activity_log DETACH PARTITION activity_log_y2026m01 CONCURRENTLY;

-- Then drop or archive
DROP TABLE activity_log_y2026m01;
```

This is instantaneous compared to `DELETE FROM activity_log WHERE created_at < '2026-02-01'`, which would lock the table and generate enormous WAL.

## MySQL — Range partitioning by month

```sql
ALTER TABLE activity_log
PARTITION BY RANGE (UNIX_TIMESTAMP(created_at)) (
  PARTITION p2026_03 VALUES LESS THAN (UNIX_TIMESTAMP('2026-04-01')),
  PARTITION p2026_04 VALUES LESS THAN (UNIX_TIMESTAMP('2026-05-01')),
  PARTITION p_future VALUES LESS THAN MAXVALUE
);
```

Drop old partitions with:

```sql
ALTER TABLE activity_log DROP PARTITION p2026_03;
```

> **MySQL limitation:** All columns in unique indexes must include the partition key. You may need to make `id` + `created_at` a composite primary key.

## SQLite

SQLite does not support native table partitioning. For SQLite deployments:

- Use `DELETE FROM activity_log WHERE created_at < datetime('now', '-90 days')` on a schedule
- Run `VACUUM` afterward to reclaim disk space
- Consider switching to PostgreSQL if the activity log volume outgrows SQLite

## Drizzle adapter

If you're using the Drizzle adapter, define your partitioned table in Drizzle's schema and run a custom migration:

```ts
// drizzle/schema.ts — define the table normally
export const activityLog = pgTable("activity_log", {
  id: text("id").notNull(),
  transactionId: text("transaction_id"),
  workflowId: text("workflow_id"),
  subscriberId: text("subscriber_id"),
  channel: text("channel"),
  stepId: text("step_id"),
  event: text("event").notNull(),
  detail: jsonb("detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.id, table.createdAt] }),
  index("idx_activity_log_transaction_id").on(table.transactionId),
  index("idx_activity_log_workflow_id").on(table.workflowId),
  index("idx_activity_log_subscriber_id").on(table.subscriberId),
  index("idx_activity_log_event").on(table.event),
  index("idx_activity_log_created_at").on(table.createdAt),
]);
```

Then add partitioning in a raw SQL migration:

```sql
-- In a custom Drizzle migration file
ALTER TABLE activity_log SET (partition_by = RANGE (created_at));
```

Or use the PostgreSQL approach above to recreate the table as partitioned.

## Prisma adapter

Prisma does not natively support partitioned tables in its schema DSL. Define the table in your Prisma schema as usual, then apply partitioning via a raw SQL migration:

```prisma
model ActivityLog {
  id            String   @id
  transactionId String?  @map("transaction_id")
  workflowId    String?  @map("workflow_id")
  subscriberId  String?  @map("subscriber_id")
  channel       String?
  stepId        String?  @map("step_id")
  event         String
  detail        Json?
  createdAt     DateTime @map("created_at")

  @@index([transactionId])
  @@index([workflowId])
  @@index([subscriberId])
  @@index([event])
  @@index([createdAt])
  @@map("activity_log")
}
```

Then create a migration that converts to a partitioned table using the PostgreSQL steps above. Note that Prisma will need the composite primary key `(id, created_at)` — you may need to adjust this in a raw migration since Prisma doesn't support composite PKs on non-relation fields natively.
