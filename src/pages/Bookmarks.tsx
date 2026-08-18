/* eslint-disable react/prop-types */
import { App, Button, Space } from 'antd';
import dayjs from 'dayjs';
import React, { useEffect } from 'react';
import { PageHeader } from '../components/PageHeader';
import { MediaSourceDbGrid } from '../components/media-source/MediaSourceDbGrid';
import { MediaSourceDownloadForm } from '../components/media-source/MediaSourceDownloadForm';
import { useAppStateStore } from '../stores/app-state';
import { useBookmarksStore } from '../stores/bookmarks';
import { useRouteStore } from '../stores/route';

export const Bookmarks: React.FC = () => {
  const { message } = App.useApp();
  const cookieString = useAppStateStore((s) => s.cookieString);
  const setRouteById = useRouteStore((s) => s.setRouteById);

  const ready = useBookmarksStore((s) => s.ready);
  const items = useBookmarksStore((s) => s.items);
  const totalPosts = useBookmarksStore((s) => s.totalPosts);
  const stats = useBookmarksStore((s) => s.stats);
  const lastSyncAt = useBookmarksStore((s) => s.lastSyncAt);
  const lastFullSyncAt = useBookmarksStore((s) => s.lastFullSyncAt);
  const syncing = useBookmarksStore((s) => s.syncing);
  const rechecking = useBookmarksStore((s) => s.rechecking);
  const recheckProgress = useBookmarksStore((s) => s.recheckProgress);
  const downloading = useBookmarksStore((s) => s.downloading);
  const listLoading = useBookmarksStore((s) => s.listLoading);
  const listHasMore = useBookmarksStore((s) => s.listHasMore);
  const filter = useBookmarksStore((s) => s.filter);

  const setFilter = useBookmarksStore((s) => s.setFilter);
  const ensureAccount = useBookmarksStore((s) => s.ensureAccount);
  const reloadFromDb = useBookmarksStore((s) => s.reloadFromDb);
  const loadMoreFromDb = useBookmarksStore((s) => s.loadMoreFromDb);
  const syncFull = useBookmarksStore((s) => s.syncFull);
  const syncIncremental = useBookmarksStore((s) => s.syncIncremental);
  const recheckLocalFiles = useBookmarksStore((s) => s.recheckLocalFiles);
  const downloadMissing = useBookmarksStore((s) => s.downloadMissing);

  useEffect(() => {
    if (!cookieString || !ready) return;
    ensureAccount()
      .then(() => reloadFromDb())
      .catch((err: any) => {
        const msg =
          typeof err === 'string' ? err : err?.message || '加载书签库失败';
        message.error(msg);
      });
  }, [cookieString, ready]);

  const onFullSync = async () => {
    try {
      await syncFull();
      message.success('全量同步完成');
    } catch (err: any) {
      message.error(err?.message || '全量同步失败');
    }
  };

  const onIncrementalSync = async () => {
    try {
      await syncIncremental();
      message.success('增量同步完成');
    } catch (err: any) {
      message.error(err?.message || '增量同步失败');
    }
  };

  const onRecheck = async () => {
    try {
      await recheckLocalFiles();
      message.success('文件校验完成');
    } catch (err: any) {
      message.error(err?.message || '校验失败');
    }
  };

  const onDownload = async () => {
    try {
      const n = await downloadMissing();
      if (n === 0) {
        message.info('没有需要下载的媒体');
      } else {
        message.success(`已添加 ${n} 个媒体到下载队列`);
      }
    } catch (err: any) {
      message.error(err?.message || '下载失败');
    }
  };

  const busy = syncing || rechecking || downloading;

  return (
    <div className="flex flex-col h-screen">
      <div className="shrink-0">
        <PageHeader />
        <div className="px-4 pb-2 space-y-2">
          <p className="m-0 text-sm text-ant-color-text-secondary">
            登录账号书签落库同步；按作者目录下载。改模板后请重新校验文件。
          </p>
          <Space wrap>
            <Button
              type="primary"
              disabled={!cookieString || busy}
              loading={syncing}
              onClick={onFullSync}
            >
              全量同步
            </Button>
            <Button
              disabled={!cookieString || busy}
              loading={syncing}
              onClick={onIncrementalSync}
            >
              增量同步
            </Button>
            <Button
              disabled={!cookieString || busy || totalPosts === 0}
              loading={rechecking}
              onClick={onRecheck}
            >
              重新校验文件
            </Button>
          </Space>
          <div className="text-sm text-ant-color-text-secondary space-y-1">
            <div>
              帖子 {totalPosts} · 媒体 {stats.total}（已存在 {stats.exists} /
              缺失 {stats.missing}）
            </div>
            <div>
              上次同步：
              {lastSyncAt
                ? dayjs(lastSyncAt).format('YYYY-MM-DD HH:mm:ss')
                : '从未'}
              {' · '}
              全量：
              {lastFullSyncAt
                ? dayjs(lastFullSyncAt).format('YYYY-MM-DD HH:mm:ss')
                : '从未'}
            </div>
            {syncing && (
              <div className="flex items-center gap-2 text-ant-color-primary">
                <span>同步进行中</span>
                <Button
                  type="link"
                  size="small"
                  className="!p-0"
                  onClick={() => setRouteById('queue-management')}
                >
                  打开队列管理
                </Button>
              </div>
            )}
            {(rechecking || recheckProgress.message) && (
              <div className="text-ant-color-primary">
                {recheckProgress.message}
              </div>
            )}
          </div>
          <MediaSourceDownloadForm
            filter={filter}
            onFilterChange={setFilter}
            onStartDownload={onDownload}
            startDisabled={!cookieString || busy || stats.missing === 0}
            startLoading={downloading}
            startLabel="下载未存在"
          />
        </div>
      </div>
      <section
        className="relative grow mt-2 pb-4 overflow-hidden h-full min-h-[50vh] px-4"
        aria-label="书签媒体列表"
      >
        {!cookieString ? (
          <p className="text-ant-color-text-secondary">请先登录后再查看书签</p>
        ) : (
          <MediaSourceDbGrid
            items={items}
            listLoading={listLoading}
            listHasMore={listHasMore}
            loadMore={loadMoreFromDb}
            emptyHint="暂无数据，请先全量或增量同步"
          />
        )}
      </section>
    </div>
  );
};
