/**
 * Rule-set parsing and compilation. `parseWerewolfRuleSetInput` is the loud
 * config boundary: it rejects unknown keys, unsafe integers, empty decks,
 * non-positive counts, and closed-union violations. `resolveWerewolfRuleSet`
 * is the only operation that resolves registry references, parses definition
 * options, enforces cross-field invariants, and returns the immutable
 * compiled rule set with its canonical SHA-256 digest.
 * @module @deepseek-ai/dsh-werewolf/rules
 */

import { createHash } from 'node:crypto'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import { WerewolfError } from './error.ts'
import type { WerewolfRegistry } from './registry.ts'
import { definitionKey } from './registry.ts'
import type {
  CompiledWerewolfRole,
  WerewolfCompiledPhaseOccurrenceV1,
  WerewolfCompiledRuleSetV1,
  WerewolfDeckEntryV1,
  WerewolfPhaseEntryV1,
  WerewolfRuleSetInputV1,
  WerewolfRuleSetSummaryV1,
  WerewolfVictoryEntryV1,
} from './types.ts'

/** Protocol bound for identifiers and public labels inside a rule set. */
export const WEREWOLF_MAX_LABEL_CHARS = 64

type JsonRecord = { [key: string]: JsonValue }

/** Read one JSON object or fail with the field path in the diagnostic. */
function asRecord(value: JsonValue | undefined, where: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalid(`${where} must be an object`)
  }
  return value
}

/** Reject unknown keys so config never grows unreviewed fields. */
function rejectUnknown(record: JsonRecord, keys: readonly string[], where: string): void {
  for (const key of Object.keys(record)) {
    if (!keys.includes(key)) throw invalid(`${where} has unknown key ${JSON.stringify(key)}`)
  }
}

/** Read one bounded non-empty string field. */
function requireLabel(record: JsonRecord, key: string, where: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw invalid(`${where}.${key} must be a non-empty string`)
  }
  if (value.length > WEREWOLF_MAX_LABEL_CHARS) {
    throw invalid(`${where}.${key} exceeds ${WEREWOLF_MAX_LABEL_CHARS} characters`)
  }
  return value
}

/** Read one integer field within inclusive bounds. */
function requireInt(
  record: JsonRecord,
  key: string,
  where: string,
  min: number,
  max: number,
): number {
  const value = record[key]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw invalid(`${where}.${key} must be an integer between ${min} and ${max}`)
  }
  return value
}

/** Read one closed-union string field. */
function requireUnion<T extends string>(
  record: JsonRecord,
  key: string,
  where: string,
  options: readonly T[],
): T {
  const value = record[key]
  for (const option of options) {
    if (value === option) return option
  }
  throw invalid(`${where}.${key} must be one of ${options.map(x => JSON.stringify(x)).join(' | ')}`)
}

/** Read a present options value; a present-but-empty key is invalid. */
function presentOptions(record: JsonRecord, where: string): JsonValue {
  const value = record.options
  if (value === undefined) throw invalid(`${where}.options must carry a JSON value when present`)
  return value
}

/** One typed rule-set failure. */
function invalid(message: string): WerewolfError {
  return new WerewolfError('WEREWOLF_INVALID_RULE_SET', message)
}

/** One typed missing-definition failure naming the exact wanted version. */
function unknownDefinition(kind: string, id: string, version: number): WerewolfError {
  return new WerewolfError(
    'WEREWOLF_UNKNOWN_DEFINITION',
    `werewolf rule set references ${kind} ${definitionKey(id, version)} which is not registered`,
    { kind, id, version },
  )
}

function parseDeckEntry(value: JsonValue, where: string): WerewolfDeckEntryV1 {
  const record = asRecord(value, where)
  rejectUnknown(record, ['role', 'roleVersion', 'count', 'options'], where)
  const entry: WerewolfDeckEntryV1 = {
    role: requireLabel(record, 'role', where),
    roleVersion: requireInt(record, 'roleVersion', where, 1, Number.MAX_SAFE_INTEGER),
    count: requireInt(record, 'count', where, 1, Number.MAX_SAFE_INTEGER),
  }
  if ('options' in record) entry.options = presentOptions(record, where)
  return entry
}

