/**
 * Public data contracts of the deterministic Werewolf game core: rule-set
 * inputs, extension-definition interfaces, action plans and resolutions,
 * durable event payloads, the folded game state, and bot continuity context.
 * Types only — no runtime code lives here.
 * @module @deepseek-ai/dsh-werewolf/types
 */

import type { JsonValue } from '@deepseek-ai/dsh-session'
import type {
  WerewolfDecisionId,
  WerewolfGameId,
  WerewolfHumanActionId,
  WerewolfPhaseInstanceId,
  WerewolfPlayerId,
} from './brand.ts'

/** Deck composition entry naming one registered role at an exact version. */
export interface WerewolfDeckEntryV1 {
  role: string
  roleVersion: number
  count: number
  options?: JsonValue
}

/** Rule-set policies that steer scheduling and tie outcomes inside one game. */
export interface WerewolfPoliciesV1 {
  voteTie: 'no-elimination' | 'revote-once' | 'seeded-random'
  wolfTie: 'no-kill' | 'seeded-random'
  deadHuman: 'spectate' | 'auto-advance'
  maxDays: number
  speechMaxChars: number
}

/** One configured phase occurrence inside a rule-set cycle list. */
export interface WerewolfPhaseEntryV1 {
  phase: string
  phaseVersion: number
  options?: JsonValue
}

/** One configured victory condition with its priority. */
export interface WerewolfVictoryEntryV1 {
  condition: string
  conditionVersion: number
  priority: number
  options?: JsonValue
}

/**
 * JSON-compatible rule-set input as it appears in Cordis plugin config.
 * Defaults stay unresolved here; only `resolveRuleSet` normalizes and compiles.
 */
export interface WerewolfRuleSetInputV1 {
  schemaVersion: 1
  id: string
  revision: number
  displayName: string
  playerCount: number
  deck: WerewolfDeckEntryV1[]
  cycle: {
    setup?: WerewolfPhaseEntryV1[]
    night: WerewolfPhaseEntryV1[]
    day: WerewolfPhaseEntryV1[]
  }
  victory: WerewolfVictoryEntryV1[]
  policies: WerewolfPoliciesV1
}

/** Rule-set facts a role may adapt to at compile time. */
export interface WerewolfRuleSetSummaryV1 {
  id: string
  revision: number
  displayName: string
  playerCount: number
  policies: WerewolfPoliciesV1
  deck: ReadonlyArray<WerewolfDeckEntryV1>
}

/** How one role joins one exact phase version. */
export interface WerewolfRolePhaseBindingV1 {
  phaseId: string
  phaseVersion: number
  required: boolean
  kind: string
  options: JsonValue
}

/** Input the engine hands a role's private-knowledge projector. */
export interface WerewolfRoleKnowledgeInputV1 {
  /** Facts about the actor's own seat. */
  self: {
    playerId: WerewolfPlayerId
    seat: number
    alive: boolean
    roleState: JsonValue
    resources: Readonly<Record<string, number>>
    notices: ReadonlyArray<WerewolfPrivateNoticeRecordV1>
  }
  /** Same-faction teammates; provided only when the compiled role is entitled. */
  teammates: ReadonlyArray<{ playerId: WerewolfPlayerId; seat: number; alive: boolean }>
  /** Current game day. */
  day: number
}

/** The compiled, per-game-ready form of one registered role version. */
export interface CompiledWerewolfRole {
  id: string
  version: number
  faction: string
  publicName: string
  initialRoleState: JsonValue
  /** Named counters the engine tracks and the invariant checks for underflow. */
  initialResources?: Readonly<Record<string, number>>
  /** Whether the role's private knowledge includes same-faction teammates. */
  seesFactionTeammates?: boolean
  phaseBindings: WerewolfRolePhaseBindingV1[]
  /** Detached, actor-authorized private knowledge for one decision. */
  projectPrivateKnowledge(input: WerewolfRoleKnowledgeInputV1): JsonValue
}

/** Trusted same-process registration type for one role version. */
export interface WerewolfRoleDefinition {
  id: string
  version: number
  /** Parse and validate raw config options; throws on invalid input. */
  parseOptions(value: JsonValue | undefined): JsonValue
  compile(input: { options: JsonValue; ruleSet: WerewolfRuleSetSummaryV1 }): CompiledWerewolfRole
}

