import { create, StoreApi, UseBoundStore } from 'zustand';
import dayjs from 'dayjs';
import MediaType from '../enums/MediaType';
import { DownloadFilter } from '../interfaces/DownloadFilter';
import {
  MediaSourceKind,
  MsPostRecord,
  msMediaToTwitterMedia,
  msPostToTwitterPost,
  twitterPostToMsRecords,
} from '../interfaces/MediaSource';
import {
  batchUpdateMediaLocalExists,
  countLocalExistsStats,
  countPosts,
  getMediaSourceMeta,
  initMediaSourceDb,
  listAllMediasWithPosts,
  listPosts,
  mediaSourceMetaKey,
  postExistsInDb,
  replaceSyncedBatch,
  setMediaSourceMeta,
  upsertPostsWithMedias,
} from '../db/media-source';
import { getBookmarks, getLikes, getSelfUserId } from '../twitter/api';
import { TwitterPost } from '../interfaces/TwitterPost';
import { downloadFileExists } from '../utils/download-path';
import {
  penalizeSyncApi,
  runExclusiveSync,
  waitSyncApiSlot,
} from '../utils/sync-api-throttle';
import { useAppStateStore } from './app-state';
import { useDownloadStore } from './download';

const LIST_PAGE_SIZE = 40;

export interface MediaSourceSyncStore {
  source: MediaSourceKind;
  ready: boolean;
  accountId: string | null;
  items: MsPostRecord[];
  totalPosts: number;
  listOffset: number;
  listHasMore: boolean;
  listLoading: boolean;

  stats: { total: number; exists: number; missing: number };
  lastSyncAt: number | null;
  lastFullSyncAt: number | null;

  syncing: boolean;
  syncMode: 'full' | 'incremental' | null;
  syncProgress: { pages: number; upserted: number; message: string };

  rechecking: boolean;
  recheckProgress: { done: number; total: number; message: string };

  downloading: boolean;

  filter: DownloadFilter;
  setFilter: (filter: DownloadFilter) => void;

  bootstrap: () => Promise<void>;
  ensureAccount: () => Promise<string>;
  reloadFromDb: () => Promise<void>;
  loadMoreFromDb: () => Promise<boolean>;
  syncFull: () => Promise<void>;
  syncIncremental: () => Promise<void>;
  recheckLocalFiles: () => Promise<void>;
  downloadMissing: () => Promise<number>;
}

function logCat(source: MediaSourceKind) {
  return window.log.category(source === 'bookmarks' ? 'BM' : 'LIKES');
}

async function loadMeta(source: MediaSourceKind, accountId: string) {
  const lastSyncRaw = await getMediaSourceMeta(
    mediaSourceMetaKey(source, accountId, 'last_sync_at'),
  );
  const lastFullRaw = await getMediaSourceMeta(
    mediaSourceMetaKey(source, accountId, 'last_full_sync_at'),
  );
  return {
    lastSyncAt: lastSyncRaw ? Number(lastSyncRaw) : null,
    lastFullSyncAt: lastFullRaw ? Number(lastFullRaw) : null,
  };
}

async function fetchPage(
  source: MediaSourceKind,
  accountId: string,
  cursor?: string,
): Promise<{ twitterPosts: TwitterPost[]; cursor: string | null }> {
  if (source === 'bookmarks') {
    return getBookmarks(cursor);
  }
  return getLikes(accountId, cursor);
}

