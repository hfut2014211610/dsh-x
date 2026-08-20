import { defineConfig } from 'tsdown'

/** Everything both bundles agree on; only the entry set differs. */
const shared = {
  outDir: 'lib',
  format: ['esm'] as const,
  platform: 'node' as const,
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
}

/**
 * 这个包发两个入口：插件本体（`index`）和桥接可执行文件（`bin`，被
 * package.json 的 `bin` / `exports["./bin"]` 指到）。根 tsdown 只建
 * `lib/types/index.js`，所以这里得自己声明。
 *
 * **两次独立构建，不是一次两入口。** 一次构建时 `bridge-config.ts` 被两边
 * 都引到，rolldown 会把它拆成一个带哈希的共享 chunk——那个文件不在
 * `files` 里，发出去的桥接会少一个 import；而且桥接的立身之本是「dsh 挂了
 * 我还能顶上」，它不该跟插件共用任何一块产物。分开建，各自自足。
 *
 * 声明文件仍由 `tsc -b` 出（`dts: false`），与其他包一致。
 */
export default defineConfig([
  { ...shared, entry: ['lib/types/index.js', 'lib/types/invariant.js'] },
  { ...shared, entry: ['lib/types/bin.js'] },
])
