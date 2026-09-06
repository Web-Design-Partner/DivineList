# Produktionskandidat V2.3

## Senaste reparation 2026-09-04

Kontroll kl. 13:36 svensk tid: **19 PASS / 2 FAIL / 2 WARN**. Backup/restore och
historiska artefaktreferenser är nu PASS. Ett av två arbetsställeundantag är
hanterat med en källbunden teknisk blockeringshändelse, utan mänskligt beslut.
276 Python-tester passerar. Se [arbetslistan](../reports/remediation/2026-09-04/START_HAR.md)
för exakta kvarvarande poster och det nya verifierade rapportparet.

Användbarhetsgrind v2 räknar fullständiga kandidatförslag separat från publika
avgöranden. Det rättar en motsägelse med den frysta kandidatpolicyn; inga
ofullständiga resultat, fynd, poäng eller regler uppgraderas. Nuvarande data
har fortfarande 0 användbara kandidatbedömningar. Ingen produktionskandidat,
cutover, publicering eller kontakt är godkänd av dessa resultat.

## Historiskt bevis 2026-09-01

Status 2026-09-01: **DivineList-appen och dess kontrakt är verifierade, men den
senaste read-only beräkningen mot aktuell runtime är `FAIL / NO-GO`**. Nuvarande
backup/restore-kontroll är `PASS`, men reconciliation-planen är avsiktligt
`BLOCKED`. Äldre E2E-, projektions- och
backupbevis nedan är tydligt märkta som historiska. Ingen kontakt, publicering,
deploy, APPLY eller växling av det aktiva Obsidian-valvet ingick.

## Två separata grindar

| Grind                                         | Status         | Slutsats                                                                                  |
| --------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------- |
| DivineList kod-, kontrakts- och UI-invariants | `PASS`         | 85 app-tester och den lokala releasegrinden passerar; detta bevisar inte aktuell runtime. |
| Senaste read-only motorstatus                 | `FAIL / NO-GO` | 2 hårda fel och 3 varningar; ingen produktionskandidat eller cutover.                     |
| Backup/restore-kontroll                       | `PASS`         | Färsk read-only kontroll passerar; måste bindas om efter framtida runtimeändring.         |
| PLAN-only reconciliation                      | `BLOCKED`      | Skillnaderna är kartlagda men ingen APPLY eller automatisk merge finns eller är säker.    |

En grön implementation får aldrig beskrivas som produktionsklar data. `productionCandidate=false`, `cutoverReady=false` och `cutoverPerformed=false` är avsiktliga resultat.

## Aktuellt lokalt V2.3-bevis 2026-09-01

- DivineList: `85/85` tester, TypeScript, lint, format, bygge, utökad
  HTTP-/säkerhetssmoke och exakt femfils-kontrakt passerade. Den byggda SSR-appen
  gav unik nonce per begäran, strikt `script-src` utan `unsafe-inline`, `noindex`,
  blockerande `robots.txt`, korrekta rot-/HEAD-/404-svar och immutable cache för
  hashade resurser.
- Lokalt driftläge binder genom `scripts/start-local.mjs` som standard explicit
  till `127.0.0.1`. `--ip` accepteras enbart för `127.0.0.1`; andra IP:er stoppas.
- `run-divinelist.ps1` är den rekommenderade Windows-starten: port 8787 som
  standard, Node.js ≥ 22.13-kontroll, krav på `node_modules`, automatisk build
  när `dist` saknas och endast loopback-bindning. Den verifierades på port 3006
  med HTTP 200, HTML, CSP och ren shutdown. `start-local.mjs` ger ett tydligt
  fel för saknad `dist`, och produktionssmoketestet använder samma startväg.
- Motorns slutliga sammanslagna svit är `265/265 PASS`. Det inkluderar det nya
  append-only-protokollet `foretagskarta.workplace-event.v1`, dess fail-closed
  identitetsgrindar och skydd mot generisk resolution av protokollhändelser.
- Tillgänglighets-QA: synliga interaktiva kontroller använder minst 44 pixlars
  målstorlek. Fältetiketter, fältbundna fel, `aria-current`, `aria-pressed`,
  `aria-live`, progressroller, förstärkt synlig fokusmarkering, förbättrad
  kontrast, reducerad rörelse och hopp-länk med explicit fokusmål verifierades i
  kod/DOM. Efter de senaste UI-ändringarna verifierades båda produktionsfilfälten
  i den riktiga produktionsbyggnaden: fokus låg kvar, `aria-busy` återgick till
  `false` och fälten var aktiva. Reflow vid 320 CSS-pixlar gav
  `clientWidth=305` och `scrollWidth=305`, även med dynamiska statusbadges.
  Äldre exakta kontrollantal används inte som aktuellt bevis efter UI-ändringen.
