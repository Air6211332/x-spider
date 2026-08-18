import { Route } from '../interfaces/Route';
import {
  HomeFilled,
  SettingFilled,
  DownloadOutlined,
  InfoCircleFilled,
  StarFilled,
  ThunderboltFilled,
  TeamOutlined,
  UnorderedListOutlined,
  BookOutlined,
  HeartOutlined,
  ProfileOutlined,
} from '@ant-design/icons';
import { Homepage } from '../pages/Homepage';
import { Favorites } from '../pages/Favorites';
import { Following } from '../pages/Following';
import { AutoDownload } from '../pages/AutoDownload';
import { DownloadManagement } from '../pages/DownloadManagement';
import { QueueManagement } from '../pages/QueueManagement';
import { Settings } from '../pages/Settings';
import { About } from '../pages/About';
import { Bookmarks } from '../pages/Bookmarks';
import { Likes } from '../pages/Likes';
import { XLists } from '../pages/XLists';

export const ROUTES: Route[] = [
  {
    id: 'home',
    name: '主页',
    icon: <HomeFilled />,
    element: <Homepage />,
  },
  {
    id: 'following',
    name: '我的关注',
    icon: <TeamOutlined />,
    element: <Following />,
  },
  {
    id: 'favorites',
    name: '我的收藏',
    icon: <StarFilled />,
    element: <Favorites />,
  },
  {
    id: 'bookmarks',
    name: '书签',
    icon: <BookOutlined />,
    element: <Bookmarks />,
  },
  {
    id: 'likes',
    name: '喜欢',
    icon: <HeartOutlined />,
    element: <Likes />,
  },
  {
    id: 'x-lists',
    name: 'X 列表',
    icon: <ProfileOutlined />,
    element: <XLists />,
  },
  {
    id: 'auto-download',
    name: '自动下载',
    icon: <ThunderboltFilled />,
    element: <AutoDownload />,
  },
  {
    id: 'queue-management',
    name: '队列管理',
    icon: <UnorderedListOutlined />,
    element: <QueueManagement />,
  },
  {
    id: 'download-management',
    name: '下载管理',
    icon: <DownloadOutlined />,
    element: <DownloadManagement />,
  },
  {
    id: 'settings',
    name: '设置',
    icon: <SettingFilled />,
    element: <Settings />,
  },
  {
    id: 'about',
    name: '关于',
    icon: <InfoCircleFilled />,
    element: <About />,
  },
];
