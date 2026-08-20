import { defineConfig } from 'tsdown'

/**
 * 这个包发两个入口：插件本体（`index`）和桥接可执行文件（`bin`，被
 * package.json 的 `bin` / `exports["./bin"]` 指到）。根 tsdown 只建
 * `lib/types/index.js`，所以这里补上 `lib/types/bin.js`。声明文件仍由
 * `tsc -b` 出（`dts: false`），与其他包一致。
 */
export default defineConfig({
  entry: ['lib/types/index.js', 'lib/types/invariant.js', 'lib/types/bin.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
