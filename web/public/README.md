# web/public

Static assets served at the site root.

## `demo.vrm`

The avatar renderer falls back to `/demo.vrm` if a streamer's
`avatar_vrm_url` is empty. Drop a VRM file here to enable the
fallback. Any 0.x or 1.x VRM works.

Free sources:

- **VRoid Hub** — https://hub.vroid.com (grab a free model and export
  as VRM)
- **VRoid Studio** — design and export your own
- Pixiv's sample `AliciaSolid.vrm` — https://github.com/pixiv/three-vrm/raw/dev/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm

Place the file at `web/public/demo.vrm`. It is gitignored so the repo
stays small. The avatar component shows an error state if no VRM is
present or the URL is unreachable.
