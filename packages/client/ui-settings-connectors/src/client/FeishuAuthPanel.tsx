/**
 * 扫码那一段：勾要开通的权限，扫一张码，完事。
 *
 * 这里只放**扫码这件事本身**。身份、权限数、桥接连没连上都归卡片的状态区，
 * 因为那些是"接好了以后"的事，而这一段只在还没接好、或者人主动要重扫的时候
 * 才出现。
 */

import type { FeishuAuthState } from './feishu-auth-controller.ts'
import type { ConnectorsKey } from './locales.ts'
import css from './ConnectorCard.module.css'

/** 这一段要渲染的东西和能做的动作。 */
export interface FeishuAuthPanelProps {
  /** 这一页的文案。 */
  t: (key: ConnectorsKey) => string
  state: FeishuAuthState
  /** 勾上或取消一个业务域。 */
  onSelect: (domain: string, wanted: boolean) => void
  /** 给这份 profile 建一个飞书应用。 */
  onBind: () => void
  /** 发起扫码。 */
  onBegin: () => void
  /** 放弃这次扫码。 */
  onCancel: () => void
  /** 重新读登录态。 */
  onReload: () => void
}

/**
 * 渲染扫码那一段。
 * @param props - 文案、状态与动作。
 * @returns 这一段。
 */
export function FeishuAuthPanel(props: FeishuAuthPanelProps) {
  const { t, state } = props
  const status = state.status
  // 还没绑应用的 profile 没有可授权的对象，扫码在这里毫无意义。
  const unconfigured = status?.installed === true && status.configured === false

  if (state.phase === 'loading' || state.phase === 'idle') {
    return <p className={css.hint}>{t('auth.loading')}</p>
  }

  // 装不装 lark-cli 是第一道分岔：没装的话下面每一个按钮都点不动，与其把它们
  // 摆出来变灰，不如只说该去装什么。
  if (status?.installed === false) {
    return <p className={css.absent} role="status">{t('auth.absent')}</p>
  }

  // 建应用与扫码授权是同一个形状——一条链接、一张码、一段轮询——所以二维码
  // 那一段两步共用，只有上面问的问题不一样。
  const challenge = state.challenge === undefined
    ? null
    : (
      <div className={css.authChallenge}>
        {state.challenge.qrDataUrl === undefined
          ? null
          : <img className={css.authQr} src={state.challenge.qrDataUrl} alt={t('auth.scan')} />}
        <p className={css.hint}>{t('auth.qrHint')}</p>
        {/* 链接原样透传，一个字符都不改：改过的授权链接不作数。 */}
        <a
          className={css.authLink}
          href={state.challenge.verificationUrl}
          target="_blank"
          rel="noreferrer noopener"
        >
          {t('auth.openLink')}
        </a>
      </div>
    )

  const outcome = (
    <>
      {state.granted ? <p className={css.authGranted} role="status">{t('auth.granted')}</p> : null}
      {state.error === undefined ? null : <p className={css.failed} role="status">{state.error}</p>}
    </>
  )

  // 没有应用就没有可授权的对象，所以这一步在扫码之前：先建一个。
  if (unconfigured) {
    return (
      <section className={css.auth}>
        <p className={css.absent} role="status">{t('auth.unconfigured')}</p>
        {challenge}
        {outcome}
        <div className={css.authActions}>
          {state.challenge === undefined
            ? (
              <button type="button" className={css.save} disabled={state.busy} onClick={props.onBind}>
                {t(state.busy ? 'auth.binding' : 'auth.bind')}
              </button>
            )
            : (
              <button type="button" className={css.discard} onClick={props.onCancel}>
                {t('auth.cancel')}
              </button>
            )}
          <button type="button" className={css.discard} onClick={props.onReload}>
            {t('auth.reload')}
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className={css.auth}>
      {/* 二维码在场的时候权限勾选就不该再动了：这次要什么已经写进那张码里，
          改勾选不会改变它，只会让人以为改了。 */}
      {state.challenge === undefined
        ? (
          <div className={css.authDomains} role="group" aria-label={t('auth.domains')}>
            <span className={css.authLabel}>{t('auth.domains')}</span>
            <div className={css.authChips}>
              {state.domains.map(domain => (
                <label className={css.authChip} key={domain}>
                  <input
                    type="checkbox"
                    checked={state.selected.includes(domain)}
                    disabled={state.busy}
                    onChange={(event) => { props.onSelect(domain, event.target.checked) }}
                  />
                  {domain}
                </label>
              ))}
            </div>
          </div>
        )
        : challenge}

      {outcome}

      <div className={css.authActions}>
        {state.challenge === undefined
          ? (
            <button type="button" className={css.save} disabled={state.busy} onClick={props.onBegin}>
              {t(state.busy ? 'auth.scanning' : 'auth.scan')}
            </button>
          )
          : (
            <button type="button" className={css.discard} onClick={props.onCancel}>
              {t('auth.cancel')}
            </button>
          )}
      </div>
    </section>
  )
}
