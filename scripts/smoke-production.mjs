import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const freePort = () =>
  new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) =>
        error || port === 0
          ? reject(error ?? new Error('Port saknas'))
          : resolvePort(port),
      );
    });
  });

const port = await freePort();
const startCandidate = resolve('scripts/start-release-candidate.mjs');
const child = spawn(
  process.execPath,
  [startCandidate, '--port', String(port)],
  {
    env: {
      ...process.env,
      CI: 'true',
      DIVINELIST_RELEASE_CHECK: 'true',
      DIVINELIST_RELEASE_SMOKE: 'true',
      WRANGLER_SEND_ERROR_REPORTS: 'false',
      WRANGLER_SEND_METRICS: 'false',
      WRANGLER_WRITE_LOGS: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  },
);

let logs = '';
const capture = (chunk) => {
  logs = `${logs}${String(chunk)}`.slice(-20_000);
};
child.stdout.on('data', capture);
child.stderr.on('data', capture);

let exited = false;
const exitPromise = new Promise((resolveExit) => {
  child.once('exit', (code, signal) => {
    exited = true;
    resolveExit({ code, signal });
  });
});

const origin = `http://127.0.0.1:${port}`;
const fetchLocal = (pathname, init) =>
  fetch(`${origin}${pathname}`, {
    ...init,
    redirect: 'error',
    signal: AbortSignal.timeout(5_000),
  });

const assertSecurityHeaders = (response, label) => {
  assert.equal(
    response.headers.get('cross-origin-opener-policy'),
    'same-origin',
    `${label}: Cross-Origin-Opener-Policy`,
  );
  assert.equal(
    response.headers.get('cross-origin-resource-policy'),
    'same-origin',
    `${label}: Cross-Origin-Resource-Policy`,
  );
  assert.equal(
    response.headers.get('referrer-policy'),
    'no-referrer',
    `${label}: Referrer-Policy`,
  );
  assert.equal(
    response.headers.get('x-content-type-options'),
    'nosniff',
    `${label}: X-Content-Type-Options`,
  );
  assert.equal(
    response.headers.get('x-frame-options'),
    'DENY',
    `${label}: X-Frame-Options`,
  );
  assert.match(
    response.headers.get('x-robots-tag') ?? '',
    /(?:^|,)\s*noindex(?:,|$)/iu,
    `${label}: X-Robots-Tag`,
  );
  assert.match(
    response.headers.get('permissions-policy') ?? '',
    /camera=\(\)/iu,
    `${label}: Permissions-Policy`,
  );
  const csp = response.headers.get('content-security-policy') ?? '';
  assert.match(csp, /default-src 'self'/iu, `${label}: CSP default-src`);
  assert.match(csp, /frame-ancestors 'none'/iu, `${label}: CSP frame`);
  assert.match(csp, /object-src 'none'/iu, `${label}: CSP object`);
  const nonce = csp.match(/script-src[^;]*'nonce-([^']+)'/iu)?.[1];
  assert.ok(nonce, `${label}: CSP saknar script-nonce.`);
  assert.match(csp, /script-src[^;]*'strict-dynamic'/iu);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/iu);
  return nonce;
};

