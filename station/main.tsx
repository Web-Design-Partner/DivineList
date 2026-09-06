/* This standalone station is bundled directly by esbuild and does not use Next routing. */
/* oxlint-disable next/no-html-link-for-pages */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ShipScene, PixelPerson, crew, type Role } from './ship-scene';
import { ObsidianPanel, NoteLink, type ObsidianState } from './obsidian-panel';
import './style.css';

type Company = {
  id: string;
  name: string;
  domain: string | null;
  sourceUrl: string;
  sourceKind: string;
  observedAt: string;
  status: 'candidate' | 'queued' | 'running' | 'review' | 'blocked';
  facts?: {
    title?: string;
    description?: string;
    hasViewport?: boolean;
    lang?: string;
    statusCode?: number;
    url?: string;
    sha256?: string;
  };
  report?: { summary: string; suggestions: string[]; unknowns: string[] };
  error?: string;
};
type Job = {
  id: string;
  role: Exclude<Role, 'captain'>;
  kind: string;
  status: string;
  instruction?: string;
  companyId?: string;
  result?: string;
  error?: string;
  createdAt: string;
};
type StationState = {
  csrfToken: string;
  version: string;
  running: boolean;
  paused: boolean;
  autoWorkflow: boolean;
  model: string;
  goal: number;
  companies: Company[];
  jobs: Job[];
  events: { id: string; at: string; message: string }[];
  ollama: { available: boolean; models: string[]; error?: string };
  obsidian: ObsidianState;
  hardware: {
    freeRamGB: number;
    totalRamGB: number;
    gpuName?: string;
    freeVramGB?: number;
    totalVramGB?: number;
  };
};
const statusNames: Record<string, string> = {
  candidate: 'Kandidat',
  queued: 'I kön',
  running: 'Arbetar',
  review: 'Granskningsutkast',
  blocked: 'Blockerad',
  done: 'Klar',
  cancelled: 'Avbruten',
};
const rolePrompts: Record<Exclude<Role, 'captain'>, string> = {
  scout:
    'Beskriv en researchplan för att hitta lokala företag i Göteborg med behov av en tydligare webbplats.',
  mapper:
    'Beskriv vilka identitetsuppgifter och källor som behövs för att undvika dubbletter i företagslistan.',
  analyst:
    'Ge mig en kort checklista för att bedöma en lokal företagswebbplats. Skilj sådant som kräver ett riktigt webbplatstest från generella råd.',
  reviewer:
    'Beskriv hur jag kan granska ett AI-utkast efter osäkra slutsatser och saknade källor innan jag använder det.',
  scribe:
    'Ge mig en kort mall för en företagsanteckning med källa, observationer, förslag och sådant som behöver verifieras.',
};
function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
}
function safeUrl(value?: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function App() {
  const [state, setState] = useState<StationState | null>(null);
  const [selected, setSelected] = useState<Role>('captain');
  const [tab, setTab] = useState<'companies' | 'jobs' | 'log'>('companies');
  const [drawer, setDrawer] = useState<'setup' | 'company' | null>(null);
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  const [model, setModel] = useState('');
  const [goal, setGoal] = useState('10');
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState('');
  const initialized = useRef(false);
  const stateRef = useRef<StationState | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const inspectorRef = useRef<HTMLElement>(null);
  const drawerCloseRef = useRef<HTMLButtonElement>(null);

  const acceptState = useCallback((next: StationState) => {
    if (
      !next ||
      !Array.isArray(next.jobs) ||
      !Array.isArray(next.companies) ||
      !next.csrfToken
    )
      throw new Error(
        'Stationen gav ett oväntat svar. Starta om servern och försök igen.',
      );
    stateRef.current = next;
    setState(next);
    if (!initialized.current) {
      setModel(next.model || '');
      setGoal(String(next.goal || 10));
      initialized.current = true;
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/state', { cache: 'no-store' });
      if (!response.ok)
        throw new Error(`Stationen svarade med ${response.status}.`);
      acceptState(await response.json());
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Kunde inte ansluta till stationen.',
      );
    }
  }, [acceptState]);
  useEffect(() => {
    const initial = window.setTimeout(() => {
      void refresh();
    }, 0);
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 3000);
    const visible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [refresh]);
  useEffect(() => {
    if (drawer) drawerCloseRef.current?.focus();
  }, [drawer]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawer(null);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, []);

  const post = async (path: string, data: unknown) => {
    if (!stateRef.current)
      throw new Error('Anslut till den lokala stationen först.');
    const response = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-DivineList-Token': stateRef.current.csrfToken,
      },
      body: JSON.stringify(data),
    });
    const parsed: unknown = await response.json().catch(() => ({}));
    const result = (
      parsed && typeof parsed === 'object' ? parsed : {}
    ) as Partial<StationState> & { error?: unknown; message?: unknown };
    if (!response.ok)
      throw new Error(
        typeof result.error === 'string'
          ? result.error
          : typeof result.message === 'string'
            ? result.message
            : `Begäran misslyckades (${response.status}).`,
      );
    if (result.csrfToken) acceptState(result as StationState);
    else await refresh();
    return result;
  };
  const act = async (work: () => Promise<unknown>, message?: string) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
      if (message) setNotice(message);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Åtgärden misslyckades.',
      );
    } finally {
      setBusy(false);
    }
  };
  const saveConfig = async () => {
    const parsedGoal = Number(goal);
    if (!Number.isInteger(parsedGoal) || parsedGoal < 1 || parsedGoal > 500)
      throw new Error('Välj ett mål mellan 1 och 500 företag.');
    await post('/api/config', { model, goal: parsedGoal });
  };
  const control = (action: 'start' | 'pause' | 'resume' | 'stop') =>
    act(
      async () => {
        if (action === 'start' || action === 'resume') await saveConfig();
        await post('/api/control', { action });
      },
      action === 'start'
        ? 'Göteborgsresearch har startats. Följ verkliga jobb och källor i loggen.'
        : action === 'stop'
          ? 'Stoppsignal skickad. Se kön för jobbens slutstatus.'
          : undefined,
    );
  const toggleAutomation = () =>
    void act(
      () =>
        post('/api/automation', {
          enabled: !state?.autoWorkflow,
        }),
      state?.autoWorkflow
        ? 'Automatisk kedja stängs av efter det pågående säkra delsteget.'
        : 'Automatisk kedja är aktiverad. Starta eller återuppta kön när besättningen ska fortsätta.',
    );
  const selectRole = (role: Role) => {
    setSelected(role);
    setInstruction('');
    setNotice('');
    if (window.innerWidth < 1050)
      window.setTimeout(
        () =>
          inspectorRef.current?.scrollIntoView({
            behavior: window.matchMedia('(prefers-reduced-motion: reduce)')
              .matches
              ? 'instant'
              : 'smooth',
            block: 'start',
          }),
        50,
      );
  };
  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const items = Array.from(files);
    await act(async () => {
      if (
        items.length > 50 ||
        items.some((file) => file.size > 256_000) ||
        items.reduce((sum, file) => sum + file.size, 0) > 2_000_000
      )
        throw new Error(
          'Välj högst 50 filer, 256 KB per fil och sammanlagt 2 MB.',
        );
      if (items.some((file) => !/\.(md|json)$/i.test(file.name)))
        throw new Error('Importen tar emot Markdown (.md) och JSON (.json).');
      await post('/api/import', {
        files: await Promise.all(
          items.map(async (file) => ({
            name: file.name,
            text: await file.text(),
          })),
        ),
      });
      setTab('companies');
    }, 'Importen är behandlad. Se företagslistan och skeppsloggen för resultat.');
    if (importRef.current) importRef.current.value = '';
  };

  const jobs = state?.jobs || [];
  const companies = state?.companies || [];
  const working = jobs.filter((job) => job.status === 'running');
  const queued = jobs.filter((job) => job.status === 'queued');
  const activeCompanies = companies.filter(
    (company) => company.status !== 'blocked',
  );
  const activeCompanyCount = activeCompanies.length;
  const requestedGoal = Number(goal);
  const hasResearchWork =
    queued.length > 0 ||
    companies.some(
      (company) =>
        ['candidate', 'queued'].includes(company.status) && company.domain,
    ) ||
    (Number.isInteger(requestedGoal) &&
      requestedGoal > activeCompanyCount &&
      requestedGoal <= 500);
  const ready = companies.filter(
    (company) => company.status === 'review',
  ).length;
  const selectedCrew = crew.find((person) => person.id === selected)!;
  const crewJobs = jobs.filter((job) => job.role === selected);
  const latestCrewJob = crewJobs[crewJobs.length - 1];
  const crewCompany = companies.find(
    (item) => item.id === latestCrewJob?.companyId,
  );
  const company = companies.find((item) => item.id === selectedCompany);
  const notes = new Map(
    state?.obsidian?.companies.map((note) => [note.id, note]) || [],
  );
  const workingRoles: Role[] = state?.paused
    ? []
    : working.map((job) => job.role);
  if (state?.obsidian?.syncing && !workingRoles.includes('scribe'))
    workingRoles.push('scribe');
  const syncObsidian = () =>
    void act(
      () => post('/api/obsidian/sync', {}),
      'Skrivningen är kontrollerad. Se Obsidian-status för varje företag.',
    );
  const engineReady = Boolean(
    state?.ollama.available && model && state.ollama.models.includes(model),
  );
  const runningLabel = !state
    ? 'Ansluter'
    : state.paused
      ? 'Pausad'
      : state.running
        ? 'Arbetar'
        : 'Väntar på order';
  const visibleCompanies = companies.filter((item) =>
    `${item.name} ${item.domain || ''}`
      .toLocaleLowerCase('sv')
      .includes(filter.toLocaleLowerCase('sv')),
  );

  return (
    <div className="station-app">
      <header className="topbar">
        <a className="brand" href="/" aria-label="DivineList skeppet">
          <span className="brand-symbol">
            <i />
            <i />
            <i />
          </span>
          <span>
            DIVINE<span className="brand-light">LIST</span>
            <small>DIN LOKALA AGENTSTATION</small>
          </span>
        </a>
        <div className="topbar-resources">
          <div className="resource">
            <span
              className={`signal ${state?.ollama.available ? 'online' : ''}`}
            />
            <span>
              OLLAMA{' '}
              <strong>
                {state?.ollama.available ? 'Ansluten' : 'Ej ansluten'}
              </strong>
            </span>
          </div>
          <div className="resource ram">
            <span className="resource-icon">▥</span>
            <span>
              LEDIGT RAM{' '}
              <strong>
                {state
                  ? `${state.hardware.freeRamGB.toFixed(1)} / ${state.hardware.totalRamGB.toFixed(0)} GB`
                  : 'Läser av…'}
              </strong>
            </span>
          </div>
          <button
            className="resource obsidian-resource"
            onClick={() => setDrawer('setup')}
            aria-label="Öppna Obsidian-inställningar"
          >
            <span
              className={`signal ${state?.obsidian?.configured && state.obsidian.enabled ? 'online' : ''}`}
            />
            <span>
              OBSIDIAN{' '}
              <strong>
                {state?.obsidian?.syncing
                  ? 'Skriver…'
                  : state?.obsidian?.configured
                    ? 'Kopplat'
                    : 'Välj valv'}
              </strong>
            </span>
          </button>
          <button
            className="button text-button setup-button"
            onClick={() => setDrawer('setup')}
          >
            <span aria-hidden="true">⚙</span> Maskinrum
          </button>
        </div>
      </header>

      <main>
        <section className="mission-bar" aria-label="Uppdragets status">
          <div className="mission-title">
            <span className="eyebrow">EXPEDITION 001</span>
            <h1>
              Kurs mot Göteborg<span>.</span>
            </h1>
          </div>
          <div className="mission-stats">
            <div>
              <strong>
                {companies.length}
                <span> / {state?.goal || 10}</span>
              </strong>
              <small>FÖRETAG I LASTEN</small>
            </div>
            <div>
              <strong>{ready.toString().padStart(2, '0')}</strong>
              <small>GRANSKNINGSUTKAST</small>
            </div>
            <div className="mission-live">
              <span
                className={`signal ${state?.running && !state.paused ? 'online' : ''}`}
              />
              <span>
                {runningLabel}
                <small>
                  {working.length} aktiva · {queued.length} i kön
                </small>
              </span>
            </div>
          </div>
        </section>

        {error && (
          <div role="alert" className="message error-message">
            <span>!</span>
            <p>{error}</p>
            <button
              aria-label="Stäng felmeddelande"
              onClick={() => setError('')}
            >
              ×
            </button>
          </div>
        )}
        {notice && (
          <output aria-live="polite" className="message success-message">
            <span>✓</span>
            <p>{notice}</p>
            <button aria-label="Stäng meddelande" onClick={() => setNotice('')}>
              ×
            </button>
          </output>
        )}

        <div className="bridge-layout">
          <section className="world-panel" aria-label="DivineList pixelskepp">
            <div className="world-toolbar">
              <div>
                <span className="tiny-square" /> SKEPPET{' '}
                <span className="muted">/ BESÄTTNING</span>
              </div>
              <span className="crew-count">
                01 KAPTEN <span>+</span> 05 AGENTROLLER
              </span>
            </div>
            <ShipScene
              selected={selected}
              onSelect={selectRole}
              workingRoles={workingRoles}
              queued={queued.length + working.length}
              active={Boolean(
                (state?.running && !state.paused && working.length) ||
                state?.obsidian?.syncing,
              )}
            />
            <div className="crew-roster" aria-label="Välj besättningsmedlem">
              {crew.map((person) => (
                <button
                  className={`roster-button ${selected === person.id ? 'selected' : ''}`}
                  key={person.id}
                  aria-pressed={selected === person.id}
                  onClick={() => selectRole(person.id)}
                >
                  <span className={`role-indicator role-${person.id}`} />
                  <span>
                    {person.name}
                    <small>
                      {person.id === 'captain'
                        ? 'Du har befälet'
                        : working.some((job) => job.role === person.id)
                          ? 'Arbetar'
                          : queued.some((job) => job.role === person.id)
                            ? 'Uppdrag i kön'
                            : 'Inväntar order'}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          </section>

          <aside
            className="inspector"
            ref={inspectorRef}
            aria-label={`${selectedCrew.name}: kontrollpanel`}
          >
            <div className="inspector-top">
              <span className="eyebrow">
                {selected === 'captain'
                  ? 'KOMMANDOBRYGGAN'
                  : `BESÄTTNING / ${selectedCrew.number}`}
              </span>
              <span className="inspector-id">DL—{selectedCrew.number}</span>
            </div>
            <div className="crew-profile">
              <div className={`profile-avatar role-${selected}`}>
                <PixelPerson role={selected} big />
              </div>
              <div>
                <h2>{selectedCrew.name}</h2>
                <p>{selectedCrew.task}</p>
                <span className="crew-tag">
                  {selected === 'captain'
                    ? 'MÄNNISKA · DU'
                    : 'LOKAL AI · OLLAMA'}
                </span>
              </div>
            </div>
            {selected === 'captain' ? (
              <>
                <div className="captain-brief">
                  <span className="eyebrow">DAGENS UPPDRAG</span>
                  <p>
                    Hitta företagskandidater i Göteborg. Undersök deras
                    webbplatser och bygg ett källbundet granskningsunderlag.
                  </p>
                </div>
                <div className="config-fields">
                  <label htmlFor="company-goal">
                    Mål för företagslistan <span>max 500</span>
                  </label>
                  <div className="goal-input">
                    <input
                      id="company-goal"
                      type="number"
                      min="1"
                      max="500"
                      value={goal}
                      disabled={busy || state?.running}
                      onChange={(event) => setGoal(event.target.value)}
                    />
                    <span>företag</span>
                  </div>
                  <label htmlFor="captain-model">Gemensam lokal modell</label>
                  <select
                    id="captain-model"
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                    disabled={busy || state?.running}
                  >
                    <option value="">Välj installerad modell</option>
                    {state?.ollama.models.map((name) => (
                      <option value={name} key={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="automation-control">
                  <div>
                    <strong>Automatisk agentkedja</strong>
                    <span>
                      Spanaren → Kartografen → Analytikern → Granskaren →
                      Skrivaren
                    </span>
                  </div>
                  <button
                    type="button"
                    className={`automation-toggle ${state?.autoWorkflow ? 'is-on' : 'is-off'}`}
                    aria-pressed={Boolean(state?.autoWorkflow)}
                    disabled={busy || !state}
                    onClick={toggleAutomation}
                  >
                    {state?.autoWorkflow ? 'PÅ' : 'AV'}
                  </button>
                </div>
                <p className="automation-help">
                  {state?.autoWorkflow
                    ? 'På: nästa roll och nästa lead fortsätter automatiskt. Du granskar fortfarande slutresultatet.'
                    : 'Av: inga nya automatiska överlämningar startar. Ett redan pågående delsteg sparas först.'}
                </p>
                {!engineReady && (
                  <div className="connection-note">
                    <span className="signal" />
                    <p>
                      {state?.ollama.available
                        ? 'Välj en installerad modell för AI-uppdrag.'
                        : 'Ollama väntar på anslutning.'}
                      <button onClick={() => setDrawer('setup')}>
                        Öppna maskinrummet →
                      </button>
                    </p>
                  </div>
                )}
                <button
                  className="button primary start-button"
                  disabled={
                    busy ||
                    !state ||
                    !engineReady ||
                    !state.autoWorkflow ||
                    !hasResearchWork ||
                    Boolean(state.running)
                  }
                  onClick={() => void control('start')}
                >
                  <span aria-hidden="true">▶</span>{' '}
                  {state?.autoWorkflow
                    ? hasResearchWork
                      ? 'Starta Göteborgsresearch'
                      : `Målet ${state.goal} är redan uppnått av verifieringsbara kandidater`
                    : 'Aktivera kedjan för research'}
                </button>
                <p className="control-footnote">
                  Hämtar offentliga företagskandidater. Webbgranskning använder
                  din lokala modell.{' '}
                  {!hasResearchWork && state
                    ? `Alla ${activeCompanyCount} verifieringsbara kandidater är behandlade. Höj målet över ${activeCompanyCount} för att hämta fler. `
                    : ''}
                  {state?.obsidian?.enabled
                    ? 'Besättningen skriver utkast direkt i din valda Obsidian-mapp.'
                    : 'Koppla Obsidian i maskinrummet för automatisk dokumentation.'}
                </p>
              </>
            ) : (
              <>
                <p className="agent-description">
                  {selected === 'scout'
                    ? 'Planerar nästa sökning och hjälper dig avgränsa vilka företag skeppet ska leta efter.'
                    : selected === 'mapper'
                      ? 'Hjälper dig strukturera identiteter, källor och domäner så att underlaget går att följa.'
                      : selected === 'analyst'
                        ? 'Analyserar insamlat webbinnehåll och föreslår konkreta förbättringar med tydliga osäkerheter.'
                        : selected === 'reviewer'
                          ? 'Letar efter luckor och osäkra slutsatser. Det slutliga granskningsbeslutet är ditt.'
                          : 'Skriver företagskort och rapporter till din valda Obsidian-mapp. Varje skrivning läses tillbaka och visas i listan.'}
                </p>
                {selected === 'scribe' && (
                  <div className="scribe-actions">
                    <button
                      className="button secondary"
                      disabled={
                        busy ||
                        state?.running ||
                        state?.obsidian?.syncing ||
                        !state?.obsidian?.enabled ||
                        !companies.length
                      }
                      onClick={syncObsidian}
                    >
                      Skriv listan till Obsidian
                    </button>
                    {state?.obsidian?.mapUri && (
                      <a className="inline-button" href={state.obsidian.mapUri}>
                        Öppna verifieringskartan ↗
                      </a>
                    )}
                    {!state?.obsidian?.configured && (
                      <button
                        className="inline-button"
                        onClick={() => setDrawer('setup')}
                      >
                        Välj Obsidian-valv →
                      </button>
                    )}
                  </div>
                )}
                <label className="field-label" htmlFor="agent-order">
                  Skriv en rådgivande order
                </label>
                <textarea
                  id="agent-order"
                  rows={5}
                  maxLength={2000}
                  placeholder={rolePrompts[selected]}
                  value={instruction}
                  onChange={(event) => setInstruction(event.target.value)}
                />
                <div className="order-meta">
                  <button
                    className="inline-button"
                    onClick={() => setInstruction(rolePrompts[selected])}
                  >
                    Använd exempel
                  </button>
                  <span>{instruction.length}/2000</span>
                </div>
                <button
                  className="button primary"
                  disabled={busy || !state || !instruction.trim()}
                  onClick={() =>
                    void act(async () => {
                      await post('/api/command', {
                        role: selected,
                        instruction: instruction.trim(),
                      });
                      setInstruction('');
                    }, 'Ordern ligger i kön. Tryck Kör kön när besättningen ska börja.')
                  }
                >
                  <span aria-hidden="true">+</span> Lägg i kön
                </button>
                <p className="control-footnote">
                  Ordern behandlas när du kör kön. Modellen får din instruktion
                  och köantal, inte företagens rapporter, och ger generella råd.
                </p>
                <p className="voice-note">
                  TANGENTBORD AKTIVT · Röst inte installerad
                </p>
                {crewJobs.length > 0 && (
                  <div className="recent-order">
                    <span className="eyebrow">SENASTE UPPDRAG</span>
                    <p>
                      {crewJobs[crewJobs.length - 1].instruction ||
                        (crewCompany
                          ? `Webbunderlag: ${crewCompany.name}`
                          : 'Företagsinsamling i Göteborg')}
                    </p>
                    <span
                      className={`status-badge status-${crewJobs[crewJobs.length - 1].status}`}
                    >
                      {statusNames[crewJobs[crewJobs.length - 1].status] ||
                        crewJobs[crewJobs.length - 1].status}
                    </span>
                    {crewCompany && (
                      <div className="scribe-actions">
                        <button
                          className="inline-button"
                          onClick={() => {
                            setSelectedCompany(crewCompany.id);
                            setDrawer('company');
                          }}
                        >
                          Visa källor och underlag →
                        </button>
                        <NoteLink note={notes.get(crewCompany.id)} />
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
            <div className="queue-controls" aria-label="Styr arbetskön">
              <button
                className="button secondary"
                disabled={
                  busy ||
                  !state ||
                  !engineReady ||
                  (state.running && !state.paused) ||
                  !queued.length
                }
                onClick={() => void control('resume')}
              >
                ▶ {state?.paused ? 'Fortsätt' : 'Kör kön'}
              </button>
              <button
                className="button secondary"
                disabled={busy || !state?.running || state.paused}
                onClick={() => void control('pause')}
              >
                Ⅱ Pausa
              </button>
              <button
                className="button stop"
                disabled={busy || !state || (!state.running && !queued.length)}
                onClick={() => void control('stop')}
              >
                ■ Stopp
              </button>
            </div>
            <div className="one-model-note">
              <span>◈</span>
              <p>
                Fem roller. <strong>En modell åt gången.</strong>
                <br />
                Arbetskön håller minnesanvändningen nere.
              </p>
            </div>
          </aside>
        </div>

        <section
          className="cargo-panel"
          aria-label="Företag, arbetskö och logg"
        >
          <div className="cargo-top">
            <div
              className="cargo-tabs"
              role="tablist"
              aria-label="Skeppets register"
            >
              {(
                [
                  ['companies', 'Företagslast', companies.length],
                  ['jobs', 'Arbetskö', queued.length + working.length],
                  ['log', 'Skeppslogg', state?.events.length || 0],
                ] as const
              ).map(([id, name, count]) => (
                <button
                  role="tab"
                  id={`tab-${id}`}
                  aria-selected={tab === id}
                  aria-controls={`panel-${id}`}
                  tabIndex={tab === id ? 0 : -1}
                  onKeyDown={(event) => {
                    if (
                      event.key === 'ArrowRight' ||
                      event.key === 'ArrowLeft'
                    ) {
                      event.preventDefault();
                      const ids = ['companies', 'jobs', 'log'] as const;
                      const next =
                        ids[
                          (ids.indexOf(tab) +
                            (event.key === 'ArrowRight' ? 1 : 2)) %
                            3
                        ];
                      setTab(next);
                      document.getElementById(`tab-${next}`)?.focus();
                    }
                  }}
                  onClick={() => setTab(id)}
                  key={id}
                >
                  {name} <span>{count}</span>
                </button>
              ))}
            </div>
            <div className="cargo-actions">
              <input
                ref={importRef}
                type="file"
                multiple
                accept=".md,.json"
                className="visually-hidden"
                aria-label="Importera Markdown- eller JSON-filer"
                onChange={(event) => void importFiles(event.target.files)}
              />
              <button
                className="button text-button"
                disabled={busy || !state}
                onClick={() => importRef.current?.click()}
              >
                ↥ Importera
              </button>
              <a
                className={`button text-button ${companies.length ? '' : 'disabled'}`}
                href="/api/export?format=markdown"
                download
                aria-disabled={!companies.length}
                onClick={(event) => {
                  if (!companies.length) event.preventDefault();
                }}
              >
                ↧ Markdown
              </a>
              <a
                className={`button text-button ${companies.length ? '' : 'disabled'}`}
                href="/api/export?format=json"
                download
                aria-disabled={!companies.length}
                onClick={(event) => {
                  if (!companies.length) event.preventDefault();
                }}
              >
                JSON
              </a>
            </div>
          </div>
          <div
            id={`panel-${tab}`}
            role="tabpanel"
            aria-labelledby={`tab-${tab}`}
          >
            {tab === 'companies' &&
              (companies.length ? (
                <>
                  <div className="inventory-search">
                    <label htmlFor="company-search">Sök i lasten</label>
                    <input
                      id="company-search"
                      value={filter}
                      onChange={(event) => setFilter(event.target.value)}
                      placeholder="Företagsnamn eller domän…"
                    />
                    <span>{visibleCompanies.length} företag</span>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Företag / domän</th>
                          <th>Källa</th>
                          <th>Status</th>
                          <th>Underlag</th>
                          <th>Obsidian</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleCompanies.slice(0, 500).map((item) => (
                          <tr key={item.id}>
                            <td>
                              <button
                                className="company-link"
                                onClick={() => {
                                  setSelectedCompany(item.id);
                                  setDrawer('company');
                                }}
                              >
                                {item.name}
                              </button>
                              <small>
                                {item.domain || 'Domän behöver verifieras'}
                              </small>
                            </td>
                            <td>
                              {safeUrl(item.sourceUrl) ? (
                                <a
                                  href={safeUrl(item.sourceUrl)!}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {item.sourceKind || 'Öppna källa'} ↗
                                </a>
                              ) : (
                                item.sourceKind || 'Importerad'
                              )}
                            </td>
                            <td>
                              <span
                                className={`status-badge status-${item.status}`}
                              >
                                {statusNames[item.status] || item.status}
                              </span>
                            </td>
                            <td>
                              {item.report
                                ? `${item.report.suggestions.length} förslag`
                                : item.error
                                  ? 'Se hinder'
                                  : 'Inväntar analys'}
                            </td>
                            <td>
                              <NoteLink note={notes.get(item.id)} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!visibleCompanies.length && (
                      <p className="no-results">
                        Inga företag matchar din sökning.
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <div className="empty-cargo">
                  <div className="empty-crate" aria-hidden="true">
                    <i />
                    <i />
                  </div>
                  <div>
                    <h3>Lastutrymmet är redo.</h3>
                    <p>
                      Starta en expedition eller importera företagsanteckningar
                      från Obsidian.
                      <br />
                      Här samlas riktiga källor, webbplatsfynd och agenternas
                      utkast.
                    </p>
                    <button
                      className="inline-button"
                      disabled={busy || !state}
                      onClick={() => importRef.current?.click()}
                    >
                      Importera dina första anteckningar →
                    </button>
                  </div>
                  <span className="empty-stamp">
                    VÄNTAR PÅ
                    <br />
                    FÖRSTA LASTEN
                  </span>
                </div>
              ))}
            {tab === 'jobs' &&
              (jobs.length ? (
                <div className="job-list">
                  {[...jobs]
                    .reverse()
                    .slice(0, 100)
                    .map((job) => (
                      <details className="job-row" key={job.id}>
                        <summary>
                          <span className={`role-indicator role-${job.role}`} />
                          <strong>
                            {crew.find((person) => person.id === job.role)
                              ?.name || job.role}
                          </strong>
                          <span className="job-instruction">
                            {job.instruction ||
                              (job.kind === 'discovery'
                                ? 'Hitta företagskandidater i Göteborg'
                                : companies.find(
                                    (item) => item.id === job.companyId,
                                  )?.name || job.kind)}
                          </span>
                          <span className={`status-badge status-${job.status}`}>
                            {statusNames[job.status] || job.status}
                          </span>
                          <span className="job-expand">+</span>
                        </summary>
                        <div className="job-result">
                          {job.result ||
                            job.error ||
                            'Inget resultat ännu. Uppdraget måste köras klart först.'}
                        </div>
                      </details>
                    ))}
                </div>
              ) : (
                <div className="small-empty">
                  <span>≡</span>
                  <h3>Besättningen väntar på din första order.</h3>
                  <p>
                    Välj en roll på skeppet eller starta Göteborgsresearch från
                    kommandobryggan.
                  </p>
                </div>
              ))}
            {tab === 'log' &&
              (state?.events.length ? (
                <ol className="event-list">
                  {[...state.events]
                    .reverse()
                    .slice(0, 80)
                    .map((event) => (
                      <li key={event.id}>
                        <time dateTime={event.at}>{formatTime(event.at)}</time>
                        <span>{event.message}</span>
                      </li>
                    ))}
                </ol>
              ) : (
                <div className="small-empty">
                  <span>⌁</span>
                  <h3>En ny sida i skeppsloggen.</h3>
                  <p>
                    Här visas stationens verkliga händelser, anslutningar och
                    eventuella hinder.
                  </p>
                </div>
              ))}
          </div>
        </section>
        <footer className="station-footer">
          <span>
            <span className="tiny-square" /> DIVINELIST STATION / LOKAL
            FÖRHANDSVERSION
          </span>
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer"
          >
            Kartkälla: © OpenStreetMap contributors · ODbL
          </a>
          <a href="http://127.0.0.1:8787/" target="_blank" rel="noreferrer">
            Öppna granskningsappen ↗
          </a>
        </footer>
      </main>

      {drawer && (
        <div className="drawer-backdrop">
          <dialog
            open
            className="drawer"
            aria-modal="true"
            aria-labelledby="drawer-title"
            onKeyDown={(event) => {
              if (event.key !== 'Tab') return;
              const elements = Array.from(
                event.currentTarget.querySelectorAll<HTMLElement>(
                  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
                ),
              );
              const first = elements[0];
              const last = elements[elements.length - 1];
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
              }
            }}
          >
            <div className="drawer-heading">
              <span className="eyebrow">
                {drawer === 'setup' ? 'MASKINRUMMET' : 'FÖRETAGSUNDERLAG'}
              </span>
              <button
                ref={drawerCloseRef}
                className="close-button"
                aria-label="Stäng panel"
                onClick={() => setDrawer(null)}
              >
                ×
              </button>
            </div>
            {drawer === 'setup' ? (
              <>
                <h2 id="drawer-title">Din dator. Din besättning.</h2>
                <p className="drawer-intro">
                  Stationen styr en lokal arbetskö. Agentrollerna delar samma
                  Ollama-modell och arbetar i turordning.
                </p>
                <div className="setup-status">
                  <span
                    className={`signal ${state?.ollama.available ? 'online' : ''}`}
                  />
                  <div>
                    <strong>
                      Ollama{' '}
                      {state?.ollama.available
                        ? 'är ansluten'
                        : 'är inte ansluten'}
                    </strong>
                    <p>
                      {state?.ollama.error ||
                        (state?.ollama.available
                          ? `${state.ollama.models.length} installerade modeller hittades.`
                          : 'Stationen söker på 127.0.0.1:11434.')}
                    </p>
                  </div>
                </div>
                <button
                  className="button secondary"
                  disabled={busy || !state}
                  onClick={() =>
                    void act(
                      () => post('/api/probe', {}),
                      'Anslutningen är kontrollerad.',
                    )
                  }
                >
                  ↻ Kontrollera anslutningen
                </button>
                <div className="setup-section">
                  <h3>01 / Koppla in motorn</h3>
                  <p>
                    Installera och starta Ollama på datorn. Hämta en liten
                    modell som passar tillgängligt minne och välj den på
                    kommandobryggan.
                  </p>
                  <a
                    className="inline-button"
                    href="https://ollama.com/download/windows"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Öppna Ollamas nedladdning ↗
                  </a>
                  <p className="subtle">
                    Modeller laddas inte ned automatiskt av stationen.
                  </p>
                </div>
                <div className="setup-section">
                  <h3>02 / Håll expeditionen lätt</h3>
                  <dl className="machine-stats">
                    <div>
                      <dt>Ledigt arbetsminne</dt>
                      <dd>
                        {state
                          ? `${state.hardware.freeRamGB.toFixed(1)} GB av ${state.hardware.totalRamGB.toFixed(0)} GB`
                          : 'Läser av…'}
                      </dd>
                    </div>
                    {state?.hardware.gpuName && (
                      <div>
                        <dt>Grafikkort</dt>
                        <dd>{state.hardware.gpuName}</dd>
                      </div>
                    )}
                    {state?.hardware.freeVramGB !== undefined && (
                      <div>
                        <dt>Ledigt grafikminne</dt>
                        <dd>{state.hardware.freeVramGB.toFixed(1)} GB</dd>
                      </div>
                    )}
                    <div>
                      <dt>Samtidiga AI-uppdrag</dt>
                      <dd>1</dd>
                    </div>
                  </dl>
                  <p>
                    Börja med ett litet urval. Målet 500 är en gräns för listan,
                    inte ett löfte om hur mycket datorn hinner på en dag.
                  </p>
                </div>
                {state?.obsidian && (
                  <ObsidianPanel
                    state={state.obsidian}
                    locked={busy || state.running || state.obsidian.syncing}
                    count={companies.length}
                    onSave={(config) =>
                      void act(
                        () => post('/api/obsidian/config', config),
                        'Obsidian-kopplingen är sparad.',
                      )
                    }
                    onSync={syncObsidian}
                  />
                )}
                <div className="setup-section">
                  <h3>04 / Läs in egna företagsanteckningar</h3>
                  <p>
                    Importera upp till 50 Markdown- eller JSON-filer, högst 256
                    KB per fil och 2 MB totalt. Markdown-filer behöver
                    företagsnamn och webbadress i inledande metadata
                    (frontmatter):
                  </p>
                  <pre className="import-example">
                    {
                      '---\nname: Företagets namn\nwebsite: https://foretagets-domän.se\n---\nDina anteckningar här.'
                    }
                  </pre>
                  <p>
                    JSON kan innehålla en lista med objekt som har fälten{' '}
                    <code>name</code> och <code>website</code>.
                    Företagsidentiteten importeras; fri anteckningstext körs
                    inte som instruktioner.
                  </p>
                  <p>
                    Stationen läser företagsuppgifter från filerna du väljer. Du
                    kan även ladda ned Markdown eller JSON som en separat
                    export.
                  </p>
                </div>
                <div className="setup-section">
                  <h3>Vad gör rollerna?</h3>
                  <p>
                    Spanaren planerar, Kartografen ordnar underlaget,
                    Analytikern undersöker, Granskaren markerar osäkerheter och
                    Skrivaren sammanfattar. Fria order ger generella råd utifrån
                    din instruktion och köantal. Företagens rapporter skickas
                    inte med i dessa samtal.
                  </p>
                  <p>
                    Knappen Göteborgsresearch startar den byggda kedjan för
                    offentlig företagsinsamling och webbgranskning. Källor kan
                    vara ofullständiga eller blockerade; det framgår i
                    resultatet.
                  </p>
                </div>
                <div className="setup-section">
                  <h3>Du har befälet</h3>
                  <p>
                    Pausa avbryter pågående anrop och lägger jobbet tillbaka i
                    kön. Stopp avbryter aktiva och väntande jobb. Servern och
                    datorn behöver vara igång för att arbetet ska fortsätta.
                    Utkast kräver din granskning innan de används.
                  </p>
                  <p>
                    Röststyrning är inte installerad. Skriv order i
                    besättningens kontrollpanel.
                  </p>
                </div>
              </>
            ) : company ? (
              <>
                <h2 id="drawer-title">{company.name}</h2>
                <p className="drawer-intro">
                  {company.domain || 'Domän saknas — behöver verifieras'}
                </p>
                <div className="company-obsidian">
                  <span>OBSIDIAN</span>{' '}
                  <NoteLink note={notes.get(company.id)} />
                  {notes.get(company.id)?.cardUri && (
                    <a
                      className="inline-button"
                      href={notes.get(company.id)!.cardUri}
                    >
                      Öppna mitt företagskort ↗
                    </a>
                  )}
                </div>
                <div className="company-identity">
                  <p>
                    <strong>Identitet:</strong> Företagskandidat – behöver
                    verifieras.
                  </p>
                  <p>
                    <strong>Göteborg:</strong>{' '}
                    {company.sourceKind === 'openstreetmap'
                      ? 'Kartpost inom kommun 1480. Verksamhetens aktuella tillhörighet behöver verifieras.'
                      : 'Unknown - needs verification.'}
                  </p>
                </div>
                <span className={`status-badge status-${company.status}`}>
                  {statusNames[company.status]}
                </span>
                <div className="setup-section">
                  <h3>Källspår</h3>
                  {safeUrl(company.sourceUrl) ? (
                    <a
                      href={safeUrl(company.sourceUrl)!}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Öppna ursprungskälla ↗
                    </a>
                  ) : (
                    <p className="source-file">
                      {company.sourceKind === 'obsidian_import'
                        ? 'Importerad fil: '
                        : 'Källa: '}
                      {company.sourceUrl || 'Källreferens saknas'}
                    </p>
                  )}
                  <p>
                    Insamlad:{' '}
                    {new Date(company.observedAt).toLocaleString('sv-SE')}
                  </p>
                  {company.facts?.url && safeUrl(company.facts.url) && (
                    <p>
                      <a
                        href={safeUrl(company.facts.url)!}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Öppna undersökt webbsida ↗
                      </a>
                    </p>
                  )}
                  {company.facts?.sha256 && (
                    <p className="hash-text">SHA-256: {company.facts.sha256}</p>
                  )}
                </div>
                {company.error && (
                  <div className="company-error">{company.error}</div>
                )}
                {company.facts && (
                  <div className="setup-section">
                    <h3>Observerat i webbinnehållet</h3>
                    <dl className="machine-stats">
                      <div>
                        <dt>Sidtitel</dt>
                        <dd>{company.facts.title || 'Saknas i underlaget'}</dd>
                      </div>
                      <div>
                        <dt>HTTP-status</dt>
                        <dd>{company.facts.statusCode ?? 'Okänd'}</dd>
                      </div>
                      <div>
                        <dt>Viewport-tagg</dt>
                        <dd>
                          {company.facts.hasViewport === undefined
                            ? 'Okänd'
                            : company.facts.hasViewport
                              ? 'Finns'
                              : 'Saknas i hämtad HTML'}
                        </dd>
                      </div>
                      <div>
                        <dt>Språkmarkering</dt>
                        <dd>{company.facts.lang || 'Saknas i underlaget'}</dd>
                      </div>
                    </dl>
                    <p className="subtle">
                      HTML-observationer är inte en visuell
                      användbarhetsgranskning.
                    </p>
                  </div>
                )}
                {company.report ? (
                  <>
                    <div className="setup-section">
                      <h3>Agentens sammanfattning</h3>
                      <p>{company.report.summary}</p>
                    </div>
                    <div className="setup-section">
                      <h3>Förbättringsförslag</h3>
                      <ul className="report-list">
                        {company.report.suggestions.map((suggestion, index) => (
                          <li key={index}>{suggestion}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="setup-section">
                      <h3>Okänt / behöver verifieras</h3>
                      <ul className="report-list">
                        {company.report.unknowns.map((unknown, index) => (
                          <li key={index}>{unknown}</li>
                        ))}
                      </ul>
                    </div>
                  </>
                ) : (
                  <p className="setup-section">
                    Ingen AI-rapport finns ännu för företaget.
                  </p>
                )}
              </>
            ) : (
              <h2 id="drawer-title">Företaget hittades inte.</h2>
            )}
          </dialog>
        </div>
      )}
    </div>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
