import { afterEach, describe, expect, it, vi } from 'vitest'

import { deflateBytes, inflateBytes } from './deflate.ts'
import { MAX_COMMANDS, SAVE_VERSION, decodeSave, encodeSave } from './save.ts'
import type { Save } from './save.ts'
import {
  SHARE_MAX_CHARS,
  SHARE_MAX_CHARS_PLAIN,
  SHARE_MAX_UNPACKED_BYTES,
  base64UrlToBytes,
  bytesToBase64Url,
  decodeShare,
  encodeShare,
  encodeShareLegacy,
  fromBase64Url,
  parseShareFragment,
  readShareFragment,
  toBase64Url,
} from './share.ts'

const HASH = 'fedcba9876543210'

function save(commandCount: number): Save {
  return {
    version: SAVE_VERSION,
    seed: 'Link-1',
    presetId: 'eden',
    sim: 1,
    tick: Math.max(4000, commandCount),
    hash: HASH,
    commands: Array.from({ length: commandCount }, (_, i) => ({
      tick: i,
      cmd: { type: 'placeNode' as const, kind: 'resource' as const, x: 10.5 + (i % 50), y: 20.5 },
    })),
  }
}

/** Commands with full-precision random coordinates: close to incompressible, so a big one cannot fit in a link. */
function noisySave(commandCount: number): Save {
  let state = 987654321
  const next = (): number => {
    state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff
    return (state / 0x7fffffff) * 90
  }
  return {
    ...save(0),
    tick: 100_000,
    commands: Array.from({ length: commandCount }, (_, i) => ({ tick: i, cmd: { type: 'placeBot' as const, x: next(), y: next() } })),
  }
}

async function packedPayload(text: string): Promise<string> {
  const packed = await deflateBytes(new TextEncoder().encode(text))
  if (packed === null) throw new Error('deflate unavailable')
  return bytesToBase64Url(packed)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

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

  it('roundtrips raw bytes, including ones that are not UTF-8', () => {
    const bytes = Uint8Array.from([0, 1, 2, 250, 251, 252, 253, 254, 255])
    expect(base64UrlToBytes(bytesToBase64Url(bytes))).toEqual(bytes)
    expect(base64UrlToBytes('_w')).toEqual(Uint8Array.from([255]))
    expect(base64UrlToBytes('a')).toBeNull()
    expect(base64UrlToBytes('a+b')).toBeNull()
  })
})

describe('deflate codec', () => {
  it('roundtrips bytes', async () => {
    const bytes = new TextEncoder().encode('hello hello hello hello'.repeat(50))
    const packed = await deflateBytes(bytes)
    expect(packed).not.toBeNull()
    expect(packed!.length).toBeLessThan(bytes.length / 4)
    const unpacked = await inflateBytes(packed!, 100_000)
    expect(unpacked).toEqual({ ok: true, bytes })
  })

  it('stops a decompression bomb at the limit instead of unpacking it', async () => {
    // 64 MB of zeros packs into about 64 KB; it must be refused at the 1 MB limit.
    const chunk = new Uint8Array(1 << 20)
    let sent = 0
    const source = new ReadableStream<Uint8Array<ArrayBuffer>>({
      pull(controller) {
        if (sent === 64) controller.close()
        else {
          sent += 1
          controller.enqueue(chunk)
        }
      },
    })
    const reader = source.pipeThrough(new CompressionStream('deflate-raw')).getReader()
    const parts: Uint8Array[] = []
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      parts.push(value)
    }
    const bomb = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
    let offset = 0
    for (const part of parts) {
      bomb.set(part, offset)
      offset += part.length
    }
    expect(bomb.length).toBeLessThan(200_000)

    expect(await inflateBytes(bomb, SHARE_MAX_UNPACKED_BYTES)).toEqual({ ok: false, reason: 'too-large' })
    // Through the link path too (the payload is small enough to be read at all).
    const result = await decodeShare(bytesToBase64Url(bomb), 'deflate')
    expect(result).toMatchObject({ ok: false, error: { code: 'too-large' } })
  })

  it('reports a damaged stream as corrupt, and never throws', async () => {
    expect(await inflateBytes(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]), 1000)).toEqual({ ok: false, reason: 'corrupt' })
    expect(await inflateBytes(new Uint8Array(0), 1000)).toMatchObject({ ok: false })
  })
})

