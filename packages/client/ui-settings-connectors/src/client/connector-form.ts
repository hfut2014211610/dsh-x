/**
 * Staged form model behind one connector card.
 *
 * A card holds what the user types and writes it only when they save. Every
 * settings write is a durable, revision-fenced document mutation, so a control
 * that committed as it settled would turn one keystroke into a write nobody
 * asked for and could not preview.
 *
 * A field shows its effective value — user layer over composition layer over
 * schema default — and whether the user layer carries it. That presence, not a
 * value comparison, is what marks a field overridden: an override equal to the
 * composition default is still an override.
 *
 * The plugins section reached the same conclusions for its own cards, and the
 * two models stay separate because the client bundle purity gate forbids value
 * imports across plugin packages. This one carries less: a connector keeps its
 * credentials outside the settings document, so there is no write-only control
 * here.
 */

import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** The write one field's staged text performs when the card is saved. */
export type FieldWrite =
  | { kind: 'set'; value: unknown }
  | { kind: 'clear' }

/** How one section field converts between its stored value and its draft text. */
export interface ConnectorFieldSpec {
  /** Field name inside the namespace section. */
  field: string
  /** Render a stored value as draft text; the empty string when the section carries none. */
  format: (value: unknown) => string
  /**
   * The write this draft text stages, or undefined when the text is not a
   * value the field takes — which blocks the save rather than discarding it.
   */
  parse: (text: string) => FieldWrite | undefined
}

/** One field as a card's control renders it. */
export interface ConnectorFieldState {
  /** Draft text the control renders. */
  text: string
  /** Whether saving would leave a user-layer entry for this field. */
  overridden: boolean
  /** Whether the draft is not a value the field takes, which blocks saving. */
  invalid: boolean
}

/** Card-level state every connector card renders from. */
export interface ConnectorFormState {
  /**
   * `loading` until the first host view, `ready` once the namespace serves a
   * section, and `absent` when this deployment composes no plugin owning it.
   */
  status: 'loading' | 'ready' | 'absent'
  /** Whether the host document takes writes. */
  writable: boolean
  /** Whether the form holds edits a save would write. */
  dirty: boolean
  /** Whether any staged draft is invalid, which blocks the save. */
  invalid: boolean
  /** Whether a save is crossing the wire. */
  saving: boolean
  /** Whether the last save did not land as staged; cleared by the next edit or save. */
  failed: boolean
}

/** The write actions a connector card's slot entry injects. */
export interface ConnectorActions {
  /** Stage draft text for one field. */
  edit: (field: string, text: string) => void
  /** Stage a clear, so saving lets the field re-inherit the composition layer. */
  resetField: (field: string) => void
  /** Write every staged edit, then re-seed from what the host took. */
  save: () => void
  /** Drop every staged edit. */
  discard: () => void
}

/**
 * Whether the host holds the value that was written.
 *
 * Reference equality is not enough: a list field writes an array, and the
 * value read back out of the document is a different object with the same
 * entries. Comparing by reference would report every list save as refused
 * while it in fact landed, so the form would keep drafts nobody needs to fix.
 * @param stored - what the user layer holds now.
 * @param written - what the save wrote.
 * @returns whether they are the same value.
 */
function sameValue(stored: unknown, written: unknown): boolean {
  if (stored === written) return true
  if (Array.isArray(stored) && Array.isArray(written)) {
    return stored.length === written.length
      && stored.every((item, index) => sameValue(item, written[index]))
  }
  return false
}

/** One field's staged edit. */
interface StagedEdit {
  /** Draft text the control renders. */
  text: string
  /** True when this edit clears the field whatever text it shows. */
  clear: boolean
}

/** One staged edit resolved into the write a save performs. */
interface PlannedWrite {
  /** Field this entry writes. */
  field: string
  /**
   * Perform the write and report whether the host holds the staged value
   * afterwards; undefined when the draft is not a value the field takes.
   */
  run: (() => Promise<boolean>) | undefined
}

/**
 * A free-text field. An empty draft clears the field, so emptying the control
 * and saving is the same gesture as resetting it.
 * @param field - field name inside the namespace section.
 * @returns the field's conversion spec.
 */
export function textField(field: string): ConnectorFieldSpec {
  return {
    field,
    format: value => typeof value === 'string' ? value : '',
    parse: (text) => {
      const trimmed = text.trim()
      return trimmed === '' ? { kind: 'clear' } : { kind: 'set', value: trimmed }
    },
  }
}

