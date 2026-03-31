# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
