import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { ConfigError, formatZodError, formatParseError, didYouMean } from '../config/errors.js'

// ─── ConfigError ──────────────────────────────────────────────────────────────

describe('ConfigError', () => {
  it('sets name to ConfigError', () => {
    const e = new ConfigError('oops', '/path/to/file.yaml')
    expect(e.name).toBe('ConfigError')
  })

  it('stores the file path', () => {
    const e = new ConfigError('bad schema', '/mocks/users.yaml')
    expect(e.file).toBe('/mocks/users.yaml')
  })

  it('stores issues when provided', () => {
    const schema = z.object({ port: z.number() })
    const result = schema.safeParse({ port: 'bad' })
    if (!result.success) {
      const e = new ConfigError('invalid', '/cfg.yaml', result.error.issues)
      expect(e.issues).toHaveLength(1)
      expect(e.issues?.[0]?.code).toBe('invalid_type')
    }
  })

  it('issues is undefined when not provided', () => {
    const e = new ConfigError('msg', '/file.yaml')
    expect(e.issues).toBeUndefined()
  })

  it('extends Error', () => {
    const e = new ConfigError('test', '/f.yaml')
    expect(e).toBeInstanceOf(Error)
  })

  it('message is set correctly', () => {
    const e = new ConfigError('something went wrong', '/qms.config.yaml')
    expect(e.message).toBe('something went wrong')
  })
})

// ─── formatParseError ─────────────────────────────────────────────────────────

describe('formatParseError', () => {
  it('formats an Error instance', () => {
    const msg = formatParseError(new Error('unexpected token'), '/mocks/bad.json')
    expect(msg).toContain('Parse error in /mocks/bad.json')
    expect(msg).toContain('unexpected token')
  })

  it('formats a non-Error (string)', () => {
    const msg = formatParseError('some string error', '/mocks/bad.yaml')
    expect(msg).toContain('Parse error in /mocks/bad.yaml')
    expect(msg).toContain('some string error')
  })

  it('formats a non-Error (number)', () => {
    const msg = formatParseError(42, '/file.yaml')
    expect(msg).toContain('42')
  })

  it('includes the file name in the message', () => {
    const msg = formatParseError(new Error('x'), '/absolute/path/qms.config.ts')
    expect(msg).toMatch(/qms\.config\.ts/)
  })
})

// ─── formatZodError ───────────────────────────────────────────────────────────

describe('formatZodError', () => {
  it('formats a type error with path', () => {
    const schema = z.object({ port: z.number() })
    const result = schema.safeParse({ port: 'bad' })
    if (!result.success) {
      const msg = formatZodError(result.error, '/qms.config.yaml')
      expect(msg).toContain('/qms.config.yaml')
      expect(msg).toContain('"port"')
    }
  })

  it('formats an unrecognized_keys error with did-you-mean', () => {
    const schema = z.object({ port: z.number() }).strict()
    const result = schema.safeParse({ prot: 4000 })
    if (!result.success) {
      const msg = formatZodError(result.error, '/cfg.yaml')
      // "prot" is 1 edit away from "port" → suggestion expected
      expect(msg).toContain('prot')
      expect(msg).toContain('port')
    }
  })

  it('formats an unrecognized_keys error without suggestion for gibberish', () => {
    const schema = z.object({ port: z.number() }).strict()
    const result = schema.safeParse({ zzzzzzzzz: true })
    if (!result.success) {
      const msg = formatZodError(result.error, '/cfg.yaml')
      expect(msg).toContain('zzzzzzzzz')
      expect(msg).toContain('is not a valid key')
    }
  })

  it('formats multiple issues with bullet points', () => {
    const schema = z.object({ port: z.number(), host: z.string() })
    const result = schema.safeParse({ port: 'bad', host: 123 })
    if (!result.success) {
      const msg = formatZodError(result.error, '/x.yaml')
      const bullets = (msg.match(/•/g) ?? []).length
      expect(bullets).toBeGreaterThanOrEqual(2)
    }
  })

  it('formats top-level issue without path prefix', () => {
    const schema = z.string()
    const result = schema.safeParse(123)
    if (!result.success) {
      const msg = formatZodError(result.error, '/x.yaml')
      // no "path" prefix for top-level errors
      expect(msg).not.toContain('""')
    }
  })
})

// ─── didYouMean — extra coverage ──────────────────────────────────────────────

describe('didYouMean — extra coverage', () => {
  it('returns null for empty candidates', () => {
    expect(didYouMean('port', [])).toBeNull()
  })

  it('handles edit distance exactly 3 (included)', () => {
    // 'abcd' vs 'abcxyz' = 3 insertions (or similar)
    // Use a known-distance-3 pair
    const result = didYouMean('abc', ['abcxyz', 'xyz'])
    // 'abc' → 'abcxyz' = 3 insertions (dist=3 ≤ 3) → suggestion
    expect(result).toBe('abcxyz')
  })

  it('handles edit distance exactly 4 (excluded)', () => {
    // 'a' vs 'abcde' = 4 insertions → not suggested
    expect(didYouMean('a', ['abcde'])).toBeNull()
  })

  it('picks the closest of multiple candidates', () => {
    // 'cors' is 1 edit from 'core', 3 from 'host'
    const result = didYouMean('cors', ['core', 'host', 'port'])
    expect(result).toBe('core')
  })
})
