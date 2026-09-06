import type {
  Clause,
  Condition,
  EvidenceMethod,
  Operator,
  Primitive,
  RuleCategory,
  RuleDefinition,
  Severity,
} from './types';
import { RULESET_VERSION } from './types';

const RULE_VERSION = RULESET_VERSION.replace('divinelist.rules.v', '');

type RuleSeed = {
  id: string;
  category: RuleCategory;
  severity: Severity;
  rootCause: string;
  title: string;
  fact?: string;
  operator?: Operator;
  value?: Primitive;
  condition?: Condition;
  appliesWhen?: Condition;
  safeFinding: string;
  recommendation: string;
  manualCheck: string;
  whyItMatters?: string;
  maxEvidenceAgeDays?: number;
};

const clause = (
  fact: string,
  operator: Operator,
  value?: Primitive,
): Clause => ({
  fact,
  operator,
  value,
});

const all = (...conditions: Condition[]): Condition => ({ all: conditions });

const collectFactKeys = (condition: Condition): string[] => {
  if ('fact' in condition) return [condition.fact];
  const children = 'all' in condition ? condition.all : condition.any;
  return [...new Set(children.flatMap(collectFactKeys))];
};

const evidenceMethodsForFact = (fact: string): EvidenceMethod[] => {
  if (fact === 'availability.last_30d_percent') return ['monitoring'];
  if (fact.startsWith('availability.'))
    return ['headers', 'link-check', 'browser-test', 'manual'];
  if (fact.startsWith('performance.')) return ['lighthouse'];
  if (fact === 'mobile.viewport_meta_present') return ['html', 'lighthouse'];
  if (fact.startsWith('mobile.'))
    return [
      'browser-test',
      'lighthouse',
      'accessibility-audit',
      'form-test',
      'screenshot',
      'manual',
    ];
  if (fact.startsWith('a11y.')) {
    if (fact === 'a11y.keyboard_trap_count' || fact === 'a11y.focus_visible')
      return ['accessibility-audit', 'browser-test', 'manual'];
    return ['accessibility-audit', 'html', 'lighthouse'];
  }
  if (fact.startsWith('transport.'))
    return ['headers', 'link-check', 'browser-test', 'lighthouse', 'manual'];
  if (fact.startsWith('crawl.')) return ['html', 'headers', 'link-check'];
  if (fact.startsWith('seo.')) return ['html', 'structured-data', 'link-check'];
  if (fact.startsWith('business.'))
    return ['business-profile', 'html', 'structured-data', 'manual'];
  if (fact.startsWith('local.'))
    return ['business-profile', 'structured-data', 'html', 'manual'];
  if (fact.startsWith('conversion.'))
    return ['html', 'browser-test', 'link-check', 'screenshot', 'manual'];
  if (fact.startsWith('content.') || fact.startsWith('trust.'))
    return ['html', 'browser-test', 'link-check', 'screenshot', 'manual'];
  if (fact.startsWith('forms.'))
    return ['form-test', 'browser-test', 'html', 'manual'];
  if (fact.startsWith('commerce.'))
    return ['form-test', 'browser-test', 'business-profile', 'html', 'manual'];
  if (fact.startsWith('privacy.'))
    return ['browser-test', 'form-test', 'html', 'manual'];
  if (fact.startsWith('security.'))
    return ['headers', 'browser-test', 'html', 'link-check'];
  if (fact.startsWith('operations.'))
    return ['browser-test', 'link-check', 'html', 'headers'];
  return ['manual'];
};

const makeRule = (seed: RuleSeed): RuleDefinition => {
  const condition =
    seed.condition ?? clause(seed.fact!, seed.operator!, seed.value);
  const requiredFacts = [
    ...collectFactKeys(condition),
    ...(seed.appliesWhen ? collectFactKeys(seed.appliesWhen) : []),
  ];
  const uniqueFacts = [...new Set(requiredFacts)];
  const tier: RuleDefinition['tier'] =
    seed.category === 'forms-commerce'
      ? 'D'
      : ['conversion', 'content-trust', 'local-seo'].includes(seed.category)
        ? 'C'
        : ['performance', 'mobile', 'accessibility'].includes(seed.category)
          ? 'B'
          : 'A';
  const evaluationMode: RuleDefinition['evaluationMode'] =
    tier === 'D'
      ? 'paused'
      : tier === 'C'
        ? 'manual_only'
        : tier === 'B'
          ? 'human_required'
          : 'automated';

  return {
    id: seed.id,
    version: RULE_VERSION,
    title: seed.title,
    category: seed.category,
    severity: seed.severity,
    rootCause: seed.rootCause,
    description: `Deterministisk kontroll av ${collectFactKeys(condition).join(', ')} i ett importerat underlag.`,
    whyItMatters:
      seed.whyItMatters ??
      'Fyndet kan påverka hur enkelt en besökare kan hitta, förstå eller använda webbplatsen.',
    safeFinding: seed.safeFinding,
    recommendation: seed.recommendation,
    manualCheck: seed.manualCheck,
    requiredFacts: uniqueFacts,
    evidenceMethodsByFact: Object.fromEntries(
      uniqueFacts.map((fact) => [fact, evidenceMethodsForFact(fact)]),
    ),
    condition,
    appliesWhen: seed.appliesWhen,
    maxEvidenceAgeDays: seed.maxEvidenceAgeDays ?? 45,
    tier,
    lifecycle: tier === 'D' ? 'paused' : tier === 'A' ? 'candidate' : 'shadow',
    evaluationMode,
    sideEffectRisk: tier === 'D' ? 'external_write' : 'read_only',
    minimumCoverage: 1,
  };
};

