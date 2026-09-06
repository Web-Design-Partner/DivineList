# DivineList V2.3 – plan till faktisk användning

Mandattillägg 2026-09-04: [lokal autonomi](LOCAL_AUTONOMY.md) och
[AGENTS.md](../AGENTS.md) ersätter tidigare krav på ett nytt ja för varje offentlig
företagsresearch, lokal identitetsbedömning och staging-/provimportförberedelse.
Agenten får driva det arbetet, parkera osäkra kandidater och gå vidare utan
rutinfrågor. Runtimeacceptans, verkliga mänskliga reviews och högriskåtgärder
omfattas inte av den förenklingen. Historiska körresultat nedan är oförändrade.

## Reparationsläge 2026-09-04 kl. 13:36

**19 PASS / 2 FAIL / 2 WARN** är det nya runtime-snapshotet. Ny backup och
verkligt restore-test passerar; de två historiska originalfilerna har
återställts. Ett av två protokollundantag har fått en giltig automatisk
blockeringshändelse. Kandidatgrindens logiska motsägelse är reproducerad och
rättad utan nya fynd eller policyändring. Motorns 276 tester är PASS.

Aktuell ordning: OMNIA:s verkliga identitetsbeslut; evidenspilot med fullständig
rendering/täckning; de 30 karantänposterna; kalibrering för 50 kandidatregler;
ny slutkontroll och separat cutoverbedömning. Exakta ID:n, hashvärden,
acceptanskriterier och ansvar finns i [nästa-steg-paketet](../reports/remediation/2026-09-04/START_HAR.md).
Paketet ligger utanför aktivt valv. Ingen mänsklig review eller etikett är
fabricerad och ingen regel är aktiverad. Datagrinden är fortsatt NO-GO.

## Historiskt läge 2026-09-04 kl. 13:06, före reparationen

Status 2026-09-04: den fulla lokala releasekontrollen är `PASS` med 85 DivineList-tester
och 25 release-/readinesstester. En ny skrivskyddad runtimekontroll klockan
13:06 svensk tid visar **17 PASS, 3 FAIL och 3 WARN**. `productionCandidate` och
`cutoverReady` är fortfarande false. Backupens återställningsbevis från
2026-08-31 har passerat motorns 24-timmarsgräns; det tillkommer därför som FAIL
utöver de två tidigare datafelen. De äldre räkneuppgifterna nedan är historik.

Readiness-kommandot använder nu samma validering som webbappen och kan skapa
en ny Obsidian-arbetslista. Det stoppar klarbesked vid saknad/felaktig fullrapport,
framtidsdatering, okända fält, felaktiga räknare eller overifierad aktivitet.
En korrekt PASS-status med varningar är giltig men fortfarande blockerad.

Rapportpar och arbetslista: `reports/readiness/2026-09-04/`. Rapportparet kommer
från `production-check --no-publish` och motorns befintliga rapportserializer;
de tidigare runtime-statusfilerna och databasens innehåll har inte ersatts.
En separat arbetsnota finns också i aktivt valv under
`00 Start/DivineList - arbetslista 2026-09-04.md`. Noten är ett planeringsunderlag,
ingen datacutover eller ny mänsklig review.

Nästa kvarvarande leveranser, i ordning:

1. Förnya verifieringen av den generationsbundna backupen och dess återställning.
   Acceptans: aktuell `backup_restore=PASS`; gamla bevis får inte få nytt datum.
2. Mänsklig granskning och nytt giltigt underlag för de två undertryckta arbetsställena.
   Acceptans: inga protokollogiltiga senaste audits; historiken ska finnas kvar.
3. Komplettera sid-, renderings- och täckningsevidens där det finns verkliga underlag.
   Acceptans: kandidatgrindens faktiska kriterier uppfylls utan ändrad policy.
4. Behandla 30 karantänposter, två historiska artefaktluckor och regelkalibreringen
   med dokumenterade mänskliga beslut; fortsätt därefter med Obsidian- och hjälpmedels-QA.

### Historisk status 2026-09-01

DivineList-appen och kontrakten är verifierade. Runtime-ledgern
innehåller en historisk avgränsad evidenspilot på tre företag, men den senaste
read-only beräkningen mot aktuell runtime är `FAIL / NO-GO` med 2 `FAIL` och 3
`WARN`. Reconciliation är `BLOCKED` medan färsk `backup_restore` är `PASS`.
Planen skiljer därför appkvalitet, datakvalitet,
mänskligt ansvar och ett framtida cutover-beslut.

