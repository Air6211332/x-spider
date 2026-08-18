/* eslint-disable react/prop-types */
import clsx from 'clsx';
import React, { useEffect, useState } from 'react';

export interface QueueTabItem {
  name: string;
  count: number;
  children: React.ReactNode;
}

export interface QueueTabsProps {
  tabs: QueueTabItem[];
}

/** 队列管理页 Tabs（布局对齐下载管理） */
export const QueueTabs: React.FC<QueueTabsProps> = ({ tabs }) => {
  const [current, setCurrent] = useState(tabs[0]?.name ?? '');

  useEffect(() => {
    if (!tabs.some((t) => t.name === current) && tabs[0]) {
      setCurrent(tabs[0].name);
    }
  }, [tabs, current]);

  const panel = tabs.find((t) => t.name === current)?.children;

  return (
    <div className="h-full flex flex-col">
      <ul role="tablist" className="flex space-x-6 shrink-0">
        {tabs.map((tab) => (
          <li key={tab.name}>
            <div className="relative">
              {tab.name === current && (
                <div className="absolute w-full h-2 rounded-full bg-ant-color-primary left-0 bottom-0" />
              )}
              <button
                type="button"
                role="tab"
                aria-selected={tab.name === current}
                onClick={() => setCurrent(tab.name)}
                className={clsx(
                  'bg-transparent text-xl relative transition-colors hover:text-ant-color-primary',
                  tab.name === current && 'font-bold !text-black',
                )}
              >
                {tab.name}
                <span>({tab.count})</span>
              </button>
            </div>
          </li>
        ))}
      </ul>
      <div
        role="tabpanel"
        aria-label={current}
        className="mt-4 grow relative overflow-hidden min-h-0"
      >
        {panel}
      </div>
    </div>
  );
};
