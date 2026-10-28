import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy',
  alternates: { canonical: '/privacy/' },
  description: 'How Dovo Studio handles workspace data, optional accounts and notifications.',
}

export default function Privacy() {
  return (
    <article className="wrap page-content docs-page">
      <p className="eyebrow">DOVO STUDIO</p>
      <h1>Privacy</h1>
      <p className="page-intro">Last updated: 28 October 2026</p>
      <div className="docs-steps">
        <section>
          <h2>Your workspace and connected computers</h2>
          <p>
            Dovo Studio connects to computers you pair with. Messages, source code, files, photos,
            screenshots, agent responses and workspace activity are processed and stored by those
            computers and the tools you choose to run there. Their operators control that storage.
            Configured AI providers and integrations may receive content needed to carry out your
            requests, under their own policies. A Dovo account is optional; signing in does not
            grant access to a computer without pairing.
          </p>
        </section>
        <section>
          <h2>Optional accounts</h2>
          <p>
            If you sign in, Dovo uses its identity service to authenticate you. The Connect service
            stores your account identifier and display name, session records, and the identifiers,
            names and network addresses of computers you link. The identity service also processes
            the profile and authentication information you supply. Connect does not receive your
            paired computer access tokens as part of server discovery.
          </p>
          <p>
            Account sessions expire after 30 days. Signing out revokes that device’s account
            session; it does not delete your account, unlink all computers or revoke separate
            runtime pairings. You can unlink computers from the account directory in the app.
          </p>
        </section>
        <section>
          <h2>Sharing and account recovery</h2>
          <p>
            Sharing uploads an encrypted copy of the thread or artifact you select. The sharing
            service stores encrypted content, invitations, access metadata and encrypted prompt
            suggestions. Connect saves an encrypted recovery copy of your sharing key so signing in
            can restore access without a backup key or another device. Connect can recover this key
            and decrypt your shared content; sharing does not provide end-to-end encryption against
            Connect or its operator. Unshared workspace content stays on your paired computer.
          </p>
          <p>
            Anyone holding a public sharing link can read its content until it expires or is
            revoked. You can delete hosted copies in sharing settings. Deleting your Dovo account
            also removes its recovery records. A key lost before account recovery was enabled cannot
            be reconstructed; resetting legacy sharing requires confirming deletion of its old
            hosted copies and links and leaves local content intact.
          </p>
        </section>
        <section>
          <h2>Notifications</h2>
          <p>
            If you enable managed notifications, Connect stores your device’s push token, platform,
            and delivery permissions for the paired servers you enable. Notification delivery passes
            through Dovo’s Connect service and notification relay, then Apple Push Notification
            service or Google Firebase Cloud Messaging. Payloads can include task titles, message or
            question previews, status and identifiers used to open the relevant thread. These
            providers process delivery information under their own policies. Notification content
            may appear on your lock screen, depending on your device settings.
          </p>
          <p>
            You can disable notifications globally or per server. Revoking the account session also
            invalidates its managed delivery permissions. Connect and the relay forward notification
            content without storing it as notification history; your paired runtime maintains its
            own task data and delivery queue. Separately configured account-free relays are
            controlled by their operators.
          </p>
        </section>
        <section>
          <h2>Camera, files and dictation</h2>
          <p>
            Camera access is used when you scan a pairing code or take a photo. Files and photos you
            choose can be edited on your device before you send them to a paired computer. Selecting
            or editing an image does not itself send it to the Dovo account service.
          </p>
          <p>
            Dictation uses microphone and speech-recognition permissions. Dovo requests on-device
            recognition when available; otherwise your device’s speech service may process audio
            online. Dovo does not request a persistent audio recording for dictation. Recognized
            text is placed in the composer and is sent as message content when you submit it.
          </p>
        </section>
        <section>
          <h2>Device storage and network connections</h2>
          <p>
            The app stores preferences, connection information and working state on your device.
            Account sessions use the operating system’s secure storage. Dovo supports both HTTP and
            HTTPS addresses for paired computers, including private LAN and VPN connections. HTTP
            connections do not provide transport encryption by themselves; use a trusted network,
            encrypted VPN or HTTPS as appropriate.
          </p>
          <p>
            Hosted services and their infrastructure process network connection information, such as
            IP addresses, to serve requests and operate the service. The reviewed mobile app does
            not integrate advertising, cross-app tracking, Firebase Analytics or Crashlytics SDKs.
            Store testing services may separately collect diagnostics and feedback under their own
            terms.
          </p>
        </section>
        <section id="deletion">
          <h2>Retention, access and deletion requests</h2>
          <p>
            Linked computer metadata remains until it is unlinked or removed by the service
            operator. Expired or revoked sessions cannot authorize managed notifications. Service
            backups may temporarily retain previously stored records; the current hosted
            account-service backup configuration retains daily backups for 14 days. Data stored on
            your paired computers, third-party AI services and integrations is subject to those
            systems’ retention settings.
          </p>
          <p>
            To request access, correction or deletion of your Dovo account and associated hosted
            data, email{' '}
            <a href="mailto:info@dovocode.com?subject=Dovo%20account%20deletion">
              info@dovocode.com
            </a>{' '}
            from the address associated with your account and state your request. We may need to
            verify ownership. Do not send passwords, pairing tokens or private keys. Deleting hosted
            account data does not automatically delete files on your own computers or data held by
            independent providers.
          </p>
        </section>
        <section>
          <h2>Contact</h2>
          <p>
            For privacy questions or support, contact Dovocode at{' '}
            <a href="mailto:info@dovocode.com">info@dovocode.com</a>.
          </p>
        </section>
      </div>
    </article>
  )
}
