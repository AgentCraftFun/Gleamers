'use client';

import { DEPLOY_VOICES } from '@gleamers/shared';
import type { DeployFormInput } from '@/lib/deploy/validate';
import { cn } from '@/lib/utils';

interface Props {
  form: DeployFormInput;
  updateForm: (patch: Partial<DeployFormInput>) => void;
}

export function VoiceStep({ form, updateForm }: Props) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">2. Voice</h2>
        <p className="text-sm text-muted-foreground">
          Pick a Cartesia voice. Live previews ship with the voice-preview
          service — for now you&apos;ll hear the voice on first monologue.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {DEPLOY_VOICES.map((v) => {
          const selected = form.voice_id === v.id;
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => updateForm({ voice_id: v.id })}
              className={cn(
                'flex flex-col gap-1 rounded-lg border p-3 text-left transition',
                selected
                  ? 'border-primary bg-primary/10 ring-2 ring-primary'
                  : 'border-border bg-card hover:border-primary/50',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{v.label}</span>
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  {v.accent}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{v.vibe}</p>
              <code className="mt-1 break-all text-[10px] text-muted-foreground/70">
                {v.id}
              </code>
            </button>
          );
        })}
      </div>
    </div>
  );
}
