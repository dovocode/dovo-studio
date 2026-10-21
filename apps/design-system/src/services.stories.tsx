import type { Meta } from '@storybook/react-vite'
import {
  AuthSignIn,
  AuthAccount as Account,
  AuthAccountEmpty,
  ConnectDeviceConsent,
  ArtifactsLibrary,
  ArtifactsSignIn as ArtifactSignIn,
} from './hosted-screens.stories'

// Preserve existing catalog URLs while using the same real page fixtures as Screens / Hosted.
const meta = { title: 'Dovo/Hosted services', tags: ['autodocs'] } satisfies Meta
export default meta
export const Auth = AuthSignIn
export const AuthAccount = Account
export const AuthAccountEmptySessions = AuthAccountEmpty
export const ConnectConsent = ConnectDeviceConsent
export const Artifacts = ArtifactsLibrary
export const ArtifactsSignIn = ArtifactSignIn
