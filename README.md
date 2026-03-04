<p align="center">
  <h1 align="center">Herald</h1>
  <p align="center">
    Open-source headless notification system for TypeScript.
    <br />
    Build notification workflows on your own infrastructure.
    <br />
    <br />
    <a href="#quickstart">Quickstart</a>
    ·
    <a href="#features">Features</a>
    ·
    <a href="#adapters">Adapters</a>
    ·
    <a href="ROADMAP.md">Roadmap</a>
  </p>
</p>

---

Herald is a **headless, open-source notification infrastructure** library for TypeScript. It provides a complete notification system — subscribers, workflows, preferences, channels, and an in-app inbox — without locking you into a SaaS platform.

Think of it as the **better-auth for notifications**: one config file, bring your own database, bring your own workflow engine.

## Why Herald?

| | SaaS (Novu, Knock) | Herald |
|---|---|---|
| **Hosting** | Vendor-managed | Your infrastructure |
| **Data** | Stored externally | Your database |
| **Pricing** | Per-notification | Free forever |
| **Workflow engine** | Proprietary | Bring your own (Inngest, Temporal, etc.) |
| **Database** | Proprietary | Bring your own (Prisma, Drizzle, etc.) |
| **Customization** | Limited API | Full source access + plugin system |

## Quickstart

### Install

```bash
# Core library
pnpm add @herald/core

# Pick your database adapter
pnpm add @prisma/client

# Pick your workflow engine
pnpm add inngest
```

### Configure

Herald follows the same single-config pattern as [better-auth](https://github.com/better-auth/better-auth). One file, one source of truth:

```typescript
// lib/notifications.ts
import { herald } from "@herald/core";
import { prismaAdapter } from "@herald/core/prisma";
import { inngestAdapter } from "@herald/core/inngest";
import { PrismaClient } from "@prisma/client";
import { Inngest } from "inngest";

const prisma = new PrismaClient();
const inngest = new Inngest({ id: "my-app" });

export const notifications = herald({
  appName: "My App",
  basePath: "/api/notifications",

  // Bring your own database
  database: prismaAdapter(prisma, { provider: "postgresql" }),

  // Bring your own workflow engine
  workflow: inngestAdapter({ client: inngest }),

  // Define your notification workflows
  workflows: [
    {
      id: "welcome",
      name: "Welcome Notification",
      steps: [
        {
          stepId: "in-app",
          type: "in_app",
          handler: async ({ subscriber, payload }) => ({
            subject: "Welcome!",
            body: `Hello ${subscriber.externalId}, welcome to our platform!`,
            actionUrl: "/getting-started",
          }),
        },
        {
          stepId: "send-email",
          type: "email",
          handler: async ({ subscriber, payload }) => ({
            subject: "Welcome aboard!",
            body: `We're glad to have you, ${subscriber.firstName}!`,
          }),
        },
      ],
    },
  ],

  // Default preferences
  defaultPreferences: {
    channels: { in_app: true, email: true },
  },

  // Extend with plugins
  plugins: [],
});
```

### Mount the API

Herald generates REST endpoints automatically. Mount them in your framework:

```typescript
// Next.js App Router
// app/api/notifications/[...path]/route.ts
import { notifications } from "@/lib/notifications";

export const GET = notifications.handler;
export const POST = notifications.handler;
export const PUT = notifications.handler;
export const PATCH = notifications.handler;
export const DELETE = notifications.handler;
```

```typescript
// Express / Hono / any framework
app.all("/api/notifications/*", (req) => notifications.handler(req));
```

### Trigger Notifications

```typescript
// From your API routes or server actions
import { notifications } from "@/lib/notifications";

// Trigger a workflow
await notifications.api.trigger({
  workflowId: "welcome",
  to: "user-123",
  payload: { planName: "Pro" },
});

// Trigger for multiple recipients
await notifications.api.trigger({
  workflowId: "team-invite",
  to: ["user-1", "user-2", "user-3"],
  payload: { teamName: "Engineering" },
});
```

### Manage Subscribers

```typescript
// Create or update a subscriber
await notifications.api.upsertSubscriber({
  externalId: "user-123",
  email: "alice@example.com",
  firstName: "Alice",
  data: { plan: "pro" },
});

// Get notifications (in-app inbox)
const { notifications: items, totalCount } = await notifications.api.getNotifications({
  subscriberId: "user-123",
  read: false,
  limit: 20,
});

// Mark as read
await notifications.api.markNotifications({
  ids: ["notif-1", "notif-2"],
  action: "read",
});