- Tillgänglighetsgrinden är ännu inte en WCAG-certifiering: manuell NVDA/VoiceOver, en kontroll med webbläsarens inbyggda zoomreglage och en full tangentbordspassage återstår. Den lokala browserautomationen kunde inte pålitligt injicera Tab/Enter och räknas därför inte som bevis för denna sista del.
- Migration `1–9` är checksumme- och schemafingerprintverifierad. `migrate-v2` gav samma redovisning vid dry-run, verklig körning och omkörning: 334 källrader, 304 migrerade, 30 i öppen karantän och 0 avvisade.
- Export `EXP:ff60477b74e6d5c8aa2b7cd907f384d7` innehöll 8 behöriga företag och exkluderade 17 med redovisade orsaker. Import `IMP:d6830d299fd8e4e8ad650d8d0a5b18f5` band exakt 8 företag och 960 regelkörningar; omimport gav `already_imported` och `already_archived`.
- Tre projektioner gav identiska 237 filer, 1 018 073 byte och trädhash `sha256:22639bc792c5394a8e735ab7938cad08f4ec26ff8754fb50c18085829fea479a`.
- Den senaste read-only beräkningen har exakt 2 `FAIL` och 3 `WARN`. Felen är två
  arbetsställen vars senaste audit event är protokollogiltigt och därför
  undertrycks samt kandidat-usability med 0 avgörande resultat. Varningarna gäller två
  bevarade legacy-resultatreferenser utan arkiv, 30 öppna karantänposter och 0
  kalibreringsunderlag.
- Kandidatgrindens korrigerade scope är exakt 400 kandidat-/automated-körningar:
  30 `needs_review` och 370 `not_tested` (92,5 procent). Hela current
  execution-generationen innehåller 960 poster: 49 `needs_review` och 911
  `not_tested`. De två nämnarna får inte blandas ihop.
- Produktionsstatusimporten kräver både den högst 256 000 byte stora
  UI-sammanfattningen och den exakta fullrapporten. Fullrapportens UI-gräns är
  16 000 000 byte. Appen verifierar filnamn, byteantal, SHA-256, hela den
  tillåtna strukturen, färskhet och 24-timmarsutgång. Utgången räknas om vid
  tidsgränsen, fokus och visibility change; request-ID:n stoppar långsamma äldre
  filläsningar från att vinna ett race.
- De persistenta filerna `production-check-latest.json` och
  `production-check-latest.full.json` är från cirka 21:44 svensk tid och visar
  18 `PASS`, 2 `FAIL` och 3 `WARN`. De är äldre än senaste runtime och är därför
  **inte** bevis för nuvarande status.
- Gransknings-UI:t håller ett separat utkast per beslut, stoppar dataset- och
  sessionsimport när osparade beslut eller utkast finns och kräver uttrycklig
  bekräftelse efter lokal sessionsnedladdning. Regelbiblioteket visar exakt 20
  regler per sida och återför fokus kontrollerat efter sidbyte.
- Backupen `post-evidence-pilot-20260831-20260831T212652794223Z` på `Z:` och dess
  lyckade restore-test är historiska bevis för sin bundna generation. Den färska
  read-only kontrollen ger `backup_restore=PASS`; kontrollen måste köras om efter
  varje framtida runtimeändring och före cutover.
- Det aktiva Obsidian-valvet var exakt oförändrat vid den avslutade V2.3-körningens
  baslinje: 13 078 filer, 156 178 615 byte och trädhash
  `sha256:fba571c954d17ad19f17f90b729cebce0e02f78863747e829ff197eb7c2f337e`.
  Den baslinjen är inte längre aktuell. En separat samtidigt aktiv Codex-uppgift
  skrev därefter i valvets bevarade legacyruntime och manuella review-underlag.
  En skrivskyddad snapshot 2026-08-31 21:40 svensk tid gav 13 108 filer,
  163 551 768 byte och trädhash
  `sha256:0877b25468cec0638b8c8eff968964d8238777f682b58612eb33e83258744dcf`.
  Inget återställdes eller raderades; en ny cutover-baslinje får tas först när den
  andra uppgiften är färdig och ändringarna har granskats.

