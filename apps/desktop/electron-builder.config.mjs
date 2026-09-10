import { readFileSync } from 'node:fs'
import {
  resolveDesktopAppId,
  resolveMacOSNotarizationEnvironment,
  resolveMacOSSigningEnvironment,
} from './scripts/desktop-release-environment.mjs'
import { notarizeMacOSDiskImageArtifact } from './scripts/notarize-macos-disk-images.mjs'
import { verifyMacOSSignatureAfterSign } from './scripts/verify-macos-signature.mjs'
import {
  createWindowsTokenSigner,
  installWindowsNsisBootstrapSigner,
} from './scripts/windows-sign.mjs'
import { resolveDesktopAutoUpdateConfig } from './scripts/desktop-auto-update-environment.mjs'
import { desktopTargetBuildPaths } from './scripts/desktop-build-paths.mjs'

/**
 * Fork release version for the packaged app. The manifests keep the upstream
 * version verbatim so upstream merges fast-forward; the fork serial rides
 * here instead, supplied by the release workflow (`DSH_DESKTOP_VERSION`) and
 * defaulting to the manifest version (plain upstream behavior).
 * @param env - Packaging environment.
 * @returns The version electron-builder stamps into installers and metadata.
 */
function resolveForkAppVersion(env = process.env) {
  const override = env.DSH_DESKTOP_VERSION?.trim()
  if (override !== undefined && override !== '') return override
  const manifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
  if (typeof manifest.version !== 'string' || manifest.version === '') {
    throw new Error('desktop config: apps/desktop/package.json has no version')
  }
  return manifest.version
}

/**
 * Optional macOS signing identity: undefined when the packaging environment
 * carries no Apple credentials, in which case the fork ships a valid unsigned
 * build (same fallback the fork's previous shell used). Upstream always
 * signs; the fork cannot — it holds no Apple Developer identity.
 * @param env - Packaging environment.
 * @returns The signing identity and team, or undefined for unsigned builds.
 */
function optionalMacOSSigning(env) {
  try {
    return resolveMacOSSigningEnvironment(env)
  } catch {
    return undefined
  }
}

/**
 * Optional macOS notarization input, paired with {@link optionalMacOSSigning}.
 * @param env - Packaging environment.
 * @returns Notary credentials, or undefined when nothing can be notarized.
 */
function optionalMacOSNotarization(env) {
  try {
    return resolveMacOSNotarizationEnvironment(env)
  } catch {
    return undefined
  }
}

/**
 * Optional Windows token signer: undefined without the token fields.
 * @param env - Packaging environment.
 * @returns The signer, or undefined for unsigned builds.
 */
function optionalWindowsSigner(env) {
  try {
    return createWindowsTokenSigner({
      certificateFile: env.DSH_DESKTOP_WINDOWS_CER_FILE,
      signTool: env.DSH_DESKTOP_WINDOWS_SIGNTOOL,
      tokenPin: env.DSH_DESKTOP_WINDOWS_TOKEN_PIN,
      keyContainer: env.DSH_DESKTOP_WINDOWS_KEY_CONTAINER,
    })
  } catch {
    return undefined
  }
}

/**
 * Create electron-builder configuration from one release environment.
 * @param {NodeJS.ProcessEnv} env - Packaging environment.
 * @param {NodeJS.Platform} hostPlatform - Build-host platform used when no explicit target is present.
 * @param {string} hostArch - Build-host architecture used when no explicit target is present.
 * @returns {object} electron-builder configuration.
 */
export function createElectronBuilderConfig(
  env = process.env,
  hostPlatform = process.platform,
  hostArch = process.arch,
) {
  const appId = resolveDesktopAppId(env)
  const targetPlatform = env.DSH_DESKTOP_TARGET_PLATFORM
  const resolvedPlatform = targetPlatform ?? hostPlatform
  const resolvedArch = env.DSH_DESKTOP_TARGET_ARCH ?? hostArch
  const packagesMacOS = targetPlatform === 'darwin' || (targetPlatform === undefined && hostPlatform === 'darwin')
  const packagesWindows = targetPlatform === 'win32'
  const macOSSigning = packagesMacOS ? optionalMacOSSigning(env) : undefined
  const macOSNotarization = packagesMacOS ? optionalMacOSNotarization(env) : undefined
  const windowsSigner = packagesWindows ? optionalWindowsSigner(env) : undefined
  if (windowsSigner !== undefined) {
    installWindowsNsisBootstrapSigner({ sign: windowsSigner })
  }
  const update = resolveDesktopAutoUpdateConfig(env, resolvedPlatform, resolvedArch)
  const buildPaths = desktopTargetBuildPaths(update.target)
  return {
    appId,
    productName: 'DeepSeek Harness',
    artifactName: 'deepseek-harness-${version}-${os}-${arch}.${ext}',
    // Fork: the manifests keep the upstream version, so the fork serial rides
    // the packaged manifest instead of the source tree.
    extraMetadata: { version: resolveForkAppVersion(env) },
    directories: { output: buildPaths.artifacts },
    asar: true,
    files: [
      'lib/*.js',
      'lib/*.cjs',
      'renderer/**/*',
      'package.json',
    ],
    extraResources: [
      { from: buildPaths.runtime, to: 'runtime' },
      { from: buildPaths.seed, to: 'seed' },
    ],
    mac: {
      category: 'public.app-category.developer-tools',
      identity: macOSSigning?.signingIdentity,
      forceCodeSigning: macOSSigning !== undefined,
      hardenedRuntime: true,
      notarize: macOSSigning !== undefined && macOSNotarization !== undefined,
      target: ['dmg', 'zip'],
    },
    dmg: {
      sign: macOSSigning !== undefined,
      writeUpdateInfo: false,
    },
    afterSign: context => {
      if (context.electronPlatformName !== 'darwin' || macOSSigning === undefined) return
      verifyMacOSSignatureAfterSign(context, macOSSigning)
    },
    artifactBuildCompleted: artifact => {
      if (!artifact.file.endsWith('.dmg') || macOSSigning === undefined || macOSNotarization === undefined) return
      return notarizeMacOSDiskImageArtifact(artifact, env, macOSSigning)
    },
    win: {
      forceCodeSigning: windowsSigner !== undefined,
      ...(windowsSigner === undefined ? {} : {
        signtoolOptions: {
          sign: windowsSigner,
          signingHashAlgorithms: ['sha256'],
        },
      }),
      target: ['nsis'],
    },
    linux: {
      category: 'Development',
      target: ['AppImage'],
    },
    nsis: {
      oneClick: false,
      allowToChangeInstallationDirectory: true,
      differentialPackage: true,
    },
    // Fork: GitHub Releases channel on the fork's repository instead of the
    // upstream Tencent COS deployment (the fork holds no COS credentials).
    // electron-builder generates app-update.yml plus the latest*.yml channel
    // files from this provider on publish.
    publish: [{ provider: 'github', owner: 'hfut2014211610', repo: 'dsh-x' }],
  }
}

export default createElectronBuilderConfig()
