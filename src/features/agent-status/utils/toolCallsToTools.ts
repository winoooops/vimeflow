import type { ToolCount } from '../types'

/**
 * Convert the live `toolCalls.byType` record into the ordered `ToolCount[]` the
 * jar/tags views consume. `byType` is already insertion-ordered (the Rust
 * parser appends each newly-seen tool, then increments), and `Object.entries`
 * preserves that order — so tiles keyed by `name` stay put and morph in place
 * rather than reshuffling. Centralizing the conversion here keeps that
 * stable-order contract in one place.
 */
export const toolCallsToTools = (byType: Record<string, number>): ToolCount[] =>
  Object.entries(byType).map(([name, count]) => ({ name, count }))
