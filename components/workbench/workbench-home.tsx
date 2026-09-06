'use client';

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { ArrowRight, Database, FileText, Search, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { AUDIT_RULES } from '@/lib/audit/catalog';
import {
  DATASET_VERSION_V2,
  type AuditDataset,
  type CompanyAudit,
} from '@/lib/audit/types';
import {
  MAX_WORKBENCH_BYTES,
  WORKBENCH_REASON_LABELS,
  parseWorkbenchSnapshotJson,
  workbenchSnapshotIsStaleAt,
  type WorkbenchSnapshot,
} from '@/lib/workbench/snapshot';

type Props = {
  dataset: AuditDataset;
  audits: CompanyAudit[];
  productionSummary: string;
  onImport: () => void;
  onOpenCompany: (id: string) => void;
  onExportCompany: (audit: CompanyAudit) => void;
};

const candidateRules = AUDIT_RULES.filter(
  (rule) =>
    rule.lifecycle === 'candidate' && rule.evaluationMode === 'automated',
);
const INVENTORY_PAGE_SIZE = 25;
const INVENTORY_STORAGE_KEY = 'divinelist.workbench-inventory.v1';
const showTime = (value: string) => new Date(value).toLocaleString('sv-SE');

export function WorkbenchHome({
  dataset,
  audits,
  productionSummary,
  onImport,
  onOpenCompany,
  onExportCompany,
}: Props) {
  const [snapshot, setSnapshot] = useState<WorkbenchSnapshot | null>(null);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [onlyGaps, setOnlyGaps] = useState(true);
  const [storageNotice, setStorageNotice] = useState('');
  const [clock, setClock] = useState<string | null>(null);
  const requestRef = useRef(0);
  const detailsRef = useRef<HTMLHeadingElement | null>(null);
  const realAudits = useMemo(
    () => (dataset.version === DATASET_VERSION_V2 ? audits : []),
    [dataset.version, audits],
  );
  const auditById = useMemo(
    () => new Map(realAudits.map((audit) => [audit.company.id, audit])),
    [realAudits],
  );
  const filtered = useMemo(() => {
    const search = query.trim().toLocaleLowerCase('sv');
    return (snapshot?.companies ?? []).filter((company) =>
      `${company.name} ${company.domain ?? ''} ${company.workplaceName}`
        .toLocaleLowerCase('sv')
        .includes(search),
    );
  }, [snapshot, query]);
  const selected = snapshot?.companies.find(
    (company) => company.workplaceUid === selectedId,
  );
  const matchingAudit = selected
    ? auditById.get(selected.workplaceUid)
    : undefined;
  const audit =
    matchingAudit && matchingAudit.company.domain === selected?.domain
      ? matchingAudit
      : undefined;
  const pageCount = Math.max(
    1,
    Math.ceil(filtered.length / INVENTORY_PAGE_SIZE),
  );
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice(
    (currentPage - 1) * INVENTORY_PAGE_SIZE,
    currentPage * INVENTORY_PAGE_SIZE,
  );
  const factKeys = useMemo(
    () =>
      new Set(
        audit?.company.facts
          .filter((fact) => fact.value !== null && fact.evidenceIds.length > 0)
          .map((fact) => fact.key) ?? [],
      ),
    [audit],
  );
  const mappedKeys = useMemo(
    () => new Set(snapshot?.adapterCoverage.factKeys ?? []),
    [snapshot],
  );
  const coverage = useMemo(
    () =>
      candidateRules.map((rule) => ({
        rule,
        missingCode: rule.requiredFacts.filter((key) => !mappedKeys.has(key)),
        missingObservation: rule.requiredFacts.filter(
          (key) => !factKeys.has(key),
        ),
        result: audit?.results.find((result) => result.ruleId === rule.id),
      })),
    [mappedKeys, factKeys, audit],
  );
  const shownCoverage = coverage.filter(
    (entry) =>
      !onlyGaps ||
      entry.missingCode.length ||
      entry.missingObservation.length ||
      entry.result?.executionStatus !== 'completed',
  );
  const linkedCount =
    snapshot?.companies.filter(
      (company) =>
        auditById.get(company.workplaceUid)?.company.domain === company.domain,
    ).length ?? 0;
  const stale =
    snapshot && clock ? workbenchSnapshotIsStaleAt(snapshot, clock) : false;

  useEffect(() => {
    const tick = () => setClock(new Date().toISOString());
    const interval = window.setInterval(tick, 60_000);
    window.addEventListener('focus', tick);
    // Browser-only storage is read after hydration, never during server render.
    const hydration = window.setTimeout(() => {
      tick();
      try {
        const stored = window.localStorage.getItem(INVENTORY_STORAGE_KEY);
        if (stored) {
          const restored = parseWorkbenchSnapshotJson(stored);
          setSnapshot(restored);
          setSelectedId(restored.companies[0]?.workplaceUid ?? '');
          setStorageNotice(
            'Senast öppnade inventarie återställt från denna webbläsare. Ingen källa har uppdaterats.',
          );
        }
      } catch {
        setStorageNotice(
          'En sparad arbetskopia kunde inte återställas eller lagringen är otillgänglig. Öppna en ny arbetskopia; ingen äldre fil har ändrats.',
        );
      }
    }, 0);
    return () => {
      window.clearTimeout(hydration);
      window.clearInterval(interval);
      window.removeEventListener('focus', tick);
    };
  }, []);

  const handleInventory = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    const request = ++requestRef.current;
    setLoading(true);
    setError('');
    try {
      if (file.size > MAX_WORKBENCH_BYTES)
        throw new Error(
          'Inventariepaketet är för stort. Välj en mindre, exporterad arbetskopia.',
        );
      const bytes = await file.arrayBuffer();
      const parsed = parseWorkbenchSnapshotJson(
        new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      );
      if (request !== requestRef.current) return;
      setSnapshot(parsed);
      setSelectedId(parsed.companies[0]?.workplaceUid ?? '');
      setPage(1);
      setQuery('');
      try {
        window.localStorage.setItem(
          INVENTORY_STORAGE_KEY,
          JSON.stringify(parsed),
        );
        setStorageNotice(
          'Inventariet har sparats lokalt i denna webbläsare. Behåll originalfilen som separat kopia.',
        );
      } catch {
        setStorageNotice(
          'Inventariet är öppnat men kunde inte sparas i webbläsaren. Vid omladdning behöver filen öppnas igen.',
        );
      }
    } catch (cause) {
      if (request === requestRef.current)
        setError(
          cause instanceof Error
            ? cause.message
            : 'Arbetskopian kunde inte läsas.',
        );
    } finally {
      if (request === requestRef.current) {
        setLoading(false);
        input.value = '';
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Card className="bg-card/90">
          <CardHeader>
            <CardTitle>Från företag till granskat underlag</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              Välj en skrivskyddad arbetskopia av företagslistan. Här skiljer vi
              saknade observationer från sådant som överföringen ännu inte kan
              leverera. Ett företag i listan är inte ett bekräftat fynd.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-input bg-background px-4 py-2 text-sm font-semibold focus-within:ring-2 focus-within:ring-ring">
                <Upload className="size-4" aria-hidden="true" /> Öppna
                företagsunderlag
                <input
                  aria-label="Öppna företagsunderlag"
                  type="file"
                  accept=".json,application/json"
                  className="sr-only"
                  onChange={handleInventory}
                />
              </label>
              <Button variant="outline" onClick={onImport}>
                <ArrowRight className="size-4" /> Lägg till analys eller status
              </Button>
            </div>
            <p aria-live="polite" className="text-xs text-muted-foreground">
              {loading
                ? 'Kontrollerar arbetskopians format och bindningar…'
                : snapshot
                  ? `${snapshot.companies.length} arbetsställen i den öppnade arbetskopian.`
                  : 'Ingen verklig företagslista är laddad. Demo finns separat under Granskningskö.'}
            </p>
            {storageNotice && (
              <p className="text-xs text-muted-foreground">{storageNotice}</p>
            )}
            {error && (
              <p
                role="alert"
                className="whitespace-pre-wrap break-words rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900"
              >
                {error} Föregående arbetskopia har behållits.
              </p>
            )}
          </CardContent>
        </Card>
        <Card className="border-amber-300/70 bg-amber-50/70">
          <CardHeader>
            <CardTitle>Arbetsläge är inte produktionsgodkännande</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-6">
            <p>{productionSummary}</p>
            <p className="text-muted-foreground">
              Analysförslag och manuella utkast kan granskas lokalt. Denna vy
              aktiverar inga regler, kontaktar ingen och skriver inte i ditt
              aktiva Obsidian-valv.
            </p>
          </CardContent>
        </Card>
      </div>

      <dl
        className="grid gap-3 sm:grid-cols-3"
        aria-label="Arbetskopians omfattning"
      >
        {[
          ['Arbetsställen i listan', snapshot?.companies.length ?? '—'],
          ['Med öppnat analysunderlag', snapshot ? linkedCount : '—'],
          [
            'Kandidatregler med full kodkoppling',
            snapshot
              ? `${coverage.filter((entry) => !entry.missingCode.length).length} / ${candidateRules.length}`
              : '—',
          ],
        ].map(([label, count]) => (
          <div
            key={label}
            className="rounded-xl border border-border bg-card p-4"
          >
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-2 text-2xl font-semibold">{count}</dd>
          </div>
        ))}
      </dl>

      {snapshot ? (
        <>
          <p className="text-xs leading-5 text-muted-foreground">
            Arbetskopia skapad{' '}
            <time dateTime={snapshot.generatedAt}>
              {showTime(snapshot.generatedAt)}
            </time>
            . Inventariemetadata lästes{' '}
            <time dateTime={snapshot.sourceCapturedAt}>
              {showTime(snapshot.sourceCapturedAt)}
            </time>
            . Det förnyar inte webbplatsobservationernas ålder. Kodkoppling är
            inte beviskvalitet eller godkända kontroller.
          </p>
          {stale && (
            <output className="block rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
              Arbetskopian är äldre än 24 timmar eller har osäker tid. Den visas
              som historik. Öppna en ny skrivskyddad arbetskopia innan aktuella
              driftbeslut.
            </output>
          )}
          <div className="grid items-start gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
            <section aria-label="Inventarium" className="min-w-0 space-y-3">
              <label htmlFor="workbench-search" className="relative block">
                <span className="sr-only">Sök i arbetsinventariet</span>
                <Search
                  className="absolute left-3 top-3 size-4 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  id="workbench-search"
                  className="h-11 pl-9"
                  type="search"
                  placeholder="Sök företag eller domän"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setPage(1);
                  }}
                />
              </label>
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {filtered.length} av {snapshot.companies.length} arbetsställen
                visas.
              </p>
              <ul
                className="max-h-80 overflow-y-auto rounded-xl border border-border bg-card xl:max-h-[620px]"
                aria-label="Arbetsställets underlag"
              >
                {visible.map((company) => (
                  <li
                    key={company.workplaceUid}
                    className="border-b border-border last:border-b-0"
                  >
                    <button
                      type="button"
                      aria-pressed={selectedId === company.workplaceUid}
                      onClick={() => {
                        setSelectedId(company.workplaceUid);
                        detailsRef.current?.focus({ preventScroll: true });
                      }}
                      className={`w-full px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${selectedId === company.workplaceUid ? 'bg-primary/10' : 'hover:bg-muted'}`}
                    >
                      <strong className="block break-words text-sm">
                        {company.name}
                      </strong>
                      <span className="mt-1 block break-all text-xs text-muted-foreground">
                        {company.domain || 'Domän saknas'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {!filtered.length && (
                <p className="rounded-lg border p-4 text-sm">
                  Inga företag matchar sökningen.
                </p>
              )}
              <nav
                className="flex items-center justify-between gap-2"
                aria-label="Sidindelning för arbetsinventariet"
              >
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage === 1}
                  onClick={() => setPage(currentPage - 1)}
                >
                  Föregående
                </Button>
                <span className="text-xs">
                  {currentPage} / {pageCount}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage >= pageCount}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Nästa
                </Button>
              </nav>
            </section>
            <section
              className="min-w-0 space-y-4"
              aria-labelledby="workbench-company-heading"
            >
              <Card>
                <CardHeader>
                  <h3
                    id="workbench-company-heading"
                    ref={detailsRef}
                    tabIndex={-1}
                    className="rounded text-lg font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {selected?.name ?? 'Välj ett arbetsställe'}
                  </h3>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {selected && (
                    <ul
                      className="list-disc space-y-1 pl-5 text-xs leading-5 text-muted-foreground"
                      aria-label="Inventariets kvarvarande behov"
                    >
                      {selected.reasonCodes
                        .filter(
                          (code) =>
                            code !== 'analysis_batch_required' || !audit,
                        )
                        .map((code) => (
                          <li key={code}>{WORKBENCH_REASON_LABELS[code]}</li>
                        ))}
                    </ul>
                  )}
                  <p>
                    {audit
                      ? `Analysunderlaget är från ${showTime(audit.company.capturedAt)}. ${audit.results.filter((result) => result.executionStatus === 'completed').length} av ${audit.results.length} regelkörningar är slutförda. Slutfört betyder inte ett bekräftat problem.`
                      : 'Ingen matchande V2-analys är öppnad för arbetsstället. Företagslistan i sig innehåller inga webbplatsobservationer.'}
                  </p>
                  <p className="text-muted-foreground">
                    Kodkoppling saknas: utvecklingsarbete behövs. Observation
                    saknas: rätt underlag behöver tillföras. Underlag finns:
                    evidens, sidkoppling och färskhet måste fortfarande klara
                    analysens kontroller.
                  </p>
                  {audit ? (
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => onOpenCompany(audit.company.id)}>
                        <ArrowRight className="size-4" /> Granska detta underlag
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => onExportCompany(audit)}
                      >
                        <FileText className="size-4" /> Hämta
                        Obsidian-arbetskopia
                      </Button>
                    </div>
                  ) : (
                    <Button variant="outline" onClick={onImport}>
                      Öppna analysimport
                    </Button>
                  )}
                </CardContent>
              </Card>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-base font-semibold">
                  Vad behöver reglerna?
                </h3>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={onlyGaps}
                    onChange={(event) => setOnlyGaps(event.target.checked)}
                  />{' '}
                  Visa bara luckor och ofullständiga kontroller
                </label>
              </div>
              <p className="text-xs text-muted-foreground">
                {shownCoverage.length} av {candidateRules.length}{' '}
                kandidatregler. Bedömningen nedan gäller nyckeltäckning; vissa
                villkor kan avgöras med färre uppgifter.
              </p>
              <ul
                className="space-y-3"
                aria-label="Faktatäckning per kandidatregel"
              >
                {shownCoverage.map(
                  ({ rule, missingCode, missingObservation, result }) => (
                    <li
                      key={rule.id}
                      className="rounded-xl border border-border bg-card p-4"
                    >
                      <div className="flex flex-wrap justify-between gap-2">
                        <h4 className="text-sm font-semibold">{rule.title}</h4>
                        <span className="rounded-md bg-muted px-2 py-1 text-xs">
                          {missingCode.length
                            ? 'Kodkoppling saknas'
                            : missingObservation.length
                              ? 'Observation saknas'
                              : result?.executionStatus === 'completed'
                                ? 'Slutfört – se granskning'
                                : 'Underlag kräver kontroll'}
                        </span>
                      </div>
                      {missingCode.length > 0 && (
                        <p className="mt-2 break-words text-xs leading-5">
                          <strong>Att bygga:</strong> {missingCode.join(', ')}
                        </p>
                      )}
                      {missingObservation.length > 0 && (
                        <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">
                          <strong>Saknas i öppnat underlag:</strong>{' '}
                          {missingObservation.join(', ')}
                        </p>
                      )}
                      {!!result?.limitations.length && (
                        <p className="mt-2 text-xs leading-5 text-muted-foreground">
                          Analysens begränsning:{' '}
                          {result.limitations.slice(0, 2).join(' ')}
                        </p>
                      )}
                      {!missingCode.length && !missingObservation.length && (
                        <p className="mt-2 text-xs leading-5 text-muted-foreground">
                          Alla nödvändiga faktanycklar finns. Ett korrekt värde
                          och accepterat bevis krävs också; öppna granskningen
                          för utfallet.
                        </p>
                      )}
                    </li>
                  ),
                )}
              </ul>
            </section>
          </div>
        </>
      ) : (
        <Card>
          <CardContent className="flex items-start gap-3 py-6">
            <Database
              className="mt-1 size-5 shrink-0 text-primary"
              aria-hidden="true"
            />
            <div>
              <h3 className="font-semibold">
                Börja med en verklig arbetskopia
              </h3>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                Använd det separat exporterade företagsunderlaget. Importen är
                lokal och ersätter inte företag i databasen. Därefter kan du
                öppna en befintlig analysbatch och se luckorna för ett valt
                företag. Produktionsstatus laddas och verifieras separat under
                Obsidian & import.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
