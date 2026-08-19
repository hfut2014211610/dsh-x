/**
 * 桥接连上没有，以及它现在什么样。
 *
 * 复用别人的桥接时，「订了哪几个应用、谁能用」都不归 dsh 改——但**得让人看见**，
 * 否则一个开着、授权也给了、就是没人能用的渠道，从界面上完全看不出问题在哪。
 * 这些事实由桥接在握手时告诉插件，插件存在这里，设置页读它。
 *
 * 存在这里而不是读桥接的配置文件：那份文件在复用时是别人的，路径也可能不一样，
 * 而握手来的这份一定是**当前这条连接上真正生效的**那份。
 *
 * @module @personal/dsh-x-feishu/src/bridge-status
 */

import type { BridgeSummary } from './protocol.ts'

/** 设置页要显示的那点东西。 */
export interface BridgeStatusView {
  /** 桥接连上没有。没连上时下面的现状是空的。 */
  readonly connected: boolean
  /** 桥接现在的样子；没连上，或者对面是个老桥接，就没有。 */
  readonly bridge?: BridgeSummary
}

/** 握手带来的桥接现状。插件写，设置页读。 */
export class BridgeStatus {
  private view: BridgeStatusView = { connected: false }

  /**
   * 握手到了。
   * @param bridge - 桥接现状；老桥接不带这个字段。
   */
  greeted(bridge: BridgeSummary | undefined): void {
    // 没有 bridge 字段时不写这个键，而不是写一个 undefined。
    this.view = { connected: true, ...bridge === undefined ? {} : { bridge } }
  }

  /** 断了。现状一并丢掉——留着上一次的会让人以为还连着。 */
  dropped(): void {
    this.view = { connected: false }
  }

  /**
   * 现在的样子。
   * @returns 供设置页显示的视图。
   */
  read(): BridgeStatusView {
    return this.view
  }
}