/**
 * A whole-number field. An empty draft clears the field; anything else that is
 * not a non-negative whole number blocks the save, because every numeric field
 * a connector carries is a duration in milliseconds.
 * @param field - field name inside the namespace section.
 * @returns the field's conversion spec.
 */
export function durationField(field: string): ConnectorFieldSpec {
  return {
    field,
    format: value => typeof value === 'number' ? String(value) : '',
    parse: (text) => {
      const trimmed = text.trim()
      if (trimmed === '') return { kind: 'clear' }
      const parsed = Number(trimmed)
      if (!Number.isInteger(parsed) || parsed < 0) return undefined
      return { kind: 'set', value: parsed }
    },
  }
}

/**
 * A list-of-strings field, one entry per line. An empty draft clears it.
 *
 * Commas split too, because a list pasted from a config file or a chat message
 * arrives comma-separated as often as newline-separated, and a control that
 * silently treats `a, b` as one entry is a bug the user cannot see. Entries are
 * deduplicated: for the lists these cards carry — subscribed apps, allowlisted
 * chats — a repeat is never meaningful and sometimes harmful.
 * @param field - field name inside the namespace section.
 * @returns the field's conversion spec.
 */
export function listField(field: string): ConnectorFieldSpec {
  return {
    field,
    format: value => Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string').join('\n')
      : '',
    parse: (text) => {
      const items = [...new Set(text.split(/[\n,]/).map(item => item.trim()).filter(item => item !== ''))]
      return items.length === 0 ? { kind: 'clear' } : { kind: 'set', value: items }
    },
  }
}

/**
 * A yes/no field. The empty draft clears it, so the control's blank option is
 * what re-inherits the composition layer — same shape as {@link choiceField},
 * because a checkbox has no way to show "not set here".
 * @param field - field name inside the namespace section.
 * @returns the field's conversion spec.
 */
export function toggleField(field: string): ConnectorFieldSpec {
  return {
    field,
    format: value => typeof value === 'boolean' ? String(value) : '',
    parse: (text) => {
      if (text === '') return { kind: 'clear' }
      if (text === 'true' || text === 'false') return { kind: 'set', value: text === 'true' }
      return undefined
    },
  }
}

/**
 * A fixed-choice field. The control offers exactly these values, so a draft
 * outside them can only come from a stale registration and blocks the save.
 * @param field - field name inside the namespace section.
 * @param choices - the values this field takes.
 * @returns the field's conversion spec.
 */
export function choiceField(field: string, choices: readonly string[]): ConnectorFieldSpec {
  return {
    field,
    format: value => typeof value === 'string' && choices.includes(value) ? value : '',
    parse: (text) => {
      if (text === '') return { kind: 'clear' }
      return choices.includes(text) ? { kind: 'set', value: text } : undefined
    },
  }
}

/**
 * Stages one connector's edits over one settings namespace and writes them on save.
 *
 * The form publishes through a snapshot store because slot components read
 * through a snapshot selector, while both the scope and the local drafts move
 * underneath; every projection is rebuilt from the two together.
 */
export class ConnectorForm<T> {
  private readonly specs: Map<string, ConnectorFieldSpec>
  private readonly staged = new Map<string, StagedEdit>()
  private readonly listeners = new Set<() => void>()
  private saving = false
  private failed = false

  /**
   * @param scope - the bound settings scope for this connector's namespace.
   * @param specs - the section fields this card edits.
   */
  constructor(private readonly scope: SettingsScope<T>, specs: readonly ConnectorFieldSpec[]) {
    this.specs = new Map(specs.map(spec => [spec.field, spec]))
    scope.subscribe(() => { this.publish() })
  }

  /**
   * Publish a projection of this form, rebuilt whenever the scope or a draft changes.
   * @param project - build the card's state from the form's current reads.
   * @returns the store the card's component reads through its bound selector.
   */
  bind<S>(project: () => S): SnapshotStore<S> {
    const store = createSnapshotStore(project())
    this.listeners.add(() => { store.set(project()) })
    return store
  }

  /**
   * Run something whenever the scope or a draft changes.
   *
   * For the follow-on work a change implies but a projection must not do: a
   * projection can be rebuilt at any time and has to stay free of effects.
   * @param listener - what to run after each change.
   */
  watch(listener: () => void): void {
    this.listeners.add(listener)
  }

  /**
   * Read the card-level state: what the host serves, and what a save would do.
   * @returns the form state the card renders from.
   */
  state(): ConnectorFormState {
    const snapshot = this.scope.getSnapshot()
    const plan = this.plan()
    return {
      status: snapshot.status === 'unavailable' ? 'absent' : snapshot.status,
      writable: snapshot.writable,
      dirty: plan.length > 0,
      invalid: plan.some(item => item.run === undefined),
      saving: this.saving,
      failed: this.failed,
    }
  }

