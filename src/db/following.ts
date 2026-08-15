import Database from 'tauri-plugin-sql-api';
import { FollowingUser } from '../interfaces/FollowingUser';

const DB_PATH = 'sqlite:following.db';

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

async function tryAlter(db: Database, sql: string) {
  try {
    await db.execute(sql);
  } catch {
    // 列已存在时忽略
  }
}

async function migrate(db: Database) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS following_users (
      id TEXT PRIMARY KEY NOT NULL,
      screen_name TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      avatar TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      media_count INTEGER,
      followers_count INTEGER,
      friends_count INTEGER,
      statuses_count INTEGER,
      protected INTEGER NOT NULL DEFAULT 0,
      followed_by INTEGER NOT NULL DEFAULT 0,
      register_time TEXT,
      sort_index TEXT,
      synced_at INTEGER NOT NULL DEFAULT 0,
      unavailable INTEGER NOT NULL DEFAULT 0,
      last_tweet_at INTEGER,
      activity_checked_at INTEGER,
      activity_note TEXT,
      note_name TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]'
    )
  `);

  await tryAlter(
    db,
    `ALTER TABLE following_users ADD COLUMN note_name TEXT NOT NULL DEFAULT ''`,
  );
  await tryAlter(
    db,
    `ALTER TABLE following_users ADD COLUMN note TEXT NOT NULL DEFAULT ''`,
  );
  await tryAlter(
    db,
    `ALTER TABLE following_users ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'`,
  );

  await db.execute(`
    CREATE TABLE IF NOT EXISTS following_meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS activity_queue (
      user_id TEXT PRIMARY KEY NOT NULL,
      position INTEGER NOT NULL DEFAULT 0
    )
  `);

  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_following_screen_name ON following_users(screen_name)`,
  );
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_following_last_tweet ON following_users(last_tweet_at)`,
  );
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_activity_queue_pos ON activity_queue(position)`,
  );
}

interface FollowingRow {
  id: string;
  screen_name: string;
  name: string;
  avatar: string;
  description: string;
  location: string;
  url: string;
  media_count: number | null;
  followers_count: number | null;
  friends_count: number | null;
  statuses_count: number | null;
  protected: number;
  followed_by: number;
  register_time: string | null;
  sort_index: string | null;
  synced_at: number;
  unavailable: number;
  last_tweet_at: number | null;
  activity_checked_at: number | null;
  activity_note: string | null;
  note_name?: string | null;
  note?: string | null;
  tags?: string | null;
}

function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((t) => typeof t === 'string' && t.trim())
      : [];
  } catch {
    return [];
  }
}

function rowToUser(row: FollowingRow): FollowingUser {
  return {
    id: row.id,
    screenName: row.screen_name,
    name: row.name,
    avatar: row.avatar,
    description: row.description ?? '',
    location: row.location ?? '',
    url: row.url ?? '',
    mediaCount: row.media_count,
    followersCount: row.followers_count,
    friendsCount: row.friends_count,
    statusesCount: row.statuses_count,
    protected: Boolean(row.protected),
    followedBy: Boolean(row.followed_by),
    registerTime: row.register_time,
    sortIndex: row.sort_index,
    syncedAt: row.synced_at,
    unavailable: Boolean(row.unavailable),
    lastTweetAt: row.last_tweet_at,
    activityCheckedAt: row.activity_checked_at,
    activityNote: row.activity_note,
    noteName: row.note_name ?? '',
    note: row.note ?? '',
    tags: parseTags(row.tags),
  };
}

const UPSERT_SQL = `
INSERT INTO following_users (
  id, screen_name, name, avatar, description, location, url,
  media_count, followers_count, friends_count, statuses_count,
  protected, followed_by, register_time, sort_index, synced_at,
  unavailable, last_tweet_at, activity_checked_at, activity_note,
  note_name, note, tags
) VALUES (
  $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23
)
ON CONFLICT(id) DO UPDATE SET
  screen_name=excluded.screen_name,
  name=excluded.name,
  avatar=excluded.avatar,
  description=excluded.description,
  location=excluded.location,
  url=excluded.url,
  media_count=excluded.media_count,
  followers_count=excluded.followers_count,
  friends_count=excluded.friends_count,
  statuses_count=excluded.statuses_count,
  protected=excluded.protected,
  followed_by=excluded.followed_by,
  register_time=excluded.register_time,
  sort_index=excluded.sort_index,
  synced_at=excluded.synced_at,
  unavailable=excluded.unavailable,
  last_tweet_at=COALESCE(excluded.last_tweet_at, following_users.last_tweet_at),
  activity_checked_at=COALESCE(excluded.activity_checked_at, following_users.activity_checked_at),
  activity_note=COALESCE(excluded.activity_note, following_users.activity_note),
  note_name=COALESCE(NULLIF(excluded.note_name, ''), following_users.note_name),
  note=COALESCE(NULLIF(excluded.note, ''), following_users.note),
  tags=CASE
    WHEN excluded.tags IS NULL OR excluded.tags = '' OR excluded.tags = '[]'
    THEN following_users.tags
    ELSE excluded.tags
  END
