# DivineList – evidensverkstaden V2.3

DivineLists klassiska evidensverkstad är en lokal arbetsyta för att granska **redan insamlade** observationer om företagswebbplatser. Den innehåller exakt 128 versionsstyrda fakta och 120 deterministiska regeldefinitioner i 12 områden. Indata valideras genom en strikt identitets-, evidens-, renderings- och sidtäckningsgrind innan något resultat visas.

Den klassiska granskningsappen öppnar, skannar eller förhandsladdar aldrig en företagsdomän. Den kontaktar ingen, publicerar inget och kan inte godkänna kontakt eller aktivera en regel automatiskt. Den separata **Skeppet-stationen** nedan kan på ditt startkommando samla offentliga kandidater och skapa lokala AI-utkast; dessa är inte V2.3-evidens eller godkända granskningsresultat.

## Skeppet – lokal agentstation

Skeppet är den nya, spelinspirerade kontrollpanelen med fem agentroller och dig
som kapten. Roller och transportband visar den verkliga arbetskön. En lokal
Ollama-modell arbetar med ett uppdrag åt gången.

**Windows:** packa upp det portabla paketet och dubbelklicka på
**DivineList.exe**. Det innehåller sin egen körmotor. Se
[startguiden för Windows](docs/PORTABLE.md).

Från projektmappen:

```powershell
.\run-station.ps1
```

Öppna **http://127.0.0.1:8790/**. Wrappern kan starta den förberedda portabla
Ollama-motorn på datorn. Alternativt kör `npm run station` med Ollama redan
startad. Välj en installerad modell, exempelvis stationens standard
`qwen3:4b`, och ett mål mellan 1 och 500 företag.
Första provurvalet är förinställt till 10.

- **Starta Göteborgsresearch** hämtar OpenStreetMap-kandidater, ordnar
  domäner och köar webbplatsanalys. Kartposter behöver fortfarande
  geografisk kontroll och granskning av företagets identitet och domänrelation.
  Om företagsmålet redan är uppnått och alla kandidater är behandlade
  startas inget tomt arbetspass; höj målet för att hämta fler.
- **Automatisk agentkedja** kan slås på eller av från Kaptenens panel. När den
  är på arbetar Spanaren → Kartografen → Analytikern → Granskaren → Skrivaren
  vidare i turordning. När den stängs av sparas det pågående säkra delsteget
  och nästa automatiska överlämning väntar. Inställningen sparas vid omstart.
- **Lägg i kön** sparar en skriven order till en roll. **Kör kön/Fortsätt**
  behandlar befintliga uppdrag. Fria order ger råd och kör ingen kod.
- **Maskinrum → Obsidian** väljer valv och arbetsmapp. Startade uppdrag
  skriver automatiskt läsbara verifieringskort, en enkel verifieringsguide,
  en klickbar Canvas och bevarade maskinrapporter som återläses. Canvasen visar
  inte säkerhetskopior. Den läsbara mappen **Agenterna** beskriver varje roll,
  dess överlämning och begränsningar. **Skriv listan nu** skriver befintligt
  underlag. Egna anteckningar och tidigare rapportversioner bevaras.
- **Importera** läser utvalda Markdown-/JSON-filer. **Markdown/JSON** ger
  dessutom en fristående nedladdning av underlaget.

Stationen hämtar högst en HTML-sida per analyserad domän. Analys och
eftergranskning använder samma lokala modell; de ersätter inte oberoende eller
mänsklig verifiering. Körningar pausas senast efter åtta timmar och sparade
körningar återstartas aldrig automatiskt. Målet 500 är ingen utfästelse om
500 företag per dag. Röststyrning är ännu inte installerad.

Se [Skeppets användning, arkitektur och begränsningar](docs/STATION.md).
Rollernas kontrakt finns i [arbetsreglerna](docs/AGENT_ROLES.md), och
[etappplanen](docs/STATION_V2_PLAN.md) beskriver leveransens kontrollpunkter.
Den klassiska evidensverkstaden finns fortsatt på port 8787; dess kontrakt,
runtimegrindar och mänskliga granskningsbeslut är oförändrade.

## Agentägt lokalt arbete från 2026-09-04

Användarens utökade mandat låter agenten själv sköta offentlig företagsresearch,
källjämförelse, lokal identitetsbedömning och staging-/provimportförberedelse utan
ett nytt ja per kandidat. Osäkra eller felriktade kandidater parkeras/utesluts
lokalt och agenten fortsätter inom uppdraget. Detta ersätter äldre rutinspärrar,
inte runtimegrindar, mänskliga auditreviews eller kontakt-/cutovergränser.
Se [projektreglerna](AGENTS.md) och [lokal autonomi](docs/LOCAL_AUTONOMY.md).

## Snabbstart

Krav: Node.js 22.13 eller senare.

Kontrollerad projektplats den 5 september 2026:
`C:\Users\cozys\Documents\ChatGPT\DivineList`. Den äldre OneDrive-mappen
innehåller kvarvarande historiska rapporter men saknar appens startfiler.
Kör kommandona från den lokala projektplatsen:

```powershell
Set-Location -LiteralPath 'C:\Users\cozys\Documents\ChatGPT\DivineList'
```

För en reproducerbar första installation och lokal produktionsstart:

```powershell
npm ci
npm run check
.\run-divinelist.ps1
```

