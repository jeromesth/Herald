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

## Authoring tip

If you only need observability — e.g. you're shipping events to OpenTelemetry, Datadog, or a custom audit log — start with `onEvent`. The full event payload (`ActivityEventInput`) carries `transactionId`, `workflowId`, `subscriberId`, `channel`, `stepId`, and arbitrary `detail`, which is enough for most tracing pipelines.

The first-party `observabilityPlugin()` is a reference implementation: it consumes `onEvent` to write to the activity log table and deliver webhooks.
