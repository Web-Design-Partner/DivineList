# DivineList Agentstation för Windows

Det portabla paketet innehåller DivineList.exe, en egen Node.js-motor, den lokala
stationsservern och skeppets färdigbyggda gränssnitt. Du behöver inte ChatGPT,
npm, en kodredigerare eller en separat Node-installation för att starta paketet.
Gränssnittet öppnas i din vanliga webbläsare. Paketet levereras för Windows x64
och använder Windows befintliga .NET Framework 4-komponenter för startaren.

## Starta

1. Packa upp **hela ZIP-filen** till en egen lokal mapp. Starta inte programmet
   inifrån ZIP-vyn.
2. Dubbelklicka på **DivineList.exe**. Startaren kontrollerar paketets filer och
   öppnar `http://127.0.0.1:8790/` när dess egen server är redo.
3. Välj modell, Obsidian-mapp och uppdrag i stationen. Ingen insamling startar
   bara för att programmet öppnas.

En skeppsikon visas vid Windows-klockan. Högerklicka för **Öppna DivineList**,
**Visa loggmapp** eller **Avsluta stationen**. När stationen avslutas avbryts
pågående arbete och kön sparas. En senare start återupptar inga uppdrag utan
ditt startkommando. Att stänga en webbläsarflik avslutar inte stationen.

## Ollama och Obsidian

Ollama och modellvikterna ingår **inte** i ZIP-filen. De är separata större
beroenden. En redan körande lokal Ollama-server på `127.0.0.1:11434` används.
Om ingen svarar försöker startaren använda den förberedda motorn på
`%LOCALAPPDATA%\DivineList\ollama-0.33.3\ollama.exe` med modellerna i
`%LOCALAPPDATA%\DivineList\models`. Den startas med lokal anslutning,
molnfunktioner avstängda, en laddad modell och en samtidig modellkörning.
Startaren installerar eller laddar inte ned modeller automatiskt.

Om Ollama eller vald modell saknas visar stationen vad som behöver ordnas.
Den befintliga modellen `qwen3:4b` är avsedd för den aktuella datorn; kontrollera
alltid faktiskt ledigt minne före större körningar. Om en annan Ollama-server
redan körs ändrar startaren inte dess inställningar. Ollama har separat
livslängd och kan fortsätta köra efter att själva stationen har avslutats.

Obsidian behöver finnas separat om du vill visa anteckningarna där. Stationen
arbetar med lokala Markdown-filer i den arbetsmapp du själv väljer i gränssnittet.
En nedladdning av programmet ger ingen behörighet att skriva i ett valv innan
arbetsmappen har valts. Manuella anteckningar ska bevaras utanför de tydligt
markerade avsnitt som agenterna äger.

## Var data och loggar ligger

- Arbetskö, inställningar, företagsutkast och källartefakter:
  `%LOCALAPPDATA%\DivineList\station-data`.
- Startarens loggar: `%LOCALAPPDATA%\DivineList\logs`.
- Obsidian-anteckningar: den valda arbetsmappen i ditt valv.

Paketmappen innehåller programfiler. Du kan lägga en senare version i en ny
mapp utan att skriva över arbetsdata. Behåll en säkerhetskopia av datamappen
och ditt valv före större uppgraderingar. Startaren flyttar inte tidigare
utvecklingsdata från ett källprojekts `work/station-data` automatiskt.

## Om stationen inte startar

- **Port 8790 används redan:** avsluta den tidigare DivineList-servern eller
  programmet som använder porten. Startaren stoppar aldrig en okänd process.
- **Paketfilen har ändrats eller saknas:** packa upp hela den ursprungliga
  ZIP-filen igen till en ny mapp. Kontrollerna ska inte stängas av.
- **Arbetskopian används redan:** öppna den redan startade stationen. Starta
  inte två program mot samma datamapp.
- **Ollama saknas:** programmet kan öppnas men modelljobb behöver en installerad
  lokal motor och modell.

Läs startloggarna via skeppsikonen. ZIP-filens tillhörande `.sha256` innehåller
dess kontrollsumma. `package-manifest.json` innehåller SHA-256 för varje
programresurs; startaren och servern verifierar dem. Kontrollerna upptäcker
ändrade filer men utgör inte en digital utgivarsignatur. Den egna
DivineList-startaren är inte kodsignerad. Windows kan därför visa en varning
för en okänd utgivare. Stäng inte av Windows skydd för att kringgå en varning.

## Bygga ett nytt paket från källprojektet

Detta avsnitt behövs bara vid utveckling. Kör efter ett verifierat stationsbygge:

```powershell
node scripts/package-station.mjs
```

Byggkommandot kopierar den Node-version som används för bygget, sammanställer
C#-startaren med Windows befintliga kompilator, buntar serverns beroenden och
skapar ett nytt paket under `outputs`. Befintliga paket skrivs inte över.
`THIRD-PARTY-NOTICES.txt` och `licenses` följer med. För reproducerbar kontroll
sparas Node-version, filstorlekar och kontrollsummor i paketmanifestet.

Vid lokal testning kan startaren eller den medföljande Node-motorn få
`--port 8796 --data-dir "C:\en\separat\testmapp"`. Det ändrar inte programmets
standarddata och startar inte research. Paketet ska provstartas från en
uppackad leverans, inte enbart från källprojektet.

Det automatiska leveranstestet använder `DivineList.exe --verify-package --port
8798 --data-dir "C:\en\ny\testmapp"`. Det startar den riktiga startaren och
medföljande motorn, läser en tom stationsstatus och stänger barnet korrekt.
Det skapar `launcher-verification.json` i testmappen vid PASS. Testläget öppnar
ingen webbläsare, startar inte Ollama och utför ingen research. En separat tom
datamapp är obligatorisk. Detta startprov ersätter inte kontroll av gränssnittet
eller en verklig insamlingskörning.
