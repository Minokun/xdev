# Changelog

All notable user-facing changes to xdev are documented here.

This file is for GitHub Releases and upgrade notes. For deeper workflow design rationale, see `docs/CHANGELOG.md`.

## [v3.2.0] - 2026-09-12

Wire-up release: every mechanism v3.1 wrote down is now actually reachable at runtime.
Basis: `docs/reviews/2026-09-12-xdev-audit.md` (three-round falsification chain, all commands re-computed).

### Added

- **`bin/install.sh dsh`** — full-syncs the preset (config face + runtime face: `bin/*.mjs`,
  `.claude/workflows/*.js`) into `~/.dsh/.agent-presets/xdev/`. Config-only installs left the
  stage-2 gate script unreachable and the gate fell back to prose (field-proven P0).
  A repo test now asserts the runtime trio exists in the installed preset.
- **`bin/probe-run.mjs`** — generic mutation-probe batch runner extracted from
  `tests/probes/mutations.mjs`: per-probe **timeout** (a hang counts as caught, it no longer
  freezes the batch), `--filter`, `--jobs N` worktree isolation, sha256-checked rollback, and a
  result **fingerprint** so "N/N went red" is a recomput-able object instead of a claim.
- **`cost-report.mjs --cwd` / `--all-projects`** — `--latest` now scopes to the current project
  by default (fail-closed when none), ending "the ledger belongs to a different session".

### Fixed

- **Probe harness accepted a `pass=0` baseline as green (B1)** — the TAP-only parser plus a
  `fail!==0`-only baseline check meant Node ≥25's default spec reporter made all 46 probes
  report VACUOUS while the flow carried on. The reporter is now pinned to TAP and the baseline
  requires `pass > 0`; a guard test plus two regression probes pin the fix itself.
- **Round-cap guard missed the "轮次上限 ≤N，" form** — research.md's appendix said ≤3 while the
  body said ≤2; the regex now covers both syntax forms and the text is unified on
  `MAX_ROUNDS=2` as the single source of truth.
- **Stage-2 phase boundary mixed anchors** — subagent counts used one cutoff while bytes/tool
  calls used another, so one session produced both 10.8% and 13.9%. All four envelope
  dimensions now share one boundary: the "decision brief presented" event, falling back to
  the file anchor; the report discloses which anchor was used.
- **Doc drift unification** — context cap is ≤25% everywhere (full-dev.md table is the truth
  source); the reviewer hit-rate ledger is `.xdev/review-ledger.jsonl`; the research panel is
  R1a–c + R1 + R2 (not "five-lens"); stale hard-rule numbers in README/research fixed.
  `drift.json` grew 7 → 14 claims (round caps, context cap, ledger path, rule-number mapping).
- **Dispatch write-surface ownership, the sleep ban, and evidence-in-same-commit** are now
  mechanical rules in the workflow text (three repeat offences from field sessions).

## [v3.1.0] - 2026-09-10

### Added

- **`/xdev-research`** — a preregistration-gated algorithm research flow with experiment provenance, machine judges, and honest negative results: a three-member review panel (R1a–c) plus the R1 gate and R2 audit, frozen pre-registration, hash-chained `runs/<id>/metrics.json`, and research-specific T1–T3 rules. (Landed earlier in the v3.1 line; recorded here for release completeness.)
- **Falsification probes (`伪证探针`) — hard rule 2 is now "判据必须可伪证", not "验证必须真实执行".** Every acceptance criterion must first be *shown to fail*: break the implementation, run that criterion's own command, confirm it goes red, roll back. A criterion that stays green is treated as **no criterion at all**. Applies to all acceptance criteria *and to any self-built script used to claim "0 gaps / all green"*. The probe table (criterion / mutation / command / expected) is authored **before** the implementation and recorded as delivery evidence.
- **External grounding gate (阶段 1)** — for replicate / integrate / migrate / spec-implementation work, every functional point must answer "where does the authoritative truth for this live, and is it outside the repo?" If yes, fetch it *before* designing and record source + retrieval command. Design documents must now separate **factual premises** (claims about the outside world: "X can't be done / only manual approximation is possible") from **design decisions** (free choices). Only decisions are axioms.
- **`[前提存疑]` output in the drift check (附录 B)** — the one sanctioned exception to "only compare implementation against design": the drift reviewer may question whether a design premise holds, because a design-referential gate set structurally cannot.
- **Gate-review discipline in 阶段 2** — freeze the artifact under review (sha256 recorded in the dispatch prompt and `.menxia.log`); one revision per round, never edit while a reviewer is running; **round cap ≤2 enforced with user escalation**; documentation bookkeeping (stale counts, broken citations, dangling references) demoted to same-round corrections that may **not** be a standalone reject reason; **same-class scan** after every finding (`rg` the pattern repo-wide, report "N instances, M fixed").
- **Adversarial review now attacks the gates themselves (附录 D)** — four mandatory checks: vacuous assertions, assertions against dead modules the product never imports, self-certifying gates (expectations recomputed by the function under test, artifacts auto-regenerated before asserting, piped commands swallowing exit codes), and instance-vs-class cleanup of prior fixes.
- **Falsifiability audit in A3 and a factual-premise challenge in A4** — "if the implementation were broken, would this criterion go red?" is now a required per-criterion answer, and unverified factual premises are treated as `missing`/HIGH rather than protected by the design-deference clause.

