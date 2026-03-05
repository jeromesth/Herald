# v0.2.5 — Postgres Workflow Engine: Implementation Plan

## Overview

A self-contained workflow adapter that uses PostgreSQL directly for durable workflow execution — no external services like Inngest, Temporal, or Trigger.dev required. Users bring their own Postgres connection, and Herald handles job scheduling, step execution, retries, delay/digest/throttle semantics, and cancellation using PostgreSQL as the durable state store.

This fills the gap between the **memory adapter** (testing only, no durability) and the **Inngest adapter** (requires external SaaS). The Postgres adapter is production-grade, self-hosted, and zero-dependency beyond `pg`.

---

## Architecture

```
┌──────────────────────────────────────────────────┐
│  Herald Core                                      │
│  herald({ workflow: postgresWorkflowAdapter() })  │
└────────────────┬─────────────────────────────────┘
                 │ implements WorkflowAdapter
                 ▼
┌──────────────────────────────────────────────────┐
│  Postgres Workflow Adapter                        │
│                                                   │
│  trigger() → INSERT into herald_wf_jobs           │
│  cancel()  → UPDATE status = 'cancelled'          │
│  poll()    → SELECT ... FOR UPDATE SKIP LOCKED    │
│  execute() → Run steps, UPDATE progress            │
│                                                   │
│  Tables: herald_wf_jobs, herald_wf_steps,         │
│          herald_wf_digest_events                   │
└──────────────────────────────────────────────────┘
                 │
                 ▼
            PostgreSQL
```

### Key Design Decisions

1. **Polling-based execution** — A background poller picks up ready jobs using `SELECT ... FOR UPDATE SKIP LOCKED` for safe concurrency across multiple Herald instances.
2. **Step-level checkpointing** — Each step's completion is recorded so jobs can resume after crashes.
3. **Delay via scheduled_at** — Delay steps set a future `scheduled_at` timestamp on the job row; the poller skips jobs that aren't ready yet.
4. **Digest via event collection table** — Digest steps insert a row into `herald_wf_digest_events` and set a `scheduled_at` for the window expiry. When the window fires, all collected events are fetched and passed to the handler.
5. **No external dependencies** — Uses only the `pg` npm package (peer dependency).
6. **Auto-migration** — Creates tables on first use (idempotent `CREATE TABLE IF NOT EXISTS`).

---

## Database Schema (3 tables)

### `herald_wf_jobs`

The main job queue table. One row per triggered workflow execution per recipient.

```sql
CREATE TABLE IF NOT EXISTS herald_wf_jobs (
  id              TEXT PRIMARY KEY,
  transaction_id  TEXT NOT NULL,
  workflow_id     TEXT NOT NULL,
  subscriber_id   TEXT NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}',
  actor           TEXT,
  tenant          TEXT,
  overrides       JSONB,
  status          TEXT NOT NULL DEFAULT 'pending',
    -- pending | running | completed | failed | cancelled
  current_step    INT NOT NULL DEFAULT 0,
  step_results    JSONB NOT NULL DEFAULT '{}',
    -- { "stepId": { ...StepResult } } for resumption
  error           TEXT,
  retry_count     INT NOT NULL DEFAULT 0,
  max_retries     INT NOT NULL DEFAULT 3,
  scheduled_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_herald_wf_jobs_poll
  ON herald_wf_jobs (status, scheduled_at)
  WHERE status IN ('pending', 'running');
CREATE INDEX IF NOT EXISTS idx_herald_wf_jobs_transaction
  ON herald_wf_jobs (transaction_id);
```

### `herald_wf_digest_events`

Stores events collected during a digest window.

```sql
CREATE TABLE IF NOT EXISTS herald_wf_digest_events (
  id              TEXT PRIMARY KEY,
  job_id          TEXT NOT NULL REFERENCES herald_wf_jobs(id) ON DELETE CASCADE,
  digest_key      TEXT NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_herald_wf_digest_key
  ON herald_wf_digest_events (digest_key, job_id);
```

### `herald_wf_throttle_state`

Tracks throttle counters per key with window expiry.

```sql
CREATE TABLE IF NOT EXISTS herald_wf_throttle_state (
  key             TEXT PRIMARY KEY,
  count           INT NOT NULL DEFAULT 0,
  window_start    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  window_ms       BIGINT NOT NULL
);
```

---

## Implementation Steps

### Step 1: Create the adapter file structure

**File:** `packages/core/src/adapters/workflow/postgres.ts`

- Factory function: `postgresWorkflowAdapter(config: PostgresWorkflowConfig): WorkflowAdapter`
- Config interface:

```typescript
export interface PostgresWorkflowConfig {
  /** PostgreSQL connection string */
  connectionString: string;
  /** Or pass an existing pg Pool instance */
  pool?: PgPoolLike;
  /** Polling interval in milliseconds. @default 1000 */
  pollInterval?: number;
  /** Maximum concurrent job executions. @default 10 */
  concurrency?: number;
  /** Maximum retries per job. @default 3 */
  maxRetries?: number;
  /** Table name prefix. @default "herald_wf" */
  tablePrefix?: string;
  /** Auto-create tables on startup. @default true */
  autoMigrate?: boolean;
}
```