Öppna `http://127.0.0.1:8787/`. Appen startar i **Arbetsyta**, där du öppnar
ett separat skrivskyddat företagsinventarium. Helt syntetisk demodata på
`.example`-domäner finns separat under Granskningskö tills du laddar en verklig
analysbatch eller granskningssession. Demo räknas aldrig som inventarieanalys.
Se [arbetsflödet och begränsningarna](docs/WORKBENCH.md).
För utveckling används i stället
`npm run dev`; utvecklingsservern är inte releasebeviset.

### Lokala rättningar 2026-09-05

- Ny datasetimport återställer sök-, områdes- och resultatfilter så att äldre
  filter inte döljer det nya underlaget. Återställning av en granskningssession
  visar även datasetets konkreta valideringsfel, i stället för ett UTF-8-fel.
- Inventarieimport kräver att insamlingsstatus är en giltig sträng; en array
  som innehåller samma text accepteras inte längre.
- JSON-import stoppar numerisk overflow före hashning. Exempelvis `1e400`
  får inte tolkas som oändlighet och sedan få samma kontrollsumma som `null`.
- De redan låsta beroendena återinstallerades efter att installationsfiler
  saknades. Inga paketversioner ändrades.

Rapporten från 4 september kl. 16:47 svensk tid har återvaliderats med
readiness-kommandot den 5 september. Fullrapportens integritet är verifierad,
men rapporten är äldre än 24 timmar och är därför historik. Den innehåller
19 PASS, 2 FAIL och 2 WARN; detta är ingen ny kontroll av aktuell runtime.
Kodrättningarna ersätter inte saknad evidens eller mänskliga granskningsbeslut.

Kontroller:

```powershell
npm run check
npm run export:contracts -- <målkatalog>
npm run evaluate:batch -- <batch.json> <resultat.json> <ISO-tid>
npm run export:local-queues -- <motorkatalog> <batch.json> <resultat.json> <målkatalog> [--review-queue-limit <antal>]
npm run preflight:company-seeds -- <company-seeds.json>
npm run plan:local-work -- <seed.json> --at <ISO> [--observations <file>] [--output <nytt-körnamn>]
npm run dry-run:company-seeds -- <seed.json> --observations <file> --at <ISO> --engine-root <motor> --source-db <SQLite> --python <python.exe> [--output <nytt-körnamn>]
npm run production:readiness -- <production-check-latest.json>
```

För en åtgärdslista som kan öppnas i Obsidian:

```powershell
node scripts/production-readiness.mjs <production-check-latest.json> --obsidian <ny-arbetslista.md>
```

Målkatalogen ska finnas och filnamnet ska vara nytt. Exporten skriver aldrig över
egna anteckningar. Listan visar samtliga kontroller, felens nästa steg, rapportens
ålder och exakta källhashar. Den är en arbetskopia av ett snapshot och uppdateras
inte automatiskt. En bock i listan registrerar inget granskningsbeslut.

Readiness-kommandot använder samma validerare som webbappen. Exitkod `0` kräver
en färsk rapport, verifierad fullrapport och inga fel eller varningar. `1` betyder
giltigt underlag som ännu inte är redo; `2` betyder fil-, validerings- eller
exportfel. JSON-utdata skiljer källans `status` från `readinessStatus` och
`effectiveCutoverReady`. Ett giltigt `PASS` med varningar ger alltså fortfarande
`BLOCKED`. Även `0` beskriver bara det valda snapshotet, inte ett tillstånd att
byta aktivt valv eller kontakta företag. Kör med `--help` för alla alternativ.

`npm run check` kör tester, TypeScript, lint, formatkontroll, produktionsbygge,
kontraktsexport och ett isolerat HTTP-smoketest av den byggda servern i samma
stoppande releasegrind. Smoketestet verifierar rot- och `HEAD`-svar, 404,
`robots.txt`, SVG-favicon, hashad JavaScriptcache, säkerhetsheaders, unik CSP-nonce
och obligatorisk UI-text. Det stänger av Wranglers användnings- och feltelemetri
och stänger servern efter kontrollen. Samma kommando används av den lokala
CI-definitionen när källan har fått en godkänd Git-baslinje.

`npm run build` återskapar automatiskt det autentiska femfils-paketet i
`dist/contracts-v23-final` efter att Vinext har rensat och byggt om `dist`.
Använd `npm run export:contracts -- <målkatalog>` när samma frysta kontrakt ska
skrivas till en annan lokal katalog.

`npm run start` använder `scripts/start-local.mjs` och binder som standard den
byggda appen explicit till `127.0.0.1`. Det undviker oavsiktlig exponering på
det lokala nätverket. `run-divinelist.ps1` tillåter inte annan bindning, så
`--ip` är låst till loopback i lokal startväg.

För normal lokal produktionsstart används helst den säkra Windows-wrappern:

```powershell
.\run-divinelist.ps1
.\run-divinelist.ps1 -Port 3006
```

Wrappern använder port 8787 som standard, kräver Node.js minst 22.13 och en
befintlig `node_modules`, bygger automatiskt `dist` om produktionsbygget saknas
och startar endast på loopback. `scripts/start-local.mjs` ger ett tydligt fel om
`dist` saknas, och produktionssmoketestet använder samma startväg. Wrappern har
verifierats på port 3006 med HTTP 200, renderad HTML, CSP och ren avstängning.

