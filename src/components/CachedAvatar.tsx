/* eslint-disable react/prop-types */
import { Avatar } from 'antd';
import React, { useEffect, useState } from 'react';
import { resolveAvatarSrc } from '../utils/avatar-cache';

export interface CachedAvatarProps {
  /** @ 后的账号；空则不走本地缓存 */
  screenName?: string;
  src?: string;
  size?: number | 'large' | 'small' | 'default';
  alt?: string;
  className?: string;
  children?: React.ReactNode;
}

/**
 * 优先展示本地缓存头像；本地失效或加载失败时回退网络 URL。
 */
export const CachedAvatar: React.FC<CachedAvatarProps> = ({
  screenName,
  src,
  size,
  alt,
  className,
  children,
}) => {
  const remote = (src ?? '').trim();
  const [displaySrc, setDisplaySrc] = useState<string | undefined>(
    remote || undefined,
  );

  useEffect(() => {
    let cancelled = false;
    if (!remote) {
      setDisplaySrc(undefined);
      return;
    }
    setDisplaySrc(remote);
    void resolveAvatarSrc(screenName, remote).then((resolved) => {
      if (cancelled) return;
      if (resolved) setDisplaySrc(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [screenName, remote]);

  return (
    <Avatar
      src={displaySrc}
      size={size}
      alt={alt}
      className={className}
      onError={() => {
        if (remote && displaySrc !== remote) {
          setDisplaySrc(remote);
          return false;
        }
        return true;
      }}
    >
      {children}
    </Avatar>
  );
};
