import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { format } from 'date-fns'
import clsx from 'clsx'
import {
  Box,
  DefaultColorStyle,
  DefaultFontStyle,
  DefaultSizeStyle,
  Tldraw,
  createShapeId,
  type Editor,
  type TLStoreSnapshot,
  type TLUiComponents,
} from 'tldraw'
import { db } from './lib/db'
import { queueShapeFocus, queueSubtaskFocus, registerShapeCallbacks } from './lib/shapeCallbacks'
import { archiveTaskRecord, restoreShapeForPage } from './lib/taskLifecycle'
import type { BackgroundPreset, CompletedRecord, NotebookPage, SnapPadView, TextScale } from './lib/types'
import { getWeekStartIso, seedWeeklyBuckets, snapTasksToBuckets } from './lib/weekly'
import { BucketShapeUtil } from './shapes/BucketShapeUtil'
import { NoteShapeUtil } from './shapes/NoteShapeUtil'
import { TaskShapeUtil } from './shapes/TaskShapeUtil'
import './App.css'

const shapeUtils = [BucketShapeUtil, NoteShapeUtil, TaskShapeUtil]
type ThemeMode = 'dark' | 'light'

const tldrawComponents: TLUiComponents = {
  Toolbar: null,
  HelpMenu: null,
  NavigationPanel: null,
  StylePanel: null,
}

const BACKGROUNDS: Array<{ id: BackgroundPreset; label: string }> = [
  { id: 'plain', label: 'Plain' },
  { id: 'grid', label: 'Grid' },
  { id: 'dots', label: 'Dots' },
  { id: 'ruled', label: 'Ruled' },
  { id: 'image', label: 'Image' },
]
const TEXT_SCALES: Array<{ id: TextScale; label: string }> = [
  { id: 'small', label: 'Small' },
  { id: 'medium', label: 'Medium' },
  { id: 'large', label: 'Large' },
  { id: 'xlarge', label: 'Extra large' },
]
const TOOLBAR_COLORS = [
  'black',
  'blue',
  'green',
  'orange',
  'red',
  'violet',
  'yellow',
] as const
const TOOLBAR_SIZES = [
  { id: 's', label: 'Small', icon: 'size-small' },
  { id: 'm', label: 'Medium', icon: 'size-medium' },
  { id: 'l', label: 'Large', icon: 'size-large' },
  { id: 'xl', label: 'Extra large', icon: 'size-extra-large' },
] as const
const WRITING_FONT = '"Aptos", "Segoe UI", sans-serif'
type ToolbarIconName = 'select' | 'hand' | 'draw' | 'erase' | 'arrow' | 'text' | 'note' | 'styles'

const TEXT_SCALE_METRICS: Record<
  TextScale,
  {
    noteFontSize: number
    noteLineHeight: number
    taskFontSize: number
    taskLineHeight: number
    subtaskFontSize: number
    subtaskLineHeight: number
  }
> = {
  small: {
    taskFontSize: 11,
    taskLineHeight: 1.2,
    noteFontSize: 11,
    noteLineHeight: 1.2,
    subtaskFontSize: 10,
    subtaskLineHeight: 1.15,
  },
  medium: {
    taskFontSize: 13,
    taskLineHeight: 1.22,
    noteFontSize: 13,
    noteLineHeight: 1.22,
    subtaskFontSize: 11,
    subtaskLineHeight: 1.18,
  },
  large: {
    taskFontSize: 17,
    taskLineHeight: 1.26,
    noteFontSize: 17,
    noteLineHeight: 1.26,
    subtaskFontSize: 14,
    subtaskLineHeight: 1.2,
  },
  xlarge: {
    taskFontSize: 21,
    taskLineHeight: 1.28,
    noteFontSize: 21,
    noteLineHeight: 1.28,
    subtaskFontSize: 17,
    subtaskLineHeight: 1.22,
  },
}

function createBlankPage(title = 'Untitled page'): NotebookPage {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    title,
    type: 'blank',
    createdAt: now,
    updatedAt: now,
    background: 'plain',
    fontFamily: WRITING_FONT,
    textScale: 'medium',
    snapshot: null,
  }
}

function createWeeklyPage(): NotebookPage {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    title: 'This week',
    type: 'weekly',
    createdAt: now,
    updatedAt: now,
    background: 'grid',
    fontFamily: WRITING_FONT,
    textScale: 'medium',
    weekStart: getWeekStartIso(),
    snapshot: null,
  }
}

function findTldrawPageId(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== 'object' || !('store' in snapshot)) return null
  const store = (snapshot as { store: Record<string, Record<string, unknown>> }).store
  return Object.values(store).find((record) => record.typeName === 'page')?.id?.toString() ?? null
}

