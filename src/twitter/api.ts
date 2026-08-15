import dayjs from 'dayjs';
import * as R from 'ramda';
import { Response } from '../interfaces/Response';
import { TwitterAccountInfo } from '../interfaces/TwitterAccountInfo';
import {
  TwitterMedia,
  TwitterMediaBase,
  TwitterMediaGif,
  TwitterMediaPhoto,
  TwitterMediaVideo,
} from '../interfaces/TwitterMedia';
import { TwitterPost } from '../interfaces/TwitterPost';
import { TwitterUser } from '../interfaces/TwitterUser';
import { request } from '../ipc/network';
import { useAppStateStore } from '../stores/app-state';
import { parseCookie } from '../utils/cookie';
import MediaType from '../enums/MediaType';
import { FollowingEntry, FollowingUser } from '../interfaces/FollowingUser';

const HOST = 'x.com';

/** Following GraphQL queryId（会随客户端轮换，失效时需更新） */
const FOLLOWING_QUERY_ID = 'C1qZ6bs-L3oc_TKSZyxkXQ';
/** UserTweets（活跃度探测，不过滤无媒体） */
const USER_TWEETS_QUERY_ID = '9zyyd1hebl7oNWIPdA8HRw';

function getCommonHeaders(withCredentials = true): Record<string, string> {
  const cookies = useAppStateStore.getState().cookieString;
  return {
    'User-Agent': navigator.userAgent,
    Referer: `https://${HOST}`,
    ...(withCredentials
      ? {
          Authorization:
            'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
          Cookie: cookies,
          'X-Csrf-Token': parseCookie(cookies)['ct0'],
        }
      : {}),
  };
}

function ensureResponse(response: Response) {
  if (response.status >= 400) {
    log.error(response);
    throw new Error(`Response error: status=${response.status}`);
  }
}

function getAuthHeaders(cookieString: string): Record<string, string> {
  const cookies = parseCookie(cookieString);
  const ct0 = cookies.ct0;
  if (!ct0) {
    throw new Error('Cookie 中缺少 ct0，请从已登录的浏览器复制完整 Cookie');
  }
  return {
    'User-Agent': navigator.userAgent,
    Referer: `https://${HOST}`,
    Authorization:
      'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
    Cookie: cookieString,
    'X-Csrf-Token': ct0,
    'X-Twitter-Auth-Type': 'OAuth2Session',
    'X-Twitter-Active-User': 'yes',
  };
}