- **`tool-web` reinstated — read-only external grounding.** The v3.0 refactor dropped web tools on the theory that "offline dev" means fewer distractions, and a guard test enforced their absence. The field comparison showed the price: the task was *"replicate the original game faithfully"*, the authoritative level data was publicly available, and the xdev runs never looked for it — so the design was built on a false premise ("copyright forbids it, approximate by hand") that all six gate rounds were then structurally forbidden to question. `web_fetch` + `web_search` are back as **read-only** access for authoritative external truth (original behaviour, upstream API contracts, standards, the real data behind a reimplementation), tied to the 阶段 1 grounding check. The guard test is inverted accordingly: the row must stay, must keep `fetch: true`, and must gain no write/post capability. Scope discipline is explicit — fetch the truth a criterion depends on, cite it, move on; this is not open-ended browsing.

- **Two measurement scripts ship with xdev** (`bin/`, plain `node`, zero dependencies):
  - **`cost-report.mjs`** — the cost ledger for a session: total tokens (uncached / cache-read / output),
    wall clock, turns, time-to-first-delivery, tool calls, subagents, phase-2 subagent share, and
    **cache amplification = `cacheRead ÷ output`**. That last metric is the diagnostic one: it reflects
    orchestration efficiency only, independent of task size. Measured on the same model: `standard` 107×,
    xdev/flash **346×**, xdev/pro 67× — the machinery is fine for a model that stops itself and 3.2× worse
    for one that doesn't, which is why the remedy is an envelope rather than fewer mechanisms.
  - **`drift-check.mjs`** — mechanical "documented claim vs repo reality" comparison against a
    `.xdev/drift.json` claims table, plus repo-wide facts (test file/ case counts, branch, worktree state)
    and command-existence checks. This is the one defect class that recurred *after* being caught:
    two gate rounds rejected the plan over it and the final state still carried 17 mismatches, mostly
    overstatements. xdev dogfoods it — a test asserts this repo is drift-free.
- **阶段 2 gains a cost envelope (the brake it never had)**: ≤2 gate rounds, ≤6 phase-2 subagents,
  ≤150 phase-2 tool calls, ≤25% of context. Any breach downgrades to a spoken plan plus a pre-gate
  Q&A, with the reason recorded in the decision brief. Baseline it replaces: 6 rounds / 12 subagents
  (50% of all) / 194 calls / 37.4% of context, for zero lines of code.
- **Reviewer hit-rate ledger**: every dispatch appends "reported N / confirmed M / verdict" to
  `.xdev/review-ledger.jsonl` (append-only, survives the flow; `<plan>.menxia.log` is per-round
  trajectory only); a dimension with five consecutive runs of zero confirmed findings is removed
  from the default roster. Downsize on evidence — but never delete independent review, which caught
  both models' most lethal defects while 143/52 green tests missed them.
- **阶段 4 now runs `bin/drift-check.mjs` before the manual claim review and records
  `bin/cost-report.mjs` output in the delivery report**, both before commit. The ledger carries its own
  cost cap: call it once, never re-read transcripts to fill the table, and record "cost unknown" when
  data is missing rather than investigating.

- **Stage-2 gate orchestration moved into code** (`.claude/workflows/full-dev-gate.js`) — the Tier 1 that
  `RESEARCH.md §12.1` specified and never shipped ("返工轮次是代码不是纪律"). The script now enforces what
  prose could not: hard round cap (`MAX_ROUNDS=2`, escalate instead of looping — the field run reached round 6),
  reviewer failure re-dispatched once and then marked `missing` with **that round barred from approving**
  (the field run treated a hung reviewer as "review complete"), a phase-2 subagent budget (`≤6`; the field run
  used 12, half of all subagents), and a hit-rate ledger whose `confirmed` column is deliberately left blank
  for the main thread to fill — **the script never self-confirms findings**. A manual fallback path is kept for
  runtimes without `Workflow`. Writing it surfaced a real hole the tests caught: a missing *panel* dimension
  did not block approval, only a failed gate did.
