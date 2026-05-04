# v0.7 Multi-Channel Expansion — Design Spec

**Status:** Draft
**Date:** 2026-05-04
**Targets:** v0.7
**Scope:** Foundational channel abstractions used by every channel type, plus concrete SMS (Twilio) and webhook channel implementations. Migrates Resend + SendGrid to the new factory. Postmark + SES remain on the legacy provider interface as the documented escape hatch. Push and chat are out of scope.

---

## Goals

1. Replace the email-special-cased channel layer with a uniform, type-safe channel pipeline that scales to SMS, webhook, push, and chat without further restructuring.
2. Establish three load-bearing primitives: typed `ChannelMessage<TContent>` envelope, `httpChannelProvider` factory, and `ChannelDefinition` render strategy registry.
3. Add a `SubscriberChannel` table for per-provider credentials (URLs, secrets, future tokens) following the Novu/Knock hybrid model.
4. Ship Twilio SMS, webhook channel (with built-in HMAC signing), and `emailStep`/`smsStep`/`webhookStep` typed authoring helpers.
5. Decouple `channels.*` (declarative channel settings) from `providers: [...]` (imperative provider registrations).

## Non-Goals

- Push notifications (FCM, APNs, Expo). Reserved for v0.8.
- Chat delivery (Slack, Discord, Microsoft Teams). Reserved for v0.8 / plugin track.
- Channel groups / fallback routing.
- MMS, multiple-providers-per-channel, multi-region routing.
- External secrets resolver (e.g., AWS Secrets Manager). Captured as v1 future work — see "Future Work" below.
- Backwards compatibility with v0.6 channel/provider config. v0.7 is a deliberate breaking change; a migration guide ships with the release.

---

## Architectural Decisions

The design is the synthesis of ten brainstorming decisions. Each is recorded here for traceability.

| # | Decision |
|---|----------|
| 1 | **Approach A — Extract & generalize.** Refactor the channel layer first, then build SMS and webhook on top of clean abstractions. |
| 2 | **Typed envelope + content (Q+C hybrid).** Strong standard `ChannelMessage<TContent>` envelope; per-channel content shapes are typed and discriminated. |
| 3 | **Webhook channel = per-subscriber HTTP delivery.** Distinct from system-events `webhooks` config. Hybrid envelope (Herald-supplied default, workflow can override body entirely). HMAC signing built in. |
| 4 | **Hybrid subscriber data model.** `subscriber.email` and `subscriber.phone` stay on the Subscriber table. New `SubscriberChannel` table holds per-provider credentials for webhook (and future push/chat). Mirrors Novu/Knock. |
| 5 | **SMS scope: Twilio only.** Vonage and MessageBird pushed to a later patch release. |
| 6 | **HTTP provider factory (B), narrow scope.** `httpChannelProvider({ ... })` factory with ~10 lines of config per concrete provider. Migrates Resend + SendGrid only. Postmark + SES remain on the legacy `ChannelProvider` interface. |
| 7 | **Channel-specific render strategies.** Each channel registers a `ChannelDefinition` whose `render` method handles its content shape. Removes the email special-case from `sendThroughProvider`. |
| 8 | **Recipient resolution: pre-fetch on subscriber resolve, sync `resolveRecipients`, multi-recipient at provider level.** `string[]` end-to-end. Provider returns one delivery per recipient. |
| 9 | **Step authoring helpers as sugar over the generic primitive.** `emailStep`, `smsStep`, `webhookStep`, `inAppStep` typed helpers. Generic `{ stepId, type, handler }` form remains the canonical primitive. |
| 10 | **Channels and providers are decoupled.** `channels.*` is declarative (enabled, defaults, secrets); `providers: [...]` is imperative registration. Either can exist without the other. No backwards compatibility with v0.6 config. |

---

## Architecture

The channel layer rests on three primitives.

### `ChannelMessage<TContent>` — typed envelope

The framework's universal currency. `sendThroughProvider`, plugin hooks, event emission, and the workflow runtime all operate on `ChannelMessage<unknown>`; concrete providers and renderers narrow on `TContent`.

```ts
// packages/core/src/channels/message.ts (new)

export interface ChannelMessage<TContent = unknown> {
  channel: ChannelType;
  subscriberId: string;
  recipients: string[];                   // always array, even length 1
  content: TContent;                      // channel-specific
  metadata: ChannelMessageMetadata;
}

export interface ChannelMessageMetadata {
  workflowId?: string;
  transactionId?: string;
  stepId?: string;
  extra?: Record<string, unknown>;        // plugin/user extension space
}

export interface ChannelProviderResult {
  deliveries: ChannelDelivery[];          // one per recipient
}

export interface ChannelDelivery {
  recipient: string;
  messageId: string;
  status: "sent" | "queued" | "failed";
  error?: string;
}
```

