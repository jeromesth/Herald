# Herald Roadmap

This document outlines planned features and the development roadmap for Herald. Items are organized by priority and category, with references to comparable features in Novu and Knock.app.

## v0.1 — Foundation (Current)

- [x] Core `herald()` configuration with single config pattern
- [x] Database adapter interface + Prisma adapter
- [x] Workflow adapter interface + Inngest adapter
- [x] Core DB schema (subscriber, notification, topic, preference, channel)
- [x] REST API endpoints (trigger, subscribers, notifications, preferences, topics)
- [x] Plugin system (schema extension, hooks, custom endpoints)
- [x] In-memory adapters for testing
- [x] Full test suite

## v0.2 — Channel Delivery

Priority: **High** | Comparable: Novu Integrations, Knock Channels

- [x] **Email delivery** — integrate with SendGrid, Resend, Postmark, Amazon SES
- [x] **In-app real-time** — SSE support for live notification feeds
- [x] **Channel provider interface** — standardized `send()` contract for all channels
- [x] **Template rendering** — Handlebars-style template engine for notification content
- [x] **Email layouts** — reusable HTML email layouts with variable interpolation

## v0.2.5 — Postgres Workflow Engine

Priority: **High** | Unique to Herald — zero-dependency workflow execution

The Inngest adapter is powerful for teams that scale, but most developers starting out already have Postgres and don't want another service. A Postgres-backed workflow adapter gives Herald a **batteries-included default**: one database, zero external dependencies, instant setup. Perfect for indie hackers, vibe coders, and fast adoption. Teams that outgrow it can migrate to Inngest or Temporal later.

**Implementation approach:** Integrate an existing Postgres-based durable execution library rather than building a custom runtime. Top candidates:

