# DivineList Agentstation – leveransplan och kontrollpunkter

Beställning: användarens förbättrade byggprompt, 5–6 september 2026. Prioritet:
verklig företagsinsamling, Obsidian-skrivning, tillförlitlig agentkedja,
detaljerad pixelvärld och ett provstartat Windows-paket.

## Teknikval

Den fungerande React-stationen och dess lokala Node-server behålls. Obsidian
använder vanliga Markdown-filer; en avgränsad skrivkö ger integration utan
community-plugin eller ny extern kontotjänst. Canvas 2D ger sprites,
golvtexturer och animationer utan en större spelmotor. En liten Windows-startare
med medföljande Node öppnar programmet i vanlig webbläsare. Ollama och modellvikter
är separata beroenden. Samma modell används av flera roller sekventiellt.

## Etapper

| Etapp           | Leverans                                                        | Ägare                       | Godkänt när                                                  |
| --------------- | --------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------ |
| 1. Insamling    | GUI-start, kommunverifierad källa, 10 kandidater och råunderlag | Huvudagent                  | Faktiska källposter och deras osäkerheter visas i listan.    |
| 2. Obsidian     | Valvval, skrivkö, kort, rapporter och översikt                  | Obsidian-agent + huvudagent | Verkliga anteckningar återlästa; omkörning utan dubbletter.  |
| 3. Arbetsregler | Roller, resurser, konkreta kommandon och paus/återstart         | Huvudagent                  | Befintliga och nya relevanta beteendetester PASS.            |
| 4. Pixelvärld   | Sex sprites, gång/arbete/väntan, rum, motorer och bakgrund      | Grafikagent                 | Visuell kontroll, animation, mobil och minskad rörelse PASS. |
| 5. Windows      | ZIP, egen EXE, Node, filkontroller, start och avslut            | Paketagent                  | Det slutliga uppackade paketet startar och visar stationen.  |

Vald arbetsmapp, uttryckligen godkänd av användaren:
`C:\Users\cozys\Documents\Obsidian\Goteborgs-Foretagskarta\DivineList\Agentstation`.

## Baslinje och stoppvillkor

Före etappen: stationssviten 33 PASS och befintlig releaseattest PASS.
Klassiska V2.3-motorns identitets- och granskningsgrindar hör till en separat
driftberedskap. En grön stationsrelease betyder inte aktiv cutover.

Källfel dokumenteras och rättas i insamlaren. Inga fabricerade företag
ersätter saknat underlag. Kontakt, publicering, live databasimport eller
ändring av befintliga granskningsbeslut ingår inte. Grafiken visar verkliga
jobb och simulerar inga insamlade företag.

Slutlig provkörning dokumenteras i `docs/STATION_V2_VERIFICATION.md`.
Verkliga företagstest skiljs från syntetiska fel- och avbrottstester.
Ingen daglig kapacitet utlovas utifrån ett provurval på tio.
