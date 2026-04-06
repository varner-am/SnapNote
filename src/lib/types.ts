export type PageType = 'blank' | 'weekly'

export type BackgroundPreset = 'plain' | 'grid' | 'dots' | 'ruled' | 'image'
export type TextScale = 'small' | 'medium' | 'large' | 'xlarge'

export interface NotebookPage {
  id: string
  title: string
  type: PageType
  createdAt: number
  updatedAt: number
  background: BackgroundPreset
  fontFamily?: string
  textScale?: TextScale
  backgroundImage?: string
  weekStart?: string
  snapshot: unknown | null
}

export interface CompletedRecord {
  id: string
  title: string
  subtasks: string
  archivedAt: number
  completedAt: number | null
  originalPageId: string
  originalPageTitle: string
  originalBucketId: string
  shape: Record<string, unknown>
}

export type SnapPadView = 'page' | 'completed'
