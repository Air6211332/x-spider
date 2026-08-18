/* eslint-disable react/prop-types */
import { App, Button, List, Spin } from 'antd';
import React, { useCallback, useEffect } from 'react';
import { PageHeader } from '../components/PageHeader';
import { MediaSourceDownloadForm } from '../components/media-source/MediaSourceDownloadForm';
import { MediaSourcePostGrid } from '../components/media-source/MediaSourcePostGrid';
import { useAppStateStore } from '../stores/app-state';
import { useDownloadStore } from '../stores/download';
import { useXListsStore } from '../stores/x-lists';
import { buildSelfPlaceholderUser } from '../utils/media-source-user';
import dayjs from 'dayjs';

export const XLists: React.FC = () => {
  const { message } = App.useApp();
  const cookieString = useAppStateStore((s) => s.cookieString);
  const createMediaSourceTask = useDownloadStore(
    (s) => s.createMediaSourceTask,
  );
  const {
    filter,
    setFilter,
    lists,
    listsLoading,
    loadLists,
    selectedListId,
    selectList,
    postList,
    loadPostList,
    loadMorePostList,
  } = useXListsStore();

  const selectedList = lists.find((l) => l.id === selectedListId) || null;

  const getSnapshot = useCallback(() => useXListsStore.getState().postList, []);

  useEffect(() => {
    if (!cookieString) return;
    loadLists().catch((err: any) => {
      message.error(err?.message || '加载 X 列表失败');
    });
  }, [cookieString]);

  useEffect(() => {
    if (!selectedListId) return;
    loadPostList().catch((err: any) => {
      message.error(err?.message || '加载列表时间线失败');
    });
  }, [selectedListId]);

  const onStartDownload = async () => {
    if (!selectedList) {
      message.error('请先选择一个列表');
      return;
    }
    try {
      const user = await buildSelfPlaceholderUser(selectedList.name);
      createMediaSourceTask({
        kind: 'list',
        filter,
        user: {
          ...user,
          id: selectedList.id,
          name: selectedList.name,
          screenName: selectedList.name,
          registerTime: dayjs(0),
        },
        listId: selectedList.id,
        listName: selectedList.name,
      });
      message.success('已成功创建下载任务，请到下载管理页查看');
    } catch (err: any) {
      message.error(err?.message || '创建下载任务失败');
    }
  };

  return (
    <div className="flex flex-col h-screen">
      <div className="shrink-0">
        <PageHeader />
        <div className="px-4 pb-2">
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="m-0 text-sm text-ant-color-text-secondary">
              读取自己的 / 订阅的 X 列表并下载时间线媒体（与自动下载清单无关）
            </p>
            <Button
              disabled={!cookieString}
              loading={listsLoading}
              onClick={() => {
                loadLists().catch((err: any) => {
                  message.error(err?.message || '加载 X 列表失败');
                });
              }}
            >
              刷新列表
            </Button>
          </div>
        </div>
      </div>
      <div className="flex grow overflow-hidden min-h-0 px-4 pb-4 gap-4">
        <aside
          className="w-72 shrink-0 bg-white border-[1px] rounded-md overflow-y-auto"
          aria-label="X 列表"
        >
          {!cookieString ? (
            <p className="p-4 text-ant-color-text-secondary">请先登录</p>
          ) : listsLoading && lists.length === 0 ? (
            <div className="p-8 flex justify-center">
              <Spin />
            </div>
          ) : (
            <List
              size="small"
              dataSource={lists}
              locale={{ emptyText: '暂无列表' }}
              renderItem={(item) => (
                <List.Item
                  className={
                    item.id === selectedListId
                      ? '!bg-ant-color-primary-bg cursor-pointer'
                      : 'cursor-pointer hover:!bg-gray-50'
                  }
                  onClick={() => selectList(item.id)}
                >
                  <List.Item.Meta
                    title={item.name}
                    description={`${item.memberCount} 人${item.mode ? ` · ${item.mode}` : ''}`}
                  />
                </List.Item>
              )}
            />
          )}
        </aside>
        <section className="flex flex-col grow min-w-0 overflow-hidden">
          {selectedList ? (
            <>
              <MediaSourceDownloadForm
                filter={filter}
                onFilterChange={setFilter}
                onStartDownload={onStartDownload}
                startDisabled={!cookieString}
              />
              <div
                className="relative grow mt-3 overflow-hidden min-h-[40vh]"
                aria-label="列表时间线预览"
              >
                <MediaSourcePostGrid
                  snapshot={postList}
                  getSnapshot={getSnapshot}
                  loadFirst={loadPostList}
                  loadMore={loadMorePostList}
                  emptyHint="该列表时间线暂无带媒体的内容"
                />
              </div>
            </>
          ) : (
            <p className="text-ant-color-text-secondary m-0">
              请从左侧选择一个列表以预览与下载
            </p>
          )}
        </section>
      </div>
    </div>
  );
};
