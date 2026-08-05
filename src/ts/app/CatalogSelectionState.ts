import type { Snapshot, SnapshotCatalog } from '../types';

export interface CatalogUpdate {
  changed: boolean;
  targetIndex: number | null;
}

export interface SnapshotSelection {
  index: number;
  snapshot: Snapshot;
  adjacent: Snapshot[];
}

function sameCatalog(current: SnapshotCatalog | null, next: SnapshotCatalog): boolean {
  return current !== null
    && current.updatedAt === next.updatedAt
    && current.snapshots.length === next.snapshots.length;
}

export class CatalogSelectionState {
  private currentCatalog: SnapshotCatalog | null = null;
  private currentSnapshotId: string | null = null;
  private catalogStale = false;

  get catalog(): SnapshotCatalog | null {
    return this.currentCatalog;
  }

  get selectedSnapshotId(): string | null {
    return this.currentSnapshotId;
  }

  get stale(): boolean {
    return this.catalogStale;
  }

  update(next: SnapshotCatalog, stale: boolean, followLatest: boolean): CatalogUpdate {
    const previousSelection = this.currentSnapshotId;
    const changed = !sameCatalog(this.currentCatalog, next);
    this.currentCatalog = next;
    this.catalogStale = stale;
    if (!changed) return { changed: false, targetIndex: null };
    return {
      changed: true,
      targetIndex: this.targetIndex(previousSelection, followLatest)
    };
  }

  select(index: number): SnapshotSelection | null {
    const snapshots = this.currentCatalog?.snapshots;
    if (!snapshots || snapshots.length === 0) return null;
    const boundedIndex = Math.max(0, Math.min(index, snapshots.length - 1));
    const snapshot = snapshots[boundedIndex];
    if (!snapshot) return null;
    this.currentSnapshotId = snapshot.id;
    return {
      index: boundedIndex,
      snapshot,
      adjacent: [snapshots[boundedIndex - 1], snapshots[boundedIndex + 1]]
        .filter((candidate): candidate is Snapshot => candidate !== undefined)
    };
  }

  nextPlaybackIndex(): number | null {
    const snapshots = this.currentCatalog?.snapshots;
    if (!snapshots || snapshots.length === 0) return null;
    const currentIndex = snapshots.findIndex((snapshot) => snapshot.id === this.currentSnapshotId);
    return currentIndex >= snapshots.length - 1 ? 0 : currentIndex + 1;
  }

  private targetIndex(previousSelection: string | null, followLatest: boolean): number {
    const snapshots = this.currentCatalog?.snapshots ?? [];
    const preservedIndex = previousSelection
      ? snapshots.findIndex((snapshot) => snapshot.id === previousSelection)
      : -1;
    return followLatest || preservedIndex < 0 ? snapshots.length - 1 : preservedIndex;
  }
}
