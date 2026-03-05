# ADR-001: Engine-Delegated Digest

## Status

Accepted

## Context

Herald needs a digest/batch step that aggregates multiple notification triggers into a single notification (e.g., "You have 5 new comments" instead of 5 separate emails). The challenge is that digest requires collecting events over a time window, which fundamentally depends on the workflow engine's capabilities.

Two approaches were considered:

1. **Herald-managed digest** — Herald maintains its own event buffer (in DB or memory), handles timers, and delivers the batched notification. The workflow engine just executes the final step.

2. **Engine-delegated digest** — Herald defines the digest semantics (window duration, grouping key), but delegates the actual event collection and timer management to the workflow engine adapter.

## Decision

We chose **engine-delegated digest**.

Each workflow adapter implements digest using its engine's native primitives:

- **Inngest**: Uses `step.waitForEvent()` in a loop with a timeout matching the digest window. Events are collected until the timeout expires, then the handler runs with all collected events.
- **Memory adapter**: Provides a simple `digestBuffer` Map and `addDigestEvent()` for testing. The digest handler receives pre-buffered events.
- **Future adapters** (Temporal, Trigger.dev): Would use their native signal/event mechanisms similarly.

The `step.digest(config)` call in user code returns `DigestedEvent[]` — the adapter fills this array using whatever mechanism it has.

## Consequences

### Positive

- Each engine uses its strongest primitives (Inngest's waitForEvent is purpose-built for this pattern)
- No additional database tables or background jobs needed in Herald core
- Digest window timing is handled by battle-tested infrastructure (Inngest's scheduler, Temporal's timers)
- Memory adapter stays simple for testing — just push events into a buffer

### Negative

- Adapter authors must understand digest semantics to implement it correctly
- Digest behavior may vary slightly between engines (exact timing, event ordering)
- Testing real digest behavior requires integration tests with the actual engine

### Neutral

- The `DigestConfig` type (`window`, `unit`, `key`) is engine-agnostic — adapters interpret it
- The memory adapter's `addDigestEvent()` is a test helper, not part of the `WorkflowAdapter` interface
