import Database from 'tauri-plugin-sql-api';
import MediaType from '../enums/MediaType';
import {
  MediaSourceKind,
  MsMediaRecord,
  MsMediaWithPost,
  MsPostRecord,
} from '../interfaces/MediaSource';

const DB_PATH = 'sqlite:media_source.db';

let dbPromise: Promise<Database> | null = null;

async function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await Database.load(DB_PATH);
      await migrate(db);
      return db;
    })();
  }
  return dbPromise;
}

async function migrate(db: Database) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS ms_posts (
      id TEXT NOT NULL,
      source TEXT NOT NULL,
      account_id TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT '',
      screen_name TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      avatar TEXT NOT NULL DEFAULT '',
      created_at INTEGER,
      full_text TEXT NOT NULL DEFAULT '',
      synced_at INTEGER NOT NULL DEFAULT 0,
      sort_index TEXT,
      PRIMARY KEY (id, source, account_id)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS ms_medias (
      post_id TEXT NOT NULL,
      source TEXT NOT NULL,
      account_id TEXT NOT NULL,
      media_id TEXT NOT NULL,
      type TEXT NOT NULL,
      url TEXT NOT NULL DEFAULT '',
      width INTEGER,
      height INTEGER,
      video_info_json TEXT NOT NULL DEFAULT '',
      local_exists INTEGER NOT NULL DEFAULT 0,
      checked_at INTEGER,
      PRIMARY KEY (post_id, source, account_id, media_id)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS ms_meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT
    )
  `);

  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_ms_posts_account_source_created
     ON ms_posts(account_id, source, created_at DESC)`,
  );
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_ms_medias_local
     ON ms_medias(account_id, source, local_exists)`,
  );
}

interface PostRow {
  id: string;
  source: string;
  account_id: string;
  user_id: string;
  screen_name: string;
  name: string;
  avatar: string;
  created_at: number | null;
  full_text: string;
  synced_at: number;
  sort_index: string | null;
}

interface MediaRow {
  post_id: string;
  source: string;
  account_id: string;
  media_id: string;
  type: string;
  url: string;
  width: number | null;
  height: number | null;
  video_info_json: string;
  local_exists: number;
  checked_at: number | null;
}

function rowToPost(row: PostRow, medias: MsMediaRecord[]): MsPostRecord {
  return {
    id: row.id,
    source: row.source as MediaSourceKind,
    accountId: row.account_id,
    userId: row.user_id,
    screenName: row.screen_name,
    name: row.name,
    avatar: row.avatar,
    createdAt: row.created_at,
    fullText: row.full_text ?? '',
    syncedAt: row.synced_at,
    sortIndex: row.sort_index,
    medias,
  };
}

function rowToMedia(row: MediaRow): MsMediaRecord {
  return {
    postId: row.post_id,
    source: row.source as MediaSourceKind,
    accountId: row.account_id,
    mediaId: row.media_id,
    type: row.type as MediaType,
    url: row.url,
    width: row.width,
    height: row.height,
    videoInfoJson: row.video_info_json || '',
    localExists: Boolean(row.local_exists),
    checkedAt: row.checked_at,
  };
}

const UPSERT_POST_SQL = `
INSERT INTO ms_posts (
  id, source, account_id, user_id, screen_name, name, avatar,
  created_at, full_text, synced_at, sort_index
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
ON CONFLICT(id, source, account_id) DO UPDATE SET
  user_id=excluded.user_id,
  screen_name=excluded.screen_name,
  name=excluded.name,
  avatar=excluded.avatar,
  created_at=excluded.created_at,
  full_text=excluded.full_text,
  synced_at=excluded.synced_at,
  sort_index=COALESCE(excluded.sort_index, ms_posts.sort_index)
`;

/** 冲突时保留 local_exists / checked_at */
const UPSERT_MEDIA_SQL = `
INSERT INTO ms_medias (
  post_id, source, account_id, media_id, type, url, width, height,
  video_info_json, local_exists, checked_at
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
ON CONFLICT(post_id, source, account_id, media_id) DO UPDATE SET
  type=excluded.type,
  url=excluded.url,
  width=excluded.width,
  height=excluded.height,
  video_info_json=excluded.video_info_json
`;

/** 初始化连接与表结构 */
export async function initMediaSourceDb() {
  await getDb();
}

export function mediaSourceMetaKey(
  source: MediaSourceKind,
  accountId: string,
  kind: 'last_sync_at' | 'last_full_sync_at',
): string {
  return `${source}:${accountId}:${kind}`;
}

export async function getMediaSourceMeta(key: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ value: string | null }[]>(
    `SELECT value FROM ms_meta WHERE key=$1`,
    [key],
  );
  return rows[0]?.value ?? null;
}

export async function setMediaSourceMeta(
  key: string,
  value: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO ms_meta (key, value) VALUES ($1,$2)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    [key, value],
  );
}

export async function postExistsInDb(
  source: MediaSourceKind,
  accountId: string,
  postId: string,
): Promise<boolean> {
  const db = await getDb();
  const rows = await db.select<{ c: number }[]>(
    `SELECT COUNT(1) as c FROM ms_posts
     WHERE id=$1 AND source=$2 AND account_id=$3`,
    [postId, source, accountId],
  );
  return (rows[0]?.c ?? 0) > 0;
}

/** 增量 upsert：保留已有 local_exists */
export async function upsertPostsWithMedias(
  posts: {
    post: Omit<MsPostRecord, 'medias'>;
    medias: MsMediaRecord[];
  }[],
): Promise<void> {
  const db = await getDb();
  for (const item of posts) {
    const p = item.post;
    await db.execute(UPSERT_POST_SQL, [
      p.id,
      p.source,
      p.accountId,
      p.userId,
      p.screenName,
      p.name,
      p.avatar,
      p.createdAt,
      p.fullText,
      p.syncedAt,
      p.sortIndex,
    ]);
    for (const m of item.medias) {
      await db.execute(UPSERT_MEDIA_SQL, [
        m.postId,
        m.source,
        m.accountId,
        m.mediaId,
        m.type,
        m.url,
        m.width,
        m.height,
        m.videoInfoJson,
        m.localExists ? 1 : 0,
        m.checkedAt,
      ]);
    }
  }
}

/**
 * 全量批次：upsert 后删除本源+账号下 synced_at 早于 batchAt 的帖及媒体。
 */
export async function replaceSyncedBatch(
  source: MediaSourceKind,
  accountId: string,
  posts: {
    post: Omit<MsPostRecord, 'medias'>;
    medias: MsMediaRecord[];
  }[],
  batchAt: number,
): Promise<void> {
  const stamped = posts.map((item) => ({
    post: { ...item.post, syncedAt: batchAt },
    medias: item.medias,
  }));
  await upsertPostsWithMedias(stamped);

  const db = await getDb();
  await db.execute(
    `DELETE FROM ms_medias WHERE source=$1 AND account_id=$2 AND post_id IN (
       SELECT id FROM ms_posts WHERE source=$1 AND account_id=$2 AND synced_at < $3
     )`,
    [source, accountId, batchAt],
  );
  await db.execute(
    `DELETE FROM ms_posts WHERE source=$1 AND account_id=$2 AND synced_at < $3`,
    [source, accountId, batchAt],
  );
}

async function loadMediasForPosts(
  source: MediaSourceKind,
  accountId: string,
  postIds: string[],
): Promise<Map<string, MsMediaRecord[]>> {
  const map = new Map<string, MsMediaRecord[]>();
  if (postIds.length === 0) return map;
  const db = await getDb();
  // 分批 IN，避免参数过多
  const chunkSize = 200;
  for (let i = 0; i < postIds.length; i += chunkSize) {
    const chunk = postIds.slice(i, i + chunkSize);
    const placeholders = chunk.map((_, idx) => `$${idx + 3}`).join(',');
    const rows = await db.select<MediaRow[]>(
      `SELECT * FROM ms_medias
       WHERE source=$1 AND account_id=$2 AND post_id IN (${placeholders})`,
      [source, accountId, ...chunk],
    );
    for (const row of rows) {
      const list = map.get(row.post_id) || [];
      list.push(rowToMedia(row));
      map.set(row.post_id, list);
    }
  }
  return map;
}

/** 分页列出帖子（含媒体），按创建时间降序 */
export async function listPosts(
  source: MediaSourceKind,
  accountId: string,
  offset = 0,
  limit = 40,
): Promise<MsPostRecord[]> {
  const db = await getDb();
  const rows = await db.select<PostRow[]>(
    `SELECT * FROM ms_posts
     WHERE source=$1 AND account_id=$2
     ORDER BY (created_at IS NULL), created_at DESC, id DESC
     LIMIT $3 OFFSET $4`,
    [source, accountId, limit, offset],
  );
  const mediasMap = await loadMediasForPosts(
    source,
    accountId,
    rows.map((r) => r.id),
  );
  return rows.map((r) => rowToPost(r, mediasMap.get(r.id) || []));
}

export async function countPosts(
  source: MediaSourceKind,
  accountId: string,
): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ c: number }[]>(
    `SELECT COUNT(1) as c FROM ms_posts WHERE source=$1 AND account_id=$2`,
    [source, accountId],
  );
  return rows[0]?.c ?? 0;
}

/** 列出需要下载的媒体（local_exists=0） */
export async function listMediasNeedingDownload(
  source: MediaSourceKind,
  accountId: string,
): Promise<MsMediaWithPost[]> {
  const db = await getDb();
  const mediaRows = await db.select<MediaRow[]>(
    `SELECT * FROM ms_medias
     WHERE source=$1 AND account_id=$2 AND local_exists=0
     ORDER BY post_id DESC`,
    [source, accountId],
  );
  if (mediaRows.length === 0) return [];

  const postIds = [...new Set(mediaRows.map((m) => m.post_id))];
  const postRows = await db.select<PostRow[]>(
    `SELECT * FROM ms_posts WHERE source=$1 AND account_id=$2 AND id IN (${postIds
      .map((_, i) => `$${i + 3}`)
      .join(',')})`,
    [source, accountId, ...postIds],
  );
  const postMap = new Map(
    postRows.map((r) => [r.id, rowToPost(r, [])] as const),
  );

  const result: MsMediaWithPost[] = [];
  for (const mr of mediaRows) {
    const post = postMap.get(mr.post_id);
    if (!post) continue;
    const media = rowToMedia(mr);
    result.push({
      media,
      post: { ...post, medias: [media] },
    });
  }
  return result;
}

/** 列出某源全部媒体（校验用） */
export async function listAllMediasWithPosts(
  source: MediaSourceKind,
  accountId: string,
): Promise<MsMediaWithPost[]> {
  const db = await getDb();
  const mediaRows = await db.select<MediaRow[]>(
    `SELECT * FROM ms_medias WHERE source=$1 AND account_id=$2`,
    [source, accountId],
  );
  if (mediaRows.length === 0) return [];

  const postIds = [...new Set(mediaRows.map((m) => m.post_id))];
  const chunkSize = 200;
  const postMap = new Map<string, MsPostRecord>();
  for (let i = 0; i < postIds.length; i += chunkSize) {
    const chunk = postIds.slice(i, i + chunkSize);
    const postRows = await db.select<PostRow[]>(
      `SELECT * FROM ms_posts WHERE source=$1 AND account_id=$2 AND id IN (${chunk
        .map((_, idx) => `$${idx + 3}`)
        .join(',')})`,
      [source, accountId, ...chunk],
    );
    for (const r of postRows) {
      postMap.set(r.id, rowToPost(r, []));
    }
  }

  return mediaRows
    .map((mr) => {
      const post = postMap.get(mr.post_id);
      if (!post) return null;
      const media = rowToMedia(mr);
      return {
        media,
        post: { ...post, medias: [media] },
      } as MsMediaWithPost;
    })
    .filter((x): x is MsMediaWithPost => x != null);
}

export async function updateMediaLocalExists(
  source: MediaSourceKind,
  accountId: string,
  postId: string,
  mediaId: string,
  localExists: boolean,
  checkedAt = Date.now(),
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE ms_medias SET local_exists=$1, checked_at=$2
     WHERE source=$3 AND account_id=$4 AND post_id=$5 AND media_id=$6`,
    [localExists ? 1 : 0, checkedAt, source, accountId, postId, mediaId],
  );
}

export async function batchUpdateMediaLocalExists(
  updates: {
    source: MediaSourceKind;
    accountId: string;
    postId: string;
    mediaId: string;
    localExists: boolean;
  }[],
  checkedAt = Date.now(),
): Promise<void> {
  for (const u of updates) {
    await updateMediaLocalExists(
      u.source,
      u.accountId,
      u.postId,
      u.mediaId,
      u.localExists,
      checkedAt,
    );
  }
}

export async function countLocalExistsStats(
  source: MediaSourceKind,
  accountId: string,
): Promise<{ total: number; exists: number; missing: number }> {
  const db = await getDb();
  // 注意：exists 是 SQL 保留字，不能用作列别名
  const rows = await db.select<{ total: number; exists_cnt: number }[]>(
    `SELECT
       COUNT(1) as total,
       SUM(CASE WHEN local_exists=1 THEN 1 ELSE 0 END) as exists_cnt
     FROM ms_medias WHERE source=$1 AND account_id=$2`,
    [source, accountId],
  );
  const total = rows[0]?.total ?? 0;
  const exists = Number(rows[0]?.exists_cnt ?? 0);
  return { total, exists, missing: total - exists };
}
