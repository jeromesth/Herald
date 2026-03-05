# Herald — AI Agent Instructions

Herald is an open-source, headless notification system for TypeScript. One config, bring your own database, bring your own workflow engine.

## Commands

```bash
pnpm build          # Build all packages (tsup)
pnpm test           # Run tests in watch mode (vitest)
pnpm test:run       # Run tests once
pnpm lint           # Check with Biome
pnpm lint:fix       # Auto-fix lint issues
pnpm format         # Format with Biome
pnpm typecheck      # TypeScript type checking
```

## Project Structure

```
herald/                          # pnpm monorepo
├── packages/core/               # @herald/core — the main library
│   ├── src/
│   │   ├── index.ts             # Public exports
│   │   ├── core/                # Core logic
│   │   │   ├── herald.ts        # herald() factory — main entry point
│   │   │   ├── workflow-runtime.ts  # Step execution, wrapWorkflow/wrapStep
│   │   │   ├── send.ts          # sendThroughProvider — channel delivery
│   │   │   ├── subscriber.ts    # Subscriber resolution helpers
│   │   │   ├── plugins.ts       # Plugin initialization
│   │   │   ├── providers.ts     # Email provider factory
│   │   │   └── preferences.ts   # Default preference logic
│   │   ├── api/                 # REST API
│   │   │   ├── router.ts        # HTTP router, HTTPError, jsonResponse
│   │   │   └── routes/          # Route handlers by domain
│   │   ├── adapters/            # Database & workflow adapters
│   │   │   ├── database/        # prisma.ts, memory.ts
│   │   │   └── workflow/        # inngest.ts, memory.ts
│   │   ├── channels/            # Notification channels
│   │   │   ├── provider.ts      # ChannelRegistry
│   │   │   ├── in-app.ts        # In-app provider
│   │   │   └── email/           # Email providers (resend, sendgrid, etc.)
│   │   ├── templates/           # Template rendering
│   │   │   ├── engine.ts        # HandlebarsEngine
│   │   │   ├── layouts.ts       # Email layout system
│   │   │   └── types.ts         # TemplateEngine interface
│   │   ├── realtime/            # SSE for live notifications
│   │   ├── types/               # TypeScript type definitions
│   │   └── db/                  # Database schema definitions
│   └── tests/                   # Test files (*.test.ts)
├── biome.json                   # Linter/formatter config
├── tsconfig.json                # TypeScript strict config
└── vitest.config.ts             # Test configuration
```

## Tech Stack

- **TypeScript** (strict mode, ES2022, ESNext modules)
- **pnpm** 10.x monorepo with workspaces
- **Biome** for linting and formatting (tabs, double quotes, 100-char lines)
- **Vitest** for testing
- **tsup** for building (ESM only, .d.mts declarations)
- **Zod** for runtime schema validation

## Coding Standards

See [CODING_STANDARDS.md](CODING_STANDARDS.md) for the full reference. The top rules:

1. **Never silently swallow errors.** Every catch block must throw, log with context, or return a meaningful error.
2. **Use narrow types.** `ChannelType` not `string`. `DeliveryStatus` not `string`. Mark imports with `type` keyword.
3. **True PATCH semantics.** Only update fields present in the request body.
4. **Clean up resources.** Map entries in try/finally. Don't inject internal metadata into user data.
5. **Hide internal errors from responses.** 500s return generic message, log the real error server-side.

## Architecture Principles

- **Adapter pattern** — DatabaseAdapter, WorkflowAdapter, ChannelProvider are all interfaces. Users bring their own implementations.
- **Factory functions** — `herald()`, `resendProvider()`, `memoryAdapter()`. No `new` keyword for public API.
- **Context-based DI** — `HeraldContext` holds all shared dependencies. Pass it to functions, don't scatter params.
- **Plugin system** — Lifecycle hooks (`beforeTrigger`, `afterSend`, etc.), schema extension, custom endpoints.
- **Wrap, don't mutate** — `wrapWorkflow()` / `wrapStep()` add behavior without modifying user-defined workflows.

## Key Types

| Type | File | Purpose |
|------|------|---------|
| `HeraldOptions` | `types/config.ts` | Main configuration interface |
| `HeraldContext` | `types/config.ts` | Internal dependency container |
| `HeraldAPI` | `types/config.ts` | Programmatic server-side API |
| `ChannelType` | `types/workflow.ts` | `"in_app" \| "email" \| "sms" \| "push" \| "chat" \| "webhook"` |
| `NotificationWorkflow` | `types/workflow.ts` | Workflow definition with steps |
| `DatabaseAdapter` | `types/adapter.ts` | Database interface (findOne, findMany, create, update, delete) |
| `WorkflowAdapter` | `types/workflow.ts` | Workflow engine interface |
| `ChannelProvider` | `channels/provider.ts` | Channel delivery interface |
| `HeraldPlugin` | `types/plugin.ts` | Plugin interface with hooks and schema |

## Commit Conventions

Format: `type: description`

| Type | Use For |
|------|---------|
| `feat` | New feature or capability |
| `fix` | Bug fix |
| `test` | Adding or updating tests |
| `refactor` | Code restructuring without behavior change |
| `docs` | Documentation changes |
| `chore` | Build, deps, tooling changes |

Write concise descriptions focused on **what changed and why**, not implementation details.

## Testing

- Tests live in `packages/core/tests/*.test.ts`
- Use `memoryAdapter()` for database in tests — creates fresh instances per test
- Always test both happy path and edge cases
- Run `pnpm test:run` before committing

## PR Workflow

1. Branch from `main` with a descriptive name
2. Write/update tests for all changes
3. Run `pnpm lint:fix && pnpm test:run && pnpm typecheck`
4. Follow commit conventions
5. Reference [CODING_STANDARDS.md](CODING_STANDARDS.md) during review
