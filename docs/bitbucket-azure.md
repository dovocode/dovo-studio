# Bitbucket Cloud and Azure DevOps Services

Source control connections belong to the runtime that hosts the project. Add the connection on that
runtime, then select or enter the repository and bind it to the project. A paired phone uses the
runtime's connection; it does not need a copy of the provider token.

Reviewer changes are explicit additions or removals. Adding reviewers preserves everyone already
assigned; removing reviewers affects only the selected accounts and leaves other reviewers and votes
unchanged.

## Bitbucket Cloud

- API address: `https://api.bitbucket.org/2.0`.
- Username: the email address of your Atlassian account.
- Credential: an Atlassian API token, either saved in the runtime connection or supplied through the
  configured runtime environment variable. Restart the runtime after changing its environment.
- Repository: `workspace/repository-slug`.

Use an expiring API token with `read:repository:bitbucket`, `read:pullrequest:bitbucket` and
`write:pullrequest:bitbucket` for the PR workflow. Repository discovery also needs
`read:workspace:bitbucket`; `read:user:bitbucket` identifies PRs authored by you or awaiting your
review. These scopes are independent; a write scope does not imply all required read scopes. The
account must itself have access to the repository. App passwords are not the supported setup path.

Discovery uses the current `/user/workspaces` API followed by workspace repository lists. The old
cross-workspace repository and permission APIs were retired in April 2026. If discovery is not
permitted by your token, enter `workspace/repository-slug` directly.

Supported: PR creation/editing, descriptions and diffs, comments/replies, approval and change
requests, thread resolution/reopening, reviewer account UUIDs, closing PRs, merge commits and squash
merges. Bitbucket's API does not expose a PR reopen operation; reopening a comment thread is a
separate action. Inline comments select one line. Rebase merging is not offered as a substitute for
Bitbucket's different fast-forward strategy.

A merge accepted for asynchronous processing is shown as queued. Refresh to see its eventual result.
Check links open the provider's build page. An unavailable check or diff is shown as unavailable,
not as a successful check or an empty diff.

References:
[authentication and scopes](https://developer.atlassian.com/cloud/bitbucket/rest/intro/),
[workspace discovery](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-workspaces/),
[PR API](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-pullrequests/),
[cross-workspace API retirement](https://community.developer.atlassian.com/t/bitbucket-cloud-announcing-end-of-life-for-cross-workspace-apis-timeline-next-steps-and-instructions-for-connect-apps/99972).

## Azure DevOps Services

- API address: `https://dev.azure.com/your-organization`, without a project suffix.
- Credential: an Azure DevOps personal access token, saved on the runtime or read from the
  configured runtime environment variable.
- Repository: `project/repository-name` (repository GUIDs are also accepted).

Give the token Code read/write access for PR creation, review and commenting; the user also needs
the corresponding repository permissions. Build read access is needed when following protected
build/log resources. Organization policy and branch policies still apply: the application does not
enable policy bypass when merging.

The current connection form accepts PAT credentials. Microsoft recommends Entra ID OAuth for new
general-purpose integrations, but an OAuth application registration and refresh-token flow are not
part of this connection implementation. Do not paste an Entra bearer token into the PAT field.

Supported: PR creation/editing, reviewer identity GUIDs, discussion and inline threads, replies,
resolving/reopening threads, approval/change requests, abandoning/reopening PRs, and
merge/squash/rebase completion. Descriptions are limited to 4,000 characters by Azure. Completed PRs
cannot be reopened.

Azure's review states remain distinct: approved, approved with suggestions, waiting for author,
rejected, and no vote. Required policy evaluations appear alongside PR status checks; passing status
checks alone does not mean all merge policies passed.

Diffs are calculated from the captured source commit and common ancestor. Inline comments retain
Azure's iteration and change-tracking coordinates. If the source changes before an action, refresh
before submitting again. Preview generation is limited to the first 100 files, one megabyte per file
and bounded diff complexity; all paged file metadata remains available. Binary or unavailable
previews keep unknown line counts. Azure has no general PR update timestamp, so overview dates use
the actual creation/completion date and detail can use the latest iteration date.

References:
[authentication guidance](https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/authentication-guidance?view=azure-devops),
[PR API](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-requests?view=azure-devops-rest-7.1),
[thread coordinates](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-request-threads/create?view=azure-devops-rest-7.1),
[policy evaluations](https://learn.microsoft.com/en-us/rest/api/azure/devops/policy/evaluations/list?view=azure-devops-rest-7.1).

## Hosting and troubleshooting

These adapters target **Bitbucket Cloud** and **Azure DevOps Services**. Bitbucket Data Center has
different API routes and schemas. Azure DevOps Server has collection URLs, server-version
constraints and different authentication options. Do not configure either on-premises product as its
cloud equivalent.

For authentication failures, check token expiry, scopes, runtime environment and repository access.
After a lost response to a write, refresh the PR before trying again: the provider may already have
accepted it. Permission failures in optional sections leave the rest of the PR available with a
warning. Credentials are not included in returned clone URLs.

The adapter tests use recorded-shape HTTP fixtures and no live provider writes. Live
organization-specific policies and token configurations still require validation against your
connected account.
