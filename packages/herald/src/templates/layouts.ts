/**
 * Email layout system for Herald.
 * Provides reusable HTML email layouts with variable interpolation.
 */

import { renderTemplate, type TemplateContext } from "./engine.js";

export interface EmailLayout {
	/** Unique layout identifier. */
	id: string;
	/** HTML template with a {{{ content }}} slot for the body. */
	html: string;
	/** Optional plain-text template with a {{ content }} slot. */
	text?: string;
}

export interface RenderedEmail {
	subject: string;
	html: string;
	text?: string;
}

/**
 * Built-in minimal email layout.
 * Clean, responsive design that works across email clients.
 */
export const defaultEmailLayout: EmailLayout = {
	id: "default",
	html: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{{ subject }}</title>
<style>
  body { margin: 0; padding: 0; background-color: #f4f4f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
  .wrapper { width: 100%; background-color: #f4f4f7; padding: 40px 0; }
  .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .header { padding: 24px 32px; background-color: #ffffff; border-bottom: 1px solid #eaeaea; }
  .header h1 { margin: 0; font-size: 18px; font-weight: 600; color: #333333; }
  .body { padding: 32px; color: #333333; font-size: 16px; line-height: 1.6; }
  .footer { padding: 24px 32px; background-color: #f9fafb; text-align: center; font-size: 13px; color: #9ca3af; border-top: 1px solid #eaeaea; }
  .button { display: inline-block; padding: 12px 24px; background-color: #111827; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 500; font-size: 14px; }
  a { color: #2563eb; }
</style>
</head>
<body>
<div class="wrapper">
  <div class="container">
    {{#if app.name}}
    <div class="header">
      <h1>{{ app.name }}</h1>
    </div>
    {{/if}}
    <div class="body">
      {{{ content }}}
    </div>
    <div class="footer">
      {{#if app.name}}<p>&copy; {{ app.name }}</p>{{/if}}
      {{#if unsubscribeUrl}}<p><a href="{{ unsubscribeUrl }}">Unsubscribe</a></p>{{/if}}
    </div>
  </div>
</div>
</body>
</html>`,
	text: `{{ content }}

{{#if app.name}}---
{{ app.name }}{{/if}}
{{#if unsubscribeUrl}}
Unsubscribe: {{ unsubscribeUrl }}{{/if}}`,
};

/**
 * Render an email with a layout.
 */
export function renderEmail(args: {
	layout?: EmailLayout;
	subject: string;
	body: string;
	context: TemplateContext;
}): RenderedEmail {
	const layout = args.layout ?? defaultEmailLayout;

	// First render the body template with context
	const renderedBody = renderTemplate(args.body, args.context);

	// Then render the subject template
	const renderedSubject = renderTemplate(args.subject, args.context);

	// Create layout context with the rendered body as `content`
	const layoutContext: TemplateContext = {
		...args.context,
		content: renderedBody,
		subject: renderedSubject,
	};

	// Render the full layout
	const html = renderTemplate(layout.html, layoutContext);
	const text = layout.text ? renderTemplate(layout.text, layoutContext) : undefined;

	return {
		subject: renderedSubject,
		html,
		text,
	};
}

/**
 * Layout registry for named layouts.
 */
export class LayoutRegistry {
	private layouts = new Map<string, EmailLayout>();

	constructor() {
		this.layouts.set("default", defaultEmailLayout);
	}

	register(layout: EmailLayout): void {
		this.layouts.set(layout.id, layout);
	}

	get(id: string): EmailLayout | undefined {
		return this.layouts.get(id);
	}

	getDefault(): EmailLayout {
		return this.layouts.get("default") ?? defaultEmailLayout;
	}
}
