'use client';

import { useRef, useState } from 'react';
import { DEPLOY_LIMITS, DEPLOY_PRESETS } from '@gleamers/shared';
import type { DeployFormInput } from '@/lib/deploy/validate';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Props {
  form: DeployFormInput;
  updateForm: (patch: Partial<DeployFormInput>) => void;
}

export function AvatarStep({ form, updateForm }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onUpload(file: File) {
    if (file.size > DEPLOY_LIMITS.vrmMaxBytes) {
      setError(`VRM too large (max ${DEPLOY_LIMITS.vrmMaxBytes / 1024 / 1024}MB)`);
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/avatar/upload', {
        method: 'POST',
        body: fd,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body.error === 'wallet_required') {
          setError('Connect a wallet before uploading an avatar.');
        } else {
          setError(body.error ?? `Upload failed (${res.status})`);
        }
        return;
      }
      const body = (await res.json()) as { url: string };
      updateForm({ avatar_vrm_url: body.url });
    } catch (err) {
      setError(String(err));
    } finally {
      setUploading(false);
    }
  }

  const selectedPreset = DEPLOY_PRESETS.find(
    (p) => p.vrmPath === form.avatar_vrm_url,
  );

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">3. Avatar</h2>
        <p className="text-sm text-muted-foreground">
          Upload a .vrm or pick a preset.{' '}
          <span className="text-muted-foreground/70">
            VRoid Studio integration coming soon.
          </span>
        </p>
      </div>

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Upload VRM</h3>
            <p className="text-xs text-muted-foreground">
              ≤ {DEPLOY_LIMITS.vrmMaxBytes / 1024 / 1024}MB, .vrm files only.
            </p>
          </div>
          <Button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? 'Uploading…' : 'Choose file'}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".vrm,application/octet-stream,model/gltf-binary"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onUpload(file);
              if (e.target) e.target.value = '';
            }}
          />
        </div>
        {form.avatar_vrm_url && !selectedPreset ? (
          <p className="mt-3 break-all rounded-md bg-background px-2 py-1 font-mono text-[11px] text-muted-foreground">
            ✓ {form.avatar_vrm_url}
          </p>
        ) : null}
        {error ? (
          <p className="mt-3 text-sm text-destructive-foreground">{error}</p>
        ) : null}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Or pick a preset</h3>
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
          {DEPLOY_PRESETS.map((p) => {
            const selected = form.avatar_vrm_url === p.vrmPath;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => updateForm({ avatar_vrm_url: p.vrmPath })}
                className={cn(
                  'flex flex-col gap-1 rounded-lg border p-3 text-left transition',
                  selected
                    ? 'border-primary bg-primary/10 ring-2 ring-primary'
                    : 'border-border bg-card hover:border-primary/50',
                )}
              >
                <div className="aspect-[4/3] rounded-md bg-gradient-to-br from-primary/60 to-accent/40" />
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{p.label}</span>
                  {selected ? (
                    <span className="text-[10px] uppercase tracking-widest text-primary">
                      Selected
                    </span>
                  ) : null}
                </div>
                <code className="break-all text-[10px] text-muted-foreground/70">
                  {p.vrmPath}
                </code>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
