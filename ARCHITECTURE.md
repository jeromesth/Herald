# Herald Architecture

Herald is a headless notification system for TypeScript. This document explains how the
system works internally — intended for contributors and AI agents working on the codebase.

## Monorepo Structure

Herald uses pnpm workspaces with a single package:

```
packages/
  core/              # heraldjs — the entire system
    src/
      adapters/      # Database & workflow adapter implementations
      api/           # REST API router and route handlers
      channels/      # Channel registry and provider interface
      core/          # herald() factory, workflow runtime, send, plugins
      db/            # Schema definitions, database helpers
      realtime/      # SSE manager for live notification streams
      templates/     # Template engine interface, Handlebars default
      types/         # Adapter interfaces, plugin types, shared types
```

## Entry Point

The system is created via the `herald()` factory function in `packages/core/src/core/herald.ts`.

```ts
const h = herald({
  database: prismaAdapter(prisma),
  workflow: inngestAdapter(inngest),
  providers: [resendProvider({ apiKey })],
  plugins: [myPlugin()],
});

// h.handler  — HTTP request handler (Request → Response)
// h.api      — programmatic server-side API
// h.workflow — workflow definition helper
// h.$context — internal context (for advanced use)
```

The factory:

1. Validates the config (`HeraldOptions`)
2. Builds a `HeraldContext` containing all resolved dependencies
3. Initializes plugins sequentially (errors propagate, no silent failures)
4. Returns the public interface: `{ handler, api, workflow, $context }`

## Core Data Flow

From trigger to delivery, a notification follows this path:

```
  Caller
    |
    |  api.trigger({ workflowId, to, payload })
    |  or POST /trigger
    v
+---------------------------+
|  Register in              |
|  transactionWorkflowMap   |  (cleaned up in try/finally)
+---------------------------+
    |
    v
+---------------------------+
|  Plugin beforeTrigger     |  (sequential, awaited)
+---------------------------+
    |
    v
+---------------------------+
|  WorkflowAdapter.trigger  |  dispatches to workflow engine
+---------------------------+     (Inngest, memory, etc.)
    |
    v
+---------------------------+
|  Workflow engine executes  |
|  steps via wrapStep()     |
+---------------------------+
    |
    |  For each step:
    v
+---------------------------+
|  conditionsPass()?        |------ no ----> skip step
+---------------------------+
    | yes
    v
+---------------------------+
|  Run user step handler    |
+---------------------------+
    |
    |  If channel step:
    v
+---------------------------+
|  Resolve subscriber       |
|  Resolve recipient        |
+---------------------------+
    |
    v
+---------------------------+
|  sendThroughProvider()    |
|                           |
|  1. beforeSend hooks      |
|  2. Resolve template ctx  |
|  3. Render templates      |
|  4. provider.send()       |
|  5. Check result          |
|  6. afterSend hooks       |
+---------------------------+
    |
    v
+---------------------------+
|  Plugin afterTrigger      |  (sequential, awaited)
+---------------------------+
```

### Transaction Tracking

`transactionWorkflowMap` tracks active workflow executions. It is populated before
dispatch and cleaned up in a `try/finally` block to prevent memory leaks. This map
allows the system to correlate in-flight triggers with their workflow definitions.

### Step Wrapping

`wrapWorkflow()` and `wrapStep()` add Herald's delivery behavior around user-defined
workflow steps without mutating the original definitions. The wrapper handles condition
evaluation, subscriber resolution, and provider dispatch transparently.

## Adapter Interfaces

Herald does not own infrastructure. Users bring their own database and workflow engine
through adapters.

### DatabaseAdapter

Defined in `types/adapter.ts`. Provides a generic CRUD interface over Herald's schema.

| Method       | Purpose                              |
|--------------|--------------------------------------|
| `create`     | Insert a new record                  |
| `findOne`    | Fetch a single record by query       |
| `findMany`   | Fetch multiple records with filters  |
| `count`      | Count records matching a query       |
| `update`     | Update records matching a query      |
| `updateMany` | Bulk update records                  |
| `delete`     | Remove records matching a query      |
| `deleteMany` | Bulk delete records                  |

Implementations: **Prisma**, **memory** (in-process, for testing).

### WorkflowAdapter

Defined in `types/workflow.ts`. Manages workflow registration and execution.

| Method             | Purpose                                    |
|--------------------|--------------------------------------------|
| `registerWorkflow` | Register a workflow definition              |
| `trigger`          | Dispatch a workflow execution               |
| `cancel`           | Cancel an in-flight workflow                |
| `getHandler`       | Return the HTTP handler for the engine      |

Implementations: **Inngest**, **memory** (synchronous, for testing).

### ChannelProvider

Defined in `channels/provider.ts`. Sends a message through a specific channel.

```ts
interface ChannelProvider {
  send(message: ChannelMessage): Promise<{ messageId: string; status: string }>;
}
```

Providers are registered in the `ChannelRegistry`, which resolves the correct provider
for a given channel type (email, SMS, push, in-app, etc.).

## Plugin System

Defined in `types/plugin.ts`. Plugins extend Herald without modifying core code.

