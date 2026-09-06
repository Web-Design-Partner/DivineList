import { createHash } from 'node:crypto';
import { readFile, lstat } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { createStationServer } from './station/server.mjs';

const root = dirname(fileURLToPath(import.meta.url));

async function verifyPackage() {
  const manifest = JSON.parse(
    await readFile(resolve(root, 'package-manifest.json'), 'utf8'),
  );
  if (
    manifest.version !== 1 ||
    !Array.isArray(manifest.files) ||
    manifest.files.length < 8
  )
    throw new Error(
      'Paketets filförteckning saknas eller är ogiltig. Packa upp ZIP-filen igen.',
    );
  const seen = new Set();
  for (const item of manifest.files) {
    if (
      typeof item.path !== 'string' ||
      !/^[A-Za-z0-9_./-]+$/u.test(item.path) ||
      item.path
        .split('/')
        .some((part) => !part || part === '.' || part === '..') ||
      seen.has(item.path)
    )
      throw new Error('Paketet innehåller en otillåten eller upprepad sökväg.');
    seen.add(item.path);
    const path = resolve(root, item.path);
    if (
      isAbsolute(relative(root, path)) ||
      relative(root, path).startsWith(`..${sep}`)
    )
      throw new Error('En paketresurs ligger utanför programmappen.');
    let cursor = root;
    for (const part of item.path.split('/')) {
      cursor = resolve(cursor, part);
      if ((await lstat(cursor)).isSymbolicLink())
        throw new Error('Paketets resurser får inte vara länkar.');
    }
    const info = await lstat(path);
    if (!info.isFile()) throw new Error('En paketresurs är ingen vanlig fil.');
    const bytes = await readFile(path);
    if (
      bytes.length !== item.bytes ||
      createHash('sha256').update(bytes).digest('hex') !== item.sha256
    )
      throw new Error(
        `Paketresursen ${item.path} har ändrats. Packa upp ZIP-filen igen.`,
      );
  }
  for (const required of [
    'DivineList.exe',
    'node.exe',
    'station-server.mjs',
    'dist/station/manifest.json',
    'dist/station/index.html',
    'dist/station/assets/station.js',
    'dist/station/assets/station.css',
  ])
    if (!seen.has(required)) throw new Error(`Paketet saknar ${required}.`);
}

async function main() {
  const args = process.argv.slice(2);
  let port = 8790;
  let dataDir =
    process.env.LOCALAPPDATA &&
    resolve(process.env.LOCALAPPDATA, 'DivineList/station-data');
  const provided = new Set();
  while (args.length) {
    const flag = args.shift();
    const value = args.shift();
    if (!value || provided.has(flag))
      throw new Error('Ogiltiga startargument.');
    provided.add(flag);
    if (
      flag === '--port' &&
      /^\d{1,5}$/u.test(value) &&
      Number(value) > 0 &&
      Number(value) <= 65535
    )
      port = Number(value);
    else if (
      flag === '--data-dir' &&
      isAbsolute(value) &&
      !value.startsWith('\\\\')
    )
      dataDir = resolve(value);
    else
      throw new Error(
        'Använd [--port 8790] [--data-dir <absolut lokal mapp>].',
      );
  }
  if (!dataDir)
    throw new Error(
      'LOCALAPPDATA saknas. Ange en lokal datamapp med --data-dir.',
    );
  await verifyPackage();
  let app;
  let closing = false;
  let input;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    input?.close();
    process.stdin.pause();
    process.stdin.destroy();
    if (app) await app.close();
    console.log('DIVINELIST_STOPPED');
  };
  try {
    app = await createStationServer({ root, dataDir });
    await new Promise((resolveListen, reject) => {
      app.server.once('error', reject);
      app.server.listen(port, '127.0.0.1', resolveListen);
    });
    console.log(
      `DIVINELIST_READY:${process.env.DIVINELIST_LAUNCH_TOKEN ?? 'terminal'}:${port}`,
    );
    console.log(
      `DivineList: http://127.0.0.1:${port}/. Kön är pausad vid start.`,
    );
    for (const signal of ['SIGINT', 'SIGTERM'])
      process.once(signal, () => void shutdown().catch(fail));
    input = createInterface({ input: process.stdin, terminal: false });
    input.on('line', (line) => {
      if (line === 'DIVINELIST_STOP') void shutdown().catch(fail);
    });
    // A launcher owns this child. Losing its input pipe must not leave a server behind.
    if (process.env.DIVINELIST_LAUNCH_TOKEN)
      input.once('close', () => void shutdown().catch(fail));
  } catch (error) {
    if (app) await app.close();
    if (error.code === 'EADDRINUSE')
      throw new Error(
        `Port ${port} används redan. Avsluta den befintliga stationen eller välj en annan port. Ingen annan process har stoppats.`,
      );
    throw error;
  }
}

function fail(error) {
  console.error(
    `DivineList kunde inte startas eller avslutas: ${error.message}`,
  );
  process.exitCode = 1;
}

await main().catch(fail);