/** Deterministic seeded picker the engine lends to phase code. */
export interface WerewolfRng {
  /** Pick one item; every draw advances the recorded seed stream. */
  pick<T>(items: readonly T[]): T
}

/** Public facts about one player, visible to every phase. */
export interface WerewolfPlayerFactsV1 {
  playerId: WerewolfPlayerId
  seat: number
  displayName: string
  alive: boolean
  /** Secret faction, provided to trusted phase code; never a bot observation. */
  faction?: string
}

/** Runtime facts about one phase participant, keyed to a parsed binding. */
export interface WerewolfParticipantFactsV1 {
  playerId: WerewolfPlayerId
  seat: number
  alive: boolean
  roleState: JsonValue
  resources: Readonly<Record<string, number>>
  binding: JsonValue
}

/** One earlier phase resolution of the current game day. */
export interface WerewolfPriorResolutionV1 {
  phaseId: string
  phaseVersion: number
  day: number
  segment: 'setup' | 'night' | 'day'
  resolution: WerewolfResolutionV1
}

/** Input to `CompiledWerewolfPhase.open`. */
export interface WerewolfPhaseOpenInputV1 {
  day: number
  occurrence: number
  policies: WerewolfPoliciesV1
  players: ReadonlyArray<WerewolfPlayerFactsV1>
  participants: ReadonlyArray<WerewolfParticipantFactsV1>
  sameDayHistory: ReadonlyArray<WerewolfPriorResolutionV1>
  rng: WerewolfRng
}

/** Result of opening a phase: skip, or an immutable action plan. */
export type WerewolfPhaseOpenResultV1 =
  | { kind: 'skip'; reason: string }
  | { kind: 'plan'; plan: WerewolfActionPlanV1 }

/** Input to `CompiledWerewolfPhase.resolve`. */
export interface WerewolfPhaseResolveInputV1 extends WerewolfPhaseOpenInputV1 {
  /** Accepted actions for this occurrence, one per settled actor. */
  actions: ReadonlyArray<{ playerId: WerewolfPlayerId; action: JsonValue }>
  /** Accepted public speeches keyed by actor, when the phase collected them. */
  speeches?: ReadonlyArray<{ playerId: WerewolfPlayerId; text: string }>
}

/** Trusted same-process registration type for one phase version. */
export interface WerewolfPhaseDefinition {
  id: string
  version: number
  /** Whether one cycle position may open this phase more than once (revotes). */
  repeatable?: boolean
  /** Parse and validate raw config options; throws on invalid input. */
  parseOptions(value: JsonValue | undefined): JsonValue
  /** Parse and validate one role binding; throws on unsupported kind/options. */
  parseRoleBinding(binding: WerewolfRolePhaseBindingV1): JsonValue
  compile(input: {
    options: JsonValue
    participants: ReadonlyArray<{ role: CompiledWerewolfRole; binding: JsonValue }>
  }): CompiledWerewolfPhase
}

/** The compiled, per-game-ready form of one registered phase version. */
export interface CompiledWerewolfPhase {
  id: string
  version: number
  open(input: WerewolfPhaseOpenInputV1): WerewolfPhaseOpenResultV1
  resolve(input: WerewolfPhaseResolveInputV1): WerewolfResolutionV1
}

/** Input to one victory-condition evaluation. */
export interface WerewolfVictoryEvaluationInputV1 {
  day: number
  players: ReadonlyArray<{ playerId: WerewolfPlayerId; faction: string; alive: boolean }>
}

/** A faction win or a tie, as claimed by one condition. */
export type WerewolfVictoryOutcomeV1 =
  | { kind: 'faction'; factionId: string }
  | { kind: 'tie' }

/** One condition's claim with detached evidence data. */
export interface WerewolfVictoryClaimV1 {
  outcome: WerewolfVictoryOutcomeV1
  evidence: JsonValue
}