### `ChannelProvider<TContent>` — typed delivery

```ts
// packages/core/src/channels/provider.ts (rewritten)

export interface ChannelProvider<TContent = unknown> {
  readonly providerId: string;
  readonly channelType: ChannelType;
  send(message: ChannelMessage<TContent>): Promise<ChannelProviderResult>;
}
```

`ChannelRegistry` is unchanged in shape but now stores `ChannelProvider<unknown>` (variance widened by intent — any concrete provider is assignable in).

### `ChannelDefinition<TContent>` — render strategy registry

Replaces the `if (channel === "email")` special-case in `sendThroughProvider`. Each channel ships a definition that owns its render strategy.

```ts
// packages/core/src/channels/definition.ts (new)

export interface ChannelDefinition<TContent = unknown> {
  channelType: ChannelType;
  render: (content: TContent, ctx: TemplateContext, tools: ChannelRenderTools) => TContent;
  validate?: (content: TContent) => void;        // runs at workflow registration
}

export interface ChannelRenderTools {
  templateEngine: TemplateEngine;
  layouts: LayoutRegistry;
  channelConfig: ChannelsConfig;
}

export class ChannelDefinitionRegistry {
  register(def: ChannelDefinition): void;
  get(channelType: ChannelType): ChannelDefinition | undefined;
}
```

Built-ins live in `packages/core/src/channels/definitions/`:

- `email.ts` — applies layout, renders subject/html/text, falls back to `channels.email.defaultFrom`
- `sms.ts` — renders body via templateEngine, applies `channels.sms.defaultFrom`, warns when body > 1600 chars (Twilio segment limit)
- `webhook.ts` — templates header values, recursively templates string leaves in `body` via `deepTemplateStrings`
- `in-app.ts` — templates subject/body/actionUrl

`deepTemplateStrings(value, ctx, engine)` walks objects/arrays and renders any string leaf; non-string values pass through unchanged. Enables `body: { event: "user.signup", userId: "{{subscriber.id}}" }` to be templated transparently.

### Channel-agnostic `sendThroughProvider`

```ts
async function sendThroughProvider(ctx: HeraldContext, message: ChannelMessage<unknown>) {
  const definition = ctx.channelDefinitions.get(message.channel);
  if (!definition) throw new HeraldConfigError(`No channel definition for "${message.channel}"`);
  const provider = ctx.channels.get(message.channel);
  if (!provider) throw new HeraldProviderError(`No provider registered for channel "${message.channel}"`);

  await runBeforeSendHooks(ctx, message);

  const renderedContent = definition.render(message.content, buildTemplateContext(ctx, message), {
    templateEngine: ctx.templateEngine,
    layouts: ctx.layouts,
    channelConfig: ctx.options.channels ?? {},
  });
  const renderedMessage = { ...message, content: renderedContent };

  await emitEvent(ctx, { event: "notification.queued", subscriberId: message.subscriberId, channel: message.channel, ... });

  const result = await provider.send(renderedMessage);

  for (const delivery of result.deliveries) {
    await emitEvent(ctx, {
      event: delivery.status === "failed" ? "notification.failed" : "notification.sent",
      subscriberId: message.subscriberId,
      channel: message.channel,
      detail: { messageId: delivery.messageId, recipient: delivery.recipient, error: delivery.error },
      ...
    });
    if (delivery.status === "failed") await runOnSendFailureHooks(ctx, message, delivery);
  }

  await runAfterSendHooks(ctx, message, result);
  return result;
}
```

No special-cases. Adding a new channel type is: register a `ChannelDefinition` + register a `ChannelProvider`.

---

## Channel Content Shapes

Per-channel `TContent` types in `packages/core/src/channels/content.ts` (new):

```ts
export interface EmailContent {
  subject: string;
  html: string;
  text?: string;
  from?: string;                          // overrides channels.email.defaultFrom
  layoutId?: string;
  actionUrl?: string;
}

export interface SmsContent {
  body: string;
  from?: string;
  mediaUrl?: string;                      // future MMS; ignored by basic Twilio SMS
}

export interface WebhookContent {
  url?: string;                           // default: SubscriberChannel.address
  method?: "POST" | "PUT" | "PATCH";      // default POST
  headers?: Record<string, string>;
  body?: unknown;                         // default: convention envelope; if set, replaces it
  signingSecret?: string;                 // default: SubscriberChannel.credentials.secret, then channels.webhook.signingSecretFallback
}

export interface InAppContent {
  subject?: string;
  body: string;
  actionUrl?: string;
  avatar?: string;
  data?: Record<string, unknown>;
}
```

