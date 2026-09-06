import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isPublicAddress,
  publicUrl,
  publicRequest,
  robotsAllows,
  extractHtmlFacts,
  inspectSite,
  osmCompanies,
  validateModelReport,
  gothenburgCompanies,
  selectNewCompanies,
  GOTHENBURG_DISCOVERY_QUERY,
} from '../scripts/station/network.mjs';

void test('Gothenburg discovery uses municipality code and rejects missing or wrong area proof', () => {
  assert.match(GOTHENBURG_DISCOVERY_QUERY, /"ref:scb"="1480"/u);
  const area = {
    type: 'area',
    id: 3600935611,
    tags: {
      'ref:scb': '1480',
      admin_level: '7',
      boundary: 'administrative',
      name: 'Göteborgs Stad',
    },
  };
  const business = {
    type: 'node',
    id: 1,
    tags: { name: 'Syntetisk butik', website: 'https://shop.se' },
  };
  assert.equal(gothenburgCompanies({ elements: [area, business] }).length, 1);
  assert.throws(
    () => gothenburgCompanies({ elements: [business] }),
    /kommunområde/u,
  );
  assert.throws(
    () =>
      gothenburgCompanies({
        elements: [
          { ...area, tags: { ...area.tags, 'ref:scb': '1481' } },
          business,
        ],
      }),
    /kommunområde/u,
  );
});

void test('larger discoveries skip existing sources and domains instead of selecting the same first rows', () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({
    domain: `business${i}.se`,
    sourceUrl: `https://www.openstreetmap.org/node/${i}`,
  }));
  assert.deepEqual(selectNewCompanies(rows, [rows[0], rows[1]], 2), [
    rows[2],
    rows[3],
  ]);
  assert.equal(
    selectNewCompanies(
      rows,
      [{ domain: rows[0].domain, sourceUrl: 'import.md' }],
      1,
    )[0].domain,
    rows[1].domain,
  );
});

void test('station network blocks private, mapped, special and documentation addresses', () => {
  for (const address of [
    '127.0.0.1',
    '10.0.0.1',
    '172.16.4.3',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.1.2',
    '0.0.0.0',
    '224.0.0.1',
    '192.0.2.1',
    '198.18.0.1',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    'fe80::1',
    '2001:db8::1',
    '2002:7f00:1::1',
    '3fff::1',
  ])
    assert.equal(isPublicAddress(address), false, address);
  for (const address of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111'])
    assert.equal(isPublicAddress(address), true, address);
});

void test('station URL validation rejects local targets and credentials before any DNS access', async () => {
  for (const value of [
    'file:///tmp/data',
    'ftp://site.se/',
    'http://127.1/',
    'http://2130706433/',
    'http://[::1]/',
    'http://localhost/',
    'https://server.local/',
    'https://a.test/',
    'https://a.example/',
    'http://a.se:11434/',
    'https://user:pass@site.se/',
  ]) {
    assert.throws(() => publicUrl(value), undefined, value);
    await assert.rejects(publicRequest(value));
  }
  assert.equal(publicUrl('https://företag.se/#content').hash, '');
});

void test('robots handles group specificity, longest match, wildcard, allow and crawl delay conservatively', () => {
  assert.equal(robotsAllows('User-agent: *\nDisallow: /', '/'), false);
  assert.equal(
    robotsAllows(
      'User-agent: *\nDisallow: /private\nAllow: /private/open',
      '/private/open',
    ),
    true,
  );
  assert.equal(
    robotsAllows('User-agent: *\nDisallow: /*.pdf$', '/a.pdf'),
    false,
  );
  assert.equal(
    robotsAllows(
      'User-agent: *\nDisallow: /\nUser-agent: DivineListLocal\nAllow: /',
      '/',
    ),
    true,
  );
  assert.equal(robotsAllows('User-agent: *\nCrawl-delay: 20', '/'), false);
  assert.equal(
    robotsAllows('User-agent: *\nCrawl-delay: 20\nAllow: /', '/'),
    false,
  );
});

void test('canonical robots redirects are bounded and raw HTML is saved before returning observations', async () => {
  const saved = [];
  const html = Buffer.from('<html lang="sv"><title>Test</title></html>');
  const facts = await inspectSite('site.se', {
    request: async (url) => {
      if (url === 'https://site.se/robots.txt')
        return {
          status: 301,
          headers: { location: 'https://www.site.se/robots.txt' },
        };
      if (url.endsWith('/robots.txt'))
        return { status: 200, bytes: Buffer.from('User-agent: *\nAllow: /') };
      return {
        status: 200,
        headers: { 'content-type': 'text/html' },
        bytes: html,
      };
    },
    saveEvidence: async (bytes, observed) => saved.push({ bytes, observed }),
  });
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].bytes, html);
  assert.equal(saved[0].observed.sha256, facts.sha256);
  await assert.rejects(
    inspectSite('site.se', {
      request: async () => ({
        status: 302,
        headers: { location: 'https://elsewhere.se/robots.txt' },
      }),
    }),
    /annan domän/u,
  );
});

