import { describe, expect, it } from 'vitest'

import { SAVE_VERSION, decodeSave, encodeSave } from './save.ts'
import type { Save } from './save.ts'
import { SHARE_MAX_CHARS, decodeShare, encodeShare, fromBase64Url, readShareFragment, toBase64Url } from './share.ts'

const HASH = 'fedcba9876543210'

function save(commandCount: number): Save {
  return {
    version: SAVE_VERSION,
    seed: 'Link-1',
    presetId: 'eden',
    tick: 4000,
    hash: HASH,
    commands: Array.from({ length: commandCount }, (_, i) => ({
      tick: i,
      cmd: { type: 'placeNode' as const, kind: 'resource' as const, x: 10.5 + (i % 50), y: 20.5 },
    })),
  }
}

describe('base64url', () => {
  it('roundtrips text, including characters outside ASCII', () => {
    for (const text of ['', 'a', 'ab', 'abc', '{"a":1}', 'ünïcödé ✓ 🌱', '~~~???>>>']) {
      expect(fromBase64Url(toBase64Url(text))).toBe(text)
    }
  })

  it('uses only URL-safe characters and no padding', () => {
    const encoded = toBase64Url('~~~???>>>ÿþ')
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('rejects text that is not base64url or not UTF-8', () => {
    expect(fromBase64Url('abc+')).toBeNull()
    expect(fromBase64Url('abc=')).toBeNull()
    expect(fromBase64Url('a b')).toBeNull()
    expect(fromBase64Url('a')).toBeNull() // a length of 1 mod 4 cannot be valid
    expect(fromBase64Url('_w')).toBeNull() // the single byte 0xff is not UTF-8
  })
})

describe('share links', () => {
  it('roundtrip a save through the fragment', () => {
    const original = save(5)
    const encoded = encodeShare(original)
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return
    expect(encoded.fragment.startsWith('#run=')).toBe(true)
    expect(decodeShare(encoded.payload)).toEqual({ ok: true, save: original })
    expect(readShareFragment(encoded.fragment)).toEqual({ ok: true, save: original })
    // A browser may hand over the hash without its leading #.
    expect(readShareFragment(encoded.fragment.slice(1))).toEqual({ ok: true, save: original })
  })

  it('carries an empty run', () => {
    const encoded = encodeShare(save(0))
    expect(encoded.ok).toBe(true)
  })

  it('refuses a run that does not fit, with a message that points to the file', () => {
    let fits = 0
    for (let count = 1; count < 400; count += 1) {
      if (encodeShare(save(count)).ok) fits = count
      else break
    }
    expect(fits).toBeGreaterThan(50)
    const tooLong = encodeShare(save(fits + 1))
    expect(tooLong.ok).toBe(false)
    if (tooLong.ok) return
    expect(tooLong.length).toBeGreaterThan(SHARE_MAX_CHARS)
    expect(tooLong.message).toContain('too long for a link')
    expect(tooLong.message).toContain('file')
  })

  it('does not mistake other fragments for a share link', () => {
    expect(readShareFragment('')).toBeNull()
    expect(readShareFragment('#')).toBeNull()
    expect(readShareFragment('#section')).toBeNull()
    expect(readShareFragment('#other=abc')).toBeNull()
  })

  it('reports a damaged link instead of throwing', () => {
    for (const fragment of ['#run=', '#run=!!!', '#run=abc', `#run=${toBase64Url('not json')}`, `#run=${toBase64Url('{"version":9}')}`]) {
      const result = readShareFragment(fragment)
      expect(result?.ok).toBe(false)
    }
  })

  it('rejects an absurdly long payload without decoding it', () => {
    const result = decodeShare('A'.repeat(2_000_000))
    expect(result.ok).toBe(false)
  })

  it('treats a link payload as untrusted: a valid payload still goes through save validation', () => {
    const forged = toBase64Url(JSON.stringify({ ...JSON.parse(encodeSave(save(1))), commands: [{ tick: 0, cmd: { type: 'eval' } }] }))
    const result = decodeShare(forged)
    expect(result.ok).toBe(false)
    expect(decodeSave(encodeSave(save(1))).ok).toBe(true)
  })
})
