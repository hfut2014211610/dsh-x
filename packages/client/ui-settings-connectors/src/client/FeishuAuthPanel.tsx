/**
 * 卡片里的登录与权限那一段：现在是谁、有哪些权限、以及扫码再要一些。
 *
 * 机器人和用户是两种身份，页面必须把它们分开摆：机器人的权限只能在飞书开发者
 * 后台开通，扫码给不了它。把两者混成一句"权限"，人会一直扫码去要一个扫码永远
 * 拿不到的东西。
 */

import type { FeishuAuthState } from './feishu-auth-controller.ts'
import type { ConnectorsKey } from './locales.ts'
import css from './ConnectorCard.module.css'

/** 登录与权限那一段要渲染的东西和能做的动作。 */
export interface FeishuAuthPanelProps {
  /** 这一页的文案。 */
  t: (key: ConnectorsKey) => string
  state: FeishuAuthState
  /** 换一份 profile 来管。 */
  onSelectProfile: (configDir: string) => void
  /** 勾上或取消一个业务域。 */
  onSelect: (domain: string, wanted: boolean) => void
  /** 发起扫码。 */
  onBegin: () => void
  /** 放弃这次扫码。 */
  onCancel: () => void
  /** 退出本机登录。 */
  onLogout: () => void
  /** 重新读登录态。 */
  onReload: () => void
}

/** 一行「名字：值」。 */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={css.authRow}>
      <span className={css.authLabel}>{label}</span>
      <span className={css.authValue}>{children}</span>
    </div>
  )
}

/**
 * 渲染登录与权限。
 * @param props - 文案、状态与动作。
 * @returns 这一段。
 */
export function FeishuAuthPanel(props: FeishuAuthPanelProps) {
  const { t, state } = props
  const status = state.status
  // 选中的不是 dsh 自己那份：这一段的每个动作都会落到别人的应用上。
  const foreign = state.configDir !== '' && state.configDir !== state.owned
  // 还没绑应用的 profile 没有可授权的对象，扫码在这里毫无意义。
  const unconfigured = status?.installed === true && status.configured === false
  // lark-cli 自己那句下一步比我们的通用措辞准，有就用它的。
  const configHint = state.status?.configHint

  if (state.phase === 'loading' || state.phase === 'idle') {
    return (
      <section className={css.auth}>
        <h4 className={css.authHeading}>{t('auth.heading')}</h4>
        <p className={css.hint}>{t('auth.loading')}</p>
      </section>
    )
  }

  return (
    <section className={css.auth}>
      <h4 className={css.authHeading}>{t('auth.heading')}</h4>

      {/* 装不装 lark-cli 是第一道分岔：没装的话下面每一个按钮都点不动，
          与其把它们摆出来变灰，不如只说该去装什么。 */}
      {status?.installed === false
        ? <p className={css.absent} role="status">{t('auth.absent')}</p>
        : (
          <>
            {/* 作用在哪个应用上，是这一页最要紧的一句话，所以它排在最前面。
                这台机器上的默认那份往往属于别的工具，授权会加到它头上、退出
                登录会把它踢下线——所以选中别人的那份时要明说。 */}
            <div className={css.authRow}>
              <span className={css.authLabel}>{t('auth.profile')}</span>
              <span className={css.authValue}>
                <select
                  className={css.select}
                  value={state.configDir}
                  disabled={state.busy}
                  onChange={(event) => { props.onSelectProfile(event.target.value) }}
                >
                  {state.profiles.map(profile => (
                    <option key={profile.configDir} value={profile.owned ? '' : profile.configDir}>
                      {profile.name}
                      {profile.appId === undefined ? '' : ` · ${profile.appId}`}
                    </option>
                  ))}
                </select>
              </span>
            </div>
            <p className={foreign ? css.failed : css.hint} role={foreign ? 'status' : undefined}>
              {t(foreign ? 'auth.profileForeign' : 'auth.profileOwned')}
            </p>

            {status?.appId === undefined ? null : (
              <Row label={t('auth.app')}><code className={css.reason}>{status.appId}</code></Row>
            )}

            {status?.bot === undefined ? null : (
              <>
                <Row label={t('auth.bot')}>
                  <span data-ok={status.bot.available ? '' : undefined}>{status.bot.status}</span>
                </Row>
                <p className={css.hint}>{t('auth.botHint')}</p>
              </>
            )}

            <Row label={t('auth.user')}>
              {status?.user === undefined
                ? t('auth.userNone')
                : status.user.userName ?? status.user.openId ?? status.user.status}
            </Row>
            {status?.user === undefined ? null : (
              <>
                <Row label="">
                  <span className={css.authCount}>{status.user.scopes.length}</span>
                  {` ${t('auth.scopes')}`}
                </Row>
                {status.user.expiresAt === undefined ? null : (
                  <Row label={t('auth.expires')}>{status.user.expiresAt}</Row>
                )}
                {status.user.refreshExpiresAt === undefined ? null : (
                  <Row label={t('auth.refreshExpires')}>{status.user.refreshExpiresAt}</Row>
                )}
              </>
            )}

            {unconfigured ? (
              <>
                <p className={css.absent} role="status">{t('auth.unconfigured')}</p>
                <p className={css.hint}>{configHint ?? t('auth.unconfiguredHint')}</p>
              </>
            ) : null}

            {/* 二维码在场的时候，权限勾选就不该再动了：这次要什么已经写进那张
                码里，改勾选不会改变它，只会让人以为改了。 */}
            {unconfigured ? null : state.challenge === undefined
              ? (
                <>
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
                  <p className={css.hint}>{t('auth.domainsHint')}</p>
                </>
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
              {unconfigured
                ? null
                : state.challenge === undefined
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
              <button type="button" className={css.discard} onClick={props.onReload}>
                {t('auth.reload')}
              </button>
              {status?.user === undefined ? null : (
                <button type="button" className={css.discard} disabled={state.busy} onClick={props.onLogout}>
                  {t('auth.logout')}
                </button>
              )}
            </div>
            {status?.user === undefined ? null : <p className={css.hint}>{t('auth.logoutHint')}</p>}
          </>
        )}
    </section>
  )
}
