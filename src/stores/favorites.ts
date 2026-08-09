import dayjs from 'dayjs';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { FavoriteUser } from '../interfaces/FavoriteUser';
import { TwitterUser } from '../interfaces/TwitterUser';
import { createTauriFileStorage } from './persist/tauri-file-storage';

export function favoriteToTwitterUser(item: FavoriteUser): TwitterUser {
  return {
    id: item.id,
    screenName: item.screenName,
    name: item.name,
    avatar: item.avatar,
    mediaCount: item.mediaCount,
    registerTime: dayjs(item.registerTime),
  };
}

function twitterUserToFavorite(
  user: TwitterUser,
  prev?: FavoriteUser,
): FavoriteUser {
  return {
    id: user.id,
    screenName: user.screenName,
    name: user.name,
    avatar: user.avatar,
    mediaCount: user.mediaCount,
    registerTime: user.registerTime.toISOString(),
    favoritedAt: prev?.favoritedAt ?? Date.now(),
    lastStartedAt: prev?.lastStartedAt ?? null,
    noteName: prev?.noteName ?? '',
    note: prev?.note ?? '',
    tags: prev?.tags ?? [],
  };
}

export interface FavoriteMetaPatch {
  noteName?: string;
  note?: string;
  tags?: string[];
}

export interface FavoritesStore {
  items: FavoriteUser[];
  addFavorite: (user: TwitterUser) => void;
  removeFavorite: (id: string) => void;
  removeFavoriteByScreenName: (screenName: string) => void;
  updateFavoriteMeta: (id: string, patch: FavoriteMetaPatch) => void;
  isFavorite: (id: string) => boolean;
  touchStarted: (id: string) => void;
  getById: (id: string) => FavoriteUser | undefined;
}

function normalizeFavorite(raw: Partial<FavoriteUser>): FavoriteUser | null {
  if (!raw?.id || !raw.screenName) return null;
  return {
    id: raw.id,
    screenName: raw.screenName,
    name: raw.name ?? '',
    avatar: raw.avatar ?? '',
    registerTime: raw.registerTime ?? dayjs().toISOString(),
    mediaCount: raw.mediaCount,
    favoritedAt: raw.favoritedAt ?? Date.now(),
    lastStartedAt: raw.lastStartedAt ?? null,
    noteName: raw.noteName ?? '',
    note: raw.note ?? '',
    tags: Array.isArray(raw.tags) ? raw.tags : [],
  };
}

export const useFavoritesStore = create(
  persist<FavoritesStore>(
    (set, get) => ({
      items: [],
      addFavorite: (user) => {
        const prev = get().items.find((v) => v.id === user.id);
        const next = twitterUserToFavorite(user, prev);
        if (prev) {
          set({
            items: get().items.map((v) => (v.id === user.id ? next : v)),
          });
          return;
        }
        set({ items: [next, ...get().items] });
      },
      removeFavorite: (id) => {
        set({ items: get().items.filter((v) => v.id !== id) });
      },
      removeFavoriteByScreenName: (screenName) => {
        const target = screenName.toLowerCase();
        set({
          items: get().items.filter(
            (v) => v.screenName.toLowerCase() !== target,
          ),
        });
      },
      updateFavoriteMeta: (id, patch) => {
        set({
          items: get().items.map((v) => {
            if (v.id !== id) return v;
            return {
              ...v,
              noteName:
                patch.noteName !== undefined ? patch.noteName : v.noteName,
              note: patch.note !== undefined ? patch.note : v.note,
              tags: patch.tags !== undefined ? patch.tags : v.tags,
            };
          }),
        });
      },
      isFavorite: (id) => get().items.some((v) => v.id === id),
      touchStarted: (id) => {
        if (!get().isFavorite(id)) return;
        const now = Date.now();
        set({
          items: get().items.map((v) =>
            v.id === id ? { ...v, lastStartedAt: now } : v,
          ),
        });
      },
      getById: (id) => get().items.find((v) => v.id === id),
    }),
    {
      name: 'favorites',
      storage: createTauriFileStorage(),
      version: 3,
      migrate: (persisted: any) => {
        const state = persisted ?? { items: [] };
        const items = Array.isArray(state.items) ? state.items : [];
        const normalized: FavoriteUser[] = [];
        for (const item of items) {
          const next = normalizeFavorite(item);
          if (next) normalized.push(next);
        }
        return {
          ...state,
          items: normalized,
        };
      },
    },
  ),
);
