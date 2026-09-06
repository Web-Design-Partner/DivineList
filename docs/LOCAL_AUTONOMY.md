# Lokal autonomi – agenten tar rutinbesluten

Mandat från användaren: 2026-09-04. Gäller DivineLists lokala förberedelsearbete.
Projektreglerna finns i [AGENTS.md](../AGENTS.md).

## Vad som har ändrats

Agenten behöver inte längre ett separat ja för varje offentlig källkontroll,
lokal identitetsbedömning, prioritering eller staging-/provimportförberedelse.
Den ska själv undersöka, fatta spårbara lokala arbetsbeslut och fortsätta med
nästa säkra steg. Osäker identitet parkeras; fel målgrupp kan uteslutas från det
aktuella urvalet utan att användaren behöver avgöra varje kandidat.

Det tidigare kravet på separat mänsklig identitetsbekräftelse för att fortsätta
just förberedelsearbetet är ersatt. Verkliga mänskliga auditreviews,
regelaktivering och runtimeacceptans är andra tillstånd och har inte ersatts.

## Tre tillståndsnivåer som inte får blandas ihop

| Nivå                      | Ägare och innebörd                                                                                                                               | Vad den inte ger                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Lokal förberedelse        | Agenten jämför källor, dokumenterar bedömning och planerar nästa steg.                                                                           | Ingen runtimeverifiering eller genomförd import.                   |
| Runtime och audit         | Befintliga identitets-, evidens-, snapshot-, hash- och policygrindar avgör behörighet. Mänskliga reviews måste vara verkliga och korrekt bundna. | Ingen automatisk kontakt eller annonsering.                        |
| Extern åtgärd och cutover | Kräver ett eget uttryckligt, avgränsat användargodkännande.                                                                                      | Kan inte härledas ur en agentstatus, poäng eller godkänd testsvit. |

En agentbedömning får varken låtsas vara en människas beslut eller smygskrivas
till runtimefält. Ingen höjd konfidens, ändrad verifieringsflagga eller sänkt
evidensgrind används för att undvika en fråga.

## Första implementerade steg: lokal arbetsplanerare

```powershell
npm run plan:local-work -- <seed.json> --at <ISO>
npm run plan:local-work -- <seed.json> --at <ISO> --observations <file>
npm run plan:local-work -- <seed.json> --at <ISO> --observations <file> --output <nytt-körnamn>
```

- Standardutdata är stdout; utan `--output` skapas ingen körkatalog.
- `--output` får endast skapa en ny katalog under
  `reports/autonomy/<nytt-körnamn>`. Befintliga körningar skrivs inte över.
- Planeraren har en egen strikt validator för V1-kandidatformatet. Det befintliga
  preflightkommandot är oförändrat och kan köras separat. Olöst identitet,
  manuell runtimegranskningsflagga och domänkonfidens noll bevaras.
- En valfri separat observationsfil innehåller agentens källstödda bedömningar
  och binds med hash till rätt kandidatunderlag. Den är agentägd förberedelse,
  inte en fil med runtimegodkännanden eller mänskliga reviewbeslut.
- Explicit `--at` gör planeringstidpunkten synlig. Den ersätter inte källans
  observationstid och förnyar inte äldre evidens.
- Kommandot gör inga nätverks- eller databasanrop. Det ändrar inte kandidatfil,
  runtime, reviewkö, annonseringskö, aktivt valv eller källkontrakt.
- Kommandot utför **inte en faktisk dry-run-import**. Det väljer och dokumenterar
  lokala nästa steg; det är inte en komplett autonom exekverare.
- Indata är högst 256 000 byte per fil. UNC-/enhetssökvägar och symboliska länkar
  stoppas; på Windows krävs projektets lokala enhet. Systemets egen molnsynkning
  styrs inte av planeraren. Ett skrivfel kan lämna en ny ofullständig rapportkatalog;
  då rapporteras den uttryckligen som partiell och inga äldre filer ersätts.

Den separata observationsfilen ska följa kommandots schema. Lägg inte in
mänskliga reviewers, godkännanden, privata uppgifter eller fria instruktioner.
Länkar och hashbindningar visar spårbarhet/innehållsdrift, inte automatiskt att
källuppgiften är sann, färsk eller bevarad som förseglad auditevidens.