`npm run export:local-queues` läser den aktuella granskningskön från den lokala
Företagskarta-motorn och binder varje köpost till exakt V2.3-batch och förseglat
resultat. Kommandot skapar en detaljerad JSON-/Markdownkö för mänsklig granskning
och en separat fail-closed annonseringskö. Kögränsen anges med `--review-queue-limit`
eller miljövariabeln `DIVINELIST_REVIEW_QUEUE_LIMIT` (standard `5000`) och kan höjas
tillfälligt vid stora batchar. Exporten registrerar inga granskningsbeslut och
kontaktar ingen.

`npm run preflight:company-seeds` validerar ett lokalt kandidatpaket innan någon
databasimport får övervägas. Den tillåter högst tre företag, kräver kända fält,
unika käll-ID:n, Göteborgs kommun, HTTPS-källor och ett uttryckligt fail-closed
tillstånd (`unresolved`, manuell granskning och domänkonfidens 0). Kontrollen gör
inga databasläsningar, databasskrivningar, nätverksanrop eller kö-/kontaktåtgärder.
Motorns direkta import har ingen dry-run och körs därför inte av preflighten.

`npm run plan:local-work` är första steget i agentägd lokal arbetsplanering.
Det läser ett V1-seedpaket och valfria hashbundna agentobservationer, väljer
agentägda förberedelsestatusar och lämnar inga rutinfrågor. Standard är stdout;
`--output` får bara skapa en ny körkatalog i `reports/autonomy/`. Kommandot gör
inga nätverks-/DB-anrop och utför ingen faktisk provimport. Agentens
`agent_ready_for_dry_run` är inte runtimeacceptans, mänsklig review eller
annonseringsbehörighet. Fullständig exekvering är inte byggd genom denna planerare.

`npm run dry-run:company-seeds` är nästa separata steg: den granskade importören
provar högst tre agentklara originalposter på en minneskopia av en skrivskyddat
läst databas. Den kontrollerar skyddsspärrar, exakt tabellskillnad, upprepning
utan dubblettposter och oförändrad aktiv källa. Ingen runtimeimport, insamling,
kontakt eller annonsering sker. Se [gränser och testning](docs/LOCAL_AUTONOMY.md)
och [den genomförda Caféva-provimporten](reports/import-dry-run/2026-09-04-packet-001-verified/IMPORT_DRY_RUN.md).

## Exakta V2.3-kontrakt

| Del                    | Exakt version                         |
| ---------------------- | ------------------------------------- |
| Dataset                | `divinelist.dataset.v2`               |
| Faktaregister          | `divinelist.facts.v2.1.0`             |
| Regelregister          | `divinelist.rules.v1.2.0`             |
| Företagskarta-mappning | `foretagskarta-divinelist.v2.3.0`     |
| Dataset-hashpayload    | `divinelist.dataset-payload.v2.2.0`   |
| Batch-hashkuvert       | `divinelist.batch-envelope.v2.2.0`    |
| Resultat-hashkuvert    | `divinelist.result-envelope.v2.2.0`   |
| Utvärderingspolicy     | `divinelist.evaluation-policy.v2.2.0` |
| Resultatformat         | `divinelist.results.v2`               |
| Granskningsbeslut      | `divinelist.review-decision.v2.3.0`   |

De exakta V2.3-hashankarna är:

- `factHash`: `sha256:837feeb902c09495e4d97bdf3a3696bc3b5ab4f764090576dceadd0b34e0d643`
- `ruleHash`: `sha256:5269f4d86f079f1c338478441111a92cfd12719a486f68908db61e1ca65922ec`
- `evaluationPolicyHash`: `sha256:1aeaaa97cfe50a9ad5bcbfa10c4554be7cc5c44bb9add722cfe21cbd2c72d528`
- `datasetHashContractHash`: `sha256:94d963ff336609fae100362c583e46879c50cecf91c997eaaff41fedb36e69a9`
- `contractManifestHash`: `sha256:a87252f1e5f7b12cda35a271ce6147a342816ffa4e6aa4c820e34b3bbc9c0fa6`

Policyhashen är SHA-256 av kanonisk JSON över hela den exporterade policyn, inklusive policyversion men utan self-hash. Alla versioner och de fem hashankarna jämförs exakt; ett liknande eller godtyckligt nyare värde accepteras inte.

En produktionsbatch får innehålla högst **100 företag** och **4 500 000 UTF-8-byte**. Rekommenderad storlek är 50 företag. Större listor delas upp i flera deterministiska batcher.

## Vad som är byggt

- 120 versionsstyrda regeldefinitioner, exakt 10 inom varje område.
- 128 maskinläsbara fakta med typ, enhet, scope, tillåtna metoder och färskhet.
- Import av lokal JSON eller inklistrad JSON, högst 100 företag och 4,5 MB per V2-batch.
- Strikt kontroll av versioner, kontraktshashar, identiteter, domäner, fakta, evidensreferenser, evidensaktörer, collectors, scope, artifactsökvägar, UTF-8, JSON-djup, filstorlek och dubblett-ID.
- Fail-closed kontroll av `renderFidelity`, `pageCoverage` och lägsta tillåtna täckning.
- Förseglade resultat återberäknas från parserattesterad batch och verifieras mot exakt envelop, okända fält, alla kontraktsbindningar och `resultHash`.
- Saknad fakta blir `not_tested`; möjlig träff utan tillräckligt stöd blir `needs_review`.
- Gammal, felbunden, motstridig eller otillräcklig evidens får inte bli ett bekräftat fynd.
- Ett blockerande driftfel undertrycker följdfel i DOM, SEO, mobil och formulär.
- Rotorsaksgruppering hindrar korrelerade kontroller från att blåsa upp prioriteten.
- Sökning, områdesfilter, resultatfilter, exakt 20 regler per sida och en
  evidensnära detaljpanel med kontrollerad återgång av fokus.
