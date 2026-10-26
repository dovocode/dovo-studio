# Usage and limits

Settings → Usage & limits is available on desktop, web, and mobile. Choose Costs, Tokens, or Limits,
then select all computers or a single computer. Usage ranges are 24 hours, 7 days, 30 days, and 90
days. The 24-hour chart is hourly; longer ranges use local calendar days, including days with no
activity.

## What is counted

Completed, failed, and cancelled Dovo turns are recorded separately from conversations. Deleting or
archiving a thread does not remove its usage. Existing saved turns are imported on the first
updated-runtime startup. Running turns contribute elapsed time; reported token totals are saved when
the provider turn ends.

Local Codex and Claude JSONL history and OpenCode SQLite/legacy JSON history are included, using the
standard data directories and configured custom homes. Dovo-owned sessions are excluded from CLI
imports so they are counted once. CLI records represent requests, while Dovo records represent agent
turns. CLI history does not supply Dovo's elapsed agent time. Copied request records and multiple
aliases for a runtime are deduplicated.

Only provider-reported tokens are counted. Input, output, cache read, and cache creation are
retained for new turns. Older turns may have only a total; missing tokens and unpriced records
remain visibly incomplete rather than being assumed to be zero. Mixed-model turns without a reliable
cost breakdown are unpriced. External history from a remote provider must be available on its
connected host; Dovo cannot inspect another computer's login directories through a model API.

## Subscription limits

Limits come from the signed-in host provider, independently of token and dollar totals. Refresh uses
Codex's app-server or Claude's SDK control channel without submitting a model prompt. While the
usage page is open, automatic checks run at most every five minutes per unchanged host
configuration, including failed checks. Manual refresh can request another check.

Account identity includes workspace/organization information when the provider reports it. Different
named limit buckets and model-specific windows remain separate. Unknown configurations are kept
separate. The newest account reading is used across computers; percentages are never added.

Readings older than five minutes are marked stale. Offline readings remain labelled offline. After a
reported reset passes, Dovo waits for a fresh reading instead of assuming the account is back to
100%. Failed refreshes preserve the last successful reading. API keys and providers that do not
expose subscription windows are reported as unavailable. The composer shows account allowance
separately from context-window fullness and does not block a send solely because a reading is full.

Reset credits can be checked after the account has been verified, without creating a thread.
Redeeming still requires explicit confirmation and a persistent attempt ID. Provider-specific
limitations still apply; Claude reset redemption on macOS requires access not provided by this flow.

## Cost estimates and caching

API-equivalent cost is a comparison estimate, not the subscription bill or remaining allowance.
Provider-reported OpenCode costs take precedence when known. Otherwise recorded input/output/cache
categories are priced with a cached public LiteLLM price table, with local fallback rates when
available. Pricing refreshes at most daily automatically; failed fetches keep cached data. No
conversation text or credentials are sent to the pricing source. Model catalogs still come from
their host harness, independently of pricing.

Custom API-equivalent prices are entered in USD per million tokens for an exact model ID and saved
on selected connected computers. Blank cache fields use the input price; explicit zero is accepted.
Overrides reprice recorded usage and can be removed with Use published prices. Offline destinations
are skipped, and failures name the affected computer.

Usage history and price data have separate authenticated endpoints and credential-scoped client
caches. They are not included in streaming conversation snapshots. CLI scans run on the usage path,
reuse unchanged files, and yield during large reads so chat traffic can continue.

## Pooled availability and external hubs

Limits includes a pooled overview and per-account details. Each segment represents one account, with
a consistent account order across its windows. Different plan sizes are not treated as a single
percentage of remaining capacity. An exhausted overall Weekly window gates that account's Session
availability. Model-specific weekly windows do not gate unrelated usage. Stale, offline, missing and
reset-expired observations do not count as available. Reset times are estimates from the last
provider reading; Dovo waits for a fresh reading after the reset.

Open **Manage usage hubs** in Limits to add, edit, disable or remove a CLIProxyAPI hub. Choose the
computer that should query it, enter its base HTTP(S) URL and management key, and save. HTTP is
supported for LAN/VPN hubs; URLs are not upgraded. A pasted `/v0/management` suffix is normalized.
Editing never retrieves the stored key. A blank key retains it only when the URL stays the same;
changing the URL requires its key. Removal asks for confirmation and leaves the hub itself intact.
Hubs are usage sources; they do not change agent routing or create provider agents.

The selected runtime stores the management key in its private SQLite database, which uses the
runtime's existing filesystem permissions. This is not additional encryption at rest. Keys are
excluded from API responses, workspace snapshots, usage history and client caches. Only public hub
configuration and readings are returned to paired clients. Redirects are refused, management
responses are bounded, requests time out after 15 seconds within a shared 20-second hub refresh
budget, and refresh work is coalesced with a five-minute automatic cooldown, including failures.
Runtime shutdown cancels pending hub reads.

Enabled Codex and Claude auth files are queried through CLIProxyAPI's management `api-call`
endpoint; unsupported or disabled files are skipped. Claude model-scoped weekly windows are
retained. Verified Codex identities deduplicate with the same locally reported workspace/plan.
Without a reliable workspace/organisation identity, accounts are kept separate rather than merged by
email alone. Partial failures mark only the affected accounts unavailable; healthy accounts still
contribute to pooled availability. Failed accounts retain their previous windows and original
reading timestamps. Known accounts without a successful reading appear as unknown segments, while
unsupported accounts are excluded. Removed or disabled auth files lose their previous windows on the
next successful discovery. A failed whole-hub read preserves its last reading and marks its accounts
unavailable. Credential-scoped safe client replicas remain visible offline. Older runtimes without
hub support continue showing their normal local account limits. Hub reset-credit redemption is not
included; existing verified local-account redemption is unchanged.

Costs and Tokens read history and pricing without probing subscription accounts or hubs. Limits
reads account windows without downloading usage history, scanning CLI transcripts or loading prices.
The CLI ownership exclusion scan projects only session identities in yielding 256-row pages instead
of decoding the complete history a second time.

Local account limits and hub readings refresh independently, so a slow hub does not block local
availability (or vice versa). The usage endpoint accepts an optional `section` of `local` or `hubs`;
omitting it retains the combined response. Older runtimes still provide their combined response.
Transport failures mark cached hub accounts unavailable without replacing the last successful disk
cache.
