# Intent and Intent mismatches (PR mode)

The stated intent is the "why" the reviewer checks the Behaviours against. It is quoted from sources, never written by you.

## Sources

Gather all that exist:

- The PR title and body (`gh pr view <n> --json title,body`).
- Linked issues: `closingIssuesReferences`, plus `#<n>` references in the body and commits; read each with `gh issue view <n>`.
- Commit messages: `git log --format='%h %s%n%b' <baseSha>..<headSha>`.
- ADRs touched: changed files under an `adr`, `adrs` or `decisions` folder, or named like `NNNN-*.md` beside other ADRs.

`intent.sources` lists each one used, as `PR #12`, `issue #34`, `commit abc1234` or the ADR's repo-relative path.

## The text

`intent.text` holds the purpose as the sources state it: the authors' own sentences, trimmed to the claims about behaviour, at most five sentences. Where sources disagree, keep both claims. Leave out what no source says, however obvious it seems.

`intent.isMissing` is `true` when no source states a purpose: an empty or template-only PR body, no linked issue, and commit subjects such as "wip" or "fix". Then leave `text` out and `sources` empty. A missing intent is a finding the panel shows; filling the gap would hide it.

## Intent mismatches

Read each concrete claim in the intent and set it against the built Behaviours and their base. A mismatch is one of:

- **Claimed, not observed**: the intent claims a Behaviour change (for example "adds a retry to payment capture") and no built Behaviour shows it.
- **Observed, not claimed**: a Behaviour has a `contract-change` or `error-handling-change` risk that no claim covers, including under a claim of "no behaviour change" or "refactor only".
- **Contradicted**: the claim says one thing and the code does another (for example "validates the input" where the Step forwards it unchecked).

Record each as `{ claim, observed, evidence }`: `claim` quotes the source, `observed` says what the code does, and `evidence` cites the code that shows it (for a claimed change that is absent, cite the unchanged code where it would be). A mismatch you cannot cite is left out.
