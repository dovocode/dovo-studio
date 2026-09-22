// From Vercel AI Elements (MIT).
import type { ReactFlowProps, Node, Edge } from '@xyflow/react'
import { Background, ReactFlow } from '@xyflow/react'
import type { ReactNode } from 'react'

type CanvasProps<N extends Node, E extends Edge> = ReactFlowProps<N, E> & {
  children?: ReactNode
}

const deleteKeyCode = ['Backspace', 'Delete']

export const Canvas = <N extends Node = Node, E extends Edge = Edge>({
  children,
  ...props
}: CanvasProps<N, E>) => (
  <ReactFlow<N, E>
    deleteKeyCode={deleteKeyCode}
    fitView
    panOnDrag={false}
    panOnScroll
    selectionOnDrag={true}
    zoomOnDoubleClick={false}
    {...props}
  >
    <Background bgColor="var(--sidebar)" />
    {children}
  </ReactFlow>
)
