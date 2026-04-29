# Pattern KB Integration — Step 6.1–6.4

This file is the implementation reference for **Step 6.1 through 6.4** of
`../SKILL.md`. After Step 5's verify gate passes (or yields only deferred
LOW issues), Step 6 lands the cycle's work atomically. Pattern files must
be appended **before** the commit so they ride in the same commit as the
code fix.

**Key invariant (asserted in SKILL.md):** pattern KB appends are ATOMIC
with the code fix — the same commit contains both. If the commit aborts,
the pattern appends abort with it (working tree state, discarded by
recovery path 1 in `cleanup-recovery.md`).

The remaining Step 6 substeps (6.5 stage, 6.6 commit, 6.7 push, 6.8 reply,
6.9 resolve) live in SKILL.md (operational) and `commit-trailers.md`
(commit message template).

## Step 6.1 — Match each fixed finding to a pattern file

For each finding with `status == 'fixed'`, decide its target pattern file
using the algorithm from spec §4.1:

```
1. Read docs/reviews/CLAUDE.md → get list of (pattern_file_path, category).
2. Pre-filter candidates by:
   - Finding's file path overlap with files already in the pattern.
   - Category vs finding's domain.
3. Read Summary section ONLY for the top 3-5 candidates from Step 2 to disambiguate.
4. Fallback rules:
   a. 2+ findings sharing a novel theme → create new pattern.
   b. Single novel security/data-loss/correctness finding → create new pattern (single-entry security patterns earn their cost).
   c. Other single novel findings → fit into closest existing with a 1-line note.
5. Never create a new category without user approval — abort with prompt.
```

Record decisions in a list for the commit-message trailer
(`Pattern-Append-Decisions:` — see `commit-trailers.md`):

```
Pattern-Append-Decisions:

- F1 (alias recursion) → patterns/async-race-conditions.md (existing, theme: bounded recursion)
- F2 (Authorization regex) → patterns/credential-leakage.md (NEW pattern)
```

## Step 6.2 — Append entries to existing patterns

For each finding routed to an existing pattern, compute the next entry
number:

```python
def next_finding_number(pattern_file_path: str) -> int:
    text = read(pattern_file_path)
    if "## Findings" not in text:
        return 1
    findings_section = text.split("## Findings", 1)[1]
    findings_section = findings_section.split("\n## ", 1)[0]  # stop at next H2
    matches = re.findall(r'^### (\d+)\. ', findings_section, re.MULTILINE)
    return max(int(n) for n in matches) + 1 if matches else 1
```

Append each entry under `## Findings`, schema:

```markdown
### N. <Finding's title>

- **Source:** <github-claude | github-codex-connector | local-codex> | PR #<PR_NUMBER> round <ROUND> | <YYYY-MM-DD>
- **Severity:** <severity_label_original> # e.g. "HIGH" or "P1 / HIGH"
- **File:** `<repo-relative path>`
- **Finding:** <one to three sentences from the finding body>
- **Fix:** <one to three sentences describing what was changed>
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)
```

Note: `Commit:` does NOT contain the SHA — pattern file is part of the same
commit being created, so the SHA isn't yet known. Recoverable via `git
blame` later.

Update frontmatter `last_updated:` to today's date. Do **NOT** bump
`ref_count` on append — it's a consumer counter (per
`docs/reviews/CLAUDE.md`).

## Step 6.3 — Create new patterns when needed

For findings without a close fit, create a new pattern file at
`docs/reviews/patterns/<kebab-slug>.md`:

```markdown
---
id: <kebab-slug-of-name>
category: <one of: security | react-patterns | testing | terminal | code-quality |
                   error-handling | files | review-process | a11y | cross-platform |
                   editor | backend | correctness | e2e-testing>
created: <today>
last_updated: <today>
ref_count: 0
---

# <Title Case Pattern Name>

## Summary

<One paragraph (3-5 sentences) describing the pattern's theme — failure mode + general fix shape — drafted from the finding bodies that triggered creation.>

## Findings

### 1. <First finding's title>

- **Source:** ...
  (continues per 6.2 schema)
```

Category MUST come from the existing closed list (see spec §4.3). New
categories require user approval — abort if needed.

## Step 6.4 — Update the pattern index

`docs/reviews/CLAUDE.md` has a markdown table:

| Pattern                                          | Category | Findings | Refs | Last Updated |
| ------------------------------------------------ | -------- | -------- | ---- | ------------ |
| [Filesystem Scope](patterns/filesystem-scope.md) | security | 20       | 2    | 2026-04-29   |

For each touched pattern, update the row's `Findings` count (re-derive from
`### N.` count after this commit's appends) and `Last Updated` to today.
`Refs` unchanged.

For new pattern files, append a row in the same alphabetical order as
existing rows (or end-of-table — verify by reading the file before adding).

## Cross-references

- **Step 2 finding-table schema** — see `parsing.md` § Step 2C
  (defines `severity_label_original` and the source enum used in
  `**Source:**`).
- **Step 6.5 staging** — see `../SKILL.md` § Step 6.5 (pattern files and
  the index get explicitly staged here, not auto-staged).
- **Step 6.6 commit trailers** — see `commit-trailers.md` (defines the
  `Pattern-Append-Decisions:` and `Pattern-Files-Touched:` trailers).
- **Recovery on abort** — see `cleanup-recovery.md` § Pattern-file rollback
  (pattern appends are part of the same atomic commit, so they discard with
  the code fix on recovery path 1).
