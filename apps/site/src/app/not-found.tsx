import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="wrap page-content">
      <p className="eyebrow">404</p>
      <h1>This page wandered off.</h1>
      <p className="page-intro">Head back to the workspace, or find the setup instructions.</p>
      <div className="actions">
        <Link className="button" href="/">
          Back to home
        </Link>
        <Link className="text-link" href="/docs/">
          Getting started →
        </Link>
      </div>
    </div>
  )
}