### Planerarens tillstånd

| Status                    | Lokal betydelse                                                                                  | Agentens fortsättning                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `agent_ready_for_dry_run` | Det tillåtna lokala underlaget räcker för nästa provimportförberedelse.                          | Förbered en isolerad importplan; påstå inte att provimport har körts.              |
| `agent_research`          | Källunderlag eller avgränsning behöver kompletteras.                                             | Undersök tillåtna offentliga källor under en aktiv arbetsomgång.                   |
| `agent_deferred`          | Kandidaten är osäker eller kräver en gräns som inte kan passeras säkert.                         | Parkera med motivering och arbeta vidare med andra kandidater.                     |
| `agent_excluded`          | Kandidaten passar inte det fastställda urvalet eller bör inte föras vidare i lokal förberedelse. | Dokumentera skälet, behåll historiken och välj en annan kandidat inom samma scope. |

Planeraren lämnar inga rutinfrågor till användaren. En status som är redo gäller
endast förberedelsen: den är inte `verified_current`, `human_reviewed`,
`algorithm_ready` eller `outreach_authorized`.

## Så fortsätter agenten i praktiken

### Dokumenterad utredningspaus utan upprepade rutinfrågor

En observationspost får frivilligt innehålla `researchPause` med två
obligatoriska, icke-tomma textfält: `reason` (varför utredningen parkeras) och
`resumeWhen` (vilket nytt underlag som behövs). Detta är en bakåtkompatibel
utökning av det lokala observationsformatet, inte av V1-seed eller runtime.

Pausen kan enbart ge `agent_deferred`. Exakt dubblett, kontaktspärr och fel
kommun har fortsatt företräde och ger `agent_excluded`. Identitetsuppgifter
behålls oförändrade; olösta fakta behöver inte märkas som en bevisad konflikt
bara för att undvika en upprepad utredning. Skäl och återöppningsvillkor binds
in i observations- och planhash och visas i arbetsrapporten.

En ny körningstid häver inte pausen. Agenten måste först ha nytt relevant
underlag, pröva det och skapa en ny observationsversion utan pausen innan
vanliga färskhets-, identitets- och spärrkontroller åter kan ge agentklar
status. Att bara ta bort pausen kringgår inga andra grindar. Det är ingen
schemalagd bevakning eller automatisk återstart.

Pausade poster väljs aldrig till provimport, men hindrar inte att andra klara
poster i samma paket provas. Historiska observationer och rapporter bevaras.

### Implementerat nästa steg: riktig provimport i minnet

Det separata kommandot använder den befintliga Python-importören på en
SQLite-kopia som endast finns i arbetsminnet. Detta är en verklig simulering
av importbeteendet, inte bara en plan eller validering av JSON-formatet.

```powershell
npm run dry-run:company-seeds -- <seed.json> --observations <file> --at <ISO> --engine-root <lokal-motor> --source-db <lokal-SQLite> --python <lokal-python.exe> --output <nytt-körnamn>
```

- Endast originalposter med agentstatus `agent_ready_for_dry_run` väljs.
  Inga organisationsnummer, godkännanden eller höjda verifieringsfält injiceras.
- Ingen klar kandidat ger BLOCKED före databasöppning. En osäker kandidat
  hindrar inte simulering av en annan klar kandidat.
- Källan öppnas med `mode=ro` och `query_only=ON`. Importörens normala
  anslutnings-/migrerings-/CLI-väg används aldrig för den aktiva databasen.
- Granskad motorkod och migrationsfiler binds med exakta hashvärden. Endast
  verifierade källbytes exekveras; gammal bytekod i motorns cache används inte.
  Vid motoruppdatering krävs ny granskning och tester, inte automatisk ompinning.
- Databasschemat måste motsvara det granskade V2.3-schemat. Inga migrationer
  eller automatiska reparationer utförs i källan eller minneskopian.
- Alla tre kontaktspärrytor kontrolleras. DNC eller aktiva suppressioner
  blockerar konservativt eftersom fullständig kandidat-/kontaktmappning inte
  kan antas. Detta är inte en kontroll av andra CRM eller spärrregister.
- Importören körs med köläggning avstängd. SQL-skydd blockerar andra databaser,
  schemaändringar och skrivningar till exempelvis kontakt-, audit- och skanningsköer.
