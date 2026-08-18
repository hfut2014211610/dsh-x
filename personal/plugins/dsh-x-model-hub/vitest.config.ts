import tsconfigPaths from 'vite-tsconfig-paths'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { standardDecoratorPlugin } from '../../../vitest.shared.ts'

const repoRootConfig = fileURLToPath(new URL('../../../tsconfig.base.json', import.meta.url))

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  // The @Remote decorator on the RPC gateway needs the repo's standard-decorator transform.
  plugins: [tsconfigPaths({ projects: [repoRootConfig] }), standardDecoratorPlugin()],
  test: {
    include: ['tests/**/*.spec.ts'],
  },
})
