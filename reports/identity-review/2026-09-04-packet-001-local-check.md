# Packet-001 – kompletterad lokal dubblett- och kontaktspärrkontroll

Kontrollerad: 2026-09-04T11:48:32Z, 13:48 svensk tid.
Omfattning: exakt de tre tidigare kandidaterna, endast aktuell lokal runtime.

## Resultat

| Kandidat | Dubblett inom denna DB | Registrerad kontaktspärr inom denna DB | Nästa agentsteg |
| --- | --- | --- | --- |
| Caféva – Haga | Ingen träff | Ingen träff | Isolerad provimport kan förberedas och testas. |
| Aktiv Hälsa Göteborg | Ingen träff | Ingen träff | Fortsatt osäker adressroll; ingen provimport. |
| Göteborgs Glasmästeri AB | Ingen träff | Ingen träff | Fortsatt parkerad för nuvarande konsumenttjänsturval. |

Ingen kandidat är därmed godkänd för kontakt, annonsering eller aktiv import.
Den nya observationsfilen är agentägd förberedelse; originalseedens olösta
identiteter, granskningsflaggor och domänkonfidens noll är oförändrade.

## Genomförd kontroll

Databas:
C:/Users/cozys/AppData/Local/WebDesignPartner/Foretagskarta/state/engine-v2.sqlite3

Anslutningen använde SQLite mode=ro, PRAGMA query_only=ON och lästransaktion.
Inga SQL-skrivningar, nätverkskällor eller aktiva valvfiler användes. Snapshoten
från 11:47:52Z hade samma logiska fingeravtryck vid slutkontrollen 11:48:32Z.

- 25 företag, 25 arbetsställen och 17 webbplatser.
- 25 manuella granskningsrader: samtliga pending, qualified_for_contact=0 och
  do_not_contact=0.
- contact_suppressions: 0 rader totalt, även 0 kontaktvärdebaserade hashspärrar.
- contact_candidates: 0 rader totalt, även 0 historiska kandidat-DNC.
- 0 konflikter. Alias- och externa identifierartabeller är tomma.
- 31 öppna karantänposter: 30 findings och 1 workplace_protocol_event_v1.

Alla tre kontrollerades mot organisationsnummer och härledda företags-ID:n,
normaliserade företags-/arbetsställenamn, fullständig publik gatuadress samt
domän med normaliserat www-alias. Relevanta identitetsfält i 25 källobservationer,
domäner i 40 evidens-URL:er och kandidatidentifierare i karantänens källnycklar/
JSON-strängar gav inga matchningar. Inga privata kontaktvärden redovisades.

Kontrollen täckte companies, workplaces, websites, workplace_sites,
workplace_company_history, source_observations, source_evidence_urls,
manual_fields, contact_suppressions, contact_candidates, conflicts,
website_redirect_aliases, entity_aliases, external_identifiers och
quarantine_records.

## Spårbarhet

- Motorns schemafingeravtryck:
  sha256:057ccc5dddc2ca83234a1ce5c16101cbedaa58501a93935fb23d24344bae622a
- Motorns logiska DB-fingeravtryck:
  sha256:2b94dd66d28588fe4047b57930bd37089dc9fb8159399d4cf82c48d51ddb0bd3
- Hash över fullständiga rader i de 15 kontrollerade tabellerna:
  sha256:31dc226c9f6faf0e29e05e9c745aa1230dd29288e6322784b39483b5af7dfa40

Motorns logiska fingeravtryck undantar restore_test_events enligt sitt befintliga
kontrakt. Provimportens separata, fullständiga tabellhash använder en annan
definition och ska inte jämföras direkt med denna hash.

Ny observationsfil:
[packet-001-observations-2026-09-04-local-check.json](../autonomy-inputs/packet-001-observations-2026-09-04-local-check.json).
Den tidigare observationsfilen och identitetsrapporten behålls som historik.
Webbkällornas tidigare hämtningstid 10:59:39Z har inte förnyats av DB-kontrollen.

## Begränsningar

Ingen registrerad spärr i denna runtime är inte ett globalt klartecken.
Andra DB:er, CRM, aktiva valvet och oimporterade spärrlistor ingår inte.
Tomma alias-/extern-ID-tabeller innebär inte fullständig historisk
identitetsmappning. Här räcker globala nollantal för att konstatera att inga
spärrar finns i just den kontrollerade DB:n.

Om framtida snapshot innehåller DNC, aktiva suppressioner eller osäker
kontaktvärde-/historikmappning ska provimporten blockera och förklara
begränsningen. Kontakten förblir oauktoriserad oavsett en lyckad provimport.
