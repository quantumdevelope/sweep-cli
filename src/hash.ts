import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

/**
 * Compute the SHA-256 digest of a file, streaming it so large files stay cheap.
 *
 * @param filePath Absolute path to the file.
 */
export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = createReadStream(filePath);

  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve());
  });

  return hash.digest('hex');
}

/**
 * Compute the SHA-256 digest of a buffer.
 */
export function sha256Buffer(buffer: Buffer | string): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Shorten a digest for display, keeping enough entropy to be useful.
 */
export function shortHash(hash: string, length = 10): string {
  return hash.slice(0, length);
}
