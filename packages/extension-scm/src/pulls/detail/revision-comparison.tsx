import { useState } from 'react'
import type { PullRevisionComparison } from '@dovo/protocol'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { Button } from '@dovo/studio-ui'
import { PullPatch } from './patch'

export function PullRevisionComparisonView({ comparison }: { comparison: PullRevisionComparison }) {
  const text = useInterfaceText()
  const [path, setPath] = useState('')
  const file = comparison.files.find((item) => item.path === path) ?? comparison.files[0]
  return (
    <section aria-label={text('Since previous revision')} className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span>{text('Changed files: {value0}', { value0: comparison.files.length })}</span>
        <a
          href={comparison.url}
          data-dovo-external
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          {text('Open comparison on GitHub')}
        </a>
      </div>
      {comparison.limited && <p role="status">{text('GitHub returned the first 300 files.')}</p>}
      {!file ? (
        <p>{text('No files changed between these revisions.')}</p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[minmax(12rem,1fr)_3fr]">
          <ul className="max-h-80 space-y-1 overflow-auto">
            {comparison.files.map((item) => (
              <li key={item.path}>
                <Button
                  variant={item.path === file.path ? 'secondary' : 'ghost'}
                  className="h-auto w-full justify-start whitespace-normal break-all text-left"
                  aria-pressed={item.path === file.path}
                  onClick={() => setPath(item.path)}
                >
                  {item.path}
                </Button>
              </li>
            ))}
          </ul>
          <div className="min-w-0">
            {file.patch ? (
              <PullPatch
                key={file.path}
                file={file}
                split={false}
                allowAgent={false}
                allowInlineComment={false}
              />
            ) : (
              <p>{text('No text patch available for this file.')}</p>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