/** 旧版可用的首页 HTML 解析（仅 Cookie，不加 Bearer） */
async function getAccountInfoFromHtml(
  cookieString: string,
): Promise<TwitterAccountInfo | null> {
  const res = await request({
    method: 'GET',
    url: `https://${HOST}`,
    responseType: 'text',
    headers: R.mergeRight(getCommonHeaders(false), {
      Cookie: cookieString,
    }),
  });
  if (res.status >= 400) {
    log.warn('homepage status', res.status);
    return null;
  }
  const html = res.body as string;
  const nameMatch =
    html.match(/"screen_name":"([^"]+)"/) ||
    html.match(/\\"screen_name\\":\\"([^\\"]+)\\"/);
  if (!nameMatch) return null;

  const avatarMatch =
    html.match(/"profile_image_url_https":"([^"]+)"/) ||
    html.match(/\\"profile_image_url_https\\":\\"([^\\"]+)\\"/);
  if (!avatarMatch) return null;

  return {
    screenName: nameMatch[1],
    avatar: avatarMatch[1]
      .replace(/\\u003d/g, '=')
      .replace(/\\\//g, '/')
      .replace(/\\"/g, '"'),
  };
}

/** 通过 rest_id 查用户资料 */
async function getAccountInfoByRestId(
  userId: string,
  cookieString: string,
): Promise<TwitterAccountInfo | null> {
  const resp = await request({
    method: 'GET',
    responseType: 'json',
    url: `https://${HOST}/i/api/graphql/Bbaot8ySMtJD7K2t01gW7A/UserByRestId`,
    query: {
      features: JSON.stringify({
        hidden_profile_likes_enabled: true,
        hidden_profile_subscriptions_enabled: true,
        responsive_web_graphql_exclude_directive_enabled: true,
        verified_phone_label_enabled: false,
        highlights_tweets_tab_ui_enabled: true,
        responsive_web_twitter_article_notes_tab_enabled: false,
        creator_subscriptions_tweet_preview_api_enabled: true,
        responsive_web_graphql_skip_user_profile_image_extensions_enabled:
          false,
        responsive_web_graphql_timeline_navigation_enabled: true,
      }),
      variables: JSON.stringify({
        userId,
        withSafetyModeUserFields: true,
      }),
    },
    headers: getAuthHeaders(cookieString),
  });
  if (resp.status >= 400) {
    log.warn('UserByRestId status', resp.status);
    return null;
  }
  const legacy = R.path(['data', 'user', 'result', 'legacy'])(resp.body) as any;
  if (!legacy?.screen_name) return null;
  return {
    screenName: legacy.screen_name,
    avatar: legacy.profile_image_url_https || '',
  };
}

async function getAccountInfoFromSettings(
  cookieString: string,
): Promise<TwitterAccountInfo | null> {
  const urls = [
    `https://${HOST}/i/api/1.1/account/settings.json`,
    `https://api.x.com/1.1/account/settings.json`,
  ];
  for (const url of urls) {
    try {
      const apiRes = await request({
        method: 'GET',
        url,
        responseType: 'json',
        headers: getAuthHeaders(cookieString),
      });
      if (apiRes.status === 401 || apiRes.status === 403) {
        throw new Error('Cookie 无效或已过期，请重新从浏览器复制');
      }
      if (apiRes.status >= 400) continue;
      const screenName = (apiRes.body as any)?.screen_name as
        | string
        | undefined;
      if (!screenName) continue;
      try {
        const userResp = await request({
          method: 'GET',
          responseType: 'json',
          url: `https://${HOST}/i/api/graphql/NimuplG1OB7Fd2btCLdBOw/UserByScreenName`,
          query: {
            features: JSON.stringify({
              hidden_profile_likes_enabled: true,
              hidden_profile_subscriptions_enabled: true,
              responsive_web_graphql_exclude_directive_enabled: true,
              verified_phone_label_enabled: false,
              subscriptions_verification_info_is_identity_verified_enabled:
                true,
              subscriptions_verification_info_verified_since_enabled: true,
              highlights_tweets_tab_ui_enabled: true,
              responsive_web_twitter_article_notes_tab_enabled: false,
              creator_subscriptions_tweet_preview_api_enabled: true,
              responsive_web_graphql_skip_user_profile_image_extensions_enabled:
                false,
              responsive_web_graphql_timeline_navigation_enabled: true,
            }),
            fieldToggles: JSON.stringify({ withAuxiliaryUserLabels: false }),
            variables: JSON.stringify({
              screen_name: screenName,
              withSafetyModeUserFields: true,
            }),
          },
          headers: getAuthHeaders(cookieString),
        });
        const avatar = R.path<string>([
          'data',
          'user',
          'result',
          'legacy',
          'profile_image_url_https',
        ])(userResp.body);
        return { screenName, avatar: avatar || '' };
      } catch {
        return { screenName, avatar: '' };
      }
    } catch (err: any) {
      if (String(err?.message || err).includes('Cookie 无效')) throw err;
      log.warn('settings endpoint error', url, err);
    }
  }
  return null;
}

export async function getAccountInfo(
  cookieStringOverride?: string,
): Promise<TwitterAccountInfo> {
  const cookieString =
    cookieStringOverride ?? useAppStateStore.getState().cookieString;
  if (!cookieString) {
    throw new Error('未配置 Cookie');
  }
  const cookies = parseCookie(cookieString);
  if (!cookies.auth_token || !cookies.ct0) {
    throw new Error('Cookie 中需包含 auth_token 与 ct0');
  }

  // 1) 旧版首页 HTML（安装版路径，经实测可用）
  try {
    const fromHtml = await getAccountInfoFromHtml(cookieString);
    if (fromHtml) return fromHtml;
  } catch (err) {
    log.warn('HTML account parse failed', err);
  }

  // 2) 有 twid 时尝试 GraphQL UserByRestId
  const selfId = getSelfUserIdFromCookie(cookieString);
  if (selfId) {
    try {
      const byId = await getAccountInfoByRestId(selfId, cookieString);
      if (byId) return byId;
    } catch (err) {
      log.warn('UserByRestId failed', err);
    }
  }

  // 3) settings.json
  const fromSettings = await getAccountInfoFromSettings(cookieString);
  if (fromSettings) return fromSettings;

  throw new Error(
    '无法解析账号信息，请确认 Cookie 有效（auth_token、ct0，建议含 twid）及代理可用',
  );
}

export async function getUser(screenName: string): Promise<TwitterUser> {
  const resp = await request({
    method: 'GET',
    responseType: 'json',
    url: `https://${HOST}/i/api/graphql/NimuplG1OB7Fd2btCLdBOw/UserByScreenName`,
    query: {
      features: JSON.stringify({
        hidden_profile_likes_enabled: true,
        hidden_profile_subscriptions_enabled: true,
        responsive_web_graphql_exclude_directive_enabled: true,
        verified_phone_label_enabled: false,
        subscriptions_verification_info_is_identity_verified_enabled: true,
        subscriptions_verification_info_verified_since_enabled: true,
        highlights_tweets_tab_ui_enabled: true,
        responsive_web_twitter_article_notes_tab_enabled: false,
        creator_subscriptions_tweet_preview_api_enabled: true,
        responsive_web_graphql_skip_user_profile_image_extensions_enabled:
          false,
        responsive_web_graphql_timeline_navigation_enabled: true,
      }),
      fieldToggles: JSON.stringify({ withAuxiliaryUserLabels: false }),
      variables: JSON.stringify({
        screen_name: screenName,
        withSafetyModeUserFields: true,
      }),
    },
    headers: getCommonHeaders(),
  });
  ensureResponse(resp);

  const data = R.path(['data', 'user', 'result', 'legacy'])(resp.body) as any;

  if (!data) {
    throw new Error('找不到该用户');
  }

  return {
    avatar: data?.profile_image_url_https,
    name: data?.name,
    screenName: data?.screen_name,
    id: R.path<string>(['data', 'user', 'result', 'rest_id'])(
      resp.body,
    ) as string,
    mediaCount: data?.media_count,
    registerTime: dayjs(data.created_at),
  };
}

const mapTwitterPosts = (posts: any[]) => {
  const mapTwitterMedias = (medias: any[]) => {
    const toTwitterMediaBase: (v: any) => TwitterMediaBase = (v: any) => {
      return {
        id: v?.id_str,
        url: v?.media_url_https,
        width: v?.original_info?.width,
        height: v?.original_info?.height,
      };
    };

    const toPhoto: (v: any) => TwitterMediaPhoto = (v: any) => ({
      ...toTwitterMediaBase(v),
      type: MediaType.Photo,
    });

    const toVideo: (v: any) => TwitterMediaVideo = (v: any) => ({
      ...toTwitterMediaBase(v),
      type: MediaType.Video,
      videoInfo: {
        duration: v?.video_info?.duration_millis,
        variants: v?.video_info?.variants?.map?.((item: any) => ({
          bitrate: item?.bitrate,
          contentType: item?.contentType,
          url: item?.url,
        })),
        aspectRatio: v?.aspect_ratio,
      },
    });

    const toGif: (v: any) => TwitterMediaGif = (v: any) => ({
      ...toTwitterMediaBase(v),
      type: MediaType.Gif,
      videoInfo: {
        url: v?.video_info?.variants?.[0]?.url,
        aspectRatio: v?.video_info?.aspect_ratio,
      },
    });

    return R.pipe<any[], (TwitterMedia | null)[], TwitterMedia[]>(
      R.map<any, TwitterMedia | null>(
        R.cond<any, TwitterMedia | null>([
          [R.propEq('photo', 'type'), toPhoto],
          [R.propEq('video', 'type'), toVideo],
          [R.propEq('animated_gif', 'type'), toGif],
          [R.T, R.always(null)],
        ]),
      ),
      R.filter<TwitterMedia | null, TwitterMedia>(R.isNotNil),
    )(medias);
  };
  return R.map<any, TwitterPost>((item) => {
    return {
      id: item?.rest_id,
      views: R.isNotNil(item?.views?.count)
        ? Number(item.views.count)
        : undefined,
      createdAt: item.legacy?.created_at
        ? dayjs(item.legacy?.created_at)
        : undefined,
      bookmarkCount: item?.legacy?.bookmark_count,
      bookmarked: item?.legacy?.bookmarked,
      favoriteCount: item?.legacy?.favorite_count,
      favorited: item?.legacy?.favorited,
      fullText: item?.legacy?.full_text,
      lang: item?.legacy?.lang,
      possiblySensitive: item?.legacy?.possibly_sensitive,
      replyCount: item?.legacy?.reply_count,
      retweeted: item?.legacy?.retweeted,
      retweetCount: item?.legacy?.retweet_count,
      medias: item?.legacy?.entities?.media
        ? mapTwitterMedias(item.legacy?.entities?.media)
        : undefined,
      tags: R.pipe<any, any[], string[]>(
        R.path<any>(['legacy', 'entities', 'hashtags']),
        R.ifElse(R.isNotNil, R.map(R.prop('text')), R.always([])),
      )(item),
      user: {
        id: item?.core?.user_results?.result?.rest_id,
        avatar:
          item?.core?.user_results?.result?.legacy?.profile_image_url_https,
        mediaCount: item?.core?.user_results?.result?.legacy?.media_count,
        name: item?.core?.user_results?.result?.legacy?.name,
        screenName: item?.core?.user_results?.result?.legacy?.screen_name,
        registerTime: item?.core?.user_results?.result?.legacy?.created_at,
      },
    };
  })(posts);
};

const pathToInstructions = R.path<any>([
  'data',
  'user',
  'result',
  'timeline_v2',
  'timeline',
  'instructions',
]);

export async function getUserMedias(
  userId: string,
  cursor?: string,
  count = 20,
): Promise<{
  twitterPosts: TwitterPost[];
  cursor: string | null;
}> {
  const resp = await request({
    method: 'GET',
    url: `https://${HOST}/i/api/graphql/cEjpJXA15Ok78yO4TUQPeQ/UserMedia`,
    responseType: 'json',
    query: {
      features: JSON.stringify({
        responsive_web_graphql_exclude_directive_enabled: true,
        verified_phone_label_enabled: false,
        creator_subscriptions_tweet_preview_api_enabled: true,
        responsive_web_graphql_timeline_navigation_enabled: true,
        responsive_web_graphql_skip_user_profile_image_extensions_enabled:
          false,
        c9s_tweet_anatomy_moderator_badge_enabled: true,
        tweetypie_unmention_optimization_enabled: true,
        responsive_web_edit_tweet_api_enabled: true,
        graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
        view_counts_everywhere_api_enabled: true,
        longform_notetweets_consumption_enabled: true,
        responsive_web_twitter_article_tweet_consumption_enabled: true,
        tweet_awards_web_tipping_enabled: false,
        freedom_of_speech_not_reach_fetch_enabled: true,
        standardized_nudges_misinfo: true,
        tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled:
          true,
        rweb_video_timestamps_enabled: true,
        longform_notetweets_rich_text_read_enabled: true,
        longform_notetweets_inline_media_enabled: true,
        responsive_web_media_download_video_enabled: false,
        responsive_web_enhance_cards_enabled: false,
      }),
      variables: JSON.stringify({
        userId,
        count,
        cursor,
        includePromotedContent: false,
        withClientEventToken: false,
        withBirdwatchNotes: false,
        withVoice: true,
        withV2Timeline: true,
      }),
    },
    headers: getCommonHeaders(),
  });
  ensureResponse(resp);

  const extractTwitterPosts = (
    pathToInstructions: (data: any) => any,
    data: any,
  ): TwitterPost[] | undefined => {
    const pathToTwitterPostItems = (instructions: any): any => {
      const pathToModuleItemsFirst = R.pipe(
        R.find(R.pathEq('TimelineAddEntries', ['type'])),
        R.defaultTo({}),
        R.prop('entries'),
        R.defaultTo([]),
        R.find(R.pathEq('TimelineTimelineModule', ['content', 'entryType'])),
        R.defaultTo({}),
        R.path<any>(['content', 'items']),
      );

      const pathToModuleItemsMore = R.pipe(
        R.find(R.pathEq('TimelineAddToModule', ['type'])),
        R.defaultTo({}),
        R.prop('moduleItems'),
      );

      return R.pipe(
        R.either(pathToModuleItemsFirst, pathToModuleItemsMore),
        R.defaultTo([]),
        R.map(
          R.pipe(
            R.path(['item', 'itemContent', 'tweet_results', 'result']),
            R.ifElse<any, any, any>(
              R.propEq('TweetWithVisibilityResults', '__typename'),
              R.prop('tweet'),
              R.identity,
            ),
          ),
        ),
      )(instructions);
    };
    return R.pipe(
      pathToInstructions,
      R.ifElse(
        R.isNil,
        R.always([]),
        R.pipe(pathToTwitterPostItems, R.filter(R.isNotNil), mapTwitterPosts),
      ),
    )(data);
  };

  const extractNextCursor = (
    pathToInstructions: (data: any) => any,
    data: any,
  ): string | null => {
    return R.pipe<any, any, any, any, any, string | undefined, string | null>(
      pathToInstructions,
      R.find(R.pathEq('TimelineAddEntries', ['type'])),
      R.prop('entries'),
      R.find(R.pathEq('Bottom', ['content', 'cursorType'])),
      R.path(['content', 'value']),
      R.defaultTo(null),
    )(data);
  };

  const twitterPosts = extractTwitterPosts(pathToInstructions, resp.body);

  if (!twitterPosts || twitterPosts.length === 0) {
    return {
      cursor: null,
      twitterPosts: [],
    };
  }

  log.info('twitterPosts', twitterPosts);

  const nextCursor = extractNextCursor(pathToInstructions, resp.body);

  return {
    twitterPosts,
    cursor: nextCursor,
  };
}

export async function getUserTweets(
  userId: string,
  cursor?: string,
  count = 20,
): Promise<{
  twitterPosts: TwitterPost[];
  cursor: string | null;
}> {
  const resp = await request({
    method: 'GET',
    url: `https://${HOST}/i/api/graphql/9zyyd1hebl7oNWIPdA8HRw/UserTweets`,
    responseType: 'json',
    query: {
      features: JSON.stringify({
        rweb_tipjar_consumption_enabled: true,
        responsive_web_graphql_exclude_directive_enabled: true,
        verified_phone_label_enabled: false,
        creator_subscriptions_tweet_preview_api_enabled: true,
        responsive_web_graphql_timeline_navigation_enabled: true,
        responsive_web_graphql_skip_user_profile_image_extensions_enabled:
          false,
        communities_web_enable_tweet_community_results_fetch: true,
        c9s_tweet_anatomy_moderator_badge_enabled: true,
        articles_preview_enabled: false,
        tweetypie_unmention_optimization_enabled: true,
        responsive_web_edit_tweet_api_enabled: true,
        graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
        view_counts_everywhere_api_enabled: true,
        longform_notetweets_consumption_enabled: true,
        responsive_web_twitter_article_tweet_consumption_enabled: true,
        tweet_awards_web_tipping_enabled: false,
        creator_subscriptions_quote_tweet_preview_enabled: false,
        freedom_of_speech_not_reach_fetch_enabled: true,
        standardized_nudges_misinfo: true,
        tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled:
          true,
        tweet_with_visibility_results_prefer_gql_media_interstitial_enabled:
          false,
        rweb_video_timestamps_enabled: true,
        longform_notetweets_rich_text_read_enabled: true,
        longform_notetweets_inline_media_enabled: true,
        responsive_web_enhance_cards_enabled: false,
      }),
      variables: JSON.stringify({
        userId,
        count,
        cursor,
        includePromotedContent: true,
        withQuickPromoteEligibilityTweetFields: true,
        withVoice: true,
        withV2Timeline: true,
      }),
    },
    headers: getCommonHeaders(),
  });
  ensureResponse(resp);

  const extractTwitterPosts = (
    pathToInstructions: (data: any) => any,
    data: any,
  ): TwitterPost[] | undefined => {
    const pathToTwitterPostItems = (instructions: any): any => {
      // @ts-ignore
      return R.pipe(
        R.find(R.pathEq('TimelineAddEntries', ['type'])),
        R.defaultTo({}),
        R.prop('entries'),
        R.defaultTo([]),
        R.map(
          R.cond([
            [
              R.pathSatisfies(R.startsWith('tweet'), ['entryId']),
              R.path(['content', 'itemContent', 'tweet_results', 'result']),
            ],
            [
              R.pathSatisfies(R.startsWith('profile-conversation'), [
                'entryId',
              ]),
              R.pipe(
                R.path<any>(['content', 'items']),
                R.map(
                  R.path(['item', 'itemContent', 'tweet_results', 'result']),
                ),
              ),
            ],
            [R.T, R.always(undefined)],
          ]),
        ),
        R.flatten,
        R.filter(
          R.allPass<any>([
            R.isNotNil,
            // 过滤掉转推
            R.complement(R.hasPath(['legacy', 'retweeted_status_result'])),
            // 过滤掉无媒体
            R.hasPath(['legacy', 'entities', 'media']),
            R.pathSatisfies(R.pipe(R.length, R.lte(0)), [
              'legacy',
              'entities',
              'media',
            ]),
          ]),
        ),
      )(instructions);
    };
    return R.pipe(
      pathToInstructions,
      pathToTwitterPostItems,
      mapTwitterPosts,
    )(data);
  };

  const extractNextCursor = (
    pathToInstructions: (data: any) => any,
    data: any,
  ): string | null => {
    return R.pipe<any, any, any, any, any, string | undefined, string | null>(
      pathToInstructions,
      R.find(R.pathEq('TimelineAddEntries', ['type'])),
      R.prop('entries'),
      R.find(R.pathEq('Bottom', ['content', 'cursorType'])),
      R.path(['content', 'value']),
      R.defaultTo(null),
    )(data);
  };

  const twitterPosts = extractTwitterPosts(pathToInstructions, resp.body);
  const nextCursor = extractNextCursor(pathToInstructions, resp.body);
  if (!twitterPosts || twitterPosts.length === 0) {
    return {
      cursor: nextCursor,
      twitterPosts: [],
    };
  }

  log.info('twitterPosts', twitterPosts);

  return {
    twitterPosts,
    cursor: nextCursor,
  };
}

/**
 * 从 Cookie 的 twid 解析当前登录用户 rest_id。
 * twid 形如 `u%3D123` 或 `u=123`。
 */
export function getSelfUserIdFromCookie(cookieString?: string): string | null {
  const cookies = parseCookie(
    cookieString ?? useAppStateStore.getState().cookieString,
  );
  const raw = cookies.twid;
  if (!raw) return null;
  const decoded = decodeURIComponent(raw);
  const match = decoded.match(/u[=:](\d+)/i) || decoded.match(/(\d{5,})/);
  return match?.[1] ?? null;
}

/** 获取当前登录用户 ID：优先 twid，否则 getAccountInfo + UserByScreenName */
export async function getSelfUserId(): Promise<string> {
  const fromCookie = getSelfUserIdFromCookie();
  if (fromCookie) return fromCookie;

  const cookieString = useAppStateStore.getState().cookieString;
  if (!cookieString) {
    throw new Error('未配置 Cookie');
  }

  const account = await getAccountInfo(cookieString);
  const user = await getUser(account.screenName);
  return user.id;
}

function mapLegacyToFollowingUser(
  restId: string,
  legacy: any,
  sortIndex: string,
  now: number,
): FollowingUser {
  const entitiesUrl = R.path<string>([
    'entities',
    'url',
    'urls',
    0,
    'expanded_url',
  ])(legacy);
  return {
    id: restId,
    screenName: legacy?.screen_name ?? '',
    name: legacy?.name ?? '',
    avatar: legacy?.profile_image_url_https ?? '',
    description: legacy?.description ?? '',
    location: legacy?.location ?? '',
    url: entitiesUrl || legacy?.url || '',
    mediaCount: R.isNil(legacy?.media_count)
      ? null
      : Number(legacy.media_count),
    followersCount: R.isNil(legacy?.followers_count)
      ? null
      : Number(legacy.followers_count),
    friendsCount: R.isNil(legacy?.friends_count)
      ? null
      : Number(legacy.friends_count),
    statusesCount: R.isNil(legacy?.statuses_count)
      ? null
      : Number(legacy.statuses_count),
    protected: Boolean(legacy?.protected),
    followedBy: Boolean(legacy?.followed_by),
    registerTime: legacy?.created_at
      ? dayjs(legacy.created_at).toISOString()
      : null,
    sortIndex,
    syncedAt: now,
    unavailable: false,
    lastTweetAt: null,
    activityCheckedAt: null,
    activityNote: null,
    noteName: '',
    note: '',
    tags: [],
  };
}

const pathToFollowingInstructions = R.path<any>([
  'data',
  'user',
  'result',
  'timeline',
  'timeline',
  'instructions',
]);

/**
 * 拉取一页「正在关注」列表。
 */
export async function getFollowing(
  userId: string,
  cursor?: string,
  count = 50,
): Promise<{
  entries: FollowingEntry[];
  cursor: string | null;
}> {
  const resp = await request({
    method: 'GET',
    url: `https://${HOST}/i/api/graphql/${FOLLOWING_QUERY_ID}/Following`,
    responseType: 'json',
    query: {
      features: JSON.stringify({
        rweb_tipjar_consumption_enabled: true,
        responsive_web_graphql_exclude_directive_enabled: true,
        verified_phone_label_enabled: false,
        creator_subscriptions_tweet_preview_api_enabled: true,
        responsive_web_graphql_timeline_navigation_enabled: true,
        responsive_web_graphql_skip_user_profile_image_extensions_enabled:
          false,
        communities_web_enable_tweet_community_results_fetch: true,
        c9s_tweet_anatomy_moderator_badge_enabled: true,
        articles_preview_enabled: false,
        tweetypie_unmention_optimization_enabled: true,
        responsive_web_edit_tweet_api_enabled: true,
        graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
        view_counts_everywhere_api_enabled: true,
        longform_notetweets_consumption_enabled: true,
        responsive_web_twitter_article_tweet_consumption_enabled: true,
        tweet_awards_web_tipping_enabled: false,
        freedom_of_speech_not_reach_fetch_enabled: true,
        standardized_nudges_misinfo: true,
        tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled:
          true,
        rweb_video_timestamps_enabled: true,
        longform_notetweets_rich_text_read_enabled: true,
        longform_notetweets_inline_media_enabled: true,
        responsive_web_enhance_cards_enabled: false,
      }),
      variables: JSON.stringify({
        userId,
        count,
        ...(cursor ? { cursor } : {}),
        includePromotedContent: false,
      }),
    },
    headers: getCommonHeaders(),
  });
  ensureResponse(resp);

  const now = Date.now();
  const instructions =
    pathToFollowingInstructions(resp.body) ??
    R.path<any>([
      'data',
      'user',
      'result',
      'timeline_v2',
      'timeline',
      'instructions',
    ])(resp.body) ??
    [];
  const addEntries = R.find(R.pathEq('TimelineAddEntries', ['type']))(
    instructions,
  ) as any;
  const rawEntries: any[] = addEntries?.entries ?? [];

  const entries: FollowingEntry[] = [];
  for (const entry of rawEntries) {
    const entryId: string = entry?.entryId ?? '';
    if (entryId.startsWith('cursor-')) continue;

    const sortIndex = String(entry?.sortIndex ?? '');
    const userResult = R.path([
      'content',
      'itemContent',
      'user_results',
      'result',
    ])(entry) as any;

    if (!userResult) continue;

    const typename = userResult.__typename;
    if (typename === 'UserUnavailable' || !userResult.legacy) {
      const uid = userResult.rest_id || entryId.replace(/^user-/, '');
      entries.push({
        user: null,
        unavailableId: uid || undefined,
        sortIndex,
      });
      continue;
    }

    const restId = String(userResult.rest_id);
    entries.push({
      user: mapLegacyToFollowingUser(restId, userResult.legacy, sortIndex, now),
      sortIndex,
    });
  }

  const nextCursorRaw = R.pipe(
    R.find(R.pathEq('Bottom', ['content', 'cursorType'])),
    R.path(['content', 'value']),
    R.defaultTo(null),
  )(rawEntries) as string | null;

  // 本页没有用户时视为结束，避免末尾 Bottom cursor 导致死循环翻页
  const nextCursor =
    entries.length === 0 ? null : nextCursorRaw ? String(nextCursorRaw) : null;

  return { entries, cursor: nextCursor };
}

export interface LatestTweetActivity {
  lastTweetAt: number | null;
  /** empty | locked | unavailable | ok */
  note: string;
  unavailable?: boolean;
}

/**
 * 探测用户最近一条推文时间（不过滤无媒体帖）。
 */
export async function getLatestTweetAt(
  userId: string,
): Promise<LatestTweetActivity> {
  const resp = await request({
    method: 'GET',
    url: `https://${HOST}/i/api/graphql/${USER_TWEETS_QUERY_ID}/UserTweets`,
    responseType: 'json',
    query: {
      features: JSON.stringify({
        rweb_tipjar_consumption_enabled: true,
        responsive_web_graphql_exclude_directive_enabled: true,
        verified_phone_label_enabled: false,
        creator_subscriptions_tweet_preview_api_enabled: true,
        responsive_web_graphql_timeline_navigation_enabled: true,
        responsive_web_graphql_skip_user_profile_image_extensions_enabled:
          false,
        communities_web_enable_tweet_community_results_fetch: true,
        c9s_tweet_anatomy_moderator_badge_enabled: true,
        articles_preview_enabled: false,
        tweetypie_unmention_optimization_enabled: true,
        responsive_web_edit_tweet_api_enabled: true,
        graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
        view_counts_everywhere_api_enabled: true,
        longform_notetweets_consumption_enabled: true,
        responsive_web_twitter_article_tweet_consumption_enabled: true,
        tweet_awards_web_tipping_enabled: false,
        creator_subscriptions_quote_tweet_preview_enabled: false,
        freedom_of_speech_not_reach_fetch_enabled: true,
        standardized_nudges_misinfo: true,
        tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled:
          true,
        tweet_with_visibility_results_prefer_gql_media_interstitial_enabled:
          false,
        rweb_video_timestamps_enabled: true,
        longform_notetweets_rich_text_read_enabled: true,
        longform_notetweets_inline_media_enabled: true,
        responsive_web_enhance_cards_enabled: false,
      }),
      variables: JSON.stringify({
        userId,
        count: 5,
        includePromotedContent: false,
        withQuickPromoteEligibilityTweetFields: true,
        withVoice: true,
        withV2Timeline: true,
      }),
    },
    headers: getCommonHeaders(),
  });

  if (resp.status === 429) {
    throw new Error('RATE_LIMIT');
  }
  ensureResponse(resp);

  const userResult = R.path(['data', 'user', 'result'])(resp.body) as any;
  if (!userResult || userResult.__typename === 'UserUnavailable') {
    return { lastTweetAt: null, note: 'unavailable', unavailable: true };
  }

  const instructions = pathToInstructions(resp.body) ?? [];
  const addEntries = R.find(R.pathEq('TimelineAddEntries', ['type']))(
    instructions,
  ) as any;
  const rawEntries: any[] = addEntries?.entries ?? [];

  for (const entry of rawEntries) {
    const entryId: string = entry?.entryId ?? '';
    if (
      !entryId.startsWith('tweet-') &&
      !entryId.startsWith('profile-conversation')
    ) {
      continue;
    }

    let tweetResult = R.path([
      'content',
      'itemContent',
      'tweet_results',
      'result',
    ])(entry) as any;

    if (!tweetResult && entryId.startsWith('profile-conversation')) {
      tweetResult = R.path([
        'content',
        'items',
        0,
        'item',
        'itemContent',
        'tweet_results',
        'result',
      ])(entry);
    }

    if (!tweetResult) continue;
    if (tweetResult.__typename === 'TweetWithVisibilityResults') {
      tweetResult = tweetResult.tweet;
    }

    const createdAt = tweetResult?.legacy?.created_at;
    if (createdAt) {
      return {
        lastTweetAt: dayjs(createdAt).valueOf(),
        note: 'ok',
      };
    }
  }

  return { lastTweetAt: null, note: 'empty' };
}
