# Skeppet – DivineLists lokala agentstation

Skeppet är en lokal kontrollpanel för offentliga företagskandidater och
webbplatsutkast. Ett pixelskepp visar fem arbetsroller, transportband och dig som
kapten. Figurerna rör sig när arbetskön faktiskt körs; listor och loggar kommer
från sparat tillstånd. Stationen behöver inte ChatGPT för att användas.

Detta är en separat förberedelseyta. Ett stationsutkast är inte en godkänd
V2.3-batch, verifierad företagsidentitet, mänsklig review, aktiv regel eller
kontaktbehörighet. Den klassiska granskningsappen på port 8787 och dess
evidensgrindar behålls.

## Starta på datorn

Det portabla Windows-paketet startas genom att packa upp ZIP-filen och
dubbelklicka på **DivineList.exe**. Inga utvecklingsverktyg behövs. Läs
[Windows-guiden](PORTABLE.md) för paketets innehåll, beroenden och avslut.
Följande kommandon gäller utvecklingskopian.

Kör från den lokala projektmappen med Node.js och projektets installerade
beroenden:

```powershell
Set-Location -LiteralPath 'C:\Users\cozys\Documents\ChatGPT\DivineList'
.\run-station.ps1
```

Öppna **http://127.0.0.1:8790/**. Alternativet `npm run station` startar
stationen via projektets npm-kommandon. Vid ändrade stationsfiler byggs
stationspaketet med `npm run build:station`.

Windows-wrappern använder den förberedda portabla motorn på
`%LOCALAPPDATA%\DivineList\ollama-0.33.3\ollama.exe` om ingen Ollama-server
svarar på `http://127.0.0.1:11434`. Modeller för denna startväg ligger i
`%LOCALAPPDATA%\DivineList\models`. Wrappern startar motorn dolt, låser den
till loopback och sätter lokal körning med en laddad modell och en parallell
begäran. Om en Ollama-server redan svarar används den i stället; wrappern
ersätter inte dess inställningar.

Stationen är förberedd för **`qwen3:4b`**, men modellen måste finnas installerad
och visas i modellväljaren. Välj modellen på kommandobryggan. Maskinrummet visar
anslutningen och ledigt RAM samt kan kontrollera anslutningen igen. Om
Ollama eller modellen saknas förblir körkontrollerna inaktiva. Stationens
webbgränssnitt laddar inte ned modeller automatiskt.

Inget researchjobb startar när sidan öppnas. Datorn och stationsprocessen
behöver fortsätta köra under arbetspasset. Att stänga webbläsarfliken stänger
inte den separata serverprocessen. Stoppa kön i gränssnittet och avsluta
stationsprocessen med Ctrl+C när du är klar. Ollama-motorn har en separat
processlivslängd och kan fortsätta köras efter att stationen avslutats.

## Fem roller, en modell

| Roll        | Automatiska researchkedjan                                                             | En fri skriven order                           |
| ----------- | -------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Kaptenen    | Du väljer mål, modell och när kön får arbeta.                                          | Du skriver order till besättningen.            |
| Spanaren    | Kod hämtar kandidater från OpenStreetMap via Overpass.                                 | Den lokala modellen ger researchråd.           |
| Kartografen | Fasta regler normaliserar domäner och jämför dubbletter.                               | Modellen ger råd om struktur och identitet.    |
| Analytikern | Modellen skriver ett utkast utifrån observerade HTML-fält.                             | Modellen besvarar din skrivna analysfråga.     |
| Granskaren  | Samma modell jämför utkastet med samma observationer och lämnar ett korrigerat utkast. | Modellen ger granskningsråd.                   |
| Skrivaren   | Kod sparar utkastet och skriver/återläser Obsidian när kopplingen är aktiverad.        | Modellen skriver en rådgivande sammanfattning. |

Rollerna är arbetssteg med olika ansvar. Fem samtidiga modeller laddas inte.
Arbetskön är sekventiell: ett jobb, och högst ett modellanrop, behandlas åt
gången. Varje företagsanalys innehåller två modellanrop i följd, först
Analytikern och sedan Granskaren. Den andra bedömningen är **inte oberoende
verifiering**: samma modell kan upprepa samma misstag.