/** Trusted same-process registration type for one victory-condition version. */
export interface WerewolfVictoryConditionDefinition {
  id: string
  version: number
  /** Parse and validate raw config options; throws on invalid input. */
  parseOptions(value: JsonValue | undefined): JsonValue
  evaluate(input: WerewolfVictoryEvaluationInputV1 & { options: JsonValue }): WerewolfVictoryClaimV1 | null
}

/** One compiled phase occurrence inside a compiled rule set. */
export interface WerewolfCompiledPhaseOccurrenceV1 {
  phaseId: string
  phaseVersion: number
  options: JsonValue
  compiled: CompiledWerewolfPhase
}

/** The immutable output of `resolveRuleSet`. */
export interface WerewolfCompiledRuleSetV1 {
  /** Normalized input with defaults applied; plain JSON with a stable digest. */
  input: WerewolfRuleSetInputV1
  /** SHA-256 hex digest of the canonical serialization of `input`. */
  digest: string
  /** Every compiled role the deck references, keyed `${id}@${version}`. */
  roles: ReadonlyMap<string, CompiledWerewolfRole>
  cycle: {
    setup: ReadonlyArray<WerewolfCompiledPhaseOccurrenceV1>
    night: ReadonlyArray<WerewolfCompiledPhaseOccurrenceV1>
    day: ReadonlyArray<WerewolfCompiledPhaseOccurrenceV1>
  }
  victory: ReadonlyArray<{
    definition: WerewolfVictoryConditionDefinition
    options: JsonValue
    priority: number
  }>
}

/**
 * The closed action-spec vocabulary. Plans describe every actor's legal
 * action with these kinds only; configuration can supply no other logic.
 */
export type WerewolfActionSpecV1 =
  | { kind: 'player-target'; targets: readonly WerewolfPlayerId[]; allowSkip: boolean }
  | { kind: 'choice'; options: readonly string[]; allowSkip: boolean }
  | { kind: 'text'; maxChars: number; allowSkip: boolean }
  | {
    kind: 'compound'
    fields: ReadonlyArray<{
      id: string
      spec: WerewolfSingleActionSpecV1
    }>
    allowSkip: boolean
  }

/** The non-compound members of the action-spec vocabulary. */
export type WerewolfSingleActionSpecV1 = Exclude<WerewolfActionSpecV1, { kind: 'compound' }>

/** One actor's row in an opened phase's action plan. */
export interface WerewolfActionActorV1 {
  playerId: WerewolfPlayerId
  seat: number
  actionKind: string
  spec: WerewolfActionSpecV1
  /** Phase-authored legal-action context for the prompt (e.g. tonight's victim). */
  context?: JsonValue
}

/** The immutable plan an opened phase publishes. */
export interface WerewolfActionPlanV1 {
  mode: 'parallel-private' | 'seat-order-public'
  actors: ReadonlyArray<WerewolfActionActorV1>
}

/** One private notice appended to a player's entitled knowledge. */
export interface WerewolfPrivateNoticeRecordV1 {
  toPlayerId: WerewolfPlayerId
  kind: string
  data: JsonValue
}

/** One public announcement; display copy derives from `key` and `data`. */
export interface WerewolfAnnouncementRecordV1 {
  kind: 'system' | 'death' | 'vote' | 'result'
  key: string
  data?: JsonValue
}

/**
 * The declarative resolution one phase returns. The reducer applies the
 * records in a fixed order and never re-runs phase code during replay.
 */
export interface WerewolfResolutionV1 {
  eliminations: ReadonlyArray<{ playerId: WerewolfPlayerId; cause: string }>
  prevented: ReadonlyArray<{ playerId: WerewolfPlayerId; cause: string }>
  resourceReplacements: ReadonlyArray<{
    playerId: WerewolfPlayerId
    resourceId: string
    remaining: number
  }>
  roleStateReplacements: ReadonlyArray<{ playerId: WerewolfPlayerId; roleState: JsonValue }>
  privateNotices: ReadonlyArray<WerewolfPrivateNoticeRecordV1>
  announcements: ReadonlyArray<WerewolfAnnouncementRecordV1>
  votes: ReadonlyArray<{ voterId: WerewolfPlayerId; targetId: WerewolfPlayerId | null }>
  /** Phase-authored summary for later phases' `sameDayHistory`. */
  outcome: JsonValue
  /** When the phase is `day.vote`: its outcome for the engine's tie policy. */
  voteOutcome?: { eliminated: WerewolfPlayerId | null; tiedPlayers: readonly WerewolfPlayerId[] }
}

