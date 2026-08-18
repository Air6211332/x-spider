/* eslint-disable react/prop-types */
import { UnorderedListOutlined } from '@ant-design/icons';
import { App, Button, Checkbox, Popover, Space } from 'antd';
import React, { useEffect, useState } from 'react';
import { TwitterUser } from '../../interfaces/TwitterUser';
import { useAutoDownloadStore } from '../../stores/auto-download';
import { useRouteStore } from '../../stores/route';

export interface AddToAutoDownloadListButtonProps {
  user?: TwitterUser;
  disabled?: boolean;
  size?: 'small' | 'middle' | 'large';
  /** 按钮文案，默认「添加到清单」 */
  label?: string;
}

export const AddToAutoDownloadListButton: React.FC<
  AddToAutoDownloadListButtonProps
> = ({ user, disabled, size = 'small', label = '添加到清单' }) => {
  const { message } = App.useApp();
  const lists = useAutoDownloadStore((s) => s.lists);
  const addMemberToLists = useAutoDownloadStore((s) => s.addMemberToLists);
  const setRouteById = useRouteStore((s) => s.setRouteById);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setSelected([]);
    }
  }, [open, user?.id]);

  const onConfirm = () => {
    if (!user) return;
    if (selected.length === 0) {
      message.warning('请至少选择一个清单');
      return;
    }
    addMemberToLists(selected, user);
    setOpen(false);
    message.success(`已添加到 ${selected.length} 个清单`);
  };

  const content =
    lists.length === 0 ? (
      <div className="max-w-xs space-y-2">
        <p className="m-0 text-sm text-gray-600">暂无清单，请先创建。</p>
        <Button
          type="link"
          size="small"
          className="!p-0"
          onClick={() => {
            setOpen(false);
            setRouteById('auto-download');
          }}
        >
          前往自动下载页
        </Button>
      </div>
    ) : (
      <div className="min-w-[200px] max-w-xs space-y-3">
        <Checkbox.Group
          className="flex flex-col gap-2"
          value={selected}
          onChange={(values) => setSelected(values as string[])}
          options={lists.map((l) => ({
            label: `${l.title}（${l.members.length}）`,
            value: l.id,
          }))}
        />
        <Space>
          <Button size="small" type="primary" onClick={onConfirm}>
            确定
          </Button>
          <Button size="small" onClick={() => setOpen(false)}>
            取消
          </Button>
        </Space>
      </div>
    );

  return (
    <Popover
      content={content}
      title="添加到自动下载清单"
      trigger="click"
      open={open}
      onOpenChange={setOpen}
      placement="bottomLeft"
    >
      <Button
        size={size}
        disabled={disabled || !user}
        icon={<UnorderedListOutlined />}
      >
        {label}
      </Button>
    </Popover>
  );
};
