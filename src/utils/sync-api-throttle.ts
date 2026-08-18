import { create } from 'zustand';
import { delay } from './index';
import { useSettingsStore } from '../stores/settings';

/** heavy sync 互斥种类 */
export type ExclusiveSyncKind = 'following' | 'bookmarks' | 'likes';

const DEFAULT_INTERVAL_MS = 1200;
const RATE_LIMIT_PENALTY_MS = 30000;

interface QueueItem {
  kind: ExclusiveSyncKind;
  run: () => void;
}

let lastSlotAt = 0;
let penaltyUntil = 0;
let exclusiveBusy: ExclusiveSyncKind | null = null;
const exclusiveQueue: QueueItem[] = [];

export interface SyncThrottleSnapshot {
  busyKind: ExclusiveSyncKind | null;
  /** 排队中的 kind（不含当前 busy） */
  queuedKinds: ExclusiveSyncKind[];
  lastSlotAt: number;
}

interface SyncThrottleStore extends SyncThrottleSnapshot {
  refresh: () => void;
}

function snapshot(): SyncThrottleSnapshot {
  return {
    busyKind: exclusiveBusy,
    queuedKinds: exclusiveQueue.map((q) => q.kind),
    lastSlotAt,
  };
}

export const useSyncThrottleStore = create<SyncThrottleStore>((set) => ({
  ...snapshot(),
  refresh: () => set(snapshot()),
}));

function publish() {
  useSyncThrottleStore.getState().refresh();
}

function getIntervalMs(): number {
  const v = useSettingsStore.getState().sync?.pageIntervalMs;
  if (typeof v !== 'number' || Number.isNaN(v)) return DEFAULT_INTERVAL_MS;
  return Math.min(5000, Math.max(800, Math.round(v)));
}

/**
 * 全局同步 API 节流：距上次放行至少间隔 settings.sync.pageIntervalMs。
 * 若曾触发限流惩罚，会等到 penaltyUntil。
 */
export async function waitSyncApiSlot(): Promise<void> {
  const interval = getIntervalMs();
  const now = Date.now();
  const earliest = Math.max(lastSlotAt + interval, penaltyUntil);
  const wait = Math.max(0, earliest - now);
  if (wait > 0) {
    await delay(wait);
  }
  lastSlotAt = Date.now();
  publish();
}

/** 限流后追加惩罚窗口（默认 30s） */
export function penalizeSyncApi(ms = RATE_LIMIT_PENALTY_MS): void {
  penaltyUntil = Math.max(penaltyUntil, Date.now() + ms);
  publish();
}

function pumpExclusive() {
  if (exclusiveBusy) return;
  const next = exclusiveQueue.shift();
  if (!next) {
    publish();
    return;
  }
  exclusiveBusy = next.kind;
  publish();
  next.run();
}

/**
 * 关注 / 书签 / 喜欢 全量·增量互斥执行；后来者排队。
 */
export function runExclusiveSync<T>(
  kind: ExclusiveSyncKind,
  fn: () => Promise<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    exclusiveQueue.push({
      kind,
      run: () => {
        Promise.resolve()
          .then(fn)
          .then(resolve, reject)
          .finally(() => {
            exclusiveBusy = null;
            publish();
            pumpExclusive();
          });
      },
    });
    publish();
    pumpExclusive();
  });
}

/** 某 kind 在互斥队列中的位置（1-based）；正在执行返回 0；不在队列返回 -1 */
export function getExclusiveQueuePosition(kind: ExclusiveSyncKind): number {
  if (exclusiveBusy === kind) return 0;
  const idx = exclusiveQueue.findIndex((q) => q.kind === kind);
  return idx >= 0 ? idx + 1 : -1;
}