Den sparade sammanfattningens fakta sammanställs med kod från de ursprungliga
HTML-observationerna. Titel, sidbeskrivning, viewport-tagg och språkattribut
kontrolleras uttryckligt, så att modellen inte kan utelämna en observerad
metadatabrist. Åtgärdsförslag från modellen märks som AI-förslag att granska.
En saknad viewport-tagg i underlaget bevisar inte att mobilutseendet är fel.

Detta lades till efter ett lokalt syntetiskt kvalitetstest där modellen
missade två metadatabrister och eftergranskaren upprepade samma misstag.
Samma modells två roller är därför fortsatt ett stöd för utkast, medan
faktasammanfattningen och de grundläggande kontrollerna följer fasta regler.

Modellanropen använder 4 096 token kontext, högst 700 genererade token, låg
temperatur och avstängt utökat tänkande. Svaret måste följa ett begränsat
JSON-format med sammanfattning, förslag och osäkerheter. Ofullständiga eller
ogiltiga svar sparas inte som färdiga analyser. Det är format- och
resurskontroller, inte bevis för att slutsatserna är riktiga.

Modellen behöver ledigt RAM och eventuellt grafikminne utöver Windows och
övriga program. Stationen stoppar nya modelljobb vid mindre än 1 GB ledigt
RAM. Den gränsen garanterar inte att varje modell passar. Någon verifierad
kapacitet i företag per timme eller dag anges inte här.

## Kör ett arbetspass

1. Välj en tillgänglig modell och sätt målet till **1–500 företag**. Börja
   med det förinställda provurvalet **10** för att bedöma kvalitet och arbetstid.
   Välj också valv och arbetsmapp under **Maskinrum → Obsidian**.
2. Tryck **Starta Göteborgsresearch**. Det skapar ett insamlingsjobb och
   börjar behandla kön. Befintliga kandidater behålls och räknas mot målet.
3. Följ **Företagslast**, **Arbetskö** och **Skeppslogg**. Klicka på ett
   företagsnamn för källan, observationerna, AI-förslagen och osäkerheterna.
4. Använd **Pausa** för att avbryta pågående anrop och lägga det berörda
   jobbet tillbaka i kön. **Fortsätt** kör kön igen; ett avbrutet steg kan
   behöva göras om.
5. **Stopp** avbryter aktiva och väntande jobb. Sparade företag och färdiga
   utkast behålls. Ett nytt researchpass eller återupptagen kö är ett nytt
   uttryckligt kommando i stationen.
6. Öppna återlästa företagsrapporter och senaste översikten i Obsidian.
   Markdown/JSON-export finns dessutom som en separat nedladdning.

Ett arbetspass har en gräns på åtta timmar och pausas när tiden är slut.
Sparat tillstånd återläses i pausläge efter en serveromstart. Ingen insamling
eller modellanvändning återupptas av enbart omstarten. Tillfälligt otillgänglig
lokal modell eller kapacitet pausar kön; andra enskilda jobbfel parkeras så
att återstående jobb kan behandlas.

Målet 500 är en storleksgräns för företagslistan. Källans täckning,
dubbletter, saknade domäner, åtkomsthinder, modellens svar och datorns resurser
kan ge färre kandidater eller rapporter. Målet innebär inte 500 analyserade
företag på en dag.

## Vad researchen faktiskt samlar

```text
Öppen kartkälla: Göteborgs kommun
                ↓
Kandidater + ursprungslänk + domän om källan har en
                ↓
Fasta domän- och dubblettregler
                ↓
robots.txt + högst en HTML-sida per analyserad domän
                ↓
HTML-observationer → lokalt AI-utkast → samma modells eftergranskning
                ↓
Lokalt granskningsutkast → vald Obsidian-mapp → återläsning → din kontroll
```

Insamlaren frågar OpenStreetMap via Overpass om namngivna butiker,
hantverksverksamheter, kontor och vissa restaurang-/cafétyper inom kartans
område för Göteborgs kommun, med stabil SCB-kod 1480. Svaret måste innehålla
bekräftande kommunområdestaggar. Den söker inte hela webben och bevisar inte
att varje kartpost är ett aktivt företag, ett unikt arbetsställe eller har
rätt domän. Källans geografiska urval och företagets identitet/domänrelation
behöver granskas. En offentlig källänk är spårbarhet, inte ett godkännande.

