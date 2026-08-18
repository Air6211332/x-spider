import dayjs from 'dayjs';
import {
  getAccountInfo,
  getSelfUserId,
  getSelfUserIdFromCookie,
} from '../twitter/api';
import { useAppStateStore } from '../stores/app-state';
import { TwitterUser } from '../interfaces/TwitterUser';

/** 为书签/喜欢/列表任务构造占位 TwitterUser（展示用） */
export async function buildSelfPlaceholderUser(
  displayName: string,
): Promise<TwitterUser> {
  const cookieString = useAppStateStore.getState().cookieString;
  if (!cookieString) {
    throw new Error('请先登录（配置 Cookie）');
  }

  let id = getSelfUserIdFromCookie(cookieString);
  let screenName = 'me';
  let avatar = '';

  try {
    const account = await getAccountInfo(cookieString);
    screenName = account.screenName;
    avatar = account.avatar;
  } catch {
    // 仅用 cookie 中的 id 亦可驱动 likes 拉取
  }

  if (!id) {
    id = await getSelfUserId();
  }

  return {
    id,
    screenName,
    name: displayName,
    avatar,
    registerTime: dayjs(0),
  };
}