function parsePhaseEntry(value: JsonValue, where: string): WerewolfPhaseEntryV1 {
  const record = asRecord(value, where)
  rejectUnknown(record, ['phase', 'phaseVersion', 'options'], where)
  const entry: WerewolfPhaseEntryV1 = {
    phase: requireLabel(record, 'phase', where),
    phaseVersion: requireInt(record, 'phaseVersion', where, 1, Number.MAX_SAFE_INTEGER),
  }
  if ('options' in record) entry.options = presentOptions(record, where)
  return entry
}

function parseVictoryEntry(value: JsonValue, where: string): WerewolfVictoryEntryV1 {
  const record = asRecord(value, where)
  rejectUnknown(record, ['condition', 'conditionVersion', 'priority', 'options'], where)
  const entry: WerewolfVictoryEntryV1 = {
    condition: requireLabel(record, 'condition', where),
    conditionVersion: requireInt(record, 'conditionVersion', where, 1, Number.MAX_SAFE_INTEGER),
    priority: requireInt(record, 'priority', where, 0, Number.MAX_SAFE_INTEGER),
  }
  if ('options' in record) entry.options = presentOptions(record, where)
  return entry
}

/**
 * Strictly parse one rule-set input. Throws `WEREWOLF_INVALID_RULE_SET` on the
 * first unknown key, unsafe integer, empty collection, duplicate entry, or
 * closed-union violation.
 *
 * @param value - raw rule-set record from config or a recorded snapshot.
 * @returns the parsed, detached rule-set input.
 */
export function parseWerewolfRuleSetInput(value: JsonValue): WerewolfRuleSetInputV1 {
  const record = asRecord(value, 'rule set')
  rejectUnknown(record, [
    'schemaVersion', 'id', 'revision', 'displayName', 'playerCount', 'deck', 'cycle', 'victory', 'policies',
  ], 'rule set')
  if (record.schemaVersion !== 1) throw invalid('rule set schemaVersion must be 1')
  const id = requireLabel(record, 'id', 'rule set')
  const deckRaw = record.deck
  if (deckRaw === undefined || !Array.isArray(deckRaw)) throw invalid('rule set.deck must be an array')
  const deck = deckRaw.map((entry, index) => parseDeckEntry(entry, `rule set.deck[${index}]`))
  if (deck.length === 0) throw invalid('rule set.deck must not be empty')
  const seenDeck = new Set<string>()
  for (const entry of deck) {
    const key = definitionKey(entry.role, entry.roleVersion)
    if (seenDeck.has(key)) throw invalid(`rule set.deck repeats ${key}; merge its counts`)
    seenDeck.add(key)
  }
  const cycle = asRecord(record.cycle, 'rule set.cycle')
  rejectUnknown(cycle, ['setup', 'night', 'day'], 'rule set.cycle')
  const parseSegment = (name: 'setup' | 'night' | 'day'): WerewolfPhaseEntryV1[] => {
    const raw = cycle[name]
    if (raw === undefined) return []
    if (!Array.isArray(raw)) throw invalid(`rule set.cycle.${name} must be an array`)
    const entries = raw.map((entry, index) => parsePhaseEntry(entry, `rule set.cycle.${name}[${index}]`))
    if (entries.length === 0 && name !== 'setup') {
      throw invalid(`rule set.cycle.${name} must not be empty`)
    }
    return entries
  }
  const setup = parseSegment('setup')
  const night = parseSegment('night')
  const day = parseSegment('day')
  const victoryRaw = record.victory
  if (victoryRaw === undefined || !Array.isArray(victoryRaw)) throw invalid('rule set.victory must be an array')
  const victory = victoryRaw.map((entry, index) => parseVictoryEntry(entry, `rule set.victory[${index}]`))
  if (victory.length === 0) throw invalid('rule set.victory must not be empty')
  const seenVictory = new Set<string>()
  for (const entry of victory) {
    const key = `${definitionKey(entry.condition, entry.conditionVersion)}@${entry.priority}`
    if (seenVictory.has(key)) throw invalid(`rule set.victory repeats ${key}`)
    seenVictory.add(key)
  }
  const policiesRecord = asRecord(record.policies, 'rule set.policies')
  rejectUnknown(policiesRecord, ['voteTie', 'wolfTie', 'deadHuman', 'maxDays', 'speechMaxChars'], 'rule set.policies')
  return {
    schemaVersion: 1,
    id,
    revision: requireInt(record, 'revision', 'rule set', 1, Number.MAX_SAFE_INTEGER),
    displayName: requireLabel(record, 'displayName', 'rule set'),
    playerCount: requireInt(record, 'playerCount', 'rule set', 2, 128),
    deck,
    cycle: {
      ...(setup.length > 0 ? { setup } : {}),
      night,
      day,
    },
    victory,
    policies: {
      voteTie: requireUnion(policiesRecord, 'voteTie', 'rule set.policies', ['no-elimination', 'revote-once', 'seeded-random'] as const),
      wolfTie: requireUnion(policiesRecord, 'wolfTie', 'rule set.policies', ['no-kill', 'seeded-random'] as const),
      deadHuman: requireUnion(policiesRecord, 'deadHuman', 'rule set.policies', ['spectate', 'auto-advance'] as const),
      maxDays: requireInt(policiesRecord, 'maxDays', 'rule set.policies', 1, 512),
      speechMaxChars: requireInt(policiesRecord, 'speechMaxChars', 'rule set.policies', 1, 4096),
    },
  }
}

