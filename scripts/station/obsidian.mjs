import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  lstat,
  open,
  link,
  rename,
  unlink,
} from 'node:fs/promises';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from 'node:path';

const UNKNOWN = 'Unknown - needs verification';
const MAX_BYTES = 4_000_000;
const ID = /^[a-f\d]{24}$/;
const STATUS = {
  candidate: 'Kandidat – identitet behöver granskas',
  queued: 'I arbetskön',
  running: 'Bearbetas',
  review: 'Utkast – behöver mänsklig granskning',
  blocked: 'Parkerad – åtkomst eller underlag saknas',
};

function failure(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
function clone(value) {
  return structuredClone(value);
}
function checkSignal(signal) {
  signal?.throwIfAborted();
}
function samePath(a, b) {
  return process.platform === 'win32'
    ? resolve(a).toLowerCase() === resolve(b).toLowerCase()
    : resolve(a) === resolve(b);
}
function contained(root, path) {
  const part = relative(root, path);
  return (
    part === '' ||
    (!part.startsWith(`..${sep}`) && part !== '..' && !isAbsolute(part))
  );
}

async function inspectDirectory(path, { missing = false } = {}) {
  const resolved = resolve(path);
  const parts = relative(parse(resolved).root, resolved)
    .split(sep)
    .filter(Boolean);
  let current = parse(resolved).root;
  for (const part of parts) {
    current = join(current, part);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory())
        throw failure(
          'Sökvägen innehåller en länk eller något som inte är en vanlig katalog.',
          409,
        );
    } catch (error) {
      if (error.code === 'ENOENT' && missing) return;
      throw error;
    }
  }
}

async function ensureDirectory(path) {
  await inspectDirectory(path, { missing: true });
  await mkdir(path, { recursive: true });
  await inspectDirectory(path);
}

async function ordinaryRead(path, maxBytes = MAX_BYTES) {
  const stat = await lstat(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.size > maxBytes
  )
    throw failure('Filen är inte en vanlig, avgränsad fil utan länkar.', 409);
  const handle = await open(path, 'r');
  try {
    const current = await handle.stat();
    if (
      current.dev !== stat.dev ||
      current.ino !== stat.ino ||
      current.size > maxBytes
    )
      throw failure('Filen ändrades under läsning.', 409);
    const bytes = await handle.readFile();
    if (bytes.length > maxBytes) throw failure('Filen är för stor.', 409);
    return bytes;
  } finally {
    await handle.close();
  }
}

function relativeFolder(value) {
  if (
    typeof value !== 'string' ||
    value.length > 160 ||
    isAbsolute(value) ||
    /^[\\/]/.test(value)
  )
    throw failure('Välj en relativ arbetsmapp inuti valvet.');
  const parts = value
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim());
  if (
    !parts.length ||
    parts.length > 4 ||
    parts.some(
      (part) =>
        !/^[\p{L}\p{N}][\p{L}\p{N} _-]{0,63}$/u.test(part) ||
        /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(part),
    )
  )
    throw failure(
      'Arbetsmappen får ha 1–4 mappar med bokstäver, siffror, blanksteg, bindestreck eller understreck.',
    );
  return parts.join('/');
}

async function validateConfiguration(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (key) => !['vaultPath', 'folder', 'enabled'].includes(key),
    )
  )
    throw failure('Obsidian-inställningarna har ett ogiltigt format.');
  if (
    typeof value.vaultPath !== 'string' ||
    value.vaultPath.length > 1000 ||
    !isAbsolute(value.vaultPath) ||
    /^[\\/]{2}/.test(value.vaultPath) ||
    /[\p{Cc}]/u.test(value.vaultPath)
  )
    throw failure(
      'Välj ett befintligt lokalt Obsidian-valv med absolut sökväg.',
    );
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean')
    throw failure('Aktivering måste vara true eller false.');
  const vaultPath = resolve(value.vaultPath);
  if (
    samePath(vaultPath, parse(vaultPath).root) ||
    vaultPath
      .split(/[\\/]/)
      .some((part) => part.toLowerCase() === '.obsidian') ||
    [
      process.env.WINDIR,
      process.env.ProgramFiles,
      process.env['ProgramFiles(x86)'],
      process.env.ProgramData,
    ]
      .filter(Boolean)
      .some((path) => contained(resolve(path), vaultPath))
  )
    throw failure(
      'Enhetsrötter, systemmappar och Obsidian-inställningar kan inte vara arbetsvalv.',
    );
  await inspectDirectory(vaultPath);
  await inspectDirectory(join(vaultPath, '.obsidian'));
  const folder = relativeFolder(value.folder ?? 'DivineList/Agentstation');
  const targetPath = resolve(vaultPath, folder);
  if (!contained(vaultPath, targetPath) || samePath(vaultPath, targetPath))
    throw failure('Arbetsmappen måste ligga inuti valt valv.');
  await inspectDirectory(targetPath, { missing: true });
  return { vaultPath, folder, enabled: value.enabled ?? true };
}

