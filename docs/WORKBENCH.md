# Så använder du den lokala arbetsytan

Uppdaterad 4 september 2026. Detta flöde arbetar på redan sparat underlag.
Det öppnar inga företagswebbplatser och ändrar ingen aktiv databas eller något
aktivt Obsidian-valv. En fungerande arbetsyta är inte produktionsgodkännande.

## Börja här

Denna byggleverans är startad på `http://127.0.0.1:3000/`. För att senare
återstarta på samma adress används `node scripts/start-local.mjs --port 3000`.
Standardstarten i README använder annars port 8787 och därmed separat
webbläsarlagring.

1. Starta med den befintliga säkra Windows-starten i README. Använd samma
   webbläsare och samma adress varje gång; `localhost` och `127.0.0.1`, eller
   olika portar, har separata lokala arbetskopior.
2. I **Arbetsyta**, välj **Öppna företagsunderlag** och öppna
   [den skrivskyddade företagslistan](../reports/workbench/phase-1-inventory-final-20260904.json).
   Den innehåller 25 arbetsställen, inte 25 färdiga analyser.
3. Sök fram ett företag. Vyn skiljer **kodkoppling saknas**, **observation
   saknas** och **underlag som fortfarande behöver kontrolleras**.
4. Under **Obsidian & import** kan du läsa en befintlig V2-batch med explicit
   bedömningstid, eller öppna en granskningssession från en lokal körning.
   Företag kopplas bara när både arbetsställe och domän matchar.
   Ett redan verifierat exempel på den riktiga, fortfarande ofullständiga
   åttaföretagsbatchen finns som
   [återöppningsbar granskningsfil](../reports/local-runs/activation-20260904/review-session.json).
5. Aktivera **lokalt autosparande** om du vill behålla session och ofärdiga
   utkast i denna webbläsare. Efter omladdning väljer du **Återställ sparat
   arbete**. Återställning sker inte automatiskt över ett pågående arbete.
6. Hämta separat granskningsfil och Obsidian-arbetskopia när arbetet ska
   flyttas eller arkiveras. En Markdown-fil är en arbetskopia, inte ett
   databasbeslut eller tillstånd att kontakta företaget.

Färsk skrivskyddad produktionsdiagnostik från denna leverans finns separat som
[sammanfattning](../reports/activation/2026-09-04/current-readonly-exact/production-check-latest.json)
och [fullrapport](../reports/activation/2026-09-04/current-readonly-exact/production-check-latest.full.json).
Öppna först sammanfattningen och sedan fullrapporten under **Obsidian & import**.
Rapporten visar 19 PASS, 2 FAIL och 2 WARN, inte produktionsgodkännande. Åldern
kontrolleras i appen; filerna förnyas inte automatiskt.

Den äldre filen `phase-1-inventory-20260904.json` är bevarad historik från före
den sista sididentitetsrättningen. Den har en annan adapterbindning och avvisas
av den nya läsaren; använd filen med `final` ovan. Historiska original skrivs
inte om för att passa en ny kodversion.

## En sammanhållen lokal analyskörning

Det separata kommandot använder samma befintliga regler och validatorer som
appen. Det producerar det förseglade resultatet; UI är fortfarande en tydligt
märkt förhandsvisning. Använd direkt Node-anrop för flaggor på denna Windows-
installation:

```powershell
node scripts/run-local-audit.mjs "C:\sökväg\batch.json" --at "2026-09-04T14:28:00Z" --run "min-korning-001"
```

Byt fil och bedömningstid till det avsedda underlaget. Tidpunkten ska vara
explicit och inte framtida. Upprepning av samma körnamn kräver exakt samma
originalbytes, bedömningstid och policy. Kommandot finns också som
`npm run run:local-audit`, men direkt Node-anrop undviker npm:s flagghantering.

```text
Giltig originalbatch
       ↓
Validering + befintlig deterministisk analys
       ↓
reports/local-runs/<körnamn>/
  run-intent.json       ursprung, tid och policy
  input.batch.json      exakt oförändrade originalbytes
  result.sealed.json    förseglat batchresultat
  review-session.json   återöppningsbar session, inga nya beslut
  obsidian-workcopy.md  separat läs-/arbetskopia
  run-manifest.json     filhashar och verkliga utfallsräknare
```

