# PR retrieval and cross-device project identity audit

Reviewed the current dirty checkout on 2026-10-30 with three read-only Muse `muse-wonder-full-1.0`
reviews and independent parent validation. No Claude was used. The existing stability fixes and
Effect 4.1 changes were preserved.

The original scope was discovery. Dominic subsequently requested reliable PR recovery, removal of
repeated PR-loading failure messages, and fixes for the project metadata findings. Both the PR and
project metadata changes below implement those follow-ups.

## Implemented and verified

- **Retry now rechecks identity discovery.** Desktop Refresh wakes the source-identity poller;
  mobile Refresh restarts discovery immediately. An online computer whose identity lookup failed no
  longer has to wait for the periodic discovery pass. Server-side reader/destination guards still
  run on every live read. Different-account failover remains forbidden.
- **Refresh intent survives discovery failure.** Pending refreshes are tracked per remote and
  acknowledged after a successful complete page prefix, rather than consumed before a source is
  ready. One recovering source does not discard another source's requested refresh.
- **Offline PR lists are scoped to repository target and verified account.** Both clients use the
  same versioned cache-key helper. Names remain presentation-only. A remote/account change cannot
  reuse the old key. Unverified readers do not persist or hydrate account-specific rows. Mobile
  persists the verified identity for offline restoration and includes reader identity in its worker
  identity; a restart offline was exercised with actual hooks and in-memory storage.
- **Explicit refresh recovers from future-dated saved results.** A successful forced response
  (`stale: false`, no refresh error) can replace a saved snapshot with a later wall-clock timestamp.
  Failed/stale responses still preserve the newer saved prefix. Applied to list and detail reads on
  desktop and mobile.
- **Manual refresh does not join an older background fetch.** Both runtime PullCache and the owner's
  peer PR cache wait for the older non-forced read to settle, then perform a fresh read. Concurrent
  already-forced reads can still coalesce. Deferred-upstream regressions cover both cache layers.
  Writes are unaffected and are never replayed by this change.
- **Repeated error cards are collapsed.** A compact Sources control exposes source-specific
  diagnosis and Retry on demand. The empty state says it is waiting for sources, rather than
  claiming the repository contains no PRs or repeatedly announcing loading failures.
- **Blocked sources survive list-state changes.** Unavailable status is projected independently of
  retained rows, so switching Open/Closed does not make an account-blocked repository disappear or
  present it as an empty successful result. Live reads remain blocked until explicit recovery.
- **Explicit source acceptance handles fast responses.** Discovery can finish the first read before
  its acceptance continuation clears old rows. Desktop now schedules a replacement worker after that
  clear. The actual-hook regression covers acceptance on the same project after a blocked-account
  state switch.

Sources: `packages/protocol/src/scm/pulls/pull-sources.ts`, desktop/mobile
`scm/pulls/list/use-pulls.ts`, `packages/extension-scm/src/connections/source-readers.ts`,
`apps/mobile/src/scm/source-reader.ts`, `packages/runtime/src/scm/pulls/pull-cache.ts`,
`packages/runtime/src/retrieval/coordinator.ts`.

## Follow-up fixes

The eight findings below are now addressed in this checkout:

- Shared settings merge per category, including explicit resets. Name/icon edits no longer overwrite
  independently changed task defaults, lifecycle settings, agents, tools or prompts. Pending sync
  compares category revisions even when the entry's overall revision is already known. Legacy
  whole-entry documents remain readable.
- Desktop and mobile project appearance settings now offer a shared display name and an explicit
  **Share detected icon** action. Each checkout keeps its local name/path. Grouped project labels
  prefer an explicitly shared name even when another computer still has a shorter local label.
  Desktop project menus and mobile project filters now render project images/initials consistently.
- Legacy icon promotion occurs only after confirmed Git identity, removes the migrated local copy,
  and refuses promotion across a remote retarget. Icon saves check the expected/last-confirmed
  identity. Shared presentation and reset tombstones survive pending/failed Git lookups. Identity
  failures have a bounded 15-second cache, with immediate explicit refresh available.
- PR writes invalidate every local destination/worktree/URL cache and broadcast invalidation to
  registered paired gateways. Invalidations contain no credentials or provider writes; receiving
  them never forwards them again. Unreachable/older peers use existing TTL expiry. Account and
  destination guards remain unchanged. The conservative local invalidation can refresh unrelated
  read caches after a write; canonical cache sharing is not required for correctness.
- GitLab pages the ordered union of closed and merged MRs, with lookahead, deduplication and
  explicit bounds. Open MRs cannot hide closed results. GitLab closed, Azure and Bitbucket PR lists
  stop at their supported 100-page limit and show a provider-specific notice instead of offering a
  failing next page. Clients preserve the notice through multi-page refreshes.
- Known GHE path case is normalized consistently for clone identities and PR links after host
  configuration or successful GitHub verification. Existing shared settings keys follow only those
  confirmed aliases. Unknown/self-hosted case-sensitive paths and custom ports remain distinct.
