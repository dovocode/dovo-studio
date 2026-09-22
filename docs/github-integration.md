# GitHub pull requests

Dovo performs GitHub operations on the selected runtime host using GitHub CLI (`gh`). The phone,
desktop renderer and web client never need a GitHub token. Each registered project can use its
checkout's GitHub remote or an explicitly saved GitHub connection and `owner/repository` binding.

## Connect a host

Install Git and GitHub CLI on the runtime machine, then authenticate as the account you want Dovo to
use:

```sh
gh auth login --hostname github.com
gh auth status --hostname github.com
```

For GitHub Enterprise Server, use its hostname in both commands and the saved connection. Dovo
passes the host and repository explicitly so a parent shell's `GH_REPO` or `GH_HOST` cannot redirect
a project operation. A saved connection uses that host's active CLI account.

The CLI normally uses the system credential store. On machines without a working credential store,
GitHub CLI can fall back to its own plaintext configuration; inspect `gh auth status` and protect
the runtime user's home directory. Headless deployments can supply the CLI's documented
`GH_TOKEN`/`GITHUB_TOKEN` or enterprise equivalents through their service environment. Do not put
tokens into a repository URL or workspace configuration.

Dovo namespaces PR caches by repository, host, active account and an opaque fingerprint of relevant
token environment variables. Successful account checks are reused for up to one minute. Explicit
refresh rechecks the account immediately; use it after `gh auth switch`. Failed authentication does
not reuse a previously authenticated identity.

## Permissions

The runtime account needs access to the repository. Fine-grained token permissions depend on the
action:

| Workflow                                            | Repository permission                         |
| --------------------------------------------------- | --------------------------------------------- |
| Read PRs, reviews and comments                      | Pull requests: read                           |
| Create/edit PRs, comment, review, request reviewers | Pull requests: write                          |
| Merge PRs                                           | Contents: write, plus repository branch rules |
| Read check output and annotations                   | Checks: read                                  |
| Open private GitHub Actions job logs                | Actions: read                                 |

Organization SSO, repository roles and branch rules still apply. A supported action is not a grant
of permission. GitHub decides whether an account may perform it, and failures remain visible in the
form. Thread resolution also checks GitHub's current viewer permission before submission.

## Review and author workflows

- Create a PR from explicit existing remote head/base branches, optionally as a draft. Creation does
  not push commits or create forks automatically.
- Edit the PR title, description and base; close or reopen it.
- Post a discussion comment, submit approval, request changes, or submit a review comment. Reviews
  are attached to the head commit being displayed. Comments and change requests require a body; an
  approval may be empty.
- Add inline comments on selected old/new lines or ranges. Replies target the original comment in
  the thread, including when replying to an existing reply.
- Resolve or reopen review threads where GitHub permits it. Outdated and resolved state are kept
  separate from review approval.
- Request, re-request or remove review requests for users and team slugs. Other reviewers remain
  unchanged.
- Inspect check summaries, details and file/line annotations. A failed annotation request leaves the
  check's status and available output visible. Full job logs remain on the check's external page;
  Dovo does not download every log while opening a PR.
- Merge using an enabled repository method and the displayed head SHA. The provider must confirm the
  merge; a pending check, branch restriction or changed head is not reported as success.

Every mutating action checks the current head against the displayed revision. A changed head asks
you to refresh rather than applying an action to new code silently. Merge additionally sends the
expected SHA in the GitHub request. If a connection fails after submission, refresh and inspect the
PR before retrying: Dovo does not automatically replay external writes.

## Current limits

Review submission is immediate; collecting several comments into a server-side pending review,
editing existing comment bodies and dismissing reviews are not exposed by the current action
contract. Merge queue and auto-merge management remain on GitHub. “No merge conflicts” describes Git
compatibility, not satisfaction of branch protection or review rules.

Team review requests are not treated as a definite negative for the signed-in user when team
membership is unavailable. Direct user requests drive personalized prioritization; Dovo does not
infer membership from a team name. Large PRs and insufficient scopes can produce partial results;
the missing sections are reported and previously cached sections remain available.

## References

- [GitHub CLI authentication](https://cli.github.com/manual/gh_auth_login)
- [Pull request reviews](https://docs.github.com/en/rest/pulls/reviews)
- [Review comments and replies](https://docs.github.com/en/rest/pulls/comments)
- [Review requests](https://docs.github.com/en/rest/pulls/review-requests)
- [GraphQL review threads](https://docs.github.com/en/graphql/reference/pulls)
- [Pull requests and merging](https://docs.github.com/en/rest/pulls/pulls)
- [Check runs and annotations](https://docs.github.com/en/rest/checks/runs)