- Separat visning av accepterad och avvisad evidens, identitet, täckning, rendering, tier och regellivscykel.
- Mänsklig klassificering med obligatorisk saklig motivering. Varje regel har ett
  eget bevarat utkast; inget utkast blir ett beslut förrän användaren sparar det.
- Portabel, SHA-256-bunden granskningssession som lokalt sparar dataset,
  utvärderingstid och exakta UI-beslut utan dold webbläsarlagring. Import av ett
  nytt dataset eller en annan session stoppas när öppna beslut eller utkast är
  osparade. Efter nedladdning räknas sessionen som sparad först när användaren
  uttryckligen bekräftar att filen finns på den egna datorn. Hashen upptäcker
  drift men är inte en digital signatur eller identitetskontroll.
- Strikt läsimport av den högst 256 000 byte stora,
  `foretagskarta.production-status.v1`-versionsbundna
  `production-check-latest.json`. Importen verifierar alla 23 V2.3-grindar,
  räknare och exakt PASS/FAIL-/kandidat-/cutover-semantik. Den separata
  `production-check-latest.full.json` får vara högst 16 000 000 byte i
  webbläsaren och måste matcha exakt filnamn, byteantal, SHA-256 och den
  tillåtna fullrapportstrukturen. Statusen blir gammal efter 24 timmar;
  utgången räknas om även vid tidsgränsen, när fliken blir synlig och när
  fönstret får fokus. Import-ID:n hindrar långsammare äldre filläsningar från
  att skriva över ett nyare val. Ingen live-databasanslutning krävs. Hasharna
  upptäcker drift men är inte digitala signaturer.
- Intern driftpolicy med `noindex`, blockerande `robots.txt`, säkerhetsheaders,
  clickjacking-skydd och en unik nonce-bunden CSP per SSR-begäran. Scriptpolicyn
  använder inte `unsafe-inline`; statiska hashresurser behåller immutable cache.
- Tillgänglig UI-bas med semantiska regioner och progressfält, starkare synlig
  fokusmarkering, global hopp-länk till huvudinnehållet, separat detaljhopp,
  `aria-live`, fältetiketter, fältbundna fel, förbättrad textkontrast, reducerad
  rörelse och minst 44 × 44 pixlar för alla synliga interaktiva kontroller i de
  tre huvudvyerna. 320 CSS-pixlars reflow är verifierad utan horisontell
  sidscroll.
- Lokal export till Obsidian Markdown, komplett resultat-JSON, exempeldata och regelregister.
- 85 automatiska DivineList-tester, inklusive policy- och hashbindning, flerbatchsemantik, resultatförsegling, okända fält, beslutens exakta bindning, evidensgrindar, neutral kandidatpresentation, produktionsstatus, lokala fail-closed köer och batchgränser.

## Den klassiska evidensverkstadens gräns

```text
[Obsidian / separat insamlare]
               │
               │ redan insamlade fakta + källbunden evidens
               ▼
       [DivineList-validering]
               │
               ▼
      [120 deterministiska regler]
               │
               ▼
 [evidensgrind + rotorsaksgruppering]
               │
               ▼
       [mänsklig granskningskö]
               │
               ├── lokal Markdown/JSON-export
               └── inget automatiskt kontaktsteg
```

Insamling och bedömning hålls isär. Ett nätverksfel, CORS, bot-skydd eller en ofullständig AI-observation får därför inte automatiskt bli ett påstått webbplatsfel. Den lokala V2.3-koden använder endast redan lagrade lokala underlag; ingen extern insamling utförs i verifieringskedjan.

## De 120 algoritmerna

| Område                       | Antal | Exempel                                                                |
| ---------------------------- | ----: | ---------------------------------------------------------------------- |
| Drift & HTTPS                |    10 | svar, statuskod, TLS, omdirigeringar, blandat innehåll                 |
| Indexering                   |    10 | robots, noindex, sitemap, canonical, trasiga internlänkar              |
| Prestanda                    |    10 | LCP, INP, CLS, TTFB, sidvikt, JavaScript, bilder                       |
| Mobil                        |    10 | viewport, horisontell scroll, tryckytor, navigation, överlägg          |
| Tillgänglighet               |    10 | språk, rubriker, alt-text, namn, etiketter, kontrast, tangentbord      |
| SEO på sidan                 |    10 | titel, metabeskrivning, dubletter, tunt innehåll, strukturerad data    |
| Lokal synlighet              |    10 | ort, NAP, LocalBusiness, öppettider, profilmatchning, serviceområden   |
| Konvertering                 |    10 | primär handling, kontaktväg, telefon/e-post, navigation, erbjudande    |
| Innehåll & förtroende        |    10 | platshållare, trasiga bilder, kodning, identitet, omdömen              |
| Formulär & handel            |    10 | inskickning, bekräftelse, validering, bokning, kassa, pris, lager      |
| Integritet & säkerhetshygien |    10 | policy, samtycke, spårning, formulärtransport, headers, felinformation |
| Kvalitet & underhåll         |    10 | 404, runtimefel, externa länkar, HTML, rutter, analys, kontaktlänkar   |

