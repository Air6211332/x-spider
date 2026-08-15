/* eslint-disable react/prop-types */
import { Button, Input, Tag } from 'antd';
import React, { useMemo, useState } from 'react';
import { FavoriteUserCard } from '../components/favorites/FavoriteUserCard';
import { PageHeader } from '../components/PageHeader';
import { useFavoritesStore } from '../stores/favorites';

function hasNoTags(tags?: string[]) {
  return !tags || tags.length === 0;
}

export const Favorites: React.FC = () => {
  const items = useFavoritesStore((s) => s.items);
  const [keyword, setKeyword] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [untaggedOnly, setUntaggedOnly] = useState(false);

  const untaggedCount = useMemo(
    () => items.filter((item) => hasNoTags(item.tags)).length,
    [items],
  );

  /** 标签及对应收藏数量，按数量降序 */
  const tagStats = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      for (const tag of item.tags ?? []) {
        if (!tag) continue;
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.tag.localeCompare(b.tag, 'zh-CN');
      });
  }, [items]);

  const allTags = useMemo(() => tagStats.map((t) => t.tag), [tagStats]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return items.filter((item) => {
      if (untaggedOnly) {
        if (!hasNoTags(item.tags)) return false;
      } else if (selectedTags.length > 0) {
        const tags = item.tags ?? [];
        if (!selectedTags.every((t) => tags.includes(t))) return false;
      }
      if (!kw) return true;
      const haystack = [
        item.name,
        item.screenName,
        item.id,
        item.noteName ?? '',
        item.note ?? '',
      ]
        .join('\n')
        .toLowerCase();
      return haystack.includes(kw);
    });
  }, [items, keyword, selectedTags, untaggedOnly]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => b.favoritedAt - a.favoritedAt);
  }, [filtered]);

  const hasFilter =
    keyword.trim().length > 0 || selectedTags.length > 0 || untaggedOnly;

  const toggleTag = (tag: string) => {
    setUntaggedOnly(false);
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  const toggleUntagged = () => {
    setUntaggedOnly((prev) => {
      const next = !prev;
      if (next) setSelectedTags([]);
      return next;
    });
  };

  const clearFilter = () => {
    setKeyword('');
    setSelectedTags([]);
    setUntaggedOnly(false);
  };

  return (
    <div className="flex flex-col h-screen">
      <PageHeader />
      <div className="grow overflow-auto pb-10">
        {items.length === 0 ? (
          <p className="text-gray-500 mt-6">
            暂无收藏。可在主页加载用户后，点击「开始下载」右侧的「收藏」按钮添加。
          </p>
        ) : (
          <>
            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Input.Search
                  allowClear
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  onSearch={setKeyword}
                  placeholder="搜索名称、ID、备注"
                  className="max-w-md"
                />
                {hasFilter && (
                  <Button type="link" className="!px-0" onClick={clearFilter}>
                    清除筛选
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-gray-500 shrink-0">
                  快捷标签：
                </span>
                <Tag.CheckableTag
                  checked={untaggedOnly}
                  onChange={toggleUntagged}
                >
                  无标签 ({untaggedCount})
                </Tag.CheckableTag>
                {tagStats.map(({ tag, count }) => (
                  <Tag.CheckableTag
                    key={tag}
                    checked={selectedTags.includes(tag)}
                    onChange={() => toggleTag(tag)}
                  >
                    {tag} ({count})
                  </Tag.CheckableTag>
                ))}
              </div>
            </div>

            {sorted.length === 0 ? (
              <p className="text-gray-500 mt-6">无匹配收藏</p>
            ) : (
              <ul className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 list-none p-0 m-0">
                {sorted.map((item) => (
                  <li key={item.id}>
                    <FavoriteUserCard item={item} allTags={allTags} />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
};
