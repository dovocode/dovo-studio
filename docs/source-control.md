# Source control connections

Dovo's desktop, web and mobile clients browse projects across saved computers. Each operation uses
the accounts on the computer that owns its project. Open **Settings → Source control**, connect an
account, then link a project. On desktop you can also open **Connections** from Pull requests, or
**Projects → Project settings** to link a checkout. Clone a connected repository from Add project
(desktop) or Source control (mobile).

Existing GitHub projects continue to use `gh` authentication on the runtime without extra setup.

## Providers

| Provider                   | Runtime connection                    | Setup and capabilities             |
| -------------------------- | ------------------------------------- | ---------------------------------- |
| GitHub / GitHub Enterprise | GitHub CLI login for the host         | [GitHub](github-integration.md)    |
| Bitbucket Cloud            | Named `bb` CLI profile (or API token) | [Bitbucket](bitbucket-azure.md)    |
| Forgejo                    | `fj` / `tea` login (or API token)     | [Forgejo](forgejo-gitea.md)        |
| Gitea                      | `fj` / `tea` login (or API token)     | [Gitea](forgejo-gitea.md)          |
| Azure DevOps Services      | Azure CLI sign-in (or PAT)            | [Azure DevOps](bitbucket-azure.md) |

Bitbucket Data Center and Azure DevOps Server use different APIs and are not supported by the
Cloud/Services connectors. GitHub connections use the active `gh` account for that hostname. The UI
does not run an OAuth sign-in flow. Tokens can instead reference an environment variable on the
runtime host; restart the runtime after changing its environment.

Repository discovery may require broader scopes than accessing one repository. If discovery is
unavailable for a repository-restricted token, enter `owner/repository` directly; use
`project/repository` for Azure. Linking validates that repository before saving the binding. Forgejo
and Gitea instance URLs may include a reverse-proxy path. GitHub connections take the HTTPS host
URL; GitHub CLI selects that host's API endpoint.

## Reviewing and managing work

Pull requests combine projects from all saved computers, with the project and host shown on each
row. Lists, details, discussion, file previews and checks are cached; refresh failures keep
available content visible. Provider connections and repository bindings are included in cache
identity. Changing a binding or saved account revision prevents reuse of that account's old client
cache.

Cached content appears before live requests finish. Open views refresh automatically, and returning
to the app triggers another check; pressing Refresh is optional. Desktop PR lists check the first
page every 30 seconds and mobile PR lists every 10 seconds; both revisit loaded older pages every
two minutes. Mobile issue and pipeline lists check every 30 seconds while focused and in the
foreground, with a two-minute sweep of loaded older pages. Issue and pipeline details on desktop and
mobile also refresh every 30 seconds, including the discussion/job pages you have loaded. Background
refreshes keep existing content visible; failed reads retain it with a stale/error indication. Issue
and pipeline details are saved locally too, including loaded comments and jobs, so they can reopen
offline. Mutations still require a live connection and fresh data.

- **Create PR** takes a title, description, source branch and target branch. Branches must already
  exist on the server; this does not push local commits. Draft creation appears where supported.
- **Review & actions / PR actions** provides distinct comment, approve and request-changes actions,
  edit, add/remove reviewers, close/reopen and merge. Enter provider usernames or stable reviewer
  IDs as indicated by the form. Reviewer additions retain existing reviewers.
- Reply or resolve from an individual discussion where the server supports it. Older Gitea servers
  and Forgejo expose fewer discussion actions. Open on server remains available.
- Desktop diff selection and mobile **Comment on line** attach feedback to a path, side and line at
  the reviewed commit. Providers that only accept one line reject ranges rather than changing their
  meaning.
- Checks include provider status and links. GitHub also includes available check summaries and
  annotations. Azure includes policy evaluations. Full CI log streaming stays on the provider; use
  the Pipelines view to manage runs and open server links for logs.
- Merge explicitly confirms the target and method. Repository policies still apply; conflict-free
  does not mean approved to merge. A queued/in-progress merge is reported separately from merged.
- Start task from PR uses the provider's source repository/ref and verifies its captured commit
  after fetching. Existing local edits and worktrees remain intact.

Every write checks the captured PR head before submission. Where the provider supports a merge
precondition, the expected commit is included in the merge request. Providers without atomic
review/comment preconditions can still change between this check and the write. Network failures are
not automatically retried: refresh before retrying an uncertain submission to avoid duplicates.

## Credential handling

API tokens live in a dedicated table in the runtime's private SQLite database. They are not returned
in connection listings, workspace snapshots, client read caches or activity input logs. This is
filesystem protection, not application-level encryption: protect runtime database backups as
credentials. Use an environment reference if tokens should be managed outside the database. GitHub
CLI owns GitHub credentials separately.

Signed-in `bb`, `fj`, `tea`, and `az` credentials are read privately from the selected CLI account
for requests, without copying them into Dovo's database. `tea` uses its named-login credential
helper, including OAuth refresh, so Dovo can enforce the same HTTP boundaries as token connections.
Bitbucket uses the provider's distinct Git usernames for API tokens and access tokens; an Atlassian
email is used only for REST API-token authentication.

Connection profile pickers read account names from the runtime's CLIs without returning credentials.
Bound project operations execute from their checkout so repository-local CLI settings apply. Named
GitHub profiles use account-scoped subprocess credentials; profile selection never changes global
CLI defaults. See [CLI account setup](issues-pipelines-jira.md#signed-in-cli-accounts) for each
provider's selection rules.

HTTP credentials stay within the configured API origin and base path. API-token-authenticated Git
fetches and clones reject redirects, keep tokens out of command arguments, and disable interactive
prompts. Use canonical repository URLs; a server that redirects its Git endpoints must be configured
with its final endpoint. Prefer HTTPS for self-hosted servers carrying API credentials.

Stored API tokens authenticate Dovo's provider operations and its explicit PR fetches/clones. Agent
shells and terminal commands use the runtime host's normal Git credential setup; configure SSH or a
Git credential helper there for subsequent `git push` commands.

Provider API contracts are verified with isolated HTTP fixtures and local Git fixtures. Credentials
and live write access are required for account-specific validation; tests never submit changes to
your actual repositories.

See [Issues, pipelines and Jira](issues-pipelines-jira.md) for signed-in CLI setup, Jira linking and
provider-specific run controls.
