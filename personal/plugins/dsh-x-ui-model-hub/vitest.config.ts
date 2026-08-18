import tsconfigPaths from 'vite-tsconfig-paths'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const repoRootConfig = fileURLToPath(new URL('../../../tsconfig.base.json', import.meta.url))

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [tsconfigPaths({ projects: [repoRootConfig] })],
  test: {
    include: ['tests/**/*.spec.ts'],
  },
})
