import React, { useEffect, useState } from 'react';

export type ObsidianCompany = {
  id: string;
  name: string;
  status: 'written' | 'unchanged' | 'conflict' | 'saved';
  cardUri?: string;
  reportUri?: string;
  readBackVerified: boolean;
  error?: string;
};
export type ObsidianState = {
  configured: boolean;
  enabled: boolean;
  syncing: boolean;
  vaultPath: string | null;
  folder: string | null;
  targetPath?: string | null;
  lastSync?: string | null;
  written: number;
  unchanged: number;
  companies: ObsidianCompany[];
  conflicts: { id: string; name: string; message: string }[];
  error?: string | null;
  overviewUri?: string | null;
  mapUri?: string | null;
};

export function NoteLink({ note }: { note?: ObsidianCompany }) {
  if (!note) return <span className="subtle">Inte skrivet</span>;
  if (note.status === 'conflict')
    return (
      <span className="note-conflict" title={note.error}>
        Skrivkonflikt
      </span>
    );
  return (
    <a className="note-link" href={note.cardUri || note.reportUri}>
      {note.readBackVerified
        ? '✓ Öppna verifieringskort'
        : 'Öppna sparat underlag'}{' '}
      ↗
    </a>
  );
}

export function ObsidianPanel({
  state,
  locked,
  count,
  onSave,
  onSync,
}: {
  state: ObsidianState;
  locked: boolean;
  count: number;
  onSave: (config: {
    vaultPath: string;
    folder: string;
    enabled: boolean;
  }) => void;
  onSync: () => void;
}) {
  const [vaultPath, setVaultPath] = useState(state.vaultPath || '');
  const [folder, setFolder] = useState(state.folder || 'Agentstation');
  const [enabled, setEnabled] = useState(
    state.configured ? state.enabled : true,
  );
  const [vaults, setVaults] = useState<{ name: string; path: string }[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/obsidian/vaults', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            'Kunde inte läsa Obsidian-listan. Du kan ange sökvägen själv.',
          );
        const result: unknown = await response.json();
        const rows = Array.isArray(result)
          ? result
          : result && typeof result === 'object' && 'vaults' in result
            ? result.vaults
            : [];
        setVaults(
          Array.isArray(rows)
            ? rows.filter(
                (item: unknown): item is { name: string; path: string } =>
                  Boolean(
                    item &&
                    typeof item === 'object' &&
                    'name' in item &&
                    typeof item.name === 'string' &&
                    'path' in item &&
                    typeof item.path === 'string',
                  ),
              )
            : [],
        );
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Kunde inte läsa valvlistan.',
          );
      });
    return () => controller.abort();
  }, []);
  const changed =
    vaultPath !== (state.vaultPath || '') ||
    folder !== (state.folder || 'Agentstation') ||
    enabled !== state.enabled;
  return (
    <section
      className="setup-section obsidian-settings"
      aria-label="Obsidian-inställningar"
    >
      <h3>03 / Koppla ditt Obsidian-valv</h3>
      <p>
        Välj var besättningen ska skriva företagskort, rapporter och en gemensam
        översikt. Dina egna anteckningar på korten bevaras.
      </p>
      {vaults.length > 0 && (
        <>
          <label htmlFor="known-vault">Dina Obsidian-valv</label>
          <select
            id="known-vault"
            value={
              vaults.some((vault) => vault.path === vaultPath) ? vaultPath : ''
            }
            disabled={locked}
            onChange={(event) => setVaultPath(event.target.value)}
          >
            <option value="">Välj valv eller ange sökväg nedan</option>
            {vaults.map((vault) => (
              <option key={vault.path} value={vault.path}>
                {vault.name} · {vault.path}
              </option>
            ))}
          </select>
        </>
      )}
      <label htmlFor="vault-path">Sökväg till befintligt valv</label>
      <input
        id="vault-path"
        value={vaultPath}
        onChange={(event) => setVaultPath(event.target.value)}
        disabled={locked}
        placeholder="C:\Users\…\Mitt valv"
        spellCheck={false}
      />
      <label htmlFor="vault-folder">Arbetsmapp i valvet</label>
      <input
        id="vault-folder"
        value={folder}
        onChange={(event) => setFolder(event.target.value)}
        disabled={locked}
        placeholder="Agentstation"
        spellCheck={false}
      />
      <label className="obsidian-toggle">
        <input
          type="checkbox"
          checked={enabled}
          disabled={locked}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        <span>Skriv automatiskt när jag startar ett uppdrag</span>
      </label>
      <button
        className="button secondary"
        disabled={
          locked ||
          !vaultPath.trim() ||
          !folder.trim() ||
          (!changed && state.configured)
        }
        onClick={() =>
          onSave({
            vaultPath: vaultPath.trim(),
            folder: folder.trim(),
            enabled,
          })
        }
      >
        Spara Obsidian-koppling
      </button>
      <p className="subtle">
        Kopplingen sparar ditt val. Företagsfiler skrivs när du startar kön
        eller trycker Skriv listan nu.
      </p>
      {error && <p className="note-conflict">{error}</p>}
      {state.configured && (
        <div className="obsidian-connection">
          <strong>
            {state.syncing
              ? 'Skrivaren arbetar…'
              : state.enabled
                ? 'Automatisk skrivning aktiverad'
                : 'Automatisk skrivning avstängd'}
          </strong>
          <p className="vault-target">{state.targetPath}</p>
          <p>
            {state.lastSync
              ? `Senast återläst: ${new Date(state.lastSync).toLocaleString('sv-SE')}`
              : 'Ingen lista har skrivits ännu.'}
          </p>
          <p>
            {state.companies.filter((note) => note.readBackVerified).length}{' '}
            återlästa kort · {state.conflicts.length} konflikter
          </p>
          <div className="obsidian-actions">
            <button
              className="button primary"
              disabled={
                locked || state.syncing || !count || !state.enabled || changed
              }
              onClick={onSync}
            >
              Skriv listan nu
            </button>
            {state.mapUri && (
              <a className="button secondary" href={state.mapUri}>
                Öppna verifieringskartan ↗
              </a>
            )}
          </div>
          {state.error && <p className="note-conflict">{state.error}</p>}
          {state.conflicts.length > 0 && (
            <ul className="report-list note-conflict">
              {state.conflicts.map((conflict) => (
                <li key={conflict.id}>
                  {conflict.name}: {conflict.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
