# A2UI state verification

[The Lean model](../verification/A2ui.lean) starts with one published card. A card has a publication
revision, a draft version, and a phase. The phase starts at editing. An accepted response claims the
revision and moves it to pending before delivery starts. Delivery can then finish as sent or
uncertain. Publishing opens a new revision with draft version zero. The model keeps a history of
claimed revisions for the proofs.

Lean checks these properties for the modeled transitions.

- A draft write with a stale publication revision or draft version cannot succeed.
- A response approved for an earlier revision or draft version cannot claim the current card.
- Each revision can be claimed at most once over any reachable history. Restart preserves the phase
  and the claim history. An old delivery result cannot change the current revision.

With [Elan](https://github.com/leanprover/elan) available, run from the repository root:

```sh
bash verification/check.sh
```

Elan uses the Lean version in `verification/lean-toolchain`. The proof uses the Lean standard
library. The Check workflow runs the same command independently of Studio's JavaScript build.

The [chat and terminal durability models](durability-verification.md) use the same toolchain.

## Relating the model to the runtime

The proof assumes that the version guard and its write form one transition. The runtime checks the
saved publication revision, draft version, and submitted flag before applying a draft. It rechecks
them after approval and records the pending lock before calling the asynchronous delivery function.
Publication can proceed while a send is in flight, so delivery completion checks that the original
revision is still current. [Runtime transitions](../packages/runtime/src/mcp-apps/a2ui.ts)

The [runtime integration tests](../packages/runtime/src/mcp-apps/a2ui.test.ts) exercise those
assumptions against SQLite, including concurrent submissions, publication during approval, and
uncertain delivery after restart. Run them from the repository root:

```sh
pnpm exec vp test packages/runtime/src/mcp-apps/a2ui.test.ts
```

The Lean result applies to the stated model. TypeScript conformance, database durability, and
request receipts are covered separately by implementation review and tests. A pending or uncertain
result can mean the thread already received the response. The modeled guarantee is that the same
revision cannot claim another send.
