/* eslint-disable react/prop-types */
import { LoadingOutlined } from '@ant-design/icons';
import { App } from 'antd';
import dayjs from 'dayjs';
import * as R from 'ramda';
import React, { useCallback, useMemo } from 'react';
import MediaType from '../../enums/MediaType';
import { TwitterMedia } from '../../interfaces/TwitterMedia';
import { useDownloadStore } from '../../stores/download';
import { buildPostUrl } from '../../twitter/url';
import { InfiniteScroll } from '../InfiniteScroll';
import {
  GridViewItemAction,
  GridViewItemActions,
} from '../homepage/GridViewItemActions';
import { TwitterPost } from '../../interfaces/TwitterPost';

export interface MediaSourceListSnapshot {
  list?: TwitterPost[];
  loading: boolean;
  cursor: string | null;
}

export interface MediaSourcePostGridProps {
  /** 读取最新列表状态（避免闭包陈旧） */
  getSnapshot: () => MediaSourceListSnapshot;
  /** 订阅用：触发重渲染 */
  snapshot: MediaSourceListSnapshot;
  loadFirst: () => Promise<void>;
  loadMore: () => Promise<void>;
  emptyHint?: string;
}

/** 媒体源预览网格（复用主页网格交互） */
export const MediaSourcePostGrid: React.FC<MediaSourcePostGridProps> = ({
  getSnapshot,
  snapshot,
  loadFirst,
  loadMore,
  emptyHint = '暂无带媒体的内容',
}) => {
  const { message } = App.useApp();
  const createDownloadTask = useDownloadStore((s) => s.createDownloadTask);
  const { list: posts, loading, cursor } = snapshot;

  const mediaList = useMemo<
    (TwitterMedia & { postId: string; screenName?: string })[]
  >(() => {
    const result: (TwitterMedia & { postId: string; screenName?: string })[] =
      [];
    for (const postItem of posts || []) {
      for (const media of postItem.medias || []) {
        result.push({
          ...media,
          postId: postItem.id,
          screenName: postItem.user?.screenName,
        });
      }
    }
    return result;
  }, [posts]);

  const requestFn = useCallback(async () => {
    const before = getSnapshot();
    try {
      if (!before.list) {
        await loadFirst();
      } else {
        await loadMore();
      }
    } catch (err: any) {
      message.error(err?.message || '加载失败');
    }
    const after = getSnapshot();
    return {
      hasMore: !!after.cursor,
    };
  }, [getSnapshot, loadFirst, loadMore, message]);

  return (
    <InfiniteScroll
      requestFn={requestFn}
      className="overflow-y-auto pb-10 overflow-hidden h-[inherit]"
    >
      {loading && !posts ? (
        <div role="status">
          <LoadingOutlined
            className="text-ant-color-primary mr-2"
            aria-hidden
          />
          加载媒体预览中...
        </div>
      ) : (
        <div role="status" className="sr-only">
          列表加载完成
        </div>
      )}
      {!loading && posts && mediaList.length === 0 && (
        <div className="text-sm text-ant-color-text-secondary text-center mt-8">
          {emptyHint}
        </div>
      )}
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-2">
        {mediaList.map((media) => {
          const actionOpen: GridViewItemAction | undefined = media.screenName
            ? {
                name: '打开推文',
                href: buildPostUrl(media.screenName, media.postId),
              }
            : undefined;

          async function commonDownload() {
            const post = posts!.find((p) => p.id === media.postId)!;
            try {
              await createDownloadTask({ post, media });
              message.success('已添加到下载队列');
            } catch (err: any) {
              message.error(`创建下载任务失败：${err?.message}`);
            }
          }

          const actionDownload: GridViewItemAction = {
            name:
              media.type === MediaType.Video
                ? '下载视频'
                : media.type === MediaType.Gif
                  ? '下载 GIF（视频）'
                  : '下载图片',
            onClick: commonDownload,
          };

          return (
            <li
              tabIndex={0}
              key={media.id}
              className="relative h-[12rem] overflow-hidden bg-white group"
            >
              <div className="h-full">
                <img
                  alt="推文图片"
                  src={`${media.url}?format=jpg&name=small`}
                  loading="lazy"
                  className="object-cover w-full h-full transform transition-transform group-hover:scale-105"
                />
                {media.type === MediaType.Video && (
                  <span className="block absolute right-2 bottom-2 text-white bg-[rgba(0,0,0,0.6)] rounded-sm px-[0.3rem] text-sm">
                    {media.videoInfo?.duration
                      ? dayjs.duration(media.videoInfo.duration).format('mm:ss')
                      : '视频'}
                  </span>
                )}
                {media.type === MediaType.Gif && (
                  <span className="block absolute right-2 bottom-2 text-white bg-[rgba(0,0,0,0.6)] rounded-sm px-[0.3rem] text-sm">
                    GIF
                  </span>
                )}
                <div className="absolute top-0 left-0 w-full h-full bg-[rgba(0,0,0,0.7)] transition-opacity opacity-0 group-hover:opacity-100 has-[:focus]:opacity-100">
                  <GridViewItemActions
                    actions={[actionOpen, actionDownload].filter(R.isNotNil)}
                  />
                </div>
              </div>
            </li>
          );
        })}
        {loading && mediaList.length > 0 && (
          <li className="h-[15rem] flex items-center justify-center bg-white">
            <LoadingOutlined
              className="text-6xl text-ant-color-primary"
              aria-hidden
            />
          </li>
        )}
      </ul>
      {!loading && posts && !cursor && mediaList.length > 0 && (
        <div className="mt-4 text-sm text-ant-color-text-secondary text-center">
          列表没有更多数据了
        </div>
      )}
    </InfiniteScroll>
  );
};
