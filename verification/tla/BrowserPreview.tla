---- MODULE BrowserPreview ----
CONSTANT OutlivesOpener

VARIABLES opener, tab, keepOpen
vars == <<opener, tab, keepOpen>>

Init ==
  /\ opener = "present"
  /\ tab = "preview"
  /\ keepOpen = FALSE

Promote ==
  /\ tab = "preview"
  /\ tab' = "regular"
  /\ keepOpen' = TRUE
  /\ UNCHANGED opener

LoseOpener(reason) ==
  /\ opener = "present"
  /\ opener' = reason
  /\ tab' = IF OutlivesOpener THEN tab ELSE "closed"
  /\ UNCHANGED keepOpen

DismissPreview ==
  /\ tab = "preview"
  /\ tab' = "closed"
  /\ UNCHANGED <<opener, keepOpen>>

CloseTab ==
  /\ tab = "regular"
  /\ tab' = "closed"
  /\ keepOpen' = FALSE
  /\ UNCHANGED opener

Next ==
  \/ Promote
  \/ LoseOpener("closed")
  \/ LoseOpener("evicted")
  \/ DismissPreview
  \/ CloseTab
  \/ UNCHANGED vars

Spec == Init /\ [][Next]_vars
PromotedTabRemainsOpen == keepOpen => tab = "regular"
====
