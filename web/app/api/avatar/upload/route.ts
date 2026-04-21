import { NextResponse } from 'next/server';
import { writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

import { readSession } from '@/lib/auth/session';
import { createSupabaseAdmin } from '@/lib/supabase';
import { DEPLOY_LIMITS } from '@gleamers/shared';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const STORAGE_BUCKET = 'avatars';

/**
 * POST /api/avatar/upload
 *
 * Accepts a multipart VRM ≤10MB from an authed wallet. When
 * SUPABASE_STORAGE_BUCKET=avatars and the project has the bucket,
 * uploads via the admin client and returns the public URL. In dev
 * (no Supabase Storage), falls back to web/public/uploads/<hash>.vrm
 * so the dev server can still serve it at /uploads/<hash>.vrm.
 */
export async function POST(req: Request) {
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: 'wallet_required' }, { status: 401 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: 'missing_file' }, { status: 400 });
  }
  if (file.size > DEPLOY_LIMITS.vrmMaxBytes) {
    return NextResponse.json(
      { error: 'too_large', maxBytes: DEPLOY_LIMITS.vrmMaxBytes },
      { status: 413 },
    );
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length < 8) {
    return NextResponse.json({ error: 'invalid_vrm' }, { status: 400 });
  }
  // glTF binary magic = 'glTF' (0x46546C67 little-endian).
  const magic = new TextDecoder().decode(bytes.slice(0, 4));
  if (magic !== 'glTF') {
    return NextResponse.json({ error: 'invalid_vrm' }, { status: 400 });
  }

  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 32);
  const fileName = `${hash}.vrm`;

  // Try Supabase Storage first (if configured).
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
    try {
      const sb = createSupabaseAdmin();
      const { error } = await sb.storage
        .from(STORAGE_BUCKET)
        .upload(`users/${session.userId}/${fileName}`, bytes, {
          contentType: 'model/gltf-binary',
          upsert: true,
        });
      if (!error) {
        const { data: pub } = sb.storage
          .from(STORAGE_BUCKET)
          .getPublicUrl(`users/${session.userId}/${fileName}`);
        return NextResponse.json({ url: pub.publicUrl, bytes: bytes.length });
      }
      console.warn('[upload] supabase storage failed, falling back:', error.message);
    } catch (err) {
      console.warn('[upload] supabase storage threw, falling back:', err);
    }
  }

  // Dev fallback: write into web/public/uploads/. Survives a Next
  // dev restart but not a container restart.
  const uploadsDir = resolve(process.cwd(), 'public/uploads');
  await mkdir(uploadsDir, { recursive: true });
  const dest = join(uploadsDir, fileName);
  try {
    await stat(dest);
  } catch {
    await writeFile(dest, bytes);
  }
  return NextResponse.json({ url: `/uploads/${fileName}`, bytes: bytes.length });
}
