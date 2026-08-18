/**
 * The preview frame's isolation. Rule 1 of the security review fails silently —
 * the preview looks identical when the boundary is gone — so it is asserted
 * both ways rather than reviewed.
 */

import { describe, expect, it } from 'vitest'
import {
  FORBIDDEN_SANDBOX_TOKENS,
  isPreviewable,
  previewSrcdoc,
  PREVIEW_CSP,
  PREVIEW_SANDBOX,
} from '../src/client/sandbox.ts'

const tokensOf = (value: string): string[] => value.split(/\s+/).filter(token => token !== '')

describe('preview sandbox', () => {
  it('grants scripts and nothing else', () => {
    expect(tokensOf(PREVIEW_SANDBOX)).toEqual(['allow-scripts'])
  })

  it('grants no token that would dissolve or widen the boundary', () => {
    // Whitelist above, blacklist here: an added token has to pass both, and the
    // one that matters cannot be dropped from the list without failing the next
    // assertion.
    for (const forbidden of FORBIDDEN_SANDBOX_TOKENS) {
      expect(tokensOf(PREVIEW_SANDBOX)).not.toContain(forbidden)
    }
    expect(FORBIDDEN_SANDBOX_TOKENS).toContain('allow-same-origin')
  })

  it('forbids the frame every network origin it could reach', () => {
    expect(PREVIEW_CSP).toContain("default-src 'none'")
    expect(PREVIEW_CSP).toContain("connect-src 'none'")
    expect(PREVIEW_CSP).toContain("form-action 'none'")
  })
})

describe('previewSrcdoc', () => {
  it('puts the policy inside an existing head', () => {
    const out = previewSrcdoc('<!doctype html><html><head><title>a</title></head><body>b</body></html>')
    expect(out).toContain(`<head><meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}"><title>a</title>`)
  })

  it('never moves the policy ahead of the doctype, which would change rendering', () => {
    for (const html of [
      '<!doctype html><html><head></head><body>b</body></html>',
      '<!DOCTYPE html><html><body>b</body></html>',
      '<!doctype html><p>bare</p>',
    ]) {
      const out = previewSrcdoc(html)
      expect(out.toLowerCase().indexOf('<!doctype')).toBe(0)
      expect(out.toLowerCase().indexOf('<meta http-equiv')).toBeGreaterThan(0)
      expect(out).toContain(PREVIEW_CSP)
    }
  })

  it('manufactures a head when the document has none', () => {
    expect(previewSrcdoc('<html><body>b</body></html>'))
      .toContain(`<html><head><meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}"></head>`)
  })

  it('wraps a bare fragment', () => {
    const out = previewSrcdoc('<p>hi</p>')
    expect(out.startsWith('<!doctype html><html><head><meta http-equiv=')).toBe(true)
    expect(out).toContain('<body><p>hi</p></body>')
  })
})

describe('isPreviewable', () => {
  it('accepts prototype documents and rejects the rest', () => {
    expect(isPreviewable('a/login.html')).toBe(true)
    expect(isPreviewable('LOGIN.HTM')).toBe(true)
    expect(isPreviewable('notes.md')).toBe(false)
    expect(isPreviewable('style.css')).toBe(false)
  })
})
