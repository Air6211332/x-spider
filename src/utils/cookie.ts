import * as R from 'ramda';

export function parseCookie(cookieString: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of cookieString.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    result[key] = value;
  }
  return result;
}

export function stringifyCookie(cookie: Record<string, string>): string {
  return R.pipe(R.toPairs, R.map(R.join('=')), R.join(';'))(cookie);
}
