# DivineList – lokal tillväxt-, evidens- och köplan

Datum: 2026-08-31  
Status: teknisk kedja `PASS`; datagrind, annonsering och cutover `FAIL / NO-GO`

## Mandattillägg 2026-09-04 – ersätter rutinfrågorna

Rapportens ursprungliga körresultat och beslut behålls som historik. Användaren
har därefter gett agenten mandat att själv göra offentlig källresearch,
källjämförelse, lokal identitetsbedömning, prioritering och staging-/provimport-
förberedelse. Krav nedan på separat mänskligt ja för dessa rutinmoment är
ersatta av [AGENTS.md](../AGENTS.md) och
[lokal autonomi](../docs/LOCAL_AUTONOMY.md).

Agenten får parkera osäker identitet, utesluta fel segment och fortsätta med
andra kandidater inom den befintliga femsegmentplanen. Oklara fakta skickas
inte tillbaka som ett nytt användarbeslut när de kan undersökas eller parkeras.
Verkliga undantag redovisas samlat; ändrad målgrupp eller ny befogenhet kräver
fortfarande användarbeslut.

Den nya förberedelsekedjan är separat från den historiska runtimekedjan:

```text
V1-seed + hashbundna agentobservationer
           │
           ▼
plan:local-work
           ├── agent_ready_for_dry_run
           ├── agent_research
           ├── agent_deferred
           └── agent_excluded
```

Detta är första implementerade planeringssteget, inte en full autonom
exekverare. Kommandot gör inga nätverks-/DB-anrop, ingen riktig provimport och
inga runtimebeslut. Det lämnar normalt stdout; valfri export skapar endast en
ny katalog under `reports/autonomy/`. Befintlig V1-preflight och runtimegrind
är oförändrade. Inga totalsiffror blir högre bara för att agentens lokala
förberedelse har gått vidare.

## Resultatet i korthet

DivineList och Företagskarta-motorn fungerar som en lokal, reproducerbar och
fail-closed kedja. Systemet kan exportera företag, köra exakt 120 regler per
företag, importera ett förseglat resultat, bygga en lokal granskningskö, projicera
till staging och verifiera backup/restore.

Det som ännu inte fungerar är själva bevisnivån i företagsunderlaget. Den senaste
exakta körningen har:

| Mått | Verifierat värde |
| --- | ---: |
| Företag i inventariet | 25 |
| Företag i exakt V2.3-export | 8 |
| Exkluderade företag | 17 |
| Regelresultat | 960 |
| Avgörande resultat | 0 |
| `needs_review` | 49 |
| `not_tested` | 911 |
| `partial` | 880 |
| `blocked` | 80 |
| Öppna karantänposter | 30 |
| Aktiva regler | 0 |
| Annonseringskandidater | 0 |

Den korrekta slutsatsen är därför:

```text
Tekniken kan mata algoritmerna.
Datat kan ännu inte mata fram säkra säljpåståenden.
```

## Vad som förbättrades i denna arbetsomgång

### 1. Exakt evidenspilot på tre företag

En avgränsad pilot kördes med den säkra collectorn. Ingen CAPTCHA, access
challenge eller osäker redirect kringgicks.

| Företag | Utfall | Betydelse |
| --- | --- | --- |
| Lilys Florabar | `BLOCKED` – `access_challenge_detected` | Manuell kontroll krävs; spärren är inte ett webbplatsfel. |
| OMNIA Hälsoklubb | `BLOCKED` – `redirect_target_requires_identity_review` | Redirectmålets företagsidentitet måste granskas. |
| Vallgatans Skomakeri | `NEEDS_MANUAL_REVIEW` | Fyra nya fakta och fyra evidensposter skapades. |

Vallgatans gav den enda aktuella reviewposten med accepterad evidens:

- regel: `MOB-001`;
- confidence: `0.94`;
- accepterad evidens: 1;
- avvisad evidens: 0;
- status: fortfarande `needs_review / partial`;
- körläge: `human_required`;
- rendering: `degraded`;
- regellivscykel: `shadow`;
- rå bevarad HTML-artefakt: saknas.

