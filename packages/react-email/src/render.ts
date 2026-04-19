import { render } from "@react-email/render";
import type { EmailTemplate } from "./define.js";
import { REACT_EMAIL_LAYOUT_ID } from "./layout.js";

/**
 * Shape returned by `renderReactEmail`. Matches the subset of Herald's
 * `StepResult` that email workflow steps populate — so the return value can
 * be returned directly from a step handler.
 */
export interface RenderReactEmailResult {
	subject: string;
	body: string;
	data: {
		text: string;
		layoutId: typeof REACT_EMAIL_LAYOUT_ID;
		preview?: string;
	};
}

export interface RenderReactEmailOptions {
	/**
	 * When true (default), also render a plain-text fallback and attach it to
	 * `data.text`. Herald's email providers forward this to the SMTP/API layer.
	 */
	plainText?: boolean;
}

/**
 * Render a React Email template to the exact shape a Herald email step handler
 * should return. The result routes through the `react-email` pass-through layout,
 * so the component's HTML is delivered untouched.
 *
 * @example
 * ```ts
 * workflow.step.email("welcome", async (ctx) => {
 *   return renderReactEmail(WelcomeEmail, {
 *     firstName: ctx.subscriber.firstName ?? "friend",
 *     verifyUrl: `${ctx.payload.baseUrl}/verify`,
 *   });
 * });
 * ```
 */
export async function renderReactEmail<TProps>(
	template: EmailTemplate<TProps>,
	props: TProps,
	options: RenderReactEmailOptions = {},
): Promise<RenderReactEmailResult> {
	const element = template.createElement(props);
	const htmlPromise = render(element);
	const textPromise = options.plainText === false ? Promise.resolve("") : render(element, { plainText: true });

	const [html, text] = await Promise.all([htmlPromise, textPromise]);

	return {
		subject: template.subject(props),
		body: html,
		data: {
			text,
			layoutId: REACT_EMAIL_LAYOUT_ID,
			...(template.preview ? { preview: template.preview(props) } : {}),
		},
	};
}