Dubblettkontrollen normaliserar och jämför domäner samt reservnycklar för
poster utan domän. Den löser inte alla filial-, kedje-, flytt- eller
namnbytesfall. En saknad webbplats hittas inte automatiskt genom en annan
sökmotor; kandidaten kan därför behöva kompletteras innan webbgranskning.

För webbgranskning läses `robots.txt` och en HTML-sida från företagets
domän. Tillåten omdirigering får stanna på samma domän med eller utan `www`.
Andra domäner, otillgänglig robotskontroll, åtkomstskydd, icke-HTML och
misslyckade HTTP-svar blir hinder, inte negativa kvalitetsfynd.

Observationerna omfattar sidtitel, metabeskrivning, viewport-tagg,
språkmarkering, hämtad URL, tid, HTTP-status och SHA-256 för hämtade bytes.
Hämtad rå HTML sparas separat i
`work/station-data/evidence/<sha256hex>.html`. Originalets URL, tid och hash
sparas med företagets observationer. HTML-filerna serveras eller renderas
inte av stationen. Offentliga anrop till samma värd begränsas till ett nytt
anrop tidigast var tredje sekund.

Stationen kör inte sidans JavaScript och renderar inte webbplatsen. Den
mäter inte mobilutseende, tryckytor, formulärfunktion, prestanda eller
fullständig sidtäckning. Hashen kan identifiera det hämtade innehållet, men
är inte ett bevis på riktighet eller ett förseglat V2.3-evidenspaket.

## Skrivna order och röst

Klicka på en figur, skriv högst 2 000 tecken och välj **Lägg i kön**. Ordern
utförs inte vid köläggningen. **Kör kön/Fortsätt** behandlar den med den
valda lokala modellen.

Fria order ger rådgivande svar. Den nuvarande kommandovägen skickar din
instruktion och övergripande räknare för företag och väntande jobb till
modellen. Den skickar inte alla företagens källtexter eller rapporter som
kontext. Använd därför inte ett allmänt kommando som bevis för att modellen
har granskat hela den importerade företagslistan.

Order kan inte köra kod, installera program, redigera en webbplats, skapa
nya verktyg, skicka meddelanden eller fatta granskningsbeslut. Rollen
programmerare/developer och externa försäljningsåtgärder är inte byggda.
Röstinmatning och lokal taligenkänning är ännu inte installerade.

## Import och Obsidian

Välj högst **50 filer**, **256 000 byte per fil** och **2 000 000 byte
totalt**. Markdown behöver enkel inledande metadata:

```markdown
---
name: Exempelföretaget
website: https://example.com
---

Egna anteckningar.
```

JSON kan innehålla ett objekt, en objektlista eller ett objekt med listan
`companies`:

```json
[
  {
    "name": "Exempelföretaget",
    "website": "https://example.com"
  }
]
```

`name` behövs. `website`, `domain` eller `url` kan ange domänen; motstridiga
domänvärden stoppas. En post utan webbplats förblir en kandidat med okänd
domän. Importören använder företagsfälten och skapar sina egna lokala
statusar. Den tar inte in fria anteckningar, beslut, rapporter eller poäng
som auktoritativt underlag eller exekverbara instruktioner.

Filerna läses först när du väljer dem. Stationen söker inte själv igenom
valvets anteckningar. Markdown-/JSON-export laddas ned via webbläsaren.
JSON-exporten är ett separat
`divinelist.station-export.v1`-utkast, inte `divinelist.dataset.v2` och inte
ett återställningspaket för mänskliga auditbeslut.

### Automatisk dokumentation i valt valv

Öppna **Maskinrum**, välj ett befintligt Obsidian-valv och ange en särskild
arbetsmapp, exempelvis `Agentstation`. Programmet kan läsa listan över
registrerade valv; du kan också ange den lokala sökvägen. **Spara
Obsidian-koppling** sparar valet men skapar inga företagsfiler.

