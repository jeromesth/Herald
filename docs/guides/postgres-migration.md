# Migrating from Postgres Workflow Adapter

The `postgresWorkflowAdapter()` is a great starting point -- zero external dependencies, just your existing PostgreSQL database. But as your notification volume or orchestration complexity grows, you may want to migrate to a dedicated workflow engine.

## When to migrate

Consider moving away from the Postgres adapter when you see:

- **High job volume** -- the `herald_jobs` table is growing faster than jobs are processed, and polling frequency is becoming a bottleneck.
- **Complex orchestration** -- you need fan-out/fan-in patterns, long-running workflows with human-in-the-loop steps, or cross-workflow coordination that the simple step-by-step executor cannot express.
- **Multi-service coordination** -- notifications need to trigger or wait on events from other services, and you want a centralized workflow engine to manage that.
- **Reliability at scale** -- you need built-in observability dashboards, automatic retries with exponential backoff, and rate limiting that go beyond what the Postgres adapter provides.

## Migration to Inngest

Inngest is the recommended next step. Herald has a first-class adapter for it.

### Step 1: Install Inngest

```bash
pnpm add inngest
```

### Step 2: Swap the adapter

Before:

```ts
import { herald } from "heraldjs";
import { prismaAdapter } from "heraldjs/prisma";
import { postgresWorkflowAdapter } from "heraldjs/postgres-workflow";

const app = herald({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  workflow: postgresWorkflowAdapter({ pool }),
  // ...
});
```

After:

```ts
import { herald } from "heraldjs";
import { prismaAdapter } from "heraldjs/prisma";
import { inngestAdapter } from "heraldjs/inngest";
import { Inngest } from "inngest";

const inngest = new Inngest({ id: "my-app" });

const app = herald({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  workflow: inngestAdapter({ client: inngest }),
  // ...
});
```

### Step 3: Register Inngest functions

Herald workflows become Inngest functions. Expose the Inngest serve handler in your API:

```ts
import { serve } from "inngest/express"; // or your framework of choice

app.use("/api/inngest", serve({ client: inngest, functions: app.inngestFunctions }));
```

### Step 4: Deploy and verify

1. Deploy your updated app with the Inngest adapter.
2. Verify workflows trigger correctly by sending a test notification.
3. Check the Inngest dashboard for function execution logs.

## Migration to Temporal

Temporal is a strong choice for teams that need advanced orchestration (saga patterns, signals, queries, child workflows). A Herald Temporal adapter is not yet available, but the path is clear:

1. **Implement `WorkflowAdapter`** -- Temporal activities map to Herald steps. The adapter would translate `trigger()` into a Temporal workflow start and each `WorkflowStep` into an activity.
2. **Use the Temporal SDK** -- the `@temporalio/client` and `@temporalio/worker` packages provide the primitives.
3. **Register activities** -- each Herald step type (`send`, `delay`, `digest`, `batch`) becomes a Temporal activity.

If you need Temporal support, contributions are welcome. The adapter interface is documented in `types/workflow.ts`.

## Data migration: handling in-flight jobs

The most important part of migration is draining existing jobs from the Postgres queue before cutting over.

### Recommended approach: drain then switch

1. **Stop triggering new workflows** -- deploy a version that still uses the Postgres adapter but stops accepting new triggers (e.g., feature flag or maintenance mode).
2. **Wait for the queue to drain** -- monitor the `herald_jobs` table until all pending and running jobs complete:
   ```sql
   SELECT status, count(*) FROM herald_jobs GROUP BY status;
   ```
3. **Switch the adapter** -- deploy the version with the new workflow adapter.
4. **Resume triggers** -- re-enable notification triggers.

### Alternative: run both adapters in parallel

For zero-downtime migration, you can temporarily run both:

1. Deploy the new adapter for all *new* triggers.
2. Keep the Postgres worker running to finish existing jobs.
3. Once the `herald_jobs` table has no `pending` or `running` rows, shut down the Postgres worker.

## Rollback strategy

If the new workflow engine has issues, rolling back is straightforward because the adapter interface is the same:

1. **Swap the adapter back** -- revert the `workflow` config to `postgresWorkflowAdapter()`.
2. **Redeploy** -- the Postgres adapter will immediately start processing new triggers.
3. **In-flight Inngest/Temporal jobs** -- these will continue executing in the external engine. They are independent of Herald's adapter config, so they will complete on their own. No data is lost.

The key insight is that Herald's adapter pattern makes the workflow engine a pluggable concern. Your notification workflows, channel providers, and database stay exactly the same -- only the execution engine changes.
