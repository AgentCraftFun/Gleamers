# Uploaded avatars

`POST /api/avatar/upload` writes VRM files here (content-addressed
by sha256 → `<hash>.vrm`) **only when Supabase Storage is not
configured**. In production the same route sends the upload to the
`avatars` Supabase Storage bucket instead.

The actual files are gitignored so dev artefacts don't leak into
commits. This README keeps the directory in git.
