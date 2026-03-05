# Contributing to Herald

Thanks for your interest in contributing to Herald! This guide will get you from zero to a merged PR as quickly as possible.

## Prerequisites

| Tool       | Version  |
|------------|----------|
| Node.js    | >= 20    |
| pnpm       | 10.x     |
| TypeScript | 5.7+     |

## Getting Started

```bash
# 1. Fork and clone
git clone https://github.com/<you>/herald.git && cd herald

# 2. Install dependencies
pnpm install

# 3. Build all packages
pnpm build

# 4. Run tests in watch mode
pnpm test
```

## Development Workflow

```bash
# Create a feature branch
git checkout -b feat/my-feature

# Lint and format (Biome)
pnpm lint          # check for issues
pnpm lint:fix      # auto-fix issues
pnpm format        # format all files

# Type-check
pnpm typecheck

# Run tests once (CI-style)
pnpm test:run
```

All code lives under `packages/core/src/`. Here is a quick orientation:

```
packages/core/src/
├── core/           # Core logic (herald.ts, workflow-runtime.ts, send.ts, subscriber.ts)
├── api/            # REST API (router.ts, routes/)
├── adapters/       # Database & workflow adapters
├── channels/       # Notification channels (provider.ts, in-app.ts, email/)
├── templates/      # Template rendering (engine.ts, layouts.ts)
├── realtime/       # SSE support
├── types/          # TypeScript types & interfaces
└── db/             # Database schema
```

## Adding a Database Adapter

Herald uses a `DatabaseAdapter` interface inspired by better-auth. To add support for a new database (e.g., MySQL):

### 1. Create the adapter file

```
packages/core/src/adapters/database/mysql.ts
```

### 2. Implement the interface

```ts
import type { DatabaseAdapter, Where } from "../../types/adapter.js";

export function mysqlAdapter(connection: MysqlConnection): DatabaseAdapter {
  return {
    async create({ model, data, select }) {
      // INSERT INTO <model> ...
      // Return the created row (or selected fields)
    },
    async findOne({ model, where, select }) {
      // SELECT ... WHERE ... LIMIT 1
      // Return the row or null
    },
    async findMany({ model, where, limit, offset, sortBy, select }) {
      // SELECT ... WHERE ... ORDER BY ... LIMIT/OFFSET
    },
    async count({ model, where }) {
      // SELECT COUNT(*) ...
    },
    async update({ model, where, update }) {
      // UPDATE <model> SET ... WHERE ...
      // Return the updated row
    },
    async updateMany({ model, where, update }) {
      // UPDATE <model> SET ... WHERE ...
      // Return number of affected rows
    },
    async delete({ model, where }) {
      // DELETE FROM <model> WHERE ...
    },
    async deleteMany({ model, where }) {
      // DELETE FROM <model> WHERE ...
      // Return number of deleted rows
    },
  };
}
```

### 3. Export it

Re-export from `packages/core/src/adapters/database/index.ts`.

### 4. Write tests

Add `packages/core/tests/mysql-adapter.test.ts`. Use the existing memory adapter tests as a reference for the operations you need to cover.

## Adding a Channel Provider

Channel providers handle delivery for a specific notification channel. To add a new provider (e.g., Twilio for SMS):

### 1. Create the provider file

```
packages/core/src/channels/sms/twilio.ts
```

### 2. Implement `ChannelProvider`

```ts
import type {
  ChannelProvider,
  ChannelProviderMessage,
  ChannelProviderResult,
} from "../provider.js";

export function twilioProvider(config: {
  accountSid: string;
  authToken: string;
  from: string;
}): ChannelProvider {
  return {
    providerId: "twilio",
    channelType: "sms",

    async send(message: ChannelProviderMessage): Promise<ChannelProviderResult> {
      // Call Twilio API with message.to, message.body, config.from
      // Return { messageId, status: "sent" | "queued" | "failed" }
      return {
        messageId: twilioResponse.sid,
        status: "sent",
      };
    },
  };
}
```

