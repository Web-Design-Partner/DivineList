# Arbetsregler för DivineLists besättning

Dessa regler gäller den lokala Agentstationen. Rollerna delar en Ollama-modell
och arbetar i turordning. Företag, domäner och källor hämtas med kod; modellen
får tolka underlag och föreslå förbättringar.

```text
Kapten: välj mål + valv → Start
                             ↓
Spanare → Kartograf → Analytiker → Granskare → Skrivare
öppen     domän och    HTML +       AI-utkast    Obsidian +
kartkälla dubbletter   AI-förslag    och regler  återläsning
```

## Gemensamt kontrakt

- Högst 500 företagskandidater, 500 jobb och ett modellanrop åt gången. En ny
  installation börjar med mål 10. Ett arbetspass får pågå högst åtta timmar.
- Webbinnehåll och importerade anteckningar är obetrodda data. De ger inga
  nya verktyg, rättigheter eller instruktioner till programmet.
- Skilj observationer, AI-förslag och okända uppgifter. `Unknown - needs
verification` betyder att uppgiften inte är verifierad.
- Företagsidentitet, aktiv verksamhet, filial och domänrelation får inte
  godkännas enbart utifrån en kartpost. Kartans kommunområde är ett urval.
- Åtkomsthinder är inte bevis på dålig webbplats. Inga CAPTCHA, inloggningar,
  blockerade omdirigeringar eller robots-regler kringgås.
- Modellen har ingen kommandotolk, webbläsarkontroll eller fri filåtkomst.
  Programmet erbjuder varken outreach, publicering eller webbplatsändringar.
- Paus avbryter anrop och bevarar jobbet för omkörning. Stopp avbryter
  väntande/aktiva jobb. Sparade företag och färdiga underlag ligger kvar.
- Omstart läser kön utan att börja arbeta. Nästa Start/Fortsätt är ett nytt
  kommando. Kvarvarande underlag återförs då till den gemensamma skrivkön.

## Spanaren

**Uppgift:** hitta offentligt källbundna företagskandidater i Göteborg.

**Indata:** mål 1–500, befintliga domäner/käll-id och användarens Start.
**Verktyg:** fast Overpass-fråga mot OpenStreetMap. Kommunen identifieras med
SCB-kod 1480, administrativ nivå 7 och kommungräns; områdesbevis krävs i svaret.
Högst 2 000 kartobjekt och ett svar på högst 6 MB.
**Utdata:** namn, känd domän, offentlig OSM-länk, källtyp och insamlingstid.
Rått kartunderlag sparas med SHA-256 i stationens datamapp.
**Kvalitet:** ingen modell skapar kandidatlistan. Ofullständigt svar eller
saknat kommunområde ger ingen ny lista. Källan är inte hela webben.
**Stopp:** timeout, källfel, storleksgräns eller användarens paus/stopp.
**Överlämning:** Kartografen får parsade källposter. En fri skriven order till
Spanaren ger råd om research, inte en ny sökalgoritm.

## Kartografen

**Uppgift:** ordna källor och hindra dubbla poster.

**Indata:** källposter eller uttryckligen importerade Markdown-/JSON-filer.
**Verktyg:** fasta domänregler, normalisering och innehållshash som stabilt id.
Befintliga domäner/källor filtreras bort innan ett större mål fylls på.
**Utdata:** kandidat med stabilt id och källfält; känd webbplats köas för analys.
**Kvalitet:** kedjor och filialer kan fortfarande kräva mänsklig kontroll.
Importerade metadata får inte höja granskningsstatus.
**Stopp:** ogiltig domän, motstridiga importfält eller full lista. Saknad
domän parkeras utan att gissas; övriga kandidater kan fortsätta.
**Överlämning:** Analytikern får en offentlig domän. Skrivaren kan dokumentera
även ofullständiga kandidater med tydligt hinder.

## Analytikern