## Arkitektur

```text
[Aktivt Obsidian-valv, ingen datacutover]
                 │
                 │ mänskligt ägda källposter
                 ▼
[Extern Pythonruntime] ──► [SQLite V2.3 i LocalAppData]
                 │                        │
                 │ hashbunden export     │ identitet, evidens, historik
                 ▼                        │
[DivineList: 128 fakta / 120 regler]      │
                 │                        │
                 └── atomär import ───────┘
                                          │
                                          ▼
                              [Validerad stagingprojektion]

Ingen pil går automatiskt till webbplatser, företag, publicering eller kontakt.
```

## Fysiska gränser

- DivineList-kod: `C:\Users\cozys\OneDrive\Documents\ChatGPT\DivineList`
- Extern runtime: `C:\Users\cozys\Documents\Goteborgs-Foretagskarta-Engine`
- V2.3-databas: `C:\Users\cozys\AppData\Local\WebDesignPartner\Foretagskarta\state\engine-v2.sqlite3`
- Kontrakt, exporter, resultatarkiv och staging: `C:\Users\cozys\AppData\Local\WebDesignPartner\Foretagskarta\artifacts`
- Backuper: `C:\Users\cozys\AppData\Local\WebDesignPartner\Foretagskarta\backups`
- Aktivt valv: `C:\Users\cozys\Documents\Obsidian\Goteborgs-Foretagskarta`

Runtime och state ligger utanför valvet. Den genererade stagingprojektionen har ingen egen `.obsidian`-mapp. Aktiv vault innehåller fortfarande sin bevarade legacyruntime, `node_modules` och konfiguration; ingen automatisk städning eller växling sker.

## PLAN-only reconciliation

Den verifierade reconciliation-planen finns i
`C:\Users\cozys\AppData\Local\WebDesignPartner\Foretagskarta\artifacts\runtime-reconciliation-v1-20260831T213417Z-target-3b029002a9b1.json`.
Den är ett skrivskyddat pre-cutover-bevis, inte en migrering:

- status `BLOCKED`;
- `applySupported=false`, `safeToApply=false`, `automaticMergeRows=0`;
- 12 kategorier/tabeller `identical`, 27 `append-only` eller
  `target-preserved`, 4 `transform-required`, 3 `conflict` och 3 `blocked`;
- 433 source-only-rader, 8 632 target-only-rader och 15 PK-kollisioner;
- `planHash`
  `sha256:3956f20d7c7ee6e41fed1a6542aa24558c0d38b16c970e962e2194c4e0deb40d`;
- planfilens SHA-256
  `sha256:9fe129a9c5316afef8c054ec3d2b687183d0f866cb5cf65e4afce7b527eb4da6`.

Planen binder rå och logisk databashash, migrationer, schema, WAL-state och
sorterade PK-/rowhashar. Ingen APPLY, automatisk sammanslagning, vaultskrivning
eller cutover utfördes. Konflikter och transformkrav måste granskas och få en
separat, uttryckligt godkänd semantik innan någon framtida överföring kan
övervägas.

## Exakta kontraktsversioner

| Del                 | Version                               |
| ------------------- | ------------------------------------- |
| Dataset             | `divinelist.dataset.v2`               |
| Faktaregister       | `divinelist.facts.v2.1.0`             |
| Regelregister       | `divinelist.rules.v1.2.0`             |
| Mappning            | `foretagskarta-divinelist.v2.3.0`     |
| Dataset-hashpayload | `divinelist.dataset-payload.v2.2.0`   |
| Batchkuvert         | `divinelist.batch-envelope.v2.2.0`    |
| Resultatkuvert      | `divinelist.result-envelope.v2.2.0`   |
| Utvärderingspolicy  | `divinelist.evaluation-policy.v2.2.0` |
| Resultatformat      | `divinelist.results.v2`               |
| Granskningsbeslut   | `divinelist.review-decision.v2.3.0`   |
| Produktionsstatus   | `foretagskarta.production-status.v1`  |