export function createMediaSourceStore(
  source: MediaSourceKind,
): UseBoundStore<StoreApi<MediaSourceSyncStore>> {
  return create<MediaSourceSyncStore>((set, get) => ({
    source,
    ready: false,
    accountId: null,
    items: [],
    totalPosts: 0,
    listOffset: 0,
    listHasMore: false,
    listLoading: false,

    stats: { total: 0, exists: 0, missing: 0 },
    lastSyncAt: null,
    lastFullSyncAt: null,

    syncing: false,
    syncMode: null,
    syncProgress: { pages: 0, upserted: 0, message: '' },

    rechecking: false,
    recheckProgress: { done: 0, total: 0, message: '' },

    downloading: false,

    filter: {
      mediaTypes: [MediaType.Photo, MediaType.Video, MediaType.Gif],
      source: 'tweets',
    },
    setFilter: (filter) => set({ filter: { ...filter, source: 'tweets' } }),

    bootstrap: async () => {
      await initMediaSourceDb();
      try {
        if (useAppStateStore.getState().cookieString) {
          await get().ensureAccount();
          await get().reloadFromDb();
        }
      } catch (err) {
        logCat(source).warn('bootstrap account skip', err);
      }
      set({ ready: true });
    },

    ensureAccount: async () => {
      const id = await getSelfUserId();
      if (get().accountId !== id) {
        set({ accountId: id, items: [], listOffset: 0 });
      } else {
        set({ accountId: id });
      }
      return id;
    },

    reloadFromDb: async () => {
      const accountId = get().accountId || (await get().ensureAccount());
      set({ listLoading: true });
      try {
        const [items, totalPosts, stats, meta] = await Promise.all([
          listPosts(source, accountId, 0, LIST_PAGE_SIZE),
          countPosts(source, accountId),
          countLocalExistsStats(source, accountId),
          loadMeta(source, accountId),
        ]);
        set({
          items,
          totalPosts,
          stats,
          listOffset: items.length,
          listHasMore: items.length < totalPosts,
          listLoading: false,
          ...meta,
        });
      } catch (err) {
        set({ listLoading: false });
        throw err;
      }
    },

    loadMoreFromDb: async (): Promise<boolean> => {
      const { accountId, listOffset, listHasMore, listLoading, items } = get();
      if (!accountId || !listHasMore || listLoading) return false;
      set({ listLoading: true });
      try {
        const more = await listPosts(
          source,
          accountId,
          listOffset,
          LIST_PAGE_SIZE,
        );
        const next = [...items, ...more];
        const totalPosts = await countPosts(source, accountId);
        const hasMore = next.length < totalPosts;
        set({
          items: next,
          totalPosts,
          listOffset: next.length,
          listHasMore: hasMore,
          listLoading: false,
        });
        return hasMore;
      } catch (err) {
        set({ listLoading: false });
        throw err;
      }
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
        await runExclusiveSync(source, async () => {
          set({
            syncProgress: { pages: 0, upserted: 0, message: '开始全量同步…' },
          });
          const accountId = await get().ensureAccount();
          const batchAt = Date.now();
          const collected: NonNullable<ReturnType<typeof twitterPostToMsRecords>>[] = [];
          const seenIds = new Set<string>();
          let nextCursor: string | undefined = undefined;
          let pages = 0;
          let emptyStreak = 0;
          let finished = false;

          while (!finished) {
            const requestedCursor: string | undefined = nextCursor;
            try {
              await waitSyncApiSlot();
              const page: {
                twitterPosts: TwitterPost[];
                cursor: string | null;
              } = await fetchPage(source, accountId, requestedCursor);
              pages += 1;

              let newCount = 0;
              for (const post of page.twitterPosts) {
                if (!post.id || seenIds.has(post.id)) continue;
                const mapped = twitterPostToMsRecords(
                  post,
                  source,
                  accountId,
                  batchAt,
                );
                if (!mapped) continue;
                seenIds.add(post.id);
                collected.push(mapped);
                newCount += 1;
              }

              set({
                syncProgress: {
                  pages,
                  upserted: collected.length,
                  message: `全量同步中：第 ${pages} 页，已收集 ${collected.length} 条带媒体帖`,
                },
              });

              if (newCount === 0 || page.twitterPosts.length === 0) {
                emptyStreak += 1;
              } else {
                emptyStreak = 0;
              }

              if (
                !page.cursor ||
                page.cursor === requestedCursor ||
                emptyStreak >= 2
              ) {
                finished = true;
              } else {
                nextCursor = page.cursor;
              }
            } catch (err: any) {
              const msg = typeof err === 'string' ? err : err?.message || '';
              if (msg.includes('RATE_LIMIT') || msg.includes('429')) {
                penalizeSyncApi();
              }
              throw err;
            }
          }

          await replaceSyncedBatch(source, accountId, collected, batchAt);
          const now = String(Date.now());
          await setMediaSourceMeta(
            mediaSourceMetaKey(source, accountId, 'last_sync_at'),
            now,
          );
          await setMediaSourceMeta(
            mediaSourceMetaKey(source, accountId, 'last_full_sync_at'),
            now,
          );

          await get().reloadFromDb();
          set({
            syncProgress: {
              pages,
              upserted: collected.length,
              message: `全量同步完成：共 ${collected.length} 条`,
            },
          });
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

      const accountId = await get().ensureAccount();
      const meta = await loadMeta(source, accountId);
      if (!meta.lastSyncAt) {
        await get().syncFull();
        return;
      }

      set({
        syncing: true,
        syncMode: 'incremental',
        syncProgress: { pages: 0, upserted: 0, message: '排队等待中…' },
      });

      try {
        await runExclusiveSync(source, async () => {
          set({
            syncProgress: {
              pages: 0,
              upserted: 0,
              message: '开始增量同步…',
            },
          });
          const batchAt = Date.now();
          const collected: NonNullable<ReturnType<typeof twitterPostToMsRecords>>[] = [];
          let nextCursor: string | undefined = undefined;
          let pages = 0;
          let emptyStreak = 0;
          let finished = false;

          while (!finished) {
            const requestedCursor: string | undefined = nextCursor;
            try {
              await waitSyncApiSlot();
              const page: {
                twitterPosts: TwitterPost[];
                cursor: string | null;
              } = await fetchPage(source, accountId, requestedCursor);
              pages += 1;

              let newCount = 0;
              let hitExisting = false;
              for (const post of page.twitterPosts) {
                if (!post.id) continue;
                if (await postExistsInDb(source, accountId, post.id)) {
                  hitExisting = true;
                  break;
                }
                const mapped = twitterPostToMsRecords(
                  post,
                  source,
                  accountId,
                  batchAt,
                );
                if (!mapped) continue;
                collected.push(mapped);
                newCount += 1;
              }

              set({
                syncProgress: {
                  pages,
                  upserted: collected.length,
                  message: `增量同步中：第 ${pages} 页，新增 ${collected.length} 条`,
                },
              });

              if (newCount === 0 || page.twitterPosts.length === 0) {
                emptyStreak += 1;
              } else {
                emptyStreak = 0;
              }

              if (
                hitExisting ||
                !page.cursor ||
                page.cursor === requestedCursor ||
                emptyStreak >= 2
              ) {
                finished = true;
              } else {
                nextCursor = page.cursor;
              }
            } catch (err: any) {
              const msg = typeof err === 'string' ? err : err?.message || '';
              if (msg.includes('RATE_LIMIT') || msg.includes('429')) {
                penalizeSyncApi();
              }
              throw err;
            }
          }

          if (collected.length > 0) {
            await upsertPostsWithMedias(collected);
          }
          await setMediaSourceMeta(
            mediaSourceMetaKey(source, accountId, 'last_sync_at'),
            String(Date.now()),
          );

          await get().reloadFromDb();
          set({
            syncProgress: {
              pages,
              upserted: collected.length,
              message: `增量同步完成：新增 ${collected.length} 条`,
            },
          });
        });
      } finally {
        set({ syncing: false, syncMode: null });
      }
    },

    recheckLocalFiles: async () => {
      if (get().rechecking) return;
      const accountId = get().accountId || (await get().ensureAccount());

      set({
        rechecking: true,
        recheckProgress: { done: 0, total: 0, message: '开始校验本地文件…' },
      });

      try {
        const rows = await listAllMediasWithPosts(source, accountId);
        const total = rows.length;

        const mediasByPost = new Map<string, typeof rows>();
        for (const row of rows) {
          const list = mediasByPost.get(row.media.postId) || [];
          list.push(row);
          mediasByPost.set(row.media.postId, list);
        }

        set({
          recheckProgress: {
            done: 0,
            total,
            message: `校验中 0/${total}`,
          },
        });

        const updates: {
          source: MediaSourceKind;
          accountId: string;
          postId: string;
          mediaId: string;
          localExists: boolean;
        }[] = [];

        let done = 0;
        for (const row of rows) {
          const siblings = mediasByPost.get(row.media.postId) || [row];
          const twPost = msPostToTwitterPost({
            ...row.post,
            medias: siblings.map((s) => s.media),
          });
          const twMedia = msMediaToTwitterMedia(row.media);
          let exists = false;
          try {
            exists = await downloadFileExists(twPost, twMedia);
          } catch (err) {
            logCat(source).warn('recheck exists error', err);
          }
          updates.push({
            source,
            accountId,
            postId: row.media.postId,
            mediaId: row.media.mediaId,
            localExists: exists,
          });
          done += 1;
          if (done % 20 === 0 || done === total) {
            set({
              recheckProgress: {
                done,
                total,
                message: `校验中 ${done}/${total}`,
              },
            });
          }
        }

        await batchUpdateMediaLocalExists(updates);
        await get().reloadFromDb();
        set({
          recheckProgress: {
            done: total,
            total,
            message: `校验完成：${total} 个媒体`,
          },
        });
      } finally {
        set({ rechecking: false });
      }
    },

    downloadMissing: async () => {
      if (get().downloading) return 0;
      const accountId = get().accountId || (await get().ensureAccount());
      const { filter } = get();

      if (!filter.mediaTypes || filter.mediaTypes.length === 0) {
        throw new Error('请至少选择一个媒体类型');
      }

      set({ downloading: true });
      try {
        const allRows = await listAllMediasWithPosts(source, accountId);
        const mediasByPost = new Map<string, typeof allRows>();
        for (const row of allRows) {
          const list = mediasByPost.get(row.media.postId) || [];
          list.push(row);
          mediasByPost.set(row.media.postId, list);
        }

        const since = filter.dateRange?.[0] || dayjs.unix(0);
        const until = filter.dateRange?.[1] || dayjs();

        const paramsList = [];
        const markList: {
          source: MediaSourceKind;
          accountId: string;
          postId: string;
          mediaId: string;
          localExists: boolean;
        }[] = [];

        for (const row of allRows) {
          if (row.media.localExists) continue;
          if (!filter.mediaTypes.includes(row.media.type)) continue;
          const createdAt =
            row.post.createdAt != null ? dayjs(row.post.createdAt) : null;
          if (createdAt) {
            if (createdAt.isBefore(since) || createdAt.isAfter(until)) {
              continue;
            }
          }

          const siblings = mediasByPost.get(row.media.postId) || [row];
          const twPost = msPostToTwitterPost({
            ...row.post,
            medias: siblings.map((s) => s.media),
          });
          const twMedia = msMediaToTwitterMedia(row.media);

          if (await downloadFileExists(twPost, twMedia)) {
            markList.push({
              source,
              accountId,
              postId: row.media.postId,
              mediaId: row.media.mediaId,
              localExists: true,
            });
            continue;
          }

          paramsList.push({ post: twPost, media: twMedia });
          markList.push({
            source,
            accountId,
            postId: row.media.postId,
            mediaId: row.media.mediaId,
            localExists: true,
          });
        }

        if (paramsList.length > 0) {
          await useDownloadStore.getState().batchCreateDownloadTask(paramsList);
        }

        if (markList.length > 0) {
          await batchUpdateMediaLocalExists(markList);
        }

        await get().reloadFromDb();
        return paramsList.length;
      } finally {
        set({ downloading: false });
      }
    },
  }));
}