Varje regel finns i [`lib/audit/catalog.ts`](./lib/audit/catalog.ts) och innehåller stabilt ID och version, allvarlighetsgrad, rotorsaksfamilj, obligatoriska faktanycklar, deterministiskt villkor, evidenskrav, maximal evidensålder, faktabunden formulering, föreslagen åtgärd och en explicit manuell kontroll mot falska positiva resultat.

## Regellivscykler och publik status

Regelregistret har 120 definitioner:

- 50 kandidatregler;
- 60 regler i skuggläge;
- 10 pausade regler;
- 0 publikt aktiva regler.

Som räkneexempel ger 10 företag 1 200 företagsregelresultat: 500 kandidat-, 600 skugg- och 100 pausade körningsposter. Dessa hypotetiska tal är alltså **inte** den senaste körningen och inte 1 200 olika algoritmer.

Kandidatregler får endast lämna ett separat kalibreringsförslag. Deras publika status är `needs_review`, skugg- och pauslägen publicerar inte ett avgörande utfall, och alla publika prioriteringspoäng förblir 0. En regel kan börja bidra först genom en ny, versionsstyrd policy som en människa uttryckligen har granskat och godkänt. Kod, AI och kalibreringsrapport kan aldrig aktivera den själva.

## Resultatstatusar

| Status           | Exakt betydelse                                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| `detected`       | Felvillkoret matchade och all bunden evidens är komplett, färsk och tillåten.                                    |
| `not_detected`   | Kontrollen kördes med komplett evidens och felvillkoret matchade inte.                                           |
| `needs_review`   | Villkoret kan vara relevant, men ett avgörande publikt utfall är inte tillåtet eller evidensen behöver kontroll. |
| `not_tested`     | Minst en nödvändig fakta saknas, täckning/rendering är otillräcklig eller kontrollen blockerades.                |
| `not_applicable` | Ett explicit relevansvillkor visar att kontrollen inte gäller.                                                   |
| `error`          | Regeln kunde inte tolka det importerade värdets typ.                                                             |

`not_tested`, `needs_review` och `error` får aldrig översättas till ”webbplatsen är godkänd”.

## Evidens och confidence

En fakta ser ut så här:

```json
{
  "key": "performance.mobile_lcp_ms",
  "value": 4860,
  "evidenceIds": ["audit-2026-08-30-lighthouse-mobile"]
}
```

Evidensen måste finnas i samma företagspost och i V2 dessutom ange bland annat source, page, collector, actor och scope:

```json
{
  "id": "audit-2026-08-30-lighthouse-mobile",
  "method": "lighthouse",
  "label": "Mobiltest, syntetiskt exempel",
  "observedAt": "2026-08-30T08:00:00.000Z",
  "strength": "strong",
  "sourceUrl": "https://example.se/",
  "pageId": "PAGE:home",
  "collector": "safe-crawler",
  "collectorVersion": "1.0.0",
  "actor": "tool",
  "scope": "observed-page"
}
```

Confidence beskriver styrkan i evidensen, inte problemets allvar. Den versionsstyrda policyn sätter tak per metod, kontrollerar varje faktanyckel mot rätt evidensmetod och använder den svagaste nödvändiga faktans stöd när en regel kräver flera fakta. Rå HTML kan till exempel inte styrka ett LCP-värde. Saknad, gammal, felbunden eller otillåten evidens stänger vägen till ett avgörande utfall.

## Hash- och reproducerbarhetskontrakt

- `datasetHash` är SHA-256 över exakt den osplittade full-exportpayloaden `{version, name, createdAt, datasetHashVersion, factRegistryVersion, rulesetVersion, mappingVersion, evaluationPolicyVersion, evaluationPolicyHash, factHash, ruleHash, datasetHashContractHash, contractManifestHash, companies}`. Hela `companies` är unikt sorterad efter ID i Unicode-kodpunktsordning. Export- och batchfält ingår inte.
- En enskild delbatch kan inte räkna om full-exportens `datasetHash`. DivineList verifierar därför inte falskeligen detta värde från delmängden; den verifierar att `datasetHash` och `datasetHashVersion` är deklarerade och bundna av korrekt `batchHash`.
- `batchHash` är SHA-256 över kanonisk JSON för **hela batchobjektet**, inklusive dataset-, policy-, fakta-, regel-, datasetkontrakts- och manifestbindning; endast själva fältet `batchHash` utelämnas.
- `resultHash` är SHA-256 över kanonisk JSON för **hela resultatkuvertet**, inklusive policy-, dataset- och batchbindning, `version: divinelist.results.v2`, `resultHashVersion`, alla företagsresultat och guardrails; endast själva fältet `resultHash` utelämnas.
- TypeScript och Python använder samma stabila JSON-kontrakt och guldvektor för tal, Unicode och nyckelordning.

En ändring av en toppnivåversion, ett underlag eller ett resultat bryter alltså hashen. Hasharna ger manipulationsdetektion och reproducerbarhet, men ersätter inte signering, åtkomstkontroll eller mänsklig granskning.

## Prioriteringsstöd – inte en sanningspoäng

