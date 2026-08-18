// @vitest-environment jsdom
/**
 * What the Connectors page shows: the empty line when nothing registered a
 * card, an absent channel that still says how to install itself, and the save
 * footer that decides when staged edits are written.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConnectorsSection } from '../src/client/ConnectorsSection.tsx'
import type { ConnectorsSectionProps } from '../src/client/ConnectorsSection.tsx'
import { ChoiceField, ConnectorCard, ValueField } from '../src/client/ConnectorCard.tsx'
import type { ConnectorFieldProps } from '../src/client/ConnectorCard.tsx'
import { FeishuCard } from '../src/client/FeishuCard.tsx'
import type { FeishuCardProps } from '../src/client/FeishuCard.tsx'
import type { FeishuCardState } from '../src/client/feishu-card-controller.ts'
import type { ConnectorFieldState, ConnectorFormState } from '../src/client/connector-form.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: keyof typeof zh) => zh[key]

/** A settled form: nothing staged, the namespace served and writable. */
const settled: ConnectorFormState = {
  status: 'ready',
  writable: true,
  dirty: false,
  invalid: false,
  saving: false,
  failed: false,
}

/** One control's state, defaulting to an inherited value. */
function field(text: string, rest: Partial<ConnectorFieldState> = {}): ConnectorFieldState {
  return { text, overridden: false, invalid: false, ...rest }
}

function renderSection(cardCount: number) {
  const props = {
    t,
    cardCount,
    renderSlot: (name: string) => <span>{name}</span>,
  } as unknown as ConnectorsSectionProps
  render(<ConnectorsSection {...props} />)
}

function renderCard(state: Partial<ConnectorFormState>, actions: { save?: () => void; discard?: () => void } = {}) {
  render(
    <ConnectorCard
      t={t}
      nameKey="feishu.name"
      summaryKey="feishu.summary"
      absentKey="feishu.absent"
      state={{ ...settled, ...state }}
      onSave={actions.save ?? vi.fn()}
      onDiscard={actions.discard ?? vi.fn()}
    >
      <p>控件</p>
    </ConnectorCard>,
  )
}

function open(): void {
  fireEvent.click(screen.getByRole('button', { name: '展开: 飞书' }))
}

function fieldProps(state: ConnectorFieldState, rest: Partial<ConnectorFieldProps> = {}): ConnectorFieldProps {
  return {
    t,
    labelKey: 'feishu.presetId.label',
    hintKey: 'feishu.presetId.hint',
    field: state,
    disabled: false,
    onEdit: vi.fn(),
    onReset: vi.fn(),
    ...rest,
  }
}

describe('ConnectorsSection', () => {
  it('says the deployment has no connector when nothing registered a card', () => {
    renderSection(0)

    expect(screen.getByText(zh.empty)).toBeTruthy()
  })

  it('renders the card seat once a connector registered one', () => {
    renderSection(1)

    expect(screen.queryByText(zh.empty)).toBeNull()
    expect(screen.getByText('settings.connector.item')).toBeTruthy()
  })
})

describe('ConnectorCard', () => {
  it('names the channel and says it is connected before anything is opened', () => {
    renderCard({})

    expect(screen.getByText('飞书')).toBeTruthy()
    expect(screen.getByText(zh['state.on'])).toBeTruthy()
    expect(screen.queryByText('控件')).toBeNull()
  })

  it('discloses the controls and collapses again', () => {
    renderCard({})

    open()
    expect(screen.getByText('控件')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '收起: 飞书' }))
    expect(screen.queryByText('控件')).toBeNull()
  })

  it('keeps an uninstalled channel listed, with how to install it and no controls', () => {
    renderCard({ status: 'absent', writable: false })

    expect(screen.getByText(zh['state.off'])).toBeTruthy()
    open()
    expect(screen.getByText(zh['feishu.absent'])).toBeTruthy()
    expect(screen.queryByText('控件')).toBeNull()
    expect(screen.queryByRole('button', { name: zh.save })).toBeNull()
  })

  it('says it is still checking before the first host view', () => {
    renderCard({ status: 'loading' })

    expect(screen.getByText(zh['state.loading'])).toBeTruthy()
  })

  it('marks a collapsed card that holds unsaved edits', () => {
    renderCard({ dirty: true })

    expect(screen.getByText(zh.unsaved)).toBeTruthy()
  })

  it('says the document is read-only and still shows the controls', () => {
    renderCard({ writable: false })

    open()
    expect(screen.getByText(zh.readOnly)).toBeTruthy()
    expect(screen.getByText('控件')).toBeTruthy()
  })

  it('holds the save until something is staged, then writes it', () => {
    const save = vi.fn()
    const { rerender } = render(
      <ConnectorCard
        t={t}
        nameKey="feishu.name"
        summaryKey="feishu.summary"
        absentKey="feishu.absent"
        state={settled}
        onSave={save}
        onDiscard={vi.fn()}
      >
        <p>控件</p>
      </ConnectorCard>,
    )
    open()
    expect(screen.getByRole('button', { name: zh.save }).hasAttribute('disabled')).toBe(true)

    rerender(
      <ConnectorCard
        t={t}
        nameKey="feishu.name"
        summaryKey="feishu.summary"
        absentKey="feishu.absent"
        state={{ ...settled, dirty: true }}
        onSave={save}
        onDiscard={vi.fn()}
      >
        <p>控件</p>
      </ConnectorCard>,
    )
    fireEvent.click(screen.getByRole('button', { name: zh.save }))

    expect(save).toHaveBeenCalledTimes(1)
  })

  it('refuses the save while a draft is invalid', () => {
    renderCard({ dirty: true, invalid: true })

    open()
    expect(screen.getByRole('button', { name: zh.save }).hasAttribute('disabled')).toBe(true)
  })

  it('reports a save the host did not take, and keeps discard reachable', () => {
    const discard = vi.fn()
    renderCard({ dirty: true, failed: true }, { discard })

    open()
    expect(screen.getByText(zh.saveFailed)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh.discard }))
    expect(discard).toHaveBeenCalledTimes(1)
  })

  it('says a save is crossing the wire', () => {
    renderCard({ dirty: true, saving: true })

    open()
    expect(screen.getByRole('button', { name: zh.saving }).hasAttribute('disabled')).toBe(true)
  })
})