`WORKFLOW_COMPLETED` betyder att paketet har skapats och kontrollerats. Det
betyder inte att alla kontroller kunde utföras, att företaget har fel eller att
produktionsgrinden är godkänd. Manifestet visar okända/partiella utfall och
`productionReady: false`. Runtimegrinden bedöms separat.

Samma körning kan verifieras igen utan att befintliga filer skrivs om. Efter
ett avbrott återupptas endast en exakt matchande delkörning. Fel filinnehåll,
okända filer eller ett kvarlämnat körlås stoppar arbetet; inga lås tas över och
inga tidigare filer ersätts automatiskt. Avbryt med Ctrl+C och behåll alla
delresultat för kontroll. Ett gammalt lås kräver först en riktig kontroll av
vilken process och körning det tillhör.

## Förnya inventariet utan databasändring

Ange lokala, explicita sökvägar. På denna dator finns Python i den medföljande
runtimekatalogen; förutsätt inte att `python` finns på PATH.

```powershell
& 'C:\Users\cozys\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -B -I scripts/export-workbench.py --source-db 'C:\Users\cozys\AppData\Local\WebDesignPartner\Foretagskarta\state\engine-v2.sqlite3' --engine-root 'C:\Users\cozys\Documents\Goteborgs-Foretagskarta-Engine' --output 'nytt-inventarium-001'
```

Detta skapar endast en ny fil under `reports/workbench`. Databasen öppnas
skrivskyddat med granskat schema, begränsad läsbehörighet och kontroll av
databasens och sidofilernas hash före/efter. Ingen motorkod körs eller
migration görs. Utan `--output` skrivs paketet endast till terminalen.
Uppdaterad inventarietid förnyar **inte** webbplatsobservationernas ålder.

## Skydd och begränsningar

- Inventariet kan innehålla upp till 10 000 arbetsställen och visas 25 åt gången.
  V2-analys behåller gränsen 100 företag och 4 500 000 byte; rekommendationen
  är 50 per batch. Det är två olika datamängder.
- Autosparande är valbart, högst 2 MB, och kräver webbläsarstöd för fliklås.
  Det är inte en separat diskbackup. Fullt utrymme, skadad kopia och
  flikkonflikt visas som stopp, aldrig som lyckat sparande.
- Autosparandet bevarar ofärdiga utkast. Den befintliga granskningsfilen
  innehåller registrerade sessionsbeslut, inte ofärdiga motiveringstexter.
  Gör inte ett utkast till ett mänskligt beslut bara för att kunna exportera
  det. Behåll då webbläsarkopian eller kopiera texten separat som ett utkast.
- Varken återställning eller nedladdning räknas som aktiv import, mänsklig
  kalibrering, regelaktivering eller kontaktbehörighet. En tidigare
  diskbekräftelse återställs inte automatiskt.
- Adaptern har fortfarande 17 faktanycklar. 10 av 50 kandidatregler har alla
  deklarerade faktanycklar mappade. Det är teknisk täckning, inte 10 godkända
  kontroller. OR-villkor och tillämplighet kan ibland avgöras med färre fakta.
- Nya observationer för titel, metabeskrivning och noindex kräver verklig
  HTML-observation; frånvaro av ett felmeddelande är inte ett positivt bevis.
  UTF-8 HTML, komplett entydig head, rätt HTTP-status och exakt sididentitet
  krävs. Oklar rendering, query-/fragmentvyer och motstridiga sidfakta får
  inte uppgraderas till säkra slutsatser.
- Tid och innehållshash binder observationen, men ersätter inte ett arkiverat
  HTML-original. Historiska insamlingar blir inte nyinsamlade av en kodfix.
- Filsäkerhet skyddar mot länkar, junctions och överskrivning. Node kan inte
  klassificera alla icke-omdirigerande Windows-molnattribut; detta står i
  körmanifestet. OneDrive är fortfarande inte en granskad versionshistorik.
- Appen har ingen generell databasanslutning, automatisk insamling eller
  schemalagd körning. Skärmläsargranskning, en verklig användningsdag och aktiv
  Obsidian-integration är separata återstående steg.

## Nästa beslutspunkt

Kodtest, lokal start och fungerande filflöde kontrolleras separat från det
verkliga pilotunderlaget. Behåll planens fas 3–6 öppna tills pilotens bevis,
mänskliga granskning, karantän, kalibrering, separat återställning och
Obsidian-staging faktiskt har verifierats. Sänk inte kraven för att få grönt.
