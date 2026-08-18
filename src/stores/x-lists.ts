import { create } from 'zustand';
import MediaType from '../enums/MediaType';
import { DownloadFilter } from '../interfaces/DownloadFilter';
import { TwitterList } from '../interfaces/TwitterList';
import { TwitterPost } from '../interfaces/TwitterPost';
import { getLists, getListTimeline } from '../twitter/api';

export interface XListsStore {
  filter: DownloadFilter;
  setFilter: (filter: DownloadFilter) => void;

  lists: TwitterList[];
  listsLoading: boolean;
  loadLists: () => Promise<void>;

  selectedListId: string | null;
  selectList: (listId: string | null) => void;

  postList: {
    list?: TwitterPost[];
    loading: boolean;
    cursor: string | null;
  };
  clearPostList: () => void;
  loadPostList: () => Promise<void>;
  loadMorePostList: () => Promise<void>;
}

export const useXListsStore = create<XListsStore>((set, get) => ({
  filter: {
    mediaTypes: [MediaType.Photo, MediaType.Video, MediaType.Gif],
    source: 'tweets',
  },
  setFilter: (filter) => set({ filter: { ...filter, source: 'tweets' } }),

  lists: [],
  listsLoading: false,
  loadLists: async () => {
    set({ listsLoading: true });
    try {
      const lists = await getLists();
      set({ lists, listsLoading: false });
    } catch (err) {
      set({ lists: [], listsLoading: false });
      throw err;
    }
  },

  selectedListId: null,
  selectList: (listId) => {
    set({
      selectedListId: listId,
      postList: { list: undefined, loading: false, cursor: null },
    });
  },

  postList: {
    list: undefined,
    loading: false,
    cursor: null,
  },
  clearPostList: () =>
    set({
      postList: { list: undefined, loading: false, cursor: null },
    }),
  loadPostList: async () => {
    const listId = get().selectedListId;
    if (!listId) return;
    set({
      postList: { list: undefined, loading: true, cursor: null },
    });
    try {
      const { twitterPosts, cursor } = await getListTimeline(listId);
      set({
        postList: {
          list: twitterPosts,
          loading: false,
          cursor,
        },
      });
    } catch (err) {
      set({
        postList: { list: undefined, loading: false, cursor: null },
      });
      throw err;
    }
  },
  loadMorePostList: async () => {
    const { postList, selectedListId } = get();
    if (!selectedListId || !postList.cursor || postList.loading) return;
    set({
      postList: { ...postList, loading: true },
    });
    try {
      const { twitterPosts, cursor } = await getListTimeline(
        selectedListId,
        postList.cursor,
      );
      set({
        postList: {
          list: [...(postList.list || []), ...twitterPosts],
          loading: false,
          cursor,
        },
      });
    } catch (err) {
      set({
        postList: { ...get().postList, loading: false },
      });
      throw err;
    }
  },
}));