---

## HTTP Provider Factory

Concentrates the repeated scaffolding (fetch, auth, JSON encode, response parse, error map, structured logging, fan-out) into one place.

```ts
// packages/core/src/channels/http-provider.ts (new)

export interface HttpChannelProviderConfig<TContent> {
  providerId: string;
  channelType: ChannelType;
  endpoint: string | ((message: ChannelMessage<TContent>, recipient: string) => string);
  method?: HttpMethodOrFn<TContent>;               // default POST. Function form lets webhook channel honor content.method.
  auth: HttpAuthConfig;
  buildPayload: (message: ChannelMessage<TContent>, recipient: string) => unknown;
  buildHeaders?: (message: ChannelMessage<TContent>, recipient: string, ctx: BuildHeadersContext) => Record<string, string>;
  parseSuccess: (response: Response, body: unknown) => Promise<{ messageId: string; status: "sent" | "queued" }>;
  parseError?: (response: Response, body: string) => string;     // default: `HTTP <status>`
  fanOut?: "per-recipient" | "single-call";                       // default per-recipient
}

export type HttpMethodOrFn<TContent> =
  | "POST" | "PUT" | "PATCH"
  | ((message: ChannelMessage<TContent>, recipient: string) => "POST" | "PUT" | "PATCH");

/**
 * Passed to buildHeaders so signing logic can hash the *exact* bytes the factory will send.
 * Computing payload JSON twice independently is a footgun (re-stringification can differ
 * across implementations); the factory does it once and shares.
 */
export interface BuildHeadersContext {
  payloadJson: string;
}

export type HttpAuthConfig =
  | { type: "bearer"; token: string }
  | { type: "basic"; username: string; password: string }
  | { type: "header"; name: string; value: string }
  | { type: "custom"; apply: (init: RequestInit) => RequestInit };

export function httpChannelProvider<TContent>(
  config: HttpChannelProviderConfig<TContent>,
): ChannelProvider<TContent>;
```

The factory iterates over `message.recipients` (when `fanOut: "per-recipient"`), constructs the request, applies auth, fires `fetch`, parses response, and returns a `ChannelProviderResult` whose `deliveries` array has one entry per recipient. On any non-2xx response or thrown error, the affected recipient gets `{ status: "failed", error }` and the loop continues — partial failures are first-class.

`fanOut: "single-call"` is reserved for future batching providers (e.g., FCM accepts up to 500 device tokens per call). The v0.7 factory accepts the option for forward compatibility but every shipped provider uses `per-recipient` mode. The `parseSuccess` contract for single-call mode (returning per-recipient deliveries from one response) will be designed when the first batching provider lands — not in scope for v0.7.

### Migrated providers (this release)

```ts
// packages/core/src/channels/email/resend.ts (rewritten)
export function resendProvider(config: ResendConfig): ChannelProvider<EmailContent> {
  return httpChannelProvider<EmailContent>({
    providerId: "resend",
    channelType: "email",
    endpoint: config.apiUrl ?? "https://api.resend.com/emails",
    auth: { type: "bearer", token: config.apiKey },
    buildPayload: (msg, to) => ({
      from: msg.content.from ?? config.from,
      to: [to],
      subject: msg.content.subject,
      html: msg.content.html,
      text: msg.content.text,
    }),
    parseSuccess: async (_, body) => ({ messageId: (body as { id: string }).id, status: "sent" }),
  });
}

// packages/core/src/channels/email/sendgrid.ts (rewritten)
export function sendgridProvider(config: SendGridConfig): ChannelProvider<EmailContent> {
  return httpChannelProvider<EmailContent>({
    providerId: "sendgrid",
    channelType: "email",
    endpoint: config.apiUrl ?? "https://api.sendgrid.com/v3/mail/send",
    auth: { type: "bearer", token: config.apiKey },
    buildPayload: (msg, to) => ({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: msg.content.from ?? config.from },
      subject: msg.content.subject,
      content: [{ type: "text/html", value: msg.content.html }],
    }),
    parseSuccess: async (response) => ({
      messageId: response.headers.get("X-Message-Id") ?? crypto.randomUUID(),
      status: "sent",
    }),
  });
}

// packages/core/src/channels/sms/twilio.ts (new)
export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  from: string;
  apiUrl?: string;
}

export function twilioProvider(config: TwilioConfig): ChannelProvider<SmsContent> {
  return httpChannelProvider<SmsContent>({
    providerId: "twilio",
    channelType: "sms",
    endpoint: config.apiUrl ?? `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`,
    auth: { type: "basic", username: config.accountSid, password: config.authToken },
    buildPayload: (msg, to) => formUrlEncode({
      From: msg.content.from ?? config.from,
      To: to,
      Body: msg.content.body,
      ...(msg.content.mediaUrl ? { MediaUrl: msg.content.mediaUrl } : {}),
    }),
    buildHeaders: () => ({ "Content-Type": "application/x-www-form-urlencoded" }),
    parseSuccess: async (_, body) => {
      const parsed = body as { sid: string; status: string };
      return { messageId: parsed.sid, status: parsed.status === "queued" ? "queued" : "sent" };
    },
  });
}
```