Appens `prioriteringsstöd 0–100` betyder inte webbplatskvalitet, köpvilja, budget eller kontaktgodkännande. En framtida regel får bidra endast om den har `detected`, minst 70 procent confidence och är både `active` och `automated` i en mänskligt godkänd versionspolicy. Okänt, gammalt, motstridigt, heuristiskt eller icke-aktiverat material ger alltid noll.

I den nuvarande V2.3-kedjan finns inga aktiva regler. Alla företag får därför publik poäng 0 även om en kandidatregel lämnar ett internt kalibreringsförslag. Ett negativt kandidatutfall är uttryckligen **inte ett fynd** och visas utan regelns problemformulering. Blockerade eller misslyckade körningar får aldrig bära eller räknas som kalibreringsförslag.

## Minimal datasetstruktur

```json
{
  "version": "divinelist.dataset.v2",
  "rulesetVersion": "divinelist.rules.v1.2.0",
  "factRegistryVersion": "divinelist.facts.v2.1.0",
  "mappingVersion": "foretagskarta-divinelist.v2.3.0",
  "datasetHashVersion": "divinelist.dataset-payload.v2.2.0",
  "datasetHash": "sha256:beräknas-av-exportören",
  "evaluationPolicyVersion": "divinelist.evaluation-policy.v2.2.0",
  "evaluationPolicyHash": "sha256:1aeaaa97cfe50a9ad5bcbfa10c4554be7cc5c44bb9add722cfe21cbd2c72d528",
  "factHash": "sha256:837feeb902c09495e4d97bdf3a3696bc3b5ab4f764090576dceadd0b34e0d643",
  "ruleHash": "sha256:5269f4d86f079f1c338478441111a92cfd12719a486f68908db61e1ca65922ec",
  "datasetHashContractHash": "sha256:94d963ff336609fae100362c583e46879c50cecf91c997eaaff41fedb36e69a9",
  "contractManifestHash": "sha256:a87252f1e5f7b12cda35a271ce6147a342816ffa4e6aa4c820e34b3bbc9c0fa6",
  "batchHashVersion": "divinelist.batch-envelope.v2.2.0",
  "batchHash": "sha256:beräknas-av-exportören",
  "exportId": "EXP:stabilt-id",
  "batchId": "BAT:stabilt-id",
  "name": "Obsidian batch 2026-08-30",
  "createdAt": "2026-08-30T09:00:00.000Z",
  "companies": [
    {
      "id": "WORK:stable-workplace-id",
      "workplaceUid": "WORK:stable-workplace-id",
      "siteUid": "SITE:stable-site-id",
      "name": "Exempelföretaget",
      "domain": "example.se",
      "city": "Göteborg",
      "industry": "Exempelbransch",
      "municipalityCode": "1480",
      "gothenburgStatus": "verified",
      "verificationStatus": "verified_current",
      "relationshipStatus": "verified_primary",
      "relationshipConfidence": 0.95,
      "renderFidelity": "full",
      "pageCoverage": {
        "eligiblePages": 1,
        "testedPages": 1,
        "excludedPages": 0
      },
      "capturedAt": "2026-08-30T08:00:00.000Z",
      "facts": [],
      "evidence": []
    }
  ]
}
```

V2 accepterar bara verifierad Göteborgskod 1480, aktuell arbetsställeidentitet och en verifierad domänrelation med minst 0,70 säkerhet. Osäkra poster stannar utanför exporten eller i mänsklig kö. Appen accepterar inte importerade poäng, kontaktgodkännanden eller AI-beräknade hashvärden som auktoritativa.

## Lokal reparationsstatus 2026-09-04

Kontrollen kl. 13:36 svensk tid visar **19 PASS, 2 FAIL och 2 WARN** efter
reparationen (före: 17/3/3). Backup/restore passerar med 269 verifierade
underlagsfiler på separat disk. Två saknade historiska originalfiler är
återställda, och en tillåten automatisk blockeringshändelse är registrerad.

Kandidat-usability använder nu `foretagskarta.candidate-usability.v2` och skiljer
fullständiga kalibreringsförslag från publika avgöranden. Ofullständiga resultat
är fortfarande blockerade; poäng, regler och utvärderingspolicy är oförändrade.
Motorns 276 tester passerar. Datagrinden är fortsatt `NO-GO`: ett
identitetsundantag, otillräcklig evidens, 30 karantänposter och kalibrering för
50 regler återstår. Inga webbplatsbesök, mänskliga beslut eller cutover utfördes.

Öppna [reparationens arbetslista](reports/remediation/2026-09-04/START_HAR.md).
Det nya hashbundna rapportparet och de separata granskningslistorna ligger i
samma katalog, utanför aktivt valv. Äldre statusfiler är inte ersatta.

## Historisk lokal produktionsstatus 2026-09-01

Den senaste **read-only beräkningen mot nuvarande runtime** är `FAIL / NO-GO`.
Den har 2 `FAIL` och 3 `WARN`; med exakt 23 kontroller innebär det 18 `PASS`.
De hårda felen är:

1. två arbetsställen vars senaste audit event är protokollogiltigt och därför
   undertrycks fail-closed;
