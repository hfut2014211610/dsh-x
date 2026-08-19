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
import type { ConnectorPresenceState } from '../src/client/connector-presence.ts'
import type { FeishuAuthState } from '../src/client/feishu-auth-controller.ts'
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

/** Sign-in state the card tests default to: read, signed in, nothing in flight. */
const signedIn: FeishuAuthState = {
  phase: 'ready',
  profiles: [
    { configDir: '/home/me/.lark-cli/dsh-x', name: 'dsh-x', appId: 'cli_test', owned: true },
    { configDir: '/home/me/.lark-cli', name: 'default', appId: 'cli_other', owned: false },
  ],
  configDir: '',
  owned: '/home/me/.lark-cli/dsh-x',
  status: {
    configDir: '/home/me/.lark-cli/dsh-x',
    installed: true,
    configured: true,
    appId: 'cli_test',
    bot: { status: 'ready', available: true, message: '' },
    user: { status: 'ready', available: true, message: '', userName: '测试用户', scopes: ['im:message'] },
  },
  domains: ['im', 'docs'],
  selected: ['im'],
  busy: false,
  granted: false,
}

/** Presence the card tests default to: the plugin is there and running. */
const running: ConnectorPresenceState = { presence: 'enabled', busy: false, failed: false }

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

function renderCard(
  state: Partial<ConnectorFormState>,
  actions: {
    save?: () => void
    discard?: () => void
    presence?: Partial<ConnectorPresenceState>
    readPresence?: () => void
    setEnabled?: (enabled: boolean) => void
  } = {},
) {
  render(
    <ConnectorCard
      t={t}
      nameKey="feishu.name"
      summaryKey="feishu.summary"
      absentKey="feishu.absent"
      state={{ ...settled, ...state }}
      presence={{ ...running, ...actions.presence }}
      onReadPresence={actions.readPresence ?? vi.fn()}
      onSetEnabled={actions.setEnabled ?? vi.fn()}
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
    renderCard({ status: 'absent', writable: false }, { presence: { presence: 'missing' } })

    expect(screen.getByText(zh['state.missing'])).toBeTruthy()
    open()
    expect(screen.getByText(zh['feishu.absent'])).toBeTruthy()
    expect(screen.queryByText('控件')).toBeNull()
    expect(screen.queryByRole('button', { name: zh.save })).toBeNull()
    // Nothing to switch, so no switch: the install line is the whole answer.
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('says it is still checking before the first host view', () => {
    renderCard({ status: 'loading' }, { presence: { presence: 'unknown' } })

    expect(screen.getByText(zh['state.loading'])).toBeTruthy()
  })

  // The point of the switch. An installed-but-off channel used to be
  // indistinguishable from an absent one, so the card sent people to the
  // command line for something they already had.
  it('separates a switched-off channel from one that was never installed', () => {
    renderCard({ status: 'absent', writable: false }, { presence: { presence: 'disabled' } })

    expect(screen.getByText(zh['state.off'])).toBeTruthy()
    open()
    expect(screen.queryByText(zh['feishu.absent'])).toBeNull()
    expect(screen.getByText(zh['power.offNoSettings'])).toBeTruthy()
    expect(screen.getByRole<HTMLInputElement>('switch').checked).toBe(false)
  })

  // A running plugin that registers no namespace is not a switched-off one.
  // Saying it is tells the reader their channel is off while its switch reads
  // on, which is the one contradiction the card must never print.
  it('does not call a running channel switched off when it just has no settings', () => {
    renderCard({ status: 'absent', writable: false }, { presence: { presence: 'enabled' } })
    open()

    expect(screen.getByText(zh['power.noSettings'])).toBeTruthy()
    expect(screen.queryByText(zh['power.offNoSettings'])).toBeNull()
    expect(screen.getByRole<HTMLInputElement>('switch').checked).toBe(true)
  })

  it('reads the plugin tree when the card is first opened, not on mount', () => {
    const readPresence = vi.fn()
    renderCard({}, { readPresence })
    expect(readPresence).not.toHaveBeenCalled()

    open()
    expect(readPresence).toHaveBeenCalledTimes(1)
  })

  it('switches the channel off and locks the control while it is in flight', () => {
    const setEnabled = vi.fn()
    renderCard({}, { setEnabled })
    open()

    const control = screen.getByRole<HTMLInputElement>('switch')
    expect(control.checked).toBe(true)
    fireEvent.click(control)
    expect(setEnabled).toHaveBeenLastCalledWith(false)

    cleanup()
    renderCard({}, { presence: { busy: true } })
    open()
    expect(screen.getByRole<HTMLInputElement>('switch').disabled).toBe(true)
  })

  it('reports a refused switch beside the state the tree actually holds', () => {
    renderCard({}, { presence: { presence: 'enabled', failed: true } })
    open()

    expect(screen.getByText(zh['power.failed'])).toBeTruthy()
    expect(screen.getByRole<HTMLInputElement>('switch').checked).toBe(true)
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
        presence={running}
        onReadPresence={vi.fn()}
        onSetEnabled={vi.fn()}
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
        presence={running}
        onReadPresence={vi.fn()}
        onSetEnabled={vi.fn()}
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
    plugin: running,
    auth: signedIn,
    access: field('own'),
    profile: field(''),
    authFolded: false,
    bridge: { connected: false },
    presetId: field('ued'),
    density: field('standard'),
    flushMs: field('2500'),
    approvalTimeoutMs: field('300000'),
    endpoint: field(''),
    dmMode: field('allowlist'),
    dmAllowlist: field(''),
    groupAllowlist: field(''),
    requireMention: field('true'),
    staleMs: field('600000'),
    reach: 'nobody',
  }

  /** 一个连上的桥接：订着两个应用。 */
  const attached = {
    connected: true,
    bridge: {
      apps: ['/home/me/.lark-cli', '/home/me/.lark-cli/agent-bus'],
      dmMode: 'disabled',
      dmAllowed: 0,
      groupsAllowed: 0,
      requireMention: true,
    },
  }

  function cardProps(over: Partial<FeishuCardState>, actions: Record<string, unknown> = {}): FeishuCardProps {
    return {
      t,
      useFeishuCard: (selector: (value: FeishuCardState) => unknown) => selector({ ...state, ...over }),
      edit: vi.fn(),
      resetField: vi.fn(),
      readPresence: vi.fn(),
      setEnabled: vi.fn(),
      readAuth: vi.fn(),
      selectDomain: vi.fn(),
      beginAuth: vi.fn(),
      cancelAuth: vi.fn(),
      logout: vi.fn(),
      toggleAuth: vi.fn(),
      save: vi.fn(),
      discard: vi.fn(),
      ...actions,
    } as unknown as FeishuCardProps
  }

  it('edits every field its own-app setup shows', () => {
    const edit = vi.fn()
    render(<FeishuCard {...cardProps({}, { edit })} />)
    open()

    fireEvent.change(screen.getByLabelText(zh['feishu.presetId.label']), { target: { value: 'writing' } })
    fireEvent.change(screen.getByLabelText(zh['feishu.density.label']), { target: { value: 'detailed' } })
    fireEvent.change(screen.getByLabelText(zh['feishu.flushMs.label']), { target: { value: '4000' } })
    fireEvent.change(screen.getByLabelText(zh['feishu.approvalTimeoutMs.label']), { target: { value: '60000' } })
    fireEvent.change(screen.getByLabelText(zh['feishu.endpoint.label']), { target: { value: '\\\\.\\pipe\\x' } })
    fireEvent.change(screen.getByLabelText(zh['feishu.dmMode.label']), { target: { value: 'open' } })
    fireEvent.change(screen.getByLabelText(zh['feishu.groupAllowlist.label']), { target: { value: 'oc_a\noc_b' } })
    fireEvent.change(screen.getByLabelText(zh['feishu.requireMention.label']), { target: { value: 'false' } })

    expect(edit.mock.calls).toEqual([
      ['presetId', 'writing'],
      ['density', 'detailed'],
      ['flushMs', '4000'],
      ['approvalTimeoutMs', '60000'],
      ['endpoint', '\\\\.\\pipe\\x'],
      ['dmMode', 'open'],
      ['groupAllowlist', 'oc_a\noc_b'],
      ['requireMention', 'false'],
    ])
  })

  it('resets every field back to the composition layer', () => {
    const resetField = vi.fn()
    // 顺序就是屏幕上的顺序：先身份，再「谁能用」，最后「会话怎么跑」。
    const names = [
      'profile',
      'dmMode', 'dmAllowlist', 'groupAllowlist', 'requireMention', 'staleMs',
      'presetId', 'density', 'flushMs', 'approvalTimeoutMs', 'endpoint',
    ] as const
    const overridden = Object.fromEntries(names.map(name => [name, { ...state[name], overridden: true }]))
    render(<FeishuCard {...cardProps(overridden, { resetField })} />)
    open()

    for (const button of screen.getAllByRole('button', { name: zh.reset })) fireEvent.click(button)

    expect(resetField.mock.calls.flat()).toEqual([...names])
  })

  describe('两条接入方式', () => {
    // 复用时 dsh 只是那条 socket 上的一个消费端：不报身份、不声明订阅、不配置
    // 对面。这一页因此一个要填的东西都没有。
    it('复用时什么都不用填', () => {
      render(<FeishuCard {...cardProps({ access: field('reuse'), bridge: attached })} />)
      open()

      expect(screen.queryByLabelText(zh['feishu.profile.label'])).toBeNull()
      expect(screen.queryByLabelText(zh['feishu.dmMode.label'])).toBeNull()
    })

    it('单独申请要说清用哪份 profile', () => {
      render(<FeishuCard {...cardProps({ access: field('own') })} />)
      open()

      expect(screen.getByLabelText(zh['feishu.profile.label'])).toBeTruthy()
    })

    it('那份 profile 的选项来自宿主找到的那几份', () => {
      const edit = vi.fn()
      render(<FeishuCard {...cardProps({}, { edit })} />)
      open()

      fireEvent.change(screen.getByLabelText(zh['feishu.profile.label']), {
        target: { value: '/home/me/.lark-cli' },
      })

      expect(edit).toHaveBeenCalledWith('profile', '/home/me/.lark-cli')
    })

    it('选另一条要写进设置', () => {
      const edit = vi.fn()
      render(<FeishuCard {...cardProps({}, { edit })} />)
      open()

      fireEvent.click(screen.getByRole('radio', { name: new RegExp(zh['feishu.access.reuse']) }))

      expect(edit).toHaveBeenCalledWith('access', 'reuse')
    })

    // 写一个跑着的桥接永远不会读的设置，比不给这个控件更糟，所以那些字段不是
    // 置灰，是根本没有——只把桥接自己报的规矩说出来。
    it('复用时只报桥接现在的规矩', () => {
      render(<FeishuCard {...cardProps({ access: field('reuse'), bridge: attached })} />)
      open()

      expect(screen.queryByLabelText(zh['feishu.groupAllowlist.label'])).toBeNull()
      expect(screen.getByText(zh['feishu.reach.byBridge'])).toBeTruthy()
    })

    it('单独申请时准入是可以改的', () => {
      render(<FeishuCard {...cardProps({ access: field('own') })} />)
      open()

      expect(screen.getByLabelText(zh['feishu.dmMode.label'])).toBeTruthy()
      expect(screen.queryByText(zh['feishu.reach.byBridge'])).toBeNull()
    })

    it('复用时把登录那一段收起来，但留着入口', () => {
      const toggleAuth = vi.fn()
      render(<FeishuCard {...cardProps({ access: field('reuse'), authFolded: true }, { toggleAuth })} />)
      open()

      expect(screen.queryByText(zh['auth.domains'])).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: zh['auth.unfold'] }))

      expect(toggleAuth).toHaveBeenCalled()
    })
  })

  describe('桥接现在什么样', () => {
    it('没连上就说没连上，别的都不摆', () => {
      render(<FeishuCard {...cardProps({ access: field('reuse') })} />)
      open()

      expect(screen.getByText(zh['feishu.bridge.offline'])).toBeTruthy()
      expect(screen.queryByText(zh['feishu.bridge.apps'])).toBeNull()
    })

    it('连上了就把它订着什么摆出来', () => {
      render(<FeishuCard {...cardProps({ access: field('reuse'), bridge: attached })} />)
      open()

      expect(screen.getByText(zh['feishu.bridge.apps'])).toBeTruthy()
      expect(screen.getByText('/home/me/.lark-cli/agent-bus')).toBeTruthy()
    })

  })

  // 默认拒绝是不出声的：模式是"只认名单"而名单是空的，渠道开着、授权也给了、
  // 桥接也连上了，就是没有人能用。这一行是唯一说破它的地方。
  describe('谁能用', () => {
    it('谁都用不了要说出来', () => {
      render(<FeishuCard {...cardProps({ reach: 'nobody' })} />)
      open()

      expect(screen.getByText(zh['feishu.reach.nobody'])).toBeTruthy()
    })

    it('通了也说一声，免得人不确定改没改对', () => {
      render(<FeishuCard {...cardProps({ reach: 'both' })} />)
      open()

      expect(screen.getByText(zh['feishu.reach.both'])).toBeTruthy()
      expect(screen.queryByText(zh['feishu.reach.nobody'])).toBeNull()
    })
  })
})
