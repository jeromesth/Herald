# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-03-14

### Added

- **CORS support** — configurable via `cors` option in `herald()` config
- **Input validation** on API boundaries (email format, array type checks, `to` field validation)
- **JSON body size limit** (1 MB) to prevent memory exhaustion attacks
- **Table prefix validation** in Postgres workflow adapter (alphanumeric + underscore only)
- **Plugin context safety** — plugins can no longer overwrite critical context keys (`db`, `workflow`, `generateId`, etc.)
- **Deep merge for preferences** — `updatePreferences` now deep-merges nested objects instead of shallow-overwriting
- **Throttle state cleanup** — expired entries are garbage-collected to prevent memory leaks
- **`categories` field** added to preference database schema (was in code but missing from schema)
- **CHANGELOG.md** and **SECURITY.md** community files
- **Drizzle database adapter** now available (previously listed as "Planned")
- **Upstash workflow adapter** now available (previously listed as "Planned")
- **Postgres workflow adapter** now listed in documentation

### Fixed

- Repository URL corrected from `inngest-notifications` to `herald` in package.json and README
- README adapter status table now accurately reflects implemented adapters
- README tech stack lists Node.js instead of Bun
- Boolean query params (`read`, `seen`, `archived`) now correctly parse `"false"` value
- InAppProvider no longer stores empty strings for missing `workflowId` — logs a warning and uses `"unknown"`
- Email provider error messages no longer leak raw API response bodies — logged server-side, sanitized in return values
- `afterSend` and `afterTrigger` plugin hooks wrapped in try/catch — errors are logged but don't crash delivery
- BDD test infrastructure fixed — `cucumber-js` properly installed and configured with tsx loader

### Changed

- Node.js requirement lowered from `>=24.0.0` to `>=20.0.0`
- Coverage thresholds raised to 80% lines, 75% branches, 80% functions
- Biome lint rules `noNonNullAssertion` and `noExplicitAny` upgraded from `"warn"` to `"error"`

## [0.3.0] - 2026-03-01

### Added

- Advanced preference enforcement (v0.5)
- BDD/TDD infrastructure with contract test suites
- Core framework BDD feature files

## [0.2.0] - 2026-02-15

### Added

- Initial adapter pattern (Database, Workflow, Channel)
- Plugin system with lifecycle hooks
- REST API with auto-generated endpoints
- In-app notification provider with SSE
- Email providers (Resend, SendGrid, Postmark, SES)
- Template engine with Handlebars
- Subscriber management and preferences
