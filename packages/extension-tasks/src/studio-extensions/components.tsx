import { DataSource } from '../dashboards/data-source'
import { useState } from 'react'
import type { ExtensionContribution, ExtensionViewNode, StudioExtensionEntry } from '@dovo/protocol'
import {
  ExtensionComponentBoundary,
  extensionViewText,
  useExtensionView,
  useSettingsDraft,
  useWorkspace,
  type ExtensionViewState,
  type SaveExtensionSettings,
} from '@dovo/studio-core'
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
  Disclosure,
  DropdownMenu,
  EmptyState,
  FormField,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
  Textarea,
} from '@dovo/studio-ui'
import { DataGrid, DataView } from '../dashboards/data-view'

export function ExtensionSettingsConflicts({
  conflicts,
  resolveConflicts,
  busy,
}: Pick<ExtensionViewState, 'conflicts' | 'resolveConflicts' | 'busy'>) {
  if (!conflicts.length) return null
  return (
    <div className="space-y-2 rounded-md border p-3">
      <p role="alert">Some settings changed on another client.</p>
      <ul className="space-y-1 text-sm">
        {conflicts.map(({ id, title, saved }) => (
          <li key={id} className="break-words">
            {title}. Saved value: {extensionViewText(saved) || 'Empty'}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => resolveConflicts('saved')}
        >
          Use saved values
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => resolveConflicts('local')}
        >
          Keep my edits
        </Button>
      </div>
    </div>
  )
}

export function ExtensionComponents({
  entry,
  contribution,
  save,
}: {
  entry: StudioExtensionEntry
  contribution: Extract<ExtensionContribution, { kind: 'view' }>
  save: SaveExtensionSettings
}) {
  const { request, connected, connection } = useWorkspace()
  const state = useExtensionView(contribution.view, entry, request, connected, save, connection)
  useSettingsDraft(state.dirty, state.settingsSaving)
  return (
    <ExtensionComponentBoundary fallback={<p role="alert">This extension view could not load.</p>}>
      <div className="min-w-0 space-y-3 break-words">
        {state.implicitSources.map((source) => (
          <ViewSource key={source.id} id={source.id} state={state} />
        ))}
        <Node id={contribution.view.root} state={state} />
        <ExtensionSettingsConflicts {...state} />
        {state.dirty && (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={state.disabled || state.conflicts.length > 0}
              onClick={() => void state.save()}
            >
              Save extension settings
            </Button>
            <Button size="sm" variant="ghost" disabled={state.busy} onClick={state.discard}>
              Discard edits
            </Button>
          </div>
        )}
        {state.busy && <p role="status">Working…</p>}
        {state.error && (
          <p role="alert" className="text-destructive">
            {state.error}
          </p>
        )}
      </div>
    </ExtensionComponentBoundary>
  )
}

const tones = {
  normal: 'text-foreground',
  muted: 'text-muted-foreground',
  accent: 'text-primary',
  danger: 'text-destructive',
}
const textStyles = {
  body: 'text-sm',
  heading: 'text-base font-semibold',
  muted: 'text-sm text-muted-foreground',
  code: 'whitespace-pre-wrap font-mono text-xs',
}

function ViewSource({ id, state }: { id: string; state: ExtensionViewState }) {
  const source = state.sources.find((item) => item.id === id)
  if (!source) return null
  return (
    <DataSource
      key={state.resultScope}
      owner={['extension', state.extensionId]}
      source={source}
      read={() => state.readSource(id)}
      onData={(value) => state.setResult(id, value)}
    />
  )
}

function Node({ id, state }: { id: string; state: ExtensionViewState }) {
  const [standard, setStandard] = useState(false)
  const node = state.nodes.get(id)
  if (!node) return null
  const child = (id: string) => <Node key={id} id={id} state={state} />
  switch (node.kind) {
    case 'stack':
      return <div className="min-w-0 space-y-3">{node.children.map(child)}</div>
    case 'row':
      return (
        <div className="flex min-w-0 flex-wrap items-start gap-3">{node.children.map(child)}</div>
      )
    case 'card':
      return (
        <Card className="min-w-0 space-y-3 p-3">
          {node.label && <h3>{node.label}</h3>}
          {node.children.map(child)}
        </Card>
      )
    case 'separator':
      return <hr />
    case 'text': {
      const Tag = node.style === 'heading' ? 'h3' : 'p'
      return (
        <Tag className={textStyles[node.style ?? 'body']}>
          {extensionViewText(state.get(node.value))}
        </Tag>
      )
    }
    case 'badge':
      return <Badge variant="secondary">{extensionViewText(state.get(node.value))}</Badge>
    case 'status':
      return (
        <p role="status" className={tones[node.tone ?? 'normal']}>
          {extensionViewText(state.get(node.value))}
        </p>
      )
    case 'empty':
      return <EmptyState title={node.label} description={node.description} />
    case 'button':
      return (
        <Button
          size="sm"
          disabled={state.actionsDisabled}
          onClick={() => void state.run(node.action)}
        >
          {node.label}
        </Button>
      )
    case 'menu':
      return (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button size="sm" variant="outline" disabled={state.actionsDisabled}>
              {node.label}
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="z-50 rounded-md border bg-popover p-1 shadow-lg">
              {node.items.map((item, index) => (
                <DropdownMenu.Item
                  key={index}
                  className="cursor-pointer rounded px-2 py-1 text-sm outline-none focus:bg-accent"
                  disabled={state.actionsDisabled}
                  onSelect={() => void state.run(item.action)}
                >
                  {item.label}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )
    case 'input':
    case 'textarea': {
      const Control = node.kind === 'input' ? Input : Textarea
      return (
        <FormField label={node.label}>
          <Control
            disabled={state.disabled}
            maxLength={4096}
            value={extensionViewText(state.getSetting(node.setting))}
            onChange={(event) => state.edit(node.setting, event.target.value)}
          />
        </FormField>
      )
    }
    case 'checkbox':
    case 'switch': {
      const Control = node.kind === 'checkbox' ? Checkbox : Switch
      return (
        <label className="flex items-center gap-2 text-sm">
          <Control
            disabled={state.disabled}
            checked={state.getSetting(node.setting) === true}
            onCheckedChange={(checked) => state.edit(node.setting, checked === true)}
          />
          {node.label}
        </label>
      )
    }
    case 'select': {
      const value = state.getSetting(node.setting)
      return (
        <FormField label={node.label}>
          <Select
            disabled={state.disabled}
            value={node.items.find((item) => item.value === value)?.value ?? ''}
            onValueChange={(value) => state.edit(node.setting, value)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Choose an option" />
            </SelectTrigger>
            <SelectContent>
              {node.items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      )
    }
    case 'tabs':
      return (
        <Tabs defaultValue={node.items[0]?.child} className="space-y-3">
          <TabsList aria-label={node.label} className="flex flex-wrap gap-1">
            {node.items.map((item) => (
              <TabsTab
                key={item.child}
                value={item.child}
                className="rounded-md px-3 py-2 text-sm hover:bg-accent focus-visible:outline-ring aria-selected:bg-accent"
              >
                {item.label}
              </TabsTab>
            ))}
          </TabsList>
          {node.items.map((item) => (
            <TabsPanel key={item.child} value={item.child}>
              {child(item.child)}
            </TabsPanel>
          ))}
        </Tabs>
      )
    case 'disclosure':
      return <Disclosure title={node.label}>{child(node.child)}</Disclosure>
    case 'dialog':
      return (
        <Dialog>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline">
              {node.label}
            </Button>
          </DialogTrigger>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>{node.label}</DialogTitle>
            {child(node.child)}
          </DialogContent>
        </Dialog>
      )
    case 'data-grid':
      return <DataGrid value={state.get(node.value)} panels={node.panels} />
    case 'data-source':
      return <ViewSource id={node.source} state={state} />
    case 'table':
    case 'chart':
      return (
        <section aria-label={node.label}>
          <h3 className="mb-2 text-sm font-medium">{node.label}</h3>
          <DataView
            value={state.get(node.value)}
            chart={node.kind === 'chart' ? 'line' : 'table'}
          />
        </section>
      )
    case 'metric':
      return (
        <div>
          <h3 className="text-sm text-muted-foreground">{node.label}</h3>
          <output className="text-2xl tabular-nums">
            {extensionViewText(state.get(node.value))}
          </output>
        </div>
      )
    case 'custom': {
      const fallback = child(node.fallback)
      if (node.component.type !== 'diagram') return fallback
      return (
        <div className="space-y-2">
          {standard ? (
            fallback
          ) : (
            <ExtensionComponentBoundary fallback={fallback}>
              <Diagram node={node} state={state} />
            </ExtensionComponentBoundary>
          )}
          <Button size="sm" variant="ghost" onClick={() => setStandard(!standard)}>
            {standard ? 'Show custom component' : 'Show Studio components'}
          </Button>
        </div>
      )
    }
  }
}

function Diagram({
  node,
  state,
}: {
  node: Extract<ExtensionViewNode, { kind: 'custom' }>
  state: ExtensionViewState
}) {
  return (
    <>
      <svg role="img" aria-label={node.label} viewBox="0 0 1000 1000" className="h-48 w-full">
        {node.component.shapes?.map((shape, index) => {
          const style = { className: tones[shape.tone], fill: 'currentColor' }
          if (shape.kind === 'rect')
            return (
              <rect
                key={index}
                {...style}
                x={shape.x}
                y={shape.y}
                width={shape.width}
                height={shape.height}
              />
            )
          if (shape.kind === 'circle')
            return <circle key={index} {...style} cx={shape.x} cy={shape.y} r={shape.radius} />
          return (
            <text key={index} {...style} x={shape.x} y={shape.y} fontSize={68}>
              {extensionViewText(state.get(shape.value)).slice(0, 100)}
            </text>
          )
        })}
      </svg>
      <div className="flex flex-wrap gap-2">
        {node.component.actions?.map((item, index) => (
          <Button
            key={index}
            size="sm"
            disabled={state.actionsDisabled}
            onClick={() => void state.run(item.action)}
          >
            {item.label}
          </Button>
        ))}
      </div>
    </>
  )
}
