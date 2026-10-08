import Image from 'next/image'

export function WorkspaceScreenshot({ automation = false }: { automation?: boolean }) {
  const source = automation ? '/screenshots/automations.png' : '/screenshots/workbench.png'
  const description = automation
    ? 'Dovo Studio automation canvas connecting a weekday schedule, an agent task and a human review step.'
    : 'Dovo Studio workbench showing project threads, a coding agent conversation and the follow-up composer in the graphite and blue theme.'
  return (
    <figure className="product-screenshot">
      <a
        href={source}
        aria-label={`View full-size ${automation ? 'automation' : 'workbench'} screenshot`}
      >
        <Image
          src={source}
          width={1500}
          height={980}
          sizes="(max-width: 1260px) 100vw, 1180px"
          alt={description}
          preload={!automation}
        />
      </a>
      <figcaption>
        {automation
          ? 'Schedules, agent tasks and human review in the automation editor.'
          : 'The actual Dovo Studio workbench. Captured with a demo project.'}
      </figcaption>
    </figure>
  )
}
