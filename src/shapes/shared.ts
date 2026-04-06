import type { RecordProps, TLBaseShape } from 'tldraw'
import { T } from 'tldraw'

export type SnapPadNoteShape = TLBaseShape<
  'snappad-note',
  {
    w: number
    h: number
    text: string
    color: string
    bucketId: string
    order: number
  }
>

export const noteShapeProps: RecordProps<SnapPadNoteShape> = {
  w: T.number,
  h: T.number,
  text: T.string,
  color: T.string,
  bucketId: T.string,
  order: T.number,
}

export type SnapPadTaskShape = TLBaseShape<
  'snappad-task',
  {
    w: number
    h: number
    title: string
    subtasks: string
    status: 'active' | 'completed' | 'archiving'
    bucketId: string
    order: number
    completedAt: number
  }
>

export const taskShapeProps: RecordProps<SnapPadTaskShape> = {
  w: T.number,
  h: T.number,
  title: T.string,
  subtasks: T.string,
  status: T.literalEnum('active', 'completed', 'archiving'),
  bucketId: T.string,
  order: T.number,
  completedAt: T.number,
}

export type SnapPadBucketShape = TLBaseShape<
  'snappad-bucket',
  {
    w: number
    h: number
    title: string
    dateLabel: string
    bucketId: string
    accent: string
  }
>

export const bucketShapeProps: RecordProps<SnapPadBucketShape> = {
  w: T.number,
  h: T.number,
  title: T.string,
  dateLabel: T.string,
  bucketId: T.string,
  accent: T.string,
}
