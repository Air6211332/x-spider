import { create } from 'zustand';
import { fs, path } from '@tauri-apps/api';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { request } from '../ipc/network';

const MAX_CONCURRENT = 2;

export type AvatarCacheJobStatus = 'waiting' | 'running';

export interface AvatarCacheJob {
  screenName: string;
  url: string;
  status: AvatarCacheJobStatus;
  enqueuedAt: number;
}

interface AvatarCacheStore {
  jobs: AvatarCacheJob[];
  clearWaiting: () => void;
}

interface Resolver {
  resolve: (src: string | null) => void;
}

/** screenName → 本地文件绝对路径 */
const pathCache = new Map<string, string>();
/** 等待同一账号的 Promise 解析器 */
const resolvers = new Map<string, Resolver[]>();
/** 已入队/进行中的任务详情 */
const jobMap = new Map<string, AvatarCacheJob>();

export const useAvatarCacheStore = create<AvatarCacheStore>((set) => ({
  jobs: [],
  clearWaiting: () => {
    clearAvatarCacheWaiting();
    set({
      jobs: [...jobMap.values()].filter((j) => j.status === 'running'),
    });
  },
}));

function syncStoreJobs() {
  useAvatarCacheStore.setState({
    jobs: [...jobMap.values()].sort((a, b) => a.enqueuedAt - b.enqueuedAt),
  });
}

function normalizeScreenName(screenName: string): string {
  return screenName.trim().replace(/^@/, '').toLowerCase();
}

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
    const bin = atob(body);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  throw new Error('unsupported binary body');
}

async function tryLocalSrc(sn: string, url: string): Promise<string | null> {
  const key = normalizeScreenName(sn);
  const dir = await ensureCacheDir();
  const base = safeFileBase(sn);
  const ext = extFromUrl(url);
  const filePath = await path.join(dir, `${base}${ext}`);
  const metaPath = await path.join(dir, `${base}.url`);

  const cachedPath = pathCache.get(key);
  if (cachedPath && (await fs.exists(cachedPath))) {
    const recorded = await readCachedUrl(metaPath);
    if (recorded === url) return convertFileSrc(cachedPath);
  }

  if (await fs.exists(filePath)) {
    const recorded = await readCachedUrl(metaPath);
    if (recorded === url) {
      pathCache.set(key, filePath);
      return convertFileSrc(filePath);
    }
  }
  return null;
}

async function downloadAvatar(sn: string, url: string): Promise<string> {
  const key = normalizeScreenName(sn);
  const dir = await ensureCacheDir();
  const base = safeFileBase(sn);
  const ext = extFromUrl(url);
  const filePath = await path.join(dir, `${base}${ext}`);
  const metaPath = await path.join(dir, `${base}.url`);

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
}

function finishJob(key: string, result: string | null) {
  const list = resolvers.get(key) ?? [];
  resolvers.delete(key);
  jobMap.delete(key);
  syncStoreJobs();
  for (const r of list) r.resolve(result);
  void pump();
}

async function runJob(job: AvatarCacheJob) {
  const key = normalizeScreenName(job.screenName);
  job.status = 'running';
  jobMap.set(key, job);
  syncStoreJobs();
  try {
    const local = await tryLocalSrc(job.screenName, job.url);
    if (local) {
      finishJob(key, local);
      return;
    }
    const src = await downloadAvatar(job.screenName, job.url);
    finishJob(key, src);
  } catch {
    finishJob(key, job.url);
  }
}

function pump() {
  const running = [...jobMap.values()].filter(
    (j) => j.status === 'running',
  ).length;
  if (running >= MAX_CONCURRENT) return;

  const waiting = [...jobMap.values()]
    .filter((j) => j.status === 'waiting')
    .sort((a, b) => a.enqueuedAt - b.enqueuedAt);

  const slots = MAX_CONCURRENT - running;
  for (let i = 0; i < Math.min(slots, waiting.length); i++) {
    void runJob(waiting[i]);
  }
}

/**
 * 解析头像展示地址：本地命中即时返回；否则入限速队列下载。
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

  try {
    const local = await tryLocalSrc(sn, url);
    if (local) return local;
  } catch {
    // 继续入队
  }

  return new Promise<string | null>((resolve) => {
    const list = resolvers.get(key) ?? [];
    list.push({ resolve });
    resolvers.set(key, list);

    if (!jobMap.has(key)) {
      jobMap.set(key, {
        screenName: sn,
        url,
        status: 'waiting',
        enqueuedAt: Date.now(),
      });
      syncStoreJobs();
    } else {
      const existing = jobMap.get(key)!;
      existing.url = url;
      jobMap.set(key, existing);
    }

    void pump();
  });
}

/** 清空等待中的头像缓存任务（进行中的继续跑完） */
export function clearAvatarCacheWaiting() {
  const toCancel = [...jobMap.entries()].filter(
    ([, j]) => j.status === 'waiting',
  );
  for (const [key, job] of toCancel) {
    jobMap.delete(key);
    const list = resolvers.get(key) ?? [];
    resolvers.delete(key);
    for (const r of list) r.resolve(job.url);
  }
  syncStoreJobs();
}
