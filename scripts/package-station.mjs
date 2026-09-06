import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile, lstat } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PROJECT_ROOT } from './build-manifest-lib.mjs';
import { readPlainDirectory, plainMetadata } from './lib/local-filesystem.mjs';
import { verifyStationBuild } from './station/server.mjs';

async function run(executable, args, options = {}) {
  await new Promise((resolveRun, reject) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0
        ? resolveRun()
        : reject(
            new Error(
              `${basename(executable)} misslyckades (${code}): ${output.slice(-8000)}`,
            ),
          ),
    );
  });
}

async function copyTree(source, destination) {
  await mkdir(destination);
  for (const entry of await readPlainDirectory(source)) {
    const from = resolve(source, entry.name);
    const to = resolve(destination, entry.name);
    if (entry.kind === 'directory') await copyTree(from, to);
    else await copyFile(from, to);
  }
}

async function inventory(root, prefix = '') {
  const result = [];
  for (const entry of await readPlainDirectory(resolve(root, prefix))) {
    const name = `${prefix}${entry.name}`;
    if (entry.kind === 'directory')
      result.push(...(await inventory(root, `${name}/`)));
    else {
      const bytes = await readFile(resolve(root, name));
      result.push({
        path: name,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
  }
  return result;
}

export async function packageStation({
  root = PROJECT_ROOT,
  outputParent = resolve(root, 'outputs'),
  nodeExe = process.execPath,
} = {}) {
  if (process.platform !== 'win32' || process.arch !== 'x64')
    throw new Error(
      'Windows-paketet byggs med Windows x64 och dess .NET Framework-kompilator.',
    );
  const compiler = resolve(
    process.env.WINDIR ?? 'C:/Windows',
    'Microsoft.NET/Framework64/v4.0.30319/csc.exe',
  );
  await plainMetadata(compiler);
  await plainMetadata(nodeExe);
  await verifyStationBuild(root);
  const sourceManifest = await readFile(
    resolve(root, 'dist/station/manifest.json'),
  );
  await mkdir(outputParent, { recursive: true });
  let name = 'DivineList-Station-Windows-x64';
  try {
    await lstat(resolve(outputParent, name));
    name += `-${new Date().toISOString().replace(/[:.]/gu, '-')}-${randomBytes(2).toString('hex')}`;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const directory = resolve(outputParent, name);
  await mkdir(directory);
  const bundle = await build({
    entryPoints: [resolve(root, 'scripts/portable-station-entry.mjs')],
    outfile: resolve(directory, 'station-server.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    minify: true,
    legalComments: 'inline',
    metafile: true,
    logLevel: 'warning',
  });
  await copyFile(nodeExe, resolve(directory, 'node.exe'));
  await mkdir(resolve(directory, 'dist'));
  await copyTree(
    resolve(root, 'dist/station'),
    resolve(directory, 'dist/station'),
  );
  await run(compiler, [
    '/nologo',
    '/target:winexe',
    '/platform:x64',
    '/optimize+',
    '/utf8output',
    '/r:System.Windows.Forms.dll',
    '/r:System.Drawing.dll',
    '/r:System.Web.Extensions.dll',
    `/out:${resolve(directory, 'DivineList.exe')}`,
    resolve(root, 'windows-launcher/DivineList.cs'),
  ]);
  await mkdir(resolve(directory, 'licenses'));
  await copyFile(
    resolve(dirname(nodeExe), 'LICENSE'),
    resolve(directory, 'licenses/Node-LICENSE.txt'),
  );
  const dependencies = new Set(['react', 'react-dom', 'scheduler']);
  for (const input of Object.keys(bundle.metafile.inputs)) {
    const match = input
      .replaceAll('\\', '/')
      .match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)/u);
    if (match) dependencies.add(match[1]);
  }
  const notices = [
    `DivineList Agentstation – medföljande komponenter\nByggd: ${new Date().toISOString()}\nNode.js ${process.version}: licenses/Node-LICENSE.txt\n\nOllama och modellvikter ingår inte i detta paket. Deras respektive licenser gäller separat.\n`,
  ];
  for (const dependency of [...dependencies].sort()) {
    const dependencyRoot = resolve(root, 'node_modules', dependency);
    const metadata = JSON.parse(
      await readFile(resolve(dependencyRoot, 'package.json'), 'utf8'),
    );
    const entries = await readPlainDirectory(dependencyRoot);
    const license = entries.find(
      (item) =>
        item.kind === 'file' && /^licen[cs]e(?:\..*)?$/iu.test(item.name),
    );
    if (!license)
      throw new Error(
        `Paketet kan inte levereras utan licens för ${dependency}.`,
      );
    const licenseName = `${dependency.replaceAll('/', '-').replaceAll('@', '')}-LICENSE.txt`;
    await copyFile(
      resolve(dependencyRoot, license.name),
      resolve(directory, 'licenses', licenseName),
    );
    notices.push(
      `${dependency} ${metadata.version}\nLicens: ${metadata.license}\nFil: licenses/${licenseName}\nKälla: ${typeof metadata.repository === 'string' ? metadata.repository : (metadata.repository?.url ?? 'Se paketets licens')}\n`,
    );
  }
  await writeFile(
    resolve(directory, 'THIRD-PARTY-NOTICES.txt'),
    `${notices.join('\n')}\n`,
  );
  await copyFile(
    resolve(root, 'docs/PORTABLE.md'),
    resolve(directory, 'START-HERE.md'),
  );
  await verifyStationBuild(directory);
  if (
    !(await readFile(resolve(root, 'dist/station/manifest.json'))).equals(
      sourceManifest,
    )
  )
    throw new Error(
      'Stationsbygget ändrades medan Windows-paketet byggdes. Bygg paketet igen.',
    );
  const files = await inventory(directory);
  const manifest = {
    version: 1,
    product: 'DivineList Agentstation',
    createdAt: new Date().toISOString(),
    platform: 'win32-x64',
    nodeVersion: process.version,
    files,
  };
  await writeFile(
    resolve(directory, 'package-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  const zip = `${directory}.zip`;
  // PowerShell receives fixed code and paths through child-only environment variables.
  // CreateNew semantics in CreateFromDirectory never overwrite an earlier release.
  await run(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory($env:DIVINELIST_PACKAGE_SOURCE, $env:DIVINELIST_PACKAGE_ZIP, [System.IO.Compression.CompressionLevel]::Optimal, $false)',
    ],
    {
      env: {
        ...process.env,
        DIVINELIST_PACKAGE_SOURCE: directory,
        DIVINELIST_PACKAGE_ZIP: zip,
      },
    },
  );
  const zipBytes = await readFile(zip);
  const checksum = createHash('sha256').update(zipBytes).digest('hex');
  await writeFile(`${zip}.sha256`, `${checksum}  ${basename(zip)}\n`, {
    flag: 'wx',
  });
  return {
    status: 'PASS',
    directory,
    zip,
    sha256: checksum,
    bytes: zipBytes.length,
    fileCount: files.length,
    nodeVersion: process.version,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    console.log(JSON.stringify(await packageStation(), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