Den ska prioriteras i mänsklig granskning, men får inte automatiskt bekräftas och
får inte bli en annonseringssignal.

### 2. Ny exakt V2.3-trustkedja

| Bindning | Värde |
| --- | --- |
| Export | `EXP:ff60477b74e6d5c8aa2b7cd907f384d7` |
| Batch | `BAT:ff60477b74e6d5c8aa2b7cd907f384d7:0000` |
| Audit | `AUD:a76ae0ce4a3d0e064c84a3b88349f38e` |
| Import | `IMP:d6830d299fd8e4e8ad650d8d0a5b18f5` |
| Dataset-hash | `sha256:8ee1ba9ff1edb6095f74b1dbb7c103398f8720378e2f48cfd61d6f8b8bb4585d` |
| Batch-hash | `sha256:c124830e72753eda95fefa30d68d142378b87f13b3c0a0e8402a7e9d03047232` |
| Resultat-hash | `sha256:df7784dabb0b006eebf50812819939edcf491f44620ca9d47a32106554af01fe` |

En upprepad import gav `already_imported` och `already_archived`. Det bekräftar
idempotens: samma resultat skapar inte dubbla aktuella rader.

### 3. Reproducerbar lokal kögenerator

`scripts/export-local-queues.mjs` skapar två strikt separata köer:

```text
Exakt V2.3-batch + förseglat resultat + motorns aktuella review-kö
                              │
                              ▼
                  verifiera trustkedjan
                              │
               ┌──────────────┴──────────────┐
               ▼                             ▼
      lokal mänsklig review-kö       lokal annonseringskö
             49 poster                     0 poster
                                            BLOCKED
```

Generatorn:

- binder varje post till audit, export, batch, dataset, regelversion,
  regelinnehållshash och inputhash;
- grupperar reviewposter per företag;
- skiljer accepterad och avvisad evidens;
- skapar inga reviewbeslut;
- ändrar inte SQLite;
- kontaktar ingen;
- skapar ingen kontakt- eller annonseringsbehörighet;
- lämnar annonseringskön tom när kraven inte är uppfyllda.

Det exakta lokala paketet finns i:

`reports/local-queues/2026-08-31-v23-pilot/`

### 4. Första nya företagsvågen hämtad till lokal staging

Tre nya företag hämtades från aktuella publika förstapartssidor och sparades i:

`C:\Users\cozys\AppData\Local\WebDesignPartner\Foretagskarta\source-staging\2026-08-31\company-seeds-001.json`

| Kandidat | Segment | Publik arbetsplatsadress | Förstapartssida |
| --- | --- | --- | --- |
| Caféva — Haga | Restaurang/café | Haga Nygata 5E, 413 01 Göteborg | <https://www.cafeva.se/> |
| Aktiv Hälsa Göteborg | Hälsa/friskvård | Otterhällegatan 2, 411 18 Göteborg | <https://aktivhalsagbg.com/> |
| Göteborgs Glasmästeri | Hantverk/hemservice | Ovädersgatan 1A, 418 34 Göteborg | <https://www.goteborgsglasmasteri.se/kontakta/> |

Validering av stagingfilen:

| Kontroll | Resultat |
| --- | --- |
| JSON kan parsas | `PASS` |
| Deklarerat/faktiskt antal | `3 / 3` |
| Unika kandidat-ID:n | `3 / 3` |
| Exakt företagsnamnskollision mot 25 | `0` |
| Exakt primärdomänkollision mot 25 | `0` |
| Person-/kontaktfält | `0` |
| Databasimport | `false` |
| Mänskligt beslut krävs | `true` |
| Motorns befintliga JSON-parser läser poster | `3 / 3` |
| Okända fält inne i importposterna | `0` |
| Segment matchar befintlig svensk femsegmentmodell | `3 / 3` |
| Explicit identitetsstatus efter kanonisering | `unresolved / unresolved / manual review` för alla 3 |
| Domänstatus/confidence | `unresolved / 0.0` för alla 3 |
| Fil-SHA-256 | `sha256:6f6987e02c37437b67385bba4c61faa50447f61db9dbe1bc00aa4b0d2f289f14` |

