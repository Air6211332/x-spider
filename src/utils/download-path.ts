import { fs, path } from '@tauri-apps/api';
import { TwitterMedia } from '../interfaces/TwitterMedia';
import { TwitterPost } from '../interfaces/TwitterPost';
import { FileNameTemplateData } from '../interfaces/FileNameTemplateData';
import { resolveVariables } from './file-name-template';
import { useSettingsStore } from '../stores/settings';

/** 按当前设置解析媒体本地完整路径（与下载任务一致） */
export async function resolveDownloadFilePath(
  post: TwitterPost,
  media: TwitterMedia,
): Promise<string> {
  const settings = useSettingsStore.getState();
  const templateData: FileNameTemplateData = { media, post };
  const resolvedDirName = settings.download.dirTemplate
    ? resolveVariables(settings.download.dirTemplate, templateData)
    : '';
  const dir = await path.join(settings.download.saveDirBase, resolvedDirName);
  const fileName = resolveVariables(
    settings.download.fileNameTemplate,
    templateData,
  );
  return path.join(dir, fileName);
}

/** 判断模板路径下文件是否存在 */
export async function downloadFileExists(
  post: TwitterPost,
  media: TwitterMedia,
): Promise<boolean> {
  const filePath = await resolveDownloadFilePath(post, media);
  return fs.exists(filePath);
}
