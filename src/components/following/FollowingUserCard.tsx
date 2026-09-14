/* eslint-disable react/prop-types */
import {
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  HomeOutlined,
  StarOutlined,
  UserDeleteOutlined,
} from '@ant-design/icons';
import { App, Button, Input, Modal, Select, Space, Tag } from 'antd';
import dayjs from 'dayjs';
import React, { useEffect, useState } from 'react';
import { AddToAutoDownloadListButton } from '../auto-download/AddToAutoDownloadListButton';
import { CachedAvatar } from '../CachedAvatar';
import { FollowingUser } from '../../interfaces/FollowingUser';
import { TwitterUser } from '../../interfaces/TwitterUser';
import { useAppStateStore } from '../../stores/app-state';
import { useDownloadStore } from '../../stores/download';
import { useFavoritesStore } from '../../stores/favorites';
import { useFollowingStore } from '../../stores/following';
import { useHomepageStore } from '../../stores/homepage';
import { useRouteStore } from '../../stores/route';
import { buildUserUrl } from '../../twitter/url';

export interface FollowingUserCardProps {
  item: FollowingUser;
  /** 全局已有标签，用于编辑时联想 */
  allTags?: string[];
}

function followingToTwitterUser(item: FollowingUser): TwitterUser {
  return {
    id: item.id,
    screenName: item.screenName,
    name: item.name,
    avatar: item.avatar,
    mediaCount: item.mediaCount ?? undefined,
    registerTime: item.registerTime ? dayjs(item.registerTime) : dayjs(),
  };
}

function formatLastTweet(item: FollowingUser): string {
  if (item.unavailable) return '失效';
  if (item.activityCheckedAt == null) return '未检查';
  if (item.activityNote === 'locked') return '锁推/无法读取';
  if (item.lastTweetAt == null) return '无帖文';
  return dayjs(item.lastTweetAt).format('YYYY-MM-DD HH:mm');
}