De är **hämtade kandidater**, inte nya godkända inventarieposter. Filens `records`
är nu kompatibla med motorns befintliga råparser, men `import` saknar `--dry-run`
och är muterande även utan köflagga. Ingen import kördes. Alla tre poster tvingas
därför uttryckligen till `gothenburg_status=unresolved`,
`verification_status=unresolved`, `needs_manual_review=true`,
`domain_status=unresolved` och `domain_confidence=0.0`. De saknar ännu stabila
arbetsplats-ID:n och verifierad juridisk koppling, räknas inte i `inventory_total`
och får inte exporteras som algoritmklara.

Den nya skrivskyddade valideraren kan köras utan databas eller nätverk:

```powershell
node scripts/preflight-company-seeds.mjs `
  "C:\Users\cozys\AppData\Local\WebDesignPartner\Foretagskarta\source-staging\2026-08-31\company-seeds-001.json"
```

Den kontrollerar schemaetikett, högst tre poster, exakta recordfält, svenska
segment, unika käll-ID:n, HTTPS, källhostar och samtliga fail-closed statusvärden.
Den aktuella filen ger `PASS` med 0 fel och har uttryckligen inga databas-, kö-,
nätverks- eller outreachkapabiliteter.

### 5. Deterministisk stagingprojektion

Tre körningar gav exakt samma projektion:

- 237 filer på disk inklusive manifest;
- 236 manifestlistade genererade filer;
- 227 Markdown-filer;
- 9 Obsidian Bases;
- 25 arbetsställen;
- 8 faktasammanfattningar;
- 49 evidensposter;
- 8 täckningssammanfattningar;
- 49 regelresultat;
- 49 reviewposter;
- 30 karantänposter;
- 8 import-/exportöversikter;
- 0 konflikter;
- 1 018 073 byte;
- trädhash
  `sha256:22639bc792c5394a8e735ab7938cad08f4ec26ff8754fb50c18085829fea479a`;
- manifestfilens råa SHA-256
  `sha256:9625fcc2d1daecaea481d417403ef9ea9f8f2b209ff0f319920ba81e769c6a36`.

Aktivt Obsidian-valv byttes inte ut.

### 6. Ny fysisk backup och verifierad restore

Efter evidenspiloten skapades en ny V4-backup på den separata fysiska `Z:`-disken:

`Z:\WebDesignPartner\Foretagskarta\backups\post-evidence-pilot-20260831-20260831T212652794223Z`

| Kontroll | Värde |
| --- | --- |
| Databas-SHA-256 | `sha256:5189f0fb452ec96e331f8c3080d84c226c6b0b136a89d838e35e0f593a10c59f` |
| Logiskt fingeravtryck | `sha256:e90676e94e98ef2606e53b412c66f977487bb04eb89e08b92d06daec7a60a27d` |
| Manifest-SHA-256 | `sha256:9fa0f58739aa45a9071aa4de894cc0012a7f815650d0b1cdec42e2c512b28329` |
| Artefakter | 266 |
| Tabeller | 46 |
| Rader | 8 964 |
| SQLite-integritet | `ok` |
| Foreign-key-fel | 0 |
| Samma volym som källan | `false` |
| Restore-test | `PASS` |

Restore-vittne:

`C:\Users\cozys\AppData\Local\WebDesignPartner\Foretagskarta\artifacts\restore-tests\restore-0f593a10c59f-20260831T212716140003Z`

### 7. Test- och byggkedjan förbättrad

Motorns stora fixturetest hade en fast 60-sekundersgräns som var för kort för full
fixturemängd på denna Windowsmiljö. Timeouten skalar nu med antalet fixtures utan
att ändra testets semantik.

Verifierat:

- motorns riktade fixturetest: `22/22 PASS`;
- hela motorns testsvit: `265/265 PASS`;
- DivineList: `84/84 PASS`;
- TypeScript: `PASS`;
- lint: `PASS`;
- format: `PASS`;
- produktionsbygge: `PASS`;
- 128 fakta och 120 regler med exakta hashankare: `PASS`;
- isolerat HTTP-/säkerhetssmoketest: `PASS`.

## Den lokala granskningskön

### Prioritetsbild

| Prioritet | Antal |
| --- | ---: |
| Critical | 16 |
| High | 22 |
| Medium | 8 |
| Low | 3 |

| Evidensläge | Antal |
| --- | ---: |
| Minst en accepterad evidens | 1 |
| Ingen accepterad evidens | 48 |
| Giltigt mänskligt slutbeslut | 0 |

| Företag | Reviewposter |
| --- | ---: |
| Frisörcenter Hår och Skönhet | 9 |
| Buffalo Barbershop | 7 |
| Göteborgs Massage & Rehab – Almedal | 7 |
| Göteborgs Naprapat & Idrottsskadeklinik | 6 |
| Restaurang Solrosen | 6 |
| The Performance Club | 5 |
| Vallgatans Skomakeri | 5 |
| Boutique Laila Second Hand | 4 |

### Rekommenderad reviewordning

1. Vallgatans `MOB-001` först, eftersom den ensam har accepterad evidens.
2. Verifiera manuellt rå HTML och verklig mobilrendering. Om råartefakt saknas,
   samla en ny tillåten hashad artefakt i stället för att lita på sammanfattningen.
3. Ta därefter poster per företag och gemensam rotorsak, inte 49 lösa varningar.
4. Poster utan accepterad evidens ska i första hand få bättre insamling eller
   avföras som otillräckligt testade; de ska inte bekräftas genom sannolikhet.
5. Registrera endast ett append-only mänskligt beslut med exakt reviewer-ID,
   rationale och aktuell trustkedja.

### Karantänen

De 30 öppna legacyraderna är separat arbete:

- 25 har en exakt nuvarande faktamappning och kan få en lokal mappningsrapport;
- 2 använder gamla `viewport_missing` och behöver ett explicit versionsbundet
  alias eller manuellt beslut;
- 2 är `axe:meta-viewport` och får inte förenklas till att viewport-taggen saknas;
- 1 är `axe:definition-list` och saknar exakt V2.1-fakta.

Ingen av de 30 får lösas automatiskt. Kod kan förbereda underlaget; en namngiven
människa måste fatta dispositionen.

## Den lokala annonseringskön

Annonseringskön är medvetet tom och har status `blocked_not_ready`.

För att en post ens ska få föreslås för en framtida annonseringskö krävs alla
följande grindar:

1. Resultatet är `detected` eller annat uttryckligen tillåtet avgörande utfall.
2. Regeln är publikt aktiv i exakt godkänd policyversion.
3. Evidensen är accepterad, färsk, direkt och bunden till bevarad artefakt när
   regeln kräver det.
4. Identiteten och webbplatsrelationen är verifierade.
5. En människa har granskat och bekräftat resultatet.
6. Företaget är inte i suppression, DNC, identitetshold eller karantän.
7. Användaren har därefter uttryckligen godkänt annonsering som en separat åtgärd.

Nuvarande data faller redan på punkt 1, 2 och 5:

- 0 avgörande resultat;
- 0 aktiva regler;
- 49 väntande reviewposter;
- 0 mänskligt bekräftade aktuella resultat;
- inget kontakt- eller annonseringsgodkännande.

Det går alltså inte att “fixa” kön genom att sänka kraven. Det skulle skapa
osäkra negativa påståenden om verkliga företag.

## Varför 25 företag inte betyder 25 algoritmklara företag

De 25 befintliga är fördelade så här:

```text
inventory_total = 25
│
├── algorithm_ready / V2.3-exporterade = 8
└── exkluderade = 17
    ├── Göteborgsidentitet ej verifierad = 8
    ├── aktuell identitet ej verifierad = 7
    └── snapshot blockerad = 2
