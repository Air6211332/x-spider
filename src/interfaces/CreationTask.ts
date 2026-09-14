import { DownloadFilter } from './DownloadFilter';
import { TwitterUser } from './TwitterUser';

/** 创建任务媒体源类型 */
export type CreationTaskKind = 'user' | 'bookmarks' | 'likes' | 'list';

/** 用户创建任务模式：全量爬完；增量按页遇到足够已存在则停 */
export type CreationTaskMode = 'full' | 'incremental';

export interface CreationTask {
  id: string;
  /** 默认 user：按用户媒体/帖子爬取 */
  kind: CreationTaskKind;
  user: TwitterUser;
  filter: DownloadFilter;
  /** 仅 user 任务有意义；默认 full */
  mode?: CreationTaskMode;
  /** kind=list 时使用 */
  listId?: string;
  listName?: string;
  status: 'waiting' | 'active';
  completeCount: number;
  skipCount: number;
}