- Första simuleringen får bara lägga till väntande, olösta kandidatposter.
  Ändring av befintliga verksamhetsrader eller identitetskonflikt ger BLOCKED.
- En andra simulering använder samma stabila källnamn men en sekund senare
  simulerad klocka. Den får inte skapa dubblettföretag eller nya källobservationer.
  Ändrade tidsstämplar och intern nummerföljd redovisas som verkliga skillnader.
- Samtliga tabeller jämförs via radnycklar och hash. Befintliga privata radvärden
  skrivs inte till rapporten. Källans logiska innehåll och DB-/sidfilhashar
  kontrolleras igen efter körningen. Drift ger BLOCKED, inte ett falskt PASS.
- SQLite kan använda OS-lås och SHM-läsmarkörer även med en skrivskyddad
  anslutning. Rapporten intygar inte frånvaro av varje OS-skrivoperation.
  En ändrad sidfil gör körningen blockerad. WAL utan befintliga sidfiler
  stoppas före öppning; immutable-läge som kan ignorera WAL används inte.
- Processen har storleks- och tidsgränser och inga nätverksanrop. Nätverkssökvägar
  och symboliska länkar stoppas. Motorns och databasens sökvägar får inte heller
  passera Windows-reparsepunkter. Systemets egen molnsynkning styrs inte här.
- `--output` skapar bara ett nytt körnamn under `reports/import-dry-run`.
  Utan flaggan blir det endast JSON i stdout. Befintliga rapporter bevaras.
  Rapportskrivfel kan lämna en uttryckligen redovisad partiell ny körkatalog.

Provimporten är fortfarande inte en runtimeimport, algoritmkörning, insamling
av webbsidor, mänsklig review, kontakt, annonsering eller publicering. Företaget
räknas inte som tillagt i det aktiva inventariet efter denna simulering.

Körda exempel och exakta resultat finns i
[packet-001-provimporten](../reports/import-dry-run/2026-09-04-packet-001-verified/IMPORT_DRY_RUN.md).
Kommandots Node-tester körs med `npm run test:import-dry-run` och ingår i
`npm run check`. Den separata Python-sviten körs med en explicit lokal Python:
`<python.exe> -B -I tests/test_import_dry_run.py`.
Den senare kräver den granskade externa motorkatalogen och redovisas separat;
enbart den vanliga appkontrollen bevisar inte att Python-sviten har körts.
Testmotorn kan anges med `DIVINELIST_TEST_ENGINE_ROOT`; testerna använder endast
egna syntetiska temporära databaser, aldrig den aktiva databasens innehåll.

### Sammanhängande provimport av flera små paket

Det nya sekvenskommandot provar **en till tre paket i samma minneskopia**.
Gränsen på högst tre kandidater per ursprungligt seedpaket är oförändrad.
Hela paketföljden körs först en gång och upprepas sedan i samma kopia.

```powershell
node scripts/dry-run-company-sequence.mjs <manifest.json> --at <ISO> --engine-root <lokal-motor> --source-db <lokal-SQLite> --python <lokal-python.exe> --output <nytt-körnamn>
```

Manifestet har version `divinelist.import-sequence-manifest.v1` och en ordnad
lista `packets`. Varje post måste ha `packetId`, `seedPath`, `seedSha256`,
`observationsPath` och `observationsSha256`. Filvägar tolkas från kommandots
arbetskatalog; absoluta lokala sökvägar går också bra. Inga nätverkssökvägar
eller symboliska länkar tillåts. Kontrollsummorna avser filernas exakta byte.

- Varje originalpaket går genom samma strikta validator och aktuella
  agentplanering som en enskild provimport. Olösta runtimefält bevaras.
- Alla paket måste tillhöra samma makrovåg. Paket-ID:n måste vara unika;
  kandidat-ID eller normaliserad domän får inte överlappa mellan valda poster.
- Ett paket utan någon agentklar post stoppar hela begäran före arbetaren.
  Det hoppas inte tyst över. Parkerade poster i ett i övrigt klart paket
  ligger däremot kvar i planen och importeras inte.
- Paketordning och varje pakets input-/planhash binds till sekvensrapporten.
  Ändrade filer kräver nytt granskat manifest, inte automatisk ombindning.