- **Research side made isomorphic to the dev side**: T1 now carries the **factual-premise exception**
  (in a preregistration, "we can't get this data / can only approximate by hand" is a claim awaiting
  verification, not an approved decision — and the research cost is worse: a whole experiment budget burned
  on a false premise). T2 now also requires the **parsing script itself to be falsifiable** — feed it a
  deliberately corrupted log and it must not stay green, since a vacuous parser poisons the entire provenance chain.
- **`/ask` gained the probe outlet it lacked**: being read-only, it has no "break it and watch it go red"
  option — so every high-impact finding (especially negative ones: "unsupported / never written / dead code")
  must now carry **one read-only, reproducible command** the reader can re-run. Findings without such a command
  are demoted to Unknowns. `/ask` was the one flow where a vacuous conclusion could walk away clean.
- **`bin/cost-report.mjs --compare <a> <b>`** and `docs/experiments/xdev-vs-baseline/PREREGISTRATION.md`:
  the A/B is now one command plus a pre-registered decision rule. Ratios are computed same-scope only —
  the discipline that was violated when this release's own 7.3× was first written as 8.9×.

- **`tests/probes/mutations.mjs` — the mutation-probe runner, now in the repo.** Earlier the probes
  lived only in `/tmp`, which made claims like *"12 mutations, all caught"* **unreproducible by anyone** —
  an unfalsifiable claim, i.e. exactly the defect class this release exists to remove. It is now one
  command: each probe rewrites a source file, runs the suite, **must go red**, then restores via
  `git checkout` (with a worktree-integrity check). 44 probes across doc / bugfix / research / ask /
  cost / drift / gate.
  Its first full run found **7 decorative guards of my own** — assertions that matched a keyword while
  the rule's meaning was inverted, compared with a prefix (`includes('≤6')` passing `≤60`), checked
  order by `indexOf` without pinning the step number, or were simply missing (research T1/T2 and the
  `/ask` clause had no guard at all). All 7 were repaired and the suite now reports
  **46 caught / 0 vacuous**. Two of those fixes required fixing the *fixture*, not the assertion:
  a `specs/` fixture built from `.md` files could never exercise the directory logic, and a `--latest`
  assertion run against real data was empty because the newest real session happened to be top-level.

### Changed

- **阶段 4 order is now non-invertible: probes → full test run → adversarial review → commit.** The previous order allowed commit-then-review, which in practice landed deliverables carrying an unadjudicated review.
- **Parallel workers must be isolated in their own `git worktree`** (or dispatched serially). Shared-tree parallel work was observed corrupting `pnpm test` / `typecheck` results and breaking `node_modules` symlinks.
- **Review orchestration gains a fifth axis: cost.** "Add another reviewer" now requires answering "which class of defect can it see that the current panel cannot?" Node-level checks (`rg`, `command -v`, mutation probes) are preferred over another LLM reviewer — cheaper by roughly three orders of magnitude.
- **Reviewers that time out or never report are no longer silently treated as passing** — re-dispatch once, then mark `missing` and treat the dimension as unknown; an incomplete panel may not approve. Waiting must use completion notifications, not `sleep` (an observed `sleep 60` was SIGTERM-killed at the 60000 ms cap).
- **Persona (`agent.cordis.yml`) realigned** with the above; the old "rule 5: everything else is a default" was replaced by falsifiability and grounding duties, and review discipline was folded into rule 3.
- `tests/workflows.test.mjs` grew from 11 to 52 tests guarding each new mechanism, including stage-4 ordering,
  persona/skill parity, installed-vs-repo preset drift, and the bugfix probe form. Every guard is
  mutation-probed by `node tests/probes/mutations.mjs` — **currently 46 caught / 0 vacuous**, reproducible by
  anyone. (An earlier draft of this entry claimed "12 mutations, all caught" while the probe scripts lived only
  in `/tmp`; that claim was itself unreproducible and has been withdrawn. Moving the probes into the repo
  immediately exposed **seven decorative guards** — assertions that matched a keyword while the rule's meaning
  was inverted, or compared with a prefix, or had no guard at all. They were repaired; two of the fixes
  required fixing the *fixture* rather than the assertion.)
- **`/bugfix` carries the probe mechanism in its own form** (it previously had zero mentions of probes, only a
  reference to the hard rules — and bugfix is where it matters most). Two additions to its stage 2: **reverse
  confirmation** (revert the fix, the repro command must fail again — a green regression test after a fix does
  not prove it tested what you fixed) and a **same-class scan** (report "N instances, M fixed"), which is the
  mechanical version of the field lesson where `core/tank.ts` was fixed while `core/powerup.ts` survived.
  `/iterate` already had the equivalent red-confirmation ("run it and confirm it really fails"), so it was left alone.

