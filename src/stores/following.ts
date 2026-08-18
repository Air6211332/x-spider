import { create } from 'zustand';
import { FollowingUser } from '../interfaces/FollowingUser';
import {
  clearActivityQueue as clearActivityQueueDb,
  dequeueActivityHead,
  getActivityQueueCount,
  getActivityQueueIds,
  getFollowingMeta,
  initFollowingDb,
  deleteFollowingUser,
  listAllFollowingUsers,
  markFollowingUnavailable,
  replaceAllFollowingUsers,
  setActivityQueueIds,
  setFollowingMeta,
  updateFollowingActivity,
  updateFollowingUserMeta,
  upsertFollowingUsers,
} from '../db/following';
import {
  getFollowing,
  getLatestTweetAt,
  getSelfUserId,
  unfollowUser,
} from '../twitter/api';
import { sortIndexToMs } from '../utils/snowflake';
import { delay } from '../utils';
import {
  penalizeSyncApi,
  runExclusiveSync,
  waitSyncApiSlot,
} from '../utils/sync-api-throttle';
import { useAppStateStore } from './app-state';

const META_LAST_SYNC = 'last_sync_at';
const META_LAST_FULL_SYNC = 'last_full_sync_at';

/** 活跃度限流退避（毫秒） */
const ACTIVITY_BACKOFF_START_MS = 30000;
const ACTIVITY_BACKOFF_MAX_MS = 120000;

export type ActivityEnqueueMode = 'unchecked' | 'stale' | 'all';

export interface FollowingStore {
  ready: boolean;
  items: FollowingUser[];
  lastSyncAt: number | null;
  lastFullSyncAt: number | null;

  syncing: boolean;
  syncMode: 'full' | 'incremental' | null;
  syncProgress: { pages: number; upserted: number; message: string };

  activityRunning: boolean;
  activityQueueRemaining: number;
  activityCompletedSession: number;
  activityError: string | null;

  bootstrap: () => Promise<void>;
  reloadFromDb: () => Promise<void>;
  syncFull: () => Promise<void>;
  syncIncremental: () => Promise<void>;
  enqueueActivityRefresh: (mode?: ActivityEnqueueMode) => Promise<void>;
  pauseActivityQueue: () => void;
  resumeActivityQueue: () => Promise<void>;
  clearActivityQueue: () => Promise<void>;
  /** 仅从本地移除，不调用 Twitter 取关 */
  removeFollowing: (id: string) => Promise<void>;
  /** 先调 API 取关，成功后再本地删除 */
  unfollowAndRemove: (id: string) => Promise<void>;
  /** 活跃度队列快照（含本地用户信息） */
  listActivityQueueUsers: () => Promise<
    { id: string; user: FollowingUser | null }[]
  >;
  updateFollowingMeta: (
    id: string,
    patch: { noteName: string; note: string; tags: string[] },
  ) => Promise<void>;
}

function log() {
  return window.log.category('FOLLOW');
}

async function loadMetaTimes() {
  const lastSyncRaw = await getFollowingMeta(META_LAST_SYNC);
  const lastFullRaw = await getFollowingMeta(META_LAST_FULL_SYNC);
  return {
    lastSyncAt: lastSyncRaw ? Number(lastSyncRaw) : null,
    lastFullSyncAt: lastFullRaw ? Number(lastFullRaw) : null,
  };
}

