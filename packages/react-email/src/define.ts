import { type ComponentType, type ReactElement, createElement as reactCreateElement } from "react";

/**
 * User-provided email template configuration.
 *
 * @typeParam TProps - the props type shared by the subject builder and the React component.
 */
export interface EmailTemplateDefinition<TProps> {
	/** Optional stable identifier for this template (useful for logging, registries, previews). */
	id?: string;
	/** Either a static subject string or a function deriving the subject from props. */
	subject: string | ((props: TProps) => string);
	/** React component rendered to HTML at send time. */
	Component: ComponentType<TProps>;
	/** Optional preview text shown in email clients before the body is opened. */
	preview?: string | ((props: TProps) => string);
}

/**
 * Strongly-typed email template ready to be rendered by `renderReactEmail`.
 *
 * Returned by `defineEmailTemplate`. Consumers should not construct this object
 * directly — the factory normalizes static vs. function inputs.
 */
export interface EmailTemplate<TProps> {
	readonly id?: string;
	readonly subject: (props: TProps) => string;
	readonly preview?: (props: TProps) => string;
	readonly createElement: (props: TProps) => ReactElement;
}

/**
 * Define a strongly-typed email template backed by a React component.
 *
 * The type parameter `TProps` flows through to the workflow step at render
 * time, so passing a mistyped payload to `renderReactEmail` becomes a
 * compile-time error.
 *
 * @example
 * ```tsx
 * import { defineEmailTemplate } from "@herald/react-email";
 *
 * interface WelcomeProps { firstName: string; verifyUrl: string }
 *
 * export const WelcomeEmail = defineEmailTemplate<WelcomeProps>({
 *   id: "welcome",
 *   subject: (p) => `Welcome, ${p.firstName}!`,
 *   Component: ({ firstName, verifyUrl }) => (
 *     <Html><Heading>Hi {firstName}</Heading><Link href={verifyUrl}>Verify</Link></Html>
 *   ),
 * });
 * ```
 */
export function defineEmailTemplate<TProps>(def: EmailTemplateDefinition<TProps>): EmailTemplate<TProps> {
	const subject = typeof def.subject === "function" ? def.subject : () => def.subject as string;
	const preview = def.preview === undefined ? undefined : typeof def.preview === "function" ? def.preview : () => def.preview as string;
	// React.createElement's overloads don't model generic ComponentType<TProps> cleanly —
	// component props are contravariant, so we widen via `unknown` before passing in.
	const Component = def.Component as unknown as ComponentType<object>;
	return {
		id: def.id,
		subject,
		preview,
		createElement: (props: TProps) => reactCreateElement(Component, props as object),
	};
}
