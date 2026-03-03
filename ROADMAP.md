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

## v0.3 — Workflow Steps

Priority: **High** | Comparable: Novu Digest/Delay, Knock Function Steps

- [ ] **Delay step** — pause workflow execution for a configurable duration
- [ ] **Digest/batch step** — aggregate multiple triggers into a single notification
- [ ] **Branch step** — conditional logic within workflows (if/else)
- [ ] **Throttle step** — rate-limit notifications per subscriber
- [ ] **Fetch step** — HTTP request to pull external data into workflow context

## v0.4 — Additional Adapters

Priority: **High** | Unique to Herald

- [ ] **Drizzle database adapter** — `herald-notification/drizzle`
- [ ] **Upstash Workflow adapter** — `herald-notification/upstash`
- [ ] **Trigger.dev adapter** — `herald-notification/trigger`
- [ ] **Kysely database adapter** — `herald-notification/kysely`
- [ ] **MongoDB adapter** — `herald-notification/mongo`

## v0.5 — Advanced Preferences

Priority: **Medium** | Comparable: Knock PreferenceSet, Novu Preferences

- [ ] **Category-based preferences** — opt in/out by notification category
- [ ] **Workflow-level preferences** — per-workflow subscriber overrides
- [ ] **Critical notifications** — bypass subscriber preferences for mandatory alerts
- [ ] **Tenant-scoped preferences** — per-organization default preferences
- [ ] **Preference inheritance** — environment defaults < tenant < subscriber hierarchy

## v0.6 — Observability & Analytics

Priority: **Medium** | Comparable: Novu Activity Feed, Knock Message Events

- [ ] **Activity log** — track all notification lifecycle events
- [ ] **Delivery tracking** — sent, delivered, bounced, failed status per message
- [ ] **Engagement tracking** — seen, read, clicked, archived events
- [ ] **Webhook events** — emit webhooks for notification lifecycle events
- [ ] **Metrics endpoint** — expose notification metrics for monitoring

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

- [ ] **CLI tool** — schema generation, migration helpers, adapter scaffolding
- [ ] **OpenAPI spec** — auto-generated API documentation
- [ ] **Comprehensive documentation** — guides, tutorials, API reference
- [ ] **Performance benchmarks** — load testing and optimization
- [ ] **Security audit** — rate limiting, input validation, CSRF protection

---

## Plugin Ideas

These features are candidates for the plugin system rather than core:

| Plugin | Description | Priority |
|--------|-------------|----------|
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
| Self-hosted | v0.1 | Partial | No |
| Bring your own DB | v0.1 | No | No |
| Bring your own workflow | v0.1 | No | No |
| Plugin system | v0.1 | No | No |
| Open source | v0.1 | Yes | No |
| Free forever | v0.1 | Limits | No |