export const useFollowingStore = create<FollowingStore>((set, get) => ({
  ready: false,
  items: [],
  lastSyncAt: null,
  lastFullSyncAt: null,

  syncing: false,
  syncMode: null,
  syncProgress: { pages: 0, upserted: 0, message: '' },

  activityRunning: false,
  activityQueueRemaining: 0,
  activityCompletedSession: 0,
  activityError: null,

  bootstrap: async () => {
    await initFollowingDb();
    await get().reloadFromDb();
    const remaining = await getActivityQueueCount();
    set({ ready: true, activityQueueRemaining: remaining });
    if (remaining > 0) {
      // 重启后续跑队列
      void get().resumeActivityQueue();
    }
  },

  reloadFromDb: async () => {
    const items = await listAllFollowingUsers();
    const meta = await loadMetaTimes();
    const remaining = await getActivityQueueCount();
    set({
      items,
      ...meta,
      activityQueueRemaining: remaining,
    });
  },

  syncFull: async () => {
    if (get().syncing) return;
    if (!useAppStateStore.getState().cookieString) {
      throw new Error('请先登录（配置 Cookie）');
    }

    set({
      syncing: true,
      syncMode: 'full',
      syncProgress: { pages: 0, upserted: 0, message: '排队等待中…' },
    });

    try {
      await runExclusiveSync('following', async () => {
        set({
          syncProgress: { pages: 0, upserted: 0, message: '开始全量同步…' },
        });
        const selfId = await getSelfUserId();
        log().info('Full sync selfId', selfId);

        const collected: FollowingUser[] = [];
        const unavailableIds: string[] = [];
        const seenIds = new Set<string>();
        let cursor: string | undefined | null = undefined;
        let pages = 0;
        let emptyStreak = 0;

        while (cursor !== null) {
          const prevCursor: string | undefined | null = cursor;
          try {
            await waitSyncApiSlot();
            const page = await getFollowing(
              selfId,
              cursor === undefined ? undefined : cursor,
            );
            pages += 1;

            let newCount = 0;
            for (const entry of page.entries) {
              if (entry.user) {
                if (seenIds.has(entry.user.id)) continue;
                seenIds.add(entry.user.id);
                collected.push(entry.user);
                newCount += 1;
              } else if (entry.unavailableId) {
                if (seenIds.has(entry.unavailableId)) continue;
                seenIds.add(entry.unavailableId);
                unavailableIds.push(entry.unavailableId);
                collected.push({
                  id: entry.unavailableId,
                  screenName: '',
                  name: '',
                  avatar: '',
                  description: '',
                  location: '',
                  url: '',
                  mediaCount: null,
                  followersCount: null,
                  friendsCount: null,
                  statusesCount: null,
                  protected: false,
                  followedBy: false,
                  registerTime: null,
                  sortIndex: entry.sortIndex,
                  syncedAt: Date.now(),
                  unavailable: true,
                  lastTweetAt: null,
                  activityCheckedAt: null,
                  activityNote: null,
                  noteName: '',
                  note: '',
                  tags: [],
                });
                newCount += 1;
              }
            }

            set({
              syncProgress: {
                pages,
                upserted: collected.length,
                message: `全量同步中：第 ${pages} 页，已收集 ${collected.length} 人`,
              },
            });

            if (!page.cursor) {
              break;
            }
            if (prevCursor !== undefined && page.cursor === prevCursor) {
              log().info('Full sync stop: cursor unchanged');
              break;
            }
            if (page.entries.length === 0 || newCount === 0) {
              emptyStreak += 1;
              if (emptyStreak >= 2) {
                log().info(
                  'Full sync stop: empty/duplicate pages',
                  emptyStreak,
                );
                break;
              }
            } else {
              emptyStreak = 0;
            }

            cursor = page.cursor;
          } catch (err: any) {
            const msg = typeof err === 'string' ? err : err?.message || '';
            if (msg.includes('RATE_LIMIT') || msg.includes('429')) {
              penalizeSyncApi();
            }
            throw err;
          }
        }

        await replaceAllFollowingUsers(collected);
        const now = Date.now();
        await setFollowingMeta(META_LAST_SYNC, String(now));
        await setFollowingMeta(META_LAST_FULL_SYNC, String(now));
        await get().reloadFromDb();
        set({
          lastSyncAt: now,
          lastFullSyncAt: now,
          syncProgress: {
            pages,
            upserted: collected.length,
            message: `全量完成：共 ${collected.length} 人（失效标记 ${unavailableIds.length}）`,
          },
        });
        log().info('Full sync done', collected.length);
      });
    } finally {
      set({ syncing: false, syncMode: null });
    }
  },

  syncIncremental: async () => {
    if (get().syncing) return;
    if (!useAppStateStore.getState().cookieString) {
      throw new Error('请先登录（配置 Cookie）');
    }

    const { lastSyncAt } = get();
    if (!lastSyncAt) {
      await get().syncFull();
      return;
    }

    set({
      syncing: true,
      syncMode: 'incremental',
      syncProgress: { pages: 0, upserted: 0, message: '排队等待中…' },
    });

    try {
      await runExclusiveSync('following', async () => {
        set({
          syncProgress: { pages: 0, upserted: 0, message: '开始增量同步…' },
        });
        const selfId = await getSelfUserId();
        const upserted: FollowingUser[] = [];
        let cursor: string | undefined | null = undefined;
        let pages = 0;
        let stop = false;
        let emptyStreak = 0;

        while (cursor !== null && !stop) {
          const prevCursor: string | undefined | null = cursor;
          try {
            await waitSyncApiSlot();
            const page = await getFollowing(
              selfId,
              cursor === undefined ? undefined : cursor,
            );
            pages += 1;

            let pageNew = 0;
            for (const entry of page.entries) {
              const entryMs = sortIndexToMs(entry.sortIndex);
              if (entryMs !== null && entryMs < lastSyncAt) {
                stop = true;
                break;
              }

              if (entry.user) {
                upserted.push(entry.user);
                pageNew += 1;
              } else if (entry.unavailableId) {
                await markFollowingUnavailable(entry.unavailableId);
                pageNew += 1;
              }
            }

            set({
              syncProgress: {
                pages,
                upserted: upserted.length,
                message: `增量同步中：第 ${pages} 页，新增/更新 ${upserted.length} 人`,
              },
            });

            if (stop) break;
            if (!page.cursor) break;
            if (prevCursor !== undefined && page.cursor === prevCursor) break;
            if (page.entries.length === 0 || pageNew === 0) {
              emptyStreak += 1;
              if (emptyStreak >= 2) break;
            } else {
              emptyStreak = 0;
            }

            cursor = page.cursor;
          } catch (err: any) {
            const msg = typeof err === 'string' ? err : err?.message || '';
            if (msg.includes('RATE_LIMIT') || msg.includes('429')) {
              penalizeSyncApi();
            }
            throw err;
          }
        }

        if (upserted.length > 0) {
          await upsertFollowingUsers(upserted);
        }
        const now = Date.now();
        await setFollowingMeta(META_LAST_SYNC, String(now));
        await get().reloadFromDb();
        set({
          lastSyncAt: now,
          syncProgress: {
            pages,
            upserted: upserted.length,
            message: `增量完成：更新 ${upserted.length} 人`,
          },
        });
        log().info('Incremental sync done', upserted.length);
      });
    } finally {
      set({ syncing: false, syncMode: null });
    }
  },

  enqueueActivityRefresh: async (mode = 'unchecked') => {
    const items = get().items;
    const STALE_MS = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    let candidates = items.filter((u) => !u.unavailable);
    if (mode === 'unchecked') {
      candidates = candidates.filter((u) => u.activityCheckedAt == null);
    } else if (mode === 'stale') {
      candidates = candidates.filter(
        (u) =>
          u.activityCheckedAt == null || now - u.activityCheckedAt > STALE_MS,
      );
    }

    candidates.sort((a, b) => {
      const ta = a.activityCheckedAt ?? 0;
      const tb = b.activityCheckedAt ?? 0;
      return ta - tb;
    });

    const existing = await getActivityQueueIds();
    const existingSet = new Set(existing);
    const merged = [
      ...existing,
      ...candidates.map((c) => c.id).filter((id) => !existingSet.has(id)),
    ];
    await setActivityQueueIds(merged);
    set({
      activityQueueRemaining: merged.length,
      activityError: null,
      activityCompletedSession: 0,
    });
    await get().resumeActivityQueue();
  },

  pauseActivityQueue: () => {
    set({ activityRunning: false });
  },

  resumeActivityQueue: async () => {
    if (get().activityRunning) return;
    set({ activityRunning: true, activityError: null });
    void runActivityWorker();
  },

  clearActivityQueue: async () => {
    set({ activityRunning: false });
    await clearActivityQueueDb();
    set({ activityQueueRemaining: 0 });
  },

  removeFollowing: async (id) => {
    await deleteFollowingUser(id);
    set((s) => ({
      items: s.items.filter((u) => u.id !== id),
    }));
    const remaining = await getActivityQueueCount();
    set({ activityQueueRemaining: remaining });
  },

  unfollowAndRemove: async (id) => {
    if (!useAppStateStore.getState().cookieString) {
      throw new Error('请先登录（配置 Cookie）');
    }
    await unfollowUser(id);
    await get().removeFollowing(id);
  },

  listActivityQueueUsers: async () => {
    const ids = await getActivityQueueIds();
    const items = get().items;
    const map = new Map(items.map((u) => [u.id, u]));
    return ids.map((id) => ({ id, user: map.get(id) ?? null }));
  },

  updateFollowingMeta: async (id, patch) => {
    await updateFollowingUserMeta(id, patch);
    set((s) => ({
      items: s.items.map((u) =>
        u.id === id
          ? {
              ...u,
              noteName: patch.noteName,
              note: patch.note,
              tags: patch.tags,
            }
          : u,
      ),
    }));
  },
}));