```ts
interface HeraldPlugin {
  id: string;
  init?(context: HeraldContext): Promise<void> | void;
  endpoints?: PluginEndpoint[];
  schema?: SchemaExtension;
  hooks?: {
    beforeTrigger?(params): Promise<void> | void;
    afterTrigger?(params): Promise<void> | void;
    beforeSend?(params): Promise<void> | void;
    afterSend?(params): Promise<void> | void;
  };
}
```

### Plugin Capabilities

| Capability          | Description                                        |
|---------------------|----------------------------------------------------|
| **Hooks**           | Intercept trigger and send lifecycle events         |
| **Schema extension**| Add tables or fields via `mergeSchemas`             |
| **Custom endpoints**| Register additional API routes alongside core routes|
| **Init logic**      | Run setup code with access to the full context      |

### Execution Model

- `init()` is called sequentially during `herald()` setup. Errors propagate immediately.
- Hooks run sequentially — each hook is awaited before the next executes. This maintains
  predictable ordering and avoids race conditions between plugins.

## Template System

### TemplateEngine Interface

Defined in `templates/types.ts`. The engine compiles and renders notification content.

The default implementation is `HandlebarsEngine`, which provides variable interpolation
via Handlebars syntax (`{{variable}}`).

### Template Context

Every template receives:

```ts
{
  subscriber,          // resolved subscriber record
  payload,             // data passed to api.trigger()
  app: { name }        // application metadata
}
```

### Email Layouts

`LayoutRegistry` manages reusable email layouts. A default layout can be configured,
and individual notifications can override it. Layouts wrap the rendered template content.

## REST API

### Router

Defined in `api/router.ts`. Herald includes a custom router with pattern matching
(`:param` syntax for path parameters). It does not depend on Express, Hono, or any
framework.

The `handler` returned by `herald()` is a standard `(Request) => Promise<Response>`
function that works with any framework or runtime.

### Route Groups

Routes are organized by domain:

| Group           | Examples                                     |
|-----------------|----------------------------------------------|
| **trigger**     | `POST /trigger`                              |
| **subscribers** | `GET/POST/PATCH /subscribers`, `GET /subscribers/:id` |
| **notifications** | `GET /notifications`                       |
| **preferences** | `GET/PUT /preferences`                       |
| **topics**      | `GET/POST /topics`                           |
| **realtime**    | `GET /realtime/sse`                          |

Plugin routes are mounted alongside core routes during initialization.

### Error Handling

- `HTTPError` class provides structured error responses with status codes
- `jsonResponse()` helper standardizes JSON output
- `parseJsonBody()` handles request body parsing

## Real-Time Notifications

Defined in `realtime/sse.ts`. The `SSEManager` maintains Server-Sent Event connections
for live notification delivery.

```
Client (browser)
    |
    |  GET /realtime/sse?subscriberId=xxx
    v
+-----------------+
|  SSEManager     |  maintains per-subscriber streams
+-----------------+
    |
    |  InAppProvider calls SSEManager
    |  when a notification is created
    v
Client receives event
```

Each subscriber gets their own event stream. The `InAppProvider` pushes notifications
through the SSE connection when delivering in-app messages.

## Database Schema

Defined in `db/schema.ts`. Herald's core schema uses these tables:

| Table             | Purpose                                        |
|-------------------|------------------------------------------------|
| `subscriber`      | Notification recipients and their contact info |
| `notification`    | Sent notification records                      |
| `topic`           | Notification categories/topics                 |
| `topicSubscriber` | Subscriber-to-topic associations               |
| `preference`      | Per-subscriber notification preferences        |
| `channel`         | Channel configuration records                  |

### Field Types

Schema fields use these types: `string`, `number`, `boolean`, `date`, `json`.

### Extensibility

Plugins extend the schema via `mergeSchemas()`, which combines the core schema with
plugin-provided table and field definitions. This allows plugins to store their own
data without forking the core schema.

## Key Design Decisions

### Factory functions over classes

`herald()` not `new Herald()`. The factory pattern keeps the public API simple, avoids
`this`-binding issues, and supports tree-shaking since only the used code paths are
included in bundles.

### Adapter pattern

Herald does not own infrastructure. Users provide their own database (Prisma, etc.)
and workflow engine (Inngest, etc.) through adapter interfaces. This keeps Herald
lightweight and avoids lock-in.

### Context-based dependency injection

`HeraldContext` is built once during `herald()` initialization and passed to all
internal functions. There is no service locator, DI container, or decorator-based
injection — just a plain object threaded through function calls.

### Wrap, don't mutate

`wrapWorkflow()` and `wrapStep()` add delivery behavior by wrapping user-defined
workflow functions. The original definitions are never modified. This keeps user code
decoupled from Herald internals.

### Framework-agnostic handler

The HTTP handler is a standard `(Request) => Promise<Response>` function. It works
with Express, Hono, Next.js, Bun, Deno, Cloudflare Workers, or any runtime that
supports the Web Standard Request/Response API.

### Sequential plugin hooks

Hooks are awaited one at a time in registration order. This guarantees predictable
execution and lets plugins depend on side effects from earlier plugins without race
conditions.
