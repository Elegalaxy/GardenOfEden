// Raw deflate for share links, through the web platform's `CompressionStream` and
// `DecompressionStream` (browsers, workers and Node 18+ all have them). This is a pure
// data transform with no imports and no I/O, so it sits in the persist layer without
// touching the layer rules. Input read from a link is untrusted: `inflateBytes` stops
// as soon as the output passes a byte limit (a tiny payload can expand a thousand
// fold), and never throws; a damaged stream comes back as a typed failure.

export type InflateResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: 'unsupported' | 'corrupt' | 'too-large' }

/** True when this runtime can do raw deflate. */
export function deflateSupported(): boolean {
  return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function' && typeof ReadableStream === 'function'
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array<ArrayBuffer>> {
  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes))
      controller.close()
    },
  })
}

/** Reads a stream to the end, giving up (and cancelling it) once `limit` bytes are exceeded. */
async function readAll(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array | 'too-large'> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > limit) {
      await reader.cancel().catch(() => undefined)
      return 'too-large'
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

/** Compresses bytes. Null when the runtime has no `CompressionStream` or it fails. */
export async function deflateBytes(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (!deflateSupported()) return null
  try {
    const out = await readAll(streamOf(bytes).pipeThrough(new CompressionStream('deflate-raw')), Number.MAX_SAFE_INTEGER)
    return out === 'too-large' ? null : out
  } catch {
    return null
  }
}

/** Decompresses raw deflate bytes into at most `maxBytes` bytes. */
export async function inflateBytes(bytes: Uint8Array, maxBytes: number): Promise<InflateResult> {
  if (!deflateSupported()) return { ok: false, reason: 'unsupported' }
  try {
    const out = await readAll(streamOf(bytes).pipeThrough(new DecompressionStream('deflate-raw')), maxBytes)
    if (out === 'too-large') return { ok: false, reason: 'too-large' }
    return { ok: true, bytes: out }
  } catch {
    // Not a deflate stream, or one that ends early.
    return { ok: false, reason: 'corrupt' }
  }
}