| Library | Approach | Why consider |
|---------|----------|--------------|
| [DBOS Transact](https://github.com/dbos-inc/dbos-transact-ts) | Durable execution with step-level persistence | True workflow durability, step checkpointing, automatic crash recovery. Only needs Postgres. |
| [pg-boss](https://github.com/timgit/pg-boss) + thin orchestration layer | Job queue with chained steps | Battle-tested (~3.3k stars), widely adopted. Would need a small orchestration layer to chain steps into workflows. |
| [pg-workflows](https://github.com/SokratisVidros/pg-workflows) | Durable workflows on top of pg-boss | Purpose-built for exactly this use case, but very early-stage (~23 stars). Worth watching. |

**Tasks:**

- [x] **Evaluate and select** Postgres workflow library (DBOS vs pg-boss + orchestration layer)
- [x] **Implement `postgresWorkflowAdapter()`** — new adapter conforming to `WorkflowAdapter` interface
- [x] **Step-level durability** — each workflow step checkpointed to Postgres, recoverable on crash
- [x] **Delay step support** — Postgres-native scheduling (e.g. `pg_notify` or polling) for delay steps
- [x] **Retry and error handling** — configurable retries with backoff per step
- [ ] **Make it the default** — when using `prismaAdapter({ provider: "postgresql" })`, suggest or auto-configure this adapter
- [ ] **Migration guide** — document how to migrate from Postgres workflow adapter to Inngest/Temporal when scaling
- [ ] **Tests** — full test suite covering durability, retries, delays, crash recovery

## v0.3 — Workflow Steps `IN REVIEW`

Priority: **High** | Comparable: Novu Digest/Delay, Knock Function Steps
Branch: `Workflow-Steps` — implementation complete, in code review

- [x] **Delay step** — pause workflow execution for a configurable duration
- [x] **Digest/batch step** — aggregate multiple triggers into a single notification
- [ ] **Branch step** — conditional logic within workflows (if/else)
- [x] **Throttle step** — rate-limit notifications per subscriber
- [x] **Fetch step** — HTTP request to pull external data into workflow context

## v0.4 — Additional Adapters

Priority: **High** | Unique to Herald

- [x] **Drizzle database adapter** — `@herald/core/drizzle`
- [x] **Postgres workflow adapter** — `@herald/core/postgres` (see v0.2.5)
- [x] **Upstash Workflow adapter** — `@herald/core/upstash`
- [ ] **Trigger.dev adapter** — `@herald/core/trigger`
- [ ] **Kysely database adapter** — `@herald/core/kysely`
- [ ] **MongoDB adapter** — `@herald/core/mongo`

## v0.5 — Advanced Preferences

Priority: **Medium** | Comparable: Knock PreferenceSet, Novu Preferences

- [x] **Category-based preferences** — opt in/out by notification category with per-channel granularity (`CategoryPreference`)
- [x] **Workflow-level preferences** — per-workflow subscriber overrides with conditions (`WorkflowChannelPreference`)
- [x] **Critical notifications** — bypass subscriber preferences for mandatory alerts, plus `readOnly` per-channel controls
- [x] **Operator-level preferences** — enforced admin overrides that subscribers cannot change (`OperatorPreferences`)
- [x] **Preference inheritance** — 12-level precedence: critical > operator enforced > readOnly > channel kill switch > workflow > category > purpose > conditions > author defaults > config/operator defaults
- [x] **Preference conditions** — dynamic evaluation based on subscriber attributes or payload data (`PreferenceCondition`)
- [x] **Bulk preference API** — batch update up to 100 subscribers via `PUT /preferences/bulk`

## v0.6 — Observability & Analytics

Priority: **Medium** | Comparable: Novu Activity Feed, Knock Message Events

- [ ] **Activity log** — track all notification lifecycle events
- [ ] **Delivery tracking** — sent, delivered, bounced, failed status per message
- [ ] **Engagement tracking** — seen, read, clicked, archived events
- [ ] **Webhook events** — emit webhooks for notification lifecycle events
- [ ] **Metrics endpoint** — expose notification metrics for monitoring
- [ ] **Integration tests** — real database integration tests using testcontainers/docker for Postgres, Redis, etc.

## v0.7 — Multi-Channel Expansion

Priority: **Medium** | Comparable: Novu/Knock full channel support

- [ ] **SMS delivery** — Twilio, Vonage, MessageBird integration
- [ ] **Push notifications** — FCM, APNs, Expo Push
- [ ] **Chat delivery** — Slack, Discord, Microsoft Teams
- [ ] **Webhook channel** — deliver notifications via HTTP webhooks
- [ ] **Channel groups** — bundle channels with conditional logic

## v0.8 — Client SDKs

Priority: **Medium** | Comparable: Knock React SDK, Novu Inbox Component

- [ ] **React hooks** — `useNotifications()`, `usePreferences()`, `useUnreadCount()`
- [ ] **Headless client** — framework-agnostic JS client for any frontend
- [ ] **React Native** — mobile notification inbox
- [ ] **Vue/Svelte adapters** — community adapters for other frameworks

## v0.9 — Advanced Features

Priority: **Low** | Comparable: Knock/Novu enterprise features

- [ ] **Broadcast** — send one-time notifications to all or filtered subscribers
- [ ] **Scheduled triggers** — cron-based recurring notification workflows
- [ ] **Internationalization (i18n)** — per-locale notification templates
- [ ] **Multi-tenancy** — tenant-scoped notification configuration and branding
- [ ] **Idempotency** — transaction-level deduplication for notification triggers

## v1.0 — Production Ready

- [ ] **CLI tool** — schema generation, migration helpers, adapter scaffolding. Includes `herald generate` command for scaffolding adapter schemas (Drizzle, Prisma, Kysely) — inspired by BetterAuth's `npx auth generate`
- [ ] **OpenAPI spec** — auto-generated API documentation
- [ ] **Comprehensive documentation** — guides, tutorials, API reference
- [ ] **Performance benchmarks** — load testing and optimization
- [ ] **Security audit** — rate limiting, input validation, CSRF protection
- [ ] **CORS multi-origin verification** — manually verify CORS preflight with multi-origin config reflects the correct `Access-Control-Allow-Origin` for each request origin
- [ ] **Zod email validation edge cases** — verify Zod `z.string().email()` rejects edge cases the old custom regex accepted (e.g. missing TLD, quoted local parts)

---

## Plugin Ideas

These features are candidates for the plugin system rather than core:

| Plugin | Description | Priority |
|--------|-------------|----------|
| **workflow-kit** | Visual workflow editor UI — developers define steps in code, non-developers configure them via a drag-and-drop React component. Inspired by Inngest Workflow Kit and Novu Framework: code-first workflow definitions with a visual layer for editing steps, conditions, delays, and channel routing without redeploying. Ships as `@herald/workflow-kit` (React) with a headless `@herald/workflow-kit-core` for other frameworks. | **High** |
| **analytics** | Notification delivery and engagement analytics | Medium |
| **audit-log** | Full audit trail of all notification operations | Medium |
| **rate-limiter** | Advanced per-subscriber rate limiting | Medium |
| **ab-testing** | A/B test notification content and channels | Low |
| **webhook-provider** | Generic webhook delivery channel | Medium |
| **slack** | Slack-specific notification delivery | Medium |
| **discord** | Discord-specific notification delivery | Low |
| **translation** | i18n support with translation management | Low |
| **archive** | Auto-archive old notifications with retention policies | Low |
| **export** | Export notification data (CSV, JSON) | Low |

---

## Feature Comparison Matrix

Features mapped across Herald, Novu, and Knock.app:

| Feature | Herald | Novu | Knock |
|---------|--------|------|-------|
| In-app notifications | v0.1 | Yes | Yes |
| Email delivery | v0.2 | Yes | Yes |
| SMS delivery | v0.7 | Yes | Yes |
| Push notifications | v0.7 | Yes | Yes |
| Chat (Slack/Teams) | v0.7 | Yes | Yes |
| Subscriber management | v0.1 | Yes | Yes |
| Notification preferences | v0.1 | Yes | Yes |
| Topics/fan-out | v0.1 | Yes | Yes |
| Digest/batching | v0.3 | Yes | Yes |
| Delay steps | v0.3 | Yes | Yes |
| Conditional logic | v0.3 | Yes | Yes |
| Template engine | v0.2 | Yes | Yes |
| Multi-tenancy | v0.9 | Yes | Yes |
| i18n | v0.9 | Yes | Yes |
| React components | v0.8 | Yes | Yes |
| Visual workflow editor | Plugin | Yes (Workflow Kit) | No |
| Self-hosted | v0.1 | Partial | No |
| Bring your own DB | v0.1 | No | No |
| Zero-dep workflow (Postgres) | v0.2.5 | No | No |
| Bring your own workflow | v0.1 | No | No |
| Plugin system | v0.1 | No | No |
| Open source | v0.1 | Yes | No |
| Free forever | v0.1 | Limits | No |