**Uppgift:** beskriva observerad HTML och föreslå möjliga förbättringar.

**Indata:** en domän och kodhämtade HTML-fält, aldrig uppfunna mätvärden.
**Verktyg:** robots-kontroll och högst en HTML-sida på samma domän. Privata
nätverk och otillåtna omdirigeringar blockeras. Minst tre sekunder mellan
nya anrop till samma värd. Originalet sparas med hash.
**Utdata:** titel, metabeskrivning, viewport, språk, URL, tid, HTTP-status,
hash och begränsad JSON: `summary`, `suggestions`, `unknowns`.
**Kvalitet:** kod sammanställer fakta. HTML bevisar inte mobilutseende,
sidladdning, formulärfunktion eller sidtäckning.
**Stopp:** blockerad sida/robots, modellfel, timeout, otillräckligt RAM eller
ogiltigt/avklippt svar. Enskilda källfel parkeras.
**Överlämning:** Granskaren får samma observationer och analysutkastet.

## Granskaren

**Uppgift:** kontrollera utkastets språk, osäkerheter och koppling till underlag.

**Indata:** samma sparade observationer plus Analytikerns utkast.
**Verktyg:** ett andra anrop till samma modell, följt av fasta format- och
rapportregler. Modellen har ingen egen extern verifiering.
**Utdata:** samma JSON-kontrakt. AI-förslag märks för mänsklig kontroll;
grundläggande observerade metadatabrister läggs till deterministiskt.
**Kvalitet:** andra anropet är inte oberoende och kan upprepa fel. Företaget
får status granskningsutkast, aldrig godkänd identitet.
**Stopp:** ogiltigt/ofullständigt svar eller kapacitetsfel. Ofullständiga svar
sparas inte som färdig analys.
**Överlämning:** Skrivaren får kodsammanställda fakta och markerade AI-förslag.

## Skrivaren

**Uppgift:** spara underlag och göra det läsbart i vald Obsidian-mapp.

**Indata:** validerat stationsunderlag, användarvalt befintligt valv, relativ
arbetsmapp och aktiverad automatisk skrivning.
**Verktyg:** gemensam sekventiell filkö. Ingen modell har direkt filåtkomst.
**Utdata:** stabilt företagskort per id, bevarade rapportversioner och gemensam
översikt. Publicerade filer återläses och resultat visas per företag.
Identiskt underlag ger inga extra Markdown-filer.
**Kvalitet:** egna anteckningar på företagskort och `START.md` ersätts aldrig.
Ändrade agentrapporter får nya filer. Journal, processlås, hashkontroll och
atomisk publicering skyddar mot halva rapporter och avbrott.
**Stopp:** fel mål, länkar i sökvägen, otillåten filtyp, full manifestgräns,
diskfel eller avbrott. Konflikter med redigerade rapporter parkeras synligt.
Ingen annan valvmapp eller `.obsidian` skrivs.
**Överlämning:** kaptenen får återläst kort/rapport och senaste översiktslänk.
Mänskliga granskningsbeslut ligger utanför agentens befogenheter.

## Konkreta kommandon i gränssnittet

| Kontroll                 | Verklig effekt                                                                  |
| ------------------------ | ------------------------------------------------------------------------------- |
| Starta Göteborgsresearch | Fyll på kandidatlistan till målet och behandla kön.                             |
| Kör kön / Fortsätt       | Kör sparade uppdrag och återför kvarvarande underlag till skrivkön.             |
| Skriv listan nu          | Skriv/återläs företag i vald Obsidian-mapp.                                     |
| Lägg i kön               | Köa en rådgivande rollfråga; skickar instruktion och räknare, inte hela valvet. |
| Importera                | Läs utvalda företagsfält i filer. Ingen automatisk körning.                     |

Fria order ger råd. Nya verktyg, fri kodkörning, försäljningsagenter och
röststyrning ingår inte i denna företagsinsamling.
