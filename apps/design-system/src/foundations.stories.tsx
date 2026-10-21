import type { Meta, StoryObj } from '@storybook/react-vite'
import { dovoColors, designTokens } from '@dovo/design'

const meta = { title: 'Dovo/Foundations', tags: ['autodocs'] } satisfies Meta
export default meta
export const Language: StoryObj = {
  render: () => (
    <main style={{ maxWidth: 960 }}>
      <p
        style={{
          color: 'var(--primary)',
          fontSize: 12,
          textTransform: 'uppercase',
          letterSpacing: 2,
        }}
      >
        Dovo design language
      </p>
      <h1 style={{ fontSize: 36, fontWeight: 600, letterSpacing: '-.035em' }}>
        Quiet surfaces. Clear controls.
      </h1>
      <p>
        Graphite surfaces, blue accents, neutral primary actions. Color signals state rather than
        decorating every container. No ambient focus glows.
      </p>
      <h2>One source of truth</h2>
      <p>
        <code>@dovo/design</code> supplies colors, spacing, geometry and service styles. Desktop and
        mobile retain user-selected palettes and accessibility preferences. Hosted services use the
        default Dovo palette.
      </p>
      <h2>Interaction contract</h2>
      <ul>
        <li>Keyboard focus: a crisp two-pixel indicator; never remove focus visibility.</li>
        <li>Composer: one border indicates focus; no stacked rings or glowing shadows.</li>
        <li>
          Touch targets: at least {designTokens.touchTarget}px on mobile and coarse-pointer
          controls.
        </li>
        <li>Dense desktop controls may be smaller; touch modes increase the target area.</li>
        <li>Keep labels, validation, loading, empty and disabled states explicit.</li>
        <li>
          Native controls keep platform behavior and text scaling. Browser stories do not replace
          native verification.
        </li>
      </ul>
      <h2>Geometry and spacing</h2>
      <p>
        Controls {designTokens.radius.control}px · cards {designTokens.radius.card}px · composer{' '}
        {designTokens.radius.composer}px
      </p>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {Object.entries(designTokens.spacing).map(([name, size]) => (
          <div key={name}>
            <div style={{ width: size, height: 32, background: 'var(--primary)' }} />
            <p>
              {name}: {size}px
            </p>
          </div>
        ))}
      </div>
    </main>
  ),
}
export const Palette: StoryObj = {
  render: (_, context) => {
    const mode = context.globals.theme === 'light' ? 'light' : 'dark'
    return (
      <section
        aria-label="Dovo semantic colors"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))',
          gap: 16,
          maxWidth: 1000,
        }}
      >
        {Object.entries(dovoColors[mode]).map(([name, value]) => (
          <div
            key={name}
            style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}
          >
            <div style={{ height: 80, background: value }} />
            <div style={{ padding: 12 }}>
              <strong>{name}</strong>
              <p>
                <code>{value}</code>
              </p>
            </div>
          </div>
        ))}
      </section>
    )
  },
}