### Why (evidence)

Logged observation, 2026-09-10, three sessions with the *same* prompt and the *same* model (`deepseek-flash`), differing only in preset:

Same prompt, same model (`deepseek-flash`), same empty directory — only the preset differed. Ratios are quoted **same-scope** (whole session vs whole session):

| | `standard` | `xdev` |
|---|---|---|
| tokens (whole session) | 18.22 M | 132.93 M (**7.3×**) |
| wall clock (whole session) | 24.5 min | 76.6 min (**3.1×**) |
| **time to first delivered result** (turn 1) | **13.8 min** | **39.7 min** (**2.9×**) |
| first game source line written | 1.7 min | 24.8 min (**14.8×**) |
| subagents dispatched | 0 | 24 |
| 阶段 2 (plan + 6 gate rounds) | — | 194 tool calls / **12 subagents** / 37.4 % of context, **0 lines of code** |

> Earlier drafts of this entry quoted 8.9× / 4.5× by pairing `standard`'s **first turn** against xdev's **whole session**. Both figures were recomputed from the raw transcripts on a consistent basis and corrected; the conclusion is unchanged, the premium was overstated.

Both xdev runs' gates passed while the products were broken: a dead module (`powerup.ts`) carried two acceptance criteria's entire evidence chain while the shipped game used a different code path; an acceptance script hardcoded one row `OK` and piped `pnpm test` through `tail`, swallowing the exit code; an assertion called with `w=0,h=0` was true by construction; a shovel power-up claimed 8 cells and delivered 5. **"The command really ran" never implied "the assertion had content."** Of the 12 plan-phase reviewers in one run, 4 were consumed by bookkeeping churn that the rework itself had created — and the fix is not "review harder" but "stop reviewing the text and start trying to break the artifact."

### Upgrade notes

- Probes add a small fixed cost per criterion (one mutation + one run). Scope them to the acceptance criteria and any green-claiming script; you do not need one per unit test.
- If you have a `docs/state/xdev--<branch>.md` from an older run, refresh it before resuming — 阶段 4 now requires it to reflect the final state.

## [v3.0.0] - 2026-09-02

### Breaking / Removed

- **Zero external skill dependencies**: gstack and superpowers are no longer referenced or required. Their genuinely useful review logic is internalized as built-in prompts (`full-dev.md` appendices A–D: plan reflections, drift check, conditional deep review, adversarial pre-landing review). If you have them installed they keep working independently — xdev just no longer calls them.
- **Windsurf IDE support removed.** The `windsurf/` port, `bin/gen-windsurf.mjs`, and the `install.sh windsurf` target (plus the windsurf-only `--project` flag) are gone. Windsurf users: stay on the v2.3.0 tag or migrate to Claude Code / Codex / dsh.
- `stage5-6-qa.js` dynamic workflow removed (the old 8-stage pipeline no longer exists); `install.sh` no longer links it.
- full-dev rewritten from 6 files / 4,746 lines / 8 stages to a single authoritative file / 196 lines / 4 stages; `full-dev-design` / `full-dev-impl` become thin handoff entry points (cross-tool split flow preserved).

### Changed

