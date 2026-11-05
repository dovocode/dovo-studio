## Delta verdict confirmed — unchanged

**9/10, ship.** This handler strengthens the keyboard-scroll correction I confirmed previously;
nothing in it revises the verdict, and there are no required regressions.

**Handler is correctly narrow**
([conversation.tsx](/home/dominic/.dovo/worktrees/dovocode/dovo-studio-goal-make-the-ul-robin-approved-should-look-way-better-and-e-83aaa924/packages/web-ui/src/conversation.tsx:49)):

- Acts only when `event.target === viewport`, so keydown on links, buttons or inputs inside the
  transcript bubbles past untouched — downward/follow behavior and control keys are unaffected.
- Only `ArrowUp`/`PageUp`/`Home` call the existing `stopScroll()`, detaching the follow controller
  so it cannot snap the reader back to the bottom; `Alt`/`Meta` chords are excluded. Downward keys
  correctly need no handling, since sticking resumes naturally at the bottom.
- No `preventDefault`: native scrolling proceeds, the handler only stops the controller fighting it.
- Listener is registered in a layout effect with matching `removeEventListener` cleanup on the same
  handler reference. Current checkout source matches the updated diff.

**Test now asserts real behavior, not just the attribute**
([check-thread-scroll-browser.mjs](/home/dominic/.dovo/worktrees/dovocode/dovo-studio-goal-make-the-ul-robin-approved-should-look-way-better-and-e-83aaa924/scripts/check-thread-scroll-browser.mjs:130)):
it checks `tabindex="0"`, focuses the viewport and confirms it is `document.activeElement`, verifies
PageUp moves more than 100px from the bottom, then End returns to the bottom. That is the exact
failure the direct verification exposed, now covered. Suite passes as reported; I did not run it,
per the read-only scope.

One factual note, not a finding: the updated diff contains nine files — the ninth is a four-line
docs pointer to the CI supplement in `docs/ui-polish/README.md`. Production changes remain only the
same three files, and there is no visual change, consistent with the supplement standing as-is.