### Step 2: Implement `WorkflowAdapter` interface methods

#### `registerWorkflow(workflow)`
- Store in local `Map<string, NotificationWorkflow>` (same pattern as Inngest/memory adapters).

#### `trigger(args) → TriggerResult`
- Generate `transactionId` if not provided.
- Expand `to` into individual recipients.
- INSERT one `herald_wf_jobs` row per recipient with `status = 'pending'`.
- For workflows with digest steps, also insert into `herald_wf_digest_events` for each digest step.
- Return `{ transactionId, status: "queued" }`.

#### `cancel(args)`
- `UPDATE herald_wf_jobs SET status = 'cancelled' WHERE transaction_id = $1 AND workflow_id = $2 AND status IN ('pending', 'running')`.

#### `getHandler() → null`
- The Postgres adapter doesn't need an HTTP endpoint (unlike Inngest). Returns `null`.

### Step 3: Implement the job poller

**Core polling loop:**

```typescript
async function pollAndExecute(): Promise<void> {
  const jobs = await pool.query(`
    SELECT * FROM ${prefix}_jobs
    WHERE status = 'pending'
      AND scheduled_at <= NOW()
    ORDER BY created_at ASC
    LIMIT $1
    FOR UPDATE SKIP LOCKED
  `, [concurrency]);

  await Promise.allSettled(
    jobs.rows.map(job => executeJob(job))
  );
}
```

- Runs on `setInterval(pollInterval)`.
- Uses `FOR UPDATE SKIP LOCKED` for safe multi-instance concurrency.
- `Promise.allSettled` isolates per-job failures.

**Lifecycle:**
- `start()` — begins polling (called internally after first `trigger()`).
- `stop()` — clears interval, drains in-flight jobs, closes pool if adapter owns it.

### Step 4: Implement step execution engine

**`executeJob(job)` function:**

```
1. UPDATE status = 'running'
2. Look up workflow from registered Map
3. Resume from job.current_step (supports crash recovery)
4. For each step starting from current_step:
   a. Evaluate conditions (reuse conditionsPass from workflow-runtime.ts)
   b. Execute step based on type:
      - channel step → call handler, record result
      - delay → calculate scheduled_at, UPDATE job, RETURN (will be picked up later)
      - digest → check if window expired:
        - If not yet waiting: set scheduled_at to window end, RETURN
        - If window expired: collect events from herald_wf_digest_events, call handler
      - throttle → check/update herald_wf_throttle_state, break loop if throttled
      - fetch → call handler, merge fetchResult into payload
   c. UPDATE current_step = next, store step_results
5. UPDATE status = 'completed'
```

**Key: Delay and digest steps cause the job to "park" — the row stays in `pending`/`running` with a future `scheduled_at`, and the poller naturally picks it back up when the time arrives.**

### Step 5: Implement step type handlers

#### Delay
```typescript
async function handleDelay(job, step, pool): Promise<"parked" | "continue"> {
  // Run handler to extract delay config
  const result = await step.handler({ ... step: { delay: async (c) => c } });
  const { amount, unit } = result.data;
  const ms = toMs(amount, unit);
  // Park the job
  await pool.query(
    `UPDATE ${prefix}_jobs SET scheduled_at = NOW() + $1 * INTERVAL '1 millisecond', current_step = $2 + 1 WHERE id = $3`,
    [ms, currentStep, job.id]
  );
  return "parked";
}
```

#### Digest
```typescript
async function handleDigest(job, step, pool): Promise<"parked" | "continue"> {
  const digestKey = `${job.workflow_id}:${step.stepId}:${job.subscriber_id}`;

  if (!job.step_results[step.stepId]?.windowSet) {
    // First encounter — set window, park
    const config = await extractDigestConfig(step, job);
    const ms = toMs(config.window, config.unit);
    await pool.query(
      `UPDATE ${prefix}_jobs SET scheduled_at = NOW() + $1 * INTERVAL '1 millisecond', step_results = step_results || $2 WHERE id = $3`,
      [ms, JSON.stringify({ [step.stepId]: { windowSet: true } }), job.id]
    );
    return "parked";
  }

  // Window expired — collect events
  const events = await pool.query(
    `DELETE FROM ${prefix}_digest_events WHERE digest_key = $1 RETURNING payload, created_at`,
    [digestKey]
  );
  const digested = events.rows.map(r => ({ payload: r.payload, timestamp: r.created_at }));
  // Call handler with collected events
  await step.handler({ ..., step: { digest: async () => digested } });
  return "continue";
}
```

#### Throttle
```typescript
async function handleThrottle(job, step, pool): Promise<boolean> {
  // Use UPSERT to atomically check and increment
  const result = await pool.query(`
    INSERT INTO ${prefix}_throttle_state (key, count, window_start, window_ms)
    VALUES ($1, 1, NOW(), $2)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE
        WHEN ${prefix}_throttle_state.window_start + (${prefix}_throttle_state.window_ms || ' milliseconds')::interval < NOW()
        THEN 1
        ELSE ${prefix}_throttle_state.count + 1
      END,
      window_start = CASE
        WHEN ${prefix}_throttle_state.window_start + (${prefix}_throttle_state.window_ms || ' milliseconds')::interval < NOW()
        THEN NOW()
        ELSE ${prefix}_throttle_state.window_start
      END
    RETURNING count
  `, [throttleKey, windowMs]);

  return result.rows[0].count > config.limit;
}
```

