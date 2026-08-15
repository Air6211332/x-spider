/** 本地持久化的关注用户 */
export interface FollowingUser {
  id: string;
  screenName: string;
  name: string;
  avatar: string;
  description: string;
  location: string;
  url: string;
  mediaCount: number | null;
  followersCount: number | null;
  friendsCount: number | null;
  statusesCount: number | null;
  protected: boolean;
  followedBy: boolean;
  registerTime: string | null;
  /** 关注列表条目 Snowflake，用于增量停点 */
  sortIndex: string | null;
  syncedAt: number;
  unavailable: boolean;
  /** 最近一条推文时间（毫秒）；null 表示已检查但无帖或无法读取 */
  lastTweetAt: number | null;
  activityCheckedAt: number | null;
  /** 活跃度检查备注：如 locked / empty / error */
  activityNote: string | null;
  /** 备注名（显示用别名） */
  noteName: string;
  /** 用户备注 */
  note: string;
  /** 标签列表 */
  tags: string[];
}

/** GraphQL Following 单页解析出的条目 */
export interface FollowingEntry {
  user: FollowingUser | null;
  /** 无法解析用户资料（停用/封禁等） */
  unavailableId?: string;
  sortIndex: string;
}