Kontraktsmanifestet innehåller 128 fakta och 120 regeldefinitioner. De exakta hashankarna är fact `sha256:837feeb902c09495e4d97bdf3a3696bc3b5ab4f764090576dceadd0b34e0d643`, rules `sha256:5269f4d86f079f1c338478441111a92cfd12719a486f68908db61e1ca65922ec`, policy `sha256:1aeaaa97cfe50a9ad5bcbfa10c4554be7cc5c44bb9add722cfe21cbd2c72d528`, datasetkontrakt `sha256:94d963ff336609fae100362c583e46879c50cecf91c997eaaff41fedb36e69a9` och manifest `sha256:a87252f1e5f7b12cda35a271ce6147a342816ffa4e6aa4c820e34b3bbc9c0fa6`.

En V2-batch får innehålla högst 100 företag och 4 500 000 UTF-8-byte. Standard är 50. Exportören delar större listor i flera batcher.

## Genomförda faser

1. Baslinje och onlinebackup med separat återställningstest.
2. Extern runtime och state utan att radera legacydata.
3. SQLite migration 1–9 med checksummebundna, atomiska migreringar.
4. Append-only historik för audit, importer, review och kalibrering samt mänskligt skyddad karantänresolution.
5. Redovisad, idempotent legacy→V2-migrering med exakt karantänbokföring.
6. Versionsstyrt register med exakt 128 fakta och 120 regler.
7. Strikta typer, evidensmetod, färskhet, collector, actor, scope, artifactsökväg, rendering och sidtäckning.
8. Regeltiers och livscykler utan automatisk aktivering eller publik poäng.
9. Deterministiska batcher med högst 100 företag/4,5 MB och cross-language canonical JSON.
10. Full-exportens datasetHash över exakt osplittad payload; delbatcher deklarerar och binder detta värde men kan inte självständigt verifiera hela exporten.
11. Full batchHash över hela batchen inklusive dataset-, mapping-, policy-, fakta-, regel-, datasetkontrakts- och manifestbindning, med endast `batchHash` utelämnad vid beräkningen.
12. Full resultHash över hela resultatkuvertet inklusive policy-, dataset-, batch- och kontraktsbindning, med endast `resultHash` utelämnad.
13. Atomär, idempotent import som även arkiverar exakta resultatbytes efter databascommit.
14. Validerad Obsidianprojektion via temporär generation och atomiskt byte med crash recovery.
15. Fail-closed återimport av exakt sex manuella fält: plan först, därefter separat hashbunden apply med namngiven mänsklig godkännare.
16. Backupformat V4 med online-SQLite-snapshot, logiskt fingeravtryck, artifactsmanifest, integritet och exakt restore-test.
17. Full offline-E2E och maskinläsbar produktionsgrind.

Faserna ovan beskriver implementerade funktioner och historiskt verifierade
generationer. De gör inte hela dagens runtimekedja grön: senaste read-only
produktionsstatus är fortsatt `FAIL / NO-GO`, reconciliation är `BLOCKED` och
backup/restore-vittnet måste förnyas efter stabilisering.

## Historisk V2.2-migration (inte aktuellt V2.3-releasebevis)

- Migrations-ID: `MIG:7b28118236eacc9e40284bbc476b579f`
- Legacyrader redovisade: 334
- Migrerade: 304
- Karantän: 30
- Avvisade utan spår: 0
- Tidszon osäker: 55 historiska tidsvärden
- Schema: migration 1–8 med exakta checksummor
- Upprepad körning: samma redovisning, utan dubblering

En första versionsreplay fångade ett tidsstämpelproblem i den immutabla reviewhistoriken. Transaktionen rullades tillbaka, migrationen korrigerades att återanvända den befintliga eventtiden, en regression lades till och därefter passerade både första och upprepad körning.

## Historisk V2.2-offline-E2E (ersatt som aktuellt bevis)

### Urval och elimineringar

- Behöriga företag: 8
- Exkluderade: 17
- Ej verifierade som Göteborg: 8
- Ej verifierade som aktuella arbetsställen: 7
- Blockerade av snapshotstatus: 2
- Kvotfyllning med osäkra poster: 0
- Export-ID: `EXP:a929735809553d563f95235739a83ebc`
- datasetHash: `sha256:ab204dc2cf353db45fd328bde7d3e6709fd7fbe1ac4432b7871a6184626410dd`
- batchHash: `sha256:ae34ab928aeca2556e43a484d62178b5a0e4bf377612ab5ac7b41dd1d3597e7b`

### Resultat

