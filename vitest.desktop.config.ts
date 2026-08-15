import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'
import { standardDecoratorPlugin, vitestExecArgv } from './vitest.shared.ts'

// Desktop lane: the Playwright-on-Electron smoke beside the unit suites.
// `pnpm run test:desktop` builds the shell, the CLI lib, and the web dist
// first, and downloads the Electron binary the automations gate skips. The
// scenario itself is keyless — it stops at the web boot surface.
export default defineConfig({
  plugins: [
    tsconfigPaths({ projects: ['./tsconfig.base.json'] }),
    standardDecoratorPlugin(),
  ],
  test: {
    execArgv: vitestExecArgv,
    include: [
      'apps/desktop/tests/**/*.e2e.ts',
    ],
    testTimeout: 180_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
})
