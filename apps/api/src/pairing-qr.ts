import QRCode from 'qrcode'
import { pairingInvitationUrl, type PairingInvitation } from '@dovo/protocol'

export async function pairingQr(invitation: PairingInvitation) {
  const url = pairingInvitationUrl(invitation)
  const terminal = await QRCode.toString(url, {
    type: 'terminal',
    small: true,
    errorCorrectionLevel: 'M',
  })
  return { url, terminal }
}