`formUrlEncode` is a small helper exported from `packages/core/src/channels/http-provider.ts` for providers that need application/x-www-form-urlencoded bodies.

### Legacy providers (unchanged)

Postmark and SES keep their existing implementations against the legacy flat `ChannelProvider` interface. To bridge them into the new pipeline, `sendThroughProvider` detects providers exposing the legacy shape and adapts: the rendered `ChannelMessage<EmailContent>` is mapped down to the flat `{ to, subject, body, ... }` shape, the legacy `send` is invoked once per recipient, and the result is re-wrapped into `ChannelProviderResult.deliveries`. The bridge lives in `packages/core/src/channels/legacy-bridge.ts` and is documented as the path for users who can't migrate to the factory yet.

---

## Subscriber Channel Data Model

### Schema

New table in `packages/core/src/db/schema.ts`:

```ts
{
  modelName: "subscriberChannel",
  fields: {
    id:           { type: "string", required: true, primaryKey: true },
    subscriberId: { type: "string", required: true, references: { model: "subscriber", field: "id", onDelete: "cascade" } },
    providerId:   { type: "string", required: true },              // "twilio", "webhook", "slack-workspace-1", ...
    channelType:  { type: "string", required: true },              // ChannelType
    address:      { type: "string", required: true },              // URL, phone, device token, channel-id
    credentials:  { type: "json",   required: false },             // { secret?, accessToken?, refreshToken?, ... }
    primary:      { type: "boolean", required: false, default: false },
    metadata:     { type: "json",   required: false },             // user-extensible
    createdAt:    { type: "date",   required: true },
    updatedAt:    { type: "date",   required: true },
  },
  indexes: [
    { fields: ["subscriberId", "channelType"] },
    { fields: ["subscriberId", "providerId"] },
  ],
}
```

`subscriber.email` and `subscriber.phone` remain on the `subscriber` table — the Novu/Knock hybrid model. `SubscriberChannel` is for richer per-provider data (webhook URLs, future push tokens, future chat connection IDs).

### Recipient resolution

```ts
// packages/core/src/core/subscriber.ts (modified)

export interface SubscriberWithChannels extends SubscriberRecord {
  channels: SubscriberChannelRecord[];
}

export async function resolveSubscriberWithChannels(
  db: DatabaseAdapter,
  id: string,
): Promise<SubscriberWithChannels | null>;

export function resolveRecipients(
  channelType: ChannelType,
  providerId: string,
  subscriber: SubscriberWithChannels,
): string[] {
  switch (channelType) {
    case "in_app": return [subscriber.id];
    case "email":  return subscriber.email ? [subscriber.email] : [];
    case "sms":    return subscriber.phone ? [subscriber.phone] : [];
    case "webhook":
    case "push":
    case "chat":
      return subscriber.channels
        .filter(c => c.channelType === channelType && c.providerId === providerId)
        .map(c => c.address);
    default: return [];
  }
}
```

`resolveRecipients` is synchronous because subscriber + channels are pre-fetched in `resolveSubscriberWithChannels`. The workflow runtime calls `resolveSubscriberWithChannels` once per workflow execution; subsequent step dispatches reuse the result. One indexed query per execution overhead.

Empty `string[]` means "no addresses for this subscriber/channel" — current behavior is preserved: log a warning, skip delivery, do not error.

### API endpoints

In `packages/core/src/api/routes/subscriber-channels.ts` (new):

```
POST   /subscribers/:id/channels         # create
GET    /subscribers/:id/channels         # list (credentials redacted)
PATCH  /subscribers/:id/channels/:cid    # PATCH semantics, only updates fields present in body
DELETE /subscribers/:id/channels/:cid    # remove
```

Request bodies validated via Zod schemas. `credentials` is **write-only**: never returned in GET responses, only a `hasCredentials: boolean` flag indicates whether a row has them. Aligns with existing API conventions (`packages/core/src/api/routes/`).

Programmatic API additions on `HeraldAPI`:
- `createSubscriberChannel(input)`
- `listSubscriberChannels(subscriberId)`
- `updateSubscriberChannel(id, patch)`
- `deleteSubscriberChannel(id)`

---