// Update preferences
await notifications.api.updatePreferences("user-123", {
  channels: { email: false },
  workflows: { "marketing-digest": false },
});
```

## Features

### Core

- **Single configuration file** — one `herald()` call configures everything
- **Type-safe** — full TypeScript types and inference throughout
- **Framework agnostic** — works with Next.js, Express, Hono, Fastify, or any framework
- **Headless** — no UI opinions, bring your own frontend

### Notification System

- **Multi-channel delivery** — in-app and email (SMS, push coming soon)
- **Workflow engine** — define notification flows with steps, delays, and digests
- **Subscriber management** — create, update, and manage notification recipients
- **In-app inbox** — query notifications with read/seen/archived state
- **Notification preferences** — per-channel, per-workflow, per-category opt-in/opt-out
- **Topics** — group subscribers for fan-out notifications
- **Plugin system** — extend Herald with custom logic, schemas, and endpoints

### REST API

Herald auto-generates these REST endpoints:

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/trigger` | Trigger a notification workflow |
| `POST` | `/trigger/bulk` | Trigger multiple workflows at once |
| `DELETE` | `/trigger/:transactionId` | Cancel an in-flight workflow |
| `POST` | `/subscribers` | Create or update a subscriber |
| `GET` | `/subscribers/:id` | Get a subscriber |
| `PATCH` | `/subscribers/:id` | Update a subscriber |
| `DELETE` | `/subscribers/:id` | Delete a subscriber |
| `GET` | `/notifications/:subscriberId` | List notifications (inbox) |
| `GET` | `/notifications/:subscriberId/count` | Get notification count |
| `POST` | `/notifications/mark` | Mark notifications read/seen/archived |
| `POST` | `/notifications/mark-all-read` | Mark all as read |
| `GET` | `/subscribers/:id/preferences` | Get subscriber preferences |
| `PUT` | `/subscribers/:id/preferences` | Update preferences |
| `POST` | `/topics` | Create a topic |
| `GET` | `/topics` | List topics |
| `GET` | `/topics/:key` | Get a topic |
| `DELETE` | `/topics/:key` | Delete a topic |
| `POST` | `/topics/:key/subscribers` | Add subscribers to topic |
| `DELETE` | `/topics/:key/subscribers` | Remove subscribers from topic |

## Adapters

### Database Adapters

Herald uses a generic database adapter interface (same pattern as better-auth). Bring your own ORM:

| Adapter | Import | Status |
|---------|--------|--------|
| **Prisma** | `@herald/core/prisma` | Available |
| **Drizzle** | `@herald/core/drizzle` | Planned |
| **Kysely** | `@herald/core/kysely` | Planned |
| **MikroORM** | `@herald/core/mikro-orm` | Planned |
| **MongoDB** | `@herald/core/mongo` | Planned |

### Workflow Adapters

Herald delegates workflow execution to your preferred engine:

| Adapter | Import | Status |
|---------|--------|--------|
| **Inngest** | `@herald/core/inngest` | Available |
| **Upstash Workflow** | `@herald/core/upstash` | Planned |
| **Temporal** | `@herald/core/temporal` | Planned |
| **Trigger.dev** | `@herald/core/trigger` | Planned |
| **useWorkflow** | `@herald/core/use-workflow` | Planned |

## Database Schema

Herald creates these tables in your database:

| Table | Purpose |
|-------|---------|
| `subscriber` | Notification recipients with contact info and metadata |
| `notification` | Delivered notifications with delivery/engagement status |
| `topic` | Named groups for fan-out notifications |
| `topicSubscriber` | Many-to-many relationship between topics and subscribers |
| `preference` | Per-subscriber notification preferences |
| `channel` | Configured delivery channels (email providers, etc.) |

## Plugins

Herald supports a plugin system inspired by better-auth. Plugins can:

- **Extend the database schema** — add new tables or fields to existing tables
- **Add REST endpoints** — register new API routes
- **Hook into lifecycle events** — intercept triggers, sends, and more
- **Inject context** — add custom data to the Herald context

```typescript
import { herald } from "@herald/core";
import type { HeraldPlugin } from "@herald/core";

const analyticsPlugin: HeraldPlugin = {
  id: "analytics",
  schema: {
    notificationEvent: {
      fields: {
        id: { type: "string", required: true, unique: true },
        notificationId: { type: "string", required: true },
        event: { type: "string", required: true },
        timestamp: { type: "date", required: true },
      },
    },
  },
  hooks: {
    afterSend: async ({ subscriberId, channel, messageId }) => {
      console.log(`Notification ${messageId} sent to ${subscriberId} via ${channel}`);
    },
  },
};

const notifications = herald({
  // ...config
  plugins: [analyticsPlugin],
});
```

## Tech Stack

- **TypeScript** — full type safety
- **pnpm** — package management
- **Bun** — runtime
- **Vitest** — testing
- **Biome** — linting and formatting

## Contributing

We welcome contributions! See [ROADMAP.md](ROADMAP.md) for planned features and areas where help is needed.

```bash
# Clone and setup
git clone https://github.com/jeromesth/inngest-notifications.git
cd inngest-notifications
pnpm install

# Run tests
pnpm test

# Lint
pnpm lint
```

## License

MIT License - see [LICENSE](LICENSE) for details.
