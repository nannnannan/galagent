export type Expression = 'neutral' | 'curious' | 'pleased' | 'flustered' | 'annoyed' | 'softened' | 'blink';
export type PetAction = 'idle' | 'nod' | 'sway' | 'peek' | 'sulk' | 'celebrate' | 'wave' | 'sparkle' | 'doodle' | 'run';
export type PersonaStage = 'adapting' | 'awkward' | 'tsundere' | 'settled';
export type PersonaFace = 'daily' | 'work' | 'disagreement';
export type PersonaVariables = {
  version: 1;
  core: { traits: readonly string[]; hobbies: readonly string[]; motifs: readonly string[] };
  expression: { proficiency: number; stage: 'unified'; practiceDays: number; eventKinds: string[]; migrated: boolean };
  relationship: { trust: number; familiarity: number; self_awareness: number; exposure: number };
  emotion: { expression: Expression; strength: number; expiresAt: number };
  scene: { face: PersonaFace; expiresAt: number };
  presentation: { expression: Expression; action: PetAction; intensity: number; expiresAt: number };
  time: { now: string; lastInteractionAt?: string; elapsedSeconds: number; rate: 1 };
};
export type Observation = {
  available: boolean;
  observedAt: string;
  appName?: string;
  title?: string;
  idleSeconds?: number;
  fullscreen?: boolean;
  locked?: boolean;
  suspended?: boolean;
  error?: string;
};
export type Settings = {
  observationEnabled: boolean;
  windowTitlesEnabled: boolean;
  initiativeEnabled: boolean;
  mischiefEnabled: boolean;
  quietUntil: number;
  proactiveIntervalMinutes: number;
  proactiveHourlyLimit: number;
  proactiveDailyLimit: number;
  petScale: number;
  reducedMotion: boolean;
  /** DUAL-CORE perception; both still require observationEnabled. */
  screenCaptureEnabled: boolean;
  clipboardEnabled: boolean;
  captureBlocklist: string[];
  /** Optional forbidden folder list (Master Design 9.3). */
  forbiddenPaths?: string[];
  /** Desktop Live2D roaming (running back and forth across screen). */
  roamingEnabled?: boolean;
  /** TTS voice synthesis settings. */
  ttsEnabled?: boolean;
  ttsBaseUrl?: string;
  ttsModel?: string;
  ttsVoice?: string;
  ttsSpeed?: number;
};
export type Message = { id: string; role: 'user' | 'assistant'; text: string; createdAt: string; source: 'chat' | 'initiative' | 'scene' };
export type MemoryItem = { id: string; kind: 'fact' | 'episode' | 'reflection'; text: string; sourceId: string; createdAt: string; valid: boolean; validFrom?: string; validTo?: string; supersedes?: string; importance?: number };
export type DiaryEntry = { id: string; text: string; createdAt: string; sourceIds: string[]; kind?: 'note' | 'journal'; title?: string };
export type StoryScene = { type: 'E01' | 'E02' | 'E03' | 'E04' | 'E05' | 'E06'; key: string; sourceIds: string[]; evidence: Record<string, unknown> };
export type StoryEpisode = StoryScene & { id: string; createdAt: string; historical?: boolean };
export type StorySnapshot = { mood: { expression: Expression; strength: number; expiresAt: number }; goals: { position: { placed: boolean; placements: number; lastPlacedAt?: string }; notebook: { entries: number; lastEntryAt?: string } }; recentEpisodes: StoryEpisode[] };
export type BackgroundTask = { id: string; label: string; state: 'queued' | 'running' | 'done' | 'failed'; detail?: string };
export type AgentQuestion={id:string;questions:{question:string;options:{label:string;description?:string}[];multi_select?:boolean}[]};
export type PoolView = { limit: number; effectiveLimit: number; inflight: number; queued: number; peak: number };
export type AttentionView = { enabled: boolean; running: boolean; paused?: string; lastAt?: string; lastDecision?: 'silent' | 'observe' | 'schedule' | 'wake'; lastReason?: string; evaluations: number; skippedHeartbeats: number; wakes: number; pendingEvents: number; activeWatches: number; nextCheckAt?: string; lastScreenAt?: string; lastSkip?: string };
export type WatchView = { id: string; title: string; condition?: string; createdAt: number; nextCheckAt: number; expiresAt: number; status: 'active' | 'done' | 'cancelled' | 'expired'; dedupeKey: string; lastResult?: string };
export type BrowserView = {
  connected: boolean;
  source?: string;
  observedAt?: string;
  permissionDenied?: string[];
  activeTab?: { url: string; title: string; tabId?: number; updatedAt: string };
  openTabs: { tabId?: number; url: string; title: string; active?: boolean }[];
  tabCount: number;
  bookmarkCount: number;
  historyCount: number;
  pageContent?: { url: string; title: string; excerpt: string; capturedAt: string; readable: boolean; reason?: string };
};
export type ProviderMode = 'mira-proxy' | 'native-api';
export type AppSnapshot = {
  agent?: {backend:'openai-kimi-tools';mode:'full-access'|'directory-guarded';cwd:string;busy:boolean;forbiddenPaths?:string[];policyVersion?:number;questions?:AgentQuestion[];lastResult?:{status:'done'|'failed'|'cancelled';summary:string;toolCount:number;completedAt:string}};
  variables?: PersonaVariables;
  story?: StorySnapshot;
  watches?: WatchView[];
  browser?: BrowserView;
  identity: { id: string; name: string; onboarding: 'intro' | 'naming' | 'ready'; stage: 'S0' | 'S2' | 'S3' | 'S4' };
  visual: { expression: Expression; action: PetAction; bubble: string; revision: number; intensity?: number };
  messages: Message[];
  memories: MemoryItem[];
  diary: DiaryEntry[];
  settings: Settings;
  provider: { configured: boolean; baseUrl: string; model: string; mode?: ProviderMode; toolCount?: number };
  status: { busy: boolean; error?: string; online: boolean; embedding: 'loading' | 'ready' | 'fallback' | 'idle'; contextTokens: number; contextBudget: number; tasks: BackgroundTask[]; pool?: PoolView; attention?: AttentionView; perception?: { clipboardEntries: number; lastScreenAt?: string; browserConnected?: boolean; activeUrl?: string }; journal?: { counter: number; every: number } };
  observation: Observation;
  stats: { conversations: number; memories: number; proactiveToday: number; tokensToday: number; lastSeenAt?: string };
};
export type AppCommand =
  | { type: 'agent.run'; task: string }
  | { type: 'agent.cancel' }
  | { type: 'agent.configure'; cwd: string }
  | { type: 'agent.answer'; id:string; answers:Record<string,string> }
  | { type: 'chat.send'; text: string }
  | { type: 'chat.cancel' }
  | { type: 'pet.interact'; interaction: 'tap' | 'drag' }
  | { type: 'pet.roam'; active?: boolean; direction?: -1 | 1 }
  | { type: 'tts.speak'; text: string }
  | { type: 'tts.configure'; ttsEnabled?: boolean; ttsBaseUrl?: string; ttsModel?: string; ttsVoice?: string; ttsSpeed?: number; ttsApiKey?: string }
  | { type: 'settings.update'; settings: Partial<Settings> }
  | { type: 'config.save'; apiKey?: string; baseUrl: string; model: string; mode?: ProviderMode }
  | { type: 'memory.delete'; id: string }
  | { type: 'memory.correct'; id: string; text: string }
  | { type: 'memory.remember'; text: string }
  | { type: 'watch.add'; title: string; condition?: string; checkAfterMinutes?: number }
  | { type: 'watch.dismiss'; id: string }
  | { type: 'browser.report'; report: Record<string, unknown> }
  | { type: 'browser.disconnect' }
  | { type: 'initiative.check' }
  | { type: 'shell.chat'; open?: boolean }
  | { type: 'shell.input'; open: boolean }
  | { type: 'shell.drag'; dx: number; dy: number }
  | { type: 'shell.pointer'; interactive: boolean }
  | { type: 'shell.menu' }
  | { type: 'shell.resetPosition' }
  | { type: 'app.export' }
  | { type: 'app.import' }
  | { type: 'app.quit' };
export type CommandResult = { ok: boolean; error?: string; data?: unknown };
export type GalAgentBridge = {
  getWindowVisibility?(): Promise<boolean>;
  onWindowVisibility?(listener: (visible: boolean) => void): () => void;
  getSnapshot(): Promise<AppSnapshot>;
  dispatch(command: AppCommand): Promise<CommandResult>;
  onSnapshot(listener: (snapshot: AppSnapshot) => void): () => void;
  onHitTest?(listener: (point: {x:number;y:number}) => boolean): () => void;
  onRoamState?(listener: (state: { active: boolean; direction: -1 | 0 | 1 }) => void): () => void;
  readLive2DAsset?(relPath: string): Promise<Uint8Array | ArrayBuffer>;
  synthesizeSpeech?(text: string): Promise<{ ok: boolean; provider?: string; audioBase64?: string; mimeType?: string; fallbackText?: string; voice?: string; speed?: number; error?: string }>;
};
declare global { interface Window { galagent: GalAgentBridge } }