const seeds: RuleSeed[] = [
  // Drift & HTTPS — 10
  {
    id: 'AVL-001',
    category: 'availability',
    severity: 'critical',
    rootCause: 'availability',
    title: 'Startsidan svarar inte',
    fact: 'availability.reachable',
    operator: 'eq',
    value: false,
    safeFinding: 'Det importerade testet fick inget svar från startsidan.',
    recommendation:
      'Kontrollera drift, DNS och webbserver innan andra förbättringar.',
    manualCheck:
      'Öppna sidan manuellt från två nät och notera tid och felmeddelande.',
    maxEvidenceAgeDays: 2,
  },
  {
    id: 'AVL-002',
    category: 'availability',
    severity: 'high',
    rootCause: 'http-client-error',
    title: 'Startsidan returnerar klientfel',
    condition: all(
      clause('availability.http_status', 'gte', 400),
      clause('availability.http_status', 'lt', 500),
    ),
    safeFinding: 'Det angivna HTTP-svaret ligger mellan 400 och 499.',
    recommendation: 'Rätta routning, behörighet eller borttagen startsida.',
    manualCheck:
      'Bekräfta statuskod utan inloggning och följ eventuella omdirigeringar.',
    maxEvidenceAgeDays: 2,
  },
  {
    id: 'AVL-003',
    category: 'availability',
    severity: 'critical',
    rootCause: 'http-server-error',
    title: 'Startsidan returnerar serverfel',
    fact: 'availability.http_status',
    operator: 'gte',
    value: 500,
    safeFinding: 'Det angivna HTTP-svaret är 500 eller högre.',
    recommendation: 'Felsök serverlogg, applikation och beroenden.',
    manualCheck: 'Upprepa testet och uteslut ett tillfälligt driftfel.',
    maxEvidenceAgeDays: 2,
  },
  {
    id: 'AVL-004',
    category: 'availability',
    severity: 'high',
    rootCause: 'https',
    title: 'HTTPS används inte',
    fact: 'transport.https_enabled',
    operator: 'eq',
    value: false,
    safeFinding: 'Underlaget anger att webbplatsen inte använder HTTPS.',
    recommendation: 'Aktivera HTTPS och omdirigera all HTTP-trafik.',
    manualCheck: 'Kontrollera både http- och https-varianten manuellt.',
    maxEvidenceAgeDays: 7,
  },
  {
    id: 'AVL-005',
    category: 'availability',
    severity: 'critical',
    rootCause: 'https',
    title: 'TLS-certifikatet är inte giltigt',
    fact: 'transport.tls_valid',
    operator: 'eq',
    value: false,
    appliesWhen: clause('transport.https_enabled', 'eq', true),
    safeFinding:
      'Det importerade certifikattestet markerar certifikatet som ogiltigt.',
    recommendation: 'Förnya eller installera rätt certifikatkedja.',
    manualCheck:
      'Bekräfta värdnamn, utgångsdatum och certifikatkedja i en webbläsare.',
    maxEvidenceAgeDays: 2,
  },
  {
    id: 'AVL-006',
    category: 'availability',
    severity: 'medium',
    rootCause: 'redirects',
    title: 'Lång omdirigeringskedja',
    fact: 'transport.redirect_hops',
    operator: 'gt',
    value: 3,
    safeFinding: 'Underlaget visar fler än tre omdirigeringssteg.',
    recommendation:
      'Peka interna länkar direkt mot slutadressen och korta kedjan.',
    manualCheck: 'Följ kedjan och dokumentera varje statuskod och adress.',
    maxEvidenceAgeDays: 14,
  },
  {
    id: 'AVL-007',
    category: 'availability',
    severity: 'critical',
    rootCause: 'redirects',
    title: 'Omdirigeringsloop',
    fact: 'transport.redirect_loop',
    operator: 'eq',
    value: true,
    safeFinding: 'Underlaget visar en återkommande omdirigeringskedja.',
    recommendation: 'Rätta konflikt mellan server-, CMS- och HTTPS-regler.',
    manualCheck:
      'Bekräfta loopen i privat fönster och kontrollera cache/cookies.',
    maxEvidenceAgeDays: 2,
  },
  {
    id: 'AVL-008',
    category: 'availability',
    severity: 'high',
    rootCause: 'https',
    title: 'Blandat HTTP-innehåll',
    fact: 'transport.mixed_content_count',
    operator: 'gt',
    value: 0,
    safeFinding: 'Minst en resurs anges laddas över HTTP på en HTTPS-sida.',
    recommendation:
      'Byt resursadresser till HTTPS eller lokala säkra resurser.',
    manualCheck:
      'Kontrollera konsolen och skilj aktiva resurser från gamla länkar.',
    maxEvidenceAgeDays: 14,
  },
  {
    id: 'AVL-009',
    category: 'availability',
    severity: 'medium',
    rootCause: 'host-variants',
    title: 'Domänvarianter samlas inte',
    fact: 'transport.host_variants_converge',
    operator: 'eq',
    value: false,
    safeFinding:
      'Underlaget anger att domänvarianter inte leder till samma slutadress.',
    recommendation: 'Välj en primär värd och skapa permanenta omdirigeringar.',
    manualCheck: 'Testa http, https, www och icke-www och jämför slutadress.',
    maxEvidenceAgeDays: 14,
  },
  {
    id: 'AVL-010',
    category: 'availability',
    severity: 'medium',
    rootCause: 'availability',
    title: 'Låg observerad tillgänglighet',
    fact: 'availability.last_30d_percent',
    operator: 'lt',
    value: 99,
    safeFinding: 'Det importerade 30-dagarsvärdet ligger under 99 procent.',
    recommendation:
      'Undersök driftmönster, övervakning och återställningsrutiner.',
    manualCheck: 'Verifiera mätperiod, mätpunkter och planerat underhåll.',
    maxEvidenceAgeDays: 7,
  },

  // Indexering — 10
  {
    id: 'CRW-001',
    category: 'crawlability',
    severity: 'critical',
    rootCause: 'index-block',
    title: 'Startsidan blockeras av robots.txt',
    fact: 'crawl.robots_blocks_home',
    operator: 'eq',
    value: true,
    safeFinding: 'Den importerade robots-tolkningen blockerar startsidan.',
    recommendation: 'Rätta robots-regeln om blockeringen inte är avsiktlig.',
    manualCheck:
      'Kontrollera exakt user-agent och miljö; staging ska inte blandas ihop med produktion.',
  },
  {
    id: 'CRW-002',
    category: 'crawlability',
    severity: 'critical',
    rootCause: 'index-block',
    title: 'Startsidan har noindex',
    fact: 'crawl.home_noindex',
    operator: 'eq',
    value: true,
    safeFinding: 'Underlaget visar en noindex-instruktion på startsidan.',
    recommendation: 'Ta bort noindex om sidan ska synas i sökresultat.',
    manualCheck: 'Kontrollera både meta robots och X-Robots-Tag.',
  },
  {
    id: 'CRW-003',
    category: 'crawlability',
    severity: 'medium',
    rootCause: 'sitemap',
    title: 'XML-webbplatskarta saknas',
    fact: 'crawl.sitemap_present',
    operator: 'eq',
    value: false,
    safeFinding: 'Ingen XML-webbplatskarta finns i det importerade underlaget.',
    recommendation:
      'Skapa en ren webbplatskarta med indexerbara kanoniska adresser.',
    manualCheck:
      'Kontrollera robots.txt och vanliga sitemap-adresser innan slutsats.',
  },
  {
    id: 'CRW-004',
    category: 'crawlability',
    severity: 'high',
    rootCause: 'sitemap',
    title: 'Webbplatskartan är ogiltig',
    fact: 'crawl.sitemap_valid',
    operator: 'eq',
    value: false,
    appliesWhen: clause('crawl.sitemap_present', 'eq', true),
    safeFinding:
      'Den importerade valideringen markerar webbplatskartan som ogiltig.',
    recommendation: 'Rätta XML, statuskoder och felaktiga adresser.',
    manualCheck:
      'Validera aktuell fil och kontrollera att rätt sitemap testades.',
  },
  {
    id: 'CRW-005',
    category: 'crawlability',
    severity: 'medium',
    rootCause: 'canonical',
    title: 'Kanonisk adress saknas',
    fact: 'crawl.home_canonical_present',
    operator: 'eq',
    value: false,
    safeFinding: 'Underlaget saknar en canonical-länk på startsidan.',
    recommendation: 'Lägg till en självkanonisk absolut adress.',
    manualCheck:
      'Kontrollera serverrenderad HTML, inte bara en modifierad DOM.',
  },
  {
    id: 'CRW-006',
    category: 'crawlability',
    severity: 'high',
    rootCause: 'canonical',
    title: 'Flera canonical-taggar',
    fact: 'crawl.home_canonical_count',
    operator: 'gt',
    value: 1,
    safeFinding: 'Fler än en canonical-tagg anges på startsidan.',
    recommendation: 'Behåll en enda konsekvent canonical.',
    manualCheck: 'Jämför rå HTML med DOM efter JavaScript.',
  },
  {
    id: 'CRW-007',
    category: 'crawlability',
    severity: 'high',
    rootCause: 'canonical',
    title: 'Canonical pekar utanför domänen',
    fact: 'crawl.home_canonical_off_domain',
    operator: 'eq',
    value: true,
    safeFinding: 'Den importerade canonical-adressen pekar mot en annan domän.',
    recommendation:
      'Bekräfta avsikten och rätta canonical om det är ett mallfel.',
    manualCheck:
      'Verifiera ägarskap och om korsdomän-canonical verkligen är avsiktlig.',
  },
  {
    id: 'CRW-008',
    category: 'crawlability',
    severity: 'high',
    rootCause: 'broken-links',
    title: 'Trasiga interna länkar',
    fact: 'crawl.broken_internal_links',
    operator: 'gt',
    value: 0,
    safeFinding: 'Underlaget innehåller interna länkar som gav felstatus.',
    recommendation: 'Uppdatera eller omdirigera trasiga interna mål.',
    manualCheck:
      'Testa varje länk igen och uteslut blockering eller tillfälliga fel.',
  },
  {
    id: 'CRW-009',
    category: 'crawlability',
    severity: 'medium',
    rootCause: 'information-architecture',
    title: 'Föräldralösa sidor',
    fact: 'crawl.orphan_page_count',
    operator: 'gt',
    value: 0,
    safeFinding: 'Underlaget anger indexerbara sidor utan interna inlänkar.',
    recommendation:
      'Länka relevanta sidor från navigation eller innehåll, eller avindexera dem.',
    manualCheck: 'Jämför crawl, sitemap och analysdata för att bekräfta.',
  },
  {
    id: 'CRW-010',
    category: 'crawlability',
    severity: 'medium',
    rootCause: 'information-architecture',
    title: 'Viktiga sidor ligger djupt',
    fact: 'crawl.max_priority_page_depth',
    operator: 'gt',
    value: 4,
    safeFinding: 'Minst en prioriterad sida anges ligga djupare än fyra klick.',
    recommendation: 'Förenkla strukturen och skapa relevanta interna länkar.',
    manualCheck:
      'Bedöm klickdjup från verkliga ingångar, inte endast crawlarens startpunkt.',
  },

  // Prestanda — 10
  {
    id: 'PER-001',
    category: 'performance',
    severity: 'high',
    rootCause: 'lcp',
    title: 'Långsam största innehållsrendering på mobil',
    fact: 'performance.mobile_lcp_ms',
    operator: 'gt',
    value: 4000,
    safeFinding: 'Det importerade mobilvärdet för LCP är över 4 000 ms.',
    recommendation:
      'Optimera huvudresurs, serverrespons och renderingskritiska beroenden.',
    manualCheck: 'Bekräfta med flera körningar och helst fältdata.',
    maxEvidenceAgeDays: 30,
  },
  {
    id: 'PER-002',
    category: 'performance',
    severity: 'high',
    rootCause: 'interaction',
    title: 'Långsam interaktion på mobil',
    fact: 'performance.mobile_inp_ms',
    operator: 'gt',
    value: 500,
    safeFinding: 'Det importerade INP-värdet är över 500 ms.',
    recommendation: 'Minska långa huvudtrådsjobb och tung händelselogik.',
    manualCheck: 'Bekräfta att värdet är fältdata och har tillräckligt urval.',
    maxEvidenceAgeDays: 30,
  },
  {
    id: 'PER-003',
    category: 'performance',
    severity: 'high',
    rootCause: 'layout-shift',
    title: 'Stor layoutförskjutning',
    fact: 'performance.mobile_cls',
    operator: 'gt',
    value: 0.25,
    safeFinding: 'Det importerade CLS-värdet är över 0,25.',
    recommendation:
      'Reservera utrymme för bilder, typsnitt och dynamiska element.',
    manualCheck: 'Reproducera sidladdningen och identifiera flyttande element.',
    maxEvidenceAgeDays: 30,
  },
  {
    id: 'PER-004',
    category: 'performance',
    severity: 'medium',
    rootCause: 'server-response',
    title: 'Lång serverresponstid',
    fact: 'performance.mobile_ttfb_ms',
    operator: 'gt',
    value: 800,
    safeFinding: 'Det importerade TTFB-värdet är över 800 ms.',
    recommendation: 'Granska hosting, cache, databas och backendarbete.',
    manualCheck:
      'Mät från flera platser och skilj nätverkslatens från serverarbete.',
    maxEvidenceAgeDays: 30,
  },
  {
    id: 'PER-005',
    category: 'performance',
    severity: 'medium',
    rootCause: 'javascript',
    title: 'Hög blockerande tid',
    fact: 'performance.mobile_tbt_ms',
    operator: 'gt',
    value: 600,
    safeFinding: 'Det importerade laboratorievärdet för TBT är över 600 ms.',
    recommendation: 'Dela upp JavaScript och skjut upp icke-kritisk kod.',
    manualCheck: 'Bekräfta i ett repeterbart laboratorietest.',
    maxEvidenceAgeDays: 30,
  },
  {
    id: 'PER-006',
    category: 'performance',
    severity: 'medium',
    rootCause: 'page-weight',
    title: 'Stor total sidvikt',
    fact: 'performance.total_transfer_kb',
    operator: 'gt',
    value: 3000,
    safeFinding: 'Den importerade överföringsmängden är över 3 000 kB.',
    recommendation: 'Prioritera bilder, video, typsnitt och oanvänd kod.',
    manualCheck: 'Kontrollera kall cache och om tredjepartsinnehåll ingår.',
    maxEvidenceAgeDays: 30,
  },
  {
    id: 'PER-007',
    category: 'performance',
    severity: 'medium',
    rootCause: 'javascript',
    title: 'Stor JavaScript-mängd',
    fact: 'performance.javascript_transfer_kb',
    operator: 'gt',
    value: 1000,
    safeFinding: 'Importerad JavaScript-överföring överstiger 1 000 kB.',
    recommendation: 'Ta bort oanvänd kod, dela paket och ladda behovsstyrt.',
    manualCheck: 'Kontrollera komprimerad överföring och första sidladdningen.',
    maxEvidenceAgeDays: 30,
  },
  {
    id: 'PER-008',
    category: 'performance',
    severity: 'medium',
    rootCause: 'images',
    title: 'Stor bildöverföring',
    fact: 'performance.image_transfer_kb',
    operator: 'gt',
    value: 2000,
    safeFinding: 'Importerad bildöverföring överstiger 2 000 kB.',
    recommendation: 'Komprimera, storleksanpassa och använd moderna format.',
    manualCheck: 'Kontrollera vilka bilder som faktiskt laddas i aktuell vy.',
    maxEvidenceAgeDays: 30,
  },
  {
    id: 'PER-009',
    category: 'performance',
    severity: 'medium',
    rootCause: 'images',
    title: 'Överdimensionerade bilder',
    fact: 'performance.oversized_image_count',
    operator: 'gt',
    value: 0,
    safeFinding: 'Minst en bild anges vara större än sin visade storlek.',
    recommendation: 'Leverera responsiva bildstorlekar med srcset/sizes.',
    manualCheck:
      'Jämför resursens pixlar med renderad storlek på flera brytpunkter.',
    maxEvidenceAgeDays: 30,
  },
  {
    id: 'PER-010',
    category: 'performance',
    severity: 'low',
    rootCause: 'asset-delivery',
    title: 'Statisk komprimering saknas',
    fact: 'performance.uncompressed_text_resource_count',
    operator: 'gt',
    value: 0,
    safeFinding: 'Minst en textresurs anges sakna överföringskomprimering.',
    recommendation: 'Aktivera Brotli eller gzip för textresurser.',
    manualCheck: 'Kontrollera Content-Encoding på den slutliga responsen.',
    maxEvidenceAgeDays: 30,
  },

  // Mobil — 10
  {
    id: 'MOB-001',
    category: 'mobile',
    severity: 'high',
    rootCause: 'responsive-layout',
    title: 'Viewport-inställning saknas',
    fact: 'mobile.viewport_meta_present',
    operator: 'eq',
    value: false,
    safeFinding: 'Underlaget anger att viewport-meta saknas.',
    recommendation: 'Lägg till en korrekt responsiv viewport-inställning.',
    manualCheck: 'Kontrollera rå HTML och verklig mobilrendering.',
  },
  {
    id: 'MOB-002',
    category: 'mobile',
    severity: 'high',
    rootCause: 'responsive-layout',
    title: 'Horisontell mobilscroll',
    fact: 'mobile.horizontal_overflow_px',
    operator: 'gt',
    value: 0,
    safeFinding: 'Underlaget visar horisontellt överflöde i testad mobilbredd.',
    recommendation:
      'Rätta fasta bredder, långa strängar och överskjutande element.',
    manualCheck: 'Testa 320, 375 och 430 CSS-pixlar och lokalisera elementet.',
  },
  {
    id: 'MOB-003',
    category: 'mobile',
    severity: 'medium',
    rootCause: 'tap-targets',
    title: 'Små tryckytor',
    fact: 'mobile.small_tap_target_count',
    operator: 'gt',
    value: 0,
    safeFinding:
      'Minst en interaktiv yta anges vara för liten eller ligga för tätt.',
    recommendation: 'Öka träffytor och avstånd för pekskärm.',
    manualCheck: 'Kontrollera de markerade elementen på en fysisk mobil.',
  },
  {
    id: 'MOB-004',
    category: 'mobile',
    severity: 'medium',
    rootCause: 'typography',
    title: 'För liten mobiltext',
    fact: 'mobile.small_text_count',
    operator: 'gt',
    value: 0,
    safeFinding: 'Underlaget markerar text som liten i mobilvyn.',
    recommendation: 'Öka basstorlek och radavstånd utan att tappa hierarki.',
    manualCheck:
      'Bedöm läsbarhet vid normal zoom; undantag kan finnas för metadata.',
  },
  {
    id: 'MOB-005',
    category: 'mobile',
    severity: 'high',
    rootCause: 'navigation',
    title: 'Mobilnavigationen kan inte användas',
    fact: 'mobile.navigation_usable',
    operator: 'eq',
    value: false,
    safeFinding:
      'Det importerade funktionstestet kunde inte använda mobilnavigationen.',
    recommendation: 'Rätta öppning, fokus, stängning och länkaktivering.',
    manualCheck: 'Testa med touch, tangentbord och skärmläsare.',
  },
  {
    id: 'MOB-006',
    category: 'mobile',
    severity: 'high',
    rootCause: 'overlay',
    title: 'Överlägg blockerar innehåll',
    fact: 'mobile.blocking_overlay',
    operator: 'eq',
    value: true,
    safeFinding:
      'Underlaget visar ett överlägg som blockerar centralt innehåll eller kontroll.',
    recommendation: 'Minska överlägget och ge tydlig stängning.',
    manualCheck: 'Kontrollera första besök, återbesök och olika mobilhöjder.',
  },
  {
    id: 'MOB-007',
    category: 'mobile',
    severity: 'medium',
    rootCause: 'forms-mobile',
    title: 'Formulärfält ryms inte på mobil',
    fact: 'mobile.form_overflow_count',
    operator: 'gt',
    value: 0,
    safeFinding: 'Minst ett formulärfält anges gå utanför mobilvyn.',
    recommendation: 'Gör fält och feltexter responsiva.',
    manualCheck: 'Testa autofyll, valideringsfel och öppet skärmtangentbord.',
  },
  {
    id: 'MOB-008',
    category: 'mobile',
    severity: 'medium',
    rootCause: 'media-mobile',
    title: 'Media bryter mobilbredden',
    fact: 'mobile.media_overflow_count',
    operator: 'gt',
    value: 0,
    safeFinding: 'Bild, video eller inbäddning anges överskrida mobilbredden.',
    recommendation:
      'Begränsa media till behållarens bredd och bevara proportioner.',
    manualCheck: 'Kontrollera samtliga markerade bäddar och samtyckeslägen.',
  },
  {
    id: 'MOB-009',
    category: 'mobile',
    severity: 'medium',
    rootCause: 'sticky-elements',
    title: 'Fasta element täcker stor del av vyn',
    fact: 'mobile.sticky_coverage_percent',
    operator: 'gt',
    value: 30,
    safeFinding: 'Fasta element anges täcka mer än 30 procent av mobilhöjden.',
    recommendation: 'Minska eller kollapsa fasta element.',
    manualCheck: 'Mät med adressfält och skärmtangentbord i realistiskt läge.',
  },
  {
    id: 'MOB-010',
    category: 'mobile',
    severity: 'medium',
    rootCause: 'orientation',
    title: 'Innehåll låses till en orientering',
    fact: 'mobile.orientation_locked',
    operator: 'eq',
    value: true,
    safeFinding:
      'Underlaget anger att innehållet kräver en viss skärmorientering.',
    recommendation: 'Stöd både stående och liggande vy där det är möjligt.',
    manualCheck:
      'Bekräfta på fysisk enhet och undanta endast nödvändiga specialflöden.',
  },

  // Tillgänglighet — 10
  {
    id: 'A11Y-001',
    category: 'accessibility',
    severity: 'medium',
    rootCause: 'document-language',
    title: 'Dokumentspråk saknas',
    fact: 'a11y.html_lang_present',
    operator: 'eq',
    value: false,
    safeFinding: 'Underlaget anger att html-elementet saknar lang.',
    recommendation: 'Ange korrekt huvudspråk och språkbyten i innehållet.',
    manualCheck: 'Kontrollera serverrenderad HTML och språkets riktighet.',
  },
  {
    id: 'A11Y-002',
    category: 'accessibility',
    severity: 'high',
    rootCause: 'page-structure',
    title: 'Huvudrubrik saknas',
    fact: 'a11y.h1_count',
    operator: 'eq',
    value: 0,
    safeFinding: 'Ingen h1-rubrik finns i det importerade dokumentträdet.',
    recommendation: 'Lägg till en tydlig huvudrubrik som beskriver sidan.',
    manualCheck: 'Bedöm semantisk rubrik, inte bara visuell storlek.',
  },
  {
    id: 'A11Y-003',
    category: 'accessibility',
    severity: 'medium',
    rootCause: 'page-structure',
    title: 'Rubriknivåer hoppas över',
    fact: 'a11y.heading_skip_count',
    operator: 'gt',
    value: 0,
    safeFinding: 'Underlaget visar hopp i rubrikhierarkin.',
    recommendation: 'Ordna rubriker efter innehållsnivå, inte utseende.',
    manualCheck:
      'Läs sidan som en innehållsförteckning och bedöm sammanhanget.',
  },
  {
    id: 'A11Y-004',
    category: 'accessibility',
    severity: 'high',
    rootCause: 'image-alternatives',
    title: 'Bilder saknar alternativtext',
    fact: 'a11y.missing_alt_count',
    operator: 'gt',
    value: 0,
    safeFinding: 'Minst en relevant bild anges sakna alt-text.',
    recommendation:
      'Beskriv informativa bilder och ge dekorativa bilder tom alt-text.',
    manualCheck:
      'Kontrollera bildens syfte; filnamn är inte automatiskt en bra alt-text.',
  },
  {
    id: 'A11Y-005',
    category: 'accessibility',
    severity: 'high',
    rootCause: 'accessible-names',
    title: 'Kontroller saknar tillgängligt namn',
    fact: 'a11y.unnamed_control_count',
    operator: 'gt',
    value: 0,
    safeFinding:
      'Minst en knapp eller kontroll saknar beräknat tillgängligt namn.',
    recommendation: 'Lägg till synlig etikett eller korrekt tillgängligt namn.',
    manualCheck: 'Inspektera tillgänglighetsträdet och kontrollens sammanhang.',
  },
  {
    id: 'A11Y-006',
    category: 'accessibility',
    severity: 'high',
    rootCause: 'forms-labels',
    title: 'Formulärfält saknar etikett',
    fact: 'a11y.unlabelled_field_count',
    operator: 'gt',
    value: 0,
    safeFinding: 'Minst ett formulärfält anges sakna programmatisk etikett.',
    recommendation: 'Koppla synliga label-element till varje fält.',
    manualCheck: 'Placeholder räknas inte som fullgod etikett.',
  },
  {
    id: 'A11Y-007',
    category: 'accessibility',
    severity: 'high',
    rootCause: 'contrast',
    title: 'Otillräcklig textkontrast',
    fact: 'a11y.contrast_failure_count',
    operator: 'gt',
    value: 0,
    safeFinding:
      'Underlaget innehåller minst en kontrastkontroll som inte klarades.',
    recommendation: 'Justera färger och testa normala, hover- och fokuslägen.',
    manualCheck: 'Bekräfta faktisk textstorlek, bakgrund och opacitet.',
  },
  {
    id: 'A11Y-008',
    category: 'accessibility',
    severity: 'critical',
    rootCause: 'keyboard',
    title: 'Tangentbordsfälla',
    fact: 'a11y.keyboard_trap_count',
    operator: 'gt',
    value: 0,
    safeFinding:
      'Det importerade tangentbordstestet fastnade i minst en komponent.',
    recommendation:
      'Säkerställ att fokus kan lämna komponenten med standardtangenter.',
    manualCheck: 'Reproducera från sidans början utan mus.',
  },
  {
    id: 'A11Y-009',
    category: 'accessibility',
    severity: 'high',
    rootCause: 'focus',
    title: 'Synlig fokusmarkering saknas',
    fact: 'a11y.focus_visible',
    operator: 'eq',
    value: false,
    safeFinding: 'Underlaget anger att tangentbordsfokus inte syns tydligt.',
    recommendation: 'Inför konsekvent fokusindikator med tillräcklig kontrast.',
    manualCheck:
      'Tabba igenom alla interaktiva element och kontrollera flera teman.',
  },
  {
    id: 'A11Y-010',
    category: 'accessibility',
    severity: 'high',
    rootCause: 'captions',
    title: 'Video saknar textning',
    fact: 'a11y.uncaptioned_video_count',
    operator: 'gt',
    value: 0,
    safeFinding: 'Minst en video med ljud anges sakna textning.',
    recommendation:
      'Lägg till synkroniserad textning och vid behov transkription.',
    manualCheck:
      'Kontrollera om videon faktiskt innehåller meningsbärande ljud.',
  },

  // SEO på sidan — 10
  {
    id: 'SEO-001',
    category: 'onpage-seo',
    severity: 'high',
    rootCause: 'page-title',
    title: 'Sidtitel saknas',
    fact: 'seo.title_present',
    operator: 'eq',
    value: false,
    safeFinding: 'Det importerade dokumentet saknar en sidtitel.',
    recommendation: 'Skriv en unik och beskrivande titel för sidan.',
    manualCheck: 'Kontrollera rå HTML och att rätt sida analyserats.',
  },
  {
    id: 'SEO-002',
    category: 'onpage-seo',
    severity: 'low',
    rootCause: 'page-title',
    title: 'Sidtiteln är mycket kort',
    fact: 'seo.title_length',
    operator: 'lt',
    value: 20,
    appliesWhen: clause('seo.title_present', 'eq', true),
    safeFinding: 'Den importerade sidtiteln är kortare än 20 tecken.',
    recommendation:
      'Beskriv tjänst, företag och relevant lokal kontext naturligt.',
    manualCheck:
      'Bedöm mening och sökintention; längd är endast en varningssignal.',
  },
  {
    id: 'SEO-003',
    category: 'onpage-seo',
    severity: 'low',
    rootCause: 'page-title',
    title: 'Sidtiteln är lång',
    fact: 'seo.title_length',
    operator: 'gt',
    value: 60,
    safeFinding: 'Den importerade sidtiteln är längre än 60 tecken.',
    recommendation: 'Prioritera det viktigaste tidigt och ta bort upprepning.',
    manualCheck: 'Kontrollera faktisk visning; längd är inte ett absolut fel.',
  },
  {
    id: 'SEO-004',
    category: 'onpage-seo',
    severity: 'medium',
    rootCause: 'meta-description',
    title: 'Metabeskrivning saknas',
    fact: 'seo.meta_description_present',
    operator: 'eq',
    value: false,
    safeFinding: 'Det importerade dokumentet saknar metabeskrivning.',
    recommendation: 'Skriv en unik sammanfattning med tydligt nästa steg.',
    manualCheck: 'Bekräfta rå HTML och om sökmotorn kan välja egen text.',
  },
  {
    id: 'SEO-005',
    category: 'onpage-seo',
    severity: 'low',
    rootCause: 'meta-description',
    title: 'Metabeskrivningen är mycket kort',
    fact: 'seo.meta_description_length',
    operator: 'lt',
    value: 70,
    appliesWhen: clause('seo.meta_description_present', 'eq', true),
    safeFinding: 'Den importerade metabeskrivningen är kortare än 70 tecken.',
    recommendation: 'Använd utrymmet för relevant nytta och kontext.',
    manualCheck:
      'Bedöm kvalitet och avsikt; längd ensam bevisar inget problem.',
  },
  {
    id: 'SEO-006',
    category: 'onpage-seo',
    severity: 'low',
    rootCause: 'meta-description',
    title: 'Metabeskrivningen är lång',
    fact: 'seo.meta_description_length',
    operator: 'gt',
    value: 160,
    safeFinding: 'Den importerade metabeskrivningen är längre än 160 tecken.',
    recommendation: 'Flytta viktig information tidigt och förkorta upprepning.',
    manualCheck: 'Kontrollera faktisk resultatsida; visningen kan variera.',
  },
  {
    id: 'SEO-007',
    category: 'onpage-seo',
    severity: 'medium',
    rootCause: 'duplicate-metadata',
    title: 'Duplicerade sidtitlar',
    fact: 'seo.duplicate_title_page_count',
    operator: 'gt',
    value: 0,
    safeFinding: 'Underlaget anger flera indexerbara sidor med samma titel.',
    recommendation: 'Ge varje viktig sida en unik beskrivande titel.',
    manualCheck: 'Uteslut paginering, språkvarianter och avsiktliga dubletter.',
  },
  {
    id: 'SEO-008',
    category: 'onpage-seo',
    severity: 'medium',
    rootCause: 'thin-content',
    title: 'Tunna viktiga sidor',
    fact: 'seo.thin_priority_page_count',
    operator: 'gt',
    value: 0,
    safeFinding:
      'Underlaget markerar prioriterade sidor med mycket lite huvudinnehåll.',
    recommendation:
      'Besvara kundens viktigaste frågor med konkret och originellt innehåll.',
    manualCheck:
      'Bedöm sidans uppgift; kort innehåll kan vara helt tillräckligt.',
  },
  {
    id: 'SEO-009',
    category: 'onpage-seo',
    severity: 'medium',
    rootCause: 'structured-data',
    title: 'Fel i strukturerad data',
    fact: 'seo.structured_data_error_count',
    operator: 'gt',
    value: 0,
    safeFinding:
      'Den importerade valideringen innehåller fel i strukturerad data.',
    recommendation:
      'Rätta syntax och egenskaper så de motsvarar synligt innehåll.',
    manualCheck:
      'Kontrollera fel mot aktuell sidtyp och skilj varning från fel.',
  },
  {
    id: 'SEO-010',
    category: 'onpage-seo',
    severity: 'low',
    rootCause: 'social-preview',
    title: 'Social förhandsvisning saknas',
    fact: 'seo.open_graph_complete',
    operator: 'eq',
    value: false,
    safeFinding:
      'Underlaget saknar en komplett Open Graph-titel, beskrivning eller bild.',
    recommendation: 'Lägg till sidnära metadata för delning.',
    manualCheck:
      'Kontrollera att sidan faktiskt är avsedd att delas och att bilden fungerar.',
  },

  // Lokal synlighet — 10
  {
    id: 'LOC-001',
    category: 'local-seo',
    severity: 'medium',
    rootCause: 'local-relevance',
    title: 'Ort eller serviceområde är otydligt',
    fact: 'local.location_clarity',
    operator: 'eq',
    value: false,
    safeFinding:
      'Underlaget hittar inte en tydlig ort eller ett tydligt serviceområde.',
    recommendation:
      'Beskriv var företaget finns och vilka områden som betjänas.',
    manualCheck:
      'Läs startsida, kontakt och tjänstesidor; undvik onaturlig ortsupprepning.',
  },
  {
    id: 'LOC-002',
    category: 'local-seo',
    severity: 'high',
    rootCause: 'nap',
    title: 'Företagsuppgifter är ofullständiga',
    fact: 'local.nap_complete',
    operator: 'eq',
    value: false,
    safeFinding:
      'Namn, adress eller offentligt företagsnummer saknas i underlaget.',
    recommendation:
      'Visa konsekventa företagsuppgifter där kunder förväntar sig dem.',
    manualCheck: 'Ta hänsyn till verksamheter utan besöksadress.',
  },
  {
    id: 'LOC-003',
    category: 'local-seo',
    severity: 'high',
    rootCause: 'nap',
    title: 'Motstridiga företagsuppgifter',
    fact: 'local.nap_conflict_count',
    operator: 'gt',
    value: 0,
    safeFinding:
      'Underlaget innehåller motstridiga namn-, adress- eller telefonuppgifter.',
    recommendation:
      'Fastställ en korrekt företagsprofil och uppdatera avvikande platser.',
    manualCheck:
      'Bekräfta juridiskt namn, marknadsnamn och filialer innan ändring.',
  },
  {
    id: 'LOC-004',
    category: 'local-seo',
    severity: 'medium',
    rootCause: 'local-structured-data',
    title: 'LocalBusiness-data saknas',
    fact: 'local.local_business_schema_present',
    operator: 'eq',
    value: false,
    safeFinding: 'Underlaget hittar ingen LocalBusiness-strukturerad data.',
    recommendation:
      'Lägg till korrekt schema som speglar synliga företagsuppgifter.',
    manualCheck: 'Schema är ett stöd, inte en garanti för synlighet.',
  },
  {
    id: 'LOC-005',
    category: 'local-seo',
    severity: 'medium',
    rootCause: 'local-structured-data',
    title: 'LocalBusiness-data är ofullständig',
    fact: 'local.local_business_schema_complete',
    operator: 'eq',
    value: false,
    appliesWhen: clause('local.local_business_schema_present', 'eq', true),
    safeFinding: 'Importerad LocalBusiness-data saknar centrala uppgifter.',
    recommendation:
      'Komplettera endast med korrekta, synliga och relevanta egenskaper.',
    manualCheck: 'Validera typ, adress, telefon, URL och öppettider mot sidan.',
  },
  {
    id: 'LOC-006',
    category: 'local-seo',
    severity: 'medium',
    rootCause: 'opening-hours',
    title: 'Öppettider saknas',
    fact: 'local.opening_hours_present',
    operator: 'eq',
    value: false,
    appliesWhen: clause('business.has_public_opening_hours', 'eq', true),
    safeFinding:
      'Underlaget hittar inga öppettider trots att verksamheten har publika tider.',
    recommendation: 'Visa aktuella tider och hur avvikelser hanteras.',
    manualCheck:
      'Bekräfta att verksamheten faktiskt tar emot kunder på fasta tider.',
  },
  {
    id: 'LOC-007',
    category: 'local-seo',
    severity: 'high',
    rootCause: 'opening-hours',
    title: 'Öppettider motsäger annan källa',
    fact: 'local.opening_hours_conflict',
    operator: 'eq',
    value: true,
    safeFinding:
      'Webbplatsens angivna tider skiljer sig från en importerad företagskälla.',
    recommendation:
      'Verifiera rätt tider och uppdatera samtliga offentliga platser.',
    manualCheck: 'Kontrollera helgdagar, säsongstider och källans datum.',
  },
  {
    id: 'LOC-008',
    category: 'local-seo',
    severity: 'low',
    rootCause: 'directions',
    title: 'Vägbeskrivning saknas',
    fact: 'local.directions_link_present',
    operator: 'eq',
    value: false,
    appliesWhen: clause('business.has_visit_location', 'eq', true),
    safeFinding:
      'Underlaget hittar ingen tydlig väg till verksamhetens besöksplats.',
    recommendation:
      'Lägg till adress, kollektivtrafik/parkering och en frivillig kartlänk.',
    manualCheck: 'Bekräfta att besöksadress är lämplig att publicera.',
  },
  {
    id: 'LOC-009',
    category: 'local-seo',
    severity: 'high',
    rootCause: 'profile-linkage',
    title: 'Företagsprofil pekar mot annan webbplats',
    fact: 'local.profile_website_mismatch',
    operator: 'eq',
    value: true,
    safeFinding:
      'Den importerade företagsprofilens webbplats skiljer sig från granskat domännamn.',
    recommendation: 'Verifiera ägarskap och uppdatera rätt profil eller domän.',
    manualCheck:
      'Uteslut gamla domäner, bokningsdomäner och företag med flera varumärken.',
  },
  {
    id: 'LOC-010',
    category: 'local-seo',
    severity: 'medium',
    rootCause: 'service-pages',
    title: 'Lokala tjänstesidor saknas',
    fact: 'local.priority_service_location_gap_count',
    operator: 'gt',
    value: 0,
    appliesWhen: clause('business.serves_multiple_areas', 'eq', true),
    safeFinding:
      'Underlaget anger prioriterade tjänst/område-kombinationer utan relevant sida.',
    recommendation:
      'Skapa endast genuint unikt innehåll för verkliga tjänsteområden.',
    manualCheck: 'Undvik massproducerade ortssidor utan eget värde.',
  },

  // Konvertering — 10
  {
    id: 'CNV-001',
    category: 'conversion',
    severity: 'high',
    rootCause: 'primary-action',
    title: 'Primär handling saknas',
    fact: 'conversion.primary_cta_present',
    operator: 'eq',
    value: false,
    safeFinding:
      'Underlaget hittar ingen tydlig primär handling på startsidan.',
    recommendation: 'Välj ett konkret nästa steg och ge det en tydlig etikett.',
    manualCheck:
      'Bedöm handlingen i sitt visuella sammanhang och för verksamhetstypen.',
  },
  {
    id: 'CNV-002',
    category: 'conversion',
    severity: 'medium',
    rootCause: 'primary-action',
    title: 'Primär handling syns inte tidigt',
    fact: 'conversion.primary_cta_above_fold',
    operator: 'eq',
    value: false,
    appliesWhen: clause('conversion.primary_cta_present', 'eq', true),
    safeFinding:
      'Den primära handlingen anges inte vara synlig i testad första vy.',
    recommendation:
      'Placera nästa steg nära erbjudandets kärna utan att tränga undan innehåll.',
    manualCheck: 'Testa flera skärmstorlekar; vikningen varierar.',
  },
  {
    id: 'CNV-003',
    category: 'conversion',
    severity: 'medium',
    rootCause: 'cta-copy',
    title: 'Handlingsknappen är otydlig',
    fact: 'conversion.cta_copy_clear',
    operator: 'eq',
    value: false,
    safeFinding: 'Underlaget markerar den primära knapptexten som oklar.',
    recommendation:
      'Skriv vad som händer, exempelvis “Boka tid” eller “Be om offert”.',
    manualCheck: 'Låt en person utan förkunskap förklara förväntat nästa steg.',
  },
  {
    id: 'CNV-004',
    category: 'conversion',
    severity: 'high',
    rootCause: 'contact-path',
    title: 'Kontaktvägen är lång',
    fact: 'conversion.contact_click_depth',
    operator: 'gt',
    value: 2,
    safeFinding:
      'Underlaget anger fler än två steg från startsida till kontaktmöjlighet.',
    recommendation:
      'Gör relevant kontaktväg synlig i navigation och nära erbjudandet.',
    manualCheck: 'Räkna verkliga beslut och steg på både mobil och desktop.',
  },
  {
    id: 'CNV-005',
    category: 'conversion',
    severity: 'medium',
    rootCause: 'phone-action',
    title: 'Telefonnumret går inte att trycka på',
    fact: 'conversion.phone_link_present',
    operator: 'eq',
    value: false,
    appliesWhen: clause('business.public_phone_present', 'eq', true),
    safeFinding:
      'Ett offentligt telefonnummer finns men ingen telefonlänk anges.',
    recommendation: 'Gör numret klickbart på relevanta platser.',
    manualCheck:
      'Kontrollera att länken innehåller rätt internationellt nummer.',
  },
  {
    id: 'CNV-006',
    category: 'conversion',
    severity: 'medium',
    rootCause: 'email-action',
    title: 'E-postvägen är inte aktiverbar',
    fact: 'conversion.email_link_present',
    operator: 'eq',
    value: false,
    appliesWhen: clause('business.public_email_present', 'eq', true),
    safeFinding:
      'En offentlig e-postadress finns men ingen aktiverbar e-postlänk anges.',
    recommendation:
      'Gör adressen enkel att kopiera eller öppna i e-postklient.',
    manualCheck: 'Bedöm spamrisk och om formulär är föredragen väg.',
  },
  {
    id: 'CNV-007',
    category: 'conversion',
    severity: 'medium',
    rootCause: 'navigation',
    title: 'Huvudnavigationen är överfull',
    fact: 'conversion.primary_nav_item_count',
    operator: 'gt',
    value: 8,
    safeFinding:
      'Huvudnavigationen innehåller fler än åtta objekt i underlaget.',
    recommendation:
      'Gruppera efter kundens viktigaste uppgifter och flytta sekundärt innehåll.',
    manualCheck:
      'Antal är en signal; testa om etiketter och grupper ändå är begripliga.',
  },
  {
    id: 'CNV-008',
    category: 'conversion',
    severity: 'high',
    rootCause: 'broken-actions',
    title: 'Trasiga handlingslänkar',
    fact: 'conversion.broken_cta_count',
    operator: 'gt',
    value: 0,
    safeFinding:
      'Minst en primär eller sekundär handlingslänk gav fel i underlaget.',
    recommendation: 'Rätta mål, ankare, formulärstart eller bokningslänk.',
    manualCheck:
      'Prova utan administratörssession och fullfölj till nästa steg.',
  },
  {
    id: 'CNV-009',
    category: 'conversion',
    severity: 'medium',
    rootCause: 'offer-clarity',
    title: 'Erbjudandet är otydligt',
    fact: 'conversion.offer_clarity',
    operator: 'eq',
    value: false,
    safeFinding:
      'Det importerade innehållsunderlaget kan inte tydligt identifiera tjänst, målgrupp och nästa steg.',
    recommendation:
      'Förklara vad företaget gör, för vem och hur kunden går vidare.',
    manualCheck:
      'Detta är en tolkningssignal; låt en människa läsa sidan innan påstående.',
  },
  {
    id: 'CNV-010',
    category: 'conversion',
    severity: 'medium',
    rootCause: 'competing-actions',
    title: 'För många konkurrerande huvudhandlingar',
    fact: 'conversion.primary_cta_variant_count',
    operator: 'gt',
    value: 3,
    safeFinding: 'Underlaget anger fler än tre likvärdiga huvudhandlingar.',
    recommendation:
      'Skapa en tydlig primär väg och nedtona sekundära alternativ.',
    manualCheck: 'Bedöm visuell tyngd, inte bara antal länkar.',
  },

  // Innehåll & förtroende — 10
  {
    id: 'TRU-001',
    category: 'content-trust',
    severity: 'high',
    rootCause: 'placeholder-content',
    title: 'Platshållartext är publicerad',
    fact: 'content.placeholder_text_count',
    operator: 'gt',
    value: 0,
    safeFinding: 'Underlaget hittar uttryck som markerats som platshållartext.',
    recommendation: 'Ersätt med granskat företagsanpassat innehåll.',
    manualCheck:
      'Kontrollera sammanhanget; ord som “test” kan vara legitimt innehåll.',
  },
  {
    id: 'TRU-002',
    category: 'content-trust',
    severity: 'high',
    rootCause: 'broken-media',
    title: 'Bilder laddas inte',
    fact: 'content.broken_image_count',
    operator: 'gt',
    value: 0,
    safeFinding: 'Minst en bildresurs gav fel enligt underlaget.',
    recommendation: 'Rätta adress, filnamn, behörighet eller borttagen resurs.',
    manualCheck: 'Testa utan cache och uteslut blockerad tredjepartsresurs.',
  },
  {
    id: 'TRU-003',
    category: 'content-trust',
    severity: 'medium',
    rootCause: 'encoding',
    title: 'Trasiga tecken i innehållet',
    fact: 'content.encoding_error_count',
    operator: 'gt',
    value: 0,
    safeFinding: 'Underlaget markerar tecken som tyder på kodningsfel.',
    recommendation: 'Rätta teckenkodning och datakälla till UTF-8.',
    manualCheck:
      'Bekräfta visuellt; ovanliga men korrekta tecken får inte räknas som fel.',
  },
  {
    id: 'TRU-004',
    category: 'content-trust',
    severity: 'medium',
    rootCause: 'stale-content',
    title: 'Synligt föråldrad information',
    fact: 'content.stale_statement_count',
    operator: 'gt',
    value: 0,
    safeFinding:
      'Underlaget markerar minst ett daterat påstående som kan vara föråldrat.',
    recommendation:
      'Verifiera och uppdatera tidbundna priser, erbjudanden eller datum.',
    manualCheck:
      'Kontrollera publiceringssammanhang och arkivsidor innan ändring.',
  },
  {
    id: 'TRU-005',
    category: 'content-trust',
    severity: 'medium',
    rootCause: 'business-identity',
    title: 'Företagets identitet är otydlig',
    fact: 'trust.business_identity_clear',
    operator: 'eq',
    value: false,
    safeFinding:
      'Underlaget kan inte tydligt identifiera vilket företag som står bakom sidan.',
    recommendation:
      'Visa företagsnamn och relevanta offentliga företagsuppgifter.',
    manualCheck:
      'Skilj varumärke från juridiskt namn och undvik privat persondata.',
  },
  {
    id: 'TRU-006',
    category: 'content-trust',
    severity: 'medium',
    rootCause: 'contact-information',
    title: 'Kontaktsida saknas',
    fact: 'trust.contact_page_present',
    operator: 'eq',
    value: false,
    safeFinding:
      'Underlaget hittar ingen tydlig samlad kontaktsida eller motsvarande sektion.',
    recommendation: 'Samla relevanta kontaktvägar och förväntad svarstid.',
    manualCheck:
      'En en-sideswebb kan ha fullgod kontaktsektion utan egen sida.',
  },
  {
    id: 'TRU-007',
    category: 'content-trust',
    severity: 'low',
    rootCause: 'about-information',
    title: 'Om-verksamheten-information saknas',
    fact: 'trust.about_information_present',
    operator: 'eq',
    value: false,
    safeFinding:
      'Underlaget hittar ingen beskrivning av verksamheten bakom erbjudandet.',
    recommendation: 'Lägg till kort, konkret bakgrund och arbetssätt.',
    manualCheck: 'Bedöm behovet utifrån bransch och kundens risknivå.',
  },
  {
    id: 'TRU-008',
    category: 'content-trust',
    severity: 'high',
    rootCause: 'claims',
    title: 'Starka påståenden saknar synligt stöd',
    fact: 'trust.unsupported_claim_count',
    operator: 'gt',
    value: 0,
    safeFinding:
      'Underlaget markerar starka resultat- eller kvalitetsanspråk utan synligt stöd.',
    recommendation: 'Precisera, belägg eller tona ned påståendet.',
    manualCheck:
      'Mänsklig bedömning krävs; automatisk textanalys är inte bevis.',
  },
  {
    id: 'TRU-009',
    category: 'content-trust',
    severity: 'high',
    rootCause: 'testimonials',
    title: 'Otydliga kundomdömen',
    fact: 'trust.unattributed_testimonial_count',
    operator: 'gt',
    value: 0,
    safeFinding:
      'Underlaget hittar omdömen utan tydlig och rimlig attribution.',
    recommendation:
      'Använd verifierbara omdömen med tillåtelse eller ta bort dem.',
    manualCheck:
      'Kontrollera samtycke, källa och om anonymisering är avsiktlig.',
  },
  {
    id: 'TRU-010',
    category: 'content-trust',
    severity: 'medium',
    rootCause: 'external-presence',
    title: 'Trasiga sociala länkar',
    fact: 'trust.broken_social_link_count',
    operator: 'gt',
    value: 0,
    safeFinding:
      'Minst en angiven social länk gav fel eller pekade mot fel profil.',
    recommendation: 'Uppdatera eller ta bort inaktiva profillänkar.',
    manualCheck: 'Bekräfta att plattformen inte blockerade testverktyget.',
  },

  // Formulär & handel — 10
  {
    id: 'FRM-001',
    category: 'forms-commerce',
    severity: 'critical',
    rootCause: 'form-delivery',
    title: 'Kontaktformuläret kan inte skickas',
    fact: 'forms.contact_submission_success',
    operator: 'eq',
    value: false,
    appliesWhen: clause('forms.contact_form_present', 'eq', true),
    safeFinding:
      'Det importerade funktionstestet kunde inte skicka kontaktformuläret.',
    recommendation:
      'Rätta validering, endpoint och e-postleverans och lägg till övervakning.',
    manualCheck:
      'Använd en tydligt märkt testpost och kontrollera både bekräftelse och mottagning.',
    maxEvidenceAgeDays: 14,
  },
  {
    id: 'FRM-002',
    category: 'forms-commerce',
    severity: 'high',
    rootCause: 'form-feedback',
    title: 'Formuläret saknar tydlig bekräftelse',
    fact: 'forms.success_confirmation_clear',
    operator: 'eq',
    value: false,
    appliesWhen: clause('forms.contact_form_present', 'eq', true),
    safeFinding:
      'Underlaget anger att lyckad inskickning inte bekräftas tydligt.',
    recommendation: 'Visa vad som skickades och vad som händer härnäst.',
    manualCheck:
      'Testa skärmläsarannonsering och om sidan faktiskt tog emot posten.',
  },
  {
    id: 'FRM-003',
    category: 'forms-commerce',
    severity: 'high',
    rootCause: 'form-validation',
    title: 'Formulärfel är otydliga',
    fact: 'forms.validation_errors_clear',
    operator: 'eq',
    value: false,
    appliesWhen: clause('forms.contact_form_present', 'eq', true),
    safeFinding:
      'Det importerade testet kunde inte förstå eller hitta valideringsfelen.',
    recommendation:
      'Koppla konkreta fel till fälten och sammanfatta vid behov.',
    manualCheck: 'Testa tomma, felaktiga och ovanligt långa värden.',
  },
  {
    id: 'FRM-004',
    category: 'forms-commerce',
    severity: 'medium',
    rootCause: 'form-friction',
    title: 'Många obligatoriska fält',
    fact: 'forms.required_field_count',
    operator: 'gt',
    value: 7,
    appliesWhen: clause('forms.contact_form_present', 'eq', true),
    safeFinding: 'Kontaktformuläret anges ha fler än sju obligatoriska fält.',
    recommendation: 'Behåll endast information som behövs för nästa steg.',
    manualCheck:
      'Antal är en signal; komplexa offertförfrågningar kan motivera fler fält.',
  },
  {
    id: 'FRM-005',
    category: 'forms-commerce',
    severity: 'high',
    rootCause: 'booking',
    title: 'Bokningslänken fungerar inte',
    fact: 'commerce.booking_path_works',
    operator: 'eq',
    value: false,
    appliesWhen: clause('business.accepts_booking', 'eq', true),
    safeFinding: 'Det importerade testet kunde inte nå eller starta bokningen.',
    recommendation: 'Rätta bokningsadress, tjänsteval och integration.',
    manualCheck:
      'Avbryt före verklig bokning och kontrollera öppettider/kapacitet.',
  },
  {
    id: 'FRM-006',
    category: 'forms-commerce',
    severity: 'high',
    rootCause: 'booking-mobile',
    title: 'Bokningen fungerar inte på mobil',
    fact: 'commerce.booking_mobile_usable',
    operator: 'eq',
    value: false,
    appliesWhen: clause('business.accepts_booking', 'eq', true),
    safeFinding:
      'Underlaget markerar bokningsflödet som oanvändbart i mobilvy.',
    recommendation:
      'Rätta responsivitet, datumväljare, fokus och externa bäddar.',
    manualCheck:
      'Testa hela flödet på fysisk mobil utan att slutföra bokningen.',
  },
  {
    id: 'FRM-007',
    category: 'forms-commerce',
    severity: 'critical',
    rootCause: 'checkout',
    title: 'Kassan kan inte slutföras',
    fact: 'commerce.checkout_test_success',
    operator: 'eq',
    value: false,
    appliesWhen: clause('business.has_ecommerce', 'eq', true),
    safeFinding:
      'Det importerade testflödet kunde inte nå en fungerande orderbekräftelse.',
    recommendation:
      'Felsök varukorg, leverans, betalning och bekräftelse i testläge.',
    manualCheck:
      'Använd sandbox/testprodukt; skapa aldrig ett verkligt köp utan tillstånd.',
    maxEvidenceAgeDays: 14,
  },
  {
    id: 'FRM-008',
    category: 'forms-commerce',
    severity: 'high',
    rootCause: 'commerce-policy',
    title: 'Leverans- eller returvillkor saknas',
    fact: 'commerce.delivery_returns_info_present',
    operator: 'eq',
    value: false,
    appliesWhen: clause('business.has_ecommerce', 'eq', true),
    safeFinding:
      'Underlaget hittar inte tydlig leverans- och returinformation före köp.',
    recommendation: 'Visa aktuella villkor i anslutning till köpresan.',
    manualCheck:
      'Juridisk bedömning kan krävas; regeln avgör inte regelefterlevnad.',
  },
  {
    id: 'FRM-009',
    category: 'forms-commerce',
    severity: 'critical',
    rootCause: 'price-consistency',
    title: 'Priser motsäger varandra',
    fact: 'commerce.price_mismatch_count',
    operator: 'gt',
    value: 0,
    safeFinding:
      'Underlaget hittar olika priser för samma identifierade erbjudande.',
    recommendation:
      'Fastställ korrekt pris och synkronisera sida, varukorg och strukturerad data.',
    manualCheck: 'Kontrollera variant, moms, kampanj, valuta och tidsstämpel.',
  },
  {
    id: 'FRM-010',
    category: 'forms-commerce',
    severity: 'high',
    rootCause: 'stock-consistency',
    title: 'Lagerstatus motsäger varandra',
    fact: 'commerce.stock_mismatch_count',
    operator: 'gt',
    value: 0,
    safeFinding: 'Underlaget hittar motstridig lagerstatus för samma produkt.',
    recommendation: 'Synkronisera produktvy, varukorg och lagerkälla.',
    manualCheck:
      'Kontrollera cache, variant och om status ändrades mellan observationerna.',
  },

  // Integritet & säkerhetshygien — 10
  {
    id: 'PRV-001',
    category: 'privacy-security',
    severity: 'high',
    rootCause: 'privacy-information',
    title: 'Integritetspolicy saknas',
    fact: 'privacy.policy_present',
    operator: 'eq',
    value: false,
    appliesWhen: {
      any: [
        clause('privacy.collects_personal_data', 'eq', true),
        clause('privacy.nonessential_tracking_present', 'eq', true),
      ],
    },
    safeFinding:
      'Underlaget hittar ingen integritetsinformation trots personuppgifter eller spårning.',
    recommendation:
      'Publicera tydlig, verksamhetsanpassad information om behandlingen.',
    manualCheck:
      'Detta är inte juridisk rådgivning; verifiera faktisk behandling och rättsliga krav.',
  },
  {
    id: 'PRV-002',
    category: 'privacy-security',
    severity: 'high',
    rootCause: 'cookie-consent',
    title: 'Samtyckesval saknas för icke nödvändig spårning',
    fact: 'privacy.consent_ui_present',
    operator: 'eq',
    value: false,
    appliesWhen: clause('privacy.nonessential_tracking_present', 'eq', true),
    safeFinding:
      'I underlaget finns icke nödvändig spårning men inget samtyckesgränssnitt.',
    recommendation:
      'Blockera sådan spårning tills giltigt val gjorts och dokumentera kategorier.',
    manualCheck:
      'Verifiera teknisk laddningsordning och juridisk grund med sakkunnig.',
  },
  {
    id: 'PRV-003',
    category: 'privacy-security',
    severity: 'high',
    rootCause: 'cookie-consent',
    title: 'Spårning startar före val',
    fact: 'privacy.tracking_before_choice_count',
    operator: 'gt',
    value: 0,
    appliesWhen: clause('privacy.nonessential_tracking_present', 'eq', true),
    safeFinding:
      'Underlaget visar minst en icke nödvändig resurs före användarens val.',
    recommendation: 'Flytta laddning bakom dokumenterat samtyckestillstånd.',
    manualCheck:
      'Testa ny session utan sparade val och skilj nödvändiga resurser.',
  },
  {
    id: 'PRV-004',
    category: 'privacy-security',
    severity: 'medium',
    rootCause: 'cookie-consent',
    title: 'Avvisa-alternativet är otydligt',
    fact: 'privacy.reject_choice_clear',
    operator: 'eq',
    value: false,
    appliesWhen: clause('privacy.consent_ui_present', 'eq', true),
    safeFinding:
      'Underlaget markerar att avvisa-valet inte är lika enkelt att hitta eller använda.',
    recommendation:
      'Ge tydliga och jämförbara val utan vilseledande utformning.',
    manualCheck:
      'Mänsklig granskning krävs; visuell balans är kontextberoende.',
  },
  {
    id: 'PRV-005',
    category: 'privacy-security',
    severity: 'high',
    rootCause: 'transport-security',
    title: 'Formulär skickar inte säkert',
    fact: 'security.form_actions_https',
    operator: 'eq',
    value: false,
    appliesWhen: clause('forms.any_form_present', 'eq', true),
    safeFinding: 'Minst ett formulär anges skicka mot en icke-HTTPS-adress.',
    recommendation:
      'Skicka all formulärdata via HTTPS och kontrollera hela kedjan.',
    manualCheck:
      'Inspektera faktisk action och JavaScript-anrop; skicka inte persondata i test.',
  },
  {
    id: 'PRV-006',
    category: 'privacy-security',
    severity: 'medium',
    rootCause: 'security-headers',
    title: 'HSTS saknas',
    fact: 'security.hsts_present',
    operator: 'eq',
    value: false,
    appliesWhen: clause('transport.https_enabled', 'eq', true),
    safeFinding:
      'Det importerade headersvaret saknar Strict-Transport-Security.',
    recommendation:
      'Bedöm och inför HSTS med försiktig max-age och domänstrategi.',
    manualCheck:
      'Kontrollera alla subdomäner innan includeSubDomains eller preload.',
  },
  {
    id: 'PRV-007',
    category: 'privacy-security',
    severity: 'medium',
    rootCause: 'security-headers',
    title: 'Innehållssäkerhetspolicy saknas',
    fact: 'security.csp_present',
    operator: 'eq',
    value: false,
    safeFinding: 'Det importerade headersvaret saknar Content-Security-Policy.',
    recommendation:
      'Inför en testad policy stegvis, gärna först i report-only.',
    manualCheck:
      'Frånvaro är säkerhetshygien, inte bevis på en exploaterbar sårbarhet.',
  },
  {
    id: 'PRV-008',
    category: 'privacy-security',
    severity: 'low',
    rootCause: 'security-headers',
    title: 'MIME-sniffningsskydd saknas',
    fact: 'security.nosniff_present',
    operator: 'eq',
    value: false,
    safeFinding:
      'Det importerade headersvaret saknar X-Content-Type-Options: nosniff.',
    recommendation: 'Lägg till nosniff och säkerställ korrekta MIME-typer.',
    manualCheck: 'Verifiera på HTML och relevanta statiska resurser.',
  },
  {
    id: 'PRV-009',
    category: 'privacy-security',
    severity: 'medium',
    rootCause: 'directory-listing',
    title: 'Kataloglistning är synlig',
    fact: 'security.directory_listing_detected',
    operator: 'eq',
    value: true,
    safeFinding:
      'Underlaget visar en publik kataloglistning på en testad adress.',
    recommendation:
      'Stäng kataloglistning eller publicera endast avsedda filer.',
    manualCheck:
      'Testa endast uttryckligen tillåtna offentliga adresser; gör ingen intrångstestning.',
  },
  {
    id: 'PRV-010',
    category: 'privacy-security',
    severity: 'medium',
    rootCause: 'information-exposure',
    title: 'Serverfel visar tekniska detaljer',
    fact: 'security.stack_trace_exposed',
    operator: 'eq',
    value: true,
    safeFinding:
      'Det importerade felprovet innehåller ramverksspår eller tekniska internuppgifter.',
    recommendation: 'Visa generisk felsida publikt och logga detaljer privat.',
    manualCheck:
      'Reproducera endast med säkra, normala felvägar; försök inte framkalla intrång.',
  },

  // Kvalitet & underhåll — 10
  {
    id: 'OPS-001',
    category: 'operations',
    severity: 'medium',
    rootCause: 'error-page',
    title: '404-sidan hjälper inte besökaren',
    fact: 'operations.helpful_404_present',
    operator: 'eq',
    value: false,
    safeFinding:
      'Den importerade 404-kontrollen saknar tydlig väg tillbaka eller vidare.',
    recommendation:
      'Skapa en begriplig felsida med navigation och relevant nästa steg.',
    manualCheck:
      'Kontrollera att en saknad adress verkligen returnerar status 404.',
  },
  {
    id: 'OPS-002',
    category: 'operations',
    severity: 'medium',
    rootCause: 'runtime-errors',
    title: 'JavaScript-fel i normal sidladdning',
    fact: 'operations.console_error_count',
    operator: 'gt',
    value: 0,
    safeFinding:
      'Underlaget innehåller konsolfel under den testade normala sidladdningen.',
    recommendation:
      'Rätta fel som påverkar funktion och filtrera bort kända tilläggs-/browserfel.',
    manualCheck:
      'Reproducera i ren profil och koppla felet till användarpåverkan.',
  },
  {
    id: 'OPS-003',
    category: 'operations',
    severity: 'medium',
    rootCause: 'external-links',
    title: 'Trasiga externa länkar',
    fact: 'operations.broken_external_link_count',
    operator: 'gt',
    value: 0,
    safeFinding: 'Minst en extern länk gav fel enligt underlaget.',
    recommendation: 'Uppdatera, ersätt eller ta bort den externa länken.',
    manualCheck: 'Uteslut botblockering, inloggningskrav och tillfälliga fel.',
  },
  {
    id: 'OPS-004',
    category: 'operations',
    severity: 'low',
    rootCause: 'branding-assets',
    title: 'Webbplatsikon saknas',
    fact: 'operations.favicon_present',
    operator: 'eq',
    value: false,
    safeFinding: 'Underlaget hittar ingen fungerande webbplatsikon.',
    recommendation: 'Lägg till en tydlig ikon i relevanta format.',
    manualCheck:
      'Kontrollera flera enheter och att resursen inte bara är cachead.',
  },
  {
    id: 'OPS-005',
    category: 'operations',
    severity: 'medium',
    rootCause: 'html-quality',
    title: 'Många HTML-valideringsfel',
    fact: 'operations.html_validation_error_count',
    operator: 'gt',
    value: 10,
    safeFinding:
      'Den importerade valideringen innehåller fler än tio HTML-fel.',
    recommendation:
      'Prioritera fel som bryter struktur, formulär eller hjälpmedel.',
    manualCheck: 'Antalet ensamt avgör inte påverkan; granska feltyperna.',
  },
  {
    id: 'OPS-006',
    category: 'operations',
    severity: 'high',
    rootCause: 'dead-routes',
    title: 'Viktiga publika sidor ger fel',
    fact: 'operations.broken_priority_route_count',
    operator: 'gt',
    value: 0,
    safeFinding: 'Minst en prioriterad publik sida gav fel i underlaget.',
    recommendation:
      'Återställ sidan eller omdirigera till närmast relevanta innehåll.',
    manualCheck:
      'Bekräfta att sidan ska vara publik och att adressen är aktuell.',
  },
  {
    id: 'OPS-007',
    category: 'operations',
    severity: 'medium',
    rootCause: 'duplicate-analytics',
    title: 'Analysverktyg laddas flera gånger',
    fact: 'operations.duplicate_analytics_count',
    operator: 'gt',
    value: 0,
    safeFinding: 'Underlaget markerar dubbla instanser av samma analysverktyg.',
    recommendation: 'Samla taggstyrning och ta bort dubbla installationer.',
    manualCheck:
      'Kontrollera samtyckeslägen och om flera containrar är avsiktliga.',
  },
  {
    id: 'OPS-008',
    category: 'operations',
    severity: 'high',
    rootCause: 'dependency-risk',
    title: 'Kända kritiska klientberoenden',
    fact: 'operations.known_critical_client_dependency_count',
    operator: 'gt',
    value: 0,
    safeFinding:
      'Importerad komponentinventering markerar ett kritiskt känt klientberoende.',
    recommendation:
      'Verifiera version, faktisk exponering och planera säker uppgradering.',
    manualCheck:
      'Använd aktuell officiell advisory; versionsfingeravtryck kan vara fel.',
  },
  {
    id: 'OPS-009',
    category: 'operations',
    severity: 'medium',
    rootCause: 'email-links',
    title: 'Felaktigt formaterade e-postlänkar',
    fact: 'operations.invalid_mailto_count',
    operator: 'gt',
    value: 0,
    safeFinding:
      'Underlaget hittar e-postlänkar med ogiltigt eller motsägande mål.',
    recommendation: 'Rätta adress, kodning och synlig text.',
    manualCheck:
      'Öppna länken utan att skicka något och jämför med offentlig kontaktuppgift.',
  },
  {
    id: 'OPS-010',
    category: 'operations',
    severity: 'medium',
    rootCause: 'phone-links',
    title: 'Felaktigt formaterade telefonlänkar',
    fact: 'operations.invalid_tel_count',
    operator: 'gt',
    value: 0,
    safeFinding:
      'Underlaget hittar telefonlänkar med ogiltigt eller motsägande mål.',
    recommendation: 'Använd ett ringbart internationellt nummer i tel-målet.',
    manualCheck: 'Aktivera länken på mobil utan att genomföra samtalet.',
  },
];

const deepFreeze = <T>(value: T): T => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value))
    return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
};

// Published rule contracts are immutable. This makes content hashes cacheable
// without allowing a caller to mutate behavior behind an unchanged hash.
export const AUDIT_RULES: RuleDefinition[] = Object.freeze(
  seeds.map(makeRule).map(deepFreeze),
) as unknown as RuleDefinition[];

export const getRule = (ruleId: string): RuleDefinition | undefined =>
  AUDIT_RULES.find((rule) => rule.id === ruleId);

const mutableRulesByCategory = AUDIT_RULES.reduce<
  Record<RuleCategory, RuleDefinition[]>
>(
  (groups, rule) => {
    groups[rule.category].push(rule);
    return groups;
  },
  {
    availability: [],
    crawlability: [],
    performance: [],
    mobile: [],
    accessibility: [],
    'onpage-seo': [],
    'local-seo': [],
    conversion: [],
    'content-trust': [],
    'forms-commerce': [],
    'privacy-security': [],
    operations: [],
  },
);

for (const rules of Object.values(mutableRulesByCategory)) Object.freeze(rules);

export const rulesByCategory = Object.freeze(mutableRulesByCategory);