- 8 företag × 120 regeldefinitioner = 960 företagsregelresultat
- 48 `needs_review`
- 912 `not_tested` (95 procent)
- 0 `detected`/`not_detected` eller andra avgörande publika resultat
- 400 kandidatposter, 480 shadowposter och 80 pausedposter
- körningsstatus: 880 `partial`, 80 `blocked`
- publika poäng: 0 för samtliga företag
- resultHash: `sha256:2c0d11944649b2f296083a92b8a2b4a642146918843f937f13d11b21cfa88004`
- exakt resultatfil: 1 781 332 byte, rå SHA-256 `sha256:b392f31d0125b8dfbfac5d57e3c3bf727dd9483fcfa5f9f2415b37a424f79f4f`
- guardrails: `scannedWebsites=false`, `outreachAuthorized=false`, `externalWrites=false`

400/480/80 beskriver livscykeln för 960 **företagsregelresultat**. Regelregistret innehåller fortfarande exakt 120 definitioner: 50 kandidat, 60 shadow och 10 paused.

### Import och arkivering

- Importstatus: `PASS`, 960 resultat
- Import-ID: `IMP:d21e19ce3e54093f96283baae0f46875`
- Exakt resultatarkiv: `C:\Users\cozys\AppData\Local\WebDesignPartner\Foretagskarta\artifacts\results\0aec56f033709e316426207785332bbf8f8101a19040e82bd8653b3e9b06fa12.json`
- Arkiverad filstorlek: 1 781 332 byte
- Rå fil-SHA-256: `sha256:b392f31d0125b8dfbfac5d57e3c3bf727dd9483fcfa5f9f2415b37a424f79f4f`
- Upprepad import: `already_imported` och `already_archived`

## Regellivscykel och kalibrering

Ingen regel är publikt aktiv i den nuvarande policyn:

- 50 kandidatregler kan bara lämna ett separat kalibreringsförslag; publik state stannar `needs_review` och score är 0.
- 60 shadowregler får inte publicera ett avgörande resultat eller bidra till score.
- 10 pausade regler körs inte och markeras blockerade.
- 0 regler är `active`.

`calibration-report` läser mänskligt reviewunderlag och kan föreslå en ny policykandidat. Rapporten ändrar aldrig policy. Minimikraven per exakt regelversion är 60 reviews, minst 50 klassificerade, minst 20 positiva, minst 20 negativa och högst 20 procent osäkra. Därutöver krävs precision ≥ 0,90, recall ≥ 0,85, specificitet ≥ 0,90 samt Wilson-undre gränser ≥ 0,75 för precision och ≥ 0,70 för recall. En regel kan aktiveras först i en ny versionsstyrd policy efter uttryckligt mänskligt godkännande. Nuvarande data har 0 regler med tillräckligt kalibreringsunderlag.

## Senast verifierade Obsidianprojektion

Staging: `C:\Users\cozys\AppData\Local\WebDesignPartner\Foretagskarta\artifacts\staging-vault`

- 237 filer på disk inklusive projektionmanifest
- 227 Markdown-filer
- 9 `.base`-filer
- 1 projektionmanifest
- 1 dashboard
- 25 arbetsställen
- 8 faktanoter
- 49 evidensnoter
- 8 täckningsnoter
- 49 regelresultat
- 49 granskningsposter
- 30 karantänposter
- 8 export-/importöversikter
- 0 konflikter

Stagingträdet är 1 018 073 byte med trädhash `sha256:22639bc792c5394a8e735ab7938cad08f4ec26ff8754fb50c18085829fea479a`. Manifestets råa SHA-256 är `sha256:9625fcc2d1daecaea481d417403ef9ea9f8f2b209ff0f319920ba81e769c6a36`. Två upprepade `project-v2` efter den första körningen gav exakt samma träd och manifest och lämnade inga journal-, generations- eller temporära rester. Detta verifierar den bundna projektionsgenerationen, inte att den fortfarande motsvarar den senare ändrade runtime-databasen.

Projektionen byggs först i en temporär katalog, valideras mot manifestet och byts därefter atomiskt. Importerad text neutraliseras för YAML/Markdown. En upprepad körning är deterministisk och genererade filer skrivs inte direkt över av manuell active-vault-data.

Den fail-closed planen för återimport från aktivt valv läste 25 legacyanteckningar och blev `BLOCKED`: 25 saknade den nya revisionsmarkören, 0 var ändrade och 0 var tillåtna för apply. Ingen manuell fältändring importerades till databasen.