/** Evidence entries inside a game result. */
export interface WerewolfResultEvidenceV1 {
  source: 'condition' | 'max-days' | 'human-abort'
  conditionId?: string
  conditionVersion?: number
  priority?: number
  data: JsonValue
}

/** The terminal result recorded by `werewolf/game-ended`. */
export interface WerewolfGameResultV1 {
  outcome: WerewolfVictoryOutcomeV1 | { kind: 'aborted' }
  evidence: WerewolfResultEvidenceV1[]
}

/** Mutation idempotency record carried by the key-owning events. */
export interface WerewolfMutationRequestV1 {
  requestId: string
  digest: string
}

/** Stable bot personality assigned at game start; immutable for the game. */
export interface WerewolfBotProfileV1 {
  personalityId: string
  speakingStyle: string
  riskStyle: 'cautious' | 'balanced' | 'aggressive'
}

/** One roster row inside `werewolf/game-started`. */
export interface WerewolfRosterEntryV1 {
  playerId: WerewolfPlayerId
  seat: number
  displayName: string
  human: boolean
  roleId: string
  roleVersion: number
  faction: string
  roleState: JsonValue
  resources: Readonly<Record<string, number>>
}

/** Definition versions a game started against; resume requires all of them. */
export interface WerewolfDefinitionVersionsV1 {
  roles: ReadonlyArray<{ id: string; version: number }>
  phases: ReadonlyArray<{ id: string; version: number }>
  victory: ReadonlyArray<{ id: string; version: number }>
}

/** Typed pause reasons; `interrupted` is derived on load, never logged. */
export type WerewolfPauseReasonV1 =
  | 'bot-failure'
  | 'cancelled'
  | 'unsupported-definition'
  | 'invariant-failure'
  | 'operator-request'

/** Failure categories preserved by `werewolf/bot-attempt-failed`. */
export type WerewolfBotFailureCategoryV1 =
  | 'provider-setup'
  | 'result-rejected'
  | 'timeout'
  | 'invalid-output'
  | 'illegal-action'
  | 'invalid-context-delta'
  | 'disposal'

/** Durable payload of `werewolf/game-started`. */
export interface WerewolfGameStartedV1 {
  version: 1
  gameId: WerewolfGameId
  gameRevision: 1
  engineEventVersion: 1
  ruleSet: WerewolfRuleSetInputV1
  ruleSetDigest: string
  definitionVersions: WerewolfDefinitionVersionsV1
  roster: WerewolfRosterEntryV1[]
  humanPlayerId: WerewolfPlayerId
  botProfiles: ReadonlyArray<{ playerId: WerewolfPlayerId; profile: WerewolfBotProfileV1 }>
  seed: number
  rngState: number
  request?: WerewolfMutationRequestV1
}

/** Durable payload of `werewolf/phase-opened`. */
export interface WerewolfPhaseOpenedV1 {
  version: 1
  gameId: WerewolfGameId
  gameRevision: number
  phaseInstanceId: WerewolfPhaseInstanceId
  phaseId: string
  phaseVersion: number
  segment: 'setup' | 'night' | 'day'
  day: number
  /** Index inside the configured segment list this occurrence sits at. */
  cursorIndex: number
  occurrence: number
  outcome: 'awaiting' | 'skipped'
  plan?: WerewolfActionPlanV1
  skipReason?: string
  rngState: number
}

/** Durable payload of `werewolf/human-action`. */
export interface WerewolfHumanActionV1 {
  version: 1
  gameId: WerewolfGameId
  gameRevision: number
  humanActionId: WerewolfHumanActionId
  phaseInstanceId: WerewolfPhaseInstanceId
  playerId: WerewolfPlayerId
  action: JsonValue
  request?: WerewolfMutationRequestV1
}

