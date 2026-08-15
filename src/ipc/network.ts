import { invoke } from '@tauri-apps/api';
import { Response } from '../interfaces/Response';
import { RequestOptions } from '../interfaces/RequestOptions';
import * as R from 'ramda';
import { useSettingsStore } from '../stores/settings';
import { useAppStateStore } from '../stores/app-state';
import { delay } from '../utils';

const MAX_RETRY_COUNT = 16;
const MAX_RETRY_DELAY = 16000;

let log: ICategoriedLogger;

/**
 * 解析实际代理地址。
 * 勾选「使用系统代理」但系统未开启时，回退到自定义代理 URL（默认 7890），
 * 避免直连超时导致登录失败。
 */
export function resolveProxyUrlForRequest(): {
  enableProxy: boolean;
  proxyUrl: string;
} {
  const settings = useSettingsStore.getState();
  if (!settings.proxy.enable) {
    return { enableProxy: false, proxyUrl: '' };
  }

  if (settings.proxy.useSystem) {
    const systemProxyUrl = useAppStateStore.getState().systemProxyUrl;
    if (systemProxyUrl) {
      // Rust 侧 proxy_url 为空表示跟随系统；此处传空即可
      return { enableProxy: true, proxyUrl: '' };
    }
    // 系统代理未启用 → 回退自定义地址
    return {
      enableProxy: true,
      proxyUrl: settings.proxy.url || 'http://127.0.0.1:7890',
    };
  }

  return { enableProxy: true, proxyUrl: settings.proxy.url };
}

export async function request(options: RequestOptions) {
  if (!log) {
    log = window.log.category('NET');
  }
  const url = new URL(options.url);

  if (options.query) {
    Object.entries(options.query).forEach(([k, v]) => {
      url.searchParams.append(k, v);
    });
  }

  const { enableProxy, proxyUrl } = resolveProxyUrlForRequest();
  let remainingRetryCount = MAX_RETRY_COUNT;
  let retryDelay = 100;
  let lastErr: any;

  while (remainingRetryCount > 0) {
    try {
      return await requestInternal(
        R.defaultTo('GET', options.method),
        url.href,
        R.defaultTo('', options.body),
        enableProxy,
        proxyUrl,
        R.defaultTo({}, options.headers),
        options.responseType,
      );
    } catch (err: any) {
      lastErr = err;
      log.warn(
        `Request failed, retry after ${retryDelay}ms, remaining retry count: ${remainingRetryCount}`,
        err,
      );
      await delay(retryDelay);
      remainingRetryCount--;
      retryDelay *= 2;
      if (retryDelay > MAX_RETRY_DELAY) {
        retryDelay = MAX_RETRY_DELAY;
      }
    }
  }

  log.error('Max retry count reached, last error:', lastErr);
  throw lastErr;
}

let reqIdGlobal = 0;

async function requestInternal(
  method: string,
  url: string,
  body: string,
  enableProxy: boolean,
  proxyUrl: string,
  headers: Record<string, string>,
  responseType: string,
): Promise<Response> {
  const startTs = Date.now();
  const reqId = reqIdGlobal++;
  log.info(`REQ_${reqId}`, method, url, {
    body,
    enableProxy,
    proxyUrl,
    headers: {
      ...headers,
      Cookie: headers.Cookie ? '******' : undefined,
    },
    responseType,
  });

  const res = await invoke<Response>('network_fetch', {
    method,
    url,
    body,
    enableProxy,
    proxyUrl,
    headers,
    responseType,
  });

  const endTs = Date.now() - startTs;
  log.info(`RES_${reqId}(+${endTs}ms)`, res.status, url, res);

  return res;
}

export async function getSystemProxy(): Promise<string> {
  const map: Record<string, string> = await invoke(
    'network_get_system_proxy_url',
  );
  const value = map.https || map.http;
  if (value) {
    return `http://${value}`;
  }
  return '';
}
