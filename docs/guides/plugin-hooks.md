# Plugin Hook Matrix

Herald plugins observe and intercept the notification lifecycle through a small set of hooks. This guide maps every lifecycle point in core to the hooks available there.

## Hook surface

```ts
interface HeraldPlugin {
  hooks?: {
    // Trigger lifecycle
    beforeTrigger?(args): Promise<void>;
    afterTrigger?(args): Promise<void>;

    // Send lifecycle
    beforeSend?(args): Promise<Record<string, unknown> | undefined>;
    afterSend?(args): Promise<void>;
    onSendFailure?(args): Promise<void>;

    // Step lifecycle
    onStepStart?(args): Promise<void>;
    onStepComplete?(args): Promise<void>;

    // Preference gate
    beforePreferenceCheck?(args): Promise<{ override?: boolean } | undefined>;
    afterPreferenceCheck?(args): Promise<void>;

    // Catch-all event bus — fires for every ActivityEventType
    onEvent?(event: ActivityEventInput): Promise<void>;
  };
}
```

## Lifecycle → hooks mapping

| Lifecycle point                       | `onEvent` event              | Granular hooks                                             |
| ------------------------------------- | ---------------------------- | ---------------------------------------------------------- |
| `api.trigger()` called                | `workflow.triggered`         | `beforeTrigger` (before), `afterTrigger` (after dispatch)  |
| Workflow handed off to engine         | `workflow.dispatched`        | `afterTrigger`                                             |
| Step begins (channel or non-channel)  | `workflow.step.started`      | `onStepStart`                                              |
| Step ends (success path)              | `workflow.step.completed`    | `onStepComplete`                                           |
| Preference gate runs                  | —                            | `beforePreferenceCheck`, `afterPreferenceCheck`            |
| Notification enters provider pipeline | `notification.queued`        | `beforeSend` (before), —                                   |
| Provider succeeds                     | `notification.sent`          | `afterSend`                                                |
| Provider fails                        | `notification.failed`        | `onSendFailure`, `afterSend`                               |
| Subscriber preference blocks delivery | `notification.blocked`       | —                                                          |
| Status update via API                 | `notification.status_changed`| —                                                          |
| External delivery confirmation        | `notification.delivered`     | —                                                          |
| External bounce notification          | `notification.bounced`       | —                                                          |

## When to use which hook

- **`onEvent`** — analytics, audit logs, custom observability sinks. One signature, all 11 events. Fan out by `event.event`.
- **`onStepStart` / `onStepComplete`** — instrument step durations, write distributed traces, attach span context. Granular without subscribing to the full bus.
- **`onSendFailure`** — pager alerts, dead-letter queues, retry orchestration.
- **`beforeSend`** — patch outbound content (e.g. inject branding, redact PII). Returns a partial patch.
- **`afterSend`** — record provider receipts, update CRM systems.
- **`beforePreferenceCheck` / `afterPreferenceCheck`** — implement custom preference rules or audit gate decisions.
- **`beforeTrigger` / `afterTrigger`** — validate trigger inputs, attach correlation IDs, mirror triggers to a queue.

## Error semantics

All hooks run in a try/catch; thrown errors are logged with the plugin id and swallowed. Hooks must not be relied on for control flow that depends on success — Herald never fails delivery because a plugin hook threw.

`onEvent`, `onStepStart`, `onStepComplete`, and `onSendFailure` run on the critical delivery path and use `Promise.allSettled` (or sequential try/catch) to guarantee non-propagation.

## Hook context (`ctx`)

The new hooks introduced in v0.6.5 — `onEvent`, `onStepStart`, `onStepComplete`, `onSendFailure` — receive `HeraldContext` as their second argument. Use it to read configuration, write to the database, or look up adapters without juggling closures:

```ts
plugins: [{
  id: "telemetry",
  hooks: {
    onEvent: async (event, ctx) => {
      await ctx.db.create({ model: "audit", data: { ...event, at: new Date() } });
    },
  },
}],
```

The pre-v0.6 hooks (`beforeTrigger`, `afterTrigger`, `beforeSend`, `afterSend`, `beforePreferenceCheck`, `afterPreferenceCheck`) keep their narrow argument-only signatures for back-compat. If you need `ctx` from one of those, capture it via `init`:

```ts
let ctxRef: HeraldContext | undefined;
const plugin: HeraldPlugin = {
  id: "legacy",
  init: async (ctx) => { ctxRef = ctx; return undefined; },
  hooks: {
    afterSend: async (args) => { /* use ctxRef */ },
  },
};
```

## Semantics caveats

A few non-obvious behaviors that plugin authors should know:

### `step.completed` does not fire on every code path

`onStepComplete` and the `workflow.step.completed` event fire only when a step's handler runs through to the success path. They do **not** fire when:

- The preference gate blocks delivery (a `notification.blocked` event is emitted instead — the step terminates without "completing")
- The subscriber has no recipient for the channel (e.g. an email step for a subscriber with no `email` field)
- The subscriber lookup fails

Plugins instrumenting step durations should treat unmatched `step.started` events as legitimate (the step ended, just not via the success path) — not as bugs to alert on. Pair `onStepStart` with `notification.blocked` / `notification.failed` via `onEvent` to close out spans.

### `onEvent` and granular hooks both fire for the same logical point

A plugin that registers both `onEvent` and `onStepStart` will see the start of a step *twice* — once via `onEvent({ event: "workflow.step.started", ... })` and once via `onStepStart`. Same for `onStepComplete` and `onSendFailure` (which pairs with `onEvent({ event: "notification.failed" })`).

In practice: pick one. Use `onEvent` if you want a single subscription to the full bus; use the granular hooks if you only care about a specific lifecycle point and prefer a domain-specific argument shape.

### Ordering between `emitEvent` and granular hooks is not guaranteed

`emitEvent` is fire-and-forget at every call site, while granular hooks (`onStepStart`, `onStepComplete`, `onSendFailure`) are awaited inline. For the same logical event, the corresponding `onEvent` callback may run **before**, **after**, or **interleaved with** the granular hook. Don't rely on one observing state written by the other within the same lifecycle point.

If you need strict ordering, use only one of `onEvent` or the granular hook for that point.

## Authoring tip

If you only need observability — e.g. you're shipping events to OpenTelemetry, Datadog, or a custom audit log — start with `onEvent`. The full event payload (`ActivityEventInput`) carries `transactionId`, `workflowId`, `subscriberId`, `channel`, `stepId`, and arbitrary `detail`, which is enough for most tracing pipelines.

The first-party `observabilityPlugin()` is a reference implementation: it consumes `onEvent` to write to the activity log table and deliver webhooks.
