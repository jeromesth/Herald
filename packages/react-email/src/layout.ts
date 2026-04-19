import type { EmailLayout } from "heraldjs";

/**
 * Layout id reserved for React Email templates.
 *
 * React Email components produce complete HTML documents (doctype, head, body).
 * Herald's default layout wraps bodies in its own shell, which would corrupt
 * that output. This pass-through layout slots the rendered body directly into
 * the outgoing message without any additional chrome.
 */
export const REACT_EMAIL_LAYOUT_ID = "react-email";

export const reactEmailLayout: EmailLayout = {
	id: REACT_EMAIL_LAYOUT_ID,
	html: "{{{ content }}}",
	text: "{{ content }}",
};