- Core philosophy: **information extraction, not ritual**. Only mechanisms that extract information the model cannot get from its own context survive (fresh-context review, diff-vs-design drift check, really-executed tests); everything else is now an explicitly deviable default — 5 hard rules replace the former ritual layer (Intent Guard tables, HUD, stop-wheel clauses, keep/discard loops, Impact Gate tiers, controller-first protocols).
- `/bugfix` and `/iterate` de-dependencized: investigate → fresh investigation subagent prompt; health/qa → really-executed test/lint commands; ship → inline delivery flow (pre-landing adversarial review + PR).
- Sansheng (Menxia Gate) mode available behind `--menxia`: binary approve/reject verdict by a fresh reviewer with design-deference and injection-guard clauses, forced rework ≤3 rounds, anti-sloppiness verification of revision notes. Grounded in the N1–N5 controlled experiment (`docs/experiments/sansheng/PROPOSAL.md` v2.4): C/A detection 94.4%, 8 real defects found on landed historical plans, 4/5 fake revision claims caught; cost 57–67% of baseline tokens (missed the ≤55% target — hence opt-in). Gray-release: ≥3 real tasks, then promote or remove (sunset clause).
- **`/bugfix` and `/iterate` rewritten as thin specialisations of `full-dev.md` stages 3–4** (329 → 75 lines, 304 → 54 lines). They keep only what differs: bugfix = severity routing, git blame/bisect before hypotheses, a fresh investigation subagent when stuck, `BASELINE_DEBT` (never fix unrelated pre-existing failures), and an explicit statement of what substitutes for the Intent Contract (the root-cause report's expected impact range); iterate = scope thresholds, escalation triggers, and the two Impact-Gate rules that were incident-driven (list direct callers of shared files; never claim an empty blast radius you couldn't verify). Dropped: duplicated Intent Guard blocks, inline 40-line worktree scripts, minute budgets, attempt-counting choreography, result-matrix rows that restated the obvious, the bugfix "stage 3.5 drift check" with anchor fallbacks, the 95-line Impact Gate templates/keyword tables, and 26 hard-coded `uv run pytest` / `npm test` / `start.sh` commands (project-specific leakage).
- **`/ask` slimmed 371 → 126 lines.** Removed the freshness decision matrix, cost-estimation formulas, disclosure-list formats and the "≤5–8 turns" budget; kept the genuinely non-obvious Graphify facts (`check-update` false negatives, `cost.json` UTC vs `git %aI` local-offset timestamp trap, "CLI has no full semantic-build command — must go through the `/graphify` skill"), the read-only boundary, the domain-context/ADR rules, and the output contract (`file:line` evidence, mandatory `Unknowns`, 3-level honesty).
- **dsh (DeepSeek Harness) is a first-class target.** The repo root now carries a complete dsh agent preset — `preset.yml` ("xdev 模式", order 5), `agent.cordis.yml` (persona + tool stack), and preset-private `skills/xdev-{ask,bugfix,iterate,full-dev}/` generated by `bin/gen-dsh.mjs` from `claude-code/`. **`git clone` IS the installer**: `git clone --depth 1 <xdev> ~/.dsh/.agent-presets/xdev`, restart dsh, pick "xdev 模式". Design rationale: `docs/experiments/dsh-integration/RESEARCH.md`. On dsh, xdev's fresh-review / parallel-dispatch / structured-verdict mechanisms map to enforced runtime primitives (`spawn` with `inheritsParentContext: false`, the `workflow` tool with real barriers and schema validation, per-subagent `{provider, model}`) instead of prose conventions.
- **`windsurf/` generation retired with the port itself.** `claude-code/` remains the single hand-edited source; the dsh preset artifacts are its only generated target now. `parity-check.js` (LLM-based drift detector) and its 3 tests are removed; `tests/workflows.test.mjs` fails deterministically if the dsh preset is stale, if any workflow re-introduces external skill calls, if `bugfix`/`iterate` exceed their thin-shell budget, or if windsurf support creeps back in.
- README: removed the "auto codebase snapshot" and ui-ux-pro-max sections (neither is referenced by any workflow anymore), collapsed Graphify install to a 10-line optional step scoped to `/ask`, and aligned the comparison table with the workflows (no minute budgets; 🔴 gates instead of a 🔴/🟡/🟢 taxonomy).

### Upgrade notes

- Windsurf users: pin the v2.3.0 tag or migrate to Claude Code / Codex / dsh.
- Re-run `bin/install.sh` with your agent targets (`claude` / `codex`) to refresh links (removes the stale `stage5-6-qa.js` symlink).
- dsh users: `git clone --depth 1 https://github.com/Minokun/xdev.git ~/.dsh/.agent-presets/xdev` — clone IS install; upgrade with `git pull` in that directory.
- The Sansheng experiment (proposal, arms, samples, judge outputs, results) now ships in-repo under `docs/experiments/sansheng/` so the evidence cited by `full-dev.md` is verifiable from any clone.
- Existing in-flight sessions on the old 8-stage state files should be completed before upgrading, or restarted.

## [v2.3.0] - 2026-07-10

### Added

- `/ask` now reads project domain context before answering: root `CONTEXT.md` / `CONTEXT-MAP.md`, `docs/domain/` terminology files, and anchor-relevant ADRs are used as bounded, read-only supplementary evidence.
- `/ask` explicitly distinguishes historical ADR decisions from current implementation when they conflict, and reports missing domain context under `Unknowns` without blocking the answer.
- Claude Code `/ask` health-check agents now use relevant project terminology and ADRs while keeping source `file:line` evidence mandatory.
- Added regression coverage for domain-context and ADR rules across the Claude Code and Windsurf ports.

## [v2.2.0] - 2026-07-06

### Fixed

