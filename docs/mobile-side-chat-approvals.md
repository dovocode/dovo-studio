# Mobile side-chat approvals

The parent thread's Open approval action opens the exact approval in its side chat.
The link keeps the owning computer and runtime identity. Requests in delegated child
threads remain visible in the side chat.

A link to a resolved or removed approval shows a message. It does not select another
request. Select Show pending approvals to leave the exact request view. Offline,
reconnect to check the request. Approval actions stay disabled until connected.

Remote child request links also keep the exact approval or question ID and runtime
identity.

Reopen an exact approval link after a disconnect to check its recorded decision. If the runtime
has no matching record, the app only reports that the request is no longer pending.

Verify route identity with:

```sh
pnpm exec vp test run apps/mobile/src/shell/mobile-side-chat-approval-route.test.ts
pnpm prove -- apps/mobile/src/shell/mobile-side-chat-approval-route.test.ts
pnpm exec tsc -p apps/mobile/tsconfig.json --noEmit
```