### 3. Register with Herald

Users register providers when creating a Herald instance. Make sure your provider is exported from the package entry point so users can import it.

### 4. Write tests

Mock the external API and verify that `send()` maps Herald's message format to the provider's API correctly.

## Adding a Plugin

Plugins can extend Herald with new schema, endpoints, and lifecycle hooks. For example, a read-receipts plugin:

### 1. Create the plugin file

```
packages/core/src/plugins/read-receipts.ts
```

### 2. Implement `HeraldPlugin`

```ts
import type { HeraldPlugin } from "../types/plugin.js";

export function readReceiptsPlugin(): HeraldPlugin {
  return {
    id: "read-receipts",

    // Extend the database schema
    schema: {
      readReceipt: {
        fields: {
          messageId: { type: "string", required: true },
          subscriberId: { type: "string", required: true },
          readAt: { type: "date", required: true },
        },
      },
    },

    // Add REST endpoints
    endpoints: {
      markRead: {
        method: "POST",
        path: "/messages/:messageId/read",
        async handler(request, ctx) {
          // Mark message as read in DB
          return new Response(JSON.stringify({ success: true }), {
            status: 200,
          });
        },
      },
    },

    // Hook into the lifecycle
    hooks: {
      async afterSend({ subscriberId, channel, messageId, status }) {
        // Track outgoing messages for read-receipt matching
      },
    },
  };
}
```

### 3. Export and document

Re-export the plugin from the package entry point and add a usage example to the plugin's JSDoc.

## Testing Guidelines

Tests live in `packages/core/tests/*.test.ts` and run with Vitest.

```bash
pnpm test          # watch mode — great during development
pnpm test:run      # single run — use before pushing
```

### Conventions

- **Fresh state per test.** Use `memoryAdapter()` to get an isolated in-memory database for each test.
- **Arrange-Act-Assert.** Structure every test clearly.
- **Cover happy path and edge cases.** Think about empty inputs, missing fields, duplicate calls, and error conditions.
- **Use `vi.spyOn()` for behavior verification** rather than reaching into internals.

```ts
import { describe, expect, it, vi } from "vitest";
import { memoryAdapter } from "../src/adapters/database/memory.js";

describe("myFeature", () => {
  it("should do the expected thing", async () => {
    // Arrange
    const db = memoryAdapter();
    await db.create({ model: "subscriber", data: { id: "sub-1", externalId: "ext-1" } });

    // Act
    const result = await db.findOne({
      model: "subscriber",
      where: [{ field: "id", value: "sub-1" }],
    });

    // Assert
    expect(result).toMatchObject({ id: "sub-1", externalId: "ext-1" });
  });
});
```

## Commit Conventions

Follow the `type: description` format:

| Type       | Use when                                   |
|------------|--------------------------------------------|
| `feat`     | Adding a new feature                       |
| `fix`      | Fixing a bug                               |
| `test`     | Adding or updating tests                   |
| `refactor` | Restructuring code without behavior change |
| `docs`     | Documentation only                         |
| `chore`    | Build, CI, or dependency updates           |

Examples:

```
feat: add Twilio SMS channel provider
fix: prevent duplicate digest events for same subscriber
test: add edge-case coverage for workflow cancellation
```

## Coding Standards

See [CODING_STANDARDS.md](./CODING_STANDARDS.md) for detailed rules on naming, error handling, and code organization.

## PR Checklist

Before opening your pull request, confirm:

- [ ] `pnpm build` passes
- [ ] `pnpm test:run` passes with no failures
- [ ] `pnpm lint` reports no issues
- [ ] `pnpm typecheck` reports no errors
- [ ] New code has tests covering happy path and edge cases
- [ ] Commit messages follow `type: description` format
- [ ] Public APIs have JSDoc comments
- [ ] No `console.log` left in production code

## Questions?

Open a GitHub issue or start a discussion. We are happy to help you land your first contribution.
