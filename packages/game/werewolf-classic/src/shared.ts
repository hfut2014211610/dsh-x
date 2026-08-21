/**
 * Strict option parsing and detachment shared by the classic definitions.
 * Every parser is a config boundary: unknown keys, wrong types, and
 * out-of-range values fail loud with `WEREWOLF_INVALID_RULE_SET`, mirroring
 * the core rule-set parser's diagnostics.
 * @module @deepseek-ai/dsh-werewolf-classic/shared
 */

import type { JsonValue } from '@deepseek-ai/dsh-session'
import { WerewolfError } from '@deepseek-ai/dsh-werewolf'

/** A plain JSON object read as a definition-options record. */
export type JsonRecord = { [key: string]: JsonValue }

/**
 * Fail one definition-options parse with the typed rule-set error.
 * @param message - the exact diagnostic naming the rejected field.
 * @returns never; the call always throws.
 */
export function optionsInvalid(message: string): never {
  throw new WerewolfError('WEREWOLF_INVALID_RULE_SET', message)
}

/**
 * Read one definition's raw options as a record; `undefined` reads as no
 * options. Arrays and scalars reject.
 * @param value - the raw options value from rule-set config or a role binding.
 * @param where - the field path diagnostics name.
 * @returns the options record to validate field by field.
 */
export function asOptionsRecord(value: JsonValue | undefined, where: string): JsonRecord {
  if (value === undefined) return {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    optionsInvalid(`${where} must be an object`)
  }
  return value
}

/**
 * Reject option keys outside the reviewed set.
 * @param record - the options record under validation.
 * @param keys - every reviewed key.
 * @param where - the field path diagnostics name.
 */
export function rejectUnknownOptions(record: JsonRecord, keys: readonly string[], where: string): void {
  for (const key of Object.keys(record)) {
    if (!keys.includes(key)) optionsInvalid(`${where} has unknown key ${JSON.stringify(key)}`)
  }
}

/**
 * Parse the options shape every no-option definition accepts: nothing, or an
 * empty object.
 * @param value - the raw options value.
 * @param where - the field path diagnostics name.
 * @returns the empty options record.
 */
export function parseNoOptions(value: JsonValue | undefined, where: string): JsonRecord {
  const record = asOptionsRecord(value, where)
  rejectUnknownOptions(record, [], where)
  return {}
}

/**
 * Deep-copy one JSON value so definition output never aliases engine state.
 * @param value - the JSON value to copy.
 * @returns the detached copy.
 */
export function detachJson<T extends JsonValue>(value: T): T {
  if (typeof value !== 'object' || value === null) return value
  if (Array.isArray(value)) return value.map(item => detachJson(item)) as T
  const copy: JsonRecord = {}
  for (const [key, item] of Object.entries(value)) copy[key] = detachJson(item)
  return copy as T
}
