import fs from 'node:fs/promises';
const failure = (message: string, code: string) => Object.assign(new Error(message), {code});
export async function readBounded(filename: string, maximum: number) {
  const file = await fs.open(filename, 'r');
  try {
    const chunks = [];
    let total = 0;
    while (true) {
      const buffer = Buffer.alloc(Math.min(65536, maximum + 1 - total));
      const {bytesRead} = await file.read(buffer);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > maximum) throw failure('media byte budget exceeded', 'ASSET_TOO_LARGE');
      chunks.push(buffer.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks);
  } finally { await file.close(); }
}
