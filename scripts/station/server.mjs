import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { readFile, open, unlink, lstat } from 'node:fs/promises';
import { freemem, totalmem } from 'node:os';
import { resolve } from 'node:path';
import { createStationRuntime } from './runtime.mjs';
import { chat, discover, inspectSite, probeOllama } from './network.mjs';
import { ensurePlainDirectory, saveSourceEvidence } from './storage.mjs';
import { createObsidianBridge } from './obsidian.mjs';

export async function verifyStationBuild(root) {
  const directory = resolve(root, 'dist/station');
  const manifest = JSON.parse(
    await readFile(resolve(directory, 'manifest.json'), 'utf8'),
  );
  if (
    manifest.version !== 1 ||
    !Array.isArray(manifest.files) ||
    manifest.files.length !== 3
  )
    throw new Error(
      'Skeppets byggmanifest är ogiltigt. Kör npm run build:station.',
    );
  const expected = ['index.html', 'assets/station.js', 'assets/station.css'];
  for (const name of expected) {
    const item = manifest.files.find((file) => file.path === name);
    if (!item) throw new Error('Skeppets byggmanifest saknar en resurs.');
    const path = resolve(directory, name);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error('Otillåten byggresurs.');
    const content = await readFile(path);
    if (
      content.length !== item.bytes ||
      createHash('sha256').update(content).digest('hex') !== item.sha256
    )
      throw new Error(
        'Skeppets byggfiler har ändrats. Kör npm run build:station.',
      );
  }
  return directory;
}

