import type { CompletedRecord, NotebookPage } from './types'

export function archiveTaskRecord(args: {
  page: NotebookPage
  shape: Record<string, unknown>
  title: string
  subtasks: string
  originalBucketId: string
  completedAt: number | null
}): CompletedRecord {
  return {
    id: crypto.randomUUID(),
    title: args.title || 'Untitled task',
    subtasks: args.subtasks,
    archivedAt: Date.now(),
    completedAt: args.completedAt,
    originalPageId: args.page.id,
    originalPageTitle: args.page.title,
    originalBucketId: args.originalBucketId,
    shape: args.shape,
  }
}

export function restoreShapeForPage(
  shape: Record<string, unknown>,
  tldrawPageId: string,
  fallbackX = 180,
  fallbackY = 180,
): Record<string, unknown> & { id: string } {
  const props = (shape.props as Record<string, unknown> | undefined) ?? {}
  return {
    ...shape,
    id: String(shape.id),
    parentId: tldrawPageId,
    x: typeof shape.x === 'number' ? shape.x : fallbackX,
    y: typeof shape.y === 'number' ? shape.y : fallbackY,
    props: {
      ...props,
      status: 'active',
      bucketId: typeof props.bucketId === 'string' ? props.bucketId : '',
      order: typeof props.order === 'number' ? props.order : -1,
      completedAt: 0,
    },
  }
}
