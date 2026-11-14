# T3 feature additions

This change adds the missing features from the 9 to 14 November comparison.

## Reply to a response

Select Reply under an assistant response. Dovo adds its message ID and up to 500 characters of
quoted text to the current draft. It does not send the draft. The agent can use `conversation_read`
to read more of that response in pages of 8,000 characters.

The tool reads only assistant messages in the current thread. Bot context resets still exclude old
messages. The runtime reads one message from storage instead of loading the full thread.

## OpenCode account limits

OpenCode now appears in account usage when its server provides the experimental
`/api/experimental/usage/limits` endpoint. Dovo uses the configured server and its existing Basic
authentication. It does not send a model prompt.

The view includes Go session, weekly and monthly windows, console budgets, and reset times. Endpoint
and workspace IDs keep accounts separate. A server that returns 404, 405, an HTML page, or
`data: null` has no supported limit report. Authentication and service errors remain errors.

Local HTTP tests verify the request and response handling. A live OpenCode account has not been
tested.

## Spreadsheet previews

Open XLSX, XLS, or ODS files in thread Files to view a table. Select a worksheet. On desktop, drag a
row or column edge. You can also focus its resize control and use the arrow keys. On mobile, select
a row or column number and change its height or width. Reset sizes restores the defaults.

CSV and TSV keep the text editor. Select Table preview to see a table. Select Text view to return to
the editor. The switch stays hidden while a text draft exists.

Previews do not change the file or execute formulas or macros. They use SheetJS 0.20.3 in a runtime
worker. Limits are:

- 8 MB input and a 10-second parse deadline.
- 100 worksheets and an archive metadata check for 32 MB expanded size.
- 128 MB worker old-generation heap and 16 MB young-generation heap. These limits do not cap total
  process memory.
- 200 rows, 50 columns, 2,000 characters per cell, and 500,000 characters across all cells.
- 25 visible rows per mobile page.

The existing file route enforces thread, checkout, and path access. Tests use real workbook bytes
and real HTTP requests. Browser tests check resizing and stale responses after a computer switch.

## Interface languages

Select Settings, General, Interface language. The choice is local to each device. The default stays
English. Automatic uses the device locale and falls back to English.

Every explicit ASR locale is available, including regional variants. Speech and interface choices
are separate. Regional variants share the base language catalog. Arabic uses right-to-left layout.

The catalog now covers more than 4,200 authored mobile strings in 29 base languages. It includes
settings, help, local errors, accessibility labels, menus, Bots, threads, files and terminals.
Translations ship with the app. The app does not contact a translation service.

Only marked interface copy enters the catalog. Message values use named placeholders. Names,
messages, file paths, commands and drafts stay unchanged. Changing the language keeps open form
drafts. Settings search accepts translated labels and keeps stable English keys in deep links.

Native widgets and Live Activity content use a separate SwiftUI serializer. They can still show
English. Provider messages and other runtime content can also remain in their source language. The
translations have not had native-speaker review.

Check catalog coverage and placeholders with:

```sh
pnpm exec vp test packages/studio-core/src/interface-language.test.ts apps/mobile/src/interface-copy.test.ts --maxWorkers=1
pnpm exec playwright install chromium
node scripts/check-mobile-settings-layout-browser.mjs --translations-only
```

The browser check uses the real language provider and Settings screens with mocked native controls.
It checks translated search in Dutch, German, Greek, Turkish and Arabic, right-to-left direction,
stable deep links, literal message values and kept drafts. It does not verify physical iPhone
layout.

## Theme tools

With Studio UI tools enabled, an agent can use `studio_ui` with `theme-read` to read the local mode
and palette list. `theme-set` changes the mode or palette through the normal saved preferences. It
requires a discovered local session ID. Use it only when the user asks for an appearance change.

Read-only agents can read themes but cannot change them. The change affects that app device. Other
computers and phones keep their own settings. Browser tests verify persistence after reload and
rejection of unknown palettes.

## Resolved discussions

Desktop and mobile now collapse fully resolved inline review threads. The summary shows author
initials, path, and comment count. Expand it to read the original comments and use the existing
actions. Unresolved comments and review decisions stay visible. Links into resolved discussions open
their group.

## ACP replay and Git push destinations

The ACP v2 stream handler now appends new messages and tail chunks without rebuilding the full text
each time. Patches to earlier messages still rebuild the text in the original order.

The local benchmark for 2,000 messages with eight chunks each improved from about 17,180 ms to 80
ms. This measures the adapter without a model request. It does not measure network latency or full
app memory use.

Git push now uses `branch.<name>.pushRemote`, then `remote.pushDefault`, then the fetch upstream.
Git still applies `pushurl`. Dovo keeps an existing fetch upstream when the push destination
differs. Local bare-repository tests verify these paths. Existing PR tests verify an explicit fork
head and base. No live PR was created. Cross-host credential behavior has not been newly verified.

## Terminal names

On desktop and mobile, select the pencil beside a thread terminal tab to rename it. Each split pane
also has a rename control beside its title. For a standalone terminal, use Rename in its actions.
Select Use automatic title to let the shell and its programs set the title again.

Names stay on the terminal's host computer and survive session recovery. Renaming keeps the shell,
connection, and output. A failed save keeps the entered name so you can retry.

Agents can pass `title` to `terminal_run` to name a tab when they open it. They can then call
`terminal_rename` with that terminal's `id` and a new `title`. Set `title` to `null` to restore its
automatic title. The tool can change only terminals opened by that tool session. Read-only runs and
runs with a restricted native sandbox cannot use it. Names use the same 256-character limit and
single-line validation as names entered by a person.

The browser checks cover tabs, split panes, automatic titles, failed saves, pending saves, and a
computer change during a save. The mobile terminal adapter check runs in Chromium with native
controls replaced. Physical iPhone appearance has not been checked for this change.

## Verification commands

Use the repository's normal install first. Then run:

```sh
pnpm exec playwright install chromium
pnpm build
pnpm typecheck
pnpm check
pnpm test:terminal-layout:browser
pnpm test:workspace-submit:browser
pnpm test:mobile-workspaces:browser
node scripts/check-mobile-native-terminal-browser.mjs
pnpm exec vp test packages/protocol/src/runtime/connection/terminal-metadata.test.ts packages/runtime/src/terminal/metadata-runtime.test.ts packages/runtime/src/terminal/recovery.test.ts
pnpm exec vp test packages/runtime/src/agent-tools/server.test.ts packages/runtime/src/agent-tools/context-budget.test.ts packages/runtime/src/auth/run-credentials.test.ts
pnpm test:weekly-features:browser
pnpm test:studio-tools:browser
pnpm test:file-drafts:browser
pnpm test:mobile-thread-files:browser
pnpm --filter @dovo/mobile exec expo export --platform ios --output-dir /tmp/dovo-week-ios-export
node scripts/benchmark-acp-updates.mjs
```

The full build, all 31 workspace type checks, and 2,153 shared, OpenCode, and Git tests pass
locally. Focused HTTP and browser checks also pass. The iOS bundle export passes. Repository checks
report zero errors and existing warnings.

The mobile browser checks use native control adapters. They do not establish physical iPhone
appearance. The screenshot issues already have source fixes for themed Text and the compact
single-row browser without its top header. The browser checks verify those paths. The current
changes have not been installed on a physical iPhone.