## Webhook Channel

### Default convention envelope

When `channels.webhook.defaultEnvelope === "convention"` (the default) and the workflow doesn't supply a `body`:

```ts
{
  event: "notification.delivered",
  transactionId: message.metadata.transactionId,
  workflowId: message.metadata.workflowId,
  stepId: message.metadata.stepId,
  subscriber: { id: message.subscriberId },
  payload: message.content.body ?? null,
  timestamp: new Date().toISOString(),
}
```

If `WebhookContent.body` is set in the step handler, it **fully replaces** the convention envelope (hybrid mode). Workflows wanting to extend the convention envelope use `metadata.extra` and access it from a `beforeSend` hook.

When `channels.webhook.defaultEnvelope === "minimal"`: the request body is exactly `WebhookContent.body` (or `null` if unset). For users who want full control of the wire format.

### HMAC signing

```ts
// packages/core/src/channels/webhook/signing.ts (new)

export function buildWebhookHeaders(
  message: ChannelMessage<WebhookContent>,
  recipient: string,
  subscriberChannels: SubscriberChannelRecord[],
  config: WebhookChannelConfig,
  payloadJson: string,
): Record<string, string> {
  const channelRow = subscriberChannels.find(c => c.address === recipient && c.channelType === "webhook");
  const secret = message.content.signingSecret
    ?? channelRow?.credentials?.secret
    ?? config.signingSecretFallback;

  const timestamp = String(Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Herald-Event": "notification.delivered",
    "X-Herald-Transaction-Id": message.metadata.transactionId ?? "",
    "X-Herald-Timestamp": timestamp,
    ...(message.content.headers ?? {}),
  };

  if (secret) {
    const signature = hmacSha256(secret, `${timestamp}.${payloadJson}`);
    headers[config.signatureHeader ?? "X-Herald-Signature"] = `sha256=${signature}`;
  } else {
    console.warn(`[herald] webhook to ${recipient} sent without signature — no secret configured`);
  }
  return headers;
}
```

Reuses the existing `hmacSha256` helper from the system-events webhook plugin (currently in `packages/core/src/plugins/observability/`). Identical signing scheme to system webhooks: `<timestamp>.<body>` payload, sha256 hex, header name configurable. Receivers verify by recomputing.

`channels.webhook.signingSecretFallback` is a global fallback for subscribers that don't have a per-row secret. Setting it allows blanket signing across all webhook channels with the same key (e.g., during rollout). Per-row secrets always win.

### Webhook provider factory

```ts
// packages/core/src/channels/webhook/provider.ts (new)
export function webhookChannelProvider(config: WebhookChannelConfig = {}): ChannelProvider<WebhookContent> {
  return httpChannelProvider<WebhookContent>({
    providerId: "webhook",
    channelType: "webhook",
    endpoint: (msg, to) => msg.content.url ?? to,                  // recipient address is the URL
    method: (msg) => msg.content.method ?? "POST",                  // honor per-message override
    auth: { type: "custom", apply: init => init },                  // signing handled in buildHeaders
    buildPayload: msg => msg.content.body ?? defaultWebhookEnvelope(msg, config),
    buildHeaders: (msg, to, { payloadJson }) =>
      buildWebhookHeaders(
        msg,
        to,
        (msg.metadata.extra?.subscriberChannels as SubscriberChannelRecord[]) ?? [],
        config,
        payloadJson,
      ),
    parseSuccess: async () => ({ messageId: crypto.randomUUID(), status: "sent" }),
  });
}
```

Subscriber channel rows are passed through `message.metadata.extra.subscriberChannels` so the factory's `buildHeaders` can resolve per-recipient secrets without an additional DB call. The workflow runtime populates this when constructing the message.

### Failure semantics

- Non-2xx response → `{ status: "failed", error: "HTTP <code>" }` for that recipient. Other recipients still attempt.
- Network error → same handling, error message includes cause.
- `result.deliveries` contains one entry per recipient with per-URL outcome.
- Each failed delivery emits `notification.failed` with the recipient URL in the event detail.

---

## Workflow Step Authoring

```ts
// packages/core/src/workflows/steps.ts (new)

export interface StepHandlerOptions {
  conditions?: StepCondition[];
  conditionMode?: "all" | "any";
}

export function emailStep(
  stepId: string,
  handler: (ctx: StepContext) => Promise<EmailContent>,
  options?: StepHandlerOptions,
): ActionStep;

export function smsStep(
  stepId: string,
  handler: (ctx: StepContext) => Promise<SmsContent>,
  options?: StepHandlerOptions,
): ActionStep;

export function webhookStep(
  stepId: string,
  handler: (ctx: StepContext) => Promise<WebhookContent>,
  options?: StepHandlerOptions,
): ActionStep;

export function inAppStep(
  stepId: string,
  handler: (ctx: StepContext) => Promise<InAppContent>,
  options?: StepHandlerOptions,
): ActionStep;
```

