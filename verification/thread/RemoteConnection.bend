import Base

type Endpoint is Type:
  LanPairing{}
  AlternatePairing{}
  InternetPairing{}
  Unavailable{}

def endpoint(lan_verified: Bool, alternate_verified: Bool, internet_paired: Bool) -> Endpoint:
  match lan_verified:
    case True{}: LanPairing{}
    case False{}:
      match alternate_verified:
        case True{}: AlternatePairing{}
        case False{}:
          match internet_paired:
            case True{}: InternetPairing{}
            case False{}: Unavailable{}

def may_publish(available: Bool, current_attempt: Bool) -> Bool:
  match available:
    case False{}: False{}
    case True{}: current_attempt

law verified_lan_keeps_preference:
  for alternate_verified: Bool
  for internet_paired: Bool
  {endpoint(True{}, alternate_verified, internet_paired) == LanPairing{} : Endpoint}

law internet_fallback_uses_its_own_pairing:
  {endpoint(False{}, False{}, True{}) == InternetPairing{} : Endpoint}

law no_verified_or_paired_route_is_unavailable:
  {endpoint(False{}, False{}, False{}) == Unavailable{} : Endpoint}

law stale_setup_cannot_publish:
  for available: Bool
  {may_publish(available, False{}) == False{} : Bool}

law background_connection_cannot_publish:
  {may_publish(False{}, True{}) == False{} : Bool}
