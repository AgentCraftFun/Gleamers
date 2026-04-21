/**
 * Seed Gleamers with an admin user and two READY streamers (Mika, Marcus).
 *
 *   pnpm seed
 *
 * Requires env:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY, ADMIN_WALLETS
 */
import { createClient } from '@supabase/supabase-js';
import type { Database, PersonalityConfig } from '@gleamers/shared';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;
const adminWallets = (process.env.ADMIN_WALLETS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (!url || !serviceKey) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY');
  process.exit(1);
}

if (adminWallets.length === 0) {
  console.error('Missing ADMIN_WALLETS (comma-separated)');
  process.exit(1);
}

const sb = createClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const adminWallet = adminWallets[0]!.toLowerCase();

const PLACEHOLDER_VRM =
  'https://cdn.vroid.com/placeholder.vrm';
const PLACEHOLDER_VOICE = 'en-US-default';

const mikaPersonality: PersonalityConfig = {
  system_prompt:
    'You are Mika, an unhinged Gen-Z VTuber who believes birds are ' +
    'government drones and delivers conspiracy rants with frantic energy. ' +
    'Heavy slang, lowercase, chaotic. Avoid slurs. Keep replies under ' +
    'three sentences.',
  tags: ['unhinged', 'gen-z', 'birds-arent-real', 'conspiracy'],
  safe_mode: true,
};

const marcusPersonality: PersonalityConfig = {
  system_prompt:
    'You are Marcus, a paranoid middle-aged man convinced Wi-Fi signals ' +
    'give him headaches. You speak earnestly, cite made-up studies, and ' +
    'suggest tinfoil solutions. Never break character. Reply in short, ' +
    'weary paragraphs.',
  tags: ['paranoid', 'middle-aged', 'anti-wifi', 'tinfoil'],
  safe_mode: true,
};

async function main() {
  console.log('[seed] admin wallet:', adminWallet);

  // --- user ---------------------------------------------------------------
  const { data: existing, error: findErr } = await sb
    .from('users')
    .select('*')
    .eq('wallet_address', adminWallet)
    .maybeSingle();
  if (findErr) throw findErr;

  let userId: string;
  if (existing) {
    userId = existing.id;
    console.log('[seed] admin user already present:', userId);
  } else {
    const { data: inserted, error: insErr } = await sb
      .from('users')
      .insert({
        wallet_address: adminWallet,
        display_name: 'Admin',
        is_admin: true,
      })
      .select('*')
      .single();
    if (insErr) throw insErr;
    userId = inserted.id;
    console.log('[seed] admin user created:', userId);
  }

  // --- streamers ----------------------------------------------------------
  const streamers = [
    {
      slug: 'mika',
      name: 'Mika',
      voice_id: PLACEHOLDER_VOICE,
      avatar_vrm_url: PLACEHOLDER_VRM,
      personality_config: mikaPersonality,
    },
    {
      slug: 'marcus',
      name: 'Marcus',
      voice_id: PLACEHOLDER_VOICE,
      avatar_vrm_url: PLACEHOLDER_VRM,
      personality_config: marcusPersonality,
    },
  ];

  for (const s of streamers) {
    const { data: existingStreamer } = await sb
      .from('streamers')
      .select('id')
      .eq('slug', s.slug)
      .maybeSingle();

    if (existingStreamer) {
      console.log(`[seed] streamer ${s.slug} already present`);
      continue;
    }

    const { error } = await sb.from('streamers').insert({
      owner_id: userId,
      owner_wallet: adminWallet,
      name: s.name,
      slug: s.slug,
      personality_config: s.personality_config,
      voice_id: s.voice_id,
      avatar_vrm_url: s.avatar_vrm_url,
      status: 'READY',
    });
    if (error) throw error;
    console.log(`[seed] inserted streamer: ${s.slug}`);
  }

  console.log('[seed] done');
}

main().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
