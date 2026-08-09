/* eslint-disable react/prop-types */
import { CloseOutlined } from '@ant-design/icons';
import { Avatar, Button, Input, Select, Space, App } from 'antd';
import clsx from 'clsx';
import React, { useMemo, useRef, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { PostListGridView } from '../components/homepage/PostListGridView';
import { DownloadController } from '../components/homepage/DownloadController';
import { useAppStateStore } from '../stores/app-state';
import { useFavoritesStore } from '../stores/favorites';
import { useHomepageStore } from '../stores/homepage';
import { getUser } from '../twitter/api';
import { buildUserUrl } from '../twitter/url';

type CleanLimit = 50 | 100 | 200;

export const Homepage: React.FC = () => {
  const { message } = App.useApp();
  const {
    keyword,
    setKeyword,
    userInfo,
    clearUser,
    loadUser,
    clearPostList: clearMediaList,
  } = useHomepageStore();
  const {
    searchHistory,
    addSearchHistory,
    removeSearchHistory,
    clearSearchHistory,
    cookieString,
  } = useAppStateStore((s) => ({
    searchHistory: s.searchHistory,
    addSearchHistory: s.addSearchHistory,
    removeSearchHistory: s.removeSearchHistory,
    clearSearchHistory: s.clearSearchHistory,
    cookieString: s.cookieString,
  }));
  const removeFavoriteByScreenName = useFavoritesStore(
    (s) => s.removeFavoriteByScreenName,
  );
  const searchAbortControllerRef = useRef<AbortController>();
  const [cleaningExpired, setCleaningExpired] = useState(false);
  const [cleanLimit, setCleanLimit] = useState<CleanLimit>(50);
  const [cleanProgress, setCleanProgress] = useState<{
    current: string;
    index: number;
    total: number;
    cleaned: number;
  } | null>(null);

  const filteredSearchHistory = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return searchHistory;
    return searchHistory.filter((sn) => sn.toLowerCase().includes(kw));
  }, [searchHistory, keyword]);

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

  /** 界面倒序：最旧优先，按 cleanLimit 探查并清理失败账号 */
  const cleanExpiredHistory = async () => {
    if (cleaningExpired || searchHistory.length === 0) return;
    const queue = [...searchHistory].reverse().slice(0, cleanLimit);
    setCleaningExpired(true);
    let cleaned = 0;
    try {
      for (let i = 0; i < queue.length; i++) {
        const sn = queue[i];
        setCleanProgress({
          current: sn,
          index: i + 1,
          total: queue.length,
          cleaned,
        });
        try {
          await getUser(sn);
        } catch {
          removeSearchHistory(sn);
          removeFavoriteByScreenName(sn);
          cleaned += 1;
          setCleanProgress({
            current: sn,
            index: i + 1,
            total: queue.length,
            cleaned,
          });
        }
      }
      if (cleaned > 0) {
        message.success(`已清理 ${cleaned} 个过期账号（探查 ${queue.length} 个）`);
      } else {
        message.info(`未发现过期账号（已探查 ${queue.length} 个）`);
      }
    } finally {
      setCleaningExpired(false);
      setCleanProgress(null);
    }
  };

  const startSearch = async (sn: string) => {
    if (!sn) return;
    sn = sn.trim();
    setKeyword(sn);

    if (searchAbortControllerRef.current) {
      searchAbortControllerRef.current.abort('Another search');
    }

    clearUser();
    clearMediaList();

    try {
      await loadUser(sn);
      addSearchHistory(sn);
    } catch (err: any) {
      log.error(err);
      message.error({
        content: (
          <span className="inline-flex items-center gap-2 flex-wrap">
            <span>
              加载失败，请检查用户 ID 是否正确：
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

  return (
    <div className="flex flex-col h-screen">
      <div>
        <PageHeader />
        <div className="shrink-0">
          <section aria-label="搜索用户">
            <Space.Compact block>
              <Input
                type="search"
                allowClear
                autoComplete="search"
                disabled={userInfo.loading || !cookieString || cleaningExpired}
                onPressEnter={() => startSearch(keyword)}
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder={
                  cookieString
                    ? '请输入用户 ID，如：shiratamacaron'
                    : '请先登录后再搜索'
                }
                className="text-center"
              />
              <Button
                disabled={!keyword || !cookieString}
                loading={userInfo.loading}
                onClick={() => startSearch(keyword)}
                type="primary"
              >
                加载
              </Button>
              {userInfo.loading && (
                <span className="sr-only" role="status">
                  加载用户信息中
                </span>
              )}
            </Space.Compact>
            {searchHistory.length > 0 && (
              <section
                aria-label="搜索历史"
                className="text-sm mt-2"
                tabIndex={0}
              >
                <span className="inline-flex flex-wrap items-center gap-1">
                  搜索历史（
                  <Button
                    type="link"
                    size="small"
                    disabled={cleaningExpired}
                    onClick={clearSearchHistory}
                    className="!p-0"
                  >
                    清空
                    <span className="sr-only">历史记录</span>
                  </Button>
                  <Button
                    type="link"
                    size="small"
                    disabled={cleaningExpired || !cookieString}
                    loading={cleaningExpired}
                    onClick={cleanExpiredHistory}
                    className="!p-0"
                  >
                    清理过期
                  </Button>
                  <Select
                    size="small"
                    value={cleanLimit}
                    disabled={cleaningExpired}
                    onChange={(v) => setCleanLimit(v)}
                    className="!w-16"
                    options={[
                      { value: 50, label: '50' },
                      { value: 100, label: '100' },
                      { value: 200, label: '200' },
                    ]}
                    aria-label="清理过期探查数量"
                  />
                  ） ：
                </span>
                {cleaningExpired && cleanProgress && (
                  <p
                    className="mt-1 mb-0 text-sm text-ant-color-primary"
                    role="status"
                    aria-live="polite"
                  >
                    正在探查 @{cleanProgress.current}（{cleanProgress.index}/
                    {cleanProgress.total}），已清理 {cleanProgress.cleaned}
                  </p>
                )}
                {/* Grid 对齐；有下载配置时限约 5 行，未加载用户时不限高 */}
                {filteredSearchHistory.length === 0 ? (
                  <p className="mt-1 text-gray-400 m-0">无匹配历史</p>
                ) : (
                  <ul
                    className={clsx(
                      'mt-1 grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-x-1 gap-y-0.5 list-none m-0 p-0',
                      userInfo.data && 'max-h-[7.5rem] overflow-y-auto',
                    )}
                  >
                    {filteredSearchHistory.map((sn) => (
                      <li
                        key={sn}
                        className="group min-w-0 flex items-center"
                      >
                        <Button
                          disabled={userInfo.loading || cleaningExpired}
                          type="link"
                          size="small"
                          className="!pr-0 min-w-0 flex-1"
                          onClick={() => {
                            setKeyword(sn);
                            startSearch(sn);
                          }}
                        >
                          <span className="sr-only">搜索</span>
                          <span className="block truncate text-left">{sn}</span>
                        </Button>
                        <Button
                          type="text"
                          size="small"
                          disabled={userInfo.loading || cleaningExpired}
                          className="!px-0.5 shrink-0 opacity-0 group-hover:opacity-100 text-gray-400 hover:!text-ant-color-error"
                          aria-label={`删除历史 ${sn}`}
                          icon={<CloseOutlined className="text-xs" />}
                          onClick={(e) => {
                            e.stopPropagation();
                            removeSearchHistory(sn);
                          }}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </section>
          {userInfo.data && (
            <>
              <DownloadController />
              <section
                aria-label="用户信息"
                className="bg-white border-[1px] border-gray-300 rounded-md mt-4"
              >
                <span className="sr-only" role="status">
                  用户信息加载完成，当前搜索用户：
                  {userInfo.data.name || '未知用户'}
                </span>
                <a
                  title="跳转到主页"
                  className="flex items-center p-4 focus:outline !outline-4 !outline-cyan-200"
                  href={
                    userInfo.data.screenName
                      ? buildUserUrl(userInfo.data.screenName)
                      : 'javascript:void(0);'
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  <div>
                    <Avatar src={userInfo.data.avatar} size={50} alt="头像" />
                  </div>
                  <div className="ml-2">
                    <p>
                      {userInfo.data.name || '未知用户'}
                      <span className="text-gray-400">
                        （共 {userInfo.data.mediaCount || 0} 个媒体）
                      </span>
                    </p>
                    {userInfo.data.screenName ? (
                      <p className="text-ant-color-text-secondary text-sm mt-1">
                        @{userInfo.data.screenName}
                      </p>
                    ) : undefined}
                  </div>
                </a>
              </section>
            </>
          )}
        </div>
      </div>
      {userInfo.data && (
        <section
          className="relative grow mt-4 pb-4 overflow-hidden h-full min-h-[50vh]"
          aria-label="内容预览"
        >
          <PostListGridView />
        </section>
      )}
    </div>
  );
};
