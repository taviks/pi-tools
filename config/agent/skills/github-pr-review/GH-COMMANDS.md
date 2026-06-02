# GitHub Commands

Use `gh` for private and public PRs. Keep commands read-only unless the user explicitly requests posting comments.

## Preconditions

Check availability and auth:

```bash
command -v gh
gh auth status
```

If either fails, ask the user to authenticate with `gh auth login` or paste the PR diff.

## Parse PR URL

A PR URL usually looks like:

```text
https://github.com/OWNER/REPO/pull/NUMBER
```

If the URL contains extra paths such as `/files` or `#discussion_r...`, still extract `OWNER`, `REPO`, and `NUMBER`.

## Metadata

```bash
gh pr view PR_URL \
  --json url,title,body,author,baseRefName,headRefName,isDraft,state,mergeStateStatus,reviewDecision,labels,assignees,reviewRequests,changedFiles,additions,deletions,commits,files
```

Useful alternate command if already inside the repo:

```bash
gh pr view NUMBER --json title,body,author,baseRefName,headRefName,changedFiles,additions,deletions,commits,files
```

## Checks / CI

```bash
gh pr checks PR_URL
```

If checks fail, inspect whether failures are related to the changed files before reporting them as PR issues.

## Changed files

```bash
gh pr diff PR_URL --name-only
```

For richer file metadata:

```bash
gh api repos/OWNER/REPO/pulls/NUMBER/files --paginate
```

## Patch / diff

```bash
gh pr diff PR_URL --patch
```

If the diff is large, save it to a temporary file and inspect targeted sections:

```bash
TMPDIR="${TMPDIR:-/tmp}/pi-pr-review-OWNER-REPO-NUMBER"
mkdir -p "$TMPDIR"
gh pr diff PR_URL --patch > "$TMPDIR/pr.patch"
```

Use `read` on the saved patch rather than dumping huge output into the conversation.

## Local repository detection

From a candidate repo directory:

```bash
git remote -v
git rev-parse --show-toplevel
git status --short
```

Only use an existing checkout if it matches the PR repo. Do not alter a dirty working tree.

## Temporary clone for context

For standard/deep reviews when no matching local repo exists:

```bash
TMPDIR="${TMPDIR:-/tmp}/pi-pr-review-OWNER-REPO-NUMBER"
rm -rf "$TMPDIR"
gh repo clone OWNER/REPO "$TMPDIR/repo" -- --filter=blob:none
cd "$TMPDIR/repo"
gh pr checkout NUMBER
```

This modifies only the temporary clone. Do not use this in the user's working tree unless the user asks.

## Compare base and head locally

Inside a temp clone or safe local checkout:

```bash
git fetch origin BASE_BRANCH
BASE="origin/BASE_BRANCH"
git diff --stat "$BASE"...HEAD
git diff --name-only "$BASE"...HEAD
git diff "$BASE"...HEAD -- path/to/file
```

Use this to inspect context around changed lines and trace callers/tests.

## Search changed symbols

```bash
rg "functionName|ClassName|exportedSymbol" .
rg "import .*ChangedThing|from ['\"]path/to/module" .
```

Prefer targeted searches over broad scans.

## Posting comments — only after confirmation

General PR comment:

```bash
gh pr comment PR_URL --body-file comment.md
```

Review comments on exact lines are harder and should only be attempted when line mapping is certain. Prefer drafting copy-paste comments for the user unless they explicitly ask you to post.

Never run these without explicit confirmation:

```bash
gh pr review --approve
gh pr review --request-changes
gh pr merge
git push
```
