export type WorkspaceFile = {
  path: string;
  content: string;
  updatedAt: string;
};

export type Attachment = {
  name: string;
  size: number;
  content?: string;
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  attachments?: string[];
};

export type ChatThread = {
  id: string;
  title: string;
  updatedAt: string;
  messages: ChatMessage[];
};

export type GitHubRemote = {
  provider: 'github';
  owner: string;
  repo: string;
  private: boolean;
  sourceBranch: string;
  baseCommitSha: string;
  baseTreeSha: string;
  baselineShas: Record<string, string>;
  htmlUrl: string;
};

export type GitHubRepository = {
  id: number;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
  canPush: boolean;
  description?: string;
};

export type GitHubChange = {
  path: string;
  content: string | null;
  baseSha: string | null;
};

export type Project = {
  id: string;
  name: string;
  updatedAt: string;
  source?: string;
  githubRemote?: GitHubRemote;
  threads: ChatThread[];
  activeThreadId: string;
  files: WorkspaceFile[];
};

export type AgentMode = 'build' | 'explain' | 'review';

export type UserSettings = {
  agentMode: AgentMode;
  responseStyle: 'balanced' | 'detailed';
  githubAppClientId: string;
};

export type AppState = {
  projects: Project[];
  activeProjectId: string;
  settings: UserSettings;
};