## Mål och definition av klart

DivineList är redo för verklig intern användning först när systemet kan ta emot ett
redan insamlat, tillåtet och versionsbundet snapshot, skapa reproducerbara
resultat, visa osäkerhet utan säljöverdrifter och låta en människa välja högst tre
starka rotorsaker per företag. Produktionsklar betyder inte automatisk kontakt.

Följande måste samtidigt vara sant:

1. `npm run check`, Python `compileall` och samtliga motortester är `PASS`.
2. Alla 23 produktionskontroller finns och deras räknare och booleanska slutsatser
   är internt konsekventa.
3. `productionCandidate=true`, inga hårda `FAIL` finns och varje kvarvarande
   `WARN` har ett dokumenterat mänskligt beslut.
4. En färsk signerad V4-backup finns på annan fysisk disk och ett matchande
   restore-test är `PASS`.
5. Minst ett litet, representativt piloturval har tillräcklig sidtäckning,
   rendering och evidens för avgörande utfall.
6. Alla fynd som ska användas har versionsbundna mänskliga reviews; inget
   `blocked`, `failed`, `not_tested` eller negativt kandidatutfall presenteras som
   ett problem.
7. Staging har kontrollerats manuellt i Obsidian och ett separat cutover-beslut har
   fattats. Kontakt kräver därefter ett eget uttryckligt beslut per företag.

## Hårda restriktioner

- Den tidigare spärren mot varje ny offentlig webbplatsöppning är ersatt för
  källresearch inom det nya lokala mandatet. Runtimebaserad insamling/evaluering
  följer fortfarande sina egna grindar; ingen CAPTCHA, inloggning eller annan
  åtkomstspärr får kringgås. Den historiska piloten är inget generellt crawler-
  eller runtime-skrivtillstånd.
- Ingen e-post, SMS, formulärkontakt, publicering, deploy eller automatisk
  kontaktkö får skapas.
- Aktivt Obsidian-valv får inte ersättas, rensas eller konfigureras om utan ett
  separat cutover-godkännande.
- Historiska audit-, review-, kalibrerings- eller karantänposter får inte raderas
  eller skrivas om. Nya beslut är append-only.
- Saknade artefakter, fakta eller evidens får inte återskapas genom gissning.
- AI får inte agera mänsklig reviewer, lösa karantän eller godkänna kontakt.
- Git får inte beskrivas som en återställningspunkt: appkatalogen saknar commit och
  remote och består för närvarande av ospårade filer; motorkatalogen är inte ett
  Git-repository.
- Tillgänglighetsgranskningen är inte en WCAG-certifiering. Skärmläsare,
  webbläsarens riktiga zoom och ett fullständigt tangentbordsflöde kräver mänsklig
  slutkontroll.

## Fas 0 – lås nuläget

Status: **nuläget dokumenterat; releasegrinden är NO-GO**.

- Kod: 85 DivineList-tester och motorns sammanslagna svit med 265 tester
  passerar. Append-only-protokollet `foretagskarta.workplace-event.v1` ingår.
- Runtime: 25 företag, 25 arbetsställen och 17 webbplatsposter.
- Export: 8 behöriga och 17 exkluderade med explicita orsaker.
- Resultat: 960 totalt; 0 avgörande, 49 `needs_review`, 911 `not_tested`.
- Kandidat-usability använder inte alla 960 poster som nämnare. Dess korrigerade
  scope är 400 kandidat-/automated-körningar: 30 `needs_review`, 370
  `not_tested` (92,5 procent) och 0 avgörande.
- Körstatus: 880 `partial`, 80 `blocked`.
- Mänskligt arbete: 49 pending reviews, 30 öppna karantänposter och 0
  kalibrerade regler.
- Kontakt/annonsering: 0 kandidater; outreach och cutover är fortsatt false. Den
  separata lokala annonseringskön är fail-closed och tom.
- Aktivt valv: den tidigare V2.3-baslinjen blev inaktuell under en separat,
  samtidigt aktiv Codex-uppgift som skrev i legacyruntime och manuellt
  review-underlag. Snapshot 2026-08-31 21:40 svensk tid är 13 108 filer,
  163 551 768 byte och
  `sha256:0877b25468cec0638b8c8eff968964d8238777f682b58612eb33e83258744dcf`.
  Ändringarna har inte raderats eller skrivits över av DivineList-arbetet.

