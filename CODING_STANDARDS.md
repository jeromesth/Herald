# Herald Coding Standards

> **Living document** — update this file when code reviews surface new patterns or correct existing ones.

## Error Handling

- **Never silently swallow errors.** Every `catch` block must either re-throw, log with context, or return a meaningful error. Empty catch blocks are not acceptable.
- **Hide internal errors from API responses.** 500 responses return `"Internal server error"` — log the real error server-side with `console.error`.
- **Use `HTTPError` for API errors** with the correct status code (400, 404, 409, 500). Throw it from route handlers; the router catches and formats it.
- **Let errors propagate.** Don't wrap in try/catch unless you're adding context or performing cleanup. Unnecessary catch-and-rethrow obscures stack traces.
- **Use `Promise.allSettled` for bulk operations** to isolate per-item failures instead of failing the entire batch.
- **Use try/finally for resource cleanup.** Map entries, connections, and temporary state must be cleaned up even when errors occur.

```typescript
// Good — cleanup in finally
ctx.transactionWorkflowMap.set(transactionId, workflowId);
try {
  await workflow.trigger(args);
} finally {
  ctx.transactionWorkflowMap.delete(transactionId);
}

// Bad — silent swallow
try { sse.emit(subscriberId, event); } catch {}

// Good — log with context
try {
  sse.emit(subscriberId, event);
} catch (error) {
  console.error(`[herald] SSE emit failed for subscriber "${subscriberId}":`, error);
}
```

## API Design

- **Return proper HTTP status codes.** 201 for created, 400 for validation errors, 404 for not found, 500 for server errors.
- **True PATCH semantics.** Only update fields present in the request body. Omitted fields must not overwrite existing values.
- **Validate input immediately** at the route handler level, before any business logic.
- **Return full records after mutations** so clients can confirm the result without a follow-up GET.
- **Use `jsonResponse()` helper** consistently for all JSON responses.

```typescript
// Good — only update what's provided
const updateFields: Record<string, unknown> = {};
if ("email" in body) updateFields.email = body.email;
if ("firstName" in body) updateFields.firstName = body.firstName;

// Bad — spreads undefined values over existing record
const { externalId, ...rest } = body;
await db.update({ model: "subscriber", update: rest });
```

## Type Safety

- **Use narrow union types over `string`.** Use `ChannelType` instead of `string` for channel fields. Use `DeliveryStatus` instead of `string` for status fields.
- **Mark type imports explicitly** with the `type` keyword: `import type { Foo } from "./bar.js"`.
- **Use Zod for runtime validation** at system boundaries (API input, external data). Internal code trusts TypeScript's compile-time checks.
- **Use discriminated unions** for types with distinct states (`DeliveryStatus`, `StepType`).
- **Use type guards** (`is` keyword) for runtime type narrowing.
- **Narrow plugin/extension types.** Use `Record<string, unknown>` instead of `Partial<HeraldContext>` for plugin-injected context.

```typescript
// Good — narrow type
function resolveRecipient(channel: ChannelType, subscriber: SubscriberRecord): string | null

// Bad — stringly typed
function resolveRecipient(channel: string, subscriber: SubscriberRecord): string | null

// Good — type guard
function isChannelStep(stepType: string): stepType is ChannelType {
  return stepType === "in_app" || stepType === "email" || ...;
}
```

## Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Files | `kebab-case.ts` | `workflow-runtime.ts` |
| Types / Interfaces | `PascalCase` | `SubscriberRecord`, `HeraldContext` |
| Functions | `verbNoun()` | `resolveSubscriberByAnyId()` |
| Variables | `camelCase` | `transactionId`, `templateEngine` |
| Booleans | `is*` / `has*` / `*Enabled` | `isChannelStep`, `inAppEnabled` |
| Constants | `camelCase` | `coreSchema` (not `CORE_SCHEMA`) |
| Type suffixes | `*Record`, `*Config`, `*Context`, `*Result` | `NotificationRecord`, `ResendConfig` |

## Architecture Patterns

- **Adapter pattern** for external integrations. Database, workflow engine, and channel providers all implement a standard interface.
- **Factory functions over classes** for public API. `herald()`, `resendProvider()`, `memoryAdapter()` — not `new Herald()`.
- **Context object for DI.** Pass `HeraldContext` to functions that need shared dependencies. Don't scatter individual params.
- **Provider registry** for channel management. `ChannelRegistry` manages provider lookup by channel type.
- **Plugin hooks** for lifecycle extensibility. `beforeTrigger`, `afterTrigger`, `beforeSend`, `afterSend`.
- **Wrap, don't modify.** Use `wrapWorkflow()` / `wrapStep()` to add behavior to user-defined workflows without mutating them.

## Resource Management

- **Clean up Map/Set entries after use.** `transactionWorkflowMap` entries must be deleted after trigger completes — not only on cancellation.
- **Don't inject internal metadata into user data.** Never add `_herald` or internal fields to user-provided payloads. Keep internal state separate.
- **Use try/finally for cleanup** in async flows, especially for Map entries and temporary state.

## Testing

- **Fresh instances per test** via `beforeEach`. Always create a new `memoryAdapter()` or similar for each test.
- **Arrange-Act-Assert** pattern. Clearly separate setup, execution, and verification.
- **Test both happy path and edge cases.** Every feature needs at least one positive and one negative test.
- **Use `vi.spyOn()`** for behavior verification when you need to confirm a side effect occurred.
- **Export internal functions for testing** when direct unit testing is valuable (e.g., `conditionsPass`).
- **Test file naming:** `*.test.ts` in `packages/core/tests/`.

```typescript
describe("resolveSubscriberByAnyId", () => {
  let db: ReturnType<typeof memoryAdapter>;

  beforeEach(() => {
    db = memoryAdapter(); // Fresh per test
  });

  it("finds subscriber by externalId first", async () => {
    // Arrange
    await db.create({ model: "subscriber", data: { id: "int-1", externalId: "ext-1", ... } });
    // Act
    const result = await resolveSubscriberByAnyId(db, "ext-1");
    // Assert
    expect(result?.externalId).toBe("ext-1");
  });
});
```

## Formatting (Enforced by Biome)

These are enforced automatically — don't override them:

- **Indentation:** tabs
- **Line width:** 100 characters
- **Quotes:** double quotes
- **Semicolons:** always
- **Imports:** organized, explicit `type` imports
- **Relative imports:** use `.js` extension (ESM compatibility)

Run `pnpm lint:fix` and `pnpm format` before committing.

## Logging

- **Prefix all log messages** with `[herald]` for easy filtering.
- **Use `console.warn`** for non-fatal issues (subscriber not found, skipping delivery).
- **Use `console.error`** for failures that affect delivery or data integrity.
- **Include identifiers in log messages** (subscriber ID, workflow ID, step ID) for debugging.

```typescript
// Good — actionable, identifiable
console.warn(
  `[herald] Workflow "${workflowId}" step "${stepId}": subscriber "${externalId}" not found, skipping delivery`
);

// Bad — no context
console.warn("subscriber not found");
```

---

*Last updated from code-review-refactor PR — March 2026*
