---------------------------- MODULE RemoteConnection ----------------------------
EXTENDS Naturals, FiniteSets

CONSTANTS CheckRouteGeneration, BindCredentials, ReplayUncertainWrite, CheckCurrentTunnel
VARIABLE state

Routes == {"lan", "alternate", "connect"}
Attempts == {1, 2}
Networks == {"wifi", "cellular"}
NoEndpoint == [route |-> "none", token |-> "none", generation |-> 0]
Credential(route) == IF route = "connect" THEN "internet" ELSE "pairing"

Init ==
  \/ \E consent \in BOOLEAN :
     state = [kind |-> "routes", generation |-> 1, paired |-> TRUE,
              lan |-> "unreachable", alternate |-> "mismatch", consent |-> consent,
              probe |-> 0, endpoint |-> NoEndpoint, phase |-> "unsent",
              dispatches |-> 0, usedWrongRoute |-> FALSE]
  \/ state = [kind |-> "tunnel", registered |-> TRUE, foreground |-> TRUE,
              online |-> TRUE, network |-> "wifi", pending |-> 0,
              inFlight |-> {}, live |-> 0, publishedObsolete |-> FALSE]

\* Direct probes compare a public descriptor before attaching the pairing token.
\* The fallback is a separate credential proven to belong to the same computer.
PickRoute ==
  IF state.lan = "verified" THEN "lan"
  ELSE IF state.alternate = "verified" THEN "alternate"
  ELSE IF ~BindCredentials /\ state.alternate = "mismatch" THEN "alternate"
  ELSE IF state.consent THEN "connect" ELSE "none"

BeginDiscovery ==
  /\ state.paired /\ state.probe = 0
  /\ state' = [state EXCEPT !.probe = state.generation]

CompleteDiscovery ==
  /\ state.probe > 0
  /\ LET route == PickRoute
         usable == route \in Routes /\ (~CheckRouteGeneration \/
                     (state.paired /\ state.probe = state.generation))
     IN state' = [state EXCEPT !.probe = 0,
          !.endpoint = IF usable
            THEN [route |-> route, token |-> Credential(route), generation |-> state.probe]
            ELSE NoEndpoint]

InvalidateDiscovery(paired) ==
  /\ state.generation < 3
  /\ state' = [state EXCEPT !.paired = paired, !.generation = @ + 1, !.endpoint = NoEndpoint]

Dispatch ==
  /\ state.endpoint.route \in Routes
  /\ state.dispatches < 2
  /\ (state.phase = "unsent" \/ (ReplayUncertainWrite /\ state.phase = "uncertain"))
  /\ LET route == state.endpoint.route
         verified == CASE route = "lan" -> state.lan = "verified"
                       [] route = "alternate" -> state.alternate = "verified"
                       [] OTHER -> state.consent
     IN state' = [state EXCEPT !.phase = "dispatched", !.dispatches = @ + 1,
          !.usedWrongRoute = @ \/ ~verified \/ state.endpoint.token # Credential(route)]

RouteNext ==
  \/ BeginDiscovery \/ CompleteDiscovery \/ Dispatch
  \/ \E accepted \in BOOLEAN : InvalidateDiscovery(accepted)
  \/ \E descriptor \in {"verified", "unreachable", "mismatch"} :
       state' = [state EXCEPT !.lan = descriptor, !.endpoint = NoEndpoint]
  \/ \E descriptor \in {"verified", "unreachable", "mismatch"} :
       state' = [state EXCEPT !.alternate = descriptor, !.endpoint = NoEndpoint]
  \/ /\ state.phase = "dispatched"
     /\ \E result \in {"confirmed", "uncertain"} : state' = [state EXCEPT !.phase = result]

\* The phone shares one setup across readers. Background, network changes and
\* invalidating a pairing detach the old attempt before a replacement can publish.
CanConnect == state.registered /\ state.foreground /\ state.online

BeginTunnel ==
  IF state.kind = "tunnel" THEN
    /\ CanConnect /\ state.live = 0 /\ state.pending = 0
    /\ \E attempt \in Attempts \ state.inFlight :
       state' = [state EXCEPT !.pending = attempt, !.inFlight = @ \union {attempt}]
  ELSE FALSE

CompleteTunnel ==
  IF state.kind = "tunnel" THEN
    \E attempt \in state.inFlight :
      LET current == CanConnect /\ state.pending = attempt
          publish == ~CheckCurrentTunnel \/ current
      IN state' = [state EXCEPT !.inFlight = @ \ {attempt},
           !.pending = IF @ = attempt THEN 0 ELSE @,
           !.live = IF publish THEN attempt ELSE @,
           !.publishedObsolete = @ \/ (publish /\ ~current)]
  ELSE FALSE

TunnelNext ==
  \/ BeginTunnel \/ CompleteTunnel
  \/ state' = [state EXCEPT !.foreground = ~@, !.pending = 0, !.live = 0]
  \/ state' = [state EXCEPT !.online = ~@, !.pending = 0, !.live = 0]
  \/ \E network \in Networks :
     /\ state.network # network
     /\ state' = [state EXCEPT !.network = network, !.pending = 0, !.live = 0]
  \/ state' = [state EXCEPT !.registered = ~@, !.pending = 0, !.live = 0]

Next ==
  \/ IF state.kind = "routes" THEN RouteNext ELSE TunnelNext
  \/ UNCHANGED state

Spec == Init /\ [][Next]_state /\ WF_state(BeginTunnel) /\ WF_state(CompleteTunnel)

OnlyCurrentEndpoint ==
  IF state.kind = "routes" /\ state.endpoint.route \in Routes
  THEN state.paired /\ state.endpoint.generation = state.generation
  ELSE TRUE

CredentialsUseVerifiedRoutes ==
  IF state.kind = "routes" THEN ~state.usedWrongRoute ELSE TRUE

TransportDoesNotReplayWrites ==
  IF state.kind = "routes" THEN state.dispatches <= 1 ELSE TRUE

OnlyCurrentTunnelPublishes ==
  IF state.kind = "tunnel" THEN ~state.publishedObsolete ELSE TRUE

Available == IF state.kind = "tunnel" THEN CanConnect ELSE FALSE
Connected == IF state.kind = "tunnel" THEN state.live > 0 ELSE FALSE
OnNetwork(network) == IF state.kind = "tunnel" THEN state.network = network ELSE FALSE
StableNetwork == \E network \in Networks : <>[]OnNetwork(network)
EventuallyReconnects == (StableNetwork /\ <>[]Available) => ([]<>Connected)
=============================================================================