Senaste read-only status har två hårda fel: två protocol-invalid-latest-
undertryckningar samt kandidat-usability med 0 avgörande. Varningarna är två saknade legacy-resultatreferenser, 30
öppna karantänposter och 0 kalibrering.

Den färska helt skrivskyddade kontrollen ger `backup_restore=PASS`. Det är inte
ett cutover-godkännande och måste verifieras om efter varje runtimeändring.

De persistenta UI-filerna `production-check-latest.json` och
`production-check-latest.full.json` är från cirka 21:44 svensk tid och visar 18
`PASS`, 2 `FAIL` och 3 `WARN`. De är äldre än aktuell runtime och är därför inte
acceptansbevis för det senaste tillståndet. `docs/PRODUCTION_V2.md` redovisar
skillnaden uttryckligen.

## Fas 1 – fail-closed status och UI

Status: **klar i kod; manuell hjälpmedels-QA återstår**.

- Statusimporten kräver alla 23 V2.3-kontroller, stoppar dubbletter och okända
  strukturfält och räknar själv `FAIL` och `WARN`.
- Helhetsstatus följer motorns verkliga kontrakt: `FAIL` om minst ett hårt fel
  finns, annars `PASS`; varningar styr `cutoverReady`, inte helhetsstatusen.
- `productionCandidate` och `cutoverReady` måste exakt motsvara räknarna.
- Påstådd extern aktivitet, kontakt eller cutover kräver verifierade
  aktivitetspåståenden.
- Statusformatet är explicit `foretagskarta.production-status.v1`. Den
  UI-importerbara sammanfattningen får vara högst 256 000 UTF-8-byte och binder
  den separata fulla diagnostikfilens exakta byteantal och SHA-256.
  Fullrapportens UI-gräns är 16 000 000 byte, och appen verifierar dessutom
  exakt filnamn och hela den tillåtna fullrapportstrukturen.
- Färskhet och 24-timmarsutgång räknas om vid timeout, fönsterfokus och
  visibility change. Request-ID:n stoppar långsamma äldre filläsningar från att
  skriva över nyare importresultat.
- Ett separat utkast bevaras per granskningsbeslut. Dataset-/sessionsimport
  stoppas när beslut eller utkast är osparade, och en nedladdad session räknas
  som sparad först efter uttrycklig användarbekräftelse.
- Regelbiblioteket visar exakt 20 regler per sida. Global hopp-länk,
  huvudlandmärke, kontrollerad fokusåtergång, starkare fokusmarkering,
  förbättrad kontrast, 320px reflow, navigationsnamn, live-region och CSP-nonce
  ingår i de verifierade UI-/smoke-kontrakten.

Stoppvillkor: en statusfil som saknar en enda obligatorisk kontroll eller har
inkonsekventa räknare får inte visas som giltig.

## Fas 2 – backup och återställning

Status: **historiskt PASS för en äldre generation; aktuell witness är FAIL**.

- `C:` och `D:` ligger på samma fysiska NVMe och får inte behandlas som separata
  diskfelsskydd.
- `Z:` är en separat fysisk SATA-disk och är vald som backup-root.
- Signerad V4-backup:
  `Z:\WebDesignPartner\Foretagskarta\backups\post-evidence-pilot-20260831-20260831T212652794223Z`.
- Databas-SHA:
  `sha256:5189f0fb452ec96e331f8c3080d84c226c6b0b136a89d838e35e0f593a10c59f`.
- Logiskt fingeravtryck:
  `sha256:e90676e94e98ef2606e53b412c66f977487bb04eb89e08b92d06daec7a60a27d`.
- Matchande restore-test
  `restore-0f593a10c59f-20260831T212716140003Z` var `PASS` för den bundna
  post-pilot-generationen. Det är historiskt bevis, inte nuvarande witness.

Stoppvillkor: runtime måste först stabiliseras. Därefter kräver den nya
databas-/artefaktgenerationen en ny backup och ett nytt restore-test; ett äldre
vittne får inte återanvändas eller märkas om som aktuellt.

### Pre-cutover reconciliation

Den verifierade PLAN-only-filen är
`C:\Users\cozys\AppData\Local\WebDesignPartner\Foretagskarta\artifacts\runtime-reconciliation-v1-20260831T213417Z-target-3b029002a9b1.json`.
Den är `BLOCKED` med `applySupported=false`, `safeToApply=false` och
`automaticMergeRows=0`. Planen redovisar 12 `identical`, 27
`append-only`/`target-preserved`, 4 `transform-required`, 3 `conflict`, 3
`blocked`, 433 source-only-rader, 8 632 target-only-rader och 15
PK-kollisioner.

