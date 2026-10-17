import { featureCatalog } from './feature-catalog'

export function FeatureShowcase() {
  return (
    <section
      className="capabilities section wrap"
      id="capabilities"
      aria-labelledby="capabilities-heading"
    >
      <div className="section-heading">
        <p className="eyebrow">MORE OF THE WORK, CONNECTED</p>
        <h2 id="capabilities-heading">Beyond the conversation.</h2>
        <p>Build, preview, remember and review. Keep the next step close to the task.</p>
      </div>
      <div className="capability-grid">
        {featureCatalog.map((feature, index) => (
          <article className={`capability-card capability-${feature.id}`} key={feature.id}>
            <div className="capability-heading">
              <span className="eyebrow">{feature.category}</span>
              <span className="capability-number" aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
            </div>
            <h3>{feature.title}</h3>
            <p>{feature.description}</p>
            <div className="capability-footer">
              <span>{feature.detail}</span>
              <a href={feature.guide} className="text-link">
                {feature.link} <span aria-hidden="true">↗</span>
              </a>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
