'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  WORKSPACE_STORAGE_KEY,
  WORKSPACE_WRITE_LOCK,
  readWorkspace,
  writeWorkspace,
  type WorkspaceInput,
  type WorkspaceSnapshot,
} from '@/lib/workbench/workspace-storage';

type Props = WorkspaceInput & {
  hasUnsavedWork: boolean;
  onRestore: (snapshot: WorkspaceSnapshot) => void;
};

export function WorkspaceRecovery({
  dataset,
  evaluatedAt,
  decisions,
  reviewDrafts,
  hasUnsavedWork,
  onRestore,
}: Props) {
  const [existing, setExisting] = useState<WorkspaceSnapshot | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState(
    'Lokalt autosparande är av. Separat sessionsfil är fortfarande din säkerhetskopia.',
  );
  const [failed, setFailed] = useState(false);
  const revisionRef = useRef<string | null>(null);
  const writerRef = useRef('');

  useEffect(() => {
    // Hydrate from browser-only storage without changing the server's initial view.
    const hydration = window.setTimeout(() => {
      writerRef.current = crypto.randomUUID();
      try {
        const restored = readWorkspace(window.localStorage);
        setExisting(restored);
        if (restored)
          setMessage(
            `Sparat arbete finns från ${new Date(restored.savedAt).toLocaleString('sv-SE')}. Återställ det för att fortsätta.`,
          );
        setReady(true);
      } catch (error) {
        setFailed(true);
        setMessage(
          error instanceof Error
            ? error.message
            : 'Det sparade arbetet kunde inte kontrolleras. Använd en separat sessionsfil.',
        );
      }
    }, 0);
    const changedElsewhere = (event: StorageEvent) => {
      if (event.key !== WORKSPACE_STORAGE_KEY && event.key !== null) return;
      setEnabled(false);
      setFailed(true);
      setMessage(
        'En annan flik ändrade det sparade arbetet. Autosparning är stoppad. Spara din öppna session till fil innan du laddar om; inget skrivs över automatiskt.',
      );
    };
    window.addEventListener('storage', changedElsewhere);
    return () => {
      window.clearTimeout(hydration);
      window.removeEventListener('storage', changedElsewhere);
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!navigator.locks) {
        setEnabled(false);
        setFailed(true);
        setMessage(
          'Webbläsaren saknar det lås som behövs för säker autosparning mellan flikar. Använd separat sessionsfil.',
        );
        return;
      }
      void navigator.locks
        .request(WORKSPACE_WRITE_LOCK, () => {
          if (cancelled) return;
          const saved = writeWorkspace(
            window.localStorage,
            { dataset, evaluatedAt, decisions, reviewDrafts },
            {
              expectedRevision: revisionRef.current,
              writerId: writerRef.current,
            },
          );
          revisionRef.current = saved.revision;
          setFailed(false);
          setMessage(
            `Autosparat i denna webbläsare ${new Date(saved.savedAt).toLocaleTimeString('sv-SE')}. Detta är ett arbetsutkast, inte en runtimeimport eller en separat säkerhetskopia.`,
          );
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setEnabled(false);
          setFailed(true);
          setMessage(
            error instanceof Error
              ? error.message
              : 'Autosparningen misslyckades. Spara en separat sessionsfil.',
          );
        });
    }, 900);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, dataset, evaluatedAt, decisions, reviewDrafts]);

  const restore = () => {
    if (!existing || hasUnsavedWork) return;
    revisionRef.current = existing.revision;
    onRestore(existing);
    setExisting(null);
    setEnabled(true);
    setMessage(
      'Det validerade arbetet är återställt. Autosparning är på; tidigare diskbekräftelse är inte återställd.',
    );
  };

  return (
    <section
      aria-label="Sparat lokalt arbete"
      className={`relative z-10 mx-auto mt-4 max-w-[1536px] rounded-xl border p-4 sm:mx-6 lg:mx-auto ${failed ? 'border-amber-300 bg-amber-50' : 'border-border bg-card/80'}`}
    >
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Ditt sparade arbete</h2>
          <p
            role={failed ? 'alert' : 'status'}
            aria-live="polite"
            className="mt-1 text-xs leading-5 text-muted-foreground"
          >
            {message}
          </p>
        </div>
        {existing ? (
          <Button
            variant="outline"
            disabled={hasUnsavedWork || failed}
            onClick={restore}
          >
            Återställ sparat arbete
          </Button>
        ) : (
          <Button
            variant="outline"
            disabled={!ready || failed}
            onClick={() => {
              setEnabled((value) => !value);
              setMessage(
                enabled
                  ? 'Autosparning pausad. Tidigare sparat arbete finns kvar; nya ändringar behöver sparas till fil.'
                  : 'Autosparning aktiverad. Ändringar sparas lokalt i denna webbläsare.',
              );
            }}
          >
            {enabled ? 'Pausa autosparning' : 'Aktivera lokalt autosparande'}
          </Button>
        )}
      </div>
      {existing && hasUnsavedWork && (
        <p className="mt-2 text-xs">
          Spara den öppna sessionen till fil först. Återställning ersätter inte
          osparade beslut eller utkast.
        </p>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        Samma webbläsare och lokala adress krävs för återställning. Rensad
        webbläsardata tar bort arbetskopian. Inga aktiva databaser eller
        valvfiler ändras.
      </p>
    </section>
  );
}