  /**
   * Read one control's state.
   * @param field - field name of a section field this card declared.
   * @returns the draft text, whether a save would leave an override, and whether it is invalid.
   */
  field(field: string): ConnectorFieldState {
    const spec = this.spec(field)
    const staged = this.staged.get(field)
    if (staged === undefined) {
      return { text: spec.format(this.sectionValue(field)), overridden: this.stored(field), invalid: false }
    }
    const write = staged.clear ? { kind: 'clear' as const } : spec.parse(staged.text)
    return { text: staged.text, overridden: write?.kind === 'set', invalid: write === undefined }
  }

  /**
   * Build the edit, reset, save, and discard actions bound to this form.
   * @returns the actions a card's slot entry injects.
   */
  actions(): ConnectorActions {
    return {
      edit: (field, text) => { this.stage(field, { text, clear: false }) },
      resetField: (field) => {
        this.stage(field, { text: this.spec(field).format(this.baseValue(field)), clear: true })
      },
      save: () => { void this.save() },
      discard: () => {
        if (this.staged.size === 0 && !this.failed) return
        this.staged.clear()
        this.failed = false
        this.publish()
      },
    }
  }

  /**
   * Write every staged edit, then re-seed from what the host took.
   *
   * The host is the only authority on whether a value was accepted — its
   * validators own the constraints no schema can express — so the outcome is
   * read back from the section rather than predicted here. A save that did not
   * land keeps its drafts, so the user can correct them instead of retyping.
   * @returns settlement after every write and the read-back.
   */
  async save(): Promise<void> {
    const plan = this.plan()
    const writes = plan.flatMap(item => item.run === undefined ? [] : [item.run])
    if (plan.length === 0 || this.saving || writes.length !== plan.length) return
    this.saving = true
    this.failed = false
    this.publish()
    let landed = true
    for (const write of writes) {
      landed = await write() && landed
    }
    if (landed) this.staged.clear()
    this.saving = false
    this.failed = !landed
    this.publish()
  }

  /**
   * Every staged edit a save would write. An entry whose draft is not a value
   * its field takes carries no write: the form is still dirty, and the save
   * refuses rather than dropping the edit.
   * @returns the planned writes, in the order the fields were staged.
   */
  private plan(): PlannedWrite[] {
    const plan: PlannedWrite[] = []
    for (const [field, staged] of this.staged) {
      const spec = this.spec(field)
      if (staged.clear) {
        if (this.stored(field)) plan.push({ field, run: () => this.clear(field) })
        continue
      }
      if (staged.text === spec.format(this.sectionValue(field))) continue
      const write = spec.parse(staged.text)
      if (write === undefined) plan.push({ field, run: undefined })
      else if (write.kind === 'clear') plan.push({ field, run: () => this.clear(field) })
      else plan.push({ field, run: () => this.store(field, write.value) })
    }
    return plan
  }

  private async clear(field: string): Promise<boolean> {
    await this.scope.unset(field)
    return !this.stored(field)
  }

  private async store(field: string, value: unknown): Promise<boolean> {
    await this.scope.set(field, value)
    return sameValue(this.userLayer()?.[field], value)
  }

  private stage(field: string, edit: StagedEdit): void {
    this.staged.set(field, edit)
    this.failed = false
    this.publish()
  }

  private spec(field: string): ConnectorFieldSpec {
    const spec = this.specs.get(field)
    // Every call site names a field this card declared; a missing one is a
    // wiring mistake that must not degrade into a silently inert control.
    if (spec === undefined) throw new Error(`connector card has no field ${field}`)
    return spec
  }

  private snapshotOf(): SettingsScopeSnapshot<T> {
    return this.scope.getSnapshot()
  }

  private sectionValue(field: string): unknown {
    return (this.snapshotOf().value as Record<string, unknown> | undefined)?.[field]
  }

  private baseValue(field: string): unknown {
    return (this.snapshotOf().base as Record<string, unknown> | undefined)?.[field]
  }

  private userLayer(): Record<string, unknown> | undefined {
    return this.snapshotOf().user as Record<string, unknown> | undefined
  }

  private stored(field: string): boolean {
    const user = this.userLayer()
    return user !== undefined && Object.hasOwn(user, field)
  }

  private publish(): void {
    for (const listener of this.listeners) listener()
  }
}