`;

function userToBindValues(
  user: FollowingUser,
  preserveLocalExtras: boolean,
): unknown[] {
  return [
    user.id,
    user.screenName,
    user.name,
    user.avatar,
    user.description,
    user.location,
    user.url,
    user.mediaCount,
    user.followersCount,
    user.friendsCount,
    user.statusesCount,
    user.protected ? 1 : 0,
    user.followedBy ? 1 : 0,
    user.registerTime,
    user.sortIndex,
    user.syncedAt,
    user.unavailable ? 1 : 0,
    preserveLocalExtras ? null : user.lastTweetAt,
    preserveLocalExtras ? null : user.activityCheckedAt,
    preserveLocalExtras ? null : user.activityNote,
    preserveLocalExtras ? '' : user.noteName ?? '',
    preserveLocalExtras ? '' : user.note ?? '',
    preserveLocalExtras ? '[]' : JSON.stringify(user.tags ?? []),
  ];
}

/** 初始化数据库连接与表结构 */
export async function initFollowingDb() {
  await getDb();
}

export async function listAllFollowingUsers(): Promise<FollowingUser[]> {
  const db = await getDb();
  const rows = await db.select<FollowingRow[]>(
    `SELECT * FROM following_users ORDER BY sort_index DESC`,
  );
  return rows.map(rowToUser);
}

/** 全量替换：批量 upsert 后删除本批次未出现的用户（保留活跃度与本地备注） */
export async function replaceAllFollowingUsers(
  users: FollowingUser[],
): Promise<void> {
  const db = await getDb();
  const existing = await listAllFollowingUsers();
  const localMap = new Map(
    existing.map((u) => [
      u.id,
      {
        lastTweetAt: u.lastTweetAt,
        activityCheckedAt: u.activityCheckedAt,
        activityNote: u.activityNote,
        noteName: u.noteName,
        note: u.note,
        tags: u.tags,
      },
    ]),
  );

  const batchAt = Date.now();
  for (const user of users) {
    const prev = localMap.get(user.id);
    const merged: FollowingUser = {
      ...user,
      syncedAt: batchAt,
      lastTweetAt: prev?.lastTweetAt ?? user.lastTweetAt,
      activityCheckedAt: prev?.activityCheckedAt ?? user.activityCheckedAt,
      activityNote: prev?.activityNote ?? user.activityNote,
      noteName: prev?.noteName ?? user.noteName ?? '',
      note: prev?.note ?? user.note ?? '',
      tags: prev?.tags?.length ? prev.tags : user.tags ?? [],
    };
    await db.execute(UPSERT_SQL, userToBindValues(merged, false));
  }

  await db.execute(`DELETE FROM following_users WHERE synced_at < $1`, [
    batchAt,
  ]);
}

/** 增量 upsert：保留已有活跃度与本地备注 */
export async function upsertFollowingUsers(
  users: FollowingUser[],
): Promise<void> {
  const db = await getDb();
  for (const user of users) {
    await db.execute(UPSERT_SQL, userToBindValues(user, true));
  }
}

export async function updateFollowingActivity(
  id: string,
  patch: {
    lastTweetAt: number | null;
    activityCheckedAt: number;
    activityNote: string | null;
    unavailable?: boolean;
  },
): Promise<void> {
  const db = await getDb();
  if (patch.unavailable !== undefined) {
    await db.execute(
      `UPDATE following_users SET
        last_tweet_at=$1,
        activity_checked_at=$2,
        activity_note=$3,
        unavailable=$4
      WHERE id=$5`,
      [
        patch.lastTweetAt,
        patch.activityCheckedAt,
        patch.activityNote,
        patch.unavailable ? 1 : 0,
        id,
      ],
    );
  } else {
    await db.execute(
      `UPDATE following_users SET
        last_tweet_at=$1,
        activity_checked_at=$2,
        activity_note=$3
      WHERE id=$4`,
      [patch.lastTweetAt, patch.activityCheckedAt, patch.activityNote, id],
    );
  }
}

export async function updateFollowingUserMeta(
  id: string,
  patch: { noteName: string; note: string; tags: string[] },
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE following_users SET note_name=$1, note=$2, tags=$3 WHERE id=$4`,
    [patch.noteName, patch.note, JSON.stringify(patch.tags), id],
  );
}

export async function deleteFollowingUser(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM following_users WHERE id=$1`, [id]);
  await db.execute(`DELETE FROM activity_queue WHERE user_id=$1`, [id]);
}

export async function markFollowingUnavailable(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO following_users (id, screen_name, name, unavailable, synced_at)
     VALUES ($1, '', '', 1, $2)
     ON CONFLICT(id) DO UPDATE SET unavailable=1, synced_at=excluded.synced_at`,
    [id, Date.now()],
  );
}

export async function getFollowingMeta(key: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>(
    `SELECT value FROM following_meta WHERE key=$1`,
    [key],
  );
  return rows[0]?.value ?? null;
}

export async function setFollowingMeta(
  key: string,
  value: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO following_meta (key, value) VALUES ($1, $2)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    [key, value],
  );
}

export async function getActivityQueueIds(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select<{ user_id: string }[]>(
    `SELECT user_id FROM activity_queue ORDER BY position ASC`,
  );
  return rows.map((r) => r.user_id);
}

export async function setActivityQueueIds(ids: string[]): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM activity_queue');
  for (let i = 0; i < ids.length; i++) {
    await db.execute(
      `INSERT INTO activity_queue (user_id, position) VALUES ($1, $2)`,
      [ids[i], i],
    );
  }
}

export async function dequeueActivityHead(): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ user_id: string }[]>(
    `SELECT user_id FROM activity_queue ORDER BY position ASC LIMIT 1`,
  );
  const id = rows[0]?.user_id;
  if (!id) return null;
  await db.execute(`DELETE FROM activity_queue WHERE user_id=$1`, [id]);
  return id;
}

export async function clearActivityQueue(): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM activity_queue');
}

export async function getActivityQueueCount(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ c: number }[]>(
    `SELECT COUNT(*) as c FROM activity_queue`,
  );
  return Number(rows[0]?.c ?? 0);
}
