# Report a problem

Report a problem starts a normal thread on one of your computers. Your own agent reads redacted
diagnostics and the Dovo source for the exact runtime commit. It then drafts a GitHub issue for you
to review. Dovo does not file the issue. Dovo sends nothing to a Dovo service.

## Open it

- Desktop and web: open the command palette and choose **Report a problem…**. You can also open
  **Settings > Updates & about > Help** and select **Report a problem…**.
- iPhone: open **Settings > Help > Report a problem**.

The command and the settings entry appear only when a connected computer runs a runtime that
supports problem reports. Such runtimes advertise `problemReportsSupported` in their snapshot.
Update an older runtime to use the feature.

## Fill in the form

1. Describe what happened. This field is required.
2. Optionally, describe what you expected.
3. Choose the computer. Only connected computers with a supported runtime are available.
4. Choose the agent and model. The default is the default agent for threads without a project on
   that computer.
5. Choose what to include. All three options are on by default.
6. Select **Preview**. The runtime builds the redacted message and file, and the app shows them.
7. Read the preview. You cannot edit it. Select **Edit report** to change the form, or **Start
   triage thread** to start.

The thread starts without a project. The agent fetches the Dovo source into a temporary directory,
so it does not need a local project.

## What the runtime collects

The first message contains:

- Your description and your expected result.
- The triage playbook. It tells the agent to read the diagnostics, fetch the source for the running
  commit from `https://github.com/dovocode/dovo-studio` into a temporary directory, treat that
  checkout as read-only, find the likely cause and draft an issue.
- A rule that the agent must not file the issue, comment, push, open a pull request or change any
  repository or Dovo setting.

The attached file, `dovo-diagnostics.md`, contains only the sections you include:

- **App and runtime versions:** runtime version, source commit, build type, runtime distribution,
  runtime protocol version, desktop app version on the runtime computer, Node.js version, operating
  system and architecture. It also lists the reporting app's surface, version, build, channel,
  platform and, on iPhone, the app's source commit.
- **Runtime diagnostics and logs:** readiness and warnings, database and worktree folders, free
  storage, scheduler status, replication errors, queue counts, the state and duration of running
  threads, the kinds of uncertain provider operations, backup status, memory use and spikes, and the
  last runtime crash. It also includes the newest lines of `server.log`, `runtime-service.log`,
  `server-update.log`, `service.log` and `update.log` from the runtime data folder. Dovo reads at
  most 16 KB and 150 lines from each log. Thread titles, conversations and file contents are not
  included.
- **Recent app errors:** up to 20 errors that this app window recorded since it opened. On iPhone,
  the list also includes the last crash that the app saved.

The runtime limits the file to 64 KB. It keeps the newest log lines that fit and shortens the file
if necessary. If you include nothing, the thread starts without a file. If you leave out versions,
the message has no commit and the agent uses `main`.

## What the runtime redacts

The runtime redacts the message and the file before it returns the preview. It redacts the file
again when the thread starts. Redaction replaces values with `[redacted]` and user names in paths
with `[user]`. It covers:

- Device tokens, owner tokens and other token-shaped values: 32 or more letters, digits, `-` or `_`
  with both upper-case and lower-case letters. Git commit IDs stay readable.
- Agent run credentials (`dovo_run_…`).
- The active pairing code, pending pairing secrets, and pairing codes written as `pairing code`.
- API keys and access tokens, including Anthropic, OpenAI, GitHub, GitLab, Slack, AWS, Google, npm
  and Stripe keys, and JSON web tokens.
- Slack webhook addresses. The path after `hooks.slack.com/services/` contains the secret.
- Private keys in PEM and OpenSSH format. The runtime redacts each log tail as a whole before it
  splits the tail into lines, so it removes the whole key block. It also removes a key that a log
  tail or a length limit cut in two.
- `Authorization`, `Proxy-Authorization` and API key headers, including Bearer and Basic values.
- `Cookie` and `Set-Cookie` values.
- Values assigned with `=` or `:` to fields named like token, secret, password, `passwd`, `pwd`, API
  key, ticket or pairing code, in any letter case. This includes key names such as
  `aws_secret_access_key`, `private_key` and `client_key`. Names such as `sort_key` stay readable.
- Values of command-line options named like token, secret, password, API key, access key or private
  key, such as `--api-key value` and `--password=value`.
- Environment variable values in upper-case `NAME=value` assignments and in JSON environment maps.
  In the `NAME: value` form, the runtime redacts only names with an `_` that contain token, secret,
  password, key, cookie, credential, auth, session or private. Log prefixes such as `ERROR:` stay.
- The values of this runtime's own environment variables whose names contain token, secret,
  password, key, cookie, credential, auth, session or private.
- User names and passwords in URLs of every scheme, such as `https://`, `postgres://`, `redis://`
  and `mongodb+srv://`.
- User names in home-directory paths on macOS, Linux and Windows.

The thread title is `Problem:` followed by the first line of your redacted description. The title
syncs to all your devices, so the runtime makes it and ignores the title that the app sends.

Redaction is pattern based. It cannot find every secret in free text. Read the preview before you
start the thread. You cannot edit the preview. If it shows something that you do not want the agent
to read, select **Edit report**. Then turn off the section that contains it, or change your
description, and select **Preview** again.

## File the issue

The agent shows the draft in one markdown block. Copy it from the block. The agent also gives a link
that opens a new GitHub issue with the title and body filled in. You review the issue and file it
yourself.

## Access

Any paired device can create a problem report. Agent run credentials and agent device access cannot.
The routes are `POST /api/problem-reports/preview` and `POST /api/problem-reports/start`. They work
over HTTP on LAN and VPN connections, like every other runtime route. A retried start with the same
message ID reuses the thread, message and file.

## Limits

- A source checkout reports the commit of its working tree. The code can differ from that commit if
  the checkout has local changes.
- A packaged build reports the commit that it recorded at build time. A build from a source archive
  has no commit, and the agent then uses `main`.
- Runtimes started by the desktop app or from a terminal may not write log files. The file then says
  that no log files were found.
