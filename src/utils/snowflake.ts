/** Twitter Snowflake epoch（毫秒） */
const TWITTER_EPOCH_MS = 1288834974657n;

/**
 * 将 timeline 条目的 sortIndex（Snowflake）解析为毫秒时间戳。
 * 解析失败返回 null。
 */
export function sortIndexToMs(
  sortIndex: string | null | undefined,
): number | null {
  if (!sortIndex) return null;
  try {
    const id = BigInt(sortIndex);
    const ms = Number((id >> 22n) + TWITTER_EPOCH_MS);
    if (!Number.isFinite(ms) || ms <= 0) return null;
    return ms;
  } catch {
    return null;
  }
}