export const FollowingUserCard: React.FC<FollowingUserCardProps> = ({
  item,
  allTags = [],
}) => {
  const { message, modal } = App.useApp();
  const removeFollowing = useFollowingStore((s) => s.removeFollowing);
  const unfollowAndRemove = useFollowingStore((s) => s.unfollowAndRemove);
  const updateFollowingMeta = useFollowingStore((s) => s.updateFollowingMeta);
  const addFavorite = useFavoritesStore((s) => s.addFavorite);
  const isFavorite = useFavoritesStore((s) => s.isFavorite(item.id));
  const removeSearchHistory = useAppStateStore((s) => s.removeSearchHistory);
  const createCreationTask = useDownloadStore((s) => s.createCreationTask);
  const { filter, loadUser, clearUser, clearPostList, setKeyword } =
    useHomepageStore((s) => ({
      filter: s.filter,
      loadUser: s.loadUser,
      clearUser: s.clearUser,
      clearPostList: s.clearPostList,
      setKeyword: s.setKeyword,
    }));
  const setRouteById = useRouteStore((s) => s.setRouteById);

  const [editOpen, setEditOpen] = useState(false);
  const [unfollowing, setUnfollowing] = useState(false);
  const [noteNameDraft, setNoteNameDraft] = useState(item.noteName ?? '');
  const [noteDraft, setNoteDraft] = useState(item.note ?? '');
  const [tagsDraft, setTagsDraft] = useState<string[]>(item.tags ?? []);

  useEffect(() => {
    if (editOpen) {
      setNoteNameDraft(item.noteName ?? '');
      setNoteDraft(item.note ?? '');
      setTagsDraft(item.tags ?? []);
    }
  }, [editOpen, item.noteName, item.note, item.tags]);

  const cleanFailedId = (sn: string) => {
    removeSearchHistory(sn);
    const current = useHomepageStore.getState().keyword.trim();
    if (current.toLowerCase() === sn.toLowerCase()) {
      setKeyword('');
    }
    message.destroy();
    message.success('已清理该 ID');
  };

  const goHomeAndLoad = async () => {
    if (!item.screenName) {
      message.warning('该账号无 screenName，无法打开');
      return;
    }
    setRouteById('home');
    setKeyword(item.screenName);
    clearUser();
    clearPostList();
    try {
      await loadUser(item.screenName);
      message.success('已加载到主页');
    } catch (err: any) {
      log.error(err);
      const sn = item.screenName;
      message.error({
        content: (
          <span className="inline-flex items-center gap-2 flex-wrap">
            <span>
              加载失败，请检查用户是否有效：
              <span className="font-medium">@{sn}</span>
            </span>
            <Button
              type="link"
              size="small"
              className="!p-0"
              onClick={() => cleanFailedId(sn)}
            >
              清理 @{sn}
            </Button>
          </span>
        ),
        duration: 8,
      });
    }
  };

  const onStartDownload = (mode: 'full' | 'incremental') => {
    if (!item.screenName || item.unavailable) {
      message.warning('无法为该账号创建下载任务');
      return;
    }
    if (!filter.mediaTypes || filter.mediaTypes.length === 0) {
      message.error('请至少选择一个媒体类型（可在主页下载配置中设置）');
      return;
    }
    try {
      createCreationTask(followingToTwitterUser(item), filter, mode);
      message.success(
        mode === 'incremental'
          ? '已成功创建增量下载任务，请到下载管理页查看'
          : '已成功创建全量下载任务，请到下载管理页查看',
      );
    } catch (err: any) {
      log.error(err);
      message.error('创建下载任务失败');
    }
  };

  const onAddFavorite = () => {
    if (!item.screenName || item.unavailable) {
      message.warning('无法收藏该账号');
      return;
    }
    addFavorite(followingToTwitterUser(item));
    message.success('已加入收藏');
  };

  const onRemove = () => {
    modal.confirm({
      title: '仅从本地关注列表删除？',
      content:
        '仅删除本机记录，不会在 X 上取消关注。下次全量同步时若仍关注则会再次出现。',
      okText: '仅本地删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        await removeFollowing(item.id);
        message.success('已从本地列表删除');
      },
    });
  };

  const onUnfollowAndRemove = () => {
    if (!item.id) {
      message.warning('缺少用户 ID，无法取消关注');
      return;
    }
    modal.confirm({
      title: '取消关注并删除？',
      content:
        '将在 X 上取消关注该账号，并删除本机记录。此操作不可轻易撤销，请确认。',
      okText: '取消关注并删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        setUnfollowing(true);
        try {
          await unfollowAndRemove(item.id);
          message.success('已取消关注并从本地删除');
        } catch (err: any) {
          log.error(err);
          message.error(err?.message || '取消关注失败，本地记录未删除');
          throw err;
        } finally {
          setUnfollowing(false);
        }
      },
    });
  };

  const onSaveMeta = async () => {
    const tags = tagsDraft
      .map((t) => t.trim())
      .filter(Boolean)
      .filter((t, i, arr) => arr.indexOf(t) === i);
    await updateFollowingMeta(item.id, {
      noteName: noteNameDraft.trim(),
      note: noteDraft.trim(),
      tags,
    });
    setEditOpen(false);
    message.success('已保存备注与标签');
  };

  const tagOptions = allTags.map((t) => ({ label: t, value: t }));
  const titleText = item.noteName
    ? `${item.noteName}(${item.name || '(无名称)'})`
    : item.name || '(无名称)';

  return (
    <article className="h-full p-4 bg-white border rounded-md flex flex-col gap-3">
      <div className="grow flex flex-col gap-3 min-h-0">
        <div className="flex items-center gap-3 min-w-0">
          <CachedAvatar
            screenName={item.screenName}
            src={item.avatar}
            size={48}
          />
          <div className="min-w-0 grow">
            <div className="flex items-center gap-2 min-w-0">
              <div className="font-medium truncate">{titleText}</div>
              {item.protected && <Tag className="shrink-0">锁推</Tag>}
              {item.unavailable && (
                <Tag color="error" className="shrink-0">
                  失效
                </Tag>
              )}
              {item.followedBy && (
                <Tag color="blue" className="shrink-0">
                  互关
                </Tag>
              )}
            </div>
            {item.screenName ? (
              <a
                href={buildUserUrl(item.screenName)}
                target="_blank"
                rel="noreferrer"
                title="跳转到主页"
                className="text-ant-color-primary hover:underline truncate block"
              >
                @{item.screenName}
              </a>
            ) : (
              <div className="text-sm text-gray-500 truncate">@{item.id}</div>
            )}
          </div>
        </div>
        <dl className="text-sm text-gray-600 space-y-1 m-0">
          <div className="flex gap-2 flex-wrap">
            <span>
              关注 {item.friendsCount != null ? item.friendsCount : '-'}
            </span>
            <span className="text-gray-300">·</span>
            <span>
              发帖 {item.statusesCount != null ? item.statusesCount : '-'}
            </span>
            <span className="text-gray-300">·</span>
            <span>
              粉丝 {item.followersCount != null ? item.followersCount : '-'}
            </span>
          </div>
          <div className="flex gap-2">
            <dt className="shrink-0 text-gray-400">最近发帖</dt>
            <dd className="m-0">{formatLastTweet(item)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="shrink-0 text-gray-400">备注</dt>
            <dd className="m-0 break-words">
              {item.note ? (
                item.note
              ) : (
                <span className="text-gray-400">无备注</span>
              )}
            </dd>
          </div>
          <div className="flex gap-2 items-start">
            <dt className="shrink-0 text-gray-400 pt-0.5">标签</dt>
            <dd className="m-0 flex flex-wrap gap-1">
              {(item.tags ?? []).length > 0 ? (
                item.tags.map((tag) => (
                  <Tag key={tag} className="m-0">
                    {tag}
                  </Tag>
                ))
              ) : (
                <span className="text-gray-400">无标签</span>
              )}
            </dd>
          </div>
          {item.description?.trim() ? (
            <div className="flex gap-2 items-start">
              <dt className="shrink-0 text-gray-400 pt-0.5">简介</dt>
              <dd className="m-0 break-words max-h-24 overflow-y-auto grow">
                {item.description}
              </dd>
            </div>
          ) : null}
        </dl>
      </div>
      <Space wrap size="small" className="mt-auto shrink-0 pt-1">
        <Button
          size="small"
          icon={<EditOutlined />}
          onClick={() => setEditOpen(true)}
        >
          备注/标签
        </Button>
        <Button
          size="small"
          icon={<StarOutlined />}
          type={isFavorite ? 'default' : 'primary'}
          disabled={isFavorite || item.unavailable || !item.screenName}
          onClick={onAddFavorite}
        >
          {isFavorite ? '已收藏' : '收藏'}
        </Button>
        <AddToAutoDownloadListButton
          size="small"
          label="清单"
          user={followingToTwitterUser(item)}
          disabled={item.unavailable || !item.screenName}
        />
        <Button
          size="small"
          icon={<HomeOutlined />}
          disabled={!item.screenName}
          onClick={goHomeAndLoad}
        >
          主页
        </Button>
        <Button
          size="small"
          type="primary"
          icon={<DownloadOutlined />}
          disabled={item.unavailable || !item.screenName}
          onClick={() => onStartDownload('incremental')}
        >
          增量下载
        </Button>
        <Button
          size="small"
          icon={<DownloadOutlined />}
          disabled={item.unavailable || !item.screenName}
          onClick={() => onStartDownload('full')}
        >
          全量下载
        </Button>
        <Button
          size="small"
          danger
          icon={<UserDeleteOutlined />}
          loading={unfollowing}
          disabled={!item.id || unfollowing}
          onClick={onUnfollowAndRemove}
        >
          取关删除
        </Button>
        <Button
          size="small"
          danger
          icon={<DeleteOutlined />}
          disabled={unfollowing}
          onClick={onRemove}
        >
          仅删除
        </Button>
      </Space>

      <Modal
        title="编辑备注与标签"
        open={editOpen}
        onOk={onSaveMeta}
        onCancel={() => setEditOpen(false)}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <div className="space-y-4 pt-2">
          <div>
            <div className="mb-1 text-sm text-gray-600">备注名</div>
            <Input
              value={noteNameDraft}
              onChange={(e) => setNoteNameDraft(e.target.value)}
              placeholder="填写后标题显示为：备注名(账号名称)"
              maxLength={50}
              allowClear
            />
          </div>
          <div>
            <div className="mb-1 text-sm text-gray-600">备注</div>
            <Input.TextArea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              rows={3}
              placeholder="填写备注，便于搜索"
              maxLength={500}
              showCount
            />
          </div>
          <div>
            <div className="mb-1 text-sm text-gray-600">标签</div>
            <Select
              mode="tags"
              className="w-full"
              value={tagsDraft}
              onChange={setTagsDraft}
              options={tagOptions}
              placeholder="输入后回车添加标签"
              tokenSeparators={[',', '，']}
            />
          </div>
        </div>
      </Modal>
    </article>
  );
};
