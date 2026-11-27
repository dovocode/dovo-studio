---- MODULE PreviewCleanup ----
CONSTANT CheckCurrentTab
VARIABLES tab, probe, retain
vars == <<tab, probe, retain>>

Init ==
  /\ tab = "inactivePreview"
  /\ probe = "idle"
  /\ retain = FALSE

StartProbe ==
  /\ tab = "inactivePreview"
  /\ probe = "idle"
  /\ probe' = "pending"
  /\ UNCHANGED <<tab, retain>>

Reselect ==
  /\ tab = "inactivePreview"
  /\ tab' = "selectedPreview"
  /\ retain' = TRUE
  /\ UNCHANGED probe

Promote ==
  /\ tab \in {"inactivePreview", "selectedPreview"}
  /\ tab' = "regular"
  /\ retain' = TRUE
  /\ UNCHANGED probe

FinishProbe(protected) ==
  /\ probe = "pending"
  /\ probe' = "finished"
  /\ tab' = IF ~CheckCurrentTab \/ tab = "inactivePreview"
            THEN IF protected THEN "regular" ELSE "closed"
            ELSE tab
  /\ UNCHANGED retain

Next ==
  \/ StartProbe
  \/ Reselect
  \/ Promote
  \/ FinishProbe(TRUE)
  \/ FinishProbe(FALSE)
  \/ UNCHANGED vars

Spec == Init /\ [][Next]_vars
RetainedTabStaysOpen == retain => tab # "closed"
====
