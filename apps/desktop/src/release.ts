/** Immutable version identity shared by one Electron shell and its bundled dsh runtime. */

import { valid } from 'semver'
import { DESKTOP_HOST_PROTOCOL_VERSION } from './host-protocol.ts'

/** Release facts embedded in the bundled runtime descriptor. */
export interface DesktopRelease {
  readonly schemaVersion: 1
  /** Exact version used by both Electron and `@deepseek-ai/dsh`. */
  readonly version: string
  readonly hostProtocolVersion: typeof DESKTOP_HOST_PROTOCOL_VERSION
  readonly nodeVersion: string
  readonly pnpmVersion: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Trailing fork serial stamped into a packaged application version. */
const FORK_SERIAL_SUFFIX = /-x\.\d+(?:\.\d+)*$/u

/**
 * Whether a packaged application version names the same release line as a bundled runtime version.
 *
 * A fork release stamps its serial into the application version (`<upstream>-x.<serial>`) while
 * the materialized runtime keeps the upstream manifest version, so that trailing serial is
 * tolerated; every other version pair must match exactly.
 * @param appVersion - Version the installed application reports.
 * @param runtimeVersion - Version recorded in the bundled runtime descriptor.
 * @returns true when both versions name the same release line.
 */
export function forkSerialMatchesRelease(appVersion: string, runtimeVersion: string): boolean {
  return appVersion === runtimeVersion || appVersion.replace(FORK_SERIAL_SUFFIX, '') === runtimeVersion
}

/** Validate release data read from an installed or packaged filesystem resource. */
export function parseDesktopRelease(value: unknown): DesktopRelease {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.version !== 'string'
    || valid(value.version) === null || value.hostProtocolVersion !== DESKTOP_HOST_PROTOCOL_VERSION
    || typeof value.nodeVersion !== 'string' || valid(value.nodeVersion) === null
    || typeof value.pnpmVersion !== 'string' || valid(value.pnpmVersion) === null) {
    throw new Error('dsh desktop: invalid desktop release metadata')
  }
  return {
    schemaVersion: 1,
    version: value.version,
    hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
    nodeVersion: value.nodeVersion,
    pnpmVersion: value.pnpmVersion,
  }
}
