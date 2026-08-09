import dayjs from 'dayjs';
import { nanoid } from 'nanoid';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  AutoDownloadList,
  AutoDownloadMember,
} from '../interfaces/AutoDownloadList';
import { FavoriteUser } from '../interfaces/FavoriteUser';
import { TwitterUser } from '../interfaces/TwitterUser';
import { createTauriFileStorage } from './persist/tauri-file-storage';

export function fromTwitterUser(user: TwitterUser): AutoDownloadMember {
  return {
    id: user.id,
    screenName: user.screenName,
    name: user.name,
    avatar: user.avatar,
    mediaCount: user.mediaCount,
    registerTime: user.registerTime.toISOString(),
  };
}

export function fromFavoriteUser(user: FavoriteUser): AutoDownloadMember {
  return {
    id: user.id,
    screenName: user.screenName,
    name: user.name,
    avatar: user.avatar,
    mediaCount: user.mediaCount,
    registerTime: user.registerTime,
  };
}

export function memberToTwitterUser(member: AutoDownloadMember): TwitterUser {
  return {
    id: member.id,
    screenName: member.screenName,
    name: member.name,
    avatar: member.avatar,
    mediaCount: member.mediaCount,
    registerTime: dayjs(member.registerTime),
  };
}

function upsertMember(
  members: AutoDownloadMember[],
  member: AutoDownloadMember,
): AutoDownloadMember[] {
  const idx = members.findIndex((m) => m.id === member.id);
  if (idx < 0) return [...members, member];
  const next = [...members];
  next[idx] = { ...next[idx], ...member };
  return next;
}

export interface AutoDownloadStore {
  lists: AutoDownloadList[];
  createList: (title: string) => string | null;
  removeList: (listId: string) => void;
  renameList: (listId: string, title: string) => void;
  addMember: (listId: string, user: TwitterUser) => void;
  addMemberToLists: (listIds: string[], user: TwitterUser) => void;
  removeMember: (listId: string, userId: string) => void;
}

export const useAutoDownloadStore = create(
  persist<AutoDownloadStore>(
    (set, get) => ({
      lists: [],
      createList: (title) => {
        const trimmed = title.trim();
        if (!trimmed) return null;
        const id = nanoid();
        const list: AutoDownloadList = {
          id,
          title: trimmed,
          createdAt: Date.now(),
          members: [],
        };
        set({ lists: [list, ...get().lists] });
        return id;
      },
      removeList: (listId) => {
        set({ lists: get().lists.filter((l) => l.id !== listId) });
      },
      renameList: (listId, title) => {
        const trimmed = title.trim();
        if (!trimmed) return;
        set({
          lists: get().lists.map((l) =>
            l.id === listId ? { ...l, title: trimmed } : l,
          ),
        });
      },
      addMember: (listId, user) => {
        const member = fromTwitterUser(user);
        set({
          lists: get().lists.map((l) =>
            l.id === listId
              ? { ...l, members: upsertMember(l.members, member) }
              : l,
          ),
        });
      },
      addMemberToLists: (listIds, user) => {
        const ids = new Set(listIds);
        if (ids.size === 0) return;
        const member = fromTwitterUser(user);
        set({
          lists: get().lists.map((l) =>
            ids.has(l.id)
              ? { ...l, members: upsertMember(l.members, member) }
              : l,
          ),
        });
      },
      removeMember: (listId, userId) => {
        set({
          lists: get().lists.map((l) =>
            l.id === listId
              ? { ...l, members: l.members.filter((m) => m.id !== userId) }
              : l,
          ),
        });
      },
    }),
    {
      name: 'auto-download',
      storage: createTauriFileStorage(),
      version: 1,
    },
  ),
);
