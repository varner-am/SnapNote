import Dexie, { type Table } from 'dexie'
import type { CompletedRecord, NotebookPage } from './types'

class SnapPadDatabase extends Dexie {
  pages!: Table<NotebookPage, string>
  completed!: Table<CompletedRecord, string>

  constructor() {
    super('snappad-db-v2')
    this.version(1).stores({
      pages: 'id, updatedAt, type',
      completed: 'id, archivedAt, originalPageId',
    })
  }
}

export const db = new SnapPadDatabase()