try {
  const deadline = Date.now() + 45_000;
  let response;
  let lastError;
  while (Date.now() < deadline && !exited) {
    try {
      response = await fetchLocal('/');
      if (response.ok) break;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  if (!response?.ok) {
    throw new Error(
      `Produktionsservern blev inte redo: ${lastError instanceof Error ? lastError.message : 'okänt fel'}\n${logs}`,
    );
  }

  const conflictingChild = spawn(
    process.execPath,
    [startCandidate, '--port', String(port)],
    {
      env: {
        ...process.env,
        CI: 'true',
        DIVINELIST_RELEASE_CHECK: 'true',
        DIVINELIST_RELEASE_SMOKE: 'true',
        WRANGLER_SEND_ERROR_REPORTS: 'false',
        WRANGLER_SEND_METRICS: 'false',
        WRANGLER_WRITE_LOGS: 'false',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  let conflictingLogs = '';
  const captureConflict = (chunk) => {
    conflictingLogs = `${conflictingLogs}${String(chunk)}`.slice(-10_000);
  };
  conflictingChild.stdout.on('data', captureConflict);
  conflictingChild.stderr.on('data', captureConflict);
  const conflictingExit = await Promise.race([
    new Promise((resolveExit) =>
      conflictingChild.once('exit', (code, signal) =>
        resolveExit({ code, signal, timedOut: false }),
      ),
    ),
    delay(10_000).then(() => ({ code: null, signal: null, timedOut: true })),
  ]);
  if (conflictingExit.timedOut) {
    conflictingChild.kill('SIGKILL');
    throw new Error('En andra serverstart stoppades inte vid portkonflikt.');
  }
  assert.notEqual(
    conflictingExit.code,
    0,
    'En andra serverstart på samma port fick inte lyckas.',
  );
  assert.match(
    conflictingLogs,
    new RegExp(`Port ${port} används redan`, 'u'),
    'Portkonflikten gav inte det förväntade tydliga felet.',
  );

  const stillRunning = await fetchLocal('/');
  assert.equal(stillRunning.status, 200);
  await stillRunning.body?.cancel();

  const html = await response.text();
  assert.match(response.headers.get('content-type') ?? '', /^text\/html\b/iu);
  const rootNonce = assertSecurityHeaders(response, 'GET /');
  assert.match(html, /Evidensverkstaden/u);
  assert.match(html, /ingen skanning/u);
  assert.match(html, /ingen automatisk kontakt/u);
  assert.match(html, /<html[^>]+lang=["']sv["']/iu);
  assert.match(
    html,
    /<a[^>]+href=["']#main-content["'][^>]*>\s*Hoppa till huvudinnehåll\s*<\/a>/iu,
  );
  assert.match(html, /<main[^>]+id=["']main-content["'][^>]*>/iu);
  assert.match(html, /<nav[^>]+aria-label=["']Huvudvyer["'][^>]*>/iu);
  assert.match(html, /aria-live=["']polite["']/iu);
  assert.match(
    html,
    /<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*noindex/iu,
  );
  assert.match(
    html,
    /<link[^>]+rel=["']icon["'][^>]+href=["']\/favicon\.svg["']/iu,
  );
  const scriptTags = [...html.matchAll(/<script\b[^>]*>/giu)].map(
    ([tag]) => tag,
  );
  assert.ok(scriptTags.length > 0, 'HTML-svaret saknar script-taggar.');
  for (const tag of scriptTags) {
    assert.match(
      tag,
      new RegExp(`\\bnonce=["']${rootNonce}["']`, 'u'),
      'En script-tagg saknar begärans CSP-nonce.',
    );
  }
  const inlineStyleTags = [...html.matchAll(/<style\b[^>]*>/giu)].map(
    ([tag]) => tag,
  );
  for (const tag of inlineStyleTags) {
    assert.match(
      tag,
      new RegExp(`\\bnonce=["']${rootNonce}["']`, 'u'),
      'En inline style-tagg saknar begärans CSP-nonce.',
    );
  }

  const head = await fetchLocal('/', { method: 'HEAD' });
  assert.equal(head.status, 200);
  const headNonce = assertSecurityHeaders(head, 'HEAD /');
  assert.notEqual(
    headNonce,
    rootNonce,
    'CSP-nonce återanvändes mellan begäranden.',
  );
  assert.equal((await head.arrayBuffer()).byteLength, 0);

  const missing = await fetchLocal('/__divinelist_missing__');
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get('content-type') ?? '', /^text\/html\b/iu);
  assertSecurityHeaders(missing, 'GET 404');

  const localExplorer = await fetchLocal('/cdn-cgi/local/explorer/api');
  assert.equal(
    localExplorer.status,
    404,
    'Wranglers Local Explorer API får inte vara aktiv i den lokala releasen.',
  );
  assertSecurityHeaders(localExplorer, 'GET Local Explorer 404');

  const robots = await fetchLocal('/robots.txt');
  assert.equal(robots.status, 200);
  assert.match(robots.headers.get('content-type') ?? '', /^text\/plain\b/iu);
  assert.match(await robots.text(), /User-agent:\s*\*[\s\S]*Disallow:\s*\//iu);
  assert.equal(robots.headers.get('x-content-type-options'), 'nosniff');

  const favicon = await fetchLocal('/favicon.svg');
  assert.equal(favicon.status, 200);
  assert.match(
    favicon.headers.get('content-type') ?? '',
    /^image\/svg\+xml\b/iu,
  );
  assert.equal(
    favicon.headers.get('cross-origin-resource-policy'),
    'same-origin',
  );

  const scriptPath = html.match(
    /src=["'](\/_next\/static\/[^"']+\.js)["']/iu,
  )?.[1];
  assert.ok(scriptPath, 'HTML-svaret saknar en hashad JavaScriptresurs.');
  const script = await fetchLocal(scriptPath);
  assert.equal(script.status, 200);
  assert.match(
    script.headers.get('content-type') ?? '',
    /(?:java|ecma)script/iu,
  );
  assert.match(
    script.headers.get('cache-control') ?? '',
    /max-age=31536000[^\r\n]*immutable/iu,
  );
  assert.equal(script.headers.get('x-content-type-options'), 'nosniff');

  console.log(
    JSON.stringify({
      status: 'PASS',
      contentType: response.headers.get('content-type'),
      htmlBytes: Buffer.byteLength(html, 'utf8'),
      missingStatus: missing.status,
      robotsDisallowAll: true,
      semanticLandmarks: true,
      securityHeaders: true,
      staticAssetImmutable: true,
      telemetryDisabled: true,
      loopbackOnly: true,
      localExplorerDisabled: true,
      portConflictRejected: true,
    }),
  );
} finally {
  if (child.exitCode === null) child.kill('SIGTERM');
  await Promise.race([exitPromise, delay(5_000)]);
  if (!exited) {
    child.kill('SIGKILL');
    await Promise.race([exitPromise, delay(5_000)]);
  }
  assert.ok(exited, 'Smoketestets lokala serverprocess kunde inte stoppas.');
}