function parseSerializedSubtasks(raw: string) {
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

function serializeSubtasks(items: Array<{ checked: boolean; text: string }>) {
  if (items.length === 0) return ''

  return items
    .filter((item, index) => item.text.trim().length > 0 || index === items.length - 1)
    .map((item) => `${item.checked ? '[x]' : '[ ]'} ${item.text}`)
    .join('\n')
}

function countWrappedLines(text: string, availableWidth: number, fontSize: number) {
  const value = text.trim()
  if (!value) return 1

  const averageCharacterWidth = fontSize * 0.56
  const charsPerLine = Math.max(10, Math.floor(availableWidth / averageCharacterWidth))

  return value.split('\n').reduce((total, rawLine) => {
    const line = rawLine || ' '
    return total + Math.max(1, Math.ceil(line.length / charsPerLine))
  }, 0)
}

function getTaskHeight(title: string, subtasksRaw: string, width: number, textScale: TextScale = 'medium') {
  const metrics = TEXT_SCALE_METRICS[textScale]
  const contentWidth = Math.max(140, width - 74)
  const titleLines = countWrappedLines(title, contentWidth, metrics.taskFontSize)
  const subtasks = parseSerializedSubtasks(subtasksRaw)
  const subtaskLines = subtasks.reduce(
    (total, item) => total + countWrappedLines(item.text, contentWidth - 8, metrics.subtaskFontSize),
    0,
  )
  const hasSubtasks = subtasks.length > 0

  const titleHeight = titleLines * Math.ceil(metrics.taskFontSize * metrics.taskLineHeight)
  const subtaskHeight = subtaskLines * Math.ceil(metrics.subtaskFontSize * metrics.subtaskLineHeight)
  const subtaskSectionHeight = hasSubtasks ? subtasks.length * 4 + subtaskHeight + 26 : 0

  return Math.max(106, 52 + titleHeight + subtaskSectionHeight)
}

function applyTextScaleToSnapshot(snapshot: unknown, textScale: TextScale): unknown {
  if (!snapshot || typeof snapshot !== 'object' || !('store' in snapshot)) return snapshot

  const store = (snapshot as TLStoreSnapshot).store as Record<string, unknown>
  const nextStore: Record<string, unknown> = { ...store }

  for (const [id, record] of Object.entries(store)) {
    const shape = record as { typeName?: string; type?: string; props?: Record<string, unknown> }
    if (shape.typeName !== 'shape' || shape.type !== 'snappad-task' || !shape.props) continue

    nextStore[id] = {
      ...shape,
      props: {
        ...shape.props,
        h: getTaskHeight(
          String(shape.props.title ?? ''),
          String(shape.props.subtasks ?? ''),
          Number(shape.props.w ?? 280),
          textScale,
        ),
      },
    } as never
  }

  return {
    ...(snapshot as TLStoreSnapshot),
    store: nextStore,
  }
}

function normalizeWeeklySnapshot(snapshot: unknown): TLStoreSnapshot | null {
  if (!snapshot || typeof snapshot !== 'object' || !('store' in snapshot)) return null

  const typedSnapshot = snapshot as TLStoreSnapshot
  const nextStore = Object.fromEntries(
    Object.entries(typedSnapshot.store as Record<string, unknown>).filter(([, record]) => {
      const shape = record as { typeName?: string; type?: string }
      return !(shape.typeName === 'shape' && shape.type === 'snappad-bucket')
    }),
  ) as TLStoreSnapshot['store']

  return {
    ...typedSnapshot,
    store: nextStore,
  }
}

function ToolbarIcon({ name }: { name: ToolbarIconName }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }

  switch (name) {
    case 'select':
      return (
        <svg {...common}>
          <path d="M5 3.5 18 12l-5.5 1.2L14.8 20 12 21l-2.4-6.6L5 16z" />
        </svg>
      )
    case 'hand':
      return (
        <svg {...common}>
          <path d="M8 11V5.8a1.3 1.3 0 1 1 2.6 0V10" />
          <path d="M10.6 10V4.8a1.3 1.3 0 1 1 2.6 0V10" />
          <path d="M13.2 10V6a1.3 1.3 0 1 1 2.6 0v6.2c0 3.6-2.3 6.5-5.9 6.5-2.4 0-4.2-1.3-5.2-3.3L3 12.2A1.5 1.5 0 0 1 5.6 11l1 1.7V11a1.3 1.3 0 1 1 2.6 0Z" />
        </svg>
      )
    case 'draw':
      return (
        <svg {...common}>
          <path d="M4 18c3.5-4.3 6.5-6.4 9-6.4 2.2 0 3.7 1.4 7 1.4" />
          <path d="m14.5 5.5 4 4" />
          <path d="m12.5 7.5 4 4" />
        </svg>
      )
    case 'erase':
      return (
        <svg {...common}>
          <path d="m8 7.5 5-4.5 7 7-7.5 7.5H6L3.5 15z" />
          <path d="M10.5 17.5 18 10" />
        </svg>
      )
    case 'arrow':
      return (
        <svg {...common}>
          <path d="M5 18 18 5" />
          <path d="M12 5h6v6" />
        </svg>
      )
    case 'text':
      return (
        <svg {...common}>
          <path d="M5 6h14" />
          <path d="M12 6v12" />
          <path d="M8 18h8" />
        </svg>
      )
    case 'note':
      return (
        <svg {...common}>
          <path d="M6 4.5h12a1.5 1.5 0 0 1 1.5 1.5v12l-4-3.2H6A1.5 1.5 0 0 1 4.5 13.3V6A1.5 1.5 0 0 1 6 4.5Z" />
        </svg>
      )
    case 'styles':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="2.5" />
          <circle cx="16" cy="8" r="2.5" />
          <circle cx="12" cy="15.5" r="2.5" />
        </svg>
      )
  }
}

