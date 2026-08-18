/* eslint-disable react/prop-types */
import { Button, Pagination, Space, Tag } from 'antd';
import dayjs from 'dayjs';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CachedAvatar } from '../CachedAvatar';
import { PageHeader } from '../PageHeader';
import { QueueTabs } from './QueueTabs';
import { FollowingUser } from '../../interfaces/FollowingUser';
import { useFollowingStore } from '../../stores/following';
import { useBookmarksStore } from '../../stores/bookmarks';
import { useLikesStore } from '../../stores/likes';
import { useAvatarCacheStore } from '../../utils/avatar-cache';
import { useSyncThrottleStore } from '../../utils/sync-api-throttle';

const ACTIVITY_PAGE_SIZE = 50;

/** 头像缓存队列面板 */
const AvatarCachePanel: React.FC = () => {
  const jobs = useAvatarCacheStore((s) => s.jobs);
  const clearWaiting = useAvatarCacheStore((s) => s.clearWaiting);

  const waiting = jobs.filter((j) => j.status === 'waiting');
  const running = jobs.filter((j) => j.status === 'running');

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="shrink-0 flex flex-wrap items-center gap-2 mb-3">
        <span className="text-sm text-gray-500">
          进行中 {running.length} · 等待 {waiting.length}（并发上限 2）
        </span>
        <Button
          size="small"
          danger
          disabled={waiting.length === 0}
          onClick={clearWaiting}
        >
          清空等待
        </Button>
      </div>
      {jobs.length === 0 ? (
        <p className="text-gray-500 m-0">暂无头像缓存任务</p>
      ) : (
        <ul className="grow overflow-auto list-none p-0 m-0 space-y-2">
          {jobs.map((job) => (
            <li
              key={job.screenName}
              className="flex items-center gap-3 px-3 py-2 border rounded bg-white"
            >
              <CachedAvatar
                screenName={job.screenName}
                src={job.url}
                size={36}
              />
              <div className="min-w-0 grow">
                <div className="font-medium truncate">@{job.screenName}</div>
                <div className="text-xs text-gray-400 truncate">{job.url}</div>
              </div>
              <Tag color={job.status === 'running' ? 'processing' : 'default'}>
                {job.status === 'running' ? '下载中' : '等待'}
              </Tag>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

/** 活跃度队列面板 */
const ActivityQueuePanel: React.FC = () => {
  const activityRunning = useFollowingStore((s) => s.activityRunning);
  const activityQueueRemaining = useFollowingStore(
    (s) => s.activityQueueRemaining,
  );
  const activityCompletedSession = useFollowingStore(
    (s) => s.activityCompletedSession,
  );
  const activityError = useFollowingStore((s) => s.activityError);
  const pauseActivityQueue = useFollowingStore((s) => s.pauseActivityQueue);
  const resumeActivityQueue = useFollowingStore((s) => s.resumeActivityQueue);
  const clearActivityQueue = useFollowingStore((s) => s.clearActivityQueue);
  const listActivityQueueUsers = useFollowingStore(
    (s) => s.listActivityQueueUsers,
  );

  const [rows, setRows] = useState<
    { id: string; user: FollowingUser | null }[]
  >([]);
  const [page, setPage] = useState(1);

  const refresh = useCallback(async () => {
    const list = await listActivityQueueUsers();
    setRows(list);
  }, [listActivityQueueUsers]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(timer);
  }, [refresh, activityQueueRemaining, activityRunning]);

  const paged = useMemo(() => {
    const start = (page - 1) * ACTIVITY_PAGE_SIZE;
    return rows.slice(start, start + ACTIVITY_PAGE_SIZE);
  }, [rows, page]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(rows.length / ACTIVITY_PAGE_SIZE));
    if (page > maxPage) setPage(maxPage);
  }, [rows.length, page]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="shrink-0 space-y-2 mb-3">
        <div className="text-sm text-gray-500 flex flex-wrap gap-x-4 gap-y-1">
          <span>剩余 {activityQueueRemaining}</span>
          <span>{activityRunning ? '运行中' : '已暂停'}</span>
          {activityCompletedSession > 0 && (
            <span>本会话已查 {activityCompletedSession}</span>
          )}
          {activityError && (
            <span className="text-ant-color-error">{activityError}</span>
          )}
        </div>
        <Space wrap>
          {activityRunning ? (
            <Button size="small" onClick={pauseActivityQueue}>
              暂停
            </Button>
          ) : (
            <Button
              size="small"
              type="primary"
              disabled={activityQueueRemaining === 0}
              onClick={() => resumeActivityQueue()}
            >
              继续
            </Button>
          )}
          <Button
            size="small"
            danger
            disabled={activityQueueRemaining === 0 && !activityRunning}
            onClick={() => clearActivityQueue()}
          >
            清空队列
          </Button>
        </Space>
      </div>
      {rows.length === 0 ? (
        <p className="text-gray-500 m-0">活跃度队列为空</p>
      ) : (
        <>
          <ul className="grow overflow-auto list-none p-0 m-0 space-y-2">
            {paged.map(({ id, user }) => (
              <li
                key={id}
                className="flex items-center gap-3 px-3 py-2 border rounded bg-white"
              >
                <CachedAvatar
                  screenName={user?.screenName}
                  src={user?.avatar}
                  size={36}
                />
                <div className="min-w-0 grow">
                  <div className="font-medium truncate">
                    {user?.noteName
                      ? `${user.noteName}(${user.name || '无名称'})`
                      : user?.name || '（未知用户）'}
                  </div>
                  <div className="text-xs text-gray-400 truncate">
                    {user?.screenName ? `@${user.screenName}` : id}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {rows.length > ACTIVITY_PAGE_SIZE && (
            <div className="shrink-0 mt-3 flex justify-center">
              <Pagination
                size="small"
                current={page}
                pageSize={ACTIVITY_PAGE_SIZE}
                total={rows.length}
                onChange={setPage}
                showSizeChanger={false}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
};

/** 单源同步卡片 */
const SyncSourceCard: React.FC<{
  title: string;
  kind: 'following' | 'bookmarks' | 'likes';
  syncing: boolean;
  syncMode: 'full' | 'incremental' | null;
  syncProgress: { pages: number; upserted: number; message: string };
  lastSyncAt: number | null;
  lastFullSyncAt: number | null;
  onFull: () => void;
  onIncremental: () => void;
}> = ({
  title,
  kind,
  syncing,
  syncMode,
  syncProgress,
  lastSyncAt,
  lastFullSyncAt,
  onFull,
  onIncremental,
}) => {
  const busyKind = useSyncThrottleStore((s) => s.busyKind);
  const queuedKinds = useSyncThrottleStore((s) => s.queuedKinds);
  const queuePos =
    busyKind === kind
      ? 0
      : (() => {
          const idx = queuedKinds.indexOf(kind);
          return idx >= 0 ? idx + 1 : -1;
        })();

  return (
    <div className="border rounded bg-white p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-medium">{title}</span>
        {syncing ? (
          <Tag color="processing">
            {syncProgress.message?.startsWith('排队')
              ? '排队中'
              : syncMode === 'full'
                ? '全量同步中'
                : '增量同步中'}
          </Tag>
        ) : (
          <Tag>空闲</Tag>
        )}
        {queuePos > 0 && <Tag>排队第 {queuePos}</Tag>}
      </div>
      {(syncing || syncProgress.message) && (
        <p className="m-0 text-sm text-ant-color-primary">
          {syncProgress.message || '…'}
        </p>
      )}
      {syncing && !syncProgress.message?.startsWith('排队') && (
        <p className="m-0 text-sm text-gray-500">
          第 {syncProgress.pages} 页 · 已处理 {syncProgress.upserted}
        </p>
      )}
      <dl className="text-sm text-gray-600 space-y-1 m-0">
        <div className="flex gap-2">
          <dt className="text-gray-400 shrink-0">上次同步</dt>
          <dd className="m-0">
            {lastSyncAt
              ? dayjs(lastSyncAt).format('YYYY-MM-DD HH:mm:ss')
              : '从未'}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-gray-400 shrink-0">上次全量</dt>
          <dd className="m-0">
            {lastFullSyncAt
              ? dayjs(lastFullSyncAt).format('YYYY-MM-DD HH:mm:ss')
              : '从未'}
          </dd>
        </div>
      </dl>
      <Space wrap>
        <Button
          type="primary"
          loading={syncing}
          disabled={syncing}
          onClick={onFull}
        >
          全量同步
        </Button>
        <Button loading={syncing} disabled={syncing} onClick={onIncremental}>
          增量同步
        </Button>
      </Space>
    </div>
  );
};

/** 数据同步：关注 / 书签 / 喜欢 */
const DataSyncPanel: React.FC = () => {
  const following = useFollowingStore();
  const bookmarks = useBookmarksStore();
  const likes = useLikesStore();
  const busyKind = useSyncThrottleStore((s) => s.busyKind);
  const queuedKinds = useSyncThrottleStore((s) => s.queuedKinds);

  return (
    <div className="h-full overflow-auto space-y-4 pr-1">
      <p className="m-0 text-sm text-gray-500">
        全局 API 节流已启用
        {busyKind ? ` · 当前执行：${busyKind}` : ''}
        {queuedKinds.length > 0 ? ` · 排队 ${queuedKinds.length}` : ''}
        。间隔可在设置中调整。
      </p>
      <div className="grid gap-4 md:grid-cols-1 lg:grid-cols-3 max-w-6xl">
        <SyncSourceCard
          title="关注"
          kind="following"
          syncing={following.syncing}
          syncMode={following.syncMode}
          syncProgress={following.syncProgress}
          lastSyncAt={following.lastSyncAt}
          lastFullSyncAt={following.lastFullSyncAt}
          onFull={() => void following.syncFull()}
          onIncremental={() => void following.syncIncremental()}
        />
        <SyncSourceCard
          title="书签"
          kind="bookmarks"
          syncing={bookmarks.syncing}
          syncMode={bookmarks.syncMode}
          syncProgress={bookmarks.syncProgress}
          lastSyncAt={bookmarks.lastSyncAt}
          lastFullSyncAt={bookmarks.lastFullSyncAt}
          onFull={() => void bookmarks.syncFull()}
          onIncremental={() => void bookmarks.syncIncremental()}
        />
        <SyncSourceCard
          title="喜欢"
          kind="likes"
          syncing={likes.syncing}
          syncMode={likes.syncMode}
          syncProgress={likes.syncProgress}
          lastSyncAt={likes.lastSyncAt}
          lastFullSyncAt={likes.lastFullSyncAt}
          onFull={() => void likes.syncFull()}
          onIncremental={() => void likes.syncIncremental()}
        />
      </div>
    </div>
  );
};

export const QueueManagement: React.FC = () => {
  const avatarJobs = useAvatarCacheStore((s) => s.jobs);
  const activityQueueRemaining = useFollowingStore(
    (s) => s.activityQueueRemaining,
  );
  const followingSyncing = useFollowingStore((s) => s.syncing);
  const bookmarksSyncing = useBookmarksStore((s) => s.syncing);
  const likesSyncing = useLikesStore((s) => s.syncing);
  const queuedKinds = useSyncThrottleStore((s) => s.queuedKinds);

  const syncTabCount =
    (followingSyncing ? 1 : 0) +
    (bookmarksSyncing ? 1 : 0) +
    (likesSyncing ? 1 : 0) +
    queuedKinds.length;

  return (
    <div className="flex flex-col h-screen overflow-hidden relative">
      <PageHeader />
      <div className="relative grow h-full overflow-hidden">
        <QueueTabs
          tabs={[
            {
              name: '头像缓存',
              count: avatarJobs.length,
              children: <AvatarCachePanel />,
            },
            {
              name: '活跃度',
              count: activityQueueRemaining,
              children: <ActivityQueuePanel />,
            },
            {
              name: '数据同步',
              count: syncTabCount,
              children: <DataSyncPanel />,
            },
          ]}
        />
      </div>
    </div>
  );
};
