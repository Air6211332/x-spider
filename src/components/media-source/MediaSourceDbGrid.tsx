/* eslint-disable react/prop-types */
import { LoadingOutlined } from '@ant-design/icons';
import { App, Tag } from 'antd';
import dayjs from 'dayjs';
import * as R from 'ramda';
import React, { useCallback, useMemo } from 'react';
import MediaType from '../../enums/MediaType';
import { MsPostRecord } from '../../interfaces/MediaSource';
import { TwitterMedia } from '../../interfaces/TwitterMedia';
import {
  msMediaToTwitterMedia,
  msPostToTwitterPost,
} from '../../interfaces/MediaSource';
import { useDownloadStore } from '../../stores/download';
import { buildPostUrl } from '../../twitter/url';
import { InfiniteScroll } from '../InfiniteScroll';
import {
  GridViewItemAction,
  GridViewItemActions,
} from '../homepage/GridViewItemActions';

export interface MediaSourceDbGridProps {
  items: MsPostRecord[];
  listLoading: boolean;
  listHasMore: boolean;
  loadMore: () => Promise<boolean>;
  emptyHint?: string;
}

/** 本地库媒体预览网格（含 local_exists 标记） */
export const MediaSourceDbGrid: React.FC<MediaSourceDbGridProps> = ({
  items,
  listLoading,
  listHasMore,
  loadMore,
  emptyHint = '暂无数据，请先同步',
}) => {
  const { message } = App.useApp();
  const createDownloadTask = useDownloadStore((s) => s.createDownloadTask);

  const mediaList = useMemo(() => {
    const result: {
      media: TwitterMedia;
      post: MsPostRecord;
      localExists: boolean;
      screenName?: string;
    }[] = [];
    for (const post of items) {
      for (const m of post.medias) {
        result.push({
          media: msMediaToTwitterMedia(m),
          post,
          localExists: m.localExists,
          screenName: post.screenName,
        });
      }
    }
    return result;
  }, [items]);

  const requestFn = useCallback(async () => {
    try {
      const hasMore = await loadMore();
      return { hasMore };
    } catch (err: any) {
      message.error(err?.message || '加载失败');
      return { hasMore: false };
    }
  }, [loadMore, message]);

  return (
    <InfiniteScroll
      requestFn={requestFn}
      className="overflow-y-auto pb-10 overflow-hidden h-[inherit]"
    >
      {listLoading && items.length === 0 ? (
        <div role="status">
          <LoadingOutlined
            className="text-ant-color-primary mr-2"
            aria-hidden
          />
          加载中...
        </div>
      ) : null}
      {!listLoading && items.length === 0 && (
        <div className="text-sm text-ant-color-text-secondary text-center mt-8">
          {emptyHint}
        </div>
      )}
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-2">
        {mediaList.map((item) => {
          const { media, post, localExists, screenName } = item;
          const actionOpen: GridViewItemAction | undefined = screenName
            ? {
                name: '打开推文',
                href: buildPostUrl(screenName, post.id),
              }
            : undefined;

          async function commonDownload() {
            const twPost = msPostToTwitterPost(post);
            try {
              await createDownloadTask({
                post: twPost,
                media,
              });
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
              key={`${post.id}-${media.id}`}
              className="relative h-[12rem] overflow-hidden bg-white group"
            >
              <div className="h-full">
                <img
                  alt="推文图片"
                  src={`${media.url}?format=jpg&name=small`}
                  loading="lazy"
                  className="object-cover w-full h-full transform transition-transform group-hover:scale-105"
                />
                <div className="absolute left-1 top-1 z-10">
                  <Tag
                    color={localExists ? 'success' : 'default'}
                    className="m-0"
                  >
                    {localExists ? '已下载' : '未下载'}
                  </Tag>
                </div>
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
        {listLoading && items.length > 0 && (
          <li className="h-[15rem] flex items-center justify-center bg-white">
            <LoadingOutlined
              className="text-6xl text-ant-color-primary"
              aria-hidden
            />
          </li>
        )}
      </ul>
      {!listLoading && items.length > 0 && !listHasMore && (
        <div className="mt-4 text-sm text-ant-color-text-secondary text-center">
          列表没有更多数据了
        </div>
      )}
    </InfiniteScroll>
  );
};
