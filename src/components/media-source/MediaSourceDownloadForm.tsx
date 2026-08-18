/* eslint-disable react/prop-types */
import { App, Button, Checkbox, DatePicker, Form, Space } from 'antd';
import dayjs from 'dayjs';
import React from 'react';
import MediaType from '../../enums/MediaType';
import { DownloadFilter } from '../../interfaces/DownloadFilter';

export interface MediaSourceDownloadFormProps {
  filter: DownloadFilter;
  onFilterChange: (filter: DownloadFilter) => void;
  onStartDownload: () => void;
  startDisabled?: boolean;
  startLoading?: boolean;
  /** 主按钮文案，默认「开始下载」 */
  startLabel?: string;
}

/** 书签 / 喜欢 / 列表共用：日期 + 媒体类型（无帖子/媒体源切换） */
export const MediaSourceDownloadForm: React.FC<
  MediaSourceDownloadFormProps
> = ({
  filter,
  onFilterChange,
  onStartDownload,
  startDisabled,
  startLoading,
  startLabel = '开始下载',
}) => {
  const { message } = App.useApp();

  const handleStart = () => {
    if (!filter.mediaTypes || filter.mediaTypes.length === 0) {
      message.error('请至少选择一个媒体类型');
      return;
    }
    onStartDownload();
  };

  return (
    <section className="p-4 bg-white rounded-md mt-3 border-[1px]">
      <h2 className="font-bold mb-4">下载配置</h2>
      <Form<DownloadFilter>
        layout="inline"
        initialValues={filter}
        onValuesChange={(_, values) => {
          onFilterChange({ ...values, source: 'tweets' });
        }}
      >
        <Form.Item name="dateRange" label="日期范围">
          <DatePicker.RangePicker
            presets={[
              { label: '至今', value: [dayjs.unix(0), dayjs()] },
              {
                label: '最近 7 天',
                value: [dayjs().subtract(7, 'day'), dayjs()],
              },
              {
                label: '最近 15 天',
                value: [dayjs().subtract(15, 'day'), dayjs()],
              },
              {
                label: '最近 1 个月',
                value: [dayjs().subtract(1, 'month'), dayjs()],
              },
              {
                label: '最近 6 个月',
                value: [dayjs().subtract(6, 'month'), dayjs()],
              },
              {
                label: '最近 1 年',
                value: [dayjs().subtract(1, 'year'), dayjs()],
              },
            ]}
            disabledDate={(cur) => cur && cur > dayjs().endOf('day')}
          />
        </Form.Item>
        <Form.Item name="mediaTypes" label="媒体类型">
          <Checkbox.Group
            options={[
              { label: '视频', value: MediaType.Video },
              { label: '照片', value: MediaType.Photo },
              { label: 'GIF', value: MediaType.Gif },
            ]}
          />
        </Form.Item>
      </Form>
      <hr className="my-4" />
      <Button
        type="primary"
        disabled={startDisabled}
        loading={startLoading}
        onClick={handleStart}
      >
        <Space>
          <span>{startLabel}</span>
        </Space>
      </Button>
    </section>
  );
};