export default function App() {
  const [pages, setPages] = useState<NotebookPage[]>([])
  const [completed, setCompleted] = useState<CompletedRecord[]>([])
  const [activePageId, setActivePageId] = useState<string | null>(null)
  const [view, setView] = useState<SnapPadView>('page')
  const [isReady, setIsReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const stored = window.localStorage.getItem('snappad-theme')
    return stored === 'light' ? 'light' : 'dark'
  })
  const pagesRef = useRef<NotebookPage[]>([])

  async function createStarterWorkspace() {
    const starterPages = [createWeeklyPage(), createBlankPage('Scratch space')]
    await db.pages.bulkPut(starterPages)
    setPages(starterPages)
    setActivePageId(starterPages[0].id)
  }

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    window.localStorage.setItem('snappad-theme', theme)
  }, [theme])

  useEffect(() => {
    void (async () => {
      try {
        const storedPages = await db.pages.orderBy('createdAt').toArray()
        const storedCompleted = await db.completed.orderBy('archivedAt').reverse().toArray()

        if (storedPages.length === 0) {
          await createStarterWorkspace()
        } else {
          setPages(storedPages)
          setActivePageId(storedPages[0].id)
        }

        setCompleted(storedCompleted)
      } catch (error) {
        console.error('SnapPad failed to initialize IndexedDB, falling back to a fresh workspace.', error)
        setLoadError('Storage had trouble loading, so SnapPad created a fresh local workspace.')
        setCompleted([])
        await createStarterWorkspace()
      }
      setIsReady(true)
    })()
  }, [])

  const activePage = useMemo(
    () => pages.find((page) => page.id === activePageId) ?? pages[0] ?? null,
    [activePageId, pages],
  )

  useEffect(() => {
    pagesRef.current = pages
  }, [pages])

  useEffect(() => {
    document.documentElement.style.setProperty('--page-font', WRITING_FONT)
  }, [])

  async function handleOpenPage(pageId: string) {
    const freshPage = await db.pages.get(pageId)
    if (freshPage) {
      setPages((current) => current.map((entry) => (entry.id === pageId ? freshPage : entry)))
    }
    setActivePageId(pageId)
    setView('page')
  }

  async function persistPage(page: NotebookPage) {
    await db.pages.put(page)
    setPages((current) => current.map((entry) => (entry.id === page.id ? page : entry)))
  }

  async function handleCreatePage(type: 'blank' | 'weekly') {
    const page = type === 'weekly' ? createWeeklyPage() : createBlankPage()
    await db.pages.put(page)
    setPages((current) => [...current, page])
    setActivePageId(page.id)
    setView('page')
  }

  async function handleRenamePage(pageId: string, title: string) {
    const page = pagesRef.current.find((entry) => entry.id === pageId)
    if (!page) return
    await persistPage({ ...page, title, updatedAt: Date.now() })
  }

  async function handleBackgroundChange(pageId: string, background: BackgroundPreset, backgroundImage?: string) {
    const page = pagesRef.current.find((entry) => entry.id === pageId)
    if (!page) return
    await persistPage({ ...page, background, backgroundImage, updatedAt: Date.now() })
  }

  async function handleTextScaleChange(pageId: string, textScale: TextScale) {
    const page = pagesRef.current.find((entry) => entry.id === pageId)
    if (!page) return

    await persistPage({
      ...page,
      textScale,
      snapshot: applyTextScaleToSnapshot(page.snapshot, textScale),
      updatedAt: Date.now(),
    })
  }

  async function handleWeekShift(pageId: string, direction: -1 | 1) {
    const page = pagesRef.current.find((entry) => entry.id === pageId)
    if (!page || page.type !== 'weekly') return
    const nextWeek = new Date(page.weekStart ?? getWeekStartIso())
    nextWeek.setDate(nextWeek.getDate() + direction * 7)
    await persistPage({
      ...page,
      weekStart: format(nextWeek, 'yyyy-MM-dd'),
      snapshot: null,
      updatedAt: Date.now(),
    })
  }

  async function handleSnapshotSave(pageId: string, snapshot: unknown) {
    const pageIndex = pagesRef.current.findIndex((entry) => entry.id === pageId)
    const page = pageIndex >= 0 ? pagesRef.current[pageIndex] : null
    if (!page) return
    const nextPage = { ...page, snapshot, updatedAt: Date.now() }
    pagesRef.current = pagesRef.current.map((entry) => (entry.id === pageId ? nextPage : entry))
    await db.pages.put(nextPage)
  }

  async function handleArchiveRecord(record: CompletedRecord) {
    await db.completed.put(record)
    setCompleted((current) => [record, ...current])
  }

  async function handleRestore(record: CompletedRecord) {
    const targetPage =
      pages.find((page) => page.id === record.originalPageId) ??
      pages.find((page) => page.id === activePageId) ??
      pages[0]

    if (!targetPage) return

    const snapshot = targetPage.snapshot as TLStoreSnapshot | null
    const tldrawPageId = findTldrawPageId(snapshot)

    if (!snapshot || !tldrawPageId) {
      setActivePageId(targetPage.id)
      setView('page')
      return
    }

    const restored = restoreShapeForPage(record.shape, tldrawPageId)
    const nextSnapshot: TLStoreSnapshot = {
      ...snapshot,
      store: {
        ...snapshot.store,
        [restored.id]: restored as never,
      },
    }

    await persistPage({ ...targetPage, snapshot: nextSnapshot, updatedAt: Date.now() })
    await db.completed.delete(record.id)
    setCompleted((current) => current.filter((entry) => entry.id !== record.id))
    setActivePageId(targetPage.id)
    setView('page')
  }

  if (!isReady || !activePage) {
    return <div className="snappad-loading">Loading SnapPad...</div>
  }

  return (
    <div className="snappad-shell">
      <aside className="snappad-sidebar">
        <div className="snappad-sidebar__hero">
          <div className="snappad-brand-lockup">
            <div className="snappad-brand-mark">
              <img src="/sparkpad-icon.png" alt="SparkPad icon" />
            </div>
            <div className="snappad-brand">SparkPad</div>
          </div>
          <p className="snappad-brand__copy">
            Open-canvas thinking for the week ahead, with just enough structure to keep ideas moving.
          </p>
          <button
            type="button"
            className="snappad-theme-toggle"
            onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
          >
            {theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
          </button>
        </div>

        <div className="snappad-sidebar__actions">
          <button type="button" onClick={() => void handleCreatePage('blank')}>
            New blank page
          </button>
          <button type="button" onClick={() => void handleCreatePage('weekly')}>
            New weekly page
          </button>
        </div>

        <div className="snappad-sidebar__section">
          <div className="snappad-sidebar__label">Pages</div>
          {pages.map((page) => (
            <button
              key={page.id}
              type="button"
              className={clsx('snappad-page-link', view === 'page' && activePageId === page.id && 'is-active')}
              onClick={() => {
                void handleOpenPage(page.id)
              }}
            >
              <span>{page.title}</span>
              <small>{page.type === 'weekly' ? 'Weekly' : 'Freeform'}</small>
            </button>
          ))}

          <button
            type="button"
            className={clsx('snappad-page-link', view === 'completed' && 'is-active')}
            onClick={() => setView('completed')}
          >
            <span>Completed</span>
            <small>{completed.length} archived</small>
          </button>
        </div>
      </aside>

      <main className="snappad-main">
        {loadError ? <div className="snappad-banner">{loadError}</div> : null}
        {view === 'completed' ? (
          <CompletedPageView completed={completed} onRestore={handleRestore} />
        ) : (
          <CanvasPageView
            key={activePage.id}
            page={activePage}
            onPageRename={handleRenamePage}
            onBackgroundChange={handleBackgroundChange}
            onTextScaleChange={handleTextScaleChange}
            onWeekShift={handleWeekShift}
            onSnapshotSave={handleSnapshotSave}
            onArchiveRecord={handleArchiveRecord}
          />
        )}
      </main>
    </div>
  )
}

