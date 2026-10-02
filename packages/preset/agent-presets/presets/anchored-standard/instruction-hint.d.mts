/**
 * Type face for the plain-JavaScript anchored-standard instruction-hint plugin.
 * The runtime plugin stays untyped; the spec only needs the registration entry.
 * @param ctx - Cordis context; the plugin registers its listener on it.
 * @param config - Plugin configuration; the plugin validates keys at runtime.
 */
export function apply(ctx: unknown, config?: unknown): void
