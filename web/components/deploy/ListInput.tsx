'use client';

import { useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Props {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  max: number;
  placeholder?: string;
  hint?: string;
}

export function ListInput({
  label,
  value,
  onChange,
  max,
  placeholder,
  hint,
}: Props) {
  const [draft, setDraft] = useState('');
  const full = value.length >= max;

  function add() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (full) return;
    if (value.includes(trimmed)) return;
    onChange([...value, trimmed]);
    setDraft('');
  }

  function remove(idx: number) {
    const next = value.slice();
    next.splice(idx, 1);
    onChange(next);
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {label}
        </label>
        <span className="text-[11px] text-muted-foreground">
          {value.length} / {max}
        </span>
      </div>
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          placeholder={placeholder}
          disabled={full}
          className={cn(
            'flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60',
          )}
        />
        <Button type="button" onClick={add} disabled={full || !draft.trim()}>
          Add
        </Button>
      </div>
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5 pt-1">
          {value.map((item, i) => (
            <li
              key={`${item}-${i}`}
              className="group flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-xs"
            >
              {item}
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label={`Remove ${item}`}
                className="text-muted-foreground hover:text-foreground"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {hint ? (
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