### Aktivt Canvas – avgränsad reparation, inte cutover

Den enda avsiktliga ändringen i aktiv vault var en separat länk- och räknarreparation i `00 Start\Göteborg.canvas`:

- backup före reparation: `C:\Users\cozys\AppData\Local\WebDesignPartner\Foretagskarta\backups\canvas\Goteborg-before-link-repair-fceb41bc7fcb.canvas`
- ursprunglig/backup-SHA-256: `FCEB41BC7FCB4C0A3E0459BF25DC2D4B4AAA423FA5FEF8F0D1B692B166129F8E`
- slutlig SHA-256: `E74A3A29C7BC6AC0E88519FC6E3A785EC8F8F0A9ECB37D5C1764B2EEF0047393`
- 15 noder, 13 kanter, 10 Wikilinks, 0 saknade länkmål och 9 räknarrader
- andra räknarsynken: 0 ändrade noder, alltså idempotent

Nodernas geometri/egenskaper och kanterna bevarades. Reparationen ger inte tillstånd att ersätta valvdata, radera legacyruntime eller växla till staging.

## Karantän

30 legacyfynd ligger öppna i karantän. De löses inte automatiskt. `resolve-quarantine` kräver exakt `quarantine_uid`, förväntad källhash, beslut, saklig motivering och namngiven mänsklig reviewer. Eventhistoriken är append-only, resolution är optimistiskt låst till rätt input och upprepade eller motsägande beslut stoppas.

Ingen verklig karantänpost löstes i denna implementation.

## Historisk Backup V4 och restore

Senast verifierade backup för den dåvarande post-pilot-generationen:

- katalog: `Z:\WebDesignPartner\Foretagskarta\backups\post-evidence-pilot-20260831-20260831T212652794223Z`
- databas-SHA-256: `sha256:5189f0fb452ec96e331f8c3080d84c226c6b0b136a89d838e35e0f593a10c59f`
- logiskt fingeravtryck: `sha256:e90676e94e98ef2606e53b412c66f977487bb04eb89e08b92d06daec7a60a27d`
- manifest-SHA-256: `sha256:9fa0f58739aa45a9071aa4de894cc0012a7f815650d0b1cdec42e2c512b28329`
- omfattning: 266 artifacts, 46 tabeller och 8 964 rader
- SQLite-integritet: `ok`
- foreign-key-fel: 0
- restore-test: `PASS`, fysisk och logisk identitet, identiska tabellräkningar och exakt artefaktinventering
- referenser: 262 bundna, 0 ogiltiga och 2 uttryckligt varnade legacy-resultatreferenser utan arkiv

Alla värden i listan ovan är historiska och ska bevaras som bevis för den
generationen. Den färska read-only kontrollen rapporterar
`backup_restore=PASS`. Kör ändå om kontrollen efter varje framtida runtimeändring
och bind en ny backup till exakt den generation som senare ska prövas för
cutover.

Backupen ligger på en annan verifierad fysisk disk än källdatabasen. Miljövariabeln
`FORETAGSKARTA_BACKUP_ROOT` är användarkonfigurerad till
`Z:\WebDesignPartner\Foretagskarta\backups`. Restore-vittnet finns i
`artifacts\restore-tests\restore-0f593a10c59f-20260831T212716140003Z`.

## Driftkommandon

Kör från den externa runtimen:

```powershell
.\run-engine.ps1 runtime-paths
.\run-engine.ps1 migrate-v2 --dry-run
.\run-engine.ps1 plan-export
.\run-engine.ps1 export-divinelist
.\run-engine.ps1 import-divinelist-results <resultatfil.json>
.\run-engine.ps1 review-queue
.\run-engine.ps1 record-review <execution_uid> <workplace_uid> <rule_id> <rule_version> <input_hash> <state> --rationale <text> --reviewer <namn>
.\run-engine.ps1 record-calibration <execution_uid> <human_state> --rationale <text> --reviewer <namn>
.\run-engine.ps1 calibration-report
.\run-engine.ps1 quarantine-list
.\run-engine.ps1 resolve-quarantine <uid> <expected-source-hash> <decision> --rationale <text> --reviewer <namn>
.\run-engine.ps1 reimport-manual --vault-root <vault> --plan-output <plan.json>
.\run-engine.ps1 apply-manual-reimport <plan.json> --vault-root <vault> --approved-by <namn>
.\run-engine.ps1 project-v2
.\run-engine.ps1 backup-v2 --label production-v2.3
.\run-engine.ps1 restore-test <backup\engine.sqlite3>
.\run-engine.ps1 production-check
.\run-engine.ps1 plan-runtime-reconciliation --source-db <legacy.sqlite3> --target-db <engine-v2.sqlite3> --plan-output <artifacts\reconciliation.json> --allow-active-vault-read
```