```

Målet “50 företag” måste därför delas i två mått:

```text
Mål A: inventory_total 25 → 50
       kräver 25 nya godkända identiteter

Mål B: algorithm_ready_total 8 → 50
       kräver 42 ytterligare exportbara företag
       = nya godkända företag + reparerade befintliga företag
```

Om alla 25 nya kandidater blir algoritmklara men inget av de befintliga 17
repareras blir slutläget bara:

```text
inventory_total       = 50
algorithm_ready_total = 33
```

UI och rapporter ska därför alltid visa minst:

- `inventory_total`;
- `verified_identity_total`;
- `scan_eligible_total`;
- `v23_exported_total`;
- `evaluated_total`;
- `human_reviewed_total`;
- `blocked_total`;
- `quarantined_total`.

## Detaljerad 25 → 50-plan

### Segmentmål

Nuvarande inventarium har fem företag i vart och ett av fem segment. Slutmålet bör
vara tio per segment, om inte en människa dokumenterar ett bättre skäl till en
annan fördelning.

| Segment | Nuläge | Slutmål | Behövs |
| --- | ---: | ---: | ---: |
| Frisör/skönhet | 5 | 10 | 5 |
| Restaurang/café | 5 | 10 | 5 |
| Hälsa/friskvård | 5 | 10 | 5 |
| Hantverk/hemservice | 5 | 10 | 5 |
| Specialbutik/annan lokal tjänst | 5 | 10 | 5 |
| **Totalt** | **25** | **50** | **25** |

### Makrovågor och små operativa paket

Planen använder fem makrovågor. Varje makrovåg ska, när den stängs, ha godkänt
ett företag per segment. Själva hämtningen och kontrollen görs i små paket om
högst tre kandidater så att kvalitet och dedupe kan granskas mellan paketen.

| Makrovåg | Total efter godkännande | Målsammansättning |
| --- | ---: | --- |
| Baslinje | 25 | 5 per segment |
| Vågrörelse 1 | 30 | 6 per segment |
| Vågrörelse 2 | 35 | 7 per segment |
| Vågrörelse 3 | 40 | 8 per segment |
| Vågrörelse 4 | 45 | 9 per segment |
| Vågrörelse 5 | 50 | 10 per segment |

Första operativa paketet är nu hämtat:

```text
packet-001
├── restaurang/café: Caféva
├── hälsa/friskvård: Aktiv Hälsa Göteborg
└── hantverk/hemservice: Göteborgs Glasmästeri
```

För att stänga makrovåg 1 återstår ett kvalitetssäkrat företag inom
frisör/skönhet och ett inom specialbutik/annan lokal tjänst. De får inte ersättas
med fler caféer bara för att nå fem.

### Kandidatens tillståndsmaskin

Historisk runtime-/acceptansmodell från 2026-08-31. Det nya mandatet ovan
ersätter mänskliga rutinbekräftelser i lokal förberedelse, inte verkliga
`HUMAN_REVIEW_PENDING`-beslut, runtimefält eller annonseringsgrindar. Använd
den separata agentkedjan för lokal beredning; behandla inte dess statusar som
att någon runtimeövergång nedan redan har skett.

```text
DISCOVERED_LOCAL
        │ automatisk JSON- och dataminimeringskontroll
        ▼