/**
 * Canonical JSON serialization with recursively sorted object keys, so equal
 * values always serialize identically.
 *
 * @param value - the JSON value to serialize.
 * @returns the canonical serialization.
 */
export function canonicalWerewolfJson(value: JsonValue): string {
  const parts: string[] = []
  const write = (current: JsonValue): void => {
    if (current === null || typeof current !== 'object') {
      parts.push(JSON.stringify(current))
      return
    }
    if (Array.isArray(current)) {
      parts.push('[')
      current.forEach((item, index) => {
        if (index > 0) parts.push(',')
        write(item)
      })
      parts.push(']')
      return
    }
    const keys = Object.keys(current).sort()
    parts.push('{')
    keys.forEach((key, index) => {
      if (index > 0) parts.push(',')
      parts.push(`${JSON.stringify(key)}:`)
      // Keys come from Object.keys, so each value is present; the assertion
      // only defeats noUncheckedIndexedAccess on the index signature.
      write(current[key] as JsonValue)
    })
    parts.push('}')
  }
  write(value)
  return parts.join('')
}

/**
 * Stable SHA-256 digest of one rule-set input's canonical serialization.
 *
 * @param input - the parsed rule-set input.
 * @returns the hex digest recorded by `werewolf/game-started`.
 */
export function werewolfRuleSetDigest(input: WerewolfRuleSetInputV1): string {
  // Parsed rule-set inputs are JSON by construction; the assertion bridges
  // the interface to its indexed-signature view for the canonical writer.
  return createHash('sha256').update(canonicalWerewolfJson(input as unknown as JsonValue)).digest('hex')
}

/**
 * The rule-set summary role compilation receives.
 *
 * @param input - the parsed rule-set input.
 * @returns the summary handed to each role's `compile`.
 */
export function werewolfRuleSetSummary(input: WerewolfRuleSetInputV1): WerewolfRuleSetSummaryV1 {
  return {
    id: input.id,
    revision: input.revision,
    displayName: input.displayName,
    playerCount: input.playerCount,
    policies: input.policies,
    deck: input.deck,
  }
}

/** Compile one configured segment list against the registry. */
function compileSegment(
  entries: readonly WerewolfPhaseEntryV1[],
  segmentName: string,
  registry: WerewolfRegistry,
  participantsOf: (id: string, version: number) => Array<{ role: CompiledWerewolfRole; binding: JsonValue }>,
): WerewolfCompiledPhaseOccurrenceV1[] {
  const occurrenceCounts = new Map<string, number>()
  for (const entry of entries) {
    const key = definitionKey(entry.phase, entry.phaseVersion)
    occurrenceCounts.set(key, (occurrenceCounts.get(key) ?? 0) + 1)
  }
  return entries.map((entry) => {
    const definition = registry.getPhase(entry.phase, entry.phaseVersion)
    if (definition === undefined) throw unknownDefinition('phase', entry.phase, entry.phaseVersion)
    const key = definitionKey(entry.phase, entry.phaseVersion)
    /* v8 ignore next -- the counting loop above set occurrenceCounts for this exact key, so the get never misses */
    if ((occurrenceCounts.get(key) ?? 0) > 1 && definition.repeatable !== true) {
      throw invalid(`rule set.cycle.${segmentName} repeats phase ${key} which is not repeatable`)
    }
    const options = definition.parseOptions(entry.options)
    const compiled = definition.compile({
      options,
      participants: participantsOf(entry.phase, entry.phaseVersion),
    })
    if (compiled.id !== definition.id || compiled.version !== definition.version) {
      throw invalid(`phase ${key} compiled as ${definitionKey(compiled.id, compiled.version)}`)
    }
    return {
      phaseId: entry.phase,
      phaseVersion: entry.phaseVersion,
      options,
      compiled,
    }
  })
}