void test('HTML observation uses the parsed document and cannot confuse scripts/templates with metadata', () => {
  const html =
    '<!doctype html><html lang="sv"><head><title>Kafé &amp; Co</title><meta NAME="description" content="Lokal butik"></head><body><script>"<meta name=viewport content=x>"</script><template><meta name=viewport content=x></template><textarea><meta name=viewport content=x></textarea></body></html>';
  const facts = extractHtmlFacts(html, {
    url: 'https://site.se/',
    statusCode: 200,
  });
  assert.equal(facts.title, 'Kafé & Co');
  assert.equal(facts.description, 'Lokal butik');
  assert.equal(facts.lang, 'sv');
  assert.equal(facts.hasViewport, false);
  assert.match(facts.sha256, /^sha256:[0-9a-f]{64}$/u);
  assert.match(facts.evidenceScope, /Ingen JavaScript/u);
  assert.equal(
    extractHtmlFacts('<meta name="viewport" content="  ">', {
      url: 'https://site.se/',
      statusCode: 200,
    }).hasViewport,
    false,
  );
});

void test('website inspection enforces robots before content and stops foreign redirects', async () => {
  let requests = 0;
  await assert.rejects(
    inspectSite('site.se', {
      request: async () => {
        requests += 1;
        return {
          status: 200,
          bytes: Buffer.from('User-agent: *\nDisallow: /'),
        };
      },
    }),
    /robots/u,
  );
  assert.equal(requests, 1);
  await assert.rejects(
    inspectSite('site.se', {
      request: async (url) =>
        url.endsWith('/robots.txt')
          ? { status: 404, bytes: Buffer.alloc(0) }
          : { status: 302, headers: { location: 'https://different.se/' } },
    }),
    /annan domän/u,
  );
});

void test('website inspection checks robots after same-site redirects and refuses challenges', async () => {
  const urls = [];
  const facts = await inspectSite('site.se', {
    request: async (url) => {
      urls.push(url);
      if (url.endsWith('/robots.txt'))
        return { status: 404, bytes: Buffer.alloc(0) };
      if (url === 'https://site.se/')
        return { status: 301, headers: { location: 'https://www.site.se/' } };
      return {
        status: 200,
        headers: { 'content-type': 'text/html' },
        bytes: Buffer.from(
          '<html><head><title>Butik</title></head><body><div class="g-recaptcha">Contact form</div></body></html>',
        ),
      };
    },
  });
  assert.equal(facts.url, 'https://www.site.se/');
  assert.equal(urls.filter((url) => url.endsWith('/robots.txt')).length, 2);
  await assert.rejects(
    inspectSite('site.se', {
      request: async (url) =>
        url.endsWith('/robots.txt')
          ? { status: 404, bytes: Buffer.alloc(0) }
          : {
              status: 200,
              headers: { 'content-type': 'text/html' },
              bytes: Buffer.from('Verify you are human'),
            },
    }),
    /Åtkomst/u,
  );
});

void test('OSM extraction preserves sources, bounds count and distinguishes missing website from a finding', () => {
  const row = (id, name, website) => ({
    type: 'node',
    id,
    tags: { name, website },
  });
  const rows = osmCompanies(
    {
      elements: [
        row(1, 'Butik', 'www.shop.se'),
        row(2, 'Dubblett', 'https://shop.se/'),
        row(3, 'Okänd webbadress'),
        row(4, 'Annan', 'https://another.se'),
      ],
    },
    2,
    '2026-09-05T00:00:00Z',
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].sourceUrl, 'https://www.openstreetmap.org/node/1');
  assert.equal(rows[0].domain, 'shop.se');
  assert.equal(rows[1].domain, null);
  assert(!Object.hasOwn(rows[1], 'report'));
  assert.throws(() => osmCompanies({ remark: 'timeout', elements: [] }));
});

void test('model output must have exact bounded report fields and never accepts tool instructions as fields', () => {
  assert.deepEqual(
    validateModelReport({
      summary: 'Förslag',
      suggestions: [],
      unknowns: ['Saknar mätning'],
    }).unknowns,
    ['Saknar mätning'],
  );
  for (const value of [
    null,
    { summary: 'ok', suggestions: [], unknowns: [], tool: 'exec' },
    { summary: 'ok', suggestions: ['a'.repeat(1001)], unknowns: [] },
    { summary: 'ok', suggestions: [], unknowns: 'ok' },
  ])
    assert.throws(() => validateModelReport(value));
});
