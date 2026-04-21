import { notFound, redirect } from 'next/navigation';
import { createSupabaseAdmin } from '@/lib/supabase';
import { readSession } from '@/lib/auth/session';
import { Header } from '@/components/home/Header';
import { EditClient } from './EditClient';
import { EMPTY_FORM } from '@/components/deploy/useDeployDraft';
import type { DeployFormInput } from '@/lib/deploy/validate';

export const dynamic = 'force-dynamic';

interface Props {
  params: { slug: string };
}

export default async function EditStreamerPage({ params }: Props) {
  const session = await readSession();
  if (!session) redirect('/');

  const tokenLive = process.env.NEXT_PUBLIC_TOKEN_LIVE === 'true';
  const sb = createSupabaseAdmin();
  const { data: streamer, error } = await sb
    .from('streamers')
    .select(
      'id, slug, name, owner_id, voice_id, avatar_vrm_url, personality_config',
    )
    .eq('slug', params.slug)
    .maybeSingle();
  if (error) throw error;
  if (!streamer) notFound();
  if (streamer.owner_id !== session.userId) redirect('/dashboard');

  // Prefer the raw_form snapshot we stored during deploy/edit.
  const rawForm = (streamer.personality_config as unknown as {
    raw_form?: DeployFormInput;
  }).raw_form;
  const initialForm: DeployFormInput = rawForm
    ? {
        ...EMPTY_FORM,
        ...rawForm,
        // These three are locked in the edit form — carry forward whatever
        // the DB has, just in case the raw_form is stale.
        name: streamer.name,
        voice_id: streamer.voice_id,
        avatar_vrm_url: streamer.avatar_vrm_url,
      }
    : {
        ...EMPTY_FORM,
        name: streamer.name,
        voice_id: streamer.voice_id,
        avatar_vrm_url: streamer.avatar_vrm_url,
      };

  return (
    <div className="min-h-screen bg-background">
      <Header tokenLive={tokenLive} />
      <EditClient slug={streamer.slug} initialForm={initialForm} />
    </div>
  );
}
