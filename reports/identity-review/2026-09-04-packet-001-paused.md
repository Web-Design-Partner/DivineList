# Aktiv Hälsa – avgränsad utredning parkerad

Kontroll: 4 september 2026, 13:12:18–13:14:44 UTC (15:12–15:14 svensk tid).
Gäller `CAND:wave-001:aktiv-halsa-goteborg` i det oförändrade packet-001.

## Beslut i lokal förberedelse

`agent_deferred` med dokumenterad `researchPause`. Lokal
`identity=supported` och `workplace=unresolved` bevaras. Det är inte ett
bevisat identitetsfel, en negativ webbplatssignal eller ett mänskligt beslut.

Den avgränsade offentliga kontrollen gav inte tillräckligt underlag för att
förklara alla adressroller. Agenten går därför vidare med andra kandidater.
Användaren behöver inte välja vilken katalog som ska tros på.

## Observationer och källor

Direkt öppning betyder läsbar text genom webverktyget, inte verifierad
fullständig webbläsarrendering. Åtkomsttider är lästider, inte när innehållet
senast uppdaterades. Detta är inte bevarad, förseglad auditevidens.

| Källa | Observerat | Begränsning |
| --- | --- | --- |
| [Egen startsida](https://aktivhalsagbg.com/) och [företagshälsovård](https://aktivhalsagbg.com/foretagshalsovard) | Den egna domänens sökindextext anger klinik på Otterhällegatan 2, 411 18 Göteborg. | Direkt textutläsning gav endast iframe. Inget organisationsnummer kunde knytas till kliniken i det åtkomliga förstapartsunderlaget. |
| [Hitta](https://www.hitta.se/verksamhet/aktiv-halsa-goteborg-ab-klrbzakqr) | Samma sida binder Aktiv Hälsa Göteborg AB, 559548-3479, domänen och klinikens uttryckliga besöksadress. | Företagskatalog med blandade uppgiftskällor, inte ett direkt officiellt arbetsställebevis. |
| [Allabolag](https://www.allabolag.se/foretag/aktiv-h%C3%A4lsa-g%C3%B6teborg-ab/g%C3%B6teborg/h%C3%A4lsotj%C3%A4nster/2KJEMONI63IHB) | Samma juridiska bolag och organisationsnummer; annan adress under både adress och postadress. | Ingen explicit registrerad arbetsställekoppling till kliniken. |
| [Syna](https://en.syna.se/companypublic/5595483479/aktiv-halsa-goteborg-ab) | Samma organisationsnummer; den alternativa adressen betecknas även besöksadress. | Skillnaden kan därför inte säkert avfärdas som endast postadress kontra klinikadress. |

Den alternativa adressen återges eller sparas inte. Dess eventuella privata
karaktär har inte undersökts. Ingen flytt eller relation mellan arbetsställen
antas, och inget CFAR skapas.

## När agenten får återuppta utredningen

Nytt offentligt förstapartsunderlag som uttryckligen binder bolag 559548-3479
till kliniken på Otterhällegatan 2, eller ett explicit officiellt
arbetsställeunderlag för samma bolag och klinik. Därefter gör agenten en ny
källbedömning och aktuell dubblett-/spärrkontroll. Det är inte ett automatiskt
godkännande och ingen bevakning har schemalagts.

Den nya observationsversionen finns i
[separat pausunderlag](../autonomy-inputs/packet-001-observations-2026-09-04-paused.json).
[Den nya arbetsplanen](../autonomy/2026-09-04-packet-001-paused/LOCAL_WORK_PLAN.md)
visar 1 agentklar, 2 parkerade och 0 rutinbeslut hos användaren.
Cafévas och Glasmästeris äldre källåtkomsttider har inte förnyats.

## Bevarade gränser och historik

- Originalseed är fortfarande 3 445 byte med SHA-256
  `6f6987e02c37437b67385bba4c61faa50447f61db9dbe1bc00aa4b0d2f289f14`.
- Tidigare observationer och provimportrapporter är oförändrade.
- Ingen ändring av runtimeverifiering, domänkonfidens, kontaktspärrar,
  granskningsbeslut eller aktivt valv.
- Ingen kontakt, insamlande runtimecollector, publicering, annonsering,
  inloggning eller betalning.