Internally each helper wraps the user's typed handler into the runtime's `(StepContext) => Promise<StepResult>` signature, returning `{ content }` on `StepResult`. The generic `{ stepId, type, handler }` form remains the canonical primitive for users who don't want the helper.

### Workflow runtime adjustments

`packages/core/src/core/workflow-runtime.ts`:

- After step handler returns, read `result.content` (now the contract for channel steps).
- Resolve the provider for the step's channel: `const provider = ctx.channels.get(step.type)`. Throw `HeraldProviderError` if absent. The `provider.providerId` is the key for filtering `SubscriberChannel` rows.
- Construct `ChannelMessage<unknown>` with framework-supplied envelope fields: `channel: step.type`, `subscriberId`, `recipients: resolveRecipients(step.type, provider.providerId, subscriberWithChannels)`, `content: result.content`, `metadata: { workflowId, transactionId, stepId, extra: { subscriberChannels: subscriberWithChannels.channels } }`.
- Call `sendThroughProvider(ctx, message)`.

The workflow runtime fetches `subscriberWithChannels` once per workflow execution (via `resolveSubscriberWithChannels`) and reuses it across all step dispatches. The `subscriberChannels` array in `metadata.extra` is the documented contract by which channel-specific providers (currently webhook, future push) access per-recipient credentials without re-querying the database.

Legacy flat `subject`/`body`/`actionUrl` fields on `StepResult` are removed. Workflows must return `{ content }` (or use a typed step helper). v0.6 → v0.7 breaking change documented in migration guide.

---

## `HeraldOptions` Configuration Surface

```ts
// packages/core/src/types/config.ts (rewrites)

export interface HeraldOptions {
  // ... existing fields ...
  channels?: ChannelsConfig;
  providers?: ChannelProvider[];
}

export interface ChannelsConfig {
  email?:   EmailChannelConfig;
  sms?:     SmsChannelConfig;
  webhook?: WebhookChannelConfig;
  inApp?:   InAppChannelConfig;
}

export interface EmailChannelConfig {
  enabled?: boolean;                      // default true
  defaultFrom?: string;
  defaultLayoutId?: string;
}

export interface SmsChannelConfig {
  enabled?: boolean;                      // default true
  defaultFrom?: string;
}

export interface WebhookChannelConfig {
  enabled?: boolean;                      // default true
  signingSecretFallback?: string;
  defaultEnvelope?: "convention" | "minimal";   // default "convention"
  signatureHeader?: string;               // default "X-Herald-Signature"
}

export interface InAppChannelConfig {
  enabled?: boolean;                      // default true
}
```

### Removed from v0.6

- `EmailChannelConfig.provider` / `apiKey` / `from` / `send` — replaced by explicit `providers: [resendProvider({ ... })]`.
- `SmsChannelConfig.provider` / `apiKey` / `send` — same pattern.
- `PushChannelConfig` — fully removed (YAGNI; reintroduced in v0.8 push spec).
- `buildEmailProvider` factory function in `packages/core/src/core/providers.ts` — channels and providers are now decoupled, so there is no shorthand-to-provider build step.

### Validation at init

In `packages/core/src/core/herald.ts`:

- For each `channels.X.enabled !== false`, log a warning if no provider is registered for that channel. Hard error only when a workflow step targets a channel with zero providers at trigger time.
- Auto-register the built-in `InAppProvider` if `channels.inApp.enabled !== false` (preserves current behavior).
- Register all built-in `ChannelDefinition`s. Plugins can register additional definitions via the existing plugin init flow.

### Example v0.7 config

```ts
const herald = createHerald({
  appName: "Acme",
  database: prismaAdapter({ ... }),
  workflow: postgresWorkflowAdapter({ ... }),
  channels: {
    email:   { defaultFrom: "noreply@acme.com" },
    sms:     { defaultFrom: "+15555550100" },
    webhook: { signingSecretFallback: process.env.HERALD_WEBHOOK_SECRET },
  },
  providers: [
    resendProvider({ apiKey: process.env.RESEND_KEY, from: "noreply@acme.com" }),
    twilioProvider({ accountSid: process.env.TWILIO_SID, authToken: process.env.TWILIO_TOKEN, from: "+15555550100" }),
    webhookChannelProvider(),
  ],
  workflows: [welcomeWorkflow],
});
```

---

## Plugin Hook Adjustments

`beforeSend`, `afterSend`, and `onSendFailure` hooks operate on the new `ChannelMessage<unknown>` shape.

