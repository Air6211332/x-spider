/* eslint-disable react/prop-types */
import {
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  HomeOutlined,
} from '@ant-design/icons';
import { App, Button, Input, Modal, Select, Space, Tag } from 'antd';
import dayjs from 'dayjs';
import React, { useEffect, useState } from 'react';
import { AddToAutoDownloadListButton } from '../auto-download/AddToAutoDownloadListButton';
import { CachedAvatar } from '../CachedAvatar';
import { FavoriteUser } from '../../interfaces/FavoriteUser';
import { useAppStateStore } from '../../stores/app-state';
import { useDownloadStore } from '../../stores/download';
import {
  favoriteToTwitterUser,
  useFavoritesStore,
} from '../../stores/favorites';
import { useHomepageStore } from '../../stores/homepage';
import { useRouteStore } from '../../stores/route';
import { buildUserUrl } from '../../twitter/url';

export interface FavoriteUserCardProps {
  item: FavoriteUser;
  /** 全局已有标签，用于编辑时联想 */
  allTags?: string[];
}

export const FavoriteUserCard: React.FC<FavoriteUserCardProps> = ({
  item,
  allTags = [],
}) => {
  const { message } = App.useApp();
  const removeFavorite = useFavoritesStore((s) => s.removeFavorite);
  const removeFavoriteByScreenName = useFavoritesStore(
    (s) => s.removeFavoriteByScreenName,
  );
  const updateFavoriteMeta = useFavoritesStore((s) => s.updateFavoriteMeta);
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

  const lastStartedText = item.lastStartedAt
    ? dayjs(item.lastStartedAt).format('YYYY-MM-DD HH:mm:ss')
    : '从未开始';

  const cleanFailedId = (sn: string) => {
    removeSearchHistory(sn);
    removeFavoriteByScreenName(sn);
    const current = useHomepageStore.getState().keyword.trim();
    if (current.toLowerCase() === sn.toLowerCase()) {
      setKeyword('');
    }
    message.destroy();
    message.success('已清理该 ID');
  };

  const goHomeAndLoad = async () => {
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
    if (!filter.mediaTypes || filter.mediaTypes.length === 0) {
      message.error('请至少选择一个媒体类型（可在主页下载配置中设置）');
      return;
    }
    try {
      createCreationTask(favoriteToTwitterUser(item), filter, mode);
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

  const onRemove = () => {
    removeFavorite(item.id);
    message.success('已取消收藏');
  };

  const onSaveMeta = () => {
    const tags = tagsDraft
      .map((t) => t.trim())
      .filter(Boolean)
      .filter((t, i, arr) => arr.indexOf(t) === i);
    updateFavoriteMeta(item.id, {
      noteName: noteNameDraft.trim(),
      note: noteDraft.trim(),
      tags,
    });
    setEditOpen(false);
    message.success('已保存备注与标签');
  };

  const tagOptions = allTags.map((t) => ({ label: t, value: t }));
  const titleText = item.noteName
    ? `${item.noteName}(${item.name})`
    : item.name;

  return (
    <article className="p-4 bg-white border rounded-md flex flex-col gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <CachedAvatar
          screenName={item.screenName}
          src={item.avatar}
          size={48}
        />
        <div className="min-w-0 grow">
          <div className="font-medium truncate">{titleText}</div>
          <a
            href={buildUserUrl(item.screenName)}
            target="_blank"
            rel="noreferrer"
            title="跳转到主页"
            className="text-ant-color-primary hover:underline truncate block"
          >
            @{item.screenName}
          </a>
        </div>
      </div>
      <dl className="text-sm text-gray-600 space-y-1 m-0">
        <div className="flex gap-2">
          <dt className="shrink-0 text-gray-400">最后开始</dt>
          <dd className="m-0">{lastStartedText}</dd>
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
      </dl>
      <Space wrap size="small">
        <Button
          size="small"
          icon={<EditOutlined />}
          onClick={() => setEditOpen(true)}
        >
          备注/标签
        </Button>
        <AddToAutoDownloadListButton
          size="small"
          user={favoriteToTwitterUser(item)}
        />
        <Button size="small" icon={<HomeOutlined />} onClick={goHomeAndLoad}>
          加载到主页
        </Button>
        <Button
          size="small"
          type="primary"
          icon={<DownloadOutlined />}
          onClick={() => onStartDownload('incremental')}
        >
          增量下载
        </Button>
        <Button
          size="small"
          icon={<DownloadOutlined />}
          onClick={() => onStartDownload('full')}
        >
          全量下载
        </Button>
        <Button
          size="small"
          danger
          icon={<DeleteOutlined />}
          onClick={onRemove}
        >
          取消收藏
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