- Dynamic-workflow aggregation no longer silently swallows failed agents: `parity-check` `droppedPairs`/`droppedVerify` now actually increment (were structurally always 0); `stage5-6-qa` fails closed on out-of-enum verdicts (was silently passing); `ask-investigate` no longer crashes on `findings:null` and reports dropped dimensions by key. (+5 regression tests)
- Removed a hardcoded `项目：stock-analysis（A股分析平台）` from the generic Stage-1 context in all four full-dev files (every non-stock-analysis user got the wrong project injected).
- Split-flow (`full-dev-impl`) stage 5+6 now runs the full trigger matrix including `cso` (was health+qa only — auth/payment/PII features shipped via the split flow got no security review).
- Merged-flow stage-2 review now ports the reviewer-failure ("防静默丢失") protocol (a crashed reviewer was silently counted as HIGH=0, falsely passing the gate).
- bugfix (S2/S3) + iterate now carry the stop-wheel / background-shell invariant (these flows run the same long backend tests that triggered the original incident).
- `/xdev:ask` Signal-B freshness check now normalizes timestamps via `datetime.fromisoformat` (lexicographic compare broke in negative timezones, falsely reading stale graphs as fresh).
- `install.sh` no longer silently clobbers non-symlink user files (guarded `ln`), drops the fragile `eval` in `run()` (paths with `$` now work), errors on `--project` with non-windsurf agents, warns on missing workflow sources, and sweeps stale broken symlinks / orphan generated skill dirs.

### Changed

- Gatekeeper drift-check threshold now counts insertion + deletion churn (was insertion-only — deletion-only refactors bypassed batch drift-check).
- bugfix S1 gained a narrow TDD exception for pure config/copy/docs fixes; the failure-loop table now has an S1 row.
- iterate stage-3 `health` now has an explicit pass criterion + escalation row (the claimed "质量底线" was previously undefined).
- Graphify consent unified to 🟡 disclose-and-proceed across all entrypoints (semantic re-extraction / first build; was 🔴 wait-for-confirm in full-dev, auto+disclose in ask — installed Graphify treated as implicit authorization).
- Frontmatter stage count corrected 9→8; cross-command handoffs normalized to `/xdev:*`; Intent Guard summaries mention `[调整]`/`[回退]`; misleading `(writing-plans)` stage-3 label dropped (workflow generates plans inline); README.zh backports the Mainline-controller triggers + the missing graphify skill-map row.

### Deferred (tracked in `docs/reviews/2026-07-06-self-review.md`)

- **#38 stages 1-3 — resolved via sync, not unify**: a 199-line diff showed the two are deliberately parallel (flow-specific branch naming / state-file path / handoff semantics), so pointer-ifying would break the merged flow. Shared bodies (通过条件 + autoplan) were synced into `full-dev-design.md` instead; decision recorded in `docs/CHANGELOG.md`.
- ~8 lower-value items (worktree cleanup on resume, ask.md partial-graph routing / droppedDimensions contract / Signal-A stderr / exec-boundary, cross-tool handoff state, stage-3 reflection failure handling, bugfix `[TODO]` mechanic).

## [v2.1.1] - 2026-07-06

### Fixed

- **Stage 5+6 verdict now blocks on any dropped triggered skill** (was: only when an entire dimension failed). A single dropped/timed-out `health` / `qa` / `review` / `cso --diff` / `design-review` / `devex-review` subagent in `stage5-6-qa` now blocks the aggregate verdict instead of being silently swallowed — closes the last gap in the no-silent-loss guarantee.
- `parity-check` is now path-agnostic (no embedded local checkout path), so it runs correctly from any clone.

### Changed

- **Third-party dependency upgrade + install-doc sync.** Bumped gstack → 1.58.5, ui-ux-pro-max → 2.10.1, graphify → 0.9.7 (CLI + skill), refreshed the graphify skill, and removed a stale duplicate `frontend-design` symlink (the plugin copy is current). README install instructions updated:
  - **ui-ux-pro-max npm package renamed** `uipro-cli` → `ui-ux-pro-max-cli` (the old name is frozen at 2.2.3; the CLI binary is still `uipro`).
  - **graphify** repo moved to `Graphify-Labs/graphify`; **0.9.0 is breaking** — node IDs are now full repo-relative paths, so existing `graphify-out/` graphs need a one-time `graphify extract --force` to re-import (`graph.json` auto-migrates).
  - **gstack `--host`** synced to its 1.58.5 accepted values (`claude / codex / kiro / factory / opencode / openclaw / hermes / gbrain / auto`); `cursor` / `windsurf` / `slate` are no longer accepted — use `auto`.
  - Documented that **gstack now runs Codex cross-model review by default** across `/review`, `/ship`, the four `/plan-*-review`s, `/document-release`, and `/autoplan` (`codex_reviews` switch; falls back to a Claude subagent when Codex is unavailable), and recommended the codex plugin.

### Added

