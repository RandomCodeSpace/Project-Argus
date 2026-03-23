/**
 * Gzip compression/decompression using fflate.
 * Used for CompressedText fields in the database.
 */
import { gzipSync, gunzipSync } from "fflate";

const GZIP_MAGIC = new Uint8Array([0x1f, 0x8b]);

export function compress(data: Uint8Array | string): Uint8Array {
  const input = typeof data === "string" ? new TextEncoder().encode(data) : data;
  if (input.length === 0) return input;
  return gzipSync(input);
}

export function decompress(data: Uint8Array): Uint8Array {
  if (data.length === 0) return data;
  return gunzipSync(data);
}

export function isGzipped(data: Uint8Array): boolean {
  return data.length >= 2 && data[0] === GZIP_MAGIC[0] && data[1] === GZIP_MAGIC[1];
}

/**
 * Compress a string for DB storage. Returns a Buffer with gzip magic prefix.
 */
export function compressText(text: string): Buffer {
  if (!text) return Buffer.from("");
  const compressed = compress(text);
  return Buffer.from(compressed);
}

/**
 * Decompress a DB blob back to string. Handles both compressed and legacy uncompressed.
 */
export function decompressText(data: Buffer | Uint8Array | string | null): string {
  if (!data) return "";
  if (typeof data === "string") return data;
  const buf = data instanceof Buffer ? new Uint8Array(data) : data;
  if (buf.length === 0) return "";
  if (isGzipped(buf)) {
    const decompressed = decompress(buf);
    return new TextDecoder().decode(decompressed);
  }
  // Legacy uncompressed data
  return new TextDecoder().decode(buf);
}