- Varje steg visar före-/efterhash och radskillnader. Senare paket får inte
  ändra tidigare paket eller befintliga företagsrader. En ny post måste skapa
  exakt ett nytt företag, arbetsställe, webbplats och källobservation.
- Återspelning får inte skapa nya företag eller källobservationer. Tillåtna
  tidsstämpel- och nummerföljdsändringar redovisas uttryckligt.
- Stopp i ett senare paket ger inget helhets-PASS. Redan simulerade steg
  redovisas som delresultat, aldrig som aktiva importer.
- Samma kodpinnar, schemaspärrar, kontaktspärrar, SQL-skydd, storleksgräns,
  tidsgräns och källkontroll gäller som för enkelpaketet ovan.

Sekvensen skapar bara en ny rapport under `reports/import-dry-run`; utan
`--output` blir det endast JSON-utdata. Den skriver inte i aktiv DB, köer
eller valv och ger inte import-, review-, kontakt- eller annonsbefogenhet.
Historiska enkelpaketsrapporter är kvar och får inte beskrivas som om de
redan hade verifierat hela paketföljden.

De nya Node-testerna ingår i den befintliga autonomi-/releasekontrollen.
Python-sviten innehåller separat sekvenstestning med egna syntetiska databaser.

### Arbetsordning

1. Läs senaste relevanta underlag och kontrollera lokala instruktioner.
2. Behåll befintliga inventarie-, segment- och dataminimeringsgränser. Högst tre
   nya kandidater per seedpaket; fyll inte kvoter med osäkra identiteter.
3. Jämför offentliga källor och kontrollera namn, publik verksamhetsadress,
   domänrelation och filialavgränsning. Skilj observation från slutsats.
4. Dokumentera agentens bedömning separat från det oförändrade seedpaketet.
5. Generera en lokal arbetsplan, kontrollera dess bindningar och fortsätt med
   det nästa säkra steg som faktiskt stöds av implementationen.
6. Parkera en blockerad kandidat och fortsätt inom det befintliga urvalet.
   Redovisa orsaken i en samlad undantagslista, inte i en ny fråga per kandidat.
7. Sammanfatta vad som gjordes, vad som bara förbereddes, vad som verifierades
   och vilka verkliga befogenhetsgränser som återstår.

Att research inte omedelbart ger ett svar är inte i sig ett användarbeslut.
Kontrollera tillgängliga säkra källor, behåll `Unknown - needs verification` när
de inte räcker och välj annan tillåten lokal aktivitet.

## När en fråga faktiskt behövs

Fråga endast om arbetet behöver ny befogenhet eller ett materiellt målval, till
exempel att ändra pilotens målgrupp till en annan marknad. En kandidat med fel
segment ska normalt parkeras eller uteslutas; den kräver inte att hela arbetet
pausas för ett målgruppsbeslut.

Följande ingår inte utan separat uttryckligt godkännande: verkliga runtime- eller
live-DB-skrivningar, deploy, kontakt, externa meddelanden, annonsering,
publicering, köp, konto-/inloggningsåtgärder, hemligheter, destruktiva åtgärder,
cutover eller ändringar i aktivt Obsidian-valv. DNC och suppression får inte
tas bort. En plan kan beskriva sådana behov men inte utföra dem.

Ny lokal kod kan byggas och testas inom uppdraget. Den separata provimporten
ovan har skydd för databasval, skrivmål och exakt diff. Arbetsplaneraren
utför inte själv den simuleringen. Ingen av funktionerna ger tillstånd att
importera i den aktiva databasen.

## Vad som uttryckligen är oförändrat

- V1-seedpreflight, DivineLists V2.3-kontrakt och runtimegrindar.
- Obligatorisk evidens, rendering, sidtäckning, färskhet och exakta hashbindningar.
- Mänskligt ägda auditreviews, karantändispositioner och regelaktivering.
- Annonserings- och kontaktgränser, DNC och bevarad historik.
- Aktivt valv, minnesfiler och runtimeidentiteter.

Historiska rapporter behåller tidigare beslut och körresultat. Smala tillägg
markerar vilka äldre rutinfrågor det nya mandatet ersätter. Det nya mandatet
skapar ingen bakgrundsautomation: agenten arbetar autonomt under aktiva
arbetsomgångar, inte osynligt efter att uppgiften avslutats.
