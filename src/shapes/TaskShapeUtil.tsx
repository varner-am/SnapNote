import { useEffect, useRef } from 'react'
import { HTMLContainer, Rectangle2d, ShapeUtil, type TLResizeInfo, useEditor } from 'tldraw'
import { consumeShapeFocus, consumeSubtaskFocus, getShapeCallbacks } from '../lib/shapeCallbacks'
import type { SnapPadTaskShape } from './shared'
import { taskShapeProps } from './shared'

interface SubtaskItem {
  checked: boolean
  text: string
}

export class TaskShapeUtil extends ShapeUtil<any> {
  static override type = 'snappad-task' as const
  static override props = taskShapeProps

  override canEdit() {
    return true
  }

  override getDefaultProps(): SnapPadTaskShape['props'] {
    return {
      w: 280,
      h: 106,
      title: '',
      subtasks: '',
      status: 'active',
      bucketId: '',
      order: -1,
      completedAt: 0,
    }
  }

  override component(shape: SnapPadTaskShape) {
    return <TaskComponent shape={shape} />
  }

  override indicator(shape: SnapPadTaskShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={18} ry={18} />
  }

  override getGeometry(shape: SnapPadTaskShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
  }

  override canResize() {
    return true
  }

  override onResize(_shape: SnapPadTaskShape, info: TLResizeInfo<any>) {
    return {
      props: {
        w: Math.max(220, info.newPoint.x),
        h: Math.max(84, info.newPoint.y),
      },
    }
  }
}

function TaskComponent({ shape }: { shape: SnapPadTaskShape }) {
  const editor = useEditor()
  const callbacks = getShapeCallbacks()
  const completed = shape.props.status !== 'active'
  const titleRef = useRef<HTMLTextAreaElement | null>(null)
  const subtaskRefs = useRef<Array<HTMLTextAreaElement | null>>([])
  const pendingSubtaskFocusRef = useRef<number | null>(null)
  const subtasks = parseSubtasks(shape.props.subtasks)

  useEffect(() => {
    if (consumeShapeFocus(shape.id)) {
      window.setTimeout(() => {
        titleRef.current?.focus()
      }, 0)
    }
  }, [shape.id])

  useEffect(() => {
    autoSizeTextarea(titleRef.current)
    subtaskRefs.current.forEach((element) => autoSizeTextarea(element))
  }, [shape.props.title, shape.props.subtasks])

  useEffect(() => {
    const pendingIndex = consumeSubtaskFocus(shape.id)
    const index = pendingSubtaskFocusRef.current ?? pendingIndex
    if (index === null) return
    pendingSubtaskFocusRef.current = null
    window.setTimeout(() => {
      subtaskRefs.current[index]?.focus()
    }, 0)
  }, [shape.props.subtasks])

  return (
    <HTMLContainer
      className={`snappad-task ${completed ? 'is-complete' : ''} ${
        shape.props.status === 'archiving' ? 'is-archiving' : ''
      }`}
      style={{ width: shape.props.w, height: shape.props.h, pointerEvents: 'all' }}
    >
      <div className="snappad-task__row">
        <button
          className="snappad-task__check"
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => callbacks.toggleTask(editor, shape.id)}
        />
        <textarea
          ref={titleRef}
          rows={1}
          data-task-shape-id={shape.id}
          data-task-input-role="title"
          className="snappad-task__title"
          placeholder="Task"
          value={shape.props.title}
          onPointerDown={(event) => event.stopPropagation()}
          onChange={(event) => callbacks.updateTask(editor, shape.id, { title: event.target.value })}
        />
      </div>

      <div className="snappad-task__subtask-list">
        {subtasks.map((subtask, index) => (
          <div key={`${shape.id}-${index}`} className="snappad-task__subtask-row">
            <button
              className={`snappad-task__subcheck ${subtask.checked ? 'is-checked' : ''}`}
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() =>
                callbacks.updateTask(editor, shape.id, {
                  subtasks: serializeSubtasks(
                    subtasks.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, checked: !item.checked } : item,
                    ),
                  ),
                })
              }
            />
            <textarea
              ref={(element) => {
                subtaskRefs.current[index] = element
              }}
              rows={1}
              data-task-shape-id={shape.id}
              data-task-input-role="subtask"
              data-subtask-index={index}
              className="snappad-task__subtask-input"
              placeholder={index === 0 ? 'Add a subtask' : 'Subtask'}
              value={subtask.text}
              onPointerDown={(event) => event.stopPropagation()}
              onChange={(event) =>
                callbacks.updateTask(editor, shape.id, {
                  subtasks: serializeSubtasks(
                    subtasks.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, text: event.target.value } : item,
                    ),
                  ),
                })
              }
            />
          </div>
        ))}

        <button
          className="snappad-task__add-subtask"
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() =>
            callbacks.updateTask(editor, shape.id, {
              subtasks: serializeSubtasks([...subtasks, { checked: false, text: '' }]),
            })
          }
        >
          Add subtask
        </button>
      </div>
    </HTMLContainer>
  )
}

function parseSubtasks(raw: string): SubtaskItem[] {
  if (!raw.trim()) return []

  return raw.split('\n').map((line) => {
    const checked = line.startsWith('[x] ')
    const unchecked = line.startsWith('[ ] ')
    return {
      checked,
      text: checked || unchecked ? line.slice(4) : line,
    }
  })
}

function serializeSubtasks(items: SubtaskItem[]) {
  if (items.length === 0) return ''

  return items
    .filter((item, index) => item.text.trim().length > 0 || index === items.length - 1)
    .map((item) => `${item.checked ? '[x]' : '[ ]'} ${item.text}`)
    .join('\n')
}

function autoSizeTextarea(element: HTMLTextAreaElement | null) {
  if (!element) return
  element.style.height = '0px'
  element.style.height = `${element.scrollHeight}px`
}