- `tests/workflows.test.mjs` — gates the `stage5-6-qa` and `parity-check` dynamic-workflow logic (dropped-skill blocking, evidence-less degradation → `fix_required`, no embedded checkout path).
- `ask-investigate.js` is now linked as a global Claude Code workflow via `install.sh`, so `/ask` health-check parallelism is available in every project.

## [v2.1.0] - 2026-06-15

### Added

- `stage5-6-qa` — a dev-only parallel quality-check workflow that aggregates Stage 5+6 (review / `cso --diff` / health / qa / design-review / devex-review) across parallel subagents into a 5-state verdict (`pass` / `degraded` / `baseline_debt` / `fix_required` / `blocked`), keeping each skill's full findings isolated from the main context. Wired into `/full-dev` via a global symlink so it runs as part of the end-to-end pipeline.
- `parity-check` — a contributor-facing port-drift detector that diffs the `claude-code/` and `windsurf/` source trees, separates intentional IDE adaptation from real behavioral drift, and alerts only on the latter.
- `/ask` health-check parallelized — the 6-dimension audit checklist now runs dimensions in parallel via `ask-investigate`.

### Changed

- **No silent loss of failed parallel subagents.** All parallel-aggregation points (`stage5-6-qa`, `parity-check`, `full-dev-design` Stage 2 review) now expose dropped/failed subagent counts instead of swallowing them via `filter(Boolean)`. When every subagent in a dimension fails, the aggregate verdict is `blocked` rather than defaulting to pass — prevents pass/keep decisions made on incomplete data.
- **`full-dev-design` reviewer-failure handling.** A failed reviewer (timeout / crash / no tally) is retried once, then marked `missing`; the missing dimension's HIGHs count as "unknown" not 0, the round is flagged `[partial-review]`, and a missing mandatory `plan-eng-review` makes the round incomplete.
- Stage 4 checkpoint rules tightened: 🔴 pause carve-out, no text-only mid-batch stops, continue after checkpoints. Stage 5/6 no longer stops while backend tests / health / QA background jobs are still running.
- graphify Signal A string updated for v0.8.37+.

### Fixed

- Hardened `full-dev-impl` against text-only mid-batch stops. Stage 4 now has a required pre-end-turn self-check: if TaskList / TaskUpdate or `stage 4 data.next_action` still points at unfinished work, the mainline must tail-call the next tool instead of ending with a progress summary such as "下一步继续 task-007".
- Required partial-batch progress to be mirrored into `_STATE_FILE.stage 4 data.task_state` and a precise remaining `next_action`, so recovery and auto-compact do not lose the exact next task.
- Tightened batch checkpoint handling: focused tests passing, review/audit passing, or a commit SHA is not a stop boundary. The mainline must update state, write the next precise action, and immediately start the next batch/task instead of ending at "the next implementation checkpoint".
- Prevented Stage 5/6 stops while backend tests, health, QA, or other Bash tasks are still running in the background. Background shell jobs now count as in-flight work and must be polled to completion before pass/fail handling.

## [v2.0.4] - 2026-05-11

### Added

- Added Codex CLI as a third install target alongside Claude Code and Windsurf. `bin/install.sh codex` simultaneously installs both Codex interfaces:
  - **Custom Prompts**: per-file symlinks at `~/.codex/prompts/xdev-*.md` → invoke via `/prompts:xdev-full-dev` etc. (preserves `argument-hint`).
  - **Skills**: generated `SKILL.md` wrappers at `~/.agents/skills/xdev-*/` → invoke via `$xdev-full-dev` or rely on Codex's implicit description matching. Wrappers are marked `<!-- xdev-generated -->` and regenerated idempotently on every install; the body delegates to the absolute path of the source workflow so a single `git pull` updates both interfaces.
- `bin/install.sh` now accepts multiple agent targets in one call (e.g. `claude codex`, `windsurf codex`); `all` is a shorthand for `claude windsurf codex`.

### Changed

- `bin/install.sh --help` and both READMEs document the new `codex` target, the multi-select syntax, and a per-agent invocation table covering Claude Code, Windsurf, Codex prompts, and Codex skills.
- `--target <path>` now explicitly errors when combined with `codex` (codex install has two fixed paths).

### Fixed

- Generated Codex `SKILL.md` files now place the `<!-- xdev-generated -->` marker **after** the YAML frontmatter. Codex's frontmatter parser requires `---` to be the first non-empty content; the previous layout caused all six xdev skills to be silently skipped on load. Re-run `bash bin/install.sh codex` to regenerate, then restart Codex to pick up the new files.

### Notes

