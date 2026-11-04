// 常用 MCP 服务的一键模板。只收录安装方式在其 npm 说明里查证过的官方 / 主流包（2026-11-04 核对），
// 版本号锁到大版本（0.x 锁到确切版本），避免 `@latest` 把未审阅的新版本直接拉进用户电脑。
// 模板只决定“命令 + 参数 + 需要哪些密钥名”；密钥的值由用户在界面里填，经 mcp.secret 交给桌面进程 DPAPI 加密，
// 设置与快照只存名称（AGENTS.md 红线 5）。
export type McpPresetSecret = {
  /** 环境变量名（本地服务）或请求头名（远程服务）。 */
  key: string;
  label: string;
  hint: string;
  /** 用户只填令牌时自动补上的前缀，例如 "Bearer "。 */
  prefix?: string;
  /** 这个值是文件路径而不是密钥（仍按密钥加密保存，界面用普通输入框）。 */
  path?: boolean;
};
export type McpPreset = {
  id: string;
  /** 加进设置时的服务名（字母数字 _ -）。 */
  name: string;
  title: string;
  category: '文件与笔记' | '日程与待办' | '开发' | '浏览器';
  description: string;
  command?: string;
  args?: string[];
  url?: string;
  /** 需要用户选一个文件夹，追加为最后一个参数。 */
  folder?: { label: string; hint: string };
  secrets?: McpPresetSecret[];
  /** 首次使用前要做的事（登录、授权等），给用户看。 */
  setup?: string;
  /** 官方说明页。 */
  docs: string;
};

export const MCP_PRESETS: readonly McpPreset[] = [
  {
    id: 'folder', name: 'files', title: '本地文件夹', category: '文件与笔记',
    description: '让执行代理在你选的文件夹里列目录、读写、搜索文件。适合资料库、项目文件夹。',
    command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem@2'],
    folder: { label: '允许访问的文件夹', hint: '只开放这一个文件夹（含子文件夹）。不能选 GalAgent 自己的数据目录。' },
    docs: 'https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem',
  },
  {
    id: 'notes', name: 'notes', title: 'Obsidian / Markdown 笔记库', category: '文件与笔记',
    description: '把你的笔记库文件夹交给执行代理：查笔记、整理、按你的要求新建笔记。Obsidian 的库就是一个普通文件夹。',
    command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem@2'],
    folder: { label: '笔记库文件夹', hint: '选 Obsidian 库的根目录（里面有 .obsidian 文件夹的那个）。' },
    docs: 'https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem',
  },
  {
    id: 'notion', name: 'notion', title: 'Notion', category: '文件与笔记',
    description: '查找、阅读、更新 Notion 页面与数据库（官方服务）。',
    command: 'npx', args: ['-y', '@notionhq/notion-mcp-server@2'],
    secrets: [{ key: 'NOTION_TOKEN', label: 'Notion 集成令牌', hint: '在 notion.so/profile/integrations 新建内部集成，复制 ntn_ 开头的令牌，并把要用的页面分享给这个集成。' }],
    docs: 'https://www.npmjs.com/package/@notionhq/notion-mcp-server',
  },
  {
    id: 'todoist', name: 'todoist', title: 'Todoist 待办', category: '日程与待办',
    description: '查看今天的待办、添加和完成任务（Todoist 官方服务）。',
    command: 'npx', args: ['-y', '@doist/todoist-mcp@13'],
    secrets: [{ key: 'TODOIST_API_KEY', label: 'Todoist API 令牌', hint: 'Todoist → 设置 → 集成 → 开发者，复制 API 令牌。' }],
    docs: 'https://www.npmjs.com/package/@doist/todoist-mcp',
  },
  {
    id: 'google-calendar', name: 'gcal', title: 'Google 日历', category: '日程与待办',
    description: '查看和安排 Google 日历日程。',
    command: 'npx', args: ['-y', '@cocal/google-calendar-mcp@2'],
    secrets: [{ key: 'GOOGLE_OAUTH_CREDENTIALS', label: 'OAuth 凭据文件路径', hint: '在 Google Cloud 控制台创建“桌面应用”OAuth 客户端，下载 JSON，填它在本机的完整路径。', path: true }],
    setup: '第一次使用时会打开浏览器让你登录 Google 并授权。',
    docs: 'https://www.npmjs.com/package/@cocal/google-calendar-mcp',
  },
  {
    id: 'outlook', name: 'outlook', title: 'Outlook 日历与待办（微软账户）', category: '日程与待办',
    description: '个人微软账户的日历、To Do 待办、邮件与 OneDrive。',
    command: 'npx', args: ['-y', '@softeria/ms-365-mcp-server@0', '--preset', 'personal'],
    setup: '不用填密钥。第一次用时执行代理会给出一个网址和验证码，你在浏览器里登录微软账户即可；登录凭据由该服务存进系统凭据库。',
    docs: 'https://www.npmjs.com/package/@softeria/ms-365-mcp-server',
  },
  {
    id: 'github', name: 'github', title: 'GitHub', category: '开发',
    description: '仓库、Issue、PR、代码搜索（GitHub 官方远程服务）。',
    url: 'https://api.githubcopilot.com/mcp/',
    secrets: [{ key: 'Authorization', label: 'GitHub 个人访问令牌', hint: 'GitHub → Settings → Developer settings → Personal access tokens，按需勾选权限。只填令牌本身即可。', prefix: 'Bearer ' }],
    docs: 'https://github.com/github/github-mcp-server',
  },
  {
    id: 'playwright', name: 'browser', title: '浏览器自动化（Playwright）', category: '浏览器',
    description: '打开网页、点击、填表、截图，能处理需要登录或动态加载的网站。',
    command: 'npx', args: ['-y', '@playwright/mcp@0.0.84'],
    setup: '第一次使用会下载浏览器内核，需要几分钟。',
    docs: 'https://www.npmjs.com/package/@playwright/mcp',
  },
];

export const mcpPreset = (id: string) => MCP_PRESETS.find(p => p.id === id);

/** A free server name based on the preset's: files, files-2, files-3… */
export function presetServerName(preset: McpPreset, taken: string[]): string {
  if (!taken.includes(preset.name)) return preset.name;
  for (let i = 2; i < 100; i++) if (!taken.includes(`${preset.name}-${i}`)) return `${preset.name}-${i}`;
  return `${preset.name}-${Date.now() % 10000}`;
}

/** The settings entry for a preset (folder appended when it needs one). Secret values and names never go here. */
export function presetServer(preset: McpPreset, taken: string[], folder?: string) {
  const name = presetServerName(preset, taken);
  if (preset.folder && !folder?.trim()) throw new Error(`「${preset.title}」需要先选一个文件夹`);
  // Secret names are recorded by mcp.secret once a value is actually saved, so the list never claims a key that is missing.
  if (preset.url) return { name, url: preset.url, enabled: true };
  return { name, command: preset.command!, args: [...(preset.args || []), ...(preset.folder ? [folder!.trim()] : [])], enabled: true };
}

/** Secret values as typed by the user → the map handed to mcp.secret (prefix added, blanks dropped). */
export function presetSecrets(preset: McpPreset, values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of preset.secrets || []) {
    const v = (values[s.key] || '').trim(); if (!v) continue;
    out[s.key] = s.prefix && !v.toLowerCase().startsWith(s.prefix.trim().toLowerCase()) ? s.prefix + v : v;
  }
  return out;
}
