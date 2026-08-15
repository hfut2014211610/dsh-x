/**
 * Usage section stylesheet contract, asserted against the CSS text on disk:
 * every themed name the sheet references must be declared by a theme sheet,
 * or the browser silently resolves the `var()` fallback and only the dark
 * theme renders wrong.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/UsageSection.module.css', import.meta.url)), 'utf8')
// The theme package maps `./styles/*` to `./src/styles/*`, so the declarations
// stay on the source plane rather than needing a build. Every theme sheet,
// not just the platform tokens: the static color grades live in siblings.
const tokens = readdirSync(fileURLToPath(new URL('../../ui-theme/src/styles/', import.meta.url)))
  .filter(name => name.endsWith('.css'))
  .map(name => readFileSync(fileURLToPath(new URL(`../../ui-theme/src/styles/${name}`, import.meta.url)), 'utf8'))
  .join('\n')

describe('UsageSection theme styles', () => {
  it('names only theme variables the token sheets define', () => {
    const named = [...css.matchAll(/var\((--(?:dsw|dsh|ds)-[a-z0-9-]+)/g)].map(match => match[1])
    expect(named.length).toBeGreaterThan(0)
    const undeclared = [...new Set(named.filter(name => !new RegExp(`\\${name}\\s*:`).test(tokens)))]
    expect(undeclared).toEqual([])
  })
})
