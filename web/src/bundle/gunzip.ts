// gzip detection and decompression for bundle files (see docs/DATA_CONTRACT.md).

/** Decompress when the bytes start with the gzip magic number; hosts may already have decompressed. */
export async function gunzipIfNeeded(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const head = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
  if (head.length < 2 || head[0] !== 0x1f || head[1] !== 0x8b) return buf;
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot decompress gzip data');
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}
