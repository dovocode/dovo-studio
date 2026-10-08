import { mobileGuide } from './site-links'

export function MobileAvailability() {
  return (
    <section className="mobile-availability" aria-label="Mobile availability">
      <p className="eyebrow">MOBILE, IN PROGRESS</p>
      <h2>Your workspace, beyond your desk.</h2>
      <div className="mobile-grid">
        <article>
          <div className="mobile-heading">
            <h3>iPhone</h3>
            <span className="availability-badge">Work in progress</span>
          </div>
          <p>
            The native iPhone app is being built. Developers can install a local build using a Mac,
            Xcode and their Apple signing setup.
          </p>
          <a className="text-link" href={mobileGuide}>
            Local iPhone build instructions ↗
          </a>
        </article>
        <article>
          <div className="mobile-heading">
            <h3>Android</h3>
            <span className="availability-badge">Coming soon</span>
          </div>
          <p>Android is coming next. There’s no public Android download yet.</p>
        </article>
      </div>
    </section>
  )
}
