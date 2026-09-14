/* eslint-disable react/prop-types */
import { CloseOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { App, Button, Input, Space, Tag } from 'antd';
import React, { useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import {
  memberToTwitterUser,
  useAutoDownloadStore,
} from '../stores/auto-download';
import { useDownloadStore } from '../stores/download';
import { useFavoritesStore } from '../stores/favorites';
import { useHomepageStore } from '../stores/homepage';

export const AutoDownload: React.FC = () => {
  const { message } = App.useApp();
  const [titleDraft, setTitleDraft] = useState('');
  const lists = useAutoDownloadStore((s) => s.lists);
  const createList = useAutoDownloadStore((s) => s.createList);
  const removeList = useAutoDownloadStore((s) => s.removeList);
  const removeMember = useAutoDownloadStore((s) => s.removeMember);
  const createCreationTask = useDownloadStore((s) => s.createCreationTask);
  const filter = useHomepageStore((s) => s.filter);
  const favorites = useFavoritesStore((s) => s.items);

  const displayName = (memberId: string, fallbackName: string) => {
    const fav = favorites.find((f) => f.id === memberId);
    if (fav?.noteName) return `${fav.noteName}(${fav.name || fallbackName})`;
    return fallbackName || '未知用户';
  };

  const onCreateList = () => {
    const id = createList(titleDraft);
    if (!id) {
      message.warning('请输入清单标题');
      return;
    }
    setTitleDraft('');
    message.success('已新增清单');
  };

  const onBatchDownload = (listId: string, mode: 'full' | 'incremental') => {
    const list = lists.find((l) => l.id === listId);
    if (!list) return;
    if (!list.members.length) {
      message.warning('清单内暂无账号');
      return;
    }
    if (!filter.mediaTypes || filter.mediaTypes.length === 0) {
      message.error('请至少选择一个媒体类型（可在主页下载配置中设置）');
      return;
    }
    for (const member of list.members) {
      createCreationTask(memberToTwitterUser(member), filter, mode);
    }
    message.success(
      mode === 'incremental'
        ? `已为 ${list.members.length} 个账号创建增量下载任务`
        : `已为 ${list.members.length} 个账号创建全量下载任务`,
    );
  };

  return (
    <div className="flex flex-col h-screen">
      <PageHeader />
      <div className="grow overflow-auto pb-10">
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Input
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onPressEnter={onCreateList}
            placeholder="输入清单标题"
            className="max-w-xs"
            maxLength={40}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={onCreateList}>
            新增清单
          </Button>
        </div>

        {lists.length === 0 ? (
          <p className="text-gray-500 mt-6">
            暂无清单。创建后可在主页或「我的收藏」将账号添加到清单。
          </p>
        ) : (
          <ul className="mt-4 space-y-4 list-none p-0 m-0">
            {lists.map((list) => (
              <li
                key={list.id}
                className="p-4 bg-white border rounded-md space-y-3"
              >
                <div className="flex flex-wrap items-center gap-2 justify-between">
                  <h2 className="text-base font-medium m-0">{list.title}</h2>
                  <Space wrap size="small">
                    <Button
                      type="primary"
                      size="small"
                      disabled={list.members.length === 0}
                      onClick={() => onBatchDownload(list.id, 'incremental')}
                    >
                      增量下载
                    </Button>
                    <Button
                      size="small"
                      disabled={list.members.length === 0}
                      onClick={() => onBatchDownload(list.id, 'full')}
                    >
                      全量下载
                    </Button>
                    <Button
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => {
                        removeList(list.id);
                        message.success('已删除清单');
                      }}
                    >
                      删除清单
                    </Button>
                  </Space>
                </div>

                {list.members.length === 0 ? (
                  <p className="text-gray-400 text-sm m-0">
                    清单为空，请从主页或收藏添加账号。
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {list.members.map((member) => (
                      <Tag
                        key={member.id}
                        className="!m-0 !inline-flex items-center gap-1 !py-1 !px-2"
                      >
                        <span className="max-w-[12rem] truncate">
                          {displayName(member.id, member.name)}
                          <span className="text-gray-400 ml-1">
                            @{member.screenName}
                          </span>
                        </span>
                        <Button
                          type="text"
                          size="small"
                          className="!w-5 !h-5 !min-w-0 !p-0 text-gray-400 hover:!text-ant-color-error"
                          icon={<CloseOutlined className="text-xs" />}
                          aria-label={`从清单移除 ${member.screenName}`}
                          onClick={() => removeMember(list.id, member.id)}
                        />
                      </Tag>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