`planHash` är
`sha256:3956f20d7c7ee6e41fed1a6542aa24558c0d38b16c970e962e2194c4e0deb40d`
och filens SHA-256 är
`sha256:9fe129a9c5316afef8c054ec3d2b687183d0f866cb5cf65e4afce7b527eb4da6`.
Ingen APPLY, automatisk merge eller cutover får ske från detta underlag.

## Fas 3 – reparera datagrinden utan nätverk

Status: **delvis blockerad av saknade original och mänskliga beslut**.

1. Bevara de två protokollogiltiga legacy-auditerna. Skapa först efter legitimt
   underlag en ny exakt V2.3-audit för respektive arbetsställe.
2. De två saknade legacy-resultatfilerna finns inte i nuvarande runtime eller
   kända verifierade backuper. Markera dem som historiskt oåterverifierbara; skapa
   inte ersättningsbytes.
3. Granska de 30 karantänposterna en i taget. Varje beslut kräver exakt ID,
   källhash, motivering och namngiven mänsklig reviewer.
4. Kontrollera de 49 pending review-behoven. Ett beslut måste vara bundet till
   företag, regelversion, inputhash, evidens och utvärderingstid.

Acceptans: inga historiska rader har skrivits om, inga saknade fakta har hittats på
och produktionsrapporten redovisar varje kvarvarande osäkerhet öppet.

## Fas 4 – separat auktoriserad evidenspilot

Status: **genomförd inom tre-företagsgränsen; acceptanskraven uppnåddes inte**.

Den bevarade runtime-ledgern visar exakt tre manuellt valda företag i denna
tidigare arbetsvåg. Den aktuella implementationen och ledgern visar att collectorn
respekterade robots, höll sig till verifierad host och högst en `www`-alias, följde
högst fem säkra redirects och använde enbart anonyma `GET`/`HEAD`. Ingen spärr
kringgicks:

- Lilys Florabar blev `BLOCKED` med `access_challenge_detected`.
- OMNIA Hälsoklubb blev `BLOCKED` med
  `redirect_target_requires_identity_review`.
- Vallgatans Skomakeri blev `NEEDS_MANUAL_REVIEW` och tillförde fyra fakta och
  fyra evidensposter. En regelpost har accepterad evidens, men är fortfarande
  `human_required`, `partial`, `degraded` och i skuggläge.

Efter ny exakt V2.3-export och import innehåller körningen fortfarande 0 avgörande
resultat, 49 `needs_review` och 911 `not_tested`. Piloten gav alltså bättre lokal
proveniens för Vallgatans men klarade inte datagrinden och gav inget underlag för
annonsering eller kontakt.

Pilotens datakrav:

- verifierad Göteborgsidentitet och arbetsställe-/site-ID;
- fångsttid, sida, scope, collector/version och käll-URL per evidenspost;
- deklarerad sidtäckning och renderingens kvalitet;
- hashad artefakt när en regel kräver HTML, skärmbild eller verktygsresultat;
- minst ett avgörande, evidensbundet resultat och högst 50 procent `not_tested` i
  den förseglade pilotbatchen;
- inga `blocked` eller `failed` resultat i den del som ska användas.

Stoppvillkor: nätverksspärr, identitetsosäkerhet eller otillräcklig evidens stoppar
företaget; kvoten fylls inte med sämre kandidater. Dessa stoppvillkor utlöstes och
respekterades i piloten. Dokumentationen i sig är inte bevis på vem som godkände
den historiska körningen. Ingen webbplats öppnades i den efterföljande
härdningsfasen. Det historiska kravet på nytt ja för varje offentlig källkontroll
ersätts av mandatet ovan; en runtimecollector och dess DB-skrivningar omfattas
inte automatiskt av den nya lokala planeraren.

## Fas 5 – mänsklig kalibrering

Status: **inte startad; människa krävs**.

- Granska verifierade kandidatfynd blint mot underlaget.
- Registrera true positive, false positive och osäkert med motivering.
- Mät precision, falsk-positiv-andel, andel gammal evidens, blockeringsorsaker och
  faktisk granskningstid per rotorsak.
- Aktivera aldrig en regel genom att ändra gammal historik eller sänka en grind.
  En ändring kräver ny regel-/policyversion, tester och explicit godkännande.

