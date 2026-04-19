# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.0] - 2026-04-19

### Added
- **Activity log** — tracks all notification lifecycle events (11 event types: workflow triggered/completed/failed, step started/completed/failed, notification sent/delivered/bounced/failed, preference blocked). Accessible via `GET /activity` and `GET /activity/:transactionId`.
- **Delivery tracking** — `sent`, `delivered`, `bounced`, `failed` status per message with `updateDeliveryStatus` API.
- **Webhook events** — emit webhooks for notification lifecycle events with HMAC-SHA256 signing, event filtering, and custom headers.
- **`@herald/react-email` plugin** — strongly-typed React Email integration. `reactEmailPlugin()`, `renderReactEmail()`, `defineEmailTemplate()`, `reactEmailLayout`.

### Fixed
- **Type resolution broken for consumers**: `package.json` exports declared `.d.mts` files but tsup was emitting `.d.ts`. Under `moduleResolution: "bundler"` this silently broke type imports. Exports map and `types` field now reference the actual `.d.ts` files tsup produces.
- **DoS: uncapped `?limit=` in list endpoints** — notifications, topics, and activity routes now cap at 200/100 respectively; activity route was clamping after the DB call rather than before.
- **DoS: `?offset=` NaN not guarded** — `parseInt("abc")` returns `NaN`; notifications and topics routes now default to 0.
- **Upstash adapter leaked internal error message in 500 responses** — now logs real error server-side and returns generic `"Internal server error"`.
- **`@react-email/render` peer dep too loose** — `>=0.0.15` allowed the incompatible `0.x` async-render API; tightened to `>=1.0.0`.
- **`heraldjs` peer dep in react-email used `workspace:*`** — doesn't rewrite on `npm publish`; changed to `>=0.5.0`.

### Changed
- **BREAKING (pre-1.0)**: npm package renamed from `@herald/core` to `heraldjs`. Update your install command and all imports. Sub-path imports follow the same pattern: `heraldjs/prisma`, `heraldjs/inngest`, etc.
- LICENSE copyright holder updated to full legal name.
- `package.json`: canonical `repository` URL, `homepage`, `bugs`, `author`, `sideEffects: false`.
- `prepack`/`postpack` scripts copy root README.md and LICENSE into the package during publish.

### Security
- **Trigger endpoint auth**: `herald().handler` is intentionally unauthenticated — Herald is a headless library. Callers must add their own auth middleware before exposing the handler in production. This is now documented in `trigger.ts` and the README.
- **Template triple-stache XSS**: `{{{ }}}` in Handlebars body templates skips HTML escaping. Using `{{{ payload.X }}}` with untrusted user input is an XSS vector in email. Warning added to `EmailLayout` JSDoc.

## [0.5.0] - 2026-03-30

### Added

- **Advanced preference controls** — 14-level preference precedence hierarchy for fine-grained notification routing
- **Category-based preferences** — opt in/out by notification category with per-channel granularity
- **Workflow-level preferences** — per-workflow subscriber overrides with channel controls and conditions
- **Critical notifications** — bypass subscriber preferences for mandatory alerts
- **ReadOnly channel controls** — workflow authors can lock channels so subscribers cannot override them
- **Operator-level preferences** — enforced admin overrides that subscribers cannot change
- **Preference conditions** — dynamic evaluation based on subscriber attributes or payload data
- **Bulk preference API** — batch update up to 100 subscribers via `PUT /preferences/bulk`
- **Preference normalization** — legacy boolean workflow/category preferences auto-converted to object form
- **Branch step** — declarative conditional logic within workflows (if/else branching)

### Changed

- **`preferenceGate` refactored** to chain-of-responsibility pattern — each precedence level is now an isolated check function, improving testability and extensibility
- Postgres workflow adapter now suggested automatically when using `prismaAdapter` with PostgreSQL

### Documentation

- Added migration guide for Postgres workflow adapter to Inngest/Temporal
- Consolidated repo documentation (replaced `plan.md` with `agents.md`)

## [0.4.0] - 2026-03-29

First official tagged release of Herald.

### Added

- Core `herald()` factory function with single-config pattern
- Adapter pattern: DatabaseAdapter, WorkflowAdapter, ChannelProvider interfaces
- Database adapters: Prisma, Drizzle, in-memory
- Workflow adapters: Inngest, Postgres, Upstash, in-memory
- Email providers: Resend, SendGrid, Postmark, Amazon SES
- In-app notification provider with SSE real-time delivery
- Template engine with Handlebars rendering and email layouts
- REST API with auto-generated endpoints
- Plugin system with lifecycle hooks, schema extension, and custom endpoints
- Workflow steps: delay, digest/batch, throttle, fetch
- Subscriber management and notification preferences with deep merge
- CORS support with configurable origins
- Input validation on API boundaries
- BDD/TDD infrastructure with contract test suites for adapters

### Security

- JSON body size limit (1 MB) to prevent memory exhaustion
- Table prefix validation in Postgres workflow adapter
- Plugin context safety — plugins cannot overwrite critical context keys
- Internal errors hidden from API responses
- Email provider errors sanitized in return values
