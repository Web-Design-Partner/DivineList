import { mkdir, open, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { plainMetadata } from '../lib/local-filesystem.mjs';

export async function ensurePlainDirectory(directory) {
  const target = resolve(directory);
  const parent = dirname(target);
  if (parent !== target) await ensurePlainDirectory(parent);
  try {
    await plainMetadata(target);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    try {
      await mkdir(target);
    } catch (createError) {
      if (createError.code !== 'EEXIST') throw createError;
    }
  }
  if (!(await plainMetadata(target)).isDirectory())
    throw new Error('Stationsdata kräver en vanlig lokal katalog.');
}

export async function saveSourceEvidence(
  dataDir,
  bytes,
  facts,
  extension = 'html',
) {
  if (!['html', 'json'].includes(extension))
    throw new Error('Otillåten källfiltyp.');
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (facts.sha256 !== `sha256:${hash}`)
    throw new Error('Källans kontrollsumma stämmer inte.');
  const directory = resolve(dataDir, 'evidence');
  await ensurePlainDirectory(directory);
  const file = resolve(directory, `${hash}.${extension}`);
  let handle;
  try {
    handle = await open(file, 'wx');
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (
      !(await plainMetadata(file)).isFile() ||
      !(await readFile(file)).equals(bytes)
    )
      throw new Error('Den bevarade källan har ändrats.');
    return;
  }
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