Acceptans: viktiga regler har tillräckliga versionsbundna reviews och inga
automatiska policyändringar har skett.

## Fas 6 – manuell Obsidian-QA

Status: **inte genomförd i aktivt valv**.

Öppna endast stagingprojektionen och kontrollera:

1. startsida, länkar, backlinks, sökning och Bases;
2. Canvas-noder, länkar och räknare;
3. svenska tecken, långa företagsnamn och tomma/okända fält;
4. skillnaden mellan observation, slutsats, begränsning och mänskligt beslut;
5. att `do_not_contact`, osäker identitet och blockerade kontroller inte kan hamna
   i en kontaktvy;
6. att AI-prompten inte kan smuggla in reviews eller kontaktgodkännande.

Acceptans: en människa signerar stagingens generationshash och dokumenterar varje
avvikelse. Ingen aktiv-vault-skrivning ingår.

## Fas 7 – tillgänglighets- och användbarhets-QA

Status: **automatiserad del klar; manuell del återstår**.

- Kör hela flödet enbart med tangentbord och kontrollera fokusordning och
  återgångsfokus.
- Kör NVDA på Windows och kontrollera rubriker, landmarks, live-regioner,
  fältfel, statusbadges och progressvärden.
- Verifiera 200 och 400 procent med webbläsarens riktiga zoomkontroll.
- Upprepa filimport, valideringsfel, granskningsbeslut, export och statusimport.

Acceptans: inga kritiska eller höga tillgänglighetsfel; medel/låga fel har
dokumenterad disposition. Detta får fortfarande inte beskrivas som certifiering.

## Fas 8 – cutover och drift

Status: **kräver separat uttryckligt godkännande**.

Först när tidigare faser är godkända:

1. bekräfta att runtime är stabil och skapa därefter en ny separat-disk-backup
   med matchande restore-test;
2. frys en exakt releasekandidat och verifiera alla hash-/versionskontrakt;
3. ta ett separat beslut om aktiv-vault-cutover;
4. behåll rollbackväg och legacydata tills den nya generationen har verifierats;
5. kör en intern användningsdag utan kontakt;
6. godkänn därefter högst tre kontaktkandidater manuellt, om användaren separat
   vill starta outreach.

Rollback: stoppa nya importer, återställ den senast verifierade generationen,
bevara append-only-loggarna och kör full produktionskontroll innan fortsatt drift.

## Kända begränsningar som inte kan kodas bort

- Algoritmerna bedömer importerade fakta; de kan inte bevisa vad som aldrig
  samlades in.
- En webbplats är dynamisk. Ett snapshot kan bli gammalt och får inte beskrivas
  som permanent sanning.
- Automatiska tillgänglighets-, SEO- och prestandaverktyg hittar bara delar av
  verkliga problem; mänsklig kontroll behövs.
- Ett tekniskt fynd bevisar inte köpbehov, affärseffekt eller att företaget vill
  bli kontaktat.
- Hashar visar innehållsdrift, inte vem som skapade data eller att påståendet är
  sant. Digital signatur och identitetssäkring finns inte i nuvarande format.
- OneDrive-katalogen och avsaknaden av en riktig Git-baslinje begränsar säkra
  återställningar och spårbar kodreview.
- En annan Codex-uppgift eller legacyprocess kan fortfarande ändra det aktiva
  valvet parallellt. Den maskinella produktionsgrinden validerar Canvas-struktur
  men låser inte hela valvträdet. Därför måste den andra uppgiften avslutas och en
  ny skrivskyddad valvbaslinje granskas före staginggodkännande eller cutover.

## Nästa tillåtna steg

Agenten fortsätter själv med offentlig källresearch, lokal identitetsbedömning,
skrivskyddad dedupe, arbetsplanering och avgränsad lokal kod/test enligt det nya
mandatet. `npm run plan:local-work` är en offlineplanerare, inte en provimport-
exekverare. Underlag kan förberedas utan att vänta på nya rutinbekräftelser;
osäkra kandidater parkeras och verkliga undantag redovisas samlat.

Separat återstår runtimegrindarna, mänskliga karantän-/reviewbeslut,
reconciliation, Obsidian-/hjälpmedels-QA och generationsbunden backup/restore.
En plan får inte ändra aktiva identiteter, registrera mänskliga beslut eller
utföra cutover. Saknad befogenhet för en sådan åtgärd stoppar den åtgärden,
inte oberoende säkert förberedelsearbete.
