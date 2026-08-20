/**
 * The bridge's whole point is standing in while dsh is gone, which it can only
 * do if it does not depend on dsh. `src/bridge/main.ts` says so in prose;
 * nothing enforced it until now.
 *
 * The failure is invisible without this: a dsh import would bundle cleanly into
 * `lib/bin.js`, the bridge would run fine every day, and the one time it
 * mattered — dsh crashed, and the bridge is supposed to answer in its place —
 * it would already have gone down with it.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))

/** Every `.ts` file reachable under one directory. */
function sourcesUnder(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) found.push(...sourcesUnder(path))
    else if (entry.endsWith('.ts')) found.push(path)
  }
  return found
}

/** Module specifiers one file imports, static and dynamic alike. */
function specifiersIn(path: string): string[] {
  const text = readFileSync(path, 'utf8')
  const found: string[] = []
  for (const match of text.matchAll(/(?:^|\s)(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/gm)) {
    found.push(match[1] as string)
  }
  for (const match of text.matchAll(/(?:^|\s)import\s*['"]([^'"]+)['"]/gm)) found.push(match[1] as string)
  for (const match of text.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) found.push(match[1] as string)
  for (const match of text.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) found.push(match[1] as string)
  return found
}

/** A relative path, or a node builtin — the two kinds the bridge may name. */
function permitted(specifier: string): boolean {
  return specifier.startsWith('.') || specifier.startsWith('node:')
}

describe('bridge isolation', () => {
  // src/bin.ts is in scope because it is what package.json `bin` resolves to:
  // whatever it pulls in ends up inside the bridge's own bundle.
  const files = [join(packageRoot, 'src/bin.ts'), ...sourcesUnder(join(packageRoot, 'src/bridge'))]

  it('has files to check', () => {
    // A rename that emptied the directory would otherwise turn this whole
    // suite into a vacuous pass.
    expect(files.length).toBeGreaterThan(3)
  })

  it('imports nothing but node builtins and its own siblings', () => {
    const offenders = files.flatMap(path => specifiersIn(path)
      .filter(specifier => !permitted(specifier))
      .map(specifier => `${path.slice(packageRoot.length).replaceAll('\\', '/')} -> ${specifier}`))
    expect(offenders).toEqual([])
  })

  it('finds the imports it claims to be checking', () => {
    // Guards the regexes: a scanner that matched nothing would report a clean
    // bridge no matter what the bridge imported.
    const main = specifiersIn(join(packageRoot, 'src/bridge/main.ts'))
    expect(main.length).toBeGreaterThan(0)
    expect(main.some(specifier => specifier.startsWith('node:'))).toBe(true)
  })
})
