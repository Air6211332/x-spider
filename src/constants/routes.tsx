import { Route } from '../interfaces/Route';
import {
  HomeFilled,
  SettingFilled,
  DownloadOutlined,
  InfoCircleFilled,
  StarFilled,
  ThunderboltFilled,
} from '@ant-design/icons';
import { Homepage } from '../pages/Homepage';
import { Favorites } from '../pages/Favorites';
import { AutoDownload } from '../pages/AutoDownload';
import { DownloadManagement } from '../pages/DownloadManagement';
import { Settings } from '../pages/Settings';
import { About } from '../pages/About';

export const ROUTES: Route[] = [
  {
    id: 'home',
    name: '主页',
    icon: <HomeFilled />,
    element: <Homepage />,
  },
  {
    id: 'favorites',
    name: '我的收藏',
    icon: <StarFilled />,
    element: <Favorites />,
  },
  {
    id: 'auto-download',
    name: '自动下载',
    icon: <ThunderboltFilled />,
    element: <AutoDownload />,
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