```ts
// packages/core/src/types/plugin.ts (modified)

export interface HeraldPluginHooks {
  beforeSend?: (message: ChannelMessage<unknown>) => Promise<Partial<ChannelMessage<unknown>> | void>;
  afterSend?:  (message: ChannelMessage<unknown>, result: ChannelProviderResult) => Promise<void>;
  onSendFailure?: (message: ChannelMessage<unknown>, delivery: ChannelDelivery) => Promise<void>;
  // ... unchanged: onEvent, onStepStart, onStepComplete, beforeTrigger, afterTrigger ...
}
```

`beforeSend` returns a partial envelope; framework merges it into `message`. Concrete content patches require knowing the channel type — plugins do their own narrowing via `message.channel`.

This is a breaking change for plugin authors. Migration guide documents the new shape.

---

## Testing Strategy

All tests live under `packages/core/tests/` per existing convention. Vitest, fetch-mocked unit tests, in-memory adapter for integration tests.

### Unit tests

- `tests/http-channel-provider.test.ts` (new) — auth modes (bearer/basic/header/custom), per-recipient fan-out builds N requests, single-call mode, error mapping default + override, headers merging, JSON encoding, partial-failure handling.
- `tests/email-providers.test.ts` (updated) — Resend + SendGrid migrated to factory, assertions updated for `deliveries[]` shape and multi-recipient. Postmark + SES tests unchanged (legacy interface, exercised through legacy bridge).
- `tests/sms-providers.test.ts` (new) — Twilio happy path, basic-auth header, form-urlencoded body, queued vs sent status, multi-recipient fan-out, 4xx/5xx errors.
- `tests/webhook-channel.test.ts` (new) — convention envelope shape, custom body override, minimal envelope mode, HMAC header presence + correctness against fixed-key fixture, missing-secret warning, custom headers passthrough, multi-URL fan-out with per-URL secrets, network error path.
- `tests/channel-definitions.test.ts` (new) — each built-in render strategy: email layout wrapping, SMS body templating + length warning, webhook deep-string templating across nested objects/arrays, in-app templating. `validate` fires at register time.
- `tests/legacy-bridge.test.ts` (new) — Postmark and SES providers run through the legacy bridge with the new pipeline.

### Subscriber channel tests

- `tests/subscriber-channels.test.ts` (new) — CRUD via API routes, credentials redaction in GET responses, providerId+channelType row uniqueness rules, cascade delete on subscriber removal.
- `tests/contracts/database-adapter.test.ts` (extended) — `subscriberChannel` model coverage so Prisma + Drizzle + memory adapters all pass.
- `tests/subscriber.test.ts` (extended) — `resolveSubscriberWithChannels` pre-fetch, `resolveRecipients` per channel type, empty-recipient handling for missing email/phone/webhook URL.

### Integration / e2e

- `tests/e2e.test.ts` (extended) — workflow with email + SMS + webhook steps using `memoryAdapter` + mocked fetch. Verify full pipeline: trigger → step dispatch → recipient resolution → render → provider send → events emitted → activity log entries (when observability plugin enabled) → afterSend hooks fired.
- Multi-recipient fan-out: subscriber with 2 webhook URLs registered, verify 2 HTTP calls + 2 delivery records + 2 `notification.sent` events.
- Mixed success/failure: 1 of 3 recipients fails, verify partial-success result and per-recipient event emission.

### Migration smoke

No code coverage for backwards compatibility (none ships). Manual smoke-test against the migration guide before tagging the release.

---

## File Inventory

### Created

```
packages/core/src/channels/message.ts
packages/core/src/channels/content.ts
packages/core/src/channels/definition.ts
packages/core/src/channels/http-provider.ts
packages/core/src/channels/legacy-bridge.ts
packages/core/src/channels/definitions/email.ts
packages/core/src/channels/definitions/sms.ts
packages/core/src/channels/definitions/webhook.ts
packages/core/src/channels/definitions/in-app.ts
packages/core/src/channels/sms/twilio.ts
packages/core/src/channels/sms/index.ts
packages/core/src/channels/webhook/provider.ts
packages/core/src/channels/webhook/signing.ts
packages/core/src/channels/webhook/index.ts
packages/core/src/workflows/steps.ts
packages/core/src/api/routes/subscriber-channels.ts
packages/core/tests/http-channel-provider.test.ts
packages/core/tests/sms-providers.test.ts
packages/core/tests/webhook-channel.test.ts
packages/core/tests/channel-definitions.test.ts
packages/core/tests/legacy-bridge.test.ts
packages/core/tests/subscriber-channels.test.ts
docs/guides/migrating-to-v0.7.md
```

### Modified

