# Herald — Agent Instructions

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
│   │   │   └── workflow/        # inngest.ts, postgres.ts, memory.ts
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
- **Biome** for linting and formatting (tabs, double quotes, 140-char lines)
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

## Development Methodology

- **BDD + TDD is mandatory** — write tests first, implement to make them pass
- **Contract test suites** exist for DatabaseAdapter and WorkflowAdapter — new implementations must wire into them
- Contract suites live in `packages/core/tests/contracts/`

## Testing

- Tests live in `packages/core/tests/*.test.ts`
- Use `memoryAdapter()` for database in tests — creates fresh instances per test
- Always test both happy path and edge cases
- Run `pnpm test:run` before committing

## Formatting Rules

- **Always run `pnpm lint:fix` before committing.** This is non-negotiable. Biome handles all formatting decisions (line wrapping, indentation, import ordering). Do not manually format code — let the tool decide.
- **Line width is 140 characters.** Lines under 140 chars stay on one line. Lines over 140 chars get wrapped by Biome. Do not manually wrap shorter lines or force-unwrap longer ones.
- **Do not fight the formatter.** If Biome wraps something, leave it wrapped. If Biome keeps it on one line, leave it on one line. Consistency comes from the tool, not from human judgment.
- **Adapter interface naming:** Use plain names (`PgPool`, `PgClient`) not `*Like` suffixes (`InngestClientLike` is legacy and should be renamed in a future refactor).

## Branching Strategy

- **`main`** is the stable branch. All code on `main` should be release-ready.
- Create feature branches from `main` using the naming convention: `type/short-description`
  - Examples: `feat/sms-provider`, `fix/digest-race-condition`, `docs/update-readme`
  - Types match [commit conventions](#commit-conventions): `feat`, `fix`, `refactor`, `test`, `docs`, `chore`
- Open a pull request to merge back into `main`.
- Delete the feature branch after merging.

## PR Workflow

1. Branch from `main` with a descriptive name
2. Write/update tests for all changes
3. Run `pnpm lint:fix && pnpm test:run && pnpm typecheck`
4. Follow commit conventions
5. Open a PR against `main`
6. Reference [CODING_STANDARDS.md](CODING_STANDARDS.md) during review

## Release Process

1. **Update CHANGELOG.md** — add a new section at the top with the new version number, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.
2. **Bump version** in `packages/core/package.json`.
3. **Commit**: `chore: release vX.Y.Z`
4. **Merge** the PR to `main`.
5. **Tag** the release from `main`:
   ```bash
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin main --tags
   ```
6. **Create GitHub release** from the tag with a summary or link to the changelog.
7. **Publish to npm** (when ready):
   ```bash
   cd packages/core && pnpm publish --access public
   ```
