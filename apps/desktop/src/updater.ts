/**
 * In-app updates: find out whether a newer build was published, fetch it, and
 * hand it to the platform's installer.
 *
 * This does NOT use electron-updater, and the reason is in the packaged tree
 * rather than in taste. `electron-builder.yml` ships an explicit `files` list,
 * so the asar carries `lib/`, the preload, and the loading screen and no
 * `node_modules` at all; a runtime dependency added here would simply not be
 * in the installed app, and the first `import` would crash it. The second
 * reason is macOS: applying an update in place needs a signed app, and this
 * fork's macOS builds are unsigned, so the library's headline capability would
 * not work on the one platform it is hardest to hand-roll.
 *
 * What is left is small enough to own outright. The release list is JSON over
 * the GitHub API, so no YAML parser is needed to FIND an update; the checksum
 * that verifies the download comes from the `latest*.yml` electron-builder
 * already emits beside the installers, read with a deliberately narrow parser
 * because its shape is generated, not authored.
 *
 * Trust: every request is TLS to the release host, and the download URL is
 * only ever one this module read from that same response — never one composed
 * from user input. The checksum arrives over the same channel, so it proves
 * the bytes arrived intact, not that the release itself is trustworthy; it is
 * a corruption check, and a mismatch refuses the install rather than warning.
 * @module @deepseek-ai/dsh-desktop-shell/updater
 */

import { compareVersions } from './version.ts'

/** Where an update comes from and what this app is. */
export interface UpdateFeed {
  /** `owner/repo` whose latest release publishes the installers. */
  repository: string
  /** The running app's version. */
  currentVersion: string
  /** Platform the installer must match. */
  platform: NodeJS.Platform
}

/** Environment collaborators; every one is a seam the tests replace. */
export interface UpdaterDeps {
  fetchImpl: typeof fetch
  /** Streams a URL to a local path and returns the bytes written. */
  download: (url: string, targetPath: string, onProgress: (received: number, total: number) => void) => Promise<number>
  /** Lowercase hex SHA-512 of a local file, base64-encoded as electron-builder records it. */
  sha512: (path: string) => Promise<string>
  /** Directory downloads land in. */
  downloadDir: string
}

/** What one check found. */
export type UpdateCheck =
  | { status: 'current'; detail: string }
  | { status: 'unavailable'; detail: string }
  | { status: 'available'; version: string; assetName: string; assetUrl: string; releaseUrl: string; detail: string }

/** A downloaded, verified installer. */
export interface DownloadedUpdate {
  version: string
  /** Absolute path of the installer on disk. */
  path: string
}

/** The installer extension each platform publishes; others have no in-app path. */
const INSTALLER_SUFFIX: Partial<Record<NodeJS.Platform, string>> = {
  win32: '.exe',
  darwin: '.dmg',
}

/** The channel file electron-builder writes beside the installers. */
const CHANNEL_FILE: Partial<Record<NodeJS.Platform, string>> = {
  win32: 'latest.yml',
  darwin: 'latest-mac.yml',
}

/**
 * Read the semver out of a release tag.
 *
 * The tags in this repository are `dsh-v0.3.1`, not `v0.3.1`, which is exactly
 * the shape a stock updater's tag parser rejects. Taking the version from
 * anywhere in the tag rather than from a fixed prefix is what lets the release
 * naming stay what the release tooling already produces.
 * @param tag - the git tag a release publishes from.
 * @returns the version, or undefined when the tag carries none.
 */
export function versionFromTag(tag: string): string | undefined {
  return /(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\s*$/.exec(tag)?.[1]
}

/**
 * Reduce an artifact file name to the form both sides of the comparison agree
 * on.
 *
 * The same installer carries three different names on its way to a user. On
 * disk electron-builder writes `DeepSeek Harness Setup 0.3.2.exe` with spaces;
 * the channel file records it as `DeepSeek-Harness-Setup-0.3.2.exe` with
 * hyphens; and GitHub, which rejects spaces in asset names, serves it as
 * `DeepSeek.Harness.Setup.0.3.2.exe` with dots. Comparing any two of those
 * verbatim never matches, and a silent miss here costs a download that reports
 * itself as having no checksum to verify against.
 *
 * Collapsing the separators keeps the words, which is what actually
 * distinguishes the artifacts: the installer and the portable build differ by
 * `Setup`, not by punctuation.
 * @param name - a file name in any of the three forms.
 * @returns the comparable form.
 */
function comparableName(name: string): string {
  return name.toLowerCase().replace(/[\s._-]+/g, '-')
}

/**
 * Pull one file's SHA-512 out of an electron-builder channel file.
 *
 * A narrow reader rather than a YAML dependency: the document is generated
 * with a fixed shape (a `files:` list of `- url:` / `sha512:` / `size:`
 * entries, then the same fields repeated at the top level for the primary
 * artifact), and a checksum that fails to parse must read as absent rather
 * than as a wrong answer.
 * @param channel - verbatim `latest.yml` contents.
 * @param assetName - the installer file name to match, in any published form.
 * @returns the recorded base64 SHA-512, or undefined when the file is not listed.
 */
export function sha512FromChannel(channel: string, assetName: string): string | undefined {
  const wanted = comparableName(assetName)
  const lines = channel.split(/\r?\n/)
  let matched = false
  for (const line of lines) {
    const url = /^\s*-?\s*url:\s*(\S+)\s*$/.exec(line)
    if (url !== null) {
      // The url field percent-encodes anything the name needs escaped.
      let decoded = url[1] ?? ''
      try {
        decoded = decodeURIComponent(decoded)
      } catch {
        // A name that is not valid percent-encoding is compared as written.
      }
      matched = comparableName(decoded) === wanted
      continue
    }
    const sha = /^\s*sha512:\s*(\S+)\s*$/.exec(line)
    if (sha !== null && matched) return sha[1]
  }
  return undefined
}

/** One GitHub release asset, narrowed from the API response. */
interface ReleaseAsset { name: string; url: string }

/** Narrow the release JSON without trusting any of its shape. */
function readRelease(payload: unknown): { tag: string; htmlUrl: string; assets: ReleaseAsset[] } | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const { tag_name: tag, html_url: htmlUrl, assets } = payload as Record<string, unknown>
  if (typeof tag !== 'string' || tag === '') return undefined
  if (!Array.isArray(assets)) return undefined
  const narrowed: ReleaseAsset[] = []
  for (const asset of assets) {
    if (typeof asset !== 'object' || asset === null) continue
    const { name, browser_download_url: url } = asset as Record<string, unknown>
    if (typeof name === 'string' && typeof url === 'string') narrowed.push({ name, url })
  }
  return { tag, htmlUrl: typeof htmlUrl === 'string' ? htmlUrl : '', assets: narrowed }
}

