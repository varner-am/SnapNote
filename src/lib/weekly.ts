import { addDays, format, startOfWeek } from 'date-fns'
import type { Editor } from 'tldraw'
import { createShapeId } from 'tldraw'

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function getWeekStartIso(input?: string) {
  return format(startOfWeek(input ? new Date(input) : new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
}

export function createWeeklyBucketSpecs(weekStart: string) {
  const baseDate = new Date(weekStart)
  const specs = DAY_LABELS.map((label, index) => {
    const column = index
    return {
      id: label.toLowerCase(),
      title: label,
      dateLabel: format(addDays(baseDate, index), 'MMM d'),
      x: 80 + column * 240,
      y: 90,
      w: 220,
      h: 620,
      accent: '#9ac6a4',
    }
  })

  return [
    ...specs,
    {
      id: 'eventually',
      title: 'Eventually',
      dateLabel: 'No date',
      x: 80,
      y: 760,
      w: 780,
      h: 220,
      accent: '#8cc9d2',
    },
    {
      id: 'misc',
      title: 'Misc Notes',
      dateLabel: 'Loose capture',
      x: 900,
      y: 760,
      w: 860,
      h: 220,
      accent: '#c6acd8',
    },
  ]
}

export function seedWeeklyBuckets(editor: Editor, weekStart: string) {
  ;(editor as any).createShapes(
    createWeeklyBucketSpecs(weekStart).map((bucket) => ({
      id: createShapeId(),
      type: 'snappad-bucket',
      x: bucket.x,
      y: bucket.y,
      props: {
        w: bucket.w,
        h: bucket.h,
        title: bucket.title,
        dateLabel: bucket.dateLabel,
        bucketId: bucket.id,
        accent: bucket.accent,
      },
    })),
  )
  editor.zoomToFit({ animation: { duration: 0 } })
}

export function snapTasksToBuckets(editor: Editor) {
  const shapes = (editor as any).getCurrentPageShapes() as any[]
  const bucketShapes = shapes.filter((shape) => shape.type === 'snappad-bucket')
  const contentShapes = shapes.filter(
    (shape) => shape.type === 'snappad-task' || shape.type === 'snappad-note',
  )

  if (!bucketShapes.length || !contentShapes.length) return

  const buckets = bucketShapes.map((shape) => {
    const props = shape.props as { w: number; h: number; bucketId: string }
    return { id: props.bucketId, x: shape.x, y: shape.y, w: props.w, h: props.h }
  })

  const grouped = new Map<string, any[]>()
  const updates: any[] = []

  for (const shape of contentShapes) {
    const props = shape.props as { w: number; h: number; bucketId: string; order: number }
    const centerX = shape.x + props.w / 2
    const centerY = shape.y + props.h / 2
    const bucket = buckets.find(
      (entry) =>
        centerX >= entry.x &&
        centerX <= entry.x + entry.w &&
        centerY >= entry.y &&
        centerY <= entry.y + entry.h,
    )

    if (!bucket) {
      if (props.bucketId) {
        updates.push({
          id: shape.id,
          type: shape.type,
          props: { ...props, bucketId: '', order: -1 },
        })
      }
      continue
    }

    const items = grouped.get(bucket.id) ?? []
    items.push(shape)
    grouped.set(bucket.id, items)

    if (props.bucketId !== bucket.id) {
      updates.push({
        id: shape.id,
        type: shape.type,
        props: { ...props, bucketId: bucket.id },
      })
    }
  }

  for (const [bucketId, items] of grouped.entries()) {
    const bucket = buckets.find((entry) => entry.id === bucketId)
    if (!bucket) continue

    items
      .slice()
      .sort((a: any, b: any) => a.y - b.y)
      .forEach((shape: any, index: number) => {
        const props = shape.props as { w: number; h: number; bucketId: string; order: number }
        const nextX = bucket.x + 16
        const nextY = bucket.y + 56 + index * (props.h + 10)
        const nextW = bucket.w - 32

        if (shape.x !== nextX || shape.y !== nextY || props.w !== nextW || props.order !== index) {
          updates.push({
            id: shape.id,
            type: shape.type,
            x: nextX,
            y: nextY,
            props: {
              ...props,
              w: nextW,
              bucketId,
              order: index,
            },
          })
        }
      })
  }

  if (updates.length) {
    ;(editor as any).updateShapes(updates)
  }
}