2. kandidatgrinden har 0 avgörande resultat. Dess korrekta scope är de 400
   kandidat-/automated-körningarna: 30 `needs_review` och 370 `not_tested`
   (92,5 procent), inte alla livscykelposter;
   Varningarna är två saknade bevarade legacy-resultatreferenser, 30 öppna
   karantänposter och 0 regler med tillräckligt kalibreringsunderlag. Hela den
   nuvarande execution-generationen har samtidigt 960 poster: 49 `needs_review`
   och 911 `not_tested`. Den totalsiffran är viktig för operativ överblick men är
   inte kandidatgrindens nämnare.

De persistenta UI-filerna `production-check-latest.json` och
`production-check-latest.full.json` skrevs tidigare, omkring 21:44 svensk tid,
och visar 18 `PASS`, 2 `FAIL` och 3 `WARN`. De är korrekt hashbundna till
varandra men är äldre än den senaste runtime-generationen och bevisar därför
**inte** nuvarande status. Importvyn ska visa dem som ett lokalt snapshot, inte
som en live-anslutning eller ett färskt cutover-bevis.

Den tidigare separat-disk-backupen och dess lyckade restore-test är historiska
bevis för den generation de band. Den färska skrivskyddade beräkningen ger
`backup_restore=PASS`. Det beviset ska ändå omprövas efter varje framtida
runtimeändring och före ett separat cutover-beslut.

### PLAN-only reconciliation före eventuell cutover

En skrivskyddad reconciliation-plan finns i
`C:\Users\cozys\AppData\Local\WebDesignPartner\Foretagskarta\artifacts\runtime-reconciliation-v1-20260831T213417Z-target-3b029002a9b1.json`.
Den är verifierad men avsiktligt `BLOCKED`:

- `applySupported=false`, `safeToApply=false`, `automaticMergeRows=0`;
- 12 tabeller är identiska, 27 är append-only/target-preserved, 4 kräver
  transform, 3 har konflikter och 3 är blockerade;
- 433 rader finns bara i legacykällan, 8 632 bara i V2.3-target och 15
  primärnycklar kolliderar;
- `planHash` är
  `sha256:3956f20d7c7ee6e41fed1a6542aa24558c0d38b16c970e962e2194c4e0deb40d`;
- planfilens SHA-256 är
  `sha256:9fe129a9c5316afef8c054ec3d2b687183d0f866cb5cf65e4afce7b527eb4da6`.

Planen är endast ett deterministiskt granskningsunderlag. Det finns ingen APPLY,
ingen automatisk sammanslagning och ingen genomförd cutover.

## Historisk lokal E2E före V2.3-kontraktsbytet

Följande evidens skapades med de äldre V2.1/V2.2-kuverten. Den är bevarad som historik men är **inte** ett aktuellt releasebevis efter policy-, mapping- och hashkontraktsbytet. En ny cross-runtime E2E krävs innan V2.3 kan få motsvarande status. Den historiska körningen exporterade 8 behöriga företag och exkluderade 17.

- export-ID: `EXP:a929735809553d563f95235739a83ebc`
- datasetHash: `sha256:ab204dc2cf353db45fd328bde7d3e6709fd7fbe1ac4432b7871a6184626410dd`
- batchHash: `sha256:ae34ab928aeca2556e43a484d62178b5a0e4bf377612ab5ac7b41dd1d3597e7b`
- resultat: 8 företag × 120 regler = 960 företagsregelresultat
- publika statusar: 48 `needs_review`, 912 `not_tested` (95 procent), 0 avgörande
- körningsstatus: 880 `partial`, 80 `blocked`
- livscykelposter: 400 kandidat, 480 shadow, 80 paused
- publika poäng: 0 för samtliga företag
- resultHash: `sha256:2c0d11944649b2f296083a92b8a2b4a642146918843f937f13d11b21cfa88004`
- exakt resultatfil: 1 781 332 byte, rå SHA-256 `sha256:b392f31d0125b8dfbfac5d57e3c3bf727dd9483fcfa5f9f2415b37a424f79f4f`
- import-ID: `IMP:d21e19ce3e54093f96283baae0f46875`; upprepad import blev `already_imported` och `already_archived`
- guardrails: `scannedWebsites=false`, `outreachAuthorized=false`, `externalWrites=false`

DivineLists nuvarande appregression är `PASS`: 85 tester,
TypeScript-typkontroll, lint, formatkontroll, produktionsbygge, utökad säkerhets-
och HTTP-smoketest samt kontraktsexport. Den byggda appens nonce-CSP, filimport
och tre huvudvyer har dessutom verifierats i en riktig webbläsare. Tidigare
cross-runtime-import, stagingprojektion, separat-disk-backup och restore-test
bevaras som historiska bevis för sina exakta generationer. Motorns slutliga
sammanslagna svit är `265/265 PASS`; en färsk helt skrivskyddad
produktionsberäkning gav samtidigt `18 PASS / 2 FAIL / 3 WARN`. Ingen av dessa
kod- eller kontrollframgångar upphäver datans `NO-GO`.

Detta är inte en WCAG-certifiering. En full manuell genomgång med NVDA eller
VoiceOver, en kontroll med webbläsarens inbyggda zoomreglage och hela flödet
enbart med tangentbord återstår som mänskliga releasekontroller. Koden använder
standardkontroller och fokussemantik, men automatiseringen i denna körning kunde
inte pålitligt injicera Tab/Enter och används därför inte som bevis för en
komplett tangentbordspassage.

