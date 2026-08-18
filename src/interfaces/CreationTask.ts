import { DownloadFilter } from './DownloadFilter';
import { TwitterUser } from './TwitterUser';

/** 创建任务媒体源类型 */
export type CreationTaskKind = 'user' | 'bookmarks' | 'likes' | 'list';

export interface CreationTask {
  id: string;
  /** 默认 user：按用户媒体/帖子爬取 */
  kind: CreationTaskKind;
  user: TwitterUser;
  filter: DownloadFilter;
  /** kind=list 时使用 */
  listId?: string;
  listName?: string;
  status: 'waiting' | 'active';
  completeCount: number;
  skipCount: number;
}