/** Durable payload of `werewolf/bot-attempt-failed`; changes no revision. */
export interface WerewolfBotAttemptFailedV1 {
  version: 1
  gameId: WerewolfGameId
  gameRevision: number
  decisionId: WerewolfDecisionId
  playerId: WerewolfPlayerId
  phaseInstanceId: WerewolfPhaseInstanceId
  attempt: number
  retryEpoch: number
  childSessionId: string
  category: WerewolfBotFailureCategoryV1
}

/** One accepted bot decision inside a `werewolf/bot-decision` event. */
export interface WerewolfDecisionEntryV1 {
  decisionId: WerewolfDecisionId
  playerId: WerewolfPlayerId
  phaseInstanceId: WerewolfPhaseInstanceId
  /** Context revision this decision started from. */
  actorContextRevision: number
  action: JsonValue
  publicSpeech?: string
  contextDelta: WerewolfBotContextDeltaV1
  contextAfter: WerewolfBotContextV1
  /** Present when the engine took a trustee action after retry exhaustion. */
  trustee?: true
}

/** Durable payload of `werewolf/bot-decision`. */
export interface WerewolfBotDecisionV1 {
  version: 1
  gameId: WerewolfGameId
  /** Revision after applying this event. */
  gameRevision: number
  /** Revision the decisions were computed from. */
  sourceGameRevision: number
  phaseInstanceId: WerewolfPhaseInstanceId
  mode: 'parallel-private' | 'seat-order-public'
  /** Entries ordered by seat; one for sequential phases, a batch for parallel. */
  entries: WerewolfDecisionEntryV1[]
}

/** Durable payload of `werewolf/phase-resolved`. */
export interface WerewolfPhaseResolvedV1 {
  version: 1
  gameId: WerewolfGameId
  gameRevision: number
  phaseInstanceId: WerewolfPhaseInstanceId
  decisionIds: readonly WerewolfDecisionId[]
  humanActionIds: readonly WerewolfHumanActionId[]
  resolution: WerewolfResolutionV1
  rngState: number
}

/** Durable payload of `werewolf/game-paused`. */
export interface WerewolfGamePausedV1 {
  version: 1
  gameId: WerewolfGameId
  gameRevision: number
  reason: WerewolfPauseReasonV1
  phaseInstanceId?: WerewolfPhaseInstanceId
  detail?: JsonValue
}

/** Durable payload of `werewolf/game-resumed`. */
export interface WerewolfGameResumedV1 {
  version: 1
  gameId: WerewolfGameId
  gameRevision: number
  retryEpoch: number
  request?: WerewolfMutationRequestV1
}

/** Durable payload of terminal `werewolf/game-ended`. */
export interface WerewolfGameEndedV1 {
  version: 1
  gameId: WerewolfGameId
  gameRevision: number
  result: WerewolfGameResultV1
  request?: WerewolfMutationRequestV1
}

/** One bot's subjective belief about one roster member. */
export interface WerewolfBeliefV1 {
  playerId: WerewolfPlayerId
  tendency: 'trusted' | 'lean-village' | 'unknown' | 'lean-wolf' | 'wolf'
  confidence: 'low' | 'medium' | 'high'
  basis: string
}

/** One public commitment a bot made, tracked to settlement. */
export interface WerewolfCommitmentV1 {
  id: string
  text: string
  status: 'active' | 'fulfilled' | 'abandoned'
}

/** The durable subjective continuity state one logical bot owns. */
export interface WerewolfBotContextV1 {
  version: 1
  gameId: WerewolfGameId
  playerId: WerewolfPlayerId
  revision: number
  profile: WerewolfBotProfileV1
  beliefs: WerewolfBeliefV1[]
  commitments: WerewolfCommitmentV1[]
  strategy: {
    objective: string
    intendedClaim?: string
    priorityTargets: WerewolfPlayerId[]
  }
  memorySummary: string
  lastDecision?: {
    decisionId: WerewolfDecisionId
    phaseId: string
    actionKind: string
  }
}

/** The bounded change a bot's decision may apply to its own context. */
export interface WerewolfBotContextDeltaV1 {
  beliefUpdates?: WerewolfBeliefV1[]
  addCommitments?: Array<{ text: string }>
  settleCommitments?: Array<{ id: string; status: 'fulfilled' | 'abandoned' }>
  strategy?: {
    objective: string
    intendedClaim?: string
    priorityTargets: WerewolfPlayerId[]
  }
  memorySummary?: string
}

