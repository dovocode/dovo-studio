# Documentation

Start with the [product guide](product-guide.md) for the full desktop, web, and mobile walkthrough,
provider setup, and feature manual. The guides below focus on particular workflows and limits.

## Setup and operating guides

- [Run a server and pair devices](server-setup.md): source or release setup, workspace migration,
  lifecycle, LAN/VPN access, pairing, updates, and recovery.
- [Releases and updates](releases-and-updates.md): desktop releases, local iPhone installs, and Live
  Activities.
- [Security and pairing](security-and-pairing.md): runtime trust boundaries, device credentials, and
  pairing behavior.
- [Source control](source-control.md): provider connections, pull-request workflows, and supported
  actions.
- [GitHub integration](github-integration.md): GitHub CLI and API behavior.
- [Forgejo and Gitea](forgejo-gitea.md): setup and provider-specific behavior.
- [Bitbucket and Azure DevOps](bitbucket-azure.md): provider setup and capabilities.
- [Issues, pipelines, and Jira](issues-pipelines-jira.md): connected issue and pipeline sources.
- [Automations](automations.md): triggers, execution, reviews, and recovery.
- [Chat interactions](chat-interactions.md): queues, steering, questions, and approvals.
- [Codex modes](codex-modes.md): supported Codex reasoning and speed choices.
- [Orchestration](orchestration.md): task turn ownership and recovery behavior.
- [Browser and device previews](design/browser-and-devices.md): setup and current preview
  capabilities.

## Developer guides

- [Contributing](../CONTRIBUTING.md): setup, verification, and code conventions.
- [Architecture and ownership](architecture.md): package boundaries and where new code belongs.
- [Effect patterns](effect-patterns.md): typed failures, cancellation, and owned resources.

## Design notes and project history

These documents record proposals, implementation notes, and architectural history. They may describe
past plans or intermediate designs; use the setup and operating guides above for current product
behavior.

- [Website plan](website-plan.md)
- [Effect migration](design/effect-migration.md)
- [Native mobile navigation](design/native-mobile-navigation.md)
- [Navigation follow-through](design/navigation-follow-through.md)
- [Redesign proposal](design/redesign-proposal.md)
- [Redesign implementation](design/redesign-implementation.md)
- [Source navigation](design/source-navigation.md)

## Reference material

- [Simulator protocols](licenses/simulator-protocols.md)
- [Third-party notices](licenses/)
