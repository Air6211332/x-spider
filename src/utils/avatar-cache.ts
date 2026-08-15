import { fs, path } from '@tauri-apps/api';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { request } from '../ipc/network';

/** screenName → 本地文件绝对路径 */
const pathCache = new Map<string, string>();
/** screenName → 正在进行的解析 Promise（去重） */
const inflight = new Map<string, Promise<string | null>>();

function normalizeScreenName(screenName: string): string {
  return screenName.trim().replace(/^@/, '').toLowerCase();
}

/** 去掉路径非法字符，仅保留安全文件名 */
function safeFileBase(screenName: string): string {
  return normalizeScreenName(screenName).replace(/[^a-z0-9_]/gi, '_');
}

function extFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const m = pathname.match(/\.(jpe?g|png|gif|webp|bmp)(?:$|\?)/i);
    if (m) return `.${m[1].toLowerCase().replace('jpeg', 'jpg')}`;
  } catch {
    // ignore
  }
  return '.jpg';
}

async function ensureCacheDir(): Promise<string> {
  const dir = await path.join(await path.appDataDir(), 'avatar-cache');
  if (!(await fs.exists(dir))) {
    await fs.createDir(dir, { recursive: true });
  }
  return dir;
}

async function readCachedUrl(metaPath: string): Promise<string | null> {
  try {
    if (!(await fs.exists(metaPath))) return null;
    return (await fs.readTextFile(metaPath)).trim() || null;
  } catch {
    return null;
  }
}

function toUint8Array(body: unknown): Uint8Array {
  if (body instanceof Uint8Array) return body;
  if (Array.isArray(body)) return Uint8Array.from(body as number[]);
  if (typeof body === 'string') {
    // 兼容偶发 base64 / 文本
    const bin = atob(body);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  throw new Error('unsupported binary body');
}

/**
 * 解析头像展示地址：优先本地缓存，失败或无账号时回退网络 URL。
 * @returns 可用于 Avatar 的 src；空远程 URL 时返回 null
 */
export async function resolveAvatarSrc(
  screenName: string | undefined | null,
  remoteUrl: string | undefined | null,
): Promise<string | null> {
  const url = (remoteUrl ?? '').trim();
  if (!url) return null;

  const sn = (screenName ?? '').trim();
  if (!sn) return url;

  const key = normalizeScreenName(sn);
  if (!key) return url;

  const existing = inflight.get(key);
  if (existing) return existing;

  const task = (async (): Promise<string | null> => {
    try {
      const dir = await ensureCacheDir();
      const base = safeFileBase(sn);
      const ext = extFromUrl(url);
      const filePath = await path.join(dir, `${base}${ext}`);
      const metaPath = await path.join(dir, `${base}.url`);

      const cachedPath = pathCache.get(key);
      if (cachedPath && (await fs.exists(cachedPath))) {
        const recorded = await readCachedUrl(metaPath);
        if (recorded === url) {
          return convertFileSrc(cachedPath);
        }
      }

      if (await fs.exists(filePath)) {
        const recorded = await readCachedUrl(metaPath);
        if (recorded === url) {
          pathCache.set(key, filePath);
          return convertFileSrc(filePath);
        }
      }

      // 下载并覆盖
      try {
        const res = await request({
          method: 'GET',
          url,
          responseType: 'binary',
        });
        if (res.status < 200 || res.status >= 300) {
          throw new Error(`avatar http ${res.status}`);
        }
        const bytes = toUint8Array(res.body);
        await fs.writeBinaryFile(filePath, bytes);
        await fs.writeTextFile(metaPath, url);
        pathCache.set(key, filePath);
        return convertFileSrc(filePath);
      } catch (err) {
        // 下载失败：尽量用旧本地文件
        if (await fs.exists(filePath)) {
          pathCache.set(key, filePath);
          return convertFileSrc(filePath);
        }
        try {
          window.log.category('AVATAR').warn('Avatar cache failed', sn, err);
        } catch {
          // ignore
        }
        return url;
      }
    } catch {
      return url;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, task);
  return task;
}
