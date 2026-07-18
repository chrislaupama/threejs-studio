const HEX = '0123456789abcdef';

export async function sha256Hex(contents: Uint8Array): Promise<string> {
  const owned = new Uint8Array(contents);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', owned));
  let hex = '';
  for (const byte of digest) hex += HEX[byte >> 4] + HEX[byte & 0x0f];
  return hex;
}

