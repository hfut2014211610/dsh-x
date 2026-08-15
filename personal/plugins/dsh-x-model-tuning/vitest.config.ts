import { fileURLToPath } from 'node:url'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

// Repo-root tsconfig.base.json maps @deepseek-ai/* imports to their source
// trees; running from any cwd must resolve the same map.
const repoRootConfig = fileURLToPath(new URL('../../../tsconfig.base.json', import.meta.url))

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [tsconfigPaths({ projects: [repoRootConfig] })],
  test: {
    include: ['tests/**/*.spec.ts'],
  },
})
