/** 本地收藏的目标用户（可 JSON 持久化） */
export interface FavoriteUser {
  id: string;
  screenName: string;
  name: string;
  avatar: string;
  /** ISO 字符串，便于 JSON 持久化 */
  registerTime: string;
  mediaCount?: number;
  favoritedAt: number;
  lastStartedAt: number | null;
  /** 备注名（显示用别名） */
  noteName: string;
  /** 用户备注 */
  note: string;
  /** 标签列表 */
  tags: string[];
}
