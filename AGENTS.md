# DivineList – projektspecifikt arbetsmandat

Gäller från användarens utökade mandat den 4 september 2026. Dessa regler gäller
arbete i DivineList; de ger inte generell befogenhet i andra projekt.

## Arbeta vidare med rutinbesluten

Användaren ska inte behöva godkänna varje lokal identitetsförberedelse. Under en
aktiv arbetsomgång ska agenten själv:

- söka och jämföra offentliga företagskällor inom det beställda urvalet;
- göra källstödda lokala identitets-, domän-, adress-, filial- och segmentbedömningar;
- kontrollera dubbletter skrivskyddat och dokumentera osäkerhet;
- skapa separata lokala stagingunderlag, arbetsplaner och provimportförberedelser;
- göra avgränsade kod-, test-, dokumentations- och rapportförbättringar;
- prioritera nästa säkra steg, parkera osäkra kandidater och utesluta kandidater
  som inte passar det befintliga urvalet, med saklig motivering;
- fortsätta med andra tillåtna kandidater när en enskild kandidat är blockerad.

Fråga inte om ett nytt ja för rutinresearch, lokal bedömning eller nästa säkra
förberedelsesteg. Fakta som kan kontrolleras ska undersökas, inte skickas tillbaka
som användarbeslut. Samla verkliga undantag i en kort lista; ställ bara frågor
när ny befogenhet eller ett materiellt val av mål/omfattning faktiskt behövs.
Upprepa inte frågor av typen ”vill du att jag fortsätter?”.

## Separera förberedelse från runtimebeslut

Agenten äger lokala förberedelsestatusar, inte mänskliga granskningsbeslut:

```text
offentliga källor → agentbedömning → lokal arbetsplan/provimportförberedelse
                                      │
                                      └── ingen automatisk runtimeacceptans
```

- Använd endast agentägda förberedelsestatusar i den nya planeringen:
  `agent_ready_for_dry_run`, `agent_research`, `agent_deferred`, `agent_excluded`.
- En sådan status betyder inte verifierad runtimeidentitet, genomförd import,
  algoritmbehörighet, mänsklig review eller annonseringsgodkännande.
- Höj aldrig `gothenburg_status`, `verification_status`, domänkonfidens eller
  motsvarande runtimefält bara för att undvika en fråga.
- Fabrikera inte mänskliga reviewers, beslut, evidens, källbesök eller godkännanden.
  Behåll audit-, review-, karantän-, kalibrerings- och policygrindarna.
- Saknat eller motsägande underlag förblir uttryckligen osäkert. AI:s
  sammanfattning ersätter inte en bevarad källartefakt eller verklig observation.
- Parkering eller uteslutning i lokal plan får inte ändra runtimehistorik,
  kontaktspärrar, karantändisposition eller befintliga företagsidentiteter.

## Gränser som består

Följande kräver fortfarande uttryckligt, avgränsat godkännande: deploy,
produktions- eller aktiv runtime-DB-skrivning, kontakt eller externa meddelanden,
annonsering/publicering, köp, nya konton, hemligheter/inloggning, destruktiva
åtgärder, cutover och ändring av aktivt Obsidian-valv. En ny arbetsplan ger inte
det godkännandet. Ändra inte minnesfiler inom detta mandat.

Offentlig research använder endast tillåtna öppna källor och företagsdata.
Respektera robots och tjänsternas skydd; kringgå inte CAPTCHA, access challenge,
inloggning eller blockerade redirects. Samla inte privata kontaktuppgifter,
personnummer, kunddata eller hälsodata. Blockerad åtkomst är inte ett negativt
webbplatsfynd. En runtimecollector får inte startas enbart därför att en lokal
agentstatus blivit klar; dess egna grindar och avgränsade befogenheter gäller.

## Befintlig arbetsyta och verifiering

Läs relevanta status-, kontrakts- och handofffiler före ändring. Bevara smutsigt
eller delat arbete, koordinera överlappande filer och använd små diffar. Kör en
relevant säker baslinje före beteendekritiska ändringar och samma kontroll efter.
Redovisa PASS, FAIL och BLOCKED separat; ett tidigare misslyckande ska inte
stoppa oberoende säkert arbete eller döljas som ett lyckat resultat.

I denna OneDrive-arbetsyta kan Node-katalogposter felaktigt ange en vanlig
molnsynkad fil som symbolisk länk. För käll-/byggartefaktverifiering ska
`scripts/lib/local-filesystem.mjs` användas: läs namn och kontrollera filtypen
med `lstat` utan att följa verkliga länkar. Sänk inte hash-, namn- eller
länkkraven för att få ett grönt resultat. Kontrollera releaseattesten även
efter fullbygget; ett lyckat bygge är inte bevis för senare oförändrade filer.

Använd `apply_patch` för egna filändringar. Skapa inte en commit, runtimeimport,
ny bakgrundsautomation eller aktiv-vault-skrivning enbart för att dokumentation
beskriver det som ett framtida steg. Autonomt arbete gäller aktiva arbetsomgångar;
detta är inte ett löfte om arbete efter att uppgiften avslutats.

## Nuvarande implementation och äldre dokument

Läs [den lokala autonomimodellen](docs/LOCAL_AUTONOMY.md).
`npm run plan:local-work` är en offlineplanerare med agentägarskap och inga
rutinfrågor. Planeraren utför inte själv research eller import.
Det separata `npm run dry-run:company-seeds` kan prova en till tre agentklara
originalposter med motorns granskade importör, endast i en minneskopia av en
skrivskyddat läst databas. Det kräver explicit käll-DB, motor och Python,
blockerar vid okänt schema/kod, spärrar eller drift och skriver högst en ny
lokal rapport. Provimport-PASS är inte runtimeacceptans. V1-seedpreflight,
runtimegrindar och aktiv-importgränsen är oförändrade.

Detta mandat ersätter äldre projekttexters krav på separat mänskligt ja för
offentlig företagsresearch, lokal identitetsbedömning och staging-/provimport-
förberedelse. Det ersätter inte historiska granskningsbeslut eller skydden ovan.
Historiska rapporter ska behållas och märkas med avgränsade tillägg, inte skrivas
om som om det nya mandatet gällde vid deras ursprungliga körning.