export async function createStationServer({
  root,
  dataDir = resolve(root, 'work/station-data'),
  dependencies = {},
  requireBuild = true,
} = {}) {
  const assets = requireBuild
    ? await verifyStationBuild(root)
    : resolve(root, 'dist/station');
  await ensurePlainDirectory(dataDir);
  const lockPath = resolve(dataDir, 'process.lock');
  let lock;
  try {
    lock = await open(lockPath, 'wx');
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const raw = await readFile(lockPath, 'utf8');
    const pid = Number(raw);
    if (!Number.isSafeInteger(pid) || pid < 1)
      throw new Error(
        'Ogiltigt processlås. Bevara datamappen och kontrollera låset manuellt.',
      );
    try {
      process.kill(pid, 0);
      throw new Error(
        'DivineList använder redan denna arbetskopia. Öppna den befintliga stationen.',
      );
    } catch (probe) {
      if (probe.code !== 'ESRCH') throw probe;
    }
    if ((await readFile(lockPath, 'utf8')) !== raw)
      throw new Error('Arbetskopians lås ändrades. Försök igen.');
    await unlink(lockPath);
    lock = await open(lockPath, 'wx');
  }
  await lock.writeFile(String(process.pid));
  await lock.close();
  let runtime;
  let obsidian;
  try {
    obsidian = await createObsidianBridge({ dataDir });
    runtime = await createStationRuntime({
      dataDir,
      discover: (options) =>
        discover({
          ...options,
          saveEvidence: (bytes) =>
            saveSourceEvidence(
              dataDir,
              bytes,
              {
                sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
              },
              'json',
            ),
        }),
      inspectSite: (domain, options) =>
        inspectSite(domain, {
          ...options,
          saveEvidence: (bytes, facts) =>
            saveSourceEvidence(dataDir, bytes, facts),
        }),
      chat,
      ...dependencies,
      onCompaniesChanged: async (companies, options) => {
        if (!obsidian.getState().enabled) return undefined;
        return obsidian.sync(companies, options);
      },
    });
  } catch (error) {
    await obsidian?.close();
    await unlink(lockPath);
    throw error;
  }
  const token = randomBytes(32).toString('hex');
  let ollama = {
      available: false,
      models: [],
      error: 'Anslutningen kontrolleras.',
    },
    probeAt = 0,
    probing;
  const probe = () => {
    probing ??= (dependencies.probeOllama ?? probeOllama)()
      .then((result) => {
        ollama = result;
        probeAt = Date.now();
      })
      .finally(() => {
        probing = undefined;
      });
    return probing;
  };
  try {
    await probe();
  } catch (error) {
    await runtime.close();
    await obsidian.close();
    await unlink(lockPath);
    throw error;
  }
  let obsidianMutation = false;
  const state = () => ({
    ...runtime.getState(),
    csrfToken: token,
    ollama,
    obsidian: obsidian.getState(),
    hardware: {
      freeRamGB: Number((freemem() / 2 ** 30).toFixed(1)),
      totalRamGB: Number((totalmem() / 2 ** 30).toFixed(1)),
    },
  });
  const server = createServer({ maxHeaderSize: 16_384 }, async (req, res) => {
    const address = server.address();
    const origin = `http://127.0.0.1:${address.port}`;
    const send = (status, value, type = 'application/json; charset=utf-8') => {
      res.writeHead(status, { 'content-type': type });
      res.end(
        req.method === 'HEAD'
          ? undefined
          : type.startsWith('application/json')
            ? JSON.stringify(value)
            : value,
      );
    };
    res.setHeader(
      'content-security-policy',
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'",
    );
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('x-robots-tag', 'noindex, nofollow, noarchive');
    res.setHeader(
      'permissions-policy',
      'camera=(), microphone=(), geolocation=()',
    );
    res.setHeader('cache-control', 'no-store');
    try {
      if (
        req.headers.host !== `127.0.0.1:${address.port}` ||
        (req.headers.origin && req.headers.origin !== origin) ||
        req.headers['sec-fetch-site'] === 'cross-site'
      )
        return send(403, {
          error: 'Endast den lokala DivineList-stationen får använda tjänsten.',
        });
      const url = new URL(req.url, origin);
      if (req.method === 'GET' || req.method === 'HEAD') {
        if (url.pathname === '/api/state') {
          if (Date.now() - probeAt > 15_000) await probe();
          return send(200, state());
        }
        if (url.pathname === '/api/obsidian/vaults')
          return send(200, await obsidian.listVaults());
        if (url.pathname === '/api/export') {
          const markdown = url.searchParams.get('format') === 'markdown';
          res.setHeader(
            'content-disposition',
            `attachment; filename="divinelist-${new Date().toISOString().slice(0, 10)}.${markdown ? 'md' : 'json'}"`,
          );
          return send(
            200,
            markdown
              ? runtime.exportMarkdown()
              : {
                  version: 'divinelist.station-export.v1',
                  exportedAt: new Date().toISOString(),
                  kind: 'agent_drafts',
                  sourceAttribution: runtime
                    .getState()
                    .companies.some(
                      (company) => company.sourceKind === 'openstreetmap',
                    )
                    ? {
                        attribution: '© OpenStreetMap contributors',
                        license: 'ODbL',
                        url: 'https://www.openstreetmap.org/copyright',
                      }
                    : null,
                  companies: runtime.getState().companies,
                },
            markdown
              ? 'text/markdown; charset=utf-8'
              : 'application/json; charset=utf-8',
          );
        }
        const files = {
          '/': ['index.html', 'text/html; charset=utf-8'],
          '/assets/station.js': [
            'assets/station.js',
            'text/javascript; charset=utf-8',
          ],
          '/assets/station.css': [
            'assets/station.css',
            'text/css; charset=utf-8',
          ],
        };
        if (url.pathname === '/robots.txt')
          return send(200, 'User-agent: *\nDisallow: /\n', 'text/plain');
        const file = Object.hasOwn(files, url.pathname)
          ? files[url.pathname]
          : null;
        if (!file) return send(404, { error: 'Sidan finns inte.' });
        return send(200, await readFile(resolve(assets, file[0])), file[1]);
      }
      if (req.method !== 'POST')
        return send(405, { error: 'Metoden stöds inte.' });
      if (
        req.headers.origin !== origin ||
        req.headers['x-divinelist-token'] !== token ||
        !/^application\/json(?:;|$)/iu.test(req.headers['content-type'] ?? '')
      )
        return send(403, {
          error: 'Begäran saknar lokal behörighet. Ladda om sidan.',
        });
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 2_200_000)
          return send(413, { error: 'Indata överstiger 2 MB.' });
        chunks.push(chunk);
      }
      const body = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
      );
      if (!body || typeof body !== 'object' || Array.isArray(body))
        return send(400, { error: 'Begäran måste vara ett JSON-objekt.' });
      if (obsidianMutation)
        return send(409, {
          error:
            'Obsidian-inställningar eller en manuell synkning pågår. Vänta tills skrivkön är klar.',
        });
      if (
        url.pathname === '/api/obsidian/config' ||
        url.pathname === '/api/obsidian/sync'
      ) {
        runtime.assertIdle();
        obsidianMutation = true;
        try {
          if (url.pathname === '/api/obsidian/config')
            await obsidian.configure(body);
          else {
            if (Object.keys(body).length)
              return send(400, {
                error:
                  'Manuell synkning använder endast den sparade företagslistan. Skicka ett tomt objekt.',
              });
            await obsidian.sync(runtime.getState().companies);
          }
        } finally {
          obsidianMutation = false;
        }
      } else if (url.pathname === '/api/config') await runtime.configure(body);
      else if (url.pathname === '/api/automation')
        await runtime.setAutomation(body);
      else if (url.pathname === '/api/command') await runtime.command(body);
      else if (url.pathname === '/api/control') {
        if (['start', 'resume'].includes(body.action)) {
          await probe();
          if (
            !ollama.available ||
            !ollama.models.includes(runtime.getState().model)
          )
            return send(503, {
              error:
                'Starta Ollama och välj en installerad lokal modell innan du kör kön.',
            });
          if (freemem() < 1_000_000_000)
            return send(503, {
              error: 'Mindre än 1 GB ledigt RAM. Frigör minne före start.',
            });
        }
        await runtime.control(body.action);
      } else if (url.pathname === '/api/import')
        await runtime.importFiles(body.files);
      else if (url.pathname === '/api/probe') await probe();
      else return send(404, { error: 'Okänt kommando.' });
      return send(200, state());
    } catch (error) {
      return send(
        error.statusCode ??
          (error instanceof SyntaxError || error instanceof TypeError
            ? 400
            : 500),
        {
          error: error.message || 'Det lokala kommandot kunde inte slutföras.',
        },
      );
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  const releaseProcessLock = async () => {
    try {
      if ((await readFile(lockPath, 'utf8')) === String(process.pid))
        await unlink(lockPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  };
  let closing;
  const close = () => {
    closing ??= (async () => {
      try {
        await runtime.close();
      } finally {
        try {
          await obsidian.close();
        } finally {
          try {
            if (server.listening) {
              server.closeAllConnections();
              await new Promise((resolveClose, reject) =>
                server.close((e) => (e ? reject(e) : resolveClose())),
              );
            }
          } finally {
            await releaseProcessLock();
          }
        }
      }
    })();
    return closing;
  };
  return { server, runtime, obsidian, close };
}
