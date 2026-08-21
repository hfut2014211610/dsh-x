/**
 * The pure definition registries behind `ctx.werewolf`: rule sets, roles,
 * phases, and victory conditions, each keyed by exact id and version. The
 * registry holds no Cordis state; `WerewolfRuntime` wraps registration in
 * fiber effects. Duplicate identifiers at one version fail at registration.
 * @module @deepseek-ai/dsh-werewolf/registry
 */

import { WerewolfError } from './error.ts'
import type {
  WerewolfPhaseDefinition,
  WerewolfRoleDefinition,
  WerewolfRuleSetInputV1,
  WerewolfVictoryConditionDefinition,
} from './types.ts'

/**
 * Stable key for one definition at one exact version.
 *
 * @param id - the definition identifier.
 * @param version - the exact definition version.
 * @returns the `${id}@${version}` key.
 */
export function definitionKey(id: string, version: number): string {
  return `${id}@${version}`
}

/**
 * The four trusted registries rule compilation resolves against.
 */
export class WerewolfRegistry {
  private readonly roles = new Map<string, WerewolfRoleDefinition>()
  private readonly phases = new Map<string, WerewolfPhaseDefinition>()
  private readonly victory = new Map<string, WerewolfVictoryConditionDefinition>()
  private readonly ruleSets = new Map<string, WerewolfRuleSetInputV1>()

  /**
   * Register one role version.
   *
   * @param definition - the role definition to register.
   * @returns a disposer removing exactly this registration.
   */
  registerRole(definition: WerewolfRoleDefinition): () => void {
    return this.add(this.roles, 'role', definition.id, definition.version, definition)
  }

  /**
   * Register one phase version.
   *
   * @param definition - the phase definition to register.
   * @returns a disposer removing exactly this registration.
   */
  registerPhase(definition: WerewolfPhaseDefinition): () => void {
    return this.add(this.phases, 'phase', definition.id, definition.version, definition)
  }

  /**
   * Register one victory-condition version.
   *
   * @param definition - the victory-condition definition to register.
   * @returns a disposer removing exactly this registration.
   */
  registerVictoryCondition(definition: WerewolfVictoryConditionDefinition): () => void {
    return this.add(this.victory, 'victory condition', definition.id, definition.version, definition)
  }

  /**
   * Register one rule-set revision. The `{ id, revision }` pair is immutable:
   * registering a different record for a live pair is a duplicate failure.
   *
   * @param input - the parsed rule-set input.
   * @returns a disposer removing exactly this registration.
   */
  registerRuleSet(input: WerewolfRuleSetInputV1): () => void {
    return this.add(this.ruleSets, 'rule set', input.id, input.revision, input)
  }

  /**
   * Look up one role at an exact version.
   *
   * @param id - the role identifier.
   * @param version - the exact role version.
   * @returns the registered definition, when present.
   */
  getRole(id: string, version: number): WerewolfRoleDefinition | undefined {
    return this.roles.get(definitionKey(id, version))
  }

  /**
   * Look up one phase at an exact version.
   *
   * @param id - the phase identifier.
   * @param version - the exact phase version.
   * @returns the registered definition, when present.
   */
  getPhase(id: string, version: number): WerewolfPhaseDefinition | undefined {
    return this.phases.get(definitionKey(id, version))
  }

  /**
   * Look up one victory condition at an exact version.
   *
   * @param id - the condition identifier.
   * @param version - the exact condition version.
   * @returns the registered definition, when present.
   */
  getVictoryCondition(id: string, version: number): WerewolfVictoryConditionDefinition | undefined {
    return this.victory.get(definitionKey(id, version))
  }

  /**
   * Look up one rule set at an exact revision.
   *
   * @param id - the rule-set identifier.
   * @param revision - the exact rule-set revision.
   * @returns the registered input, when present.
   */
  getRuleSet(id: string, revision: number): WerewolfRuleSetInputV1 | undefined {
    return this.ruleSets.get(definitionKey(id, revision))
  }

  /**
   * Every registered role definition, keyed `${id}@${version}`.
   *
   * @returns the registered role definitions.
   */
  listRoles(): ReadonlyMap<string, WerewolfRoleDefinition> {
    return this.roles
  }

  /**
   * Every registered phase definition, keyed `${id}@${version}`.
   *
   * @returns the registered phase definitions.
   */
  listPhases(): ReadonlyMap<string, WerewolfPhaseDefinition> {
    return this.phases
  }

  /**
   * Every registered victory condition, keyed `${id}@${version}`.
   *
   * @returns the registered victory conditions.
   */
  listVictoryConditions(): ReadonlyMap<string, WerewolfVictoryConditionDefinition> {
    return this.victory
  }

  /**
   * Every registered rule-set input, keyed `${id}@${revision}`.
   *
   * @returns the registered rule-set inputs.
   */
  listRuleSets(): ReadonlyMap<string, WerewolfRuleSetInputV1> {
    return this.ruleSets
  }

  private add<V>(
    map: Map<string, V>,
    kind: string,
    id: string,
    version: number,
    value: V,
  ): () => void {
    const key = definitionKey(id, version)
    if (map.has(key)) {
      throw new WerewolfError(
        'WEREWOLF_DUPLICATE_REGISTRATION',
        `werewolf ${kind} ${key} is already registered`,
      )
    }
    map.set(key, value)
    return () => {
      if (map.get(key) === value) map.delete(key)
    }
  }
}