`reimport-manual` är alltid plan-only. `apply-manual-reimport` kräver en oförändrad, granskad och hashbunden plan. Läsning av aktiv vault kräver dessutom den uttryckliga flaggan `--allow-active-vault-read`.

Ett befintligt DNC-beslut får inte raderas eller ersättas av manuell återimport.

`run-next` gör inga nätverksanrop utan `--allow-network`. Den flaggan användes inte. Ett tillstånd att köra den lokala kedjan är inte ett tillstånd att samla externt.

Kör DivineList-batcher från DivineList-katalogen:

```powershell
npm run export:contracts -- <kontraktskatalog>
npm run evaluate:batch -- <batch.json> <resultat.json> <ISO-tid>
```

## Historisk V2.2-produktionsgrind 2026-08-30

Historisk status finns fryst i `docs/BASELINE_2026-08-30.md`. De persistenta
filerna `production-check-latest.json` och
`production-check-latest.full.json` är från cirka 21:44 svensk tid och visar
18 `PASS`, 2 `FAIL` och 3 `WARN`. De är också äldre än senaste runtime och får
därför varken användas som källa för den historiska tabellen nedan eller som
bevis för dagens status.

| Kontroll                       | Status | Bevis/orsak                                             |
| ------------------------------ | ------ | ------------------------------------------------------- |
| DB-integritet och foreign keys | `PASS` | `integrity_check=ok`, 0 FK-fel                          |
| Migrationer                    | `PASS` | 1–8 med exakta checksummor                              |
| Versionskontrakt               | `PASS` | exakt versionsmatris ovan, 128 fakta, 120 regler        |
| Runtimeisolering               | `PASS` | kod/state utanför vault                                 |
| Kontaktdata/externa effekter   | `PASS` | inga kontakter, inga nätverkskörningar, ingen outreach  |
| Batch/resultathash             | `PASS` | fulla kuvert inklusive versioner                        |
| Resultatimport                 | `PASS` | 960 atomiskt importerade och arkiverade resultat        |
| Projektion                     | `PASS` | exakt 229 manifestägda filer                            |
| Aktivt Canvas                  | `PASS` | giltig JSON, 0 saknade länkar och idempotent räknarsynk |
| Backup/restore                 | `PASS` | onlinebackup och exakt separat restore-test             |
| Auditresultat användbara       | `FAIL` | 0 avgörande; 912/960 = 95 % `not_tested`                |
| Karantän                       | `WARN` | 30 öppna poster                                         |
| Kalibrering                    | `WARN` | 0 regler med tillräckliga mänskliga reviews             |
| Backupplacering                | `WARN` | samma volym som källan                                  |

Sammanfattning: **1 FAIL, 3 WARN, cutover NO-GO**. Det är korrekt fail-closed beteende, inte ett försök att dölja en ofullständig produktionsstatus.

## Vad som återstår före cutover

1. Skapa en exakt V2.3-audit/importkedja för de två arbetsställen som nu har legacy-auditen `AUD:4ee2ead07ae558ec45860a9d052a4804` som senaste event. Historiken ska bevaras; den gamla raden ska inte raderas eller skrivas om.
2. Samla eller verifiera mer källbunden evidens först efter separat nätverksauktorisation.
3. Göra versionsbundna mänskliga reviews och kalibrera viktiga regler.
4. Lösa karantänposter en i taget med källhash, saklig motivering och reviewer.
5. Öppna staging i Obsidian och kontrollera länkar, Bases, Canvas, sökning och mänskligt flöde visuellt.
6. Granska reconciliation-planens 15 PK-kollisioner och fyra
   transform-required-kategorier utan att använda en automatisk merge.
7. Stabilisera runtime och skapa därefter en ny generationsbunden backup med
   matchande restore-test.
8. Ta ett uttryckligt, separat beslut om aktiv-vault-cutover och eventuell legacy-städning.

Ingen av dessa punkter får automatiskt starta webbinsamling, kontakt, deploy, publicering eller radering.