#### Fetch
- Same pattern as memory adapter: call `performFetch()` from `workflow-runtime.ts`, merge result into job payload.

### Step 6: Auto-migration

```typescript
async function ensureTables(pool, prefix): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${prefix}_jobs ( ... );
    CREATE TABLE IF NOT EXISTS ${prefix}_digest_events ( ... );
    CREATE TABLE IF NOT EXISTS ${prefix}_throttle_state ( ... );
    -- Indexes
  `);
}
```

- Called once on first `trigger()` or explicitly via `postgresWorkflowAdapter.migrate()`.
- Idempotent — safe to run on every startup.

### Step 7: Graceful shutdown

- Export a `stop()` method on the returned adapter (extended interface).
- Clears polling interval.
- Waits for in-flight job executions to complete (with timeout).
- Closes the `pg.Pool` if the adapter created it (not if user passed one in).

```typescript
export function postgresWorkflowAdapter(config): WorkflowAdapter & {
  start(): Promise<void>;
  stop(): Promise<void>;
}
```

### Step 8: Build configuration

**`packages/core/tsup.config.ts`** — Add entry point:
```typescript
"adapters/workflow/postgres": "src/adapters/workflow/postgres.ts",
```

**`packages/core/package.json`** — Add subpath export:
```json
"./postgres": {
  "import": "./dist/adapters/workflow/postgres.mjs",
  "types": "./dist/adapters/workflow/postgres.d.mts"
}
```

Add `pg` as optional peer dependency:
```json
"peerDependencies": {
  "pg": ">=8.0.0"
},
"peerDependenciesMeta": {
  "pg": { "optional": true }
}
```

### Step 9: Tests

**File:** `packages/core/tests/postgres-workflow.test.ts`

Tests should use a lightweight approach — mock the `pg.Pool` to verify SQL queries and job execution flow without requiring a real Postgres instance.

**Test cases:**

1. **Registration** — `registerWorkflow()` stores workflow in internal map
2. **Trigger** — inserts job rows (one per recipient), returns transactionId
3. **Trigger with digest** — inserts both job and digest event rows
4. **Cancel** — updates matching job rows to `cancelled` status
5. **Poll** — selects pending jobs with `scheduled_at <= NOW()`
6. **Step execution — channel step** — calls handler, advances current_step
7. **Step execution — delay** — parks job with future scheduled_at
8. **Step execution — digest (first pass)** — parks job, sets windowSet flag
9. **Step execution — digest (window expired)** — collects events, calls handler
10. **Step execution — throttle** — allows under limit, breaks at limit
11. **Step execution — fetch** — merges fetch result into payload
12. **Crash recovery** — resumes from current_step after restart
13. **Retry on failure** — increments retry_count, re-queues with backoff
14. **Max retries exceeded** — marks job as `failed` with error message
15. **Concurrency** — `FOR UPDATE SKIP LOCKED` prevents double-processing
16. **Auto-migration** — `CREATE TABLE IF NOT EXISTS` runs idempotently
17. **Graceful shutdown** — `stop()` clears interval and drains in-flight jobs
18. **getHandler()** — returns `null`
19. **Multi-step workflow** — delay → fetch → email pipeline executes correctly

### Step 10: Public exports

**`packages/core/src/index.ts`** — Do NOT export from main index (follows same pattern as Inngest/Prisma — separate subpath import).

**Usage:**
```typescript
import { postgresWorkflowAdapter } from "@herald/core/postgres";

const workflow = postgresWorkflowAdapter({
  connectionString: process.env.DATABASE_URL,
  pollInterval: 1000,
  concurrency: 10,
});

const h = herald({
  database: prismaAdapter({ provider: "postgresql" }),
  workflow,
  workflows: [welcomeWorkflow],
});

// Graceful shutdown
process.on("SIGTERM", () => workflow.stop());
```

---

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `packages/core/src/adapters/workflow/postgres.ts` | **Create** | Main adapter implementation (~400 lines) |
| `packages/core/tests/postgres-workflow.test.ts` | **Create** | Test suite (~300 lines) |
| `packages/core/tsup.config.ts` | **Edit** | Add `postgres` entry point |
| `packages/core/package.json` | **Edit** | Add `./postgres` export + `pg` peer dep |

---

## Out of Scope (Future)

- **Dead letter queue** — Failed jobs beyond max retries could be moved to a DLQ table. Deferred to v0.3.x.
- **Job cleanup/TTL** — Automatic cleanup of completed/failed jobs older than N days.
- **Observability hooks** — `onJobStart`, `onJobComplete`, `onJobFail` callbacks.
- **LISTEN/NOTIFY** — Replace polling with Postgres LISTEN/NOTIFY for lower latency. Can be added as an opt-in enhancement.
- **Priority queues** — Job priority levels for critical workflows.
