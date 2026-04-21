# Avatar presets

The deploy wizard lists six preset avatars at
`/presets/gleamer-{a..f}.vrm`. Drop actual VRM files here to enable
them. Any 0.x or 1.x VRM works.

Sources (same as `web/public/README.md`):

- VRoid Hub — https://hub.vroid.com (grab a free model and export as VRM)
- VRoid Studio — design and export your own
- Pixiv sample —
  https://github.com/pixiv/three-vrm/raw/dev/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm

File naming expected by the UI (see
`packages/shared/src/index.ts → DEPLOY_PRESETS`):

```
gleamer-a.vrm
gleamer-b.vrm
gleamer-c.vrm
gleamer-d.vrm
gleamer-e.vrm
gleamer-f.vrm
```

These files are gitignored to keep the repo small. When none are
present, the preset cards still render (gradient placeholders) but
the VRM avatar falls back to `/demo.vrm` when a deployed streamer
points at a missing preset.
