/** 自动下载清单中的账号快照 */
export interface AutoDownloadMember {
  id: string;
  screenName: string;
  name: string;
  avatar: string;
  /** ISO 字符串，便于 JSON 持久化 */
  registerTime: string;
  mediaCount?: number;
}

/** 自动下载清单 */
export interface AutoDownloadList {
  id: string;
  title: string;
  createdAt: number;
  members: AutoDownloadMember[];
}
