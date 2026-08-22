/**
 * Shared validation for model-authored submission fields that the runner
 * must reject before acceptance and the engine must recheck before commit.
 * @module @deepseek-ai/dsh-werewolf/submission-validation
 */

import { normalizeWerewolfText } from './bot-context.ts'
import { WerewolfError } from './error.ts'
import type { WerewolfActionSpecV1 } from './types.ts'

/**
 * Validate and normalize an optional public speech.
 *
 * @param spec - the authoritative action spec for the actor.
 * @param speech - the untrusted model-authored public speech.
 * @param speechMaxChars - the active rule set's public-speech limit.
 * @returns normalized public text, or `undefined` when no text remains.
 */
export function normalizeWerewolfPublicSpeech(
  spec: WerewolfActionSpecV1,
  speech: string | undefined,
  speechMaxChars: number,
): string | undefined {
  if (speech === undefined || speech.length === 0) return undefined
  if (spec.kind !== 'text') {
    throw new WerewolfError('WEREWOLF_ILLEGAL_ACTION', 'publicSpeech is only legal in text-speech phases')
  }
  const normalized = normalizeWerewolfText(speech)
  if (normalized.length === 0) return undefined
  if (normalized.length > speechMaxChars) {
    throw new WerewolfError('WEREWOLF_ILLEGAL_ACTION', 'publicSpeech exceeds the speechMaxChars policy')
  }
  return normalized
}