/** Configured bounds for context fields; a rule set replays identically under its recorded
 * snapshot, while operators retune these for future games. */
export interface WerewolfContextLimitsV1 {
  memorySummaryChars: number
  beliefBasisChars: number
  commitmentChars: number
  strategyChars: number
  maxCommitments: number
}

/** The detached decision request one bot child receives (stage-2 contract). */
export interface WerewolfBotPromptV1 {
  version: 1
  decisionId: WerewolfDecisionId
  gameRevision: number
  contextRevision: number
  phase: {
    id: string
    day: number
    actionKind: string
  }
  self: {
    playerId: WerewolfPlayerId
    seat: number
    alive: boolean
    role: JsonValue
  }
  privateKnowledge: JsonValue
  publicState: JsonValue
  legalAction: JsonValue
  priorContext: WerewolfBotContextV1
}

/** The structured result one bot child returns (stage-2 contract). */
export interface WerewolfBotEnvelopeV1 {
  action: JsonValue
  publicSpeech?: string
  contextDelta: WerewolfBotContextDeltaV1
}

/** One public timeline entry inside the game state. */
export interface WerewolfTimelineEntryV1 {
  id: string
  day: number
  phaseId: string
  kind: 'speech' | 'announcement' | 'vote' | 'death' | 'system'
  actorId?: WerewolfPlayerId
  key: string
  data?: JsonValue
}

/** The opened phase a game currently waits on. */
export interface WerewolfOpenPhaseV1 {
  phaseInstanceId: WerewolfPhaseInstanceId
  phaseId: string
  phaseVersion: number
  segment: 'setup' | 'night' | 'day'
  day: number
  occurrence: number
  plan: WerewolfActionPlanV1
  /** Settled actors so far, in settle order. */
  settled: ReadonlyArray<{
    playerId: WerewolfPlayerId
    decisionId?: WerewolfDecisionId
    humanActionId?: WerewolfHumanActionId
  }>
}

/** One player's folded runtime state. */
export interface WerewolfPlayerRuntimeV1 {
  playerId: WerewolfPlayerId
  seat: number
  displayName: string
  human: boolean
  roleId: string
  roleVersion: number
  faction: string
  alive: boolean
  deathDay?: number
  deathCause?: string
  roleState: JsonValue
  resources: Readonly<Record<string, number>>
  notices: ReadonlyArray<WerewolfPrivateNoticeRecordV1>
}

/** The folded game state the reducer derives from werewolf events. */
export interface WerewolfGameStateV1 {
  gameId: WerewolfGameId
  status: 'running' | 'paused' | 'ended'
  revision: number
  day: number
  retryEpoch: number
  ruleSet: WerewolfRuleSetInputV1
  ruleSetDigest: string
  definitionVersions: WerewolfDefinitionVersionsV1
  humanPlayerId: WerewolfPlayerId
  players: WerewolfPlayerRuntimeV1[]
  botProfiles: Readonly<Record<string, WerewolfBotProfileV1>>
  contexts: Readonly<Record<string, WerewolfBotContextV1>>
  seed: number
  rngState: number
  /** Segment of the next occurrence to open; null before the first open. */
  segment: 'setup' | 'night' | 'day' | null
  cursorIndex: number
  occurrence: number
  /** Whether the cursor position was already consumed by a resolve or skip. */
  positionConsumed: boolean
  openPhase: WerewolfOpenPhaseV1 | null
  /** Resolutions of phases already resolved on the current day, in order. */
  sameDayResolutions: readonly WerewolfPriorResolutionV1[]
  timeline: WerewolfTimelineEntryV1[]
  /** Latest logged attempt number per decision id. */
  attempts: Readonly<Record<string, number>>
  result: WerewolfGameResultV1 | null
  pauseReason: WerewolfPauseReasonV1 | 'interrupted' | null
  /** Durable idempotency keys: `${method}\u0000${requestId}` → payload digest. */
  idempotencyKeys: ReadonlyMap<string, string>
}
