// Share links (M9, compressed in the stage after M15). A link carries the whole save in
// the URL fragment, which is never sent to the server, so GitHub Pages sees nothing.
// Two forms exist side by side, told apart by the parameter name:
//
//   #run=<base64url of the save JSON>                 the original form (M9); still read
//   #run2=<base64url of raw-deflate(save JSON bytes)>  the compressed form; what Copy share link makes
//
// `run` and `run2` can never be mistaken for each other: the fragment must start with
// exactly `run=` or `run2=`. Links are capped (a very long run is saved to a file
// instead). A payload read from a URL is untrusted: it is decoded strictly (alphabet,
// UTF-8), a compressed one is unpacked with a byte limit (a tiny payload must not be
// able to expand without bound), and the text then goes through `decodeSave` like any
// other save. Compression is async (`CompressionStream`), so encoding and decoding
// are too. Nothing here throws; a problem is a typed `SaveError` with a readable message.

import { deflateBytes, deflateSupported, inflateBytes } from './deflate.ts'
import { MAX_SAVE_CHARS, decodeSave, encodeSave } from './save.ts'
import type { Save, SaveResult } from './save.ts'

/** The original, uncompressed form. */
export const SHARE_PARAM = 'run'
/** The compressed form. */
export const SHARE_PARAM_COMPRESSED = 'run2'

export type ShareFormat = 'plain' | 'deflate'

/** Longest payload an old-style (uncompressed) link may carry, in characters (about 150 commands). */
export const SHARE_MAX_CHARS_PLAIN = 12_000

/**
 * Longest payload a compressed link may carry, in characters. Measured: a run with 5,000 commands (the save cap)
 * is about 50,000 characters of link, 1,000 commands about 10,600. The cap sits just above that and stays under
 * what address bars reliably take: Safari about 80,000 characters, older Firefox 65,536, Chrome far more; the
 * origin and path add about 100. Longer runs go to a file.
 */
export const SHARE_MAX_CHARS = 64_000

/** Longest payload read from a plain link someone else made. */
const SHARE_READ_MAX_PLAIN = Math.ceil((MAX_SAVE_CHARS * 4) / 3)
/** Longest payload read from a compressed link: well past what this version writes. */
const SHARE_READ_MAX_COMPRESSED = 4 * SHARE_MAX_CHARS

/** A save's JSON never needs more than this many bytes once unpacked (the save cap; saves are ASCII). */
export const SHARE_MAX_UNPACKED_BYTES = MAX_SAVE_CHARS

const BASE64URL = /^[A-Za-z0-9_-]*$/

export type ShareEncoding =
  | { ok: true; payload: string; fragment: string; format: ShareFormat }
  | { ok: false; length: number; message: string }

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

/** The bytes, or null when `payload` is not base64url (no padding, URL-safe alphabet). */
export function base64UrlToBytes(payload: string): Uint8Array | null {
  if (!BASE64URL.test(payload) || payload.length % 4 === 1) return null
  const padded = payload.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (payload.length % 4)) % 4)
  try {
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

export function toBase64Url(text: string): string {
  return bytesToBase64Url(new TextEncoder().encode(text))
}

/** The decoded text, or null when `payload` is not valid base64url of valid UTF-8. */
export function fromBase64Url(payload: string): string | null {
  const bytes = base64UrlToBytes(payload)
  if (bytes === null) return null
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

function tooLongMessage(save: Save): string {
  return `This run is too long for a link (${save.commands.length} commands). Save it to a file instead.`
}

/** The original uncompressed link form (`#run=`). Kept for old-link tests and as the fallback when compression is unavailable. */
export function encodeShareLegacy(save: Save): ShareEncoding {
  const payload = toBase64Url(encodeSave(save))
  if (payload.length > SHARE_MAX_CHARS_PLAIN) return { ok: false, length: payload.length, message: tooLongMessage(save) }
  return { ok: true, payload, fragment: `#${SHARE_PARAM}=${payload}`, format: 'plain' }
}

/**
 * The shortest link for `save`: the compressed form whenever it is shorter than the plain one (it is for
 * anything beyond a run with almost no commands; a tick-0 run with none is about the same either way and
 * stays plain if the plain form is not longer), and the plain form where compression is unavailable.
 */
export async function encodeShare(save: Save): Promise<ShareEncoding> {
  const plain = toBase64Url(encodeSave(save))
  const packed = deflateSupported() ? await deflateBytes(new TextEncoder().encode(encodeSave(save))) : null
  const compressed = packed === null ? null : bytesToBase64Url(packed)
  if (compressed !== null && compressed.length < plain.length) {
    if (compressed.length > SHARE_MAX_CHARS) return { ok: false, length: compressed.length, message: tooLongMessage(save) }
    return { ok: true, payload: compressed, fragment: `#${SHARE_PARAM_COMPRESSED}=${compressed}`, format: 'deflate' }
  }
  if (plain.length > SHARE_MAX_CHARS_PLAIN) return { ok: false, length: plain.length, message: tooLongMessage(save) }
  return { ok: true, payload: plain, fragment: `#${SHARE_PARAM}=${plain}`, format: 'plain' }
}

function damaged(what: string): SaveResult {
  return { ok: false, error: { code: 'not-json', message: `This link is damaged: ${what}` } }
}

/** Decodes a link payload of the given form (`plain` unless said otherwise). Never throws. */
export async function decodeShare(payload: string, format: ShareFormat = 'plain'): Promise<SaveResult> {
  const limit = format === 'deflate' ? SHARE_READ_MAX_COMPRESSED : SHARE_READ_MAX_PLAIN
  if (payload.length > limit) {
    return { ok: false, error: { code: 'too-large', message: 'This link is too large to be a save.' } }
  }
  if (format === 'plain') {
    const text = fromBase64Url(payload)
    if (text === null) return damaged('its save data could not be decoded.')
    return decodeSave(text)
  }
  const packed = base64UrlToBytes(payload)
  if (packed === null || packed.length === 0) return damaged('its save data could not be decoded.')
  const unpacked = await inflateBytes(packed, SHARE_MAX_UNPACKED_BYTES)
  if (!unpacked.ok) {
    switch (unpacked.reason) {
      case 'too-large':
        return { ok: false, error: { code: 'too-large', message: 'This link unpacks to more data than a save can hold (over 1 MB).' } }
      case 'unsupported':
        return {
          ok: false,
          error: { code: 'not-json', message: 'This browser cannot open compressed share links. Open it in a current browser, or ask for a save file.' },
        }
      case 'corrupt':
        return damaged('its compressed save data could not be unpacked.')
    }
  }
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(unpacked.bytes)
  } catch {
    return damaged('its save data could not be decoded.')
  }
  return decodeSave(text)
}

/** Splits `location.hash`. Null when the fragment is not a share link at all (nothing to load). */
export function parseShareFragment(hash: string): { format: ShareFormat; payload: string } | null {
  const body = hash.startsWith('#') ? hash.slice(1) : hash
  const compressed = `${SHARE_PARAM_COMPRESSED}=`
  if (body.startsWith(compressed)) return { format: 'deflate', payload: body.slice(compressed.length) }
  const plain = `${SHARE_PARAM}=`
  if (body.startsWith(plain)) return { format: 'plain', payload: body.slice(plain.length) }
  return null
}

/** Reads `location.hash`. Null when the fragment is not a share link at all (nothing to load). */
export async function readShareFragment(hash: string): Promise<SaveResult | null> {
  const parsed = parseShareFragment(hash)
  if (parsed === null) return null
  return decodeShare(parsed.payload, parsed.format)
}