/**
 * Ask whether a newer build is published for this platform.
 *
 * Every failure resolves to `unavailable` with its reason rather than
 * throwing: an update check runs unattended on launch, and a machine that is
 * offline, behind a proxy, or rate-limited must not turn that into an error
 * the user has to dismiss.
 * @param feed - repository, running version, platform.
 * @param deps - environment collaborators.
 * @returns what the check found.
 */
export async function checkForUpdate(feed: UpdateFeed, deps: UpdaterDeps): Promise<UpdateCheck> {
  const suffix = INSTALLER_SUFFIX[feed.platform]
  if (suffix === undefined) {
    return { status: 'unavailable', detail: `no in-app installer is published for ${feed.platform}` }
  }
  let payload: unknown
  try {
    const response = await deps.fetchImpl(`https://api.github.com/repos/${feed.repository}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) {
      return { status: 'unavailable', detail: `the release feed answered ${String(response.status)}` }
    }
    payload = await response.json()
  } catch (error) {
    return { status: 'unavailable', detail: `the release feed is unreachable (${error instanceof Error ? error.message : String(error)})` }
  }
  const release = readRelease(payload)
  if (release === undefined) return { status: 'unavailable', detail: 'the release feed returned an unreadable payload' }
  const version = versionFromTag(release.tag)
  if (version === undefined) {
    return { status: 'unavailable', detail: `the latest release tag (${release.tag}) carries no version` }
  }
  if (compareVersions(version, feed.currentVersion) <= 0) {
    return { status: 'current', detail: `${feed.currentVersion} is the latest release` }
  }
  // Windows publishes both an installer and a portable build under the same
  // suffix; only the installer can replace an installed app in place.
  const candidates = release.assets.filter(asset => asset.name.endsWith(suffix))
  const asset = candidates.find(entry => /setup/i.test(entry.name)) ?? candidates[0]
  if (asset === undefined) {
    return { status: 'unavailable', detail: `release ${version} publishes no ${suffix} installer` }
  }
  return {
    status: 'available',
    version,
    assetName: asset.name,
    assetUrl: asset.url,
    releaseUrl: release.htmlUrl,
    detail: `${version} is available (running ${feed.currentVersion})`,
  }
}

/**
 * Fetch an available update and verify the bytes that arrived.
 *
 * A release with no channel file — anything published before the update feed
 * existed — downloads without a checksum to compare against. That is reported
 * in the returned detail rather than silently accepted as verified, because
 * the difference matters to whoever is reading the log after a bad install.
 * @param update - the check result that found the update.
 * @param feed - repository and platform, for the channel file.
 * @param deps - environment collaborators.
 * @param onProgress - received/total bytes, called as the download advances.
 * @returns the verified installer path plus a log line.
 * @throws when the download fails or its checksum does not match.
 */
export async function downloadUpdate(
  update: Extract<UpdateCheck, { status: 'available' }>,
  feed: UpdateFeed,
  deps: UpdaterDeps,
  onProgress: (received: number, total: number) => void,
): Promise<DownloadedUpdate & { detail: string }> {
  const channelName = CHANNEL_FILE[feed.platform]
  let expected: string | undefined
  if (channelName !== undefined) {
    try {
      const response = await deps.fetchImpl(
        `https://github.com/${feed.repository}/releases/latest/download/${channelName}`,
        { redirect: 'follow', signal: AbortSignal.timeout(15_000) },
      )
      if (response.ok) expected = sha512FromChannel(await response.text(), update.assetName)
    } catch {
      // Left undefined: the download still happens, unverified and said so.
    }
  }
  const target = `${deps.downloadDir}/${update.assetName}`
  await deps.download(update.assetUrl, target, onProgress)
  if (expected === undefined) {
    return { version: update.version, path: target, detail: `downloaded ${update.assetName} (no checksum published to verify against)` }
  }
  const actual = await deps.sha512(target)
  if (actual !== expected) {
    throw new Error(`the downloaded ${update.assetName} does not match its published checksum`)
  }
  return { version: update.version, path: target, detail: `downloaded and verified ${update.assetName}` }
}
