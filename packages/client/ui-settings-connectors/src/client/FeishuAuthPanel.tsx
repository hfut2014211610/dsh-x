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

  if (unconfigured) {
    return (
      <section className={css.auth}>
        <p className={css.absent} role="status">{t('auth.unconfigured')}</p>
        {/* lark-cli 自己那句下一步是写给 agent harness 看的，一长串英文，
            不往人脸上摆。 */}
        <p className={css.hint}>{t('auth.unconfiguredHint')}</p>
        <div className={css.authActions}>
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
        )}

      {state.granted ? <p className={css.authGranted} role="status">{t('auth.granted')}</p> : null}
      {state.error === undefined ? null : <p className={css.failed} role="status">{state.error}</p>}

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