- Codex's Custom Prompts surface is officially deprecated in favour of Skills, but still fully supported. xdev installs both so users can pick the explicit `/prompts:` path or the implicit-matching `$skill` path per task.
- Windsurf source files are deliberately **not** unified with `claude-code/`. The two source trees have intentional content drift (frontmatter format, command self-references, `$ARGUMENTS` placeholder usage, project-context file naming). Codex was unifiable because it natively accepts Claude Code's frontmatter; Windsurf was not.

## [v2.0.3] - 2026-05-11

### Added

- Added Light Impact Gate to `/iterate`: each quick iteration now performs a bounded Step A anchor scan, escalates to a structured Impact Gate only when risk signals appear, and records an After Diff Gate before quality checks.
- Added task-level Impact Gate requirements to `full-dev` planning: L2 tasks carry a simplified impact summary, L3 tasks carry the full template, and plan validation now treats missing Impact Gate data as a HIGH issue.
- Added `Impact boundary` to `full-dev-impl` task packets so executors know the intended blast radius and must return `NEEDS_RECLASSIFY` when they discover out-of-bound impact.

### Changed

- Documented Light Impact Gate in both README files as a built-in lightweight precheck, not a GitNexus dependency or Graphify replacement.
- Limited Risk trigger keyword scans to candidate files, anchor neighborhoods, and diff hunks to avoid false escalation from high-frequency repo documentation terms.
- Clarified that `/ship` consumes prior After Diff Gate results instead of generating a new gate during release.

### For contributors

- See `docs/CHANGELOG.md` for the design rationale and why the implementation lives in `full-dev-design.md` + `full-dev-impl.md` rather than only `full-dev.md`.

## [v2.0.2] - 2026-05-11

### Fixed

- `full-dev` / `full-dev-impl` no longer auto-stops mid-implementation. Added a hard auto-completion invariant that overrides Intent Guard's "question = clarify" fallback for pure status questions (e.g. "完成了吗 / 为什么停"), so the mainline answers in one line and immediately continues the remaining queue.
- Disambiguated the `Done` / `DONE` token: the mainline must not use "Done / 完成 / 阶段总结" to end a turn while work remains, but subagent reply `DONE` status tokens are still valid internal signals.
- Moved stage 8 (`learn`) to run **before** the stage 7 cleanup step in both combined `full-dev` and split `full-dev-impl`. Previously the state file, audit sidecar, and implementation worktree were deleted before `learn`, so `learn` lost the diff context it needs to evaluate triggers and capture lessons.
- Unified the stage-7-vs-stage-8 termination wording across the combined and split flows so the invariant references a single terminal state.

### Added

- New mainline context budget rule (`full-dev-impl.md` §4.1.1 #8): the mainline must not Read / Grep business source files more than 3 times within a single batch (CLAUDE.md, design doc, implementation plan, state file, Handoff Summary, task packet templates, and Graphify output are excluded). After an auto-compact, the first action must be reading the state file's `## Handoff Summary` and immediately dispatching the next batch — no recap, no project rescan, no user check-in. Defends against the auto-compact momentum loss observed during long sessions.
- Extended the §4.2 CWD/path collision rule to also cover the §4.4.1 fast path. The mainline must use absolute paths or verify `pwd` matches `git rev-parse --show-toplevel` before running `rg` / `grep` / `test -f` / test commands, preventing the `backend/backend/...` drift that surfaces when the Claude Code Bash tool persists a subdirectory cwd.

### For contributors

- See `docs/CHANGELOG.md` for the longer rationale captured in the planning sessions.

## [v2.0.1] - 2026-05-10

### Added

- Added a release-facing changelog and `VERSION` file so GitHub Releases can show what changed in each version.
- Documented the current xdev workflow set for Claude Code and Windsurf: `full-dev`, `full-dev-design`, `full-dev-impl`, `bugfix`, `iterate`, and `ask`.

### Changed

- Moved full-dev worktree isolation to the start of the workflow so design, visual, and implementation commits all happen on a feature branch instead of `main`.
- Documented the implementation worktree resolution order, including ignored `.worktrees/`, `worktrees/`, `XDEV_WORKTREE_ROOT`, and the default `~/.config/xdev/worktrees/<project>/` path.
- Clarified that new worktrees copy root-level `.env*` and `.envrc` files, while ignored build artifacts still need a fresh `uv sync` or `npm ci`.

### Fixed

- Prevented ship flows from running from base branches such as `main` or `master`.
- Added post-ship worktree cleanup so temporary implementation worktrees do not pile up on disk.
- Replaced macOS-only state-file editing snippets with portable Python commands.
- Hardened full-dev implementation resume behavior when a same-slug branch or worktree already exists.

### For contributors

- `docs/CHANGELOG.md` remains the evolution log for workflow design decisions and rationale.
- Root `CHANGELOG.md` is now the release log used for GitHub Release notes.