describe('share links', () => {
  it('roundtrip a save through the fragment, compressed', async () => {
    for (const count of [0, 1, 5, 150, 1000, MAX_COMMANDS]) {
      const original = save(count)
      const encoded = await encodeShare(original)
      expect(encoded.ok, `${count} commands`).toBe(true)
      if (!encoded.ok) continue
      expect(await decodeShare(encoded.payload, encoded.format)).toEqual({ ok: true, save: original })
      expect(await readShareFragment(encoded.fragment)).toEqual({ ok: true, save: original })
      // A browser may hand over the hash without its leading #.
      expect(await readShareFragment(encoded.fragment.slice(1))).toEqual({ ok: true, save: original })
    }
  })

  it('uses the compressed form for a real run and it is much shorter than the plain form', async () => {
    const original = save(150)
    const encoded = await encodeShare(original)
    const plain = encodeShareLegacy(original)
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return
    expect(encoded.format).toBe('deflate')
    expect(encoded.fragment.startsWith('#run2=')).toBe(true)
    expect(plain.ok || plain.length > SHARE_MAX_CHARS_PLAIN).toBe(true)
    const plainLength = toBase64Url(encodeSave(original)).length
    expect(encoded.payload.length).toBeLessThan(plainLength / 3)
  })

  it('never makes a link longer than the plain form', async () => {
    for (const count of [0, 1, 2, 3, 5]) {
      const encoded = await encodeShare(save(count))
      expect(encoded.ok).toBe(true)
      if (!encoded.ok) continue
      expect(encoded.payload.length).toBeLessThanOrEqual(toBase64Url(encodeSave(save(count))).length)
    }
  })

  it('carries an empty run', async () => {
    const encoded = await encodeShare(save(0))
    expect(encoded.ok).toBe(true)
  })

  it('fits the largest allowed save of ordinary commands, and refuses one that does not fit, pointing to the file', async () => {
    const full = await encodeShare(save(MAX_COMMANDS))
    expect(full.ok).toBe(true)
    if (full.ok) expect(full.payload.length).toBeLessThanOrEqual(SHARE_MAX_CHARS)

    const tooLong = await encodeShare(noisySave(MAX_COMMANDS))
    expect(tooLong.ok).toBe(false)
    if (tooLong.ok) return
    expect(tooLong.length).toBeGreaterThan(SHARE_MAX_CHARS)
    expect(tooLong.message).toContain('too long for a link')
    expect(tooLong.message).toContain('file')
  })

  it('does not mistake other fragments for a share link', async () => {
    for (const hash of ['', '#', '#section', '#other=abc', '#runs=abc', '#run3=abc', '#xrun=abc', '#RUN=abc']) {
      expect(parseShareFragment(hash)).toBeNull()
      expect(await readShareFragment(hash)).toBeNull()
    }
  })

  it('tells the two forms apart by the marker', () => {
    expect(parseShareFragment('#run=abc')).toEqual({ format: 'plain', payload: 'abc' })
    expect(parseShareFragment('#run2=abc')).toEqual({ format: 'deflate', payload: 'abc' })
    expect(parseShareFragment('run2=abc')).toEqual({ format: 'deflate', payload: 'abc' })
    expect(parseShareFragment('#run2=')).toEqual({ format: 'deflate', payload: '' })
  })
})

describe('old links', () => {
  it('still load', async () => {
    const original = save(5)
    const old = encodeShareLegacy(original)
    expect(old.ok).toBe(true)
    if (!old.ok) return
    expect(old.fragment.startsWith('#run=')).toBe(true)
    expect(await decodeShare(old.payload)).toEqual({ ok: true, save: original })
    expect(await readShareFragment(old.fragment)).toEqual({ ok: true, save: original })
  })

  it('are never read as compressed, and compressed ones never as old', async () => {
    const original = save(5)
    const old = encodeShareLegacy(original)
    const fresh = await encodeShare(original)
    if (!old.ok || !fresh.ok) throw new Error('encode failed')
    expect((await readShareFragment(`#run2=${old.payload}`))?.ok).toBe(false)
    expect((await readShareFragment(`#run=${fresh.payload}`))?.ok).toBe(false)
  })

  it('keep the 12,000 character cap when written the old way', () => {
    let fits = 0
    for (let count = 1; count < 400; count += 1) {
      if (encodeShareLegacy(save(count)).ok) fits = count
      else break
    }
    expect(fits).toBeGreaterThan(50)
    const tooLong = encodeShareLegacy(save(fits + 1))
    expect(tooLong.ok).toBe(false)
    if (!tooLong.ok) expect(tooLong.length).toBeGreaterThan(SHARE_MAX_CHARS_PLAIN)
  })
})

