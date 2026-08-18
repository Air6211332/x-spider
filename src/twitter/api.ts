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
import { TwitterList } from '../interfaces/TwitterList';
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
/** Bookmarks */
const BOOKMARKS_QUERY_ID = 'XD0ViOeSOW4YoeNTGjVaYw';
/** Likes */
const LIKES_QUERY_ID = 'rk2aeVVvKsyUdG3jf5uiLw';
/** ListLatestTweetsTimeline */
const LIST_TIMELINE_QUERY_ID = 'FVWmROVvhgjRPC-4jAUh8A';
/** ListsManagementPageTimeline（自己的/订阅的列表） */
const LISTS_MANAGEMENT_QUERY_ID = 'yG0VTYyUVLyU-DQjASBtSg';
/** TweetDetail（线程会话） */
const TWEET_DETAIL_QUERY_ID = 'oCon7R-cgWRFy6EfZjaKfg';

/** 时间线类 GraphQL 共用 features（随客户端轮换） */
const TIMELINE_FEATURES = {
  rweb_tipjar_consumption_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  articles_preview_enabled: true,
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
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  rweb_video_timestamps_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_enhance_cards_enabled: false,
};

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

/** 将 GraphQL Tweet 结果映射为 TwitterPost */
export const mapTwitterPosts = (posts: any[]) => {
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

  /** 兼容 X 新结构：身份字段在 result.core，旧版在 result.legacy */
  const mapTweetUser = (item: any): TwitterUser => {
    const userResult = item?.core?.user_results?.result;
    if (!userResult || userResult.__typename === 'UserUnavailable') {
      return {
        id: '',
        screenName: '',
        name: '',
        avatar: '',
        registerTime: dayjs(0),
      };
    }

    const core = userResult.core || {};
    const legacy = userResult.legacy || {};
    const createdAtRaw = core.created_at || legacy.created_at;

    return {
      id: String(userResult.rest_id || ''),
      screenName: core.screen_name || legacy.screen_name || '',
      name: core.name || legacy.name || '',
      avatar:
        userResult.avatar?.image_url || legacy.profile_image_url_https || '',
      mediaCount: R.isNil(legacy.media_count)
        ? undefined
        : Number(legacy.media_count),
      registerTime: createdAtRaw ? dayjs(createdAtRaw) : dayjs(0),
    };
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
      user: mapTweetUser(item),
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

/** 从推文链接或纯数字 ID 解析 tweetId */
export function parseTweetIdFromUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^\d{5,}$/.test(trimmed)) return trimmed;
  const match =
    trimmed.match(
      /(?:twitter\.com|x\.com)\/(?:#!\/)?[\w.]+\/status(?:es)?\/(\d+)/i,
    ) || trimmed.match(/status(?:es)?\/(\d+)/i);
  return match?.[1] ?? null;
}

function unwrapTweetResult(result: any): any {
  if (!result) return null;
  if (result.__typename === 'TweetWithVisibilityResults') {
    return result.tweet ?? null;
  }
  if (
    result.__typename === 'TweetTombstone' ||
    result.__typename === 'TweetUnavailable'
  ) {
    return null;
  }
  return result;
}

/** 从 timeline instructions 提取带媒体的推文（entry 级） */
function extractTweetResultsFromInstructions(
  instructions: any[],
  options?: { requireMedia?: boolean; skipRetweet?: boolean },
): any[] {
  const requireMedia = options?.requireMedia !== false;
  const skipRetweet = options?.skipRetweet !== false;
  const addEntries = R.find(R.pathEq('TimelineAddEntries', ['type']))(
    instructions ?? [],
  ) as any;
  const rawEntries: any[] = addEntries?.entries ?? [];

  const results: any[] = [];

  const pushResult = (raw: any) => {
    const tweet = unwrapTweetResult(raw);
    if (!tweet?.rest_id) return;
    if (
      skipRetweet &&
      R.hasPath(['legacy', 'retweeted_status_result'], tweet)
    ) {
      return;
    }
    if (requireMedia && !R.path(['legacy', 'entities', 'media', 0], tweet)) {
      return;
    }
    results.push(tweet);
  };

  for (const entry of rawEntries) {
    const entryId: string = entry?.entryId ?? '';
    if (entryId.startsWith('cursor-')) continue;

    if (
      entryId.startsWith('tweet-') ||
      entry?.content?.itemContent?.tweet_results
    ) {
      pushResult(
        R.path(['content', 'itemContent', 'tweet_results', 'result'], entry),
      );
      continue;
    }

    const items: any[] =
      R.path(['content', 'items'], entry) ||
      R.path(['content', 'itemContent', 'items'], entry) ||
      [];
    for (const item of items) {
      pushResult(
        R.path(['item', 'itemContent', 'tweet_results', 'result'], item) ||
          R.path(['itemContent', 'tweet_results', 'result'], item),
      );
    }
  }

  // TimelineAddToModule（加载更多 module）
  const addToModule = R.find(R.pathEq('TimelineAddToModule', ['type']))(
    instructions ?? [],
  ) as any;
  for (const item of addToModule?.moduleItems ?? []) {
    pushResult(
      R.path(['item', 'itemContent', 'tweet_results', 'result'], item),
    );
  }

  return results;
}

function extractBottomCursorFromInstructions(
  instructions: any[],
): string | null {
  const addEntries = R.find(R.pathEq('TimelineAddEntries', ['type']))(
    instructions ?? [],
  ) as any;
  const rawEntries: any[] = addEntries?.entries ?? [];
  const cursor = R.pipe(
    R.find(R.pathEq('Bottom', ['content', 'cursorType'])),
    R.path(['content', 'value']),
    R.defaultTo(null),
  )(rawEntries) as string | null;
  return cursor ? String(cursor) : null;
}

function resolveInstructions(body: any, paths: string[][]): any[] {
  for (const p of paths) {
    const found = R.path<any>(p)(body);
    if (Array.isArray(found) && found.length > 0) return found;
  }
  return [];
}

/**
 * 当前登录账号的书签时间线。
 */
export async function getBookmarks(
  cursor?: string,
  count = 20,
): Promise<{
  twitterPosts: TwitterPost[];
  cursor: string | null;
}> {
  const resp = await request({
    method: 'GET',
    url: `https://${HOST}/i/api/graphql/${BOOKMARKS_QUERY_ID}/Bookmarks`,
    responseType: 'json',
    query: {
      features: JSON.stringify(TIMELINE_FEATURES),
      variables: JSON.stringify({
        count,
        includePromotedContent: true,
        ...(cursor ? { cursor } : {}),
      }),
    },
    headers: getCommonHeaders(),
  });
  ensureResponse(resp);

  const instructions = resolveInstructions(resp.body, [
    ['data', 'bookmark_timeline_v2', 'timeline', 'instructions'],
    ['data', 'bookmark_timeline', 'timeline', 'instructions'],
  ]);
  const tweets = extractTweetResultsFromInstructions(instructions);
  const nextCursor = extractBottomCursorFromInstructions(instructions);
  const twitterPosts = mapTwitterPosts(tweets);

  return {
    twitterPosts,
    cursor: twitterPosts.length === 0 && !nextCursor ? null : nextCursor,
  };
}

/**
 * 指定用户的喜欢时间线（本应用仅用于当前登录用户）。
 */
export async function getLikes(
  userId: string,
  cursor?: string,
  count = 20,
): Promise<{
  twitterPosts: TwitterPost[];
  cursor: string | null;
}> {
  const resp = await request({
    method: 'GET',
    url: `https://${HOST}/i/api/graphql/${LIKES_QUERY_ID}/Likes`,
    responseType: 'json',
    query: {
      features: JSON.stringify(TIMELINE_FEATURES),
      variables: JSON.stringify({
        userId,
        count,
        includePromotedContent: false,
        withClientEventToken: false,
        withBirdwatchNotes: false,
        withVoice: true,
        ...(cursor ? { cursor } : {}),
      }),
    },
    headers: getCommonHeaders(),
  });
  ensureResponse(resp);

  const instructions = resolveInstructions(resp.body, [
    ['data', 'user', 'result', 'timeline_v2', 'timeline', 'instructions'],
    ['data', 'user', 'result', 'timeline', 'timeline', 'instructions'],
  ]);
  const tweets = extractTweetResultsFromInstructions(instructions);
  const nextCursor = extractBottomCursorFromInstructions(instructions);
  const twitterPosts = mapTwitterPosts(tweets);

  return {
    twitterPosts,
    cursor: twitterPosts.length === 0 && !nextCursor ? null : nextCursor,
  };
}

function collectListsFromNode(node: any, out: Map<string, TwitterList>) {
  if (!node || typeof node !== 'object') return;

  const maybeList =
    node.list ||
    (node.__typename === 'List' || (node.name && node.member_count != null)
      ? node
      : null);

  if (maybeList && (maybeList.id_str || maybeList.id || maybeList.rest_id)) {
    const id = String(maybeList.id_str || maybeList.id || maybeList.rest_id);
    if (!out.has(id)) {
      out.set(id, {
        id,
        name: maybeList.name || '',
        description: maybeList.description || '',
        memberCount: Number(maybeList.member_count ?? 0),
        subscriberCount: Number(maybeList.subscriber_count ?? 0),
        mode: maybeList.mode,
      });
    }
  }

  if (Array.isArray(node)) {
    for (const item of node) collectListsFromNode(item, out);
    return;
  }

  for (const key of Object.keys(node)) {
    // 避免深挖过大无关字段
    if (key === 'legacy' || key === 'entities') continue;
    const val = node[key];
    if (val && typeof val === 'object') {
      collectListsFromNode(val, out);
    }
  }
}

/**
 * 读取当前账号自己的与订阅的 X 列表（只读）。
 */
export async function getLists(count = 100): Promise<TwitterList[]> {
  const resp = await request({
    method: 'GET',
    url: `https://${HOST}/i/api/graphql/${LISTS_MANAGEMENT_QUERY_ID}/ListsManagementPageTimeline`,
    responseType: 'json',
    query: {
      features: JSON.stringify(TIMELINE_FEATURES),
      variables: JSON.stringify({ count }),
    },
    headers: getCommonHeaders(),
  });
  ensureResponse(resp);

  const instructions = resolveInstructions(resp.body, [
    ['data', 'viewer', 'list_management_timeline', 'timeline', 'instructions'],
    ['data', 'viewer', 'lists_timeline', 'timeline', 'instructions'],
  ]);

  const map = new Map<string, TwitterList>();
  collectListsFromNode(instructions, map);
  return Array.from(map.values());
}

/**
 * 指定 List 的最新推文时间线。
 */
export async function getListTimeline(
  listId: string,
  cursor?: string,
  count = 20,
): Promise<{
  twitterPosts: TwitterPost[];
  cursor: string | null;
}> {
  const resp = await request({
    method: 'GET',
    url: `https://${HOST}/i/api/graphql/${LIST_TIMELINE_QUERY_ID}/ListLatestTweetsTimeline`,
    responseType: 'json',
    query: {
      features: JSON.stringify(TIMELINE_FEATURES),
      variables: JSON.stringify({
        listId,
        count,
        ...(cursor ? { cursor } : {}),
      }),
    },
    headers: getCommonHeaders(),
  });
  ensureResponse(resp);

  const instructions = resolveInstructions(resp.body, [
    ['data', 'list', 'tweets_timeline', 'timeline', 'instructions'],
    ['data', 'list', 'timeline_response', 'timeline', 'instructions'],
  ]);
  const tweets = extractTweetResultsFromInstructions(instructions);
  const nextCursor = extractBottomCursorFromInstructions(instructions);
  const twitterPosts = mapTwitterPosts(tweets);

  return {
    twitterPosts,
    cursor: twitterPosts.length === 0 && !nextCursor ? null : nextCursor,
  };
}

/**
 * 推文详情：主帖 + 会话中带媒体的相关推文。
 */
export async function getTweetDetail(tweetId: string): Promise<{
  twitterPosts: TwitterPost[];
  cursor: null;
}> {
  const resp = await request({
    method: 'GET',
    url: `https://${HOST}/i/api/graphql/${TWEET_DETAIL_QUERY_ID}/TweetDetail`,
    responseType: 'json',
    query: {
      features: JSON.stringify(TIMELINE_FEATURES),
      fieldToggles: JSON.stringify({
        withArticleRichContentState: true,
        withArticlePlainText: false,
        withGrokAnalyze: false,
      }),
      variables: JSON.stringify({
        focalTweetId: tweetId,
        referrer: 'tweet',
        with_rux_injections: false,
        rankingMode: 'Relevance',
        includePromotedContent: true,
        withCommunity: true,
        withQuickPromoteEligibilityTweetFields: true,
        withBirdwatchNotes: true,
        withVoice: true,
      }),
    },
    headers: getCommonHeaders(),
  });
  ensureResponse(resp);

  const instructions = resolveInstructions(resp.body, [
    ['data', 'threaded_conversation_with_injections_v2', 'instructions'],
    ['data', 'threaded_conversation_with_injections', 'instructions'],
  ]);

  // 线程内不去掉回复，只要求有媒体；不去重 retweet 过滤过严
  const tweets = extractTweetResultsFromInstructions(instructions, {
    requireMedia: true,
    skipRetweet: true,
  });

  // 去重
  const seen = new Set<string>();
  const unique = tweets.filter((t) => {
    const id = String(t.rest_id);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  return {
    twitterPosts: mapTwitterPosts(unique),
    cursor: null,
  };
}

/** 取消关注（REST friendships/destroy，Cookie 会话） */
export async function unfollowUser(userId: string): Promise<void> {
  const cookieString = useAppStateStore.getState().cookieString;
  if (!cookieString) {
    throw new Error('请先登录（配置 Cookie）');
  }
  if (!userId) {
    throw new Error('缺少用户 ID，无法取消关注');
  }

  const resp = await request({
    method: 'POST',
    url: `https://${HOST}/i/api/1.1/friendships/destroy.json`,
    responseType: 'json',
    headers: {
      ...getAuthHeaders(cookieString),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `user_id=${encodeURIComponent(userId)}`,
  });
  ensureResponse(resp);
}