Se [`docs/PRODUCTION_V2.md`](./docs/PRODUCTION_V2.md) för full verifieringsstatus,
[`docs/RELEASE_READINESS_PLAN.md`](./docs/RELEASE_READINESS_PLAN.md) för den
fasindelade vägen till faktisk användning och
[`docs/OBSIDIAN_WORKFLOW.md`](./docs/OBSIDIAN_WORKFLOW.md) för det mänskliga
arbetsflödet.

## Rekommenderat Obsidian-flöde

1. Obsidian/AI eller en separat, uttryckligen auktoriserad insamlare skapar ett lokalt stagingunderlag med fakta och evidens.
2. Den lokala Pythonexportören validerar identitet, versioner och hashkuvert och skapar batcher om högst 100 företag/4,5 MB.
3. DivineList räknar resultat lokalt utan nätverk.
4. Du granskar högst tre starka, oberoende rotorsaker per företag.
5. Du verifierar ledande fynd och skriver en saklig motivering.
6. En säker projektion genereras till staging.
7. Kontakt, publicering och eventuell växling av aktivt valv är separata mänskliga beslut.

## Den klassiska evidensverkstadens säkerhets- och integritetsgränser

Dessa punkter gäller granskningsappen på port 8787. Skeppets separata lokala
API, offentliga insamling och lagring beskrivs i [STATION.md](docs/STATION.md).

- Inga `fetch`, XHR, WebSocket, iframe, faviconförfrågningar, analytics eller externa bilder används i appkoden.
- Domäner visas som text och blir inte automatiskt länkar.
- Importerad text renderas genom React och neutraliseras i Markdown-exporten.
- Webbplatstext behandlas som data, aldrig som instruktioner till AI.
- Endast offentlig företagskontakt hör hemma i underlaget; privat persondata ska inte importeras.
- Appen skickar inte formulär, bokningar, köp, e-post, SMS eller andra externa writes.
- Formuleringar om juridik, intäktsförlust, ranking och säkerhetsintrång kräver separat expertunderlag och skapas inte av reglerna.
- Inga regler autoaktiveras, ingen karantän autoavgörs och inga manuella Obsidian-fält återimporteras utan en granskad, hashbunden plan.

## Kalibrering före aktivering

En regel kan över huvud taget bli aktiveringskandidat först när den exakta
regelversionen har minst 60 reviews, varav minst 50 är klassificerade, minst 20
är positiva och minst 20 negativa, och högst 20 procent är osäkra. Därefter
krävs dessutom precision minst 0,90, recall minst 0,85, specificitet minst 0,90
samt konservativa Wilson-undre gränser på minst 0,75 för precision och 0,70 för
recall. När dessa hårda minimikrav är uppfyllda:

- mät precision och falsk-positiv-andel per regelversion;
- mät evidensens ålder och täckning vid granskning;
- pausa eller revidera regler med svagt utfall;
- bind varje mänskligt beslut till exakt inputhash och regelversion;
- skapa ett versionsstyrt aktiveringsförslag;
- låt en människa granska och uttryckligen godkänna policyn.

Antalet hittade ”fel” är inte kvalitetsmåttet:

```text
rätt företag → rätt domän → sant fynd → färsk evidens → tydlig åtgärd → mänskligt beslut
```

## Skala till hundratals eller tusentals företag

- Dela listan i V2-batcher om högst 100 företag och 4,5 MB.
- Behåll stabila företag-ID:n och exakt dubblettstopp.
- Lägg fuzzy-matchningar och oklar identitet i mänsklig kö; fyll inte kvoten med osäkra poster.
- Lagra maskindata i JSON/SQLite och använd Markdown som en läsbar, återskapningsbar projektion.
- Visa högst tre starka, oberoende rotorsaker i en första genomgång.
- Behåll en separat kontaktkö med högst tre manuellt godkända kandidater om detta senare kopplas till Kundradar.

## Projektstruktur

```text
app/
  page.tsx                 visuell arbetsyta
  layout.tsx               svensk metadata, favicon och noindex
proxy.ts                   nonce-CSP och säkerhetsheaders för SSR-svar
lib/audit/
  types.ts                 exakta data-, versions- och resultattyper
  catalog.ts               120 algoritmer
  fact-registry.ts         128 faktadefinitioner
  engine.ts                validering, körning, evidens och prioritering
  batch-result.ts          versions- och hashbundet resultatkuvert
  sample-data.ts           syntetiska .example-fixtures
  obsidian.ts              säker Markdown- och JSON-export
scripts/
  export-contracts.ts      hashade V2.3-kontrakt
  evaluate-batch.ts        deterministisk offlineutvärdering
  smoke-production.mjs     isolerad HTTP-, cache- och headergrind
tests/
  audit-engine.test.ts     motor-, kontrakts-, gräns- och hashregressioner
docs/
  PRODUCTION_V2.md         arkitektur, verifiering och produktionsgrind
  RELEASE_READINESS_PLAN.md fasplan, stoppvillkor och acceptanskriterier
  OBSIDIAN_WORKFLOW.md     staging, AI-kontrakt och mänsklig kontroll
```

## Viktig begränsning

DivineList bevisar endast vad som kan härledas från det importerade snapshotet. Den bevisar inte att en hel webbplats saknar andra problem, att ett företag behöver köpa en tjänst eller att en viss förbättring ger en viss affärseffekt. Nuvarande data är uttryckligen inte godkänd för produktionscutover eller kontaktunderlag.
