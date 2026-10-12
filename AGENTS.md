# xdev — agent notes

## Edit rules

- Hand-edit only `claude-code/*.md`; `skills/`, `preset.yml`, `agent.cordis.yml` are generated (`node bin/gen-dsh.mjs`).
- Do not add non-workflow `.md` files under `claude-code/` — `bin/install.sh` installs every one as a slash command / Codex prompt / skill.
- `claude-code/full-dev.md` ≤ 560 lines and `claude-code/research.md` ≤ 415 (G7 test; budgets may only go down). New rules → script them in `bin/` or compress equal-size.
- Tools in `bin/*.mjs` must stay zero-dependency (`node:*` imports only).

## Verification (run all before claiming done)

```sh
node --test                                   # NOT `node --test tests/` (fails on node 22/25)
node bin/gen-dsh.mjs --check                  # generated skills up to date
node bin/drift-check.mjs --dir .              # docs/claims vs repo (.xdev/drift.json)
bash bin/install.sh dsh                       # sync installed preset (~/.dsh) — a test compares it to the repo
node tests/probes/mutations.mjs               # mutation probes; needs a CLEAN worktree (commit first); all must be CAUGHT
PATH=/opt/homebrew/bin:$PATH node tests/probes/mutations.mjs   # same on node 25 (spec reporter)
```

- Any new guard test needs a matching probe in `tests/probes/mutations.mjs`; a VACUOUS probe means the test doesn't guard what it claims.
- Bumping VERSION requires a matching top entry in `CHANGELOG.md`; update the "grew from 11 to N tests" sentence and `docs/CHANGELOG.md` "（N 总）".
