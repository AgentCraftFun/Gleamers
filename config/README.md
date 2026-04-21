# config/

Hot-reloadable platform config. These files are read from disk and
re-read on mtime changes (throttled — see individual helpers), so
edits take effect without restarting web / orchestrator.

## `blocklist.json`

Inbound chat and super-chat blocklist.

```json
{
  "exact": ["…", "…"],
  "regex": ["\\brawslur\\b", "^spam\\W"]
}
```

- `exact`: case-insensitive substring matches on the user's message.
- `regex`: JS regex source strings, compiled with the `i` flag.

A match is checked **before** OpenAI moderation, so the user never
waits on a network round-trip for obviously banned content. Matches
are logged to `moderation_events` with `reason='blocklist:<match>'`.

Override the path with `BLOCKLIST_PATH` env (absolute or
process-cwd relative). The default resolves from the web package:
`../config/blocklist.json`.

Ship an empty list on mainnet and tune via ops.
