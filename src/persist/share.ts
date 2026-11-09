// Share links (M9). A link carries the whole save as base64url of its JSON text in
// the URL fragment: `https://host/path/#run=<payload>`. A fragment is never sent to
// the server, so GitHub Pages sees nothing. Links are capped: a long run (many
// commands) does not fit and is saved to a file instead. A payload read from a
// URL is untrusted: it is decoded strictly (alphabet, UTF-8) and then goes through
// `decodeSave` like any other save text.

import { MAX_SAVE_CHARS, decodeSave, encodeSave } from './save.ts'
import type { Save, SaveResult } from './save.ts'

export const SHARE_PARAM = 'run'

/** Longest payload a link may carry, in characters (about 150 commands). */
export const SHARE_MAX_CHARS = 12_000

/** Longest payload accepted when reading a link someone else made. */
const SHARE_READ_MAX_CHARS = Math.ceil((MAX_SAVE_CHARS * 4) / 3)

const BASE64URL = /^[A-Za-z0-9_-]*$/

export type ShareEncoding =
  | { ok: true; payload: string; fragment: string }
  | { ok: false; length: number; message: string }

export function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

/** The decoded text, or null when `payload` is not valid base64url of valid UTF-8. */
export function fromBase64Url(payload: string): string | null {
  if (!BASE64URL.test(payload) || payload.length % 4 === 1) return null
  const padded = payload.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (payload.length % 4)) % 4)
  try {
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

export function encodeShare(save: Save): ShareEncoding {
  const payload = toBase64Url(encodeSave(save))
  if (payload.length > SHARE_MAX_CHARS) {
    return {
      ok: false,
      length: payload.length,
      message: `This run is too long for a link (${save.commands.length} commands). Save it to a file instead.`,
    }
  }
  return { ok: true, payload, fragment: `#${SHARE_PARAM}=${payload}` }
}

export function decodeShare(payload: string): SaveResult {
  if (payload.length > SHARE_READ_MAX_CHARS) {
    return { ok: false, error: { code: 'too-large', message: 'This link is too large to be a save.' } }
  }
  const text = fromBase64Url(payload)
  if (text === null) {
    return { ok: false, error: { code: 'not-json', message: 'This link is damaged: its save data could not be decoded.' } }
  }
  return decodeSave(text)
}

/** Reads `location.hash`. Null when the fragment is not a share link at all (nothing to load). */
export function readShareFragment(hash: string): SaveResult | null {
  const body = hash.startsWith('#') ? hash.slice(1) : hash
  const prefix = `${SHARE_PARAM}=`
  if (!body.startsWith(prefix)) return null
  return decodeShare(body.slice(prefix.length))
}
