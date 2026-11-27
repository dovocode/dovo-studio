---------------------------- MODULE RepairReplay ----------------------------
EXTENDS Naturals
CONSTANTS Tip, MaxInterruptions, JumpToAcknowledgement
ASSUME Tip >= 2

\* One sender has repaired an existing record offline. The receiver already
\* durably acknowledged Tip before the repair. Each exchange carries one page.
VARIABLES phase, mode, cursor, repairedAt, modern, hasRepair, certified, remaining
vars == <<phase, mode, cursor, repairedAt, modern, hasRepair, certified, remaining>>
EndOfPage == IF cursor < Tip THEN cursor + 1 ELSE Tip

Init ==
  /\ phase = "deliver" /\ mode = "first" /\ cursor = 0
  /\ repairedAt \in 1..Tip /\ modern \in BOOLEAN
  /\ hasRepair = FALSE /\ certified = FALSE /\ remaining = MaxInterruptions

\* Page application and its repair-generation receipt commit atomically.
Deliver ==
  /\ phase = "deliver"
  /\ hasRepair' = (hasRepair \/ (cursor < repairedAt /\ repairedAt <= EndOfPage))
  /\ certified' = (certified \/ (modern /\ mode = "replay" /\ EndOfPage = Tip))
  /\ phase' = "reply"
  /\ UNCHANGED <<mode, cursor, repairedAt, modern, remaining>>

\* A legacy receiver omits generation receipts. The sender can still finish a
\* replay on this connection. A new connection starts with the first page.
ReadReply ==
  /\ phase = "reply"
  /\ IF mode = "first" THEN
       /\ phase' = "deliver"
       /\ IF certified THEN
            /\ mode' = "probe" /\ cursor' = Tip - 1
          ELSE
            /\ mode' = "replay"
            /\ cursor' = IF JumpToAcknowledgement THEN Tip ELSE EndOfPage
     ELSE
       /\ mode' = mode /\ cursor' = EndOfPage
       /\ phase' = IF EndOfPage = Tip THEN "idle" ELSE "deliver"
  /\ UNCHANGED <<repairedAt, modern, hasRepair, certified, remaining>>

\* Losing a reply after commit discards only the volatile connection cursor.
Disconnect ==
  /\ remaining > 0 /\ phase \in {"deliver", "reply"}
  /\ remaining' = remaining - 1 /\ phase' = "offline"
  /\ UNCHANGED <<mode, cursor, repairedAt, modern, hasRepair, certified>>

Reconnect ==
  /\ phase = "offline" /\ phase' = "deliver" /\ mode' = "first" /\ cursor' = 0
  /\ UNCHANGED <<repairedAt, modern, hasRepair, certified, remaining>>

Idle == phase = "idle" /\ UNCHANGED vars
Next == Deliver \/ ReadReply \/ Disconnect \/ Reconnect \/ Idle
Spec == Init /\ [][Next]_vars /\ WF_vars(Deliver) /\ WF_vars(ReadReply) /\ WF_vars(Reconnect)

SoundReceipt == certified => hasRepair
SoundIdle == (phase = "idle") => hasRepair
Settles == <>(phase = "idle" /\ hasRepair)
=============================================================================
