import { DEPLOY_LIMITS, DEPLOY_PRESETS, DEPLOY_VOICES } from '@gleamers/shared';

export interface DeployFormInput {
  name: string;
  vibe: string;
  speech_patterns: string;
  core_opinions: string[];
  likes: string[];
  hates: string[];
  backstory: string;
  monologue_topics: string[];
  quirks: string[];
  taboo_topics: string[];
  voice_id: string;
  avatar_vrm_url: string;
}

export type ValidationResult =
  | { ok: true; value: DeployFormInput; slug: string }
  | { ok: false; error: string };

export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function capArr(
  items: unknown,
  max: number,
  itemMax = 120,
): string[] | null {
  if (!Array.isArray(items)) return null;
  if (items.length > max) return null;
  const trimmed: string[] = [];
  for (const item of items) {
    if (typeof item !== 'string') return null;
    const s = item.trim();
    if (s.length === 0) continue;
    if (s.length > itemMax) return null;
    trimmed.push(s);
  }
  return trimmed;
}

function validVoice(id: unknown): id is string {
  return typeof id === 'string' && DEPLOY_VOICES.some((v) => v.id === id);
}

function validAvatar(url: unknown): url is string {
  if (typeof url !== 'string' || url.length === 0) return false;
  if (DEPLOY_PRESETS.some((p) => p.vrmPath === url)) return true;
  // Uploaded paths we control ship through /uploads/<hash>.vrm.
  if (/^\/uploads\/[a-z0-9-]+\.vrm$/i.test(url)) return true;
  // Supabase Storage public URLs are fine too.
  return /^https?:\/\/.+\.vrm$/i.test(url);
}

export function validateDeployInput(input: unknown): ValidationResult {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'invalid_body' };
  }
  const r = input as Record<string, unknown>;
  const name = typeof r.name === 'string' ? r.name.trim() : '';
  if (!name || name.length > DEPLOY_LIMITS.nameMax) {
    return { ok: false, error: 'invalid_name' };
  }
  const vibe = typeof r.vibe === 'string' ? r.vibe.trim() : '';
  if (vibe.length > DEPLOY_LIMITS.vibeMax) {
    return { ok: false, error: 'invalid_vibe' };
  }
  const speech_patterns =
    typeof r.speech_patterns === 'string' ? r.speech_patterns.trim() : '';
  if (speech_patterns.length > DEPLOY_LIMITS.speechPatternsMax) {
    return { ok: false, error: 'invalid_speech_patterns' };
  }
  const backstory =
    typeof r.backstory === 'string' ? r.backstory.trim() : '';
  if (backstory.length > DEPLOY_LIMITS.backstoryMax) {
    return { ok: false, error: 'invalid_backstory' };
  }

  const core_opinions = capArr(
    r.core_opinions,
    DEPLOY_LIMITS.coreOpinionsMax,
    DEPLOY_LIMITS.coreOpinionItemMax,
  );
  if (core_opinions === null)
    return { ok: false, error: 'invalid_core_opinions' };
  const likes = capArr(r.likes, DEPLOY_LIMITS.likesMax);
  if (likes === null) return { ok: false, error: 'invalid_likes' };
  const hates = capArr(r.hates, DEPLOY_LIMITS.hatesMax);
  if (hates === null) return { ok: false, error: 'invalid_hates' };
  const monologue_topics = capArr(
    r.monologue_topics,
    DEPLOY_LIMITS.monologueTopicsMax,
  );
  if (monologue_topics === null)
    return { ok: false, error: 'invalid_monologue_topics' };
  const quirks = capArr(r.quirks, DEPLOY_LIMITS.quirksMax);
  if (quirks === null) return { ok: false, error: 'invalid_quirks' };
  const taboo_topics = capArr(r.taboo_topics, DEPLOY_LIMITS.tabooTopicsMax);
  if (taboo_topics === null)
    return { ok: false, error: 'invalid_taboo_topics' };

  if (!validVoice(r.voice_id)) return { ok: false, error: 'invalid_voice' };
  if (!validAvatar(r.avatar_vrm_url))
    return { ok: false, error: 'invalid_avatar' };

  const slug = slugify(name);
  if (!slug) return { ok: false, error: 'invalid_slug' };

  return {
    ok: true,
    value: {
      name,
      vibe,
      speech_patterns,
      core_opinions,
      likes,
      hates,
      backstory,
      monologue_topics,
      quirks,
      taboo_topics,
      voice_id: r.voice_id,
      avatar_vrm_url: r.avatar_vrm_url,
    },
    slug,
  };
}

/**
 * Build the PersonalityConfig stored in streamers.personality_config
 * from the validated form. The system_prompt is composed from the
 * user-supplied fields so StreamerBrain / personality-compiler can
 * drop it in unchanged.
 */
export function buildPersonalityConfig(input: DeployFormInput) {
  const lines: string[] = [];
  lines.push(`You are ${input.name}.`);
  if (input.vibe) lines.push(`Vibe: ${input.vibe}.`);
  if (input.speech_patterns)
    lines.push(`Speech patterns: ${input.speech_patterns}.`);
  if (input.backstory) lines.push(`Backstory: ${input.backstory}.`);
  if (input.core_opinions.length)
    lines.push(`Core opinions: ${input.core_opinions.join('; ')}.`);
  if (input.likes.length) lines.push(`Likes: ${input.likes.join(', ')}.`);
  if (input.hates.length) lines.push(`Hates: ${input.hates.join(', ')}.`);
  if (input.monologue_topics.length)
    lines.push(`Common monologue topics: ${input.monologue_topics.join(', ')}.`);
  if (input.quirks.length) lines.push(`Quirks: ${input.quirks.join('; ')}.`);
  if (input.taboo_topics.length)
    lines.push(`Taboo — refuse or deflect: ${input.taboo_topics.join(', ')}.`);

  return {
    system_prompt: lines.join('\n'),
    tags: [
      ...input.core_opinions.slice(0, 3),
      ...input.likes.slice(0, 3),
    ],
    safe_mode: true,
    raw_form: input,
  };
}