function plain(value, maximum = 8000) {
  if (value === null || value === undefined || value === '') return UNKNOWN;
  return String(value)
    .slice(0, maximum)
    .normalize('NFKC')
    .replace(/[\p{Cc}\u202a-\u202e\u2066-\u2069]/gu, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/%/g, '&#37;')
    .replace(/\$/g, '&#36;')
    .replace(/([\\`*_{}[\]()#!|~])/g, '\\$1')
    .replace(/:/g, '&#58;');
}

function externalLink(value) {
  try {
    const url = new URL(value);
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return '';
    return `[Öppna källan](<${url.href.replace(/[<>"\\]/g, (part) => encodeURIComponent(part))}>)`;
  } catch {
    return '';
  }
}

function wiki(folder, path, label) {
  return `[[${folder}/${path.replace(/\.md$/, '')}|${label}]]`;
}

function query(folder, path) {
  return `\`\`\`query\npath:"${folder}/${path}"\n\`\`\``;
}

function readableName(company) {
  const name = String(company.name)
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|\p{Cc}\u202a-\u202e\u2066-\u2069]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 72);
  return `${name || 'Okänt företag'} - ${company.id.slice(0, 6)}`;
}

function verificationCardPath(company) {
  return `Verifiera/${readableName(company)}.md`;
}

function agentDocuments(folder) {
  const shared = `\n\n## Gemensamma gränser\n\n- Rollen använder samma lokala Ollama-modell som de andra agenterna, en roll i taget.\n- Resultatet är ett lokalt arbetsunderlag, inte ett verifierat faktum.\n- Rollen kontaktar ingen, publicerar inget och godkänner ingen lead.\n- Du fattar det slutliga beslutet.\n\n${wiki(folder, 'Agenterna/00 Så fungerar agentkedjan.md', 'Till agentöversikten')}\n`;
  return [
    {
      path: 'Agenterna/00 Så fungerar agentkedjan.md',
      contents: `# Så fungerar agentkedjan\n\nDivineList använder fem tydliga roller i denna ordning:\n\n1. [[${folder}/Agenterna/01 Spanaren|Spanaren]] hittar offentliga kandidater.\n2. [[${folder}/Agenterna/02 Kartografen|Kartografen]] ordnar källor och domäner.\n3. [[${folder}/Agenterna/03 Analytikern|Analytikern]] undersöker observerat webbunderlag.\n4. [[${folder}/Agenterna/04 Granskaren|Granskaren]] synliggör fel och osäkerheter.\n5. [[${folder}/Agenterna/05 Skrivaren|Skrivaren]] sammanställer rapporten i Obsidian.\n\nNär **Automatisk agentkedja** är PÅ sker överlämningen automatiskt. När den är AV väntar nästa automatiska steg. Ett redan pågående säkert delsteg får sparas först.\n\n## Vad rörelserna på skeppet betyder\n\nEn agent går till sitt bord endast när dess steg verkligen har status **Körs**. Skrivaren kan också arbeta en kort stund när färdiga resultat synkroniseras till Obsidian. Det är dokumentation, inte ny research.\n\n## När finns det inget arbete?\n\nOm företagsmålet redan är uppnått och alla kandidater är behandlade startar inget tomt arbetspass. Höj företagsmålet i DivineList om du vill hämta fler kandidater.\n\n${wiki(folder, 'START.md', 'Till startsidan')}\n`,
    },
    {
      path: 'Agenterna/01 Spanaren.md',
      contents: `# 1. Spanaren\n\n## Uppgift\n\nHittar offentliga företagskandidater inom det valda Göteborgsurvalet.\n\n## Lämnar vidare\n\nFöretagsnamn, offentlig källänk och den webbplats som källan faktiskt anger. Spanaren gissar inte en saknad domän.\n${shared}`,
    },
    {
      path: 'Agenterna/02 Kartografen.md',
      contents: `# 2. Kartografen\n\n## Uppgift\n\nNormaliserar källor och domäner, jämför dubbletter och parkerar ogiltiga eller ofullständiga poster.\n\n## Lämnar vidare\n\nEn spårbar kandidat med bevarad ursprungskälla och tydligt markerade luckor.\n${shared}`,
    },
    {
      path: 'Agenterna/03 Analytikern.md',
      contents: `# 3. Analytikern\n\n## Uppgift\n\nUndersöker den källbundna webbplatsens hämtade HTML och skapar konkreta förbättringsförslag.\n\n## Lämnar vidare\n\nObservationer, förslag och en uttrycklig lista över sådant som inte har verifierats. En HTML-sida bevisar inte hela mobilupplevelsen eller prestandan.\n${shared}`,
    },
    {
      path: 'Agenterna/04 Granskaren.md',
      contents: `# 4. Granskaren\n\n## Uppgift\n\nJämför Analytikerns utkast med samma originalobservationer och tar bort eller markerar påståenden som saknar stöd.\n\n## Lämnar vidare\n\nEtt korrigerat AI-utkast. Detta är en andra bedömning av samma lokala modell, inte en oberoende eller mänsklig verifiering.\n${shared}`,
    },
    {
      path: 'Agenterna/05 Skrivaren.md',
      contents: `# 5. Skrivaren\n\n## Uppgift\n\nSammanställer det granskade utkastet, sparar en ny bevarad rapportversion och uppdaterar den klickbara verifieringskartan.\n\n## Lämnar vidare\n\nEtt läsbart verifieringskort till dig. Skrivaren kan röra sig kort vid en ren Obsidian-synkning; det betyder inte att ny research utförs.\n${shared}`,
    },
  ];
}

function verificationGuide(folder) {
  return `# SÅ VERIFIERAR DU EN LEAD

Verifieringsflödet är byggt för att vara snabbast möjligt: ett enda klick per företag när du har gjort din mänskliga kontroll.

## Ett beslut för varje företag

1. Öppna företagets verifieringskort.
2. Kontrollera namnet, platsen och webbplatsens kontakt- eller adresstillhörighet.
3. Markera bara en ruta: **Företaget kan gå vidare till manuell bedömning**.
4. Skriv eventuellt en kort anteckning om varför du klickade igenom.

## När kan leaden markeras som klar?

När den manuella kontrollen är gjord och du har klickat i “klart” för företaget. Klicket är ett beslut, inte ett bekräftande påbud om kontakt eller publicering.

${wiki(folder, 'START.md', 'Till startsidan')}
`;
}

function verificationCard(company, folder) {
  const reportFolder = `Agentdata/Rapporter/${company.id}/`;
  return `# Verifiera – ${plain(company.name)}

Följ [[${folder}/SÅ VERIFIERAR DU|den enkla verifieringsguiden]]. Skriv endast i detta kort; DivineList skriver aldrig över dina svar.

## Snabbstatus

- Agenternas arbetsstatus: ${plain(STATUS[company.status] ?? company.status)}
- Företag enligt källan: ${plain(company.name)}
- Webbplats enligt källan: ${plain(company.domain)} ${company.domain ? externalLink(`https://${company.domain}`) : ''}
- Ursprungskälla: ${externalLink(company.sourceUrl) || plain(company.sourceUrl)}
- Hinder: ${plain(company.error ?? 'Inget separat hinder registrerat')}

## Ett snabbt verifieringssteg

- [ ] **Företaget kan gå vidare till manuell lead-bedömning**
- Motivering (valfritt):  

## Senaste och tidigare agentrapporter

${query(folder, reportFolder)}

Inget val här skickar kontakt, publicerar något eller ändrar DivineLists runtimebeslut automatiskt.

${wiki(folder, 'START.md', 'Till startsidan')}
`;
}

function verificationCanvas(companies, rows, folder) {
  const buckets = [
    {
      key: 'review',
      label: '1. FÖRVERIFIERING',
      color: '4',
      test: (company) => company.status === 'review',
      next: 'Öppna verifieringskortet och klicka i klar-rutan efter manuell kontroll.',
    },
    {
      key: 'blocked',
      label: '2. PARKERADE',
      color: '1',
      test: (company) => company.status === 'blocked',
      next: 'Spara tillfälligt och gå vidare efter att du har hittat en stabil källa.',
    },
    {
      key: 'working',
      label: '3. PÅGÅR ELLER VÄNTAR',
      color: '5',
      test: (company) => !['review', 'blocked'].includes(company.status),
      next: 'Vänta tills agentkedjan har sparat nästa underlag.',
    },
  ];
  const nodes = [
    {
      id: 'start',
      type: 'text',
      x: 0,
      y: 0,
      width: 440,
      height: 260,
      color: '6',
      text: `# DivineList – verifieringskarta\n\nBörja med [[${folder}/SÅ VERIFIERAR DU|SÅ VERIFIERAR DU]].\n\n**Klar betyder inte kontaktklar.** Du fattar beslutet efter en enkel manuell kontroll per lead. Säkerhetskopior visas inte på kartan.`,
    },
  ];
  const edges = [];
  buckets.forEach((bucket, column) => {
    const matches = companies.filter(bucket.test);
    const x = 560 + column * 470;
    const groupId = `group-${bucket.key}`;
    nodes.push({
      id: groupId,
      type: 'group',
      x,
      y: -40,
      width: 420,
      height: Math.max(250, 100 + matches.length * 190),
      color: bucket.color,
      label: `${bucket.label} (${matches.length})`,
    });
    edges.push({
      id: `edge-${bucket.key}`,
      fromNode: 'start',
      fromSide: 'right',
      toNode: groupId,
      toSide: 'left',
    });
    matches.forEach((company, index) => {
      const row = rows.get(company.id);
      nodes.push({
        id: `company-${company.id}`,
        type: 'text',
        x: x + 25,
        y: 20 + index * 190,
        width: 370,
        height: 155,
        color: bucket.color,
        text: `## ${plain(company.name)}\n\n${bucket.next}\n\n[[${folder}/${row?.verificationCard ?? verificationCardPath(company)}|Öppna verifieringskortet →]]`,
      });
    });
  });
  return `${JSON.stringify({ nodes, edges }, null, 2)}\n`;
}

function reportMarkdown(company) {
  const facts = company.facts ?? {};
  const report = company.report ?? {};
  const rows = [
    `# ${plain(company.name)}`,
    '',
    'Agentägt underlag. Detta är inte en verifierad företagsidentitet, mänsklig granskning eller kontaktbehörighet.',
    '',
    `- Företags-id: ${company.id}`,
    `- Arbetsstatus: ${plain(STATUS[company.status] ?? company.status)}`,
    `- Identitet: ${UNKNOWN}`,
    `- Göteborgstillhörighet: ${plain(facts.geography)}`,
    `- Webbplats enligt källan: ${plain(company.domain)}`,
    `- Ursprung: ${plain(company.sourceKind)}`,
    `- Källadress: ${plain(company.sourceUrl)} ${externalLink(company.sourceUrl)}`,
    `- Insamlingstid: ${plain(company.observedAt)}`,
    `- Hinder: ${plain(company.error ?? company.blockedReason ?? 'Inget separat hinder registrerat')}`,
    '',
    '## Observerat HTML-underlag',
    '',
    `- Hämtad URL: ${plain(facts.url)} ${externalLink(facts.url)}`,
    `- Observationstid: ${plain(facts.capturedAt)}`,
    `- HTTP-status: ${plain(facts.statusCode)}`,
    `- Sidtitel: ${plain(facts.title === '' ? 'Tom eller saknas i underlaget' : facts.title)}`,
    `- Sidbeskrivning: ${plain(facts.description === '' ? 'Tom eller saknas i underlaget' : facts.description)}`,
    `- Viewport-information: ${plain(typeof facts.hasViewport === 'boolean' ? (facts.hasViewport ? 'Observerad' : 'Saknas i hämtad HTML') : UNKNOWN)}`,
    `- Språkmarkering: ${plain(facts.lang === '' ? 'Tom eller saknas i underlaget' : facts.lang)}`,
    `- SHA-256: ${plain(facts.sha256)}`,
    `- Omfattning: ${plain(facts.evidenceScope)}`,
    '',
    '## Sammanfattning',
    '',
    plain(report.summary),
    '',
    '## Förbättringsförslag att granska',
    '',
    ...(Array.isArray(report.suggestions) && report.suggestions.length
      ? report.suggestions.slice(0, 12).map((item) => `- ${plain(item, 2000)}`)
      : ['- Inga förslag registrerade.']),
    '',
    '## Osäkerheter',
    '',
    ...(Array.isArray(report.unknowns) && report.unknowns.length
      ? report.unknowns.slice(0, 12).map((item) => `- ${plain(item, 2000)}`)
      : [`- ${UNKNOWN}`]),
    '- Samma lokala modell kan göra både analys och eftergranskning. Det är inte oberoende verifiering.',
    '- En HTML-sida visar inte hela webbplatsens mobilutseende, hastighet eller funktioner.',
    '',
    'Kartkälla när OpenStreetMap används: [© OpenStreetMap contributors, ODbL](https://www.openstreetmap.org/copyright).',
    '',
  ];
  return rows.join('\n');
}

function companyCard(company, folder) {
  return `# ${plain(company.name)}\n\nFöretags-id: ${company.id}\n\n## Ursprung när kortet skapades\n\nDessa ursprungsuppgifter är bevarade från den första skrivningen. Aktuellt arbetsläge och senare observationer finns i agentrapporten; detta manuella kort uppdateras inte automatiskt.\n\n- Företagsnamn enligt källan: ${plain(company.name)}\n- Webbplats enligt källan: ${plain(company.domain)}\n- Ursprungskälla: ${plain(company.sourceKind)}\n- Källadress: ${plain(company.sourceUrl)} ${externalLink(company.sourceUrl)}\n- Insamlingstid: ${plain(company.observedAt)}\n- Identitet: ${UNKNOWN}\n- Göteborgstillhörighet: ${UNKNOWN}\n- Webbplatsobservation vid första skrivningen: ${plain(company.facts?.title)}\n- Observationstid vid första skrivningen: ${plain(company.facts?.capturedAt)}\n\nKartans geografiska urval bevisar inte i sig att företagsidentiteten eller domänrelationen är verifierad.\n\n## Mina anteckningar\n\nSkriv dina egna anteckningar här. DivineList ändrar aldrig detta kort efter att det skapats.\n\n## Agenternas rapporter\n\nVarje rapport är en bevarad version med källor, arbetsstatus, observationer och osäkerheter. Öppna den senaste rapporten direkt från DivineLists företagsvy. Sökresultatet nedan visar samtliga versioner utan extra Obsidian-plugin.\n\n${query(folder, `Agentdata/Rapporter/${company.id}/`)}\n\n${wiki(folder, 'START.md', 'Till gemensam översikt')}\n`;
}

function startCard(folder) {
  return `# DivineList – START HÄR\n\nBörja med [[${folder}/SÅ VERIFIERAR DU|SÅ VERIFIERAR DU]]. Öppna sedan den senaste klickbara verifieringskartan från DivineLists Obsidian-panel.\n\nMapparna **Agentdata** och **Företag** är spårbart maskinunderlag. Du behöver normalt inte navigera i deras tekniska filnamn. Dina enkla arbetskort ligger i **Verifiera**. Säkerhetskopior ska ligga utanför denna arbetsmapp.\n\n## Mina verifieringskort\n\n${query(folder, 'Verifiera/')}\n\n## Bevarade maskinöversikter\n\n${query(folder, 'Agentdata/Oversikter/')}\n\n## Mina anteckningar\n\n\n`;
}

function validateCompanies(companies) {
  if (!Array.isArray(companies) || companies.length > 500)
    throw failure('Synkningen behöver en lista med högst 500 företag.');
  const ids = new Set();
  for (const company of companies) {
    if (
      !company ||
      typeof company !== 'object' ||
      !ID.test(company.id) ||
      typeof company.name !== 'string' ||
      !company.name.trim() ||
      company.name.length > 200 ||
      ids.has(company.id) ||
      Buffer.byteLength(JSON.stringify(company)) > 128_000
    )
      throw failure(
        'Företagslistan innehåller ogiltiga, för stora eller dubbla poster.',
      );
    ids.add(company.id);
  }
  return clone(companies);
}

function obsidianUri(vaultPath, folder, path) {
  return `obsidian://open?path=${encodeURIComponent(resolve(vaultPath, folder, path))}`;
}

// Existing vault files are never replaced. Publishing uses an exclusive hard-link
// from a fully flushed temporary file: it cannot clobber a simultaneous editor.
// This needs a local filesystem supporting hard links (for example NTFS).
export async function createObsidianBridge({ dataDir }) {
  if (!isAbsolute(dataDir) || /^[\\/]{2}/.test(dataDir))
    throw failure('Stationens datamapp måste vara lokal och absolut.');
  await ensureDirectory(dataDir);
  const statePath = join(dataDir, 'obsidian-state.json');
  const lockPath = join(dataDir, 'obsidian-bridge.lock');
  const nonce = randomUUID();
  let lock;
  try {
    lock = await open(lockPath, 'wx');
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const previous = (await ordinaryRead(lockPath, 1024)).toString('utf8');
    let pid;
    try {
      pid = JSON.parse(previous).pid;
    } catch {
      throw failure(
        'Obsidian-skrivkön har en ogiltig låsfil som behöver granskas.',
        409,
      );
    }
    if (!Number.isSafeInteger(pid) || pid < 1)
      throw failure('Obsidian-skrivkön har en ogiltig processlåsning.', 409);
    try {
      process.kill(pid, 0);
      throw failure(
        'En annan Obsidian-skrivkö använder redan datamappen.',
        409,
      );
    } catch (probe) {
      if (probe.code !== 'ESRCH') throw probe;
    }
    if ((await ordinaryRead(lockPath, 1024)).toString('utf8') !== previous)
      throw failure('Obsidian-låset ändrades. Försök igen.', 409);
    await unlink(lockPath);
    lock = await open(lockPath, 'wx');
  }
  await lock.writeFile(JSON.stringify({ pid: process.pid, nonce }));
  await lock.sync();
  await lock.close();
  let stored = {
    version: 1,
    config: null,
    manifest: {
      files: {},
      companies: {},
      index: null,
      indexDigest: null,
      map: null,
      mapDigest: null,
      sequence: 0,
    },
    lastSync: null,
  };
  let stateHash = null;
  let active = false;
  let closed = false;
  let queue = Promise.resolve();
  let lastResult = {
    written: 0,
    unchanged: 0,
    conflicts: [],
    companies: [],
    error: null,
  };

  async function releaseLock() {
    try {
      const current = JSON.parse(
        (await ordinaryRead(lockPath, 1024)).toString('utf8'),
      );
      if (current.nonce === nonce) await unlink(lockPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  try {
    const bytes = await ordinaryRead(statePath);
    stored = JSON.parse(bytes.toString('utf8'));
    stateHash = digest(bytes);
    if (
      stored.version !== 1 ||
      !stored.manifest ||
      typeof stored.manifest.files !== 'object' ||
      !stored.manifest.companies ||
      !Number.isSafeInteger(stored.manifest.sequence) ||
      stored.manifest.sequence < 0 ||
      Object.keys(stored.manifest.files).length > 20_000
    )
      throw failure('Sparad Obsidian-status är ogiltig och har bevarats.', 409);
    stored.manifest.map ??= null;
    stored.manifest.mapDigest ??= null;
    for (const [path, entry] of Object.entries(stored.manifest.files)) {
      if (
        !/^(?:START\.md|SÅ VERIFIERAR DU\.md|Agenterna\/(?:00 Så fungerar agentkedjan|0[1-5] (?:Spanaren|Kartografen|Analytikern|Granskaren|Skrivaren))\.md|Verifiera\/[\p{L}\p{N} _-]{1,120}\.md|Verifieringskartor\/Verifieringskarta - \d+ granska - \d+ parkerade - [a-f\d]{6}\.canvas|Foretag\/[a-f\d]{24}\.md|Agentdata\/Rapporter\/[a-f\d]{24}\/\d{6}-[a-f\d]{16}\.md|Agentdata\/Oversikter\/\d{6}-[a-f\d]{16}\.md)$/u.test(
          path,
        ) ||
        !entry ||
        !/^[a-f\d]{64}$/.test(entry.sha256) ||
        !['human', 'agent'].includes(entry.owner)
      )
        throw failure(
          'Sparad Obsidian-manifest innehåller en ogiltig fil och har bevarats.',
          409,
        );
    }
    for (const [id, row] of Object.entries(stored.manifest.companies)) {
      if (
        !ID.test(id) ||
        row.card !== `Foretag/${id}.md` ||
        (row.verificationCard !== undefined &&
          !stored.manifest.files[row.verificationCard]) ||
        !stored.manifest.files[row.card] ||
        !stored.manifest.files[row.report] ||
        !/^[a-f\d]{64}$/.test(row.sha256)
      )
        throw failure(
          'Sparade Obsidian-företagslänkar är ogiltiga och har bevarats.',
          409,
        );
    }
    if (
      stored.manifest.index !== null &&
      !stored.manifest.files[stored.manifest.index]
    )
      throw failure('Sparad Obsidian-översikt är ogiltig.', 409);
    if (
      stored.manifest.map !== null &&
      !stored.manifest.files[stored.manifest.map]
    )
      throw failure('Sparad Obsidian-verifieringskarta är ogiltig.', 409);
    if (stored.config !== null)
      stored.config = await validateConfiguration(stored.config);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      await releaseLock();
      throw error;
    }
    if (stateHash !== null)
      lastResult.error =
        'Det sparade Obsidian-valvet är inte tillgängligt. Ingen synkning har startats.';
  }

  async function persist() {
    await inspectDirectory(dataDir);
    try {
      const current = digest(await ordinaryRead(statePath));
      if (current !== stateHash)
        throw failure(
          'Obsidian-inställningarna ändrades utanför programmet. Filen har bevarats.',
          409,
        );
    } catch (error) {
      if (error.code !== 'ENOENT' || stateHash !== null) throw error;
    }
    const bytes = Buffer.from(`${JSON.stringify(stored, null, 2)}\n`);
    if (bytes.length > MAX_BYTES)
      throw failure(
        'Obsidian-manifestet är fullt. Bevara historiken och välj en ny arbetsmapp.',
        409,
      );
    const temporary = join(dataDir, `obsidian-state-${randomUUID()}.tmp`);
    const file = await open(temporary, 'wx');
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, statePath);
    stateHash = digest(bytes);
  }

  function serialize(operation) {
    if (closed)
      return Promise.reject(failure('Obsidian-skrivkön är stängd.', 409));
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  }

  function getState() {
    const config = stored.config;
    const savedCompanies = config
      ? Object.entries(stored.manifest.companies).map(([id, row]) => ({
          id,
          name: row.name,
          status: 'saved',
          cardPath: resolve(config.vaultPath, config.folder, row.card),
          reportPath: resolve(config.vaultPath, config.folder, row.report),
          cardUri: obsidianUri(
            config.vaultPath,
            config.folder,
            row.verificationCard ?? row.card,
          ),
          reportUri: obsidianUri(config.vaultPath, config.folder, row.report),
          readBackVerified: false,
        }))
      : [];
    return clone({
      configured: Boolean(config),
      enabled: config?.enabled ?? false,
      vaultPath: config?.vaultPath ?? null,
      folder: config?.folder ?? null,
      targetPath: config ? resolve(config.vaultPath, config.folder) : null,
      syncing: active,
      lastSync: stored.lastSync,
      ...lastResult,
      companies: lastResult.companies.length
        ? lastResult.companies
        : savedCompanies,
      overviewPath:
        config && stored.manifest.index
          ? resolve(config.vaultPath, config.folder, stored.manifest.index)
          : null,
      overviewUri:
        config && stored.manifest.index
          ? obsidianUri(config.vaultPath, config.folder, stored.manifest.index)
          : null,
      mapPath:
        config && stored.manifest.map
          ? resolve(config.vaultPath, config.folder, stored.manifest.map)
          : null,
      mapUri:
        config && stored.manifest.map
          ? obsidianUri(config.vaultPath, config.folder, stored.manifest.map)
          : null,
      startUri: config
        ? obsidianUri(config.vaultPath, config.folder, 'START.md')
        : null,
      mode: 'append_only',
    });
  }

  async function listVaults() {
    const registry = process.env.APPDATA
      ? join(process.env.APPDATA, 'obsidian', 'obsidian.json')
      : null;
    if (!registry) return [];
    let value;
    try {
      await inspectDirectory(dirname(registry));
      value = JSON.parse(
        (await ordinaryRead(registry, 1_000_000)).toString('utf8'),
      );
    } catch {
      return [];
    }
    const results = [];
    for (const item of Object.values(value?.vaults ?? {}).slice(0, 50)) {
      try {
        const config = await validateConfiguration({
          vaultPath: item.path,
          folder: 'DivineList/Agentstation',
        });
        if (
          !results.some((existing) => samePath(existing.path, config.vaultPath))
        )
          results.push({
            name: basename(config.vaultPath),
            path: config.vaultPath,
          });
      } catch {
        /* Invalid or missing registered vaults are not offered. */
      }
    }
    return results;
  }

  function configure(value) {
    return serialize(async () => {
      const config = await validateConfiguration(value);
      const changed =
        !stored.config ||
        !samePath(stored.config.vaultPath, config.vaultPath) ||
        stored.config.folder !== config.folder;
      const previous = clone(stored);
      stored.config = config;
      if (changed) {
        stored.manifest = {
          files: {},
          companies: {},
          index: null,
          indexDigest: null,
          map: null,
          mapDigest: null,
          sequence: 0,
        };
        stored.lastSync = null;
      }
      try {
        await persist();
      } catch (error) {
        stored = previous;
        throw error;
      }
      lastResult = {
        written: 0,
        unchanged: 0,
        conflicts: [],
        companies: [],
        error: null,
      };
      return getState();
    });
  }

  async function verifyTracked(path, entry) {
    const target = resolve(stored.config.vaultPath, stored.config.folder, path);
    await inspectDirectory(dirname(target));
    const bytes = await ordinaryRead(target);
    if (entry.owner === 'agent' && digest(bytes) !== entry.sha256)
      throw failure(
        'En agentrapport har ändrats utanför DivineList. Den bevaras och företaget parkeras.',
        409,
      );
  }

  async function writeNew(path, contents, owner, signal) {
    checkSignal(signal);
    const expectedHash = digest(contents);
    const tracked = stored.manifest.files[path];
    if (tracked) {
      await verifyTracked(path, tracked);
      return;
    }
    if (Object.keys(stored.manifest.files).length >= 20_000)
      throw failure('Obsidian-historiken har nått filgränsen.', 409);
    const target = resolve(stored.config.vaultPath, stored.config.folder, path);
    const root = resolve(stored.config.vaultPath, stored.config.folder);
    if (!contained(root, target)) throw failure('Otillåten målsökväg.', 409);
    await ensureDirectory(dirname(target));
    // Journal the expected content before publication; a stopped process may
    // safely recognize its own complete file on the next explicit sync.
    stored.manifest.files[path] = {
      sha256: expectedHash,
      owner,
      pending: true,
      claimed: owner === 'human',
      createdAt: new Date().toISOString(),
    };
    await persist();
    checkSignal(signal);
    const temporary = join(dirname(target), `.divinelist-${randomUUID()}.tmp`);
    const file = await open(temporary, 'wx');
    try {
      await file.writeFile(contents);
      await file.sync();
    } finally {
      await file.close();
    }
    try {
      checkSignal(signal);
      await inspectDirectory(dirname(target));
      await link(temporary, target);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      delete stored.manifest.files[path];
      await persist();
      throw failure(
        'Filnamnet finns redan. Den befintliga filen bevaras; välj en tom arbetsmapp eller granska konflikten.',
        409,
      );
    } finally {
      // Do not delete even a temporary file if an external writer changed it.
      try {
        const bytes = await readFile(temporary);
        if (digest(bytes) === expectedHash) await unlink(temporary);
      } catch {
        // Retain an inaccessible temporary file. The target's strict link-count
        // readback below blocks success if its temporary hard link remains.
      }
    }
    const actual = await ordinaryRead(target);
    if (digest(actual) !== expectedHash)
      throw failure(
        'Filen ändrades före återläsningen. Innehållet har bevarats och markeras som konflikt.',
        409,
      );
    stored.manifest.files[path].pending = false;
    await persist();
  }

  async function recoverPending(signal) {
    for (const [path, entry] of Object.entries(stored.manifest.files)) {
      if (!entry.pending) continue;
      checkSignal(signal);
      const target = resolve(
        stored.config.vaultPath,
        stored.config.folder,
        path,
      );
      try {
        await inspectDirectory(dirname(target));
        const current = await ordinaryRead(target);
        if (digest(current) !== entry.sha256)
          throw failure(
            'En ofullständig synknings fil har annat innehåll. Befintliga bytes bevaras.',
            409,
          );
        entry.pending = false;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        delete stored.manifest.files[path];
      }
    }
    await persist();
  }

  function sync(companies, { signal } = {}) {
    let snapshot;
    try {
      snapshot = validateCompanies(companies);
    } catch (error) {
      return Promise.reject(error);
    }
    return serialize(async () => {
      if (!stored.config?.enabled)
        throw failure('Välj och aktivera först en Obsidian-arbetsmapp.', 409);
      active = true;
      lastResult = {
        written: 0,
        unchanged: 0,
        conflicts: [],
        companies: [],
        error: null,
      };
      try {
        await validateConfiguration(stored.config);
        checkSignal(signal);
        await recoverPending(signal);
        await writeNew(
          'START.md',
          startCard(stored.config.folder),
          'human',
          signal,
        );
        await writeNew(
          'SÅ VERIFIERAR DU.md',
          verificationGuide(stored.config.folder),
          'human',
          signal,
        );
        for (const document of agentDocuments(stored.config.folder))
          await writeNew(document.path, document.contents, 'human', signal);
        for (const company of snapshot) {
          checkSignal(signal);
          const before = stored.manifest.companies[company.id];
          const row = {
            id: company.id,
            name: company.name,
            status: 'conflict',
            cardPath: null,
            reportPath: null,
            cardUri: null,
            reportUri: null,
            readBackVerified: false,
          };
          try {
            const card = `Foretag/${company.id}.md`;
            await writeNew(
              card,
              companyCard(company, stored.config.folder),
              'human',
              signal,
            );
            const readableCard =
              before?.verificationCard ?? verificationCardPath(company);
            await writeNew(
              readableCard,
              verificationCard(company, stored.config.folder),
              'human',
              signal,
            );
            if (before)
              await verifyTracked(
                before.report,
                stored.manifest.files[before.report],
              );
            const contents = reportMarkdown(company);
            const sha256 = digest(contents);
            let report = before?.report;
            if (!before || before.sha256 !== sha256) {
              report = Object.entries(stored.manifest.files).find(
                ([path, entry]) =>
                  path.startsWith(`Agentdata/Rapporter/${company.id}/`) &&
                  entry.sha256 === sha256 &&
                  entry.claimed === false,
              )?.[0];
              if (!report) {
                stored.manifest.sequence += 1;
                report = `Agentdata/Rapporter/${company.id}/${String(stored.manifest.sequence).padStart(6, '0')}-${sha256.slice(0, 16)}.md`;
              }
              await writeNew(report, contents, 'agent', signal);
            }
            await verifyTracked(card, stored.manifest.files[card]);
            await verifyTracked(report, stored.manifest.files[report]);
            const nextMetadata = {
              card,
              verificationCard: readableCard,
              report,
              sha256,
              name: company.name,
              status: company.status,
              sourceUrl:
                typeof company.sourceUrl === 'string'
                  ? company.sourceUrl.slice(0, 2048)
                  : null,
              observedAt:
                typeof company.observedAt === 'string'
                  ? company.observedAt.slice(0, 40)
                  : null,
              capturedAt:
                typeof company.facts?.capturedAt === 'string'
                  ? company.facts.capturedAt.slice(0, 40)
                  : null,
              updatedAt:
                before?.sha256 === sha256
                  ? (before.updatedAt ?? null)
                  : (stored.manifest.files[report].createdAt ?? null),
            };
            const metadataChanged =
              Object.keys(before ?? {}).length !==
                Object.keys(nextMetadata).length ||
              Object.keys(nextMetadata).some(
                (key) => before?.[key] !== nextMetadata[key],
              );
            const needsClaim = stored.manifest.files[report].claimed !== true;
            stored.manifest.companies[company.id] = nextMetadata;
            stored.manifest.files[report].claimed = true;
            if (metadataChanged || needsClaim) await persist();
            row.status = before?.sha256 === sha256 ? 'unchanged' : 'written';
            lastResult[row.status] += 1;
            Object.assign(row, {
              cardPath: resolve(
                stored.config.vaultPath,
                stored.config.folder,
                readableCard,
              ),
              reportPath: resolve(
                stored.config.vaultPath,
                stored.config.folder,
                report,
              ),
              cardUri: obsidianUri(
                stored.config.vaultPath,
                stored.config.folder,
                readableCard,
              ),
              reportUri: obsidianUri(
                stored.config.vaultPath,
                stored.config.folder,
                report,
              ),
              readBackVerified: true,
            });
          } catch (error) {
            checkSignal(signal);
            row.error = error.message;
            lastResult.conflicts.push({
              id: company.id,
              name: company.name,
              message: error.message,
            });
          }
          lastResult.companies.push(row);
        }
        checkSignal(signal);
        const indexRows = Object.entries(stored.manifest.companies).sort(
          ([a], [b]) => a.localeCompare(b),
        );
        const indexContents = [
          '# DivineList – gemensam företagsöversikt',
          '',
          'Agenternas förberedelseunderlag. Företagsidentitet och förslag behöver mänsklig granskning. Senast återlästa kort och rapporter finns här. Äldre versioner bevaras.',
          '',
          '| Företag | Arbetsstatus | Källa | Insamlat | HTML observerad | Rapport uppdaterad | Mina anteckningar | Agentrapport |',
          '| --- | --- | --- | --- | --- | --- | --- | --- |',
          ...indexRows.map(
            ([id, row]) =>
              `| ${plain(row.name)} | ${lastResult.conflicts.some((item) => item.id === id) ? 'KONFLIKT – rapporten behöver granskas' : plain(STATUS[row.status] ?? row.status)} | ${externalLink(row.sourceUrl) || plain(row.sourceUrl)} | ${plain(row.observedAt)} | ${plain(row.capturedAt)} | ${plain(row.updatedAt)} | ${wiki(stored.config.folder, row.verificationCard ?? row.card, 'Verifiera enkelt')} | ${wiki(stored.config.folder, row.report, 'Öppna maskinrapport')} |`,
          ),
          '',
          `${indexRows.length} företagskort. ${lastResult.conflicts.length} konflikter i denna synkning.`,
          '',
          ...lastResult.conflicts.map(
            (item) =>
              `- Konflikt för ${plain(item.name)}: ${plain(item.message)}`,
          ),
          '',
          wiki(stored.config.folder, 'START.md', 'Till startsidan'),
          '',
        ].join('\n');
        const indexDigest = digest(indexContents);
        if (stored.manifest.index)
          await verifyTracked(
            stored.manifest.index,
            stored.manifest.files[stored.manifest.index],
          );
        if (stored.manifest.indexDigest !== indexDigest) {
          let path = Object.entries(stored.manifest.files).find(
            ([candidate, entry]) =>
              candidate.startsWith('Agentdata/Oversikter/') &&
              entry.sha256 === indexDigest &&
              entry.claimed === false,
          )?.[0];
          if (!path) {
            stored.manifest.sequence += 1;
            path = `Agentdata/Oversikter/${String(stored.manifest.sequence).padStart(6, '0')}-${indexDigest.slice(0, 16)}.md`;
          }
          await writeNew(path, indexContents, 'agent', signal);
          stored.manifest.index = path;
          stored.manifest.indexDigest = indexDigest;
          stored.manifest.files[path].claimed = true;
        }
        const companyRows = new Map(Object.entries(stored.manifest.companies));
        const mapContents = verificationCanvas(
          snapshot,
          companyRows,
          stored.config.folder,
        );
        const mapDigest = digest(mapContents);
        if (stored.manifest.map)
          await verifyTracked(
            stored.manifest.map,
            stored.manifest.files[stored.manifest.map],
          );
        if (stored.manifest.mapDigest !== mapDigest) {
          const reviewCount = snapshot.filter(
            (company) => company.status === 'review',
          ).length;
          const blockedCount = snapshot.filter(
            (company) => company.status === 'blocked',
          ).length;
          let mapPath = Object.entries(stored.manifest.files).find(
            ([candidate, entry]) =>
              candidate.startsWith('Verifieringskartor/') &&
              entry.sha256 === mapDigest &&
              entry.claimed === false,
          )?.[0];
          if (!mapPath)
            mapPath = `Verifieringskartor/Verifieringskarta - ${reviewCount} granska - ${blockedCount} parkerade - ${mapDigest.slice(0, 6)}.canvas`;
          await writeNew(mapPath, mapContents, 'agent', signal);
          stored.manifest.map = mapPath;
          stored.manifest.mapDigest = mapDigest;
          stored.manifest.files[mapPath].claimed = true;
        }
        stored.lastSync = new Date().toISOString();
        await persist();
      } catch (error) {
        lastResult.error = error.message;
        throw error;
      } finally {
        active = false;
      }
      return getState();
    });
  }

  async function close() {
    if (closed) return;
    closed = true;
    await queue;
    await releaseLock();
  }
  return { getState, listVaults, configure, sync, close };
}
