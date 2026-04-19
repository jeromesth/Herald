# @herald/react-email

> Strongly-typed [React Email](https://react.email) templates for [Herald](https://github.com/jeromesth/herald).

Author your notification emails as React components with typed props, then render them inside a Herald workflow step. Type safety flows end-to-end: if the props a template expects don't match what you pass in, you get a compile error — not a broken email in production.

---

## Why

Herald ships with a small Handlebars-style template engine that's great for simple emails, but most teams reach for React Email once they need componentized layouts, design tokens, or a preview/dev workflow. This package is the glue:

- **Strongly-typed templates** — `defineEmailTemplate<Props>()` locks the component, the subject builder, and the render call to the same prop shape.
- **No layout double-wrapping** — React Email components produce full HTML documents. This plugin registers a pass-through layout so Herald delivers the React output untouched instead of re-wrapping it in the default shell.
- **Plain-text fallback out of the box** — `renderReactEmail` produces both `html` and `text` from the same component, wired straight into the email provider.
- **No core changes** — Herald's `TemplateEngine` and `LayoutRegistry` are already pluggable; this package slots in through the public plugin interface.

## Install

```bash
pnpm add @herald/react-email @react-email/render react
```

`@herald/core`, `@react-email/render`, and `react` are peer dependencies — you bring your own versions.

## Quick start

```tsx
// emails/welcome.tsx
import { defineEmailTemplate } from "@herald/react-email";
import { Html, Heading, Link, Preview } from "@react-email/components";

interface WelcomeProps {
  firstName: string;
  verifyUrl: string;
}

export const WelcomeEmail = defineEmailTemplate<WelcomeProps>({
  id: "welcome",
  subject: (p) => `Welcome, ${p.firstName}!`,
  preview: (p) => `One last step, ${p.firstName} — verify your email.`,
  Component: ({ firstName, verifyUrl }) => (
    <Html>
      <Preview>Verify your email to get started</Preview>
      <Heading>Hi {firstName}</Heading>
      <Link href={verifyUrl}>Verify your email</Link>
    </Html>
  ),
});
```

```ts
// lib/notifications.ts
import { herald } from "@herald/core";
import { reactEmailPlugin } from "@herald/react-email";

export const notifications = herald({
  database,
  workflow,
  plugins: [reactEmailPlugin()],
  workflows: [
    {
      id: "user-signup",
      name: "User signup",
      steps: [
        {
          stepId: "welcome-email",
          type: "email",
          handler: async (ctx) => {
            return renderReactEmail(WelcomeEmail, {
              firstName: ctx.subscriber.firstName ?? "friend",
              verifyUrl: `${ctx.payload.baseUrl}/verify`,
            });
          },
        },
      ],
    },
  ],
});
```

That's it. `renderReactEmail` returns the exact `{ subject, body, data }` shape a Herald email step handler is expected to return, with `data.layoutId` set to the pass-through layout so the React output is delivered as-is.

## API

### `defineEmailTemplate<Props>(def)`

Declare a typed template. `Props` is the single source of truth — it's threaded through the `Component`, the `subject` builder, and the `renderReactEmail` call site.

```ts
defineEmailTemplate<Props>({
  id?: string,                                   // optional stable id (logs, previews, registries)
  subject: string | ((props: Props) => string),  // static or derived
  preview?: string | ((props: Props) => string), // preview text (email-client inbox preview)
  Component: ComponentType<Props>,               // your React Email component
})
```

Returns an `EmailTemplate<Props>` with normalized `subject` / `preview` functions and a `createElement` factory.

### `renderReactEmail(template, props, options?)`

Async function that renders the template to HTML (and plain text) and returns an object shaped for an email step's return value:

```ts
{
  subject: string;
  body: string;                    // React-rendered HTML
  data: {
    text: string;                  // plain-text fallback
    layoutId: "react-email";       // targets the pass-through layout
    preview?: string;              // if the template defines one
  };
}
```

Options:

- `plainText?: boolean` — defaults to `true`. Set to `false` to skip plain-text rendering when you don't need a fallback.

### `reactEmailPlugin()`

Herald plugin. Register it on `herald({ plugins: [...] })`. At init time it adds a pass-through `react-email` layout (`{{{ content }}}`) to the `LayoutRegistry`, which is what `renderReactEmail` targets via `data.layoutId`.

Without this plugin installed, React-rendered HTML would be wrapped in Herald's default layout shell (which adds its own `<html>`, headers, and footers) — that's almost never what you want for a React Email component.

### `REACT_EMAIL_LAYOUT_ID` / `reactEmailLayout`

Exposed for advanced users who want to register the layout manually or reference the id elsewhere. Most users shouldn't need these.

## How it fits together

```
 your workflow step                renderReactEmail                   Herald send path
 ─────────────────────┐            ─────────────────────┐            ─────────────────────┐
                      │            @react-email/render  │            reactEmailLayout     │
  return renderReact  │──renders──▶ → html, text        │──returns──▶ {{{ content }}}     │
  Email(Tpl, props)   │            layoutId: react-email│            pass-through         │
 ─────────────────────┘            ─────────────────────┘            ─────────────────────┘
                                                                              │
                                                                              ▼
                                                                    email provider.send(...)
```

The plugin does **not** replace Herald's `TemplateEngine` — the Handlebars engine keeps serving any workflow that uses string-based templates. React Email and Handlebars coexist per-workflow.

## Compatibility

- React 18 or 19
- `@react-email/render` ≥ 0.0.15
- `@herald/core` (matching version)

## License

MIT
