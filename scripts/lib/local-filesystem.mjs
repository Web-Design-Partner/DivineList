import { lstat, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function plainMetadata(path, readMetadata = lstat) {
  const metadata = await readMetadata(path);
  if (metadata.isSymbolicLink()) {
    throw new Error('Symbolisk länk tillåts inte i verifierade filer: ' + path);
  }
  if (!metadata.isFile() && !metadata.isDirectory()) {
    throw new Error('Otillåten filtyp i verifierade filer: ' + path);
  }
  return metadata;
}

export async function readPlainDirectory(
  root,
  { readNames = readdir, readMetadata = lstat } = {},
) {
  if (!(await plainMetadata(root, readMetadata)).isDirectory()) {
    throw new Error('Förväntad katalog saknas: ' + root);
  }
  // Directory-entry hints may report OneDrive cloud files as links. Read only
  // names, then classify each entry with lstat, which does not follow real links.
  const names = await readNames(root);
  names.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const entries = [];
  for (const name of names) {
    const metadata = await plainMetadata(resolve(root, name), readMetadata);
    entries.push({
      name,
      kind: metadata.isDirectory() ? 'directory' : 'file',
      metadata,
    });
  }
  return entries;
}