let activityBackoffMs = ACTIVITY_BACKOFF_START_MS;

async function runActivityWorker() {
  const store = () => useFollowingStore.getState();

  while (store().activityRunning) {
    const userId = await dequeueActivityHead();
    if (!userId) {
      useFollowingStore.setState({
        activityRunning: false,
        activityQueueRemaining: 0,
      });
      return;
    }

    const remaining = await getActivityQueueCount();
    useFollowingStore.setState({ activityQueueRemaining: remaining });

    const local = store().items.find((u) => u.id === userId);

    try {
      await waitSyncApiSlot();
      const result = await getLatestTweetAt(userId);
      const checkedAt = Date.now();
      let note = result.note;
      if (result.lastTweetAt == null && note === 'empty' && local?.protected) {
        note = 'locked';
      }

      await updateFollowingActivity(userId, {
        lastTweetAt: result.lastTweetAt,
        activityCheckedAt: checkedAt,
        activityNote: note,
        unavailable: result.unavailable,
      });

      useFollowingStore.setState((s) => ({
        items: s.items.map((u) =>
          u.id === userId
            ? {
                ...u,
                lastTweetAt: result.lastTweetAt,
                activityCheckedAt: checkedAt,
                activityNote: note,
                unavailable: result.unavailable ? true : u.unavailable,
              }
            : u,
        ),
        activityCompletedSession: s.activityCompletedSession + 1,
        activityError: null,
      }));

      activityBackoffMs = ACTIVITY_BACKOFF_START_MS;
    } catch (err: any) {
      const msg = typeof err === 'string' ? err : err?.message || '';
      log().warn('Activity check failed', userId, err);

      // 失败的重新入队尾部，避免卡死
      const ids = await getActivityQueueIds();
      await setActivityQueueIds([...ids, userId]);
      useFollowingStore.setState({
        activityQueueRemaining: ids.length + 1,
        activityError: msg || '活跃度检查失败',
      });

      if (msg.includes('RATE_LIMIT') || msg.includes('429')) {
        penalizeSyncApi(activityBackoffMs);
        useFollowingStore.setState({
          activityError: `触发限流，${Math.round(activityBackoffMs / 1000)}s 后重试`,
        });
        await delay(activityBackoffMs);
        activityBackoffMs = Math.min(
          activityBackoffMs * 2,
          ACTIVITY_BACKOFF_MAX_MS,
        );
      }
    }
  }
}
