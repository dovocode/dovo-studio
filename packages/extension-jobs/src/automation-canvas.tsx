import { useApplicationState } from '@dovo/studio-core/state'
import { useMemo } from 'react'
import { canConnect } from './graph'
import { addEdge, applyEdgeChanges, applyNodeChanges, ReactFlowProvider } from '@xyflow/react'
import type { Automation } from '@dovo/studio-core'
import { Canvas, Controls } from '@dovo/studio-ui'
import { AutomationNodeView, type FlowNode } from './automation-node'
import type { RunStep } from './run-progress'
const fitViewOptions = {
  maxZoom: 1,
  padding: 0.2,
}
const nodeTypes = {
  automation: AutomationNodeView,
}
export function AutomationCanvas({
  flow,
  steps,
  selectedNode,
  onSelect,
  update,
}: {
  flow: Automation
  steps: RunStep[]
  selectedNode: string | null
  onSelect: (id: string | null) => void
  update: (transform: (flow: Automation) => Automation) => void
}) {
  const [positions, setPositions] = useApplicationState<
    Record<
      string,
      {
        x: number
        y: number
      }
    >
  >({})
  const [measurements, setMeasurements] = useApplicationState<
    Record<
      string,
      {
        width: number
        height: number
      }
    >
  >({})
  const [selectedEdges, setSelectedEdges] = useApplicationState<Set<string>>(new Set())
  const nodes = useMemo(
    () =>
      flow.nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          runStep: steps.find((step) => step.nodeId === node.id),
        },
        position: positions[node.id] ?? node.position,
        measured: measurements[node.id],
        selected: node.id === selectedNode,
      })),
    [flow.nodes, positions, measurements, selectedNode, steps],
  )
  return (
    <ReactFlowProvider key={flow.id}>
      <Canvas<FlowNode>
        nodes={nodes}
        edges={flow.edges.map((edge) => ({
          ...edge,
          selected: selectedEdges.has(edge.id),
        }))}
        isValidConnection={(connection) => canConnect(flow, connection.source, connection.target)}
        nodeTypes={nodeTypes}
        colorMode="dark"
        fitViewOptions={fitViewOptions}
        onNodesChange={(changes) => {
          const selection = changes.find((change) => change.type === 'select' && change.selected)
          if (selection?.type === 'select') onSelect(selection.id)
          else if (
            changes.some(
              (change) =>
                change.type === 'select' && !change.selected && change.id === selectedNode,
            )
          )
            onSelect(null)
          if (changes.some((change) => change.type === 'dimensions'))
            setMeasurements((current) => {
              const next = {
                ...current,
              }
              let changed = false
              for (const change of changes)
                if (
                  change.type === 'dimensions' &&
                  change.dimensions &&
                  (current[change.id]?.width !== change.dimensions.width ||
                    current[change.id]?.height !== change.dimensions.height)
                ) {
                  next[change.id] = change.dimensions
                  changed = true
                }
              return changed ? next : current
            })
          if (changes.some((change) => change.type === 'position' || change.type === 'remove'))
            setPositions((current) => {
              const next = {
                ...current,
              }
              for (const change of changes)
                if (change.type === 'position' && change.position) {
                  if (change.dragging) next[change.id] = change.position
                  else delete next[change.id]
                } else if (change.type === 'remove') delete next[change.id]
              return next
            })
          const edits = changes.filter(
            (change) =>
              change.type !== 'select' &&
              change.type !== 'dimensions' &&
              !(change.type === 'position' && change.dragging),
          )
          if (!edits.length) return
          update((current) => {
            const nodes = applyNodeChanges<FlowNode>(edits, current.nodes).map(
              ({ id, position, data }) => ({
                id,
                type: 'automation' as const,
                position,
                data,
              }),
            )
            const ids = new Set(nodes.map((node) => node.id))
            return {
              ...current,
              nodes,
              edges: current.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
            }
          })
        }}
        onEdgesChange={(changes) => {
          setSelectedEdges((current) => {
            const next = new Set(current)
            for (const change of changes) {
              if (change.type === 'select') {
                if (change.selected) next.add(change.id)
                else next.delete(change.id)
              } else if (change.type === 'remove') next.delete(change.id)
            }
            return next
          })
          const edits = changes.filter((change) => change.type !== 'select')
          if (edits.length)
            update((current) => ({
              ...current,
              edges: applyEdgeChanges(edits, current.edges).map(({ id, source, target }) => ({
                id,
                source,
                target,
              })),
            }))
        }}
        onConnect={(connection) => {
          if (canConnect(flow, connection.source, connection.target))
            update((current) => ({
              ...current,
              edges: addEdge(connection, current.edges).map(({ id, source, target }) => ({
                id,
                source,
                target,
              })),
            }))
        }}
        onNodeClick={(_, node) => onSelect(node.id)}
        onPaneClick={() => onSelect(null)}
      >
        <Controls fitViewOptions={fitViewOptions} />
      </Canvas>
    </ReactFlowProvider>
  )
}
