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
  const base: FeishuCardState = {
    ...settled,
    plugin: running,
    auth: signedIn,
    bridge: { connected: false },
    ready: false,
    mode: field(''),
    profileId: field('dsh'),
    appId: field(''),
    eventCommand: field(''),
    workspace: field(''),
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
    settingsOpen: false,
    setupOpen: false,
    confirmingReset: false,
  }

  /** 接好了的样子：走 direct，扫过码，桥接也在跑。 */
  const ready: Partial<FeishuCardState> = {
    ready: true,
    mode: field('direct'),
    auth: { ...signedIn, status: { ...signedIn.status, user: { ...signedIn.status?.user, scopes: ['im:message'] } } } as FeishuAuthState,
    bridge: { connected: true, bridge: { apps: ['/lark/dsh'], dmMode: 'disabled', dmAllowed: 0, groupsAllowed: 0, requireMention: true } },
  }

  function cardProps(over: Partial<FeishuCardState>, actions: Record<string, unknown> = {}): FeishuCardProps {
    return {
      t,
      useFeishuCard: (selector: (value: FeishuCardState) => unknown) => selector({ ...base, ...over }),
      edit: vi.fn(),
      resetField: vi.fn(),
      readPresence: vi.fn(),
      setEnabled: vi.fn(),
      readAuth: vi.fn(),
      selectDomain: vi.fn(),
      bindApp: vi.fn(),
      beginAuth: vi.fn(),
      cancelAuth: vi.fn(),
      reopenSetup: vi.fn(),
      toggleSettings: vi.fn(),
      reset: vi.fn(),
      save: vi.fn(),
      discard: vi.fn(),
      ...actions,
    } as unknown as FeishuCardProps
  }

  // 还没接入时摆一屏参数，等于让人调一个还不存在的东西；而常规那条路
  // （自己的应用、扫个码）会被只跟另一条有关的选项埋掉。
  describe('还没接入', () => {
    it('只问怎么接，别的都不摆', () => {
      render(<FeishuCard {...cardProps({})} />)
      open()

      expect(screen.getAllByRole('radio')).toHaveLength(2)
      expect(screen.queryByText(zh['feishu.settings.title'])).toBeNull()
      expect(screen.queryByText(zh['feishu.status.title'])).toBeNull()
      expect(screen.queryByLabelText(zh['feishu.profileId.label'])).toBeNull()
    })

    it('选了直接接入才问用哪个 profile', () => {
      render(<FeishuCard {...cardProps({ mode: field('direct') })} />)
      open()

      expect(screen.getByLabelText(zh['feishu.profileId.label'])).toBeTruthy()
      expect(screen.queryByLabelText(zh['feishu.appId.label'])).toBeNull()
    })

    it('选了第三方桥接才问 app id 和事件命令', () => {
      render(<FeishuCard {...cardProps({ mode: field('bridge') })} />)
      open()

      expect(screen.getByLabelText(zh['feishu.appId.label'])).toBeTruthy()
      expect(screen.getByLabelText(zh['feishu.eventCommand.label'])).toBeTruthy()
      expect(screen.queryByLabelText(zh['feishu.profileId.label'])).toBeNull()
    })

    // 名字已经说明白了，头上再挂一句「单聊发一句话就干活」是往控件路上多一样
    // 要读过去的东西。
    it('卡片头上不挂描述', () => {
      render(<FeishuCard {...cardProps({})} />)

      expect(screen.queryByText(zh['feishu.summary'])).toBeNull()
    })

    // 没有应用就没有可授权的对象——所以「扫码授权」之前还有一步：先建一个。
    // 少了它，选完 A 的人看到的是一句"还没有应用"和无处可点。
    it('profile 还没有应用时，先给一个创建应用', () => {
      const unbound = {
        ...signedIn,
        status: { installed: true, configured: false },
      } as FeishuAuthState
      const bindApp = vi.fn()
      render(<FeishuCard {...cardProps({ mode: field('direct'), auth: unbound }, { bindApp })} />)
      open()

      expect(screen.getByText(zh['auth.unconfigured'])).toBeTruthy()
      expect(screen.queryByRole('button', { name: zh['auth.scan'] })).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: zh['auth.bind'] }))

      expect(bindApp).toHaveBeenCalled()
    })

    // 建应用和扫码授权是同一个形状，所以二维码那一段两步共用。
    it('建应用也出二维码', () => {
      const binding = {
        ...signedIn,
        status: { installed: true, configured: false },
        challenge: { verificationUrl: 'https://accounts.feishu.cn/x', qrDataUrl: 'data:image/png;base64,AAA' },
      } as FeishuAuthState
      render(<FeishuCard {...cardProps({ mode: field('direct'), auth: binding })} />)
      open()

      expect(screen.getByAltText(zh['auth.scan'])).toBeTruthy()
      expect(screen.getByRole('link', { name: zh['auth.openLink'] })).toBeTruthy()
    })

    // `config init` 建完应用之后 lark-cli 已经有一条 0 权限的用户记录。只看
    // "有没有账号"的话，卡片会认为接好了，把授权那一步整个藏掉——而那正是
    // 下一步要做的事。
    it('建完应用还没授权，不算接好', () => {
      const bound = {
        ...signedIn,
        status: {
          installed: true,
          configured: true,
          appId: 'cli_new',
          user: { status: 'ready', available: true, message: '', scopes: [] },
        },
      } as FeishuAuthState

      render(<FeishuCard {...cardProps({ mode: field('direct'), auth: bound, ready: false })} />)
      open()

      expect(screen.getByRole('button', { name: zh['auth.scan'] })).toBeTruthy()
      expect(screen.queryByText(zh['feishu.status.title'])).toBeNull()
    })

    it('选哪条路要写进设置', () => {
      const edit = vi.fn()
      render(<FeishuCard {...cardProps({}, { edit })} />)
      open()

      fireEvent.click(screen.getByRole('radio', { name: new RegExp(zh['feishu.mode.bridge']) }))

      expect(edit).toHaveBeenCalledWith('mode', 'bridge')
    })

    // 扫码只属于「自己的应用」那条路；第三方那条根本没有可扫的东西。
    it('扫码那一段只跟着直接接入出现', () => {
      render(<FeishuCard {...cardProps({ mode: field('direct') })} />)
      open()
      expect(screen.getByText(zh['auth.domains'])).toBeTruthy()
      cleanup()

      render(<FeishuCard {...cardProps({ mode: field('bridge') })} />)
      open()
      expect(screen.queryByText(zh['auth.domains'])).toBeNull()
    })
  })

  describe('接好了', () => {
    it('摆状态，收起设置，给两个动作', () => {
      render(<FeishuCard {...cardProps(ready)} />)
      open()

      expect(screen.getByText(zh['feishu.status.title'])).toBeTruthy()
      expect(screen.getByText(zh['feishu.status.bridgeOn'])).toBeTruthy()
      expect(screen.getByRole('button', { name: zh['feishu.action.reconfigure'] })).toBeTruthy()
      expect(screen.getByRole('button', { name: zh['feishu.action.reset'] })).toBeTruthy()
    })

    // 两条路本质不冲突，A 接完了也得能改去 B——所以那个动作叫「更改接入方式」，
    // 而且两边的配置各自留着，来回切不丢东西。
    it('接好了也能回去改接入方式', () => {
      const reopenSetup = vi.fn()
      render(<FeishuCard {...cardProps(ready, { reopenSetup })} />)
      open()

      fireEvent.click(screen.getByRole('button', { name: zh['feishu.action.reconfigure'] }))

      expect(reopenSetup).toHaveBeenCalled()
    })

    it('接入那一段收起来了，除非自己点开', () => {
      render(<FeishuCard {...cardProps(ready)} />)
      open()
      expect(screen.queryByRole('radio')).toBeNull()
      cleanup()

      render(<FeishuCard {...cardProps({ ...ready, setupOpen: true })} />)
      open()
      expect(screen.getAllByRole('radio')).toHaveLength(2)
    })

    it('会话设置默认折着，点开才有', () => {
      render(<FeishuCard {...cardProps(ready)} />)
      open()
      expect(screen.getByText(zh['feishu.settings.title'])).toBeTruthy()
      expect(screen.queryByLabelText(zh['feishu.workspace.label'])).toBeNull()
      cleanup()

      render(<FeishuCard {...cardProps({ ...ready, settingsOpen: true })} />)
      open()
      expect(screen.getByLabelText(zh['feishu.workspace.label'])).toBeTruthy()
      expect(screen.getByLabelText(zh['feishu.dmMode.label'])).toBeTruthy()
    })

    it('展开之后每个字段都能改', () => {
      const edit = vi.fn()
      render(<FeishuCard {...cardProps({ ...ready, settingsOpen: true }, { edit })} />)
      open()

      fireEvent.change(screen.getByLabelText(zh['feishu.workspace.label']), { target: { value: 'D:\\proj' } })
      fireEvent.change(screen.getByLabelText(zh['feishu.dmMode.label']), { target: { value: 'open' } })

      expect(edit.mock.calls).toEqual([['workspace', 'D:\\proj'], ['dmMode', 'open']])
    })

    // 注销要把飞书那边的登录态也退掉，而设置页不该弹系统对话框问人，所以
    // 第一次点只是待命。
    it('注销要点两次', () => {
      const reset = vi.fn()
      render(<FeishuCard {...cardProps(ready, { reset })} />)
      open()
      fireEvent.click(screen.getByRole('button', { name: zh['feishu.action.reset'] }))
      expect(reset).toHaveBeenCalledTimes(1)
      cleanup()

      render(<FeishuCard {...cardProps({ ...ready, confirmingReset: true })} />)
      open()
      expect(screen.getByRole('button', { name: zh['feishu.action.resetConfirm'] })).toBeTruthy()
    })

    // 默认拒绝是不出声的：渠道开着、授权也给了、桥接也在跑，就是没人能用。
    it('没人能用要说破', () => {
      render(<FeishuCard {...cardProps({ ...ready, reach: 'nobody' })} />)
      open()

      expect(screen.getByText(zh['feishu.reach.nobody'])).toBeTruthy()
    })

    it('通了也说一声', () => {
      render(<FeishuCard {...cardProps({ ...ready, reach: 'both' })} />)
      open()

      expect(screen.getByText(zh['feishu.reach.both'])).toBeTruthy()
      expect(screen.queryByText(zh['feishu.reach.nobody'])).toBeNull()
    })

    it('桥接没在跑要看得出来', () => {
      render(<FeishuCard {...cardProps({ ...ready, bridge: { connected: false } })} />)
      open()

      expect(screen.getByText(zh['feishu.status.bridgeOff'])).toBeTruthy()
    })
  })
})
