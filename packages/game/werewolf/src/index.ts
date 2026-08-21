/**
 * The deterministic Werewolf game core. This module re-exports the public
 * surface; loading it also merges the `werewolf/*` session-event declarations
 * and the `ctx.werewolf` service into their Cordis interfaces.
 * @module @deepseek-ai/dsh-werewolf
 */

export * from './brand.ts'
export type * from './types.ts'
export * from './error.ts'
export * from './registry.ts'
export * from './rules.ts'
export * from './events.ts'
export * from './bot-context.ts'
export * from './projection.ts'
export * from './bot-runner.ts'
export * from './human-projection.ts'
export * from './host-types.ts'
export * from './module-adapter.ts'
export * from './host.ts'
export * from './reducer.ts'
export * from './engine.ts'
export * from './runtime.ts'
export { default } from './runtime.ts'