describe('damaged and hostile links', () => {
  it('report a damaged plain link instead of throwing', async () => {
    for (const fragment of ['#run=', '#run=!!!', '#run=abc', `#run=${toBase64Url('not json')}`, `#run=${toBase64Url('{"version":9}')}`]) {
      const result = await readShareFragment(fragment)
      expect(result?.ok, fragment).toBe(false)
    }
  })

  it('report an empty compressed payload', async () => {
    const result = await readShareFragment('#run2=')
    expect(result).toMatchObject({ ok: false, error: { code: 'not-json' } })
  })

  it('report a payload that is not base64url', async () => {
    for (const payload of ['!!!', 'abc+', 'abc=', 'a b', 'a']) {
      const result = await readShareFragment(`#run2=${payload}`)
      expect(result, payload).toMatchObject({ ok: false })
      if (result?.ok === false) expect(result.error.message).toContain('damaged')
    }
  })

  it('report a corrupt compressed stream', async () => {
    const result = await readShareFragment(`#run2=${bytesToBase64Url(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))}`)
    expect(result).toMatchObject({ ok: false, error: { code: 'not-json' } })
    if (result?.ok === false) expect(result.error.message).toContain('could not be unpacked')
  })

  it('report a truncated compressed stream', async () => {
    const encoded = await encodeShare(save(300))
    if (!encoded.ok) throw new Error('encode failed')
    const bytes = base64UrlToBytes(encoded.payload)!
    for (const keep of [1, Math.floor(bytes.length / 2), bytes.length - 1]) {
      const result = await readShareFragment(`#run2=${bytesToBase64Url(bytes.slice(0, keep))}`)
      expect(result?.ok, `kept ${keep} of ${bytes.length}`).toBe(false)
    }
  })

  it('report a flipped byte in the stream', async () => {
    const encoded = await encodeShare(save(300))
    if (!encoded.ok) throw new Error('encode failed')
    const bytes = base64UrlToBytes(encoded.payload)!
    bytes[Math.floor(bytes.length / 2)] ^= 0xff
    const result = await readShareFragment(`#run2=${bytesToBase64Url(bytes)}`)
    expect(result?.ok).toBe(false)
  })

  it('reject a link that is far too long without decoding it', async () => {
    expect((await decodeShare('A'.repeat(2_000_000))).ok).toBe(false)
    const result = await decodeShare('A'.repeat(4 * SHARE_MAX_CHARS + 1), 'deflate')
    expect(result).toMatchObject({ ok: false, error: { code: 'too-large' } })
  })

  it('report text that unpacks but is not JSON', async () => {
    const result = await readShareFragment(`#run2=${await packedPayload('this is not json')}`)
    expect(result).toMatchObject({ ok: false, error: { code: 'not-json' } })
  })

  it('report bytes that unpack but are not UTF-8', async () => {
    const packed = await deflateBytes(Uint8Array.from([0xff, 0xfe, 0xfd]))
    const result = await readShareFragment(`#run2=${bytesToBase64Url(packed!)}`)
    expect(result?.ok).toBe(false)
  })

  it('run valid JSON that is not a valid save through save validation', async () => {
    expect(await readShareFragment(`#run2=${await packedPayload('{"version":9}')}`)).toMatchObject({ ok: false, error: { code: 'newer-version' } })
    expect(await readShareFragment(`#run2=${await packedPayload('[]')}`)).toMatchObject({ ok: false, error: { code: 'not-a-save' } })
    const forged = JSON.stringify({ ...JSON.parse(encodeSave(save(1))), commands: [{ tick: 0, cmd: { type: 'eval' } }] })
    expect(await readShareFragment(`#run2=${await packedPayload(forged)}`)).toMatchObject({ ok: false, error: { code: 'bad-command' } })
    expect(decodeSave(encodeSave(save(1))).ok).toBe(true)
  })

  it('treat a plain link payload as untrusted too', async () => {
    const forged = toBase64Url(JSON.stringify({ ...JSON.parse(encodeSave(save(1))), commands: [{ tick: 0, cmd: { type: 'eval' } }] }))
    expect((await decodeShare(forged)).ok).toBe(false)
  })
})

describe('without CompressionStream', () => {
  it('writes the plain form when it fits, and refuses a long run with the file message', async () => {
    vi.stubGlobal('CompressionStream', undefined)
    vi.stubGlobal('DecompressionStream', undefined)
    const small = await encodeShare(save(5))
    expect(small).toMatchObject({ ok: true, format: 'plain' })
    const long = await encodeShare(save(1000))
    expect(long.ok).toBe(false)
    if (!long.ok) expect(long.message).toContain('file')
  })

  it('says a compressed link cannot be opened here, and still opens old links', async () => {
    const fresh = await encodeShare(save(50))
    const old = encodeShareLegacy(save(5))
    if (!fresh.ok || !old.ok) throw new Error('encode failed')
    vi.stubGlobal('CompressionStream', undefined)
    vi.stubGlobal('DecompressionStream', undefined)
    const result = await readShareFragment(fresh.fragment)
    expect(result).toMatchObject({ ok: false })
    if (result?.ok === false) expect(result.error.message).toContain('cannot open compressed')
    expect((await readShareFragment(old.fragment))?.ok).toBe(true)
  })
})
