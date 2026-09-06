'use client';

import { AlertCircle, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';

export default function ErrorBoundary({ reset }: { reset: () => void }) {
  return (
    <main className="grid min-h-screen place-items-center bg-background p-6 text-foreground">
      <section
        role="alert"
        aria-labelledby="unexpected-error-title"
        className="w-full max-w-lg rounded-2xl border border-rose-500/25 bg-card p-6 shadow-lg"
      >
        <span className="mb-4 grid size-11 place-items-center rounded-xl bg-rose-500/10 text-rose-800">
          <AlertCircle className="size-5" aria-hidden="true" />
        </span>
        <h1 id="unexpected-error-title" className="text-xl font-semibold">
          DivineList kunde inte visa den här vyn
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Ingen webbplats, databas eller extern tjänst har ändrats. Försök läsa
          om den lokala vyn. Om felet återkommer, behåll dina exporterade filer
          och kör releasekontrollen innan du fortsätter.
        </p>
        <Button type="button" className="mt-5" onClick={reset}>
          <RotateCcw /> Försök igen
        </Button>
      </section>
    </main>
  );
}