Med automatisk skrivning aktiverad skriver **Start/Fortsätt** sparade
företag och resultat vid arbetsstegens gränser. **Skriv listan nu** gör
samma sak med befintligt underlag när kön är vilande. Skrivaren går också
att välja på skeppet. Läget visar skrivkonflikter och senaste återläsning.

```text
Agentstation/
  START.md                       egen startsida med översiktssökning
  Foretag/<stabilt id>.md         ursprungsuppgifter + dina anteckningar
  Agentdata/Rapporter/<id>/       bevarade versioner av hela underlaget
  Agentdata/Oversikter/           gemensamma översikter med rapportlänkar
```

Företagskort och startsida skrivs en gång och blir sedan dina. Agentrapporter
och översikter får nya versioner när underlaget ändras. **Öppna översikt**
och länken i företagstabellen går till den aktuella återlästa versionen.
Obsidian-kärnans sökblock visar dessutom historiken utan community-plugin.
Identiska omkörningar skapar inga extra Markdown-filer.

En gemensam skrivkö, processlås, skrivjournal, atomisk publicering och
återläsning skyddar mot samtidiga ändringar och avbrott. Befintliga valvfiler
ersätts aldrig. En redigerad agentrapport parkeras som konflikt; den skrivs
inte över. Nya företag kan fortfarande behandlas. Disk- eller målproblem
pausar kön med ett separat Obsidian-fel. Efter omstart är sparade länkar
återställda, men markeras återlästa först efter nästa uttryckliga synkning.

Arbetsmappen behöver ligga på ett lokalt filsystem med stöd för hårda länkar,
exempelvis NTFS. Historiken bevaras tills gränsen 20 000 spårade filer eller
4 MB manifest nås; då stoppas nya skrivningar tydligt. Programmet ändrar inte
`.obsidian` eller andra mappar i valvet. Rollernas fullständiga indata-,
kvalitets- och stoppregler finns i [AGENT_ROLES.md](AGENT_ROLES.md).

## Lagring och teknisk gräns

- UI: `station/`, React med Canvas 2D, texturerade rum och sex unika sprites.
  Gång och arbete följer jobbstatus, medan motorer och bakgrund kan leva i
  vänteläge. Högst cirka 30 bilder per sekund, cachad grafik, dold-flik-paus
  och stöd för minskad rörelse håller renderingens kostnad nere.
- Bygge: `scripts/build-station.mjs` skapar `dist/station/` med ett
  hashmanifest för HTML, JavaScript och CSS.
- Lokal server: `scripts/station/server.mjs`, endast `127.0.0.1`.
- Arbetskö: `scripts/station/runtime.mjs`, separata lokala kandidater,
  jobb, utkast och händelser.
- Nätverk och modell: `scripts/station/network.mjs`, avgränsade offentliga
  anrop samt Ollama på `127.0.0.1:11434`.
- Sparat tillstånd: `work/station-data/station-state.json`. En processlåsfil
  hindrar två stationer från att skriva samma arbetsyta samtidigt.
- Obsidian-brygga: `scripts/station/obsidian.mjs`; anslutning och skrivjournal
  sparas i samma datamapp. Windows-paketet använder i stället
  `%LOCALAPPDATA%/DivineList/station-data` som standard.
- Hämtade HTML-original: `work/station-data/evidence/`, med filnamn bundna
  till innehållets SHA-256. Dessa filer saknar publik serverrutt.
  Den lyckade kartfrågans råa JSON sparas där på samma sätt.

Webbläsaren använder stationens lokala API. Skrivbegäran kräver rätt
lokalt ursprung och en sessionstoken. Hämtning av offentliga webbplatser
blockerar lokala/privata nätadresser och kontrollerar omdirigeringar.
Webbplatsinnehåll behandlas som obetrodda data; modellen har inga
verktygsbefogenheter. Molnmodeller filtreras bort från stationens modellval.

Stationen skriver inte till den aktiva produktionsdatabasen, ändrar inte
runtimeidentiteter och fattar inte mänskliga auditbeslut. Den klassiska
regelmotorn måste fortfarande få rätt identiteter, evidens, renderingsdata,
sidtäckning, kontrakt och granskning genom sitt eget flöde. Ingen funktion
i Skeppet skickar outreach, kontaktar kunder eller publicerar innehåll.
