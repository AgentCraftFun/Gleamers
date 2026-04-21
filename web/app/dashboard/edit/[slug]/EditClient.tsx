'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { PersonalityStep } from '@/components/deploy/steps/PersonalityStep';
import type { DeployFormInput } from '@/lib/deploy/validate';

interface Props {
  slug: string;
  initialForm: DeployFormInput;
}

export function EditClient({ slug, initialForm }: Props) {
  const router = useRouter();
  const [form, setForm] = useState<DeployFormInput>(initialForm);
  const [state, setState] = useState<'idle' | 'saving' | 'done' | 'error'>(
    'idle',
  );
  const [error, setError] = useState<string | null>(null);

  function updateForm(patch: Partial<DeployFormInput>) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  async function save() {
    setState('saving');
    setError(null);
    try {
      const res = await fetch(
        `/api/streamers/${encodeURIComponent(slug)}/edit`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(form),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState('error');
        setError(body.error ?? `Failed (${res.status})`);
        return;
      }
      setState('done');
      router.refresh();
    } catch (err) {
      setState('error');
      setError(String(err));
    }
  }

  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-8 lg:px-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link
            href="/dashboard"
            className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
          >
            ← Dashboard
          </Link>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            Edit {form.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            Name, voice, and avatar are locked after deploy.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-100">
        Heads up: personality edits take effect{' '}
        <span className="font-semibold">next session</span>. An active
        session keeps its current personality until it self-ends.
      </div>

      <section className="rounded-xl border border-border bg-card p-5">
        <PersonalityStep form={form} updateForm={updateForm} />
      </section>

      {state === 'error' && error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive-foreground">
          {error}
        </div>
      ) : null}
      {state === 'done' ? (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-2 text-sm text-emerald-200">
          Saved. Takes effect on the next session.
        </div>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          onClick={() => router.push('/dashboard')}
          disabled={state === 'saving'}
        >
          Cancel
        </Button>
        <Button onClick={save} disabled={state === 'saving'}>
          {state === 'saving' ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </main>
  );
}
