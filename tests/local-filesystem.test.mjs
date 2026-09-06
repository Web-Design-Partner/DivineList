import assert from 'node:assert/strict';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  plainMetadata,
  readPlainDirectory,
} from '../scripts/lib/local-filesystem.mjs';

function metadata(kind) {
  return {
    isSymbolicLink: () => kind === 'link',
    isFile: () => kind === 'file',
    isDirectory: () => kind === 'directory',
  };
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'divinelist-filesystem-test-'));
  t.after(async () => rm(root, { recursive: true, force: true }));
  return root;
}

test('local filesystem: real regular files and directories use lstat metadata', async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, 'z-file.txt'), 'Synthetic fixture', 'utf8');
  await mkdir(join(root, 'a-directory'));
  const entries = await readPlainDirectory(root);
  assert.deepEqual(
    entries.map(({ name, kind }) => ({ name, kind })),
    [
      { name: 'a-directory', kind: 'directory' },
      { name: 'z-file.txt', kind: 'file' },
    ],
  );
  assert.equal(entries[0].metadata.isDirectory(), true);
  assert.equal(entries[1].metadata.isFile(), true);
  assert.equal(entries[1].metadata.isSymbolicLink(), false);
  assert.equal(
    await readFile(join(root, 'z-file.txt'), 'utf8'),
    'Synthetic fixture',
  );
});

test('local filesystem: directory names are read without misleading Dirent classification', async () => {
  const root = join(tmpdir(), 'synthetic-onedrive-listing');
  const regular = metadata('file');
  const calls = [];
  const entries = await readPlainDirectory(root, {
    readNames: async (...args) => {
      calls.push(args);
      // Models OneDrive returning a link-shaped Dirent for an ordinary file.
      if (args[1]?.withFileTypes) {
        return [{ name: 'ordinary-file.txt', ...metadata('link') }];
      }
      return ['ordinary-file.txt'];
    },
    readMetadata: async (path) =>
      path === root ? metadata('directory') : regular,
  });
  assert.deepEqual(calls, [[root]]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, 'file');
  assert.equal(entries[0].metadata, regular);
});

test('local filesystem: listing order is stable UTF-16 code-point order', async () => {
  const root = join(tmpdir(), 'synthetic-order');
  const names = ['ö.txt', 'z.txt', 'a.txt', 'Z.txt', 'Ä.txt', 'A.txt'];
  const options = {
    readNames: async () => [...names],
    readMetadata: async (path) =>
      metadata(path === root ? 'directory' : 'file'),
  };
  const first = await readPlainDirectory(root, options);
  names.reverse();
  const second = await readPlainDirectory(root, options);
  assert.deepEqual(
    first.map(({ name }) => name),
    ['A.txt', 'Z.txt', 'a.txt', 'z.txt', 'Ä.txt', 'ö.txt'],
  );
  assert.deepEqual(
    first.map(({ name, kind }) => ({ name, kind })),
    second.map(({ name, kind }) => ({ name, kind })),
  );
});

test('local filesystem: plain metadata accepts regular files and directories unchanged', async () => {
  for (const kind of ['file', 'directory']) {
    const value = metadata(kind);
    assert.equal(
      await plainMetadata('synthetic-path', async () => value),
      value,
    );
  }
});

test('local filesystem: metadata link status takes priority over apparent file status', async () => {
  const inconsistent = {
    isSymbolicLink: () => true,
    isFile: () => true,
    isDirectory: () => true,
  };
  await assert.rejects(() =>
    plainMetadata('synthetic-link', async () => inconsistent),
  );
});

test('local filesystem: injected child symbolic links are rejected without following', async () => {
  const root = join(tmpdir(), 'synthetic-child-link');
  const calls = [];
  await assert.rejects(() =>
    readPlainDirectory(root, {
      readNames: async () => ['linked-entry'],
      readMetadata: async (path) => {
        calls.push(path);
        return metadata(path === root ? 'directory' : 'link');
      },
    }),
  );
  assert.deepEqual(calls, [root, join(root, 'linked-entry')]);
});

test('local filesystem: real junction is rejected rather than followed', async (t) => {
  const root = await fixture(t);
  const scan = join(root, 'scan');
  const target = join(root, 'test-owned-junction-target');
  const junction = join(scan, 'junction');
  await mkdir(scan);
  await mkdir(target);
  await writeFile(join(target, 'sentinel.txt'), 'Must stay untouched', 'utf8');
  await symlink(target, junction, 'junction');
  assert.equal((await lstat(junction)).isSymbolicLink(), true);
  await assert.rejects(() => plainMetadata(junction));
  await assert.rejects(() => readPlainDirectory(scan));
  assert.equal(
    await readFile(join(target, 'sentinel.txt'), 'utf8'),
    'Must stay untouched',
  );
});

test('local filesystem: FIFO, devices and unsupported entry types fail closed', async () => {
  const unsupported = metadata('unsupported');
  await assert.rejects(() =>
    plainMetadata('synthetic-fifo', async () => unsupported),
  );
  const root = join(tmpdir(), 'synthetic-unsupported-listing');
  await assert.rejects(() =>
    readPlainDirectory(root, {
      readNames: async () => ['unsupported-entry'],
      readMetadata: async (path) =>
        path === root ? metadata('directory') : unsupported,
    }),
  );
});

test('local filesystem: non-directory and linked roots are rejected before listing', async () => {
  for (const kind of ['file', 'link', 'unsupported']) {
    let listed = false;
    await assert.rejects(() =>
      readPlainDirectory('synthetic-root', {
        readNames: async () => {
          listed = true;
          return [];
        },
        readMetadata: async () => metadata(kind),
      }),
    );
    assert.equal(listed, false, kind);
  }
});

test('local filesystem: directory listing errors are not silently treated as empty', async () => {
  const failure = Object.assign(new Error('Synthetic permission failure'), {
    code: 'EACCES',
  });
  await assert.rejects(
    () =>
      readPlainDirectory('synthetic-root', {
        readNames: async () => {
          throw failure;
        },
        readMetadata: async () => metadata('directory'),
      }),
    (error) => error === failure,
  );
});

test('local filesystem: root and child metadata errors propagate without partial success', async () => {
  const failure = Object.assign(new Error('Synthetic missing file'), {
    code: 'ENOENT',
  });
  await assert.rejects(
    () =>
      plainMetadata('synthetic-path', async () => {
        throw failure;
      }),
    (error) => error === failure,
  );
  const root = join(tmpdir(), 'synthetic-disappearing-file');
  await assert.rejects(
    () =>
      readPlainDirectory(root, {
        readNames: async () => ['present.txt', 'vanished.txt'],
        readMetadata: async (path) => {
          if (path === root) return metadata('directory');
          if (path === join(root, 'present.txt')) return metadata('file');
          throw failure;
        },
      }),
    (error) => error === failure,
  );
});

test('local filesystem: empty real directory remains a valid empty listing', async (t) => {
  const root = await fixture(t);
  assert.deepEqual(await readPlainDirectory(root), []);
});