/**
 * Compile one rule set against the current registries. Deck counts must sum
 * to `playerCount`; every reference must resolve at its exact version; every
 * options value must pass its owning definition's parser; every required role
 * binding must find a matching phase occurrence.
 *
 * @param input - the raw or parsed rule-set input.
 * @param registry - the registries to resolve against.
 * @returns the immutable compiled rule set with its digest.
 */
export function resolveWerewolfRuleSet(input: JsonValue, registry: WerewolfRegistry): WerewolfCompiledRuleSetV1 {
  const parsed = parseWerewolfRuleSetInput(input)
  const deckTotal = parsed.deck.reduce((sum, entry) => sum + entry.count, 0)
  if (deckTotal !== parsed.playerCount) {
    throw invalid(`rule set deck counts sum to ${deckTotal}, not playerCount ${parsed.playerCount}`)
  }
  const summary = werewolfRuleSetSummary(parsed)
  const rawRoles = new Map<string, CompiledWerewolfRole>()
  for (const entry of parsed.deck) {
    const definition = registry.getRole(entry.role, entry.roleVersion)
    if (definition === undefined) throw unknownDefinition('role', entry.role, entry.roleVersion)
    const compiled = definition.compile({ options: definition.parseOptions(entry.options), ruleSet: summary })
    const key = definitionKey(definition.id, definition.version)
    if (compiled.id !== definition.id || compiled.version !== definition.version) {
      throw invalid(`role ${key} compiled as ${definitionKey(compiled.id, compiled.version)}`)
    }
    rawRoles.set(key, compiled)
  }
  const allOccurrences = [...parsed.cycle.setup ?? [], ...parsed.cycle.night, ...parsed.cycle.day]
  const roles = new Map<string, CompiledWerewolfRole>()
  for (const role of rawRoles.values()) {
    const seenBindings = new Set<string>()
    const phaseBindings = role.phaseBindings.map((binding) => {
      const key = definitionKey(binding.phaseId, binding.phaseVersion)
      if (seenBindings.has(key)) {
        throw invalid(`role ${definitionKey(role.id, role.version)} repeats phase binding ${key}`)
      }
      seenBindings.add(key)
      const matched = allOccurrences.some(entry =>
        entry.phase === binding.phaseId && entry.phaseVersion === binding.phaseVersion)
      if (!matched) {
        if (binding.required) {
          throw invalid(`role ${definitionKey(role.id, role.version)} requires phase ${key} which the cycle does not include`)
        }
        return binding
      }
      const definition = registry.getPhase(binding.phaseId, binding.phaseVersion)
      if (definition === undefined) throw unknownDefinition('phase', binding.phaseId, binding.phaseVersion)
      return { ...binding, options: definition.parseRoleBinding(binding) }
    })
    roles.set(definitionKey(role.id, role.version), { ...role, phaseBindings })
  }
  const roleList = [...roles.values()]
  const participantsOf = (phaseId: string, phaseVersion: number): Array<{ role: CompiledWerewolfRole; binding: JsonValue }> => {
    const participants: Array<{ role: CompiledWerewolfRole; binding: JsonValue }> = []
    for (const role of roleList) {
      const binding = role.phaseBindings.find(candidate =>
        candidate.phaseId === phaseId && candidate.phaseVersion === phaseVersion)
      if (binding === undefined) continue
      participants.push({ role, binding: binding.options })
    }
    return participants
  }
  const cycle = {
    setup: compileSegment(parsed.cycle.setup ?? [], 'setup', registry, participantsOf),
    night: compileSegment(parsed.cycle.night, 'night', registry, participantsOf),
    day: compileSegment(parsed.cycle.day, 'day', registry, participantsOf),
  }
  const victory = parsed.victory.map((entry) => {
    const definition = registry.getVictoryCondition(entry.condition, entry.conditionVersion)
    if (definition === undefined) throw unknownDefinition('victory condition', entry.condition, entry.conditionVersion)
    return {
      definition,
      options: definition.parseOptions(entry.options),
      priority: entry.priority,
    }
  })
  return {
    input: parsed,
    digest: werewolfRuleSetDigest(parsed),
    roles,
    cycle,
    victory,
  }
}
