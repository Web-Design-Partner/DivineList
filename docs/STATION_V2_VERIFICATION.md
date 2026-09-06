# DivineList Agentstation – verifierad leverans 6 september 2026

## Verklig företagskörning

Provkörningen startades genom programmets knapp **Starta Göteborgsresearch**.
Insamlaren hämtade verkliga OpenStreetMap-poster inom Göteborgs kommunområde,
bekräftat med SCB-kod 1480. Listan innehåller tio källbundna företagskandidater.
Ingen modell skapade företagsnamn eller källor.

| Utfall                    | Antal | Betydelse                                                                                              |
| ------------------------- | ----- | ------------------------------------------------------------------------------------------------------ |
| Källbundna kandidater     | 10    | Identitet, aktiv verksamhet och domänrelation behöver fortfarande granskas.                            |
| Webbplatsutkast           | 3     | Japan House, Preem och Paddingtons. Faktiska HTML-observationer och två lokala modellanrop per analys. |
| Åtkomsthinder             | 2     | Mariaplans Cykel-service och Hemköp Göteborg Stigbergstorget. Robots/åtkomst kunde inte kontrolleras.  |
| Webbplats saknas i källan | 5     | Tabeilu Sushi, Tanka, Handelsbanken, Backens servicebutik och Kalles. Ingen domän har gissats.         |

Lyckad insamling startade 00:38:08 svensk tid och gav tio kandidater efter
cirka åtta sekunder. Analyskön avslutades 00:40:07, cirka två minuter från
start. Detta mäter endast detta blandade provurval, inklusive parkerade
poster. Det kan inte räknas om till verifierade företag per dag.

Första försöken hittade två verkliga insamlingsfel: kommunens kartnamn var
`Göteborgs Stad`, och frågans tidigare minnesgräns på fjärrservern var för låg.
Insamlaren använder nu stabil kommunkod och en avgränsad fråga med tillräcklig
fjärrbudget. Ofullständigt källsvar ger tydligt fel. Fortsättningslogiken
filtrerar bort befintliga domäner/källor innan ett större mål fylls på.

Rått kartunderlag och tre HTML-original finns i stationens datamapp under
`evidence`, med innehållsbundna SHA-256-filnamn. Kartsvaret är 761 547 byte.
Motsvarande domän, tid och hash sparas med observationerna.

## Verklig Obsidian-skrivning

Användaren valde det befintliga DivineList-valvet och arbetsmappen
`C:\Users\cozys\Documents\Obsidian\Goteborgs-Foretagskarta\DivineList\Agentstation`.

Kopplingen sparades genom gränssnittet. Kontroll före/efter visade att detta
ensamt inte skapade filer i valvet. Ett nytt uttryckligt Start med befintligt
mål tio skrev automatiskt tio företagskort, tio rapporter, en översikt och
en startsida. Alla tio återlästes och fick klickbara länkar i programmet.

En andra skrivning genom **Skriv listan nu** gav tio oförändrade poster,
noll nya rapporter och identiska filhashar för samtliga 22 filer. Valvets sex
befintliga filer utanför Agentstation hade oförändrade hashvärden.

Bevis, inklusive källposter, återlästa sökvägar, filhashar och skärmbilder:
`work/station-v2-real-1788648921720/verification.json`.

Stationens kö, koppling och källartefakter kopierades därefter till en ny
`%LOCALAPPDATA%\DivineList\station-data` för Windows-programmet. Sex filer
kopierades med exklusivt skapande och hashkontroll. Utvecklingskopian behölls;
processlås kopierades inte. Bevis: `work/station-v2-migration.json`.

## Syntetiska kontroller

- Befintliga webbläsarflöden: åtta grupper PASS, med fristående syntetiska
  företag och modellresultat. `work/station-browser-qa/result.json`.
- Obsidian/UI: sju grupper PASS i ett tillfälligt valv. Konfiguration utan
  förtida skrivning, automatisk skrivning, paus/fortsätt, länkar, omkörning,
  bevarad manuell anteckning, full serveromstart och mobilbredd 390/320 px.
  `work/station-v2-browser-qa/result.json`.
- Pixelvärld: sju grupper PASS för gångvägar, arbete/vila, rollval, minskad
  rörelse och zoom. Arbetsstatus ersattes syntetiskt i testet; inga riktiga
  jobb kördes för att skapa rörelse. `work/pixel-before/behavior-check.json`.
- Inga JavaScript-fel, konsolvarningar eller externa webbläsaranrop i dessa
  gränssnittsprov. Serverns riktiga research gör separat uttryckliga nätanrop.

