import { NextResponse } from 'next/server';
import { createSupabaseAdmin } from '@/lib/supabase';
import { readSession } from '@/lib/auth/session';
import {
  buildPersonalityConfig,
  validateDeployInput,
  type DeployFormInput,
} from '@/lib/deploy/validate';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Edit personality for an owned streamer. Voice and avatar are
 * carried forward from the stored values — editing those is out of
 * scope here — but the validator still requires them in the body
 * so we inject the current values before validating.
 *
 * "Changes take effect next session." The live session keeps the
 * previously-loaded personality until it self-ends; the next worker
 * spawn reads the fresh row.
 */
export async function PATCH(
  req: Request,
  ctx: { params: { slug: string } },
) {
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { slug } = ctx.params;
  const sb = createSupabaseAdmin();
  const { data: streamer, error } = await sb
    .from('streamers')
    .select('id, owner_id, name, voice_id, avatar_vrm_url')
    .eq('slug', slug)
    .maybeSingle();
  if (error) {
    return NextResponse.json(
      { error: 'db_error', detail: error.message },
      { status: 500 },
    );
  }
  if (!streamer) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (streamer.owner_id !== session.userId) {
    return NextResponse.json({ error: 'not_owner' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  // Lock immutable fields before validation. Name is stored on the
  // streamers row and changing it would orphan the slug; voice/avatar
  // edits belong in a later prompt.
  const patched = {
    ...(body as Record<string, unknown>),
    name: streamer.name,
    voice_id: streamer.voice_id,
    avatar_vrm_url: streamer.avatar_vrm_url,
  };
  const validated = validateDeployInput(patched);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const personality_config = buildPersonalityConfig(
    validated.value as DeployFormInput,
  );
  const { error: updErr } = await sb
    .from('streamers')
    .update({ personality_config })
    .eq('id', streamer.id);
  if (updErr) {
    return NextResponse.json(
      { error: 'update_failed', detail: updErr.message },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, effectiveAt: 'next_session' });
}
