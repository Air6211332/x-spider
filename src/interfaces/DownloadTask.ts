import { AriaStatus } from '../utils/aria2';
import { TwitterMedia } from './TwitterMedia';
import { TwitterPost } from './TwitterPost';

export interface DownloadTask {
  gid: string;
  post: TwitterPost;
  media: TwitterMedia;
  fileName: string;
  dir: string;
  totalSize: number;
  completeSize: number;
  /** 当前下载速度（字节/秒） */
  downloadSpeed: number;
  status: AriaStatus;
  error?: string;
  updatedAt: number;
  downloadUrl: string;
  ariaRetryCountRemains: number;
}