Manuell redigering under flera skrivningar, journalåterhämtning efter avbrott,
namnkonflikter, redigerad agentrapport, fil-/sökvägslänkar, parallella kontroller
och paus vid verkliga skrivfel testades också i separata tillfälliga mappar.
Detta är kontrollerade syntetiska felprov, inte observerade fel i användarens
verkliga valv.

## Skalbarhet

Skalbarhetsprovet med 500 syntetiska företag upptäckte 502 onödigt upprepade
manifestskrivningar vid oförändrad omkörning. Efter rättningen behövs två.
Ett ändrat företag bland 500 kräver sju manifestskrivningar för journal,
rapport och översikt. Alla 500 filer kontrolleras fortfarande genom
återläsning. Inga nya anteckningar skapas för oförändrat underlag.

## Slutlig releasekontroll

**PASS:** 313 automatiska tester, uppdelade i 142 auditkontroller och 171
release-/stationskontroller. TypeScript, lint, formatering, fullständigt bygge,
artefaktkontroll och faktisk startkontroll av den klassiska appen passerade.
Releaseattesten verifierades dessutom efter bygget.

- Bygg-id: `6d8d74ca-4659-4551-93a8-67eba4fba321`.
- Källfingeravtryck: `sha256:3c180e06351ef4f9c7070bba88ce55f2dd5b55380b3ad4aac9a5aaafdfa9c087`.
- Samlad logg: `work/station-v2-release-final.log`.
- Releaseattest: `dist/divinelist-release-check-v1.json`.

Båda webbläsarsviterna kördes igen efter sista gränssnitts- och skrivköändringen:
15 grupper PASS med inga JavaScript-fel eller konsolvarningar. Källfiler för
runtime, nätverk, server, gränssnitt och stilmall jämfördes med bevarad baslinje
under `work/station-v2-before`. Klassiska faktakontraktet behåller 128 fakta
och 120 regler.

## Verifierat Windows-paket

Slutleverans: `outputs/DivineList-Station-Windows-x64-2026-09-05T23-10-28-135Z-5a53.zip`,
34 465 411 byte. SHA-256:
`20229918f916296516bdf99ddb553674eb6d725adc2d685e1a54394c2882b70d`.

Paketet packades upp separat till
`%LOCALAPPDATA%\DivineList\releases\agentstation-2026-09-06-v2`.
Den riktiga `DivineList.exe` startade sin medföljande Node, verifierade
resurserna, svarade på HTTP och avslutade korrekt i leveransprovet. Bevis:
`work/package-final-v2-qa-d188abcff9684d4e8fb964ad5b936774/verification-summary.json`.

Samma EXE startades därefter normalt med den kopierade tiopiloten i programmets
standarddatamapp. Processkontrollen visade `node.exe` från just den uppackade
v2-mappen som server på port 8790. Följande verkliga GUI-kontroller passerade:

- Sparad lista med tio företag och vald Obsidian-mapp återställdes utan att
  ett uppdrag startade automatiskt.
- Skrivaren öppnade företagets källunderlag och dess Obsidian-länk.
- Skriv listan återläste samtliga tio kort. Alla 22 Markdown-filer behöll
  sina hashvärden och inga nya företagskort/rapporter skapades.
- En rådgivande order köades och startades från gränssnittet med riktig
  lokal `qwen3:4b`. Jobbet blev klart. Provets väntan plus efterkontroller
  tog cirka 17 sekunder. Det tillförde inga företagsfakta eller nya källor.
- Desktop och 390 px utan sidöverflöde eller JavaScript-fel.

Bevis och skärmbilder:
`work/station-v2-package-live-1788649918869/verification.json`.
En ny kontrollerad genväg **DivineList Agentstation** skapades i användarens
Startmeny och pekar på denna v2-EXE. Programmet lämnades igång med vilande kö.
Ollama, modellvikter och Obsidian finns separat på datorn och ingår inte i ZIP.

## Återstående avgränsningar

Företagskort och rapporter är lokala förberedelseutkast. Tre analyser är inte
tre oberoende verifierade affärsmöjligheter. Samma modell granskar sitt tidigare
utkast; kodens observationer och mänsklig granskning behövs fortfarande.

Röstinmatning är uppskjuten enligt beställningens prioritering. Fria skrivna
order ger rådgivande svar. Insamling och Obsidian-skrivning har egna konkreta
kontroller. Kontakter, publicering och ändringar på företagens webbplatser
ingår inte. Den klassiska V2.3-motorns aktiva driftgrindar har inte ändrats.

En första samlad releasekontroll fick ett övergående startfel i den klassiska
provservern. Alla 312 tester och bygget hade passerat. Separat startkontroll
och följande fullständiga releasekontroll passerade utan kodändring. Den
ursprungliga felorsaken är okänd; minnesbrist har inte belagts. Första
felrapporten bevaras i `work/station-v2-first-release-fail.json`.
