import Base

type Consent is Data:
  Held{}
  Started{}

# The runtime checks the saved server on the paired computer before opening consent.
def start(current_revision: Bool, needs_sign_in: Bool) -> Consent:
  match current_revision:
    case False{}: Held{}
    case True{}:
      match needs_sign_in:
        case False{}: Held{}
        case True{}: Started{}

type Credential is Data:
  Connected{}
  NeedsSignIn{}

def require_sign_in(owns_connection: Bool) -> Credential:
  match owns_connection:
    case True{}: NeedsSignIn{}
    case False{}: Connected{}

law stale_warning_cannot_start_consent:
  for needs_sign_in: Bool
  {start(False{}, needs_sign_in) == Held{} : Consent}

law current_warning_starts_consent:
  {start(True{}, True{}) == Started{} : Consent}

law connected_server_holds_consent:
  {start(True{}, False{}) == Held{} : Consent}

law old_session_cannot_expire_new_sign_in:
  {require_sign_in(False{}) == Connected{} : Credential}
