/** X（Twitter）列表摘要 */
export interface TwitterList {
  id: string;
  name: string;
  description?: string;
  memberCount: number;
  subscriberCount?: number;
  mode?: string;
}