SCHEMA_VALID
        │ exakt dedupe + fuzzy hold-screening
        ▼
DEDUP_SCREENED
        │ mänsklig identitetsgranskning
        ▼
IDENTITY_APPROVED
        │ separat evidenstillstånd
        ▼
EVIDENCE_AUTHORIZED
        │ säker collector
        ▼
EVIDENCE_COLLECTED
        │ lokal preflight
        ▼
IMPORT_PREFLIGHT_PASS
        │ isolerad import
        ▼
SCAN_ELIGIBLE
        │ algoritmkörning
        ▼
EXPORTED_V23 → EVALUATED → HUMAN_REVIEW_PENDING
                               │
                               ├── REVIEWED_ACCEPTED
                               ├── REVIEWED_HOLD
                               └── QUARANTINED
```

Sidoutgångar får aldrig fortsätta automatiskt:

```text
HARD_DUPLICATE
POSSIBLE_DUPLICATE_HOLD
IDENTITY_UNRESOLVED
BLOCKED_SAFETY
DO_NOT_CONTACT
SUPPRESSED
OUT_OF_SCOPE
REJECTED
```

### Acceptanskriterier för inventariet

En kandidat får räknas i `inventory_total` först när:

- företag/arbetsställe är unikt;
- publik verksamhetsadress är verifierad;
- Göteborgs kommun är verifierad;
- aktuell verksamhetsstatus är verifierad;
- ett stabilt käll- eller arbetsplats-ID finns;
- webbplatsrelationen är dokumenterad, även om webbplatsen senare är blockerad;
- inga personliga kontaktfält eller privata adresser lagras;
- kandidatens källor och observationstid finns;
- ingen möjlig dubblett, suppression eller DNC är öppen;
- runtimeidentiteten har passerat sin oförändrade acceptansgrind. Det tidigare
  kravet på en människa för själva lokala förberedelsebedömningen är ersatt;
  en agentbedömning räknar dock inte upp inventariet och är ingen import.

En kandidat får dessutom räknas i `algorithm_ready_total` när:

- `gothenburg_status=verified`;
- `verification_status=verified_current`;
- `needs_manual_review=false` för identiteten;
- primär webbplatsrelation är `verified_primary` eller tillåten
  `shared_corporate`;
- relationens confidence uppfyller motorns miniminivå;
- snapshot och evidens kan samlas utan säkerhetsöverträdelse;
- importpreflight passerar;
- den officiella V2.3-exportens manifest faktiskt innehåller företaget;
- batch- och resultathashar verifieras.

### Exakt dedupeordning

1. Stabilt workplace-/CFAR-ID: hård dubblett.
2. Säkert juridiskt företags-ID, endast om det inte innebär personuppgiftsrisk.
3. Verifierad självständig förstapartsdomän: stark signal, men inte ensam
   tillräcklig för att slå ihop filialer.
4. Delad företagsdomän plus exakt filialrelation.
5. Exakt plattforms-/profilsida inom källans namespace.
6. Normaliserat namn + publik gatuadress + kommun 1480: möjlig dubblett,
   lokal agentägd hold/fördjupad research; ingen automatisk sammanslagning.
7. Källans record-ID, endast unikt inom källnamespace.

Automatik får normalisera Unicode, blanksteg, adressformat, schema, `www` och
trailing slash. Automatik får inte slå ihop fuzzy namn, anta filialrelation eller
skriva över en existerande identitet.

### Dataminimering

Tillåt endast:

- lokalt kandidat-ID;
- publikt företags-/arbetsplatsnamn;
- publik verksamhetsadress och postort;
- kommun- och segmentkandidat;
- möjlig primär företagswebbplats;
- relationstillstånd och confidence;
- käll-URL, källtyp och observationstid;
- maskinläsbar state och hold reasons;
- senare: evidens-ID och artifact-hash.

Lagra inte i kandidatvågen:

- personnamn eller roller;
- personnummer eller personliga organisationsnummer;
- privata adresser;
- telefonnummer eller e-postadresser;
- kontaktpersoner;
- outreachhistorik;
- annons- eller säljtext;
- kund- eller hälsodata;
- cookies, sessioner eller autentiseringstokens;
- full rå sidtext när ett minimalt faktapåstående och hash räcker.

### Preflight per operativt paket

Varje fil måste passera:

1. JSON-parse.
2. Exakt schema- och versionskontroll.
3. Högst tre kandidater.
4. Unika kandidat-ID:n.
5. Förbjudna person-/kontaktfält saknas.
6. URL-schema är `https` eller uttryckligen holdat.
7. Observationstid har tidszon.
8. Exakt dedupe mot befintliga 25, tidigare paket, hold, suppression, DNC och
   karantän.
9. Fuzzy namn-/adresskollisioner blir hold, inte auto-merge.
10. Segmentfördelningen stämmer mot makrovågens luckor.
11. Agentägd lokal identitetsbedömning dokumenteras separat; runtimegrinden
    måste fortfarande passera före verklig behörighet eller importacceptans.
12. En isolerad dry-run visar exakt avsedd importdiff.

### Säker evidensinsamling

För runtimebaserad evidensinsamling gäller fortsatt dess avgränsade tillstånd
och grindar. Offentlig källresearch i den lokala förberedelsen ingår redan i
mandatet från 2026-09-04. Säkerhetskraven består:

- anonym `GET`/`HEAD`;
- robots respekteras;
- exakt verifierad host och högst en säker `www`-variant;
- högst fem redirects;
- inga privata/interna IP-adresser eller okända redirectmål;
- CAPTCHA, `401`, `403`, timeout, rate limit och access challenge blir
  `blocked/manual review`;
- inga spärrar kringgås;
- varje fakta binds till konkret evidens-ID;
- AI-text räknas aldrig som evidens;
- saknad evidens blir `not_tested`, inte ett negativt fynd.

### Stoppvillkor

Stoppa kandidaten om:

- identitet, aktuell status, Göteborgstillhörighet eller adress är oklar;
- webbplatsrelationen inte kan verifieras;
- möjlig dubblett är olöst;
- personlig identifierare behövs;
- DNC eller suppression träffar;
- enda källan kräver inloggning, CAPTCHA eller kringgående;
- redirect lämnar verifierad identitet;
- snapshot blir blockerat.

Stoppa hela paketet om:

- JSON/schema/hash inte stämmer;
- ett förbjudet fält finns;
- ett befintligt företag skrivs över;
- fler poster importeras än godkänt;
- samma nya tekniska fel träffar minst två kandidater;
- en ny produktionsgrind går från `PASS` till `FAIL`;
- gruppen fyller kvot i stället för att följa segment- och kvalitetskrav.

Stoppa nästa makrovåg om:

- föregående vågs nya reviewposter inte är triagerade;
- en ny kritisk karantänpost är öppen;
- samtliga nya företag endast ger blockerade eller helt `not_tested` resultat;
- ingen ny användbar evidens når någon relevant regel;
- algoritmen börjar skapa negativa slutsatser från saknad evidens.

## Vad som kan fixas lokalt nu

| Del | Kan automatiseras? | Nästa konkreta arbete |
| --- | --- | --- |
| Kandidatfilernas schema | Ja | Skrivskyddad versionsgrind är byggd i `scripts/preflight-company-seeds.mjs`; nästa steg är ett officiellt motor-CLI-kontrakt. |
| Dataminimering | Ja | Blockera e-post, telefon, person-ID, privata adresser och fri outreachtext. |
| Exakt dedupe | Ja | Jämför source/workplace-ID, domän och exakt filial-URL. |
| Fuzzy screening | Delvis | Agenten undersöker eller parkerar i lokal hold; ingen automatisk sammanslagning eller runtimeändring. |
| Segmentbalans | Ja | Visa luckor per makrovåg och stoppa kvotfyllning. |
| Importpreflight | Ja | Kör mot isolerad databaskopia och visa exakt diff. |
| Reviewpaket | Ja | Redan byggt; utöka med separat karantänsnapshot. |
| Vallgatans råartefakt | Delvis | Samla ny tillåten hashad HTML/rendering; människa verifierar. |
| Legacykarantänmappning | Delvis | Generera rapport för 25 exakta, 2 alias och 3 kontraktsgap. |
| Produktionsstatus | Ja | Regenerera efter varje godkänd generation. |
| Backup/restore | Ja | Färskt, hashbundet vittne är `PASS`; kör om efter varje materiell state-ändring. |

## Vad som inte kan eller får fixas automatiskt

- Lilys access challenge får inte kringgås.
- OMNIAs redirectidentitet får inte gissas.
- Bar Centros adresskonflikt får inte auto-resolvas.
- Två historiska saknade resultatfiler kan inte återskapas från nuvarande data.
- 49 reviewbeslut kräver människa.
- 30 karantändispositioner kräver människa.
- Regler kan inte aktiveras utan ny versionsstyrd policy och mänskligt
  godkännande.
- Kontakt, annonsering, publicering, deploy och aktiv-vault-cutover är separata
  beslut och ingår inte i algoritmkörningen.

## Rekommenderad genomförandeordning

### Omedelbar ordning

1. Låt nuvarande exakta export, resultat, staging och backup vara fryst baslinje.
2. Mänskligt granska Vallgatans `MOB-001` som första post.
3. Gör agentägd lokal identitetsbedömning för de tre stagingkandidaterna enligt
   mandatet från 2026-09-04. Parkera osäkra poster och gå vidare utan nytt rutin-ja.
4. Kör den byggda seedvalideraren; bygg därefter en separat DB-baserad
   dedupe-/importplan med riktig `--dry-run` innan någon liveimport tillåts.
5. Hämta de två saknade segmenten för att kunna stänga makrovåg 1.
6. Importera endast kandidater som passerat identitetsgrinden, först i isolerad
   databaskopia.
7. Samla evidens i högst tre företag åt gången.
8. Kör officiell export, DivineList-utvärdering och resultatimport.
9. Regenerera lokal reviewkö, staging, produktionsstatus och fysisk backup.
10. Stäng vågen med mänskligt `GO`, `HOLD` eller `STOP`.

### Acceptans för makrovåg 1

- fem nya godkända identiteter, en per segment, eller en uttryckligt dokumenterad
  delvåg med färre;
- inga olösta dubbletter;
- inga person-/kontaktfält;
- fem spårbara identitetsunderlag och faktisk runtimeacceptans; separat
  mänskligt ja för lokal identitetsförberedelse krävs inte längre;
- exakt importdiff;
- giltig V2.3-export;
- inga nya baslinjeregressioner;
- alla nya reviewposter triagerade;
- noll automatisk kontakt eller annonsering.

### Acceptans vid inventory 50

- exakt 50 unika företags-/arbetsplatsidentiteter;
- 10/10/10/10/10 segment, eller dokumenterad mänskligt godkänd avvikelse;
- källproveniens och observationstid för alla;
- inga olösta dubbletter räknas;
- holdade och avvisade kandidater blåser inte upp totalsiffran;
- inga personliga kontaktuppgifter i inventariet.

`algorithm_ready_total=50` är ett separat mål. Det är endast uppnått när det
officiella exportmanifestet faktiskt innehåller 50 behöriga företag.

## Slutlig aktuell produktionsgrind

Den persistenta maskinfilen kontrollerades `2026-08-31T21:32:08Z`:

| Aktuell status | Antal |
| --- | ---: |
| PASS | 18 |
| FAIL | 2 |
| WARN | 3 |

Efter att den parallella lokala körningen hade avslutats reproducerade en ny,
helt skrivskyddad kontroll exakt samma 18/2/3. `backup_restore=PASS`,
`freshForCurrentDatabase=true` och `witnessValid=true`; aktuellt och vittnets
generationsfingerprint är båda
`sha256:35c9c0353361af95bc02f7e731a5b7daa13771e2c20eeb660f086e2d032f76cc`.

Aktuella hårda fel:

1. `newer_protocol_invalid_audits_suppressed` – Lilys och OMNIA är fortfarande
   undertryckta av nyare protokollogiltig legacy-audit.
2. `audit_results_usable` – 0 avgörande, 49 review och 911 not tested.

Varningar:

1. två historiska resultatreferenser saknar återverifierbara originalbytes;
2. 30 karantänposter är öppna;
3. 0 regler har användbart kalibreringsunderlag.

Maskinens beslut är korrekt:

```text
status              = FAIL
productionCandidate = false
cutoverReady         = false
advertisingQueue     = 0
```

Det är inte ett misslyckande i säkerhetsdesignen. Det är systemet som korrekt
vägrar låtsas att ofullständigt data är ett säkert företagsfynd.
