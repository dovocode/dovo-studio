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
