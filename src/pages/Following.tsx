/* eslint-disable react/prop-types */
import {
  App,
  Button,
  Input,
  InputNumber,
  Pagination,
  Select,
  Tag,
  Tooltip,
} from 'antd';
import dayjs from 'dayjs';
import React, { useEffect, useMemo, useState } from 'react';
import { FollowingUserCard } from '../components/following/FollowingUserCard';
import { PageHeader } from '../components/PageHeader';
import { ActivityEnqueueMode, useFollowingStore } from '../stores/following';
import { useRouteStore } from '../stores/route';

type ActivityFilter =
  | 'all'
  | 'inactive'
  | 'unavailable'
  | 'unchecked'
  | 'locked';

/** 互关筛选 */
type MutualFilter = 'all' | 'mutual' | 'non_mutual';

const DEFAULT_PAGE_SIZE = 24;
const PAGE_SIZE_OPTIONS = ['12', '24', '48', '96'];

function hasNoTags(tags?: string[]) {
  return !tags || tags.length === 0;
}

export const Following: React.FC = () => {
  const { message } = App.useApp();
  const setRouteById = useRouteStore((s) => s.setRouteById);

  const ready = useFollowingStore((s) => s.ready);
  const items = useFollowingStore((s) => s.items);
  const lastSyncAt = useFollowingStore((s) => s.lastSyncAt);
  const lastFullSyncAt = useFollowingStore((s) => s.lastFullSyncAt);
  const syncing = useFollowingStore((s) => s.syncing);
  const activityRunning = useFollowingStore((s) => s.activityRunning);
  const activityQueueRemaining = useFollowingStore(
    (s) => s.activityQueueRemaining,
  );
  const activityCompletedSession = useFollowingStore(
    (s) => s.activityCompletedSession,
  );
  const activityError = useFollowingStore((s) => s.activityError);

  const syncFull = useFollowingStore((s) => s.syncFull);
  const syncIncremental = useFollowingStore((s) => s.syncIncremental);
  const enqueueActivityRefresh = useFollowingStore(
    (s) => s.enqueueActivityRefresh,
  );
  const pauseActivityQueue = useFollowingStore((s) => s.pauseActivityQueue);
  const resumeActivityQueue = useFollowingStore((s) => s.resumeActivityQueue);
  const clearActivityQueueFn = useFollowingStore((s) => s.clearActivityQueue);

  const [keyword, setSearchKeyword] = useState('');
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('all');
  const [mutualFilter, setMutualFilter] = useState<MutualFilter>('all');
  const [inactiveDays, setInactiveDays] = useState(90);
  const [enqueueMode, setEnqueueMode] =
    useState<ActivityEnqueueMode>('unchecked');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [untaggedOnly, setUntaggedOnly] = useState(false);
  /** 关注数上限（friendsCount ≤）；空表示不限 */
  const [maxFriendsCount, setMaxFriendsCount] = useState<number | null>(null);
  /** 发帖数上限（statusesCount ≤）；空表示不限 */
  const [maxStatusesCount, setMaxStatusesCount] = useState<number | null>(null);
  /** 粉丝数上限（followersCount ≤）；空表示不限 */
  const [maxFollowersCount, setMaxFollowersCount] = useState<number | null>(
    null,
  );
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const untaggedCount = useMemo(
    () => items.filter((item) => hasNoTags(item.tags)).length,
    [items],
  );

  /** 标签及对应人数，按数量降序 */
  const tagStats = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      for (const tag of item.tags ?? []) {
        if (!tag) continue;
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.tag.localeCompare(b.tag, 'zh-CN');
      });
  }, [items]);

  const allTags = useMemo(() => tagStats.map((t) => t.tag), [tagStats]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const cutoff = Date.now() - inactiveDays * 24 * 60 * 60 * 1000;

    return items.filter((item) => {
      if (activityFilter === 'unavailable' && !item.unavailable) return false;
      if (activityFilter === 'unchecked' && item.activityCheckedAt != null) {
        return false;
      }
      if (activityFilter === 'locked' && item.activityNote !== 'locked') {
        return false;
      }
      if (activityFilter === 'inactive') {
        if (item.unavailable) return false;
        if (item.activityCheckedAt == null) return false;
        if (item.activityNote === 'locked') return false;
        if (item.lastTweetAt == null) return true;
        if (item.lastTweetAt >= cutoff) return false;
      }

      if (mutualFilter === 'mutual' && !item.followedBy) return false;
      if (mutualFilter === 'non_mutual' && item.followedBy) return false;

      if (untaggedOnly) {
        if (!hasNoTags(item.tags)) return false;
      } else if (selectedTags.length > 0) {
        const tags = item.tags ?? [];
        if (!selectedTags.every((t) => tags.includes(t))) return false;
      }

      if (maxFriendsCount != null) {
        if (item.friendsCount == null || item.friendsCount > maxFriendsCount) {
          return false;
        }
      }
      if (maxStatusesCount != null) {
        if (
          item.statusesCount == null ||
          item.statusesCount > maxStatusesCount
        ) {
          return false;
        }
      }
      if (maxFollowersCount != null) {
        if (
          item.followersCount == null ||
          item.followersCount > maxFollowersCount
        ) {
          return false;
        }
      }

      if (!kw) return true;
      const hay = [
        item.name,
        item.screenName,
        item.id,
        item.description,
        item.location,
        item.url,
        item.noteName ?? '',
        item.note ?? '',
        ...(item.tags ?? []),
      ]
        .join('\n')
        .toLowerCase();
      return hay.includes(kw);
    });
  }, [
    items,
    keyword,
    activityFilter,
    mutualFilter,
    inactiveDays,
    selectedTags,
    untaggedOnly,
    maxFriendsCount,
    maxStatusesCount,
    maxFollowersCount,
  ]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize) || 1);
  const safePage = Math.min(page, totalPages);

  const paged = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, safePage, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [
    keyword,
    activityFilter,
    mutualFilter,
    inactiveDays,
    selectedTags,
    untaggedOnly,
    maxFriendsCount,
    maxStatusesCount,
    maxFollowersCount,
    pageSize,
  ]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const hasFilter =
    keyword.trim().length > 0 ||
    selectedTags.length > 0 ||
    untaggedOnly ||
    activityFilter !== 'all' ||
    mutualFilter !== 'all' ||
    maxFriendsCount != null ||
    maxStatusesCount != null ||
    maxFollowersCount != null;

  const toggleTag = (tag: string) => {
    setUntaggedOnly(false);
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  const toggleUntagged = () => {
    setUntaggedOnly((prev) => {
      const next = !prev;
      if (next) setSelectedTags([]);
      return next;
    });
  };

  const clearFilter = () => {
    setSearchKeyword('');
    setSelectedTags([]);
    setUntaggedOnly(false);
    setActivityFilter('all');
    setMutualFilter('all');
    setMaxFriendsCount(null);
    setMaxStatusesCount(null);
    setMaxFollowersCount(null);
  };

  const onFullSync = async () => {
    try {
      await syncFull();
      message.success('全量同步完成');
    } catch (err: any) {
      message.error(err?.message || '全量同步失败');
      log.error(err);
    }
  };

  const onIncrementalSync = async () => {
    try {
      await syncIncremental();
      message.success('增量同步完成');
    } catch (err: any) {
      message.error(err?.message || '增量同步失败');
      log.error(err);
    }
  };

  if (!ready) {
    return (
      <div className="flex flex-col h-screen">
        <PageHeader />
        <p className="text-gray-500 mt-6">正在加载关注数据…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      <PageHeader />
      <div className="grow overflow-auto pb-10">
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="primary" loading={syncing} onClick={onFullSync}>
              全量同步
            </Button>
            <Button loading={syncing} onClick={onIncrementalSync}>
              增量同步
            </Button>
            <Tooltip title="从队头限速拉取最近发帖时间">
              <Select
                value={enqueueMode}
                onChange={setEnqueueMode}
                className="w-36"
                options={[
                  { value: 'unchecked', label: '仅未检查' },
                  { value: 'stale', label: '过期(≥7天)' },
                  { value: 'all', label: '全部' },
                ]}
              />
            </Tooltip>
            <Button onClick={() => enqueueActivityRefresh(enqueueMode)}>
              刷新活跃度
            </Button>
            {activityRunning ? (
              <Button onClick={pauseActivityQueue}>暂停队列</Button>
            ) : (
              <Button
                onClick={() => resumeActivityQueue()}
                disabled={activityQueueRemaining === 0}
              >
                继续队列
              </Button>
            )}
            <Button
              danger
              onClick={() => clearActivityQueueFn()}
              disabled={activityQueueRemaining === 0 && !activityRunning}
            >
              清空队列
            </Button>
          </div>

          <div className="text-sm text-gray-500 flex flex-wrap gap-x-4 gap-y-1">
            <span>本地 {items.length} 人</span>
            <span>
              上次同步：
              {lastSyncAt
                ? dayjs(lastSyncAt).format('YYYY-MM-DD HH:mm:ss')
                : '从未'}
            </span>
            <span>
              上次全量：
              {lastFullSyncAt
                ? dayjs(lastFullSyncAt).format('YYYY-MM-DD HH:mm:ss')
                : '从未'}
            </span>
            {syncing && (
              <span className="inline-flex items-center gap-1 text-ant-color-primary">
                同步进行中
                <Button
                  type="link"
                  size="small"
                  className="!p-0"
                  onClick={() => setRouteById('queue-management')}
                >
                  打开队列管理
                </Button>
              </span>
            )}
            <span>
              活跃度队列：剩余 {activityQueueRemaining}
              {activityRunning ? '（运行中）' : ''}
              {activityCompletedSession > 0
                ? ` · 本会话已查 ${activityCompletedSession}`
                : ''}
            </span>
            {activityError && (
              <span className="text-ant-color-error">{activityError}</span>
            )}
          </div>

          {items.length === 0 ? (
            <p className="text-gray-500 mt-6">
              暂无关注数据。请先配置 Cookie，然后点击「全量同步」。
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Input.Search
                  allowClear
                  value={keyword}
                  onChange={(e) => setSearchKeyword(e.target.value)}
                  onSearch={setSearchKeyword}
                  placeholder="搜索名称、@、备注、标签、简介"
                  className="max-w-md"
                />
                <Select
                  value={activityFilter}
                  onChange={setActivityFilter}
                  className="w-40"
                  options={[
                    { value: 'all', label: '全部状态' },
                    { value: 'inactive', label: '不活跃' },
                    { value: 'unavailable', label: '失效' },
                    { value: 'unchecked', label: '未检查活跃度' },
                    { value: 'locked', label: '锁推无法读' },
                  ]}
                />
                <Select
                  value={mutualFilter}
                  onChange={setMutualFilter}
                  className="w-32"
                  options={[
                    { value: 'all', label: '全部关系' },
                    { value: 'mutual', label: '互关' },
                    { value: 'non_mutual', label: '非互关' },
                  ]}
                />
                {activityFilter === 'inactive' && (
                  <>
                    <span className="text-sm text-gray-500">超过</span>
                    <InputNumber
                      min={1}
                      max={3650}
                      value={inactiveDays}
                      onChange={(v) => setInactiveDays(Number(v) || 90)}
                    />
                    <span className="text-sm text-gray-500">天未发帖</span>
                  </>
                )}
                <span className="text-sm text-gray-500">
                  显示 {filtered.length} / {items.length}
                </span>
                {hasFilter && (
                  <Button type="link" className="!px-0" onClick={clearFilter}>
                    清除筛选
                  </Button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-2 text-sm text-gray-600">
                  <span className="shrink-0">关注数 ≤</span>
                  <InputNumber
                    min={0}
                    value={maxFriendsCount}
                    onChange={(v) =>
                      setMaxFriendsCount(typeof v === 'number' ? v : null)
                    }
                    placeholder="不限"
                    className="w-28"
                  />
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-gray-600">
                  <span className="shrink-0">发帖数 ≤</span>
                  <InputNumber
                    min={0}
                    value={maxStatusesCount}
                    onChange={(v) =>
                      setMaxStatusesCount(typeof v === 'number' ? v : null)
                    }
                    placeholder="不限"
                    className="w-28"
                  />
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-gray-600">
                  <span className="shrink-0">粉丝数 ≤</span>
                  <InputNumber
                    min={0}
                    value={maxFollowersCount}
                    onChange={(v) =>
                      setMaxFollowersCount(typeof v === 'number' ? v : null)
                    }
                    placeholder="不限"
                    className="w-28"
                  />
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-gray-500 shrink-0">
                  快捷标签：
                </span>
                <Tag.CheckableTag
                  checked={untaggedOnly}
                  onChange={toggleUntagged}
                >
                  无标签 ({untaggedCount})
                </Tag.CheckableTag>
                {tagStats.map(({ tag, count }) => (
                  <Tag.CheckableTag
                    key={tag}
                    checked={selectedTags.includes(tag)}
                    onChange={() => toggleTag(tag)}
                  >
                    {tag} ({count})
                  </Tag.CheckableTag>
                ))}
              </div>

              {filtered.length === 0 ? (
                <p className="text-gray-500 mt-6">无匹配用户</p>
              ) : (
                <>
                  <ul className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 list-none p-0 m-0">
                    {paged.map((item) => (
                      <li key={item.id} className="h-full">
                        <FollowingUserCard item={item} allTags={allTags} />
                      </li>
                    ))}
                  </ul>
                  <div className="mt-6 flex justify-center">
                    <Pagination
                      current={safePage}
                      pageSize={pageSize}
                      total={filtered.length}
                      showSizeChanger
                      pageSizeOptions={PAGE_SIZE_OPTIONS}
                      showQuickJumper
                      showTotal={(total, range) =>
                        `第 ${range[0]}-${range[1]} 条 / 共 ${total} 条`
                      }
                      onChange={(nextPage, nextSize) => {
                        setPage(nextPage);
                        if (nextSize !== pageSize) setPageSize(nextSize);
                      }}
                    />
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
