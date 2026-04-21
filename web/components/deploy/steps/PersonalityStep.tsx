'use client';

import { DEPLOY_LIMITS } from '@gleamers/shared';
import type { DeployFormInput } from '@/lib/deploy/validate';
import { STARTER_TEMPLATES } from '@/lib/deploy/starters';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ListInput } from '@/components/deploy/ListInput';

interface Props {
  form: DeployFormInput;
  updateForm: (patch: Partial<DeployFormInput>) => void;
}

export function PersonalityStep({ form, updateForm }: Props) {
  function applyStarter(key: string) {
    const template = STARTER_TEMPLATES[key];
    if (!template) return;
    updateForm({ ...template.form, name: form.name });
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">1. Personality</h2>
        <p className="text-sm text-muted-foreground">
          This feeds the system prompt. Start from a template or write your own.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {Object.entries(STARTER_TEMPLATES).map(([key, t]) => (
          <Button
            key={key}
            type="button"
            size="sm"
            variant="outline"
            onClick={() => applyStarter(key)}
          >
            {t.label}
          </Button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Name
          </label>
          <input
            value={form.name}
            onChange={(e) =>
              updateForm({ name: e.target.value.slice(0, DEPLOY_LIMITS.nameMax) })
            }
            placeholder="e.g. Mika"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <p className="text-[11px] text-muted-foreground">
            {form.name.length} / {DEPLOY_LIMITS.nameMax}
          </p>
        </div>
        <div className="space-y-1 sm:col-span-1">
          <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Vibe
          </label>
          <input
            value={form.vibe}
            onChange={(e) =>
              updateForm({ vibe: e.target.value.slice(0, DEPLOY_LIMITS.vibeMax) })
            }
            placeholder="one-liner — chaotic? gentle? paranoid?"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <p className="text-[11px] text-muted-foreground">
            {form.vibe.length} / {DEPLOY_LIMITS.vibeMax}
          </p>
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Speech patterns
        </label>
        <textarea
          value={form.speech_patterns}
          onChange={(e) =>
            updateForm({
              speech_patterns: e.target.value.slice(
                0,
                DEPLOY_LIMITS.speechPatternsMax,
              ),
            })
          }
          rows={2}
          placeholder="all lowercase / short sentences / asks rhetorical questions"
          className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Backstory
        </label>
        <textarea
          value={form.backstory}
          onChange={(e) =>
            updateForm({
              backstory: e.target.value.slice(0, DEPLOY_LIMITS.backstoryMax),
            })
          }
          rows={4}
          placeholder="short origin story the AI can reference"
          className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <p className="text-[11px] text-muted-foreground">
          {form.backstory.length} / {DEPLOY_LIMITS.backstoryMax}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <ListInput
          label="Core opinions"
          value={form.core_opinions}
          onChange={(v) => updateForm({ core_opinions: v })}
          max={DEPLOY_LIMITS.coreOpinionsMax}
          placeholder="one belief at a time"
        />
        <ListInput
          label="Likes"
          value={form.likes}
          onChange={(v) => updateForm({ likes: v })}
          max={DEPLOY_LIMITS.likesMax}
          placeholder="favourite things"
        />
        <ListInput
          label="Hates"
          value={form.hates}
          onChange={(v) => updateForm({ hates: v })}
          max={DEPLOY_LIMITS.hatesMax}
          placeholder="pet peeves"
        />
        <ListInput
          label="Monologue topics"
          value={form.monologue_topics}
          onChange={(v) => updateForm({ monologue_topics: v })}
          max={DEPLOY_LIMITS.monologueTopicsMax}
          placeholder="what to ramble about when chat is quiet"
        />
        <ListInput
          label="Quirks"
          value={form.quirks}
          onChange={(v) => updateForm({ quirks: v })}
          max={DEPLOY_LIMITS.quirksMax}
          placeholder="verbal tics / habits"
        />
        <ListInput
          label="Taboo topics"
          value={form.taboo_topics}
          onChange={(v) => updateForm({ taboo_topics: v })}
          max={DEPLOY_LIMITS.tabooTopicsMax}
          placeholder="never go here"
          hint="The streamer will refuse or deflect on these."
        />
      </div>
    </div>
  );
}
