# Forgejo and Gitea connections

Create a source-control connection on the runtime that hosts the checkout. Choose Forgejo or Gitea
and enter the instance URL, including a reverse-proxy path when applicable, for example
`https://git.example.com/forge`. Do not include `/api/v1` in that URL. Bind the project using
`owner/repository`.

Use a personal access token from the server's user settings → Applications. Dovo sends it in the
`Authorization: token …` header from the runtime. It does not place the token in a clone URL,
project data, or mobile cache. Cloning uses the connection's credentials only for a remote within
the configured server address.

For browsing PRs, grant `read:repository` and `read:issue`. Reviewing, commenting, editing and
merging require their corresponding `write:repository` and `write:issue` scopes and permission on
the repository. Repository discovery and identifying the current reviewer additionally use
`read:user`. The server remains authoritative for branch policies and permissions.

Forgejo tokens restricted to specific repositories cannot include `read:user`. Connect those by
entering the repository explicitly; the project and PR views remain usable, with an explanation that
personal review assignment could not be loaded. Whole-account repository discovery requires a token
with user access.

## Supported PR flows

- List and inspect PRs, changed files, patches, reviews, discussion and commit checks.
- Create and edit a PR; close or reopen it.
- Post discussion or inline comments; approve or request changes.
- Add or remove requested user and team reviewers without changing other requests.
- Merge using a method enabled by the repository, with the expected head commit sent to the server.

All actions check the currently displayed head before submission. A changed head produces a refresh
message. Writes are not automatically retried after errors. If a connection drops after submission,
refresh to see whether the operation completed before submitting it again.

## Server-version differences

| Feature                          | Forgejo                   | Gitea                  |
| -------------------------------- | ------------------------- | ---------------------- |
| Single-line inline comments      | Supported                 | Supported              |
| Multiline inline comments        | 16+ (`extra_lines_count`) | Not advertised by 1.27 |
| Reply to a review comment        | Open on server            | 1.27+                  |
| Resolve/unresolve review threads | Open on server            | 1.26+                  |
| Draft creation                   | Open on server            | Open on server         |

The adapter detects the server version. Optional review features are unavailable if that version
cannot be read. It does not pretend unsupported endpoints exist or implement draft state by changing
your title. Dismissed and stale reviews remain distinguishable from active requests for changes. An
approval is not treated as proof that every branch-protection requirement is satisfied.

Files and patches are separate API requests. If the server declines one request, available
discussion and metadata stay visible alongside a specific warning. Missing counts remain unknown.
Pagination supports installations that cap page sizes below the requested size.

Sources: [Forgejo API usage](https://forgejo.org/docs/latest/user/api/usage/),
[Forgejo token scopes](https://forgejo.org/docs/latest/user/authentication/token-scope/),
[Forgejo 16 API schema](https://codeberg.org/forgejo/forgejo/src/tag/v16.0.5/templates/swagger/v1_json.tmpl),
[Gitea API](https://docs.gitea.com/api/),
[Gitea resolve endpoint](https://docs.gitea.com/api/operations/repo-resolve-pull-review-comment/),
[Gitea merge endpoint](https://docs.gitea.com/api/operations/repo-merge-pull-request/).

Provider fixtures cover payloads and version differences without making live writes. A particular
custom server still needs its connection and repository permissions verified against that
installation.
