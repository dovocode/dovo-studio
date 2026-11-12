import nacl from 'tweetnacl'
import { v4 } from 'uuid'

// React Native has no browser crypto global. Use the platform CSPRNG already configured
// for encryption, including Expo Crypto on mobile and Web Crypto on HTTP browser clients.
export const randomUUID = () => v4({ random: nacl.randomBytes(16) })
