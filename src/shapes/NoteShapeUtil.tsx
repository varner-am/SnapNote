import { useEffect, useRef } from 'react'
import { HTMLContainer, Rectangle2d, ShapeUtil, type TLResizeInfo, useEditor } from 'tldraw'
import { consumeShapeFocus, getShapeCallbacks } from '../lib/shapeCallbacks'
import type { SnapPadNoteShape } from './shared'
import { noteShapeProps } from './shared'

export class NoteShapeUtil extends ShapeUtil<any> {
  static override type = 'snappad-note' as const
  static override props = noteShapeProps

  override canEdit() {
    return true
  }

  override getDefaultProps(): SnapPadNoteShape['props'] {
    return {
      w: 260,
      h: 180,
      text: '',
      color: '#fff6c4',
      bucketId: '',
      order: -1,
    }
  }

  override component(shape: SnapPadNoteShape) {
    return <NoteComponent shape={shape} />
  }

  override indicator(shape: SnapPadNoteShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={18} ry={18} />
  }

  override getGeometry(shape: SnapPadNoteShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
  }

  override canResize() {
    return true
  }

  override onResize(_shape: SnapPadNoteShape, info: TLResizeInfo<any>) {
    return {
      props: {
        w: Math.max(180, info.newPoint.x),
        h: Math.max(120, info.newPoint.y),
      },
    }
  }
}

function NoteComponent({ shape }: { shape: SnapPadNoteShape }) {
  const editor = useEditor()
  const callbacks = getShapeCallbacks()
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (consumeShapeFocus(shape.id)) {
      window.setTimeout(() => {
        inputRef.current?.focus()
      }, 0)
    }
  }, [shape.id])

  return (
    <HTMLContainer
      className="snappad-note"
      style={{
        width: shape.props.w,
        height: shape.props.h,
        background: shape.props.color,
        pointerEvents: 'all',
      }}
    >
      <div className="snappad-note__drag-handle" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <textarea
        ref={inputRef}
        className="snappad-note__input"
        placeholder="Start thinking..."
        value={shape.props.text}
        onPointerDown={(event) => event.stopPropagation()}
        onChange={(event) => callbacks.updateNote(editor, shape.id, event.target.value)}
      />
    </HTMLContainer>
  )
}