- Removing the last local clone preserves metadata shared with other computers. Explicit category
  resets retain tombstones, rather than relying on deleting shared entries.
- Verification also exposed a real index-stat refresh in the read-only changed-files path. Its Git
  status call now disables optional index writes; the existing byte-for-byte index regression
  passes.

Follow-up validation: 200 targeted tests across 19 suites, desktop/mobile shared-presentation
behavior and 320/390/1280px layouts, PR hook/routing/list layouts, scoped settings, and thread
project panels. Protocol, runtime, extension-scm and mobile typechecks and focused lint/format
checks passed. The new presentation browser check is included in `test:scoped-settings:browser`.

All participating clients/runtimes need the category-revision update for independent offline merges;
older versions can strip that additive metadata and retain legacy whole-entry semantics. Native
devices, real paired computers and live non-GitHub accounts were not exercised. Integrated release
verification subsequently passed all 5,904 monorepo tests (12 skipped), all 32 builds and 28
typechecks, and workspace formatting/lint (zero errors, ten existing warnings). The detailed release
verification and remaining native/package gates are recorded in
[the stability audit](stability-audit-2026-10-29.md#integrated-release-verification-2026-10-30).

## Original discovery findings

The evidence and directions below record the pre-fix behavior. Follow-up implementation status and
verification are listed above.

### 1. Independent project settings edits overwrite one another

**P2 correctness; reproduced using production helpers.** Shared settings use one last-writer-wins
revision for the entire project value. Two disconnected machines can edit different categories (icon
versus task defaults), then the winning entry restores the loser's old category. Legacy icon
migration can create an icon-only entry that displaces another machine's defaults/prompts.

Evidence: `packages/protocol/src/runtime/connection/scoped-settings.ts:88` selects one whole entry;
`project-icons.ts:27` copies the machine's current whole value when editing an icon;
`packages/runtime/src/http/support/runtime-snapshot.ts:104` performs migration before enrichment.
The parent probe confirmed an accepted new icon disappearing after an unrelated newer defaults edit.

Direction: independent revisions for independent settings categories, with explicit icon reset
tombstones. Test two disconnected runtimes editing different categories and syncing in both orders.
Do this before extending shared presentation metadata.

### 2. Shared project names are missing

**Product gap; source-confirmed and helper-probed.** The shared settings schema contains an icon but
no display name. `Repository.name` is local. Grouped pickers choose the shortest clone name; other
surfaces use local names or the first encountered source. Adding a clone called `ds` can change the
group label from `Dovo Studio` to `ds`.

Evidence: `packages/protocol/src/workspace.ts:195`,
`packages/protocol/src/runtime/connection/project-machines.ts:71`,
`packages/protocol/src/runtime/connection/scoped-settings.ts:326`.

Direction: a shared display name keyed by confirmed canonical remote; retain the checkout's local
label/path as machine-specific context. Use one presentation resolver for task rows, project
pickers, settings choices and headers. Add explicit rename on desktop and mobile.

### 3. Icons are inconsistent across project surfaces

**Product gap; source-confirmed.** Custom PNG/emoji icons share through client-mediated settings
sync. Detected favicons deliberately come from each checkout; they are not shared. Branches, missing
files and different application roots can therefore produce different detected icons. Several
pickers ignore both forms: desktop ProjectsMenu renders name-derived initials, while mobile
project-filter rows render generic folder icons. The composer already uses ProjectIcon.

Evidence: `packages/runtime/src/scm/repositories/project-icon.ts:6`,
`packages/protocol/src/workspace.ts:996`,
`packages/extension-scm/src/connections/projects-menu.tsx:256`,
`apps/mobile/src/tasks/list/project-thread-filter.tsx:131`.

Direction: render the shared chosen icon consistently on every project surface. Keep detection as a
fallback, with an explicit way to adopt a detected image as the shared icon. Avoid a
last-scanned-checkout-wins rule. Extend the bounded detector to common SVG/static paths and
configured monorepo application roots rather than recursively scanning an entire repository.

### 4. Old local icons can be promoted under a different remote

**P2 correctness; helper reproduction plus source trace.** The icon-save route retains a local
override. Snapshot enrichment changes the stored Git identity without removing that override. On a
later snapshot, migration can publish the old image under the new remote's shared key. The parent
probe produced shared entries for both old and new remotes from one local override.

Evidence: `packages/protocol/src/runtime/connection/project-icons.ts:32`,
`packages/runtime/src/http/support/runtime-snapshot.ts:183`,
`packages/runtime/src/http/endpoints/scm-routes.ts:173`.

Direction: retain provenance for migrated local overrides and require confirmed current identity
before promotion. Icon saves should reject an unexpected/unresolved previously shared identity, as
project settings saves already do. Do not automatically move executable defaults or permissions when
an arbitrary `git remote set-url` points a checkout at a different project. A verified forge rename
and an intentional retarget are different operations.

### 5. Snapshot error/pending branches can show a reset icon again

**P2 presentation; source-confirmed, not reproduced end to end.** Shared icon projection runs in the
successful identity branch. Pending/error branches spread stored local `iconOverride`, so a reset
received from another machine can temporarily reappear when a checkout is unavailable. Rejected Git
identity reads are also removed from the cache, allowing unavailable/pending presentation to
alternate with polling timing.

Evidence: `packages/runtime/src/http/support/runtime-snapshot.ts:175`, `:190`, `:207`;
`packages/runtime/src/scm/git/git.ts:589`.

Direction: apply reset semantics consistently while preserving last-confirmed identity provenance;
retain a bounded error state for unavailable checkouts. Test repeated pending/failing snapshots
after a remote reset.

### 6. Invalidation does not cover every equivalent PR view

**P2 freshness; source-confirmed, two-runtime failure sequence not executed.** Production
destination identity includes the checkout/URL/peer binding. Main-checkout and worktree views of the
same account/repository can therefore occupy separate caches, while invalidation is keyed by exact
cwd aliases. Separately, owner PR writes invalidate owner state but do not use the existing peer
invalidation broadcast to notify other gateways. Another computer can show a pre-action list/detail
as fresh until its normal TTL expires.

Evidence: `packages/runtime/src/scm/forges/integration/source-context.ts:245`, `forge-pulls.ts:781`,
`packages/runtime/src/scm/pulls/pull-cache.ts:583`,
`packages/runtime/src/retrieval/coordinator.ts:262`, `:452`, `packages/runtime/src/services.ts:309`.

Direction: separate canonical read-cache identity from mutation/navigation binding identity;
preserve existing destination guards. Invalidate matching repository/account read caches across
worktree aliases and use the existing peer invalidation mechanism after writes. Do not weaken
binding checks or replay uncertain writes to obtain freshness.

### 7. GitLab closed results can begin with an empty page despite matching MRs

**P2 retrieval; reproduced through the production adapter with a synthetic transport.** GitLab
closed listing requests `state=all`, paginates, then removes open rows. Fifty recently updated open
MRs produce zero closed rows on page one, `hasMore: true`, and a matching merged MR on page two.
Consumers that stop on an empty page miss it.

Evidence: `packages/runtime/src/scm/forges/providers/forge-gitlab.ts:114`. Parent probe output:
`{firstPageRows:0,hasMore:true,secondPageRows:1}`.

Direction: page the combined closed/merged collection with sufficient lookahead, rather than
filtering each all-state page. Keep explicit pagination and provider request bounds.

### 8. GitHub Enterprise case normalization differs by entry point

**P2 identity/navigation; reviewer helper probe and parent source cross-check.** Checkout-only
remote normalization preserves self-hosted path case, while forge/PR URL normalization for GitHub
lowercases it. The same GHE repository can split into duplicate sources and a deep link may fail to
match the checkout-derived binding.

Evidence: `packages/protocol/src/runtime/connection/project-machines.ts:45`,
`packages/protocol/src/scm/pulls/pull-sources.ts:7`,
`packages/protocol/src/scm/pulls/pull-links.ts:135`.

Direction: normalize with known provider semantics consistently. Never globally lowercase arbitrary
Git server paths or equate SSH aliases/custom ports without evidence. Standard public SSH/HTTPS
pairs already normalize correctly; forks remain separate.

## Further bounded follow-ups

- Resolved in the follow-up: removing a local checkout preserves shared metadata; resets use
  category tombstones. Supported PR page limits are explicit and never offer an invalid next page.
- Bitbucket deep pages repeat cursor traversal and per-row hydration. Measure requests/latency
  before changing cache limits; this can make peer retrieval less reliable on large projects.
- Personal filters and search operate on loaded rows. Existing UI correctly labels that scope;
  provider-wide search would be a separate product feature, not a silent completeness claim.

## Verification and limits

- Initial baseline: 112 tests across project metadata, source identity, PR cache/paging and shared
  retrieval suites passed.
- Following implementation: 84 tests across nine focused protocol/client/cache/retrieval suites
  passed together, including the new cache and refresh regressions.
- Browser checks passed for actual desktop/mobile PR hooks (account selection, transient discovery
  failure, preserved refresh intent, blocked-source state changes and mobile offline restart),
  desktop source-reader integration, mobile PR selected-source/pagination, and list layout at
  320/390/1280px. Browser fixtures mock native/network boundaries and use managed Playwright
  Chromium.
- Protocol, extension-scm, mobile and runtime typechecks passed; focused formatting/lint/type checks
  passed. Protocol output was rebuilt for its new exported helper.
- A live read-only GitHub list request from this checkout succeeded (zero open PRs at that moment).
  This does not verify other saved accounts, paired computers or live non-GitHub forges.
- The initial targeted follow-up did not include full monorepo verification. The integrated
  verification above supersedes that limit; native devices and live external forge writes remain
  untested. Nightly publication still requires CI and package verification.

The follow-up implements the recommended settings, presentation, invalidation and pagination fixes.
Bitbucket request amplification remains a measured-performance follow-up; provider-wide search is a
separate feature. HTTP LAN/VPN support, pairing/device-token authorization and uncertain-write
protection are preserved.
