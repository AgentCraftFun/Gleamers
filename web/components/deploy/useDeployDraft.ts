'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DeployFormInput } from '@/lib/deploy/validate';

const STORAGE_KEY = 'gleamers-deploy-draft-v1';

export interface DeployDraft {
  step: number;
  form: DeployFormInput;
}

export const EMPTY_FORM: DeployFormInput = {
  name: '',
  vibe: '',
  speech_patterns: '',
  core_opinions: [],
  likes: [],
  hates: [],
  backstory: '',
  monologue_topics: [],
  quirks: [],
  taboo_topics: [],
  voice_id: '',
  avatar_vrm_url: '',
};

function safeLoad(): DeployDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DeployDraft>;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      step: Math.min(3, Math.max(0, parsed.step ?? 0)),
      form: { ...EMPTY_FORM, ...(parsed.form ?? {}) },
    };
  } catch {
    return null;
  }
}

export function useDeployDraft() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<DeployFormInput>(EMPTY_FORM);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const saved = safeLoad();
    if (saved) {
      setStep(saved.step);
      setForm(saved.form);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ step, form } satisfies DeployDraft),
      );
    } catch {
      /* quota / privacy mode — ignore */
    }
  }, [step, form, loaded]);

  const updateForm = useCallback(
    (patch: Partial<DeployFormInput>) => {
      setForm((prev) => ({ ...prev, ...patch }));
    },
    [setForm],
  );

  const clear = useCallback(() => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* noop */
      }
    }
    setStep(0);
    setForm(EMPTY_FORM);
  }, []);

  const canAdvance = useMemo(() => {
    switch (step) {
      case 0:
        return form.name.trim().length > 0 && form.vibe.trim().length > 0;
      case 1:
        return form.voice_id.length > 0;
      case 2:
        return form.avatar_vrm_url.length > 0;
      default:
        return true;
    }
  }, [step, form]);

  return {
    step,
    setStep,
    form,
    updateForm,
    clear,
    canAdvance,
    loaded,
  };
}
