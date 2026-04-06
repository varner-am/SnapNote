import type { Editor, TLShapeId } from 'tldraw'

export interface ShapeCallbacks {
  updateNote: (editor: Editor, shapeId: TLShapeId, text: string) => void
  updateTask: (
    editor: Editor,
    shapeId: TLShapeId,
    updates: { title?: string; subtasks?: string },
  ) => void
  toggleTask: (editor: Editor, shapeId: TLShapeId) => void
}

let callbacks: ShapeCallbacks = {
  updateNote: () => undefined,
  updateTask: () => undefined,
  toggleTask: () => undefined,
}

export function registerShapeCallbacks(nextCallbacks: ShapeCallbacks) {
  callbacks = nextCallbacks
}

export function getShapeCallbacks() {
  return callbacks
}

let pendingFocusShapeId: string | null = null
let pendingSubtaskFocus:
  | {
      shapeId: string
      index: number
    }
  | null = null

export function queueShapeFocus(shapeId: string) {
  pendingFocusShapeId = shapeId
}

export function consumeShapeFocus(shapeId: string) {
  if (pendingFocusShapeId !== shapeId) return false
  pendingFocusShapeId = null
  return true
}

export function queueSubtaskFocus(shapeId: string, index: number) {
  pendingSubtaskFocus = { shapeId, index }
}

export function consumeSubtaskFocus(shapeId: string) {
  if (!pendingSubtaskFocus || pendingSubtaskFocus.shapeId !== shapeId) return null
  const next = pendingSubtaskFocus.index
  pendingSubtaskFocus = null
  return next
}
