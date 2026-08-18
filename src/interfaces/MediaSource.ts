import MediaType from '../enums/MediaType';
import { TwitterMedia } from './TwitterMedia';
import { TwitterPost } from './TwitterPost';
import dayjs from 'dayjs';

/** 媒体源类型（登录账号书签 / 喜欢） */
export type MediaSourceKind = 'bookmarks' | 'likes';

/** 库内媒体行 */
export interface MsMediaRecord {
  postId: string;
  source: MediaSourceKind;
  accountId: string;
  mediaId: string;
  type: MediaType;
  url: string;
  width: number | null;
  height: number | null;
  /** videoInfo JSON，无则为空串 */
  videoInfoJson: string;
  localExists: boolean;
  checkedAt: number | null;
}

/** 库内帖子行（含媒体） */
export interface MsPostRecord {
  id: string;
  source: MediaSourceKind;
  accountId: string;
  userId: string;
  screenName: string;
  name: string;
  avatar: string;
  createdAt: number | null;
  fullText: string;
  syncedAt: number;
  sortIndex: string | null;
  medias: MsMediaRecord[];
}

/** 待下载的媒体 + 所属帖 */
export interface MsMediaWithPost {
  media: MsMediaRecord;
  post: MsPostRecord;
}

/** TwitterPost → 入库结构（仅带媒体） */
export function twitterPostToMsRecords(
  post: TwitterPost,
  source: MediaSourceKind,
  accountId: string,
  syncedAt: number,
  sortIndex: string | null = null,
): { post: Omit<MsPostRecord, 'medias'>; medias: MsMediaRecord[] } | null {
  const medias = (post.medias || []).filter((m) => m.id && m.url);
  if (medias.length === 0) return null;

  return {
    post: {
      id: post.id,
      source,
      accountId,
      userId: post.user?.id || '',
      screenName: post.user?.screenName || '',
      name: post.user?.name || '',
      avatar: post.user?.avatar || '',
      createdAt: post.createdAt ? post.createdAt.valueOf() : null,
      fullText: post.fullText || '',
      syncedAt,
      sortIndex,
    },
    medias: medias.map((m) => mediaToRecord(m, post.id, source, accountId)),
  };
}

function mediaToRecord(
  m: TwitterMedia,
  postId: string,
  source: MediaSourceKind,
  accountId: string,
): MsMediaRecord {
  const videoInfo =
    m.type === MediaType.Video || m.type === MediaType.Gif
      ? (m as any).videoInfo
      : undefined;
  return {
    postId,
    source,
    accountId,
    mediaId: String(m.id),
    type: m.type,
    url: m.url || '',
    width: m.width ?? null,
    height: m.height ?? null,
    videoInfoJson: videoInfo ? JSON.stringify(videoInfo) : '',
    localExists: false,
    checkedAt: null,
  };
}

/** 库记录 → TwitterPost（供模板与下载） */
export function msPostToTwitterPost(post: MsPostRecord): TwitterPost {
  return {
    id: post.id,
    fullText: post.fullText || undefined,
    createdAt: post.createdAt != null ? dayjs(post.createdAt) : undefined,
    user: {
      id: post.userId,
      screenName: post.screenName,
      name: post.name,
      avatar: post.avatar,
      registerTime: dayjs(0),
    },
    medias: post.medias.map(msMediaToTwitterMedia),
  };
}

export function msMediaToTwitterMedia(m: MsMediaRecord): TwitterMedia {
  const base = {
    id: m.mediaId,
    url: m.url,
    width: m.width ?? undefined,
    height: m.height ?? undefined,
  };
  let videoInfo: any;
  if (m.videoInfoJson) {
    try {
      videoInfo = JSON.parse(m.videoInfoJson);
    } catch {
      videoInfo = undefined;
    }
  }
  if (m.type === MediaType.Video) {
    return { ...base, type: MediaType.Video, videoInfo };
  }
  if (m.type === MediaType.Gif) {
    return { ...base, type: MediaType.Gif, videoInfo };
  }
  return { ...base, type: MediaType.Photo };
}