interface CanvasPageViewProps {
  page: NotebookPage
  onPageRename: (pageId: string, title: string) => Promise<void>
  onBackgroundChange: (pageId: string, background: BackgroundPreset, backgroundImage?: string) => Promise<void>
  onTextScaleChange: (pageId: string, textScale: TextScale) => Promise<void>
  onWeekShift: (pageId: string, direction: -1 | 1) => Promise<void>
  onSnapshotSave: (pageId: string, snapshot: unknown) => Promise<void>
  onArchiveRecord: (record: CompletedRecord) => Promise<void>
}

function CanvasPageView({
  page,
  onPageRename,
  onBackgroundChange,
  onTextScaleChange,
  onWeekShift,
  onSnapshotSave,
  onArchiveRecord,
}: CanvasPageViewProps) {
  const editorRef = useRef<Editor | null>(null)
  const saveTimer = useRef<number | null>(null)
  const pointerUpCleanupRef = useRef<(() => void) | null>(null)
  const layoutRefreshTimersRef = useRef<number[]>([])
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null)
  const [activeTool, setActiveTool] = useState('select')
  const [stylesOpen, setStylesOpen] = useState(false)
  const [activeColor, setActiveColor] = useState<(typeof TOOLBAR_COLORS)[number]>('black')
  const [activeSize, setActiveSize] = useState<(typeof TOOLBAR_SIZES)[number]['id']>('m')
  const textMetrics = TEXT_SCALE_METRICS[page.textScale ?? 'medium']

  function refreshEditorLayout(editor: Editor) {
    const container = editor.getContainer()
    const bounds = container.getBoundingClientRect()
    editor.updateViewportScreenBounds(new Box(bounds.left, bounds.top, bounds.width, bounds.height))
    window.dispatchEvent(new Event('resize'))
  }

  function createShape(kind: 'note' | 'task', point?: { x: number; y: number }) {
    const editor = editorRef.current as any
    if (!editor) return

    const bounds = editor.getViewportPageBounds?.() ?? { x: 200, y: 200, w: 800, h: 600 }
    const x = point?.x ?? bounds.x + bounds.w / 2 - (kind === 'note' ? 130 : 140)
    const y = point?.y ?? bounds.y + bounds.h / 2 - 80
    const shapeId = createShapeId()

    if (kind === 'note') {
      queueShapeFocus(shapeId)
      editor.createShapes([
        {
          id: shapeId,
          type: 'snappad-note',
          x,
          y,
          props: { w: 260, h: 180, text: '', color: '#fff6c4', bucketId: '', order: -1 },
        },
      ])
      return
    }

    queueShapeFocus(shapeId)
    editor.createShapes([
      {
        id: shapeId,
        type: 'snappad-task',
        x,
        y,
        props: {
          w: 280,
          h: 106,
          title: '',
          subtasks: '',
          status: 'active',
          bucketId: '',
          order: -1,
          completedAt: 0,
        },
      },
    ])
  }

  function setTool(tool: string) {
    const editor = editorRef.current
    if (!editor) return
    editor.complete()
    editor.cancel()
    editor.setCurrentTool(tool)
    editor.focus({ focusContainer: false })
    setStylesOpen(false)
    window.requestAnimationFrame(() => {
      setActiveTool(editor.getCurrentToolId())
    })
  }

  function applyToolbarColor(color: (typeof TOOLBAR_COLORS)[number]) {
    const editor = editorRef.current
    if (!editor) return
    editor.setStyleForSelectedShapes(DefaultColorStyle as never, color as never)
    editor.setStyleForNextShapes(DefaultColorStyle as never, color as never)
    setActiveColor(color)
  }

  function applyToolbarSize(size: (typeof TOOLBAR_SIZES)[number]['id']) {
    const editor = editorRef.current
    if (!editor) return
    editor.setStyleForSelectedShapes(DefaultSizeStyle as never, size as never)
    editor.setStyleForNextShapes(DefaultSizeStyle as never, size as never)
    setActiveSize(size)
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key !== '1') return
      event.preventDefault()
      createShape('task', lastPointerRef.current ?? undefined)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  useEffect(() => {
    const handleTaskEnter = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return

      const active = document.activeElement as HTMLElement | null
      const shapeId = active?.dataset.taskShapeId
      const role = active?.dataset.taskInputRole
      if (!shapeId || !role) return

      const editor = editorRef.current as any
      if (!editor) return

      const shape = editor.getShape(shapeId)
      if (!shape || shape.type !== 'snappad-task') return

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()

      const subtasks = parseSerializedSubtasks(shape.props.subtasks)

      if (role === 'title') {
        const nextItems = [...subtasks, { checked: false, text: '' }]
        const nextSubtasks = serializeSubtasks(nextItems)
        queueSubtaskFocus(shapeId, nextItems.length - 1)
        editor.updateShape({
          id: shapeId,
          type: shape.type,
          props: {
            ...shape.props,
            subtasks: nextSubtasks,
            h: getTaskHeight(shape.props.title, nextSubtasks, shape.props.w, page.textScale ?? 'medium'),
          },
        })
        return
      }

      if (role === 'subtask') {
        const index = Number(active?.dataset.subtaskIndex ?? -1)
        if (index < 0) return
        const nextItems = [
          ...subtasks.slice(0, index + 1),
          { checked: false, text: '' },
          ...subtasks.slice(index + 1),
        ]
        const nextSubtasks = serializeSubtasks(nextItems)
        queueSubtaskFocus(shapeId, index + 1)
        editor.updateShape({
          id: shapeId,
          type: shape.type,
          props: {
            ...shape.props,
            subtasks: nextSubtasks,
            h: getTaskHeight(shape.props.title, nextSubtasks, shape.props.w, page.textScale ?? 'medium'),
          },
        })
      }
    }

    document.addEventListener('keydown', handleTaskEnter, true)
    return () => {
      document.removeEventListener('keydown', handleTaskEnter, true)
    }
  }, [])

  useEffect(() => {
    registerShapeCallbacks({
      updateNote: (editor, shapeId, text) => {
        const shape = (editor as any).getShape(shapeId) as any
        if (!shape || shape.type !== 'snappad-note') return
        ;(editor as any).updateShape({ id: shapeId, type: shape.type, props: { ...shape.props, text } })
      },
      updateTask: (editor, shapeId, updates) => {
        const shape = (editor as any).getShape(shapeId) as any
        if (!shape || shape.type !== 'snappad-task') return
        const nextTitle = updates.title ?? shape.props.title
        const subtasks = updates.subtasks ?? shape.props.subtasks
        ;(editor as any).updateShape({
          id: shapeId,
          type: shape.type,
          props: {
            ...shape.props,
            ...updates,
            h: getTaskHeight(nextTitle, subtasks, shape.props.w, page.textScale ?? 'medium'),
          },
        })
      },
      toggleTask: (editor, shapeId) => {
        const shape = (editor as any).getShape(shapeId) as any
        if (!shape || shape.type !== 'snappad-task') return

        if (shape.props.status === 'active') {
          ;(editor as any).updateShape({
            id: shapeId,
            type: shape.type,
            props: { ...shape.props, status: 'completed', completedAt: Date.now() },
          })
          return
        }

        if (shape.props.status === 'archiving') return
        ;(editor as any).updateShape({
          id: shapeId,
          type: shape.type,
          props: { ...shape.props, status: 'archiving' },
        })

        window.setTimeout(() => {
          const fresh = (editor as any).getShape(shapeId) as any
          if (!fresh || fresh.type !== 'snappad-task') return
          void onArchiveRecord(
            archiveTaskRecord({
              page,
              shape: fresh as unknown as Record<string, unknown>,
              title: fresh.props.title,
              subtasks: fresh.props.subtasks,
              originalBucketId: fresh.props.bucketId,
              completedAt: fresh.props.completedAt || null,
            }),
          )
          ;(editor as any).deleteShapes([shapeId])
        }, 220)
      },
    })
  }, [onArchiveRecord, page])

  function scheduleSave(editor: Editor) {
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      void onSnapshotSave(page.id, editor.store.getStoreSnapshot())
    }, 250)
  }

  useEffect(
    () => () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
      layoutRefreshTimersRef.current.forEach((timer) => window.clearTimeout(timer))
      layoutRefreshTimersRef.current = []
      pointerUpCleanupRef.current?.()
    },
    [],
  )

  useEffect(() => {
    const editor = editorRef.current as any
    if (!editor) return

    const snapshot = editor.store.getStoreSnapshot() as TLStoreSnapshot
    const nextShapes = Object.values(snapshot.store)
      .filter((record: any) => record.typeName === 'shape' && record.type === 'snappad-task')
      .map((shape: any) => ({
        id: shape.id,
        type: shape.type,
        props: {
          ...shape.props,
          h: getTaskHeight(shape.props.title, shape.props.subtasks, shape.props.w, page.textScale ?? 'medium'),
        },
      }))

    if (nextShapes.length === 0) return
    editor.updateShapes(nextShapes)
  }, [page.textScale])

  const backgroundStyle =
    page.background === 'image' && page.backgroundImage
      ? ({ backgroundImage: `url(${page.backgroundImage})` } as CSSProperties)
      : ({} as CSSProperties)

  const canvasStyle: CSSProperties = {
    ...backgroundStyle,
    ['--note-font-size' as string]: `${textMetrics.noteFontSize}px`,
    ['--note-line-height' as string]: String(textMetrics.noteLineHeight),
    ['--task-font-size' as string]: `${textMetrics.taskFontSize}px`,
    ['--task-line-height' as string]: String(textMetrics.taskLineHeight),
    ['--subtask-font-size' as string]: `${textMetrics.subtaskFontSize}px`,
    ['--subtask-line-height' as string]: String(textMetrics.subtaskLineHeight),
  }

  async function handleBackgroundUpload(file: File | null) {
    if (!file) return

    const imageDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result ?? ''))
      reader.onerror = () => reject(reader.error ?? new Error('Unable to read file'))
      reader.readAsDataURL(file)
    })

    await onBackgroundChange(page.id, 'image', imageDataUrl)
  }

  function releaseSelectedShapesFromBuckets() {
    const editor = editorRef.current as any
    if (!editor) return

    const selectedShapes = (editor.getSelectedShapes?.() ?? []) as Array<{
      id: string
      type: string
      props: Record<string, unknown>
    }>

    const updates = selectedShapes
      .filter((shape) => (shape.type === 'snappad-task' || shape.type === 'snappad-note') && shape.props.bucketId)
      .map((shape) => ({
        id: shape.id,
        type: shape.type,
        props: {
          ...shape.props,
          bucketId: '',
          order: -1,
        },
      }))

    if (updates.length) {
      editor.updateShapes(updates)
    }
  }

  return (
    <section className="snappad-page">
      <header className="snappad-page__header">
        <div>
          <input
            className="snappad-page__title"
            value={page.title}
            onChange={(event) => void onPageRename(page.id, event.target.value)}
          />
          <p className="snappad-page__meta">
            {page.type === 'weekly'
              ? `Week of ${format(new Date(page.weekStart ?? getWeekStartIso()), 'MMMM d, yyyy')}`
              : 'Freeform open canvas'}
          </p>
        </div>

        <div className="snappad-page__controls">
          <div className="snappad-page__quick-actions">
            <button type="button" onClick={() => createShape('task')}>
              Add task
            </button>
          </div>

          {page.type === 'weekly' && (
            <div className="snappad-page__week-controls">
              <button type="button" onClick={() => void onWeekShift(page.id, -1)}>
                Previous week
              </button>
              <button type="button" onClick={() => void onWeekShift(page.id, 1)}>
                Next week
              </button>
            </div>
          )}

          <label className="snappad-field">
            <span>Background</span>
            <select
              value={page.background}
              onChange={(event) =>
                void onBackgroundChange(page.id, event.target.value as BackgroundPreset, page.backgroundImage)
              }
            >
              {BACKGROUNDS.map((background) => (
                <option key={background.id} value={background.id}>
                  {background.label}
                </option>
              ))}
            </select>
          </label>

          <label className="snappad-field">
            <span>Text size</span>
            <select
              value={page.textScale ?? 'medium'}
              onChange={(event) => void onTextScaleChange(page.id, event.target.value as TextScale)}
            >
              {TEXT_SCALES.map((scale) => (
                <option key={scale.id} value={scale.id}>
                  {scale.label}
                </option>
              ))}
            </select>
          </label>

          {page.background === 'image' && (
            <>
              <label className="snappad-field">
                <span>Upload image</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => {
                    void handleBackgroundUpload(event.target.files?.[0] ?? null)
                    event.currentTarget.value = ''
                  }}
                />
              </label>

              {page.backgroundImage ? (
                <button type="button" onClick={() => void onBackgroundChange(page.id, 'plain', undefined)}>
                  Remove image
                </button>
              ) : null}
            </>
          )}
        </div>
      </header>

      <div
        className={clsx('snappad-canvas-wrap', `is-${page.background}`)}
        style={canvasStyle}
        onPointerMove={(event) => {
          const editor = editorRef.current as any
          if (!editor) return
          lastPointerRef.current = editor.screenToPage({
            x: event.clientX,
            y: event.clientY,
          })
        }}
        onClick={(event) => {
          const editor = editorRef.current as any
          if (!editor) return

          const currentTool = editor.getCurrentToolId?.()
          if (currentTool && currentTool !== 'select') return

          const target = event.target as HTMLElement
          if (target.closest('button, input, textarea, select')) return
          if (target.closest('.snappad-note, .snappad-task, .tl-selection')) return

          const point = editor.screenToPage({
            x: event.clientX,
            y: event.clientY,
          })
          lastPointerRef.current = point
          createShape('note', point)
        }}
      >
        <Tldraw
          shapeUtils={shapeUtils}
          components={tldrawComponents}
          inferDarkMode
          onMount={(editor) => {
            editorRef.current = editor
            editor.setStyleForNextShapes(DefaultFontStyle, 'sans')
            editor.setStyleForNextShapes(DefaultSizeStyle, 's')
            editor.setStyleForNextShapes(DefaultColorStyle as never, activeColor as never)
            setActiveTool(editor.getCurrentToolId())
            pointerUpCleanupRef.current?.()

            if (page.snapshot) {
              if (page.type === 'weekly') {
                const normalizedSnapshot = normalizeWeeklySnapshot(page.snapshot)
                if (normalizedSnapshot) {
                  editor.loadSnapshot(normalizedSnapshot)
                }
                seedWeeklyBuckets(editor, page.weekStart ?? getWeekStartIso())
                scheduleSave(editor)
              } else {
                editor.loadSnapshot(page.snapshot as TLStoreSnapshot)
              }
            } else if (page.type === 'weekly') {
              seedWeeklyBuckets(editor, page.weekStart ?? getWeekStartIso())
              scheduleSave(editor)
            } else {
              editor.zoomToFit({ animation: { duration: 0 } })
            }

            editor.store.listen(() => scheduleSave(editor), { source: 'user', scope: 'document' })

            const handlePointerUp = (event: PointerEvent) => {
              if (!editorRef.current) return
              if (event.ctrlKey) {
                releaseSelectedShapesFromBuckets()
              } else {
                snapTasksToBuckets(editorRef.current)
              }
              scheduleSave(editorRef.current)
            }

            window.addEventListener('pointerup', handlePointerUp)
            pointerUpCleanupRef.current = () => {
              window.removeEventListener('pointerup', handlePointerUp)
            }

            layoutRefreshTimersRef.current.forEach((timer) => window.clearTimeout(timer))
            layoutRefreshTimersRef.current = [0, 80, 220].map((delay) =>
              window.setTimeout(() => {
                refreshEditorLayout(editor)
              }, delay),
            )
          }}
        />

        <div className="snappad-canvas-toolbar">
          <div className="snappad-canvas-toolbar__group snappad-canvas-toolbar__group--tools">
            <button
              type="button"
              className={clsx('snappad-toolbar-button', activeTool === 'select' && 'is-active')}
              onClick={() => setTool('select')}
              aria-label="Move"
            >
              <ToolbarIcon name="select" />
            </button>
            <button
              type="button"
              className={clsx('snappad-toolbar-button', activeTool === 'hand' && 'is-active')}
              onClick={() => setTool('hand')}
              aria-label="Pan"
            >
              <ToolbarIcon name="hand" />
            </button>
            <button
              type="button"
              className={clsx('snappad-toolbar-button', activeTool === 'draw' && 'is-active')}
              onClick={() => setTool('draw')}
              aria-label="Draw"
            >
              <ToolbarIcon name="draw" />
            </button>
            <button
              type="button"
              className={clsx('snappad-toolbar-button', activeTool === 'eraser' && 'is-active')}
              onClick={() => setTool('eraser')}
              aria-label="Erase"
            >
              <ToolbarIcon name="erase" />
            </button>
            <button
              type="button"
              className={clsx('snappad-toolbar-button', activeTool === 'arrow' && 'is-active')}
              onClick={() => setTool('arrow')}
              aria-label="Arrow"
            >
              <ToolbarIcon name="arrow" />
            </button>
            <button
              type="button"
              className={clsx('snappad-toolbar-button', activeTool === 'text' && 'is-active')}
              onClick={() => setTool('text')}
              aria-label="Text"
            >
              <ToolbarIcon name="text" />
            </button>
            <button
              type="button"
              className={clsx('snappad-toolbar-button', activeTool === 'note' && 'is-active')}
              onClick={() => setTool('note')}
              aria-label="Sticky note"
            >
              <ToolbarIcon name="note" />
            </button>
          </div>

          <div className="snappad-canvas-toolbar__group snappad-canvas-toolbar__group--styles">
            <div className="snappad-toolbar-styles">
              <button
                type="button"
                className={clsx('snappad-toolbar-button', stylesOpen && 'is-active')}
                onClick={() => setStylesOpen((open) => !open)}
                aria-label="Styles"
              >
                <ToolbarIcon name="styles" />
              </button>

              {stylesOpen ? (
                <div className="snappad-toolbar-popover">
                  <div className="snappad-toolbar-popover__section">
                    <span className="snappad-toolbar-popover__label">Color</span>
                    <div className="snappad-toolbar-swatch-row">
                      {TOOLBAR_COLORS.map((color) => (
                        <button
                          key={color}
                          type="button"
                          className={clsx(
                            'snappad-toolbar-swatch',
                            `is-${color}`,
                            activeColor === color && 'is-active',
                          )}
                          onClick={() => applyToolbarColor(color)}
                          aria-label={`Set color ${color}`}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="snappad-toolbar-popover__section">
                    <span className="snappad-toolbar-popover__label">Size</span>
                    <div className="snappad-toolbar-size-row">
                      {TOOLBAR_SIZES.map((size) => (
                        <button
                          key={size.id}
                          type="button"
                          className={clsx('snappad-toolbar-button', activeSize === size.id && 'is-active')}
                          onClick={() => applyToolbarSize(size.id)}
                          aria-label={size.label}
                        >
                          <span className="snappad-toolbar-size-label">{size.id.toUpperCase()}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function CompletedPageView({
  completed,
  onRestore,
}: {
  completed: CompletedRecord[]
  onRestore: (record: CompletedRecord) => Promise<void>
}) {
  return (
    <section className="snappad-completed">
      <header className="snappad-completed__header">
        <div>
          <h1>Completed</h1>
          <p>Finished ideas live here until you want to bring them back.</p>
        </div>
      </header>

      <div className="snappad-completed__list">
        {completed.length === 0 ? (
          <div className="snappad-empty">Nothing archived yet.</div>
        ) : (
          completed.map((record) => (
            <article key={record.id} className="snappad-completed-card">
              <div>
                <h2>{record.title}</h2>
                <p>{`From ${record.originalPageTitle} - ${format(
                  new Date(record.completedAt ?? record.archivedAt),
                  'MMM d, yyyy h:mm a',
                )}`}</p>
                {record.subtasks && <pre className="snappad-completed-card__subtasks">{record.subtasks}</pre>}
              </div>
              <button type="button" onClick={() => void onRestore(record)}>
                Restore
              </button>
            </article>
          ))
        )}
      </div>
    </section>
  )
}