describe('ValueField', () => {
  it('reports what the user typed without rewriting it', () => {
    const onEdit = vi.fn()
    render(<ValueField {...fieldProps(field('writing'), { onEdit })} />)

    fireEvent.change(screen.getByLabelText(zh['feishu.presetId.label']), { target: { value: ' ued ' } })

    expect(onEdit).toHaveBeenLastCalledWith(' ued ')
  })

  it('marks an override and stages a clear from the reset beside it', () => {
    const onReset = vi.fn()
    render(<ValueField {...fieldProps(field('writing', { overridden: true }), { onReset })} />)

    expect(screen.getByText(zh.overridden)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh.reset }))
    expect(onReset).toHaveBeenCalledTimes(1)
  })

  it('replaces the hint with why the draft is refused', () => {
    render(<ValueField {...fieldProps(field('soon', { invalid: true }))} />)

    expect(screen.getByText(zh.invalid)).toBeTruthy()
    expect(screen.queryByText(zh['feishu.presetId.hint'])).toBeNull()
    expect(screen.getByLabelText(zh['feishu.presetId.label']).getAttribute('aria-invalid')).toBe('true')
  })

  it('hints a numeric keypad without narrowing what it takes', () => {
    render(<ValueField {...fieldProps(field('2500'))} numeric />)

    expect(screen.getByLabelText(zh['feishu.presetId.label']).getAttribute('inputmode')).toBe('numeric')
  })

  it('locks the control and the reset while the document is read-only', () => {
    render(<ValueField {...fieldProps(field('writing', { overridden: true }), { disabled: true })} />)

    expect(screen.getByLabelText(zh['feishu.presetId.label']).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: zh.reset }).hasAttribute('disabled')).toBe(true)
  })
})

describe('ChoiceField', () => {
  it('offers each choice plus the empty option that clears the field', () => {
    const onEdit = vi.fn()
    render(
      <ChoiceField
        {...fieldProps(field('standard'), {
          labelKey: 'feishu.density.label',
          hintKey: 'feishu.density.hint',
          onEdit,
        })}
        choices={[
          { value: 'compact', labelKey: 'feishu.density.compact' },
          { value: 'standard', labelKey: 'feishu.density.standard' },
        ]}
      />,
    )
    const select = screen.getByLabelText(zh['feishu.density.label']) as HTMLSelectElement

    expect(select.options).toHaveLength(3)
    expect(select.value).toBe('standard')
    fireEvent.change(select, { target: { value: 'compact' } })
    expect(onEdit).toHaveBeenLastCalledWith('compact')
  })
})

describe('FeishuCard', () => {
  const state: FeishuCardState = {
    ...settled,
    presetId: field('ued'),
    density: field('standard'),
    flushMs: field('2500'),
    approvalTimeoutMs: field('300000'),
    endpoint: field(''),
  }

  it('edits every field the channel plugin serves', () => {
    const edit = vi.fn()
    const props = {
      t,
      useFeishuCard: (selector: (value: FeishuCardState) => unknown) => selector(state),
      edit,
      resetField: vi.fn(),
      save: vi.fn(),
      discard: vi.fn(),
    } as unknown as FeishuCardProps
    render(<FeishuCard {...props} />)
    open()

    fireEvent.change(screen.getByLabelText(zh['feishu.presetId.label']), { target: { value: 'writing' } })
    fireEvent.change(screen.getByLabelText(zh['feishu.density.label']), { target: { value: 'detailed' } })
    fireEvent.change(screen.getByLabelText(zh['feishu.flushMs.label']), { target: { value: '4000' } })
    fireEvent.change(screen.getByLabelText(zh['feishu.approvalTimeoutMs.label']), { target: { value: '60000' } })
    fireEvent.change(screen.getByLabelText(zh['feishu.endpoint.label']), { target: { value: '\\\\.\\pipe\\x' } })

    expect(edit.mock.calls).toEqual([
      ['presetId', 'writing'],
      ['density', 'detailed'],
      ['flushMs', '4000'],
      ['approvalTimeoutMs', '60000'],
      ['endpoint', '\\\\.\\pipe\\x'],
    ])
  })

  it('resets every field back to the composition layer', () => {
    const resetField = vi.fn()
    const overridden = Object.fromEntries(
      (['presetId', 'density', 'flushMs', 'approvalTimeoutMs', 'endpoint'] as const)
        .map(name => [name, { ...state[name], overridden: true }]),
    )
    const props = {
      t,
      useFeishuCard: (selector: (value: FeishuCardState) => unknown) => selector({ ...state, ...overridden }),
      edit: vi.fn(),
      resetField,
      save: vi.fn(),
      discard: vi.fn(),
    } as unknown as FeishuCardProps
    render(<FeishuCard {...props} />)
    open()

    for (const button of screen.getAllByRole('button', { name: zh.reset })) fireEvent.click(button)

    expect(resetField.mock.calls.flat())
      .toEqual(['presetId', 'density', 'flushMs', 'approvalTimeoutMs', 'endpoint'])
  })
})