```
packages/core/src/channels/provider.ts                      # generic ChannelProvider<TContent>
packages/core/src/channels/email/resend.ts                  # rewritten via httpChannelProvider
packages/core/src/channels/email/sendgrid.ts                # rewritten via httpChannelProvider
packages/core/src/channels/in-app.ts                        # produce ChannelProviderResult.deliveries[]
packages/core/src/channels/index.ts                         # export new module surface
packages/core/src/core/send.ts                              # channel-agnostic dispatch
packages/core/src/core/subscriber.ts                        # resolveSubscriberWithChannels, resolveRecipients
packages/core/src/core/workflow-runtime.ts                  # construct ChannelMessage envelope
packages/core/src/core/herald.ts                            # register channel definitions, drop buildEmailProvider
packages/core/src/core/providers.ts                         # delete buildEmailProvider
packages/core/src/db/schema.ts                              # subscriberChannel table
packages/core/src/types/config.ts                           # ChannelsConfig rewrite
packages/core/src/types/plugin.ts                           # hook signatures use ChannelMessage
packages/core/src/index.ts                                  # add new exports
packages/core/tests/email-providers.test.ts                 # update for new shapes
packages/core/tests/e2e.test.ts                             # extend for SMS + webhook
packages/core/tests/subscriber.test.ts                      # extend for SubscriberChannel
packages/core/tests/contracts/database-adapter.test.ts      # cover subscriberChannel model
ROADMAP.md                                                   # mark v0.7 in progress; add v1 secrets-resolver entry
CHANGELOG.md                                                 # v0.7 entry with breaking changes
```

### Deleted

None. Postmark, SES, and the legacy `ChannelProvider` interface stay as the documented escape hatch.

---

## Migration Guide

`docs/guides/migrating-to-v0.7.md` (new) covers:

- Old `channels.email = { provider: "resend", apiKey, from }` → new `channels.email = { defaultFrom: "..." }` + `providers: [resendProvider({ apiKey, from })]`.
- Same for SMS and webhook.
- Step handler return shape: `{ subject, body, actionUrl }` → `{ content: { ... } }` (or use `emailStep`/`smsStep`/`webhookStep` helpers).
- Plugin `beforeSend`/`afterSend`/`onSendFailure` hook signatures.
- New `SubscriberChannel` table requires migration: empty migration on greenfield, Prisma/Drizzle migration for existing deployments.
- `PushChannelConfig` removed — push reintroduces in v0.8.

---

## Future Work

Captured here so they don't get lost when the v1 spec is written.

### External secrets resolver (v1)

`SubscriberChannel.credentials` currently stores literal secret values as opaque jsonb. For v1, this should be extended so credentials can be **either** literal values **or** references to an external secrets store:

```ts
type CredentialValue<T> =
  | T                                                           // literal: { secret: "abc..." }
  | { $ref: { provider: "aws_asm" | "vault" | "gcp_sm" | "env"; uri: string } };
```

A new pluggable `SecretsResolver` interface resolves references at send time. Built-in resolvers ship as plugins (`@jeromesth/herald/secrets-aws`, etc.). Backwards-compat: literal secrets keep working untouched. To be added to `ROADMAP.md` v1 section in this PR.

### Vonage / MessageBird SMS providers

Punted from v0.7 to a later release. The HTTP factory should accommodate them with no further refactoring; if Vonage's API surfaces an assumption baked into the factory by Twilio alone, refine the factory at that point.

### Multi-provider routing per channel

Currently one provider per channel. v0.8+: register multiple providers per channel and route by `subscriber.locale`, `payload.region`, etc. Out of scope for v0.7.

### Push and chat

Push (v0.8) and chat (v0.8 / plugin track) are explicit non-goals for this spec. The `ChannelMessage<TContent>` + `ChannelDefinition` + `httpChannelProvider` triplet is designed to scale to them without further restructuring.

---

## Open Questions

None at spec-write time. All ten brainstorming decisions are recorded in "Architectural Decisions" above.

---

## Acceptance Criteria

A v0.7 release passes when:

1. `pnpm build && pnpm typecheck && pnpm test:run && pnpm lint` all green from a clean clone.
2. The example config in this spec compiles and runs against `memoryAdapter`/`memoryWorkflowAdapter`.
3. A workflow with three channel steps (email via Resend, SMS via Twilio, webhook via webhook channel) end-to-end delivers and emits all expected lifecycle events.
4. A subscriber with two registered webhook URLs receives two signed webhook calls when triggered, with per-URL secrets honored.
5. Postmark and SES providers (legacy interface) keep delivering email through the new pipeline via the legacy bridge.
6. CHANGELOG and migration guide cover every breaking change.
