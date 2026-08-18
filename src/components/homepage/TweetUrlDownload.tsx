/* eslint-disable react/prop-types */
import { App, Button, Input, Space } from 'antd';
import React, { useState } from 'react';
import MediaType from '../../enums/MediaType';
import { useAppStateStore } from '../../stores/app-state';
import { useDownloadStore } from '../../stores/download';
import { useRouteStore } from '../../stores/route';
import { getTweetDetail, parseTweetIdFromUrl } from '../../twitter/api';

/** 主页：粘贴推文链接，解析会话媒体并加入下载队列 */
export const TweetUrlDownload: React.FC = () => {
  const { message } = App.useApp();
  const cookieString = useAppStateStore((s) => s.cookieString);
  const batchCreateDownloadTask = useDownloadStore(
    (s) => s.batchCreateDownloadTask,
  );
  const setRouteById = useRouteStore((s) => s.setRouteById);
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);

  const onDownload = async () => {
    const tweetId = parseTweetIdFromUrl(url);
    if (!tweetId) {
      message.error('无效的推文链接，请粘贴含 status/数字ID 的链接');
      return;
    }
    if (!cookieString) {
      message.error('请先登录（配置 Cookie）');
      return;
    }

    setLoading(true);
    try {
      const { twitterPosts } = await getTweetDetail(tweetId);
      const withMedia = twitterPosts.filter(
        (p) => p.medias && p.medias.length > 0,
      );
      if (withMedia.length === 0) {
        message.warning('该线程中未找到可下载的媒体');
        return;
      }

      const paramsList = withMedia.flatMap((post) =>
        (post.medias || [])
          .filter((m) =>
            [MediaType.Photo, MediaType.Video, MediaType.Gif].includes(m.type),
          )
          .map((media) => ({ post, media })),
      );

      if (paramsList.length === 0) {
        message.warning('该线程中未找到可下载的媒体');
        return;
      }

      await batchCreateDownloadTask(paramsList);
      message.success(
        `已添加 ${paramsList.length} 个媒体到下载队列，正在前往下载管理`,
      );
      setUrl('');
      setRouteById('download-management');
    } catch (err: any) {
      message.error(
        err?.message || '解析推文失败（链接无效、未登录或触发限流）',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <section
      className="p-4 bg-white rounded-md mt-3 border-[1px]"
      aria-label="推文链接下载"
    >
      <h2 className="font-bold mb-3">推文链接下载</h2>
      <p className="text-sm text-ant-color-text-secondary mb-3 m-0">
        粘贴推文链接，下载该会话线程中的媒体
      </p>
      <Space.Compact block>
        <Input
          allowClear
          value={url}
          disabled={!cookieString || loading}
          onChange={(e) => setUrl(e.target.value)}
          onPressEnter={onDownload}
          placeholder="例如：https://x.com/user/status/1234567890"
        />
        <Button
          type="primary"
          loading={loading}
          disabled={!url.trim() || !cookieString}
          onClick={onDownload}
        >
          下载线程媒体
        </Button>
      </Space.Compact>
    </section>
  );
};
