import type { PersonaDraft, PersonaProfile } from './personas';
export type { PersonaDraft, PersonaProfile } from './personas';
export type Expression = 'neutral' | 'curious' | 'pleased' | 'flustered' | 'annoyed' | 'softened' | 'blink';
export type PetAction = 'idle' | 'nod' | 'sway' | 'peek' | 'sulk' | 'celebrate' | 'wave' | 'sparkle' | 'doodle' | 'run' | 'sleep' | 'think' | 'dizzy' | 'love';
export type PersonaStage = 'adapting' | 'awkward' | 'tsundere' | 'settled';
export type PersonaFace = 'daily' | 'work' | 'disagreement';
export type CompanionMode = 'daily' | 'focus' | 'rest';
export type InitiativeTopic = 'window' | 'clipboard' | 'browser' | 'task' | 'watch' | 'reunion' | 'unanswered' | 'system' | 'screen' | 'schedule' | 'greeting' | 'share' | 'recall';
export type InitiativeFeedback = 'welcome' | 'mute';
export type CompanionPreferences = { version: 1; topics: Partial<Record<InitiativeTopic, InitiativeFeedback>>; ratings: Record<string, InitiativeFeedback> };
export type PersonaVariables = {
  version: 1;
  core: { name: string; tagline: string; likes: string };
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
export type VitalityTone = 'asleep' | 'sleepy' | 'tired' | 'sulky' | 'happy' | 'lively' | 'calm';
export type VitalityView = { energy: number; mood: number; tone: VitalityTone; label: string };
export type Settings = {
  /** Missing in old saves means daily. Modes never change personality or access permissions. */
  companionMode?: CompanionMode;
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
  /** Pixel pet worn on the desktop; empty means the active persona's own avatar. */
  petId?: string;
  /** Attention heartbeat; events still wake it at once. */
  heartbeatSeconds?: number;
  /** Nudge when her last line went unanswered this long while the user is active. */
  unansweredMinutes?: number;
  /** Greet again after this long apart. */
  reunionHours?: number;
  /** Minimum gap between screenshots (never below 60 s). */
  screenIntervalSeconds?: number;
  /** Pet dozes off after the user has been idle this long; 0 disables. */
  idleSleepMinutes?: number;
  /** How long a speech bubble stays, in seconds. */
  bubbleSeconds?: number;
  /** Desktop roaming speed multiplier. */
  roamSpeed?: number;
  /** Daily do-not-disturb window in local time, e.g. 23:00 → 08:00. */
  quietHours?: { enabled: boolean; start: string; end: string };
  /** Shows small status captions and easter eggs above the pet. */
  funCaptions?: boolean;
  /** 活人感: a reply may arrive as 2–3 short messages, like someone typing. */
  splitReplies?: boolean;
  /** 活人感: now and then a short "oh, and…" line a minute or two after a reply. */
  afterthoughts?: boolean;
  /** 活人感: energy follows the time of day, mood follows how you treat each other. */
  moodEnabled?: boolean;
  /** 活人感: the character keeps a small daily routine of its own. */
  routineEnabled?: boolean;
  /** 活人感: one-line reactions above the pet to the app in front (never stored, never a message). */
  murmursEnabled?: boolean;
  /** Times a day the character may share something it found online (0 = never). */
  shareDailyLimit?: number;
  /** Bring up something you mentioned days ago at most once every N days (0 = never). */
  recallEveryDays?: number;
  /** After this local time the character says goodnight once and goes to sleep. */
  goodnightAt?: string;
  sandbox?: SandboxSettings;
};
/** Nested groups may be patched partially; the core merges and validates them. */
export type SettingsPatch = Partial<Omit<Settings, 'sandbox' | 'quietHours'>> & { sandbox?: Partial<SandboxSettings>; quietHours?: Partial<NonNullable<Settings['quietHours']>> };
export type SandboxLevel = 'strict' | 'standard' | 'open';
export type SandboxSettings = {
  level: SandboxLevel;
  /** File tools: read/write confinement. `read-anywhere`: read any non-protected path, write only inside the workspace. */
  fileScope: 'workspace-read' | 'workspace' | 'read-anywhere' | 'anywhere';
  shell: boolean;
  /** Ask the user before every Shell command (an "allow for this task" answer skips the rest of that task). */
  shellConfirm: boolean;
  network: boolean;
  /** Optional FetchURL allow-list; empty means any public host. */
  allowedDomains: string[];
  /** Redact API keys, tokens, private keys and passwords before anything leaves the machine. */
  redactSecrets: boolean;
  /** Also redact ID-card, bank-card, phone numbers and e-mail addresses. */
  redactPersonal: boolean;
  /** User-defined words that must never leave the machine. */
  sensitiveWords: string[];
};
export type PrivacyEvent = { at: string; channel: string; action: 'redacted' | 'blocked'; kinds: string[]; count: number };
export type PrivacyView = { redactedToday: number; blockedToday: number; recent: PrivacyEvent[] };
export type ScheduleView = { id: string; note: string; dueAt: string; repeatMinutes?: number; cron?: string; createdBy: 'character' | 'user'; createdAt: string; lateBy?: number };
/** One natural day folded into an archive at local midnight; the raw messages stay on disk. */
export type DailyArchiveView = { day: string; title: string; summary: string; diary: string; mood: string; topics: string[]; highlights: string[]; openThreads: string[]; messageCount: number; createdAt: string };
export type ArchiveStatus = { lastDay?: string; pendingDays: string[]; failedDays: string[]; nextRunAt: string };
export type BondView = { firstMetAt?: string; daysTogether: number; streakDays: number; activeDays: number; todayChats: number; achievements: { id: string; icon: string; title: string; description: string; unlockedAt?: string; hidden?: boolean }[] };
export type PetCatalogEntry = { id: string; name: string; description: string; builtin: boolean };
export type Message = { id: string; role: 'user' | 'assistant'; text: string; createdAt: string; source: 'chat' | 'initiative' | 'scene'; initiativeTopics?: InitiativeTopic[]; personaId?: string; speaker?: string; /** A reply sent as several short messages, like typing (the text keeps all of them). */ parts?: string[]; /** A short follow-up line sent a minute or two after a reply. */ afterthought?: boolean };
export type MemoryItem = { id: string; kind: 'fact' | 'episode' | 'reflection'; text: string; sourceId: string; createdAt: string; valid: boolean; validFrom?: string; validTo?: string; supersedes?: string; importance?: number; /** Ebbinghaus-style reinforcement: times the character actually cited it. */ recalls?: number; lastRecalledAt?: string };
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
  persona?: { active: PersonaProfile; list: PersonaProfile[]; greeted: boolean };
  pets?: { catalog: PetCatalogEntry[]; revision: number; folder?: string };
  schedules?: ScheduleView[];
  archives?: DailyArchiveView[];
  bond?: BondView;
  privacy?: PrivacyView;
  companionship?: CompanionPreferences;
  agent?: {backend:'openai-kimi-tools';mode:'full-access'|'directory-guarded';cwd:string;busy:boolean;forbiddenPaths?:string[];policyVersion?:number;questions?:AgentQuestion[];lastResult?:{status:'done'|'failed'|'cancelled';summary:string;toolCount:number;completedAt:string}};
  variables?: PersonaVariables;
  story?: StorySnapshot;
  watches?: WatchView[];
  browser?: BrowserView;
  identity: { id: string; name: string; onboarding: 'intro' | 'naming' | 'ready'; stage: 'S0' | 'S2' | 'S3' | 'S4' };
  /** Short caption of what the pet is doing right now (computed by the core). */
  /** Energy and mood (活人感); absent when switched off. */
  vitality?: VitalityView;
  activity?: { kind: 'idle' | 'thinking' | 'working' | 'speaking' | 'quiet' | 'sleeping' | 'offline' | 'resting' | 'focus'; label: string; /** What the character is up to in its own routine. */ routine?: string; /** Thinking about opening a conversation on its own rather than answering. */ initiative?: boolean; /** Dozing because the user stepped away (not quiet hours). */ away?: boolean; /** The executor is waiting for the user's answer (e.g. a Shell confirmation). */ waiting?: boolean };
  visual: { expression: Expression; action: PetAction; bubble: string; revision: number; intensity?: number };
  messages: Message[];
  memories: MemoryItem[];
  diary: DiaryEntry[];
  settings: Settings;
  provider: { configured: boolean; baseUrl: string; model: string; mode?: ProviderMode; toolCount?: number };
  status: { busy: boolean; error?: string; online: boolean; embedding: 'loading' | 'ready' | 'fallback' | 'idle'; contextTokens: number; contextBudget: number; tasks: BackgroundTask[]; pool?: PoolView; attention?: AttentionView; perception?: { clipboardEntries: number; lastScreenAt?: string; browserConnected?: boolean; activeUrl?: string }; journal?: ArchiveStatus };
  observation: Observation;
  stats: { conversations: number; memories: number; proactiveToday: number; tokensToday: number; lastSeenAt?: string };
};
export type AppCommand =
  | { type: 'persona.select'; id: string }
  | { type: 'persona.save'; id?: string; persona: PersonaDraft }
  | { type: 'persona.delete'; id: string }
  | { type: 'persona.import'; text: string }
  | { type: 'persona.export'; id: string }
  | { type: 'persona.generate'; brief: string }
  | { type: 'pet.select'; id: string }
  | { type: 'pet.import'; text: string }
  | { type: 'pet.delete'; id: string }
  | { type: 'pet.get'; id: string }
  | { type: 'pet.openFolder' }
  | { type: 'schedule.add'; note: string; inMinutes?: number; at?: string; repeatMinutes?: number }
  | { type: 'schedule.cancel'; id: string }
  | { type: 'privacy.clearAudit' }
  | { type: 'archive.rebuild'; day: string }
  | { type: 'achievement.unlock'; id: string }
  | { type: 'privacy.lockdown' }
  | { type: 'agent.run'; task: string }
  | { type: 'agent.cancel' }
  | { type: 'agent.configure'; cwd: string }
  | { type: 'agent.answer'; id:string; answers:Record<string,string> }
  | { type: 'chat.send'; text: string }
  | { type: 'chat.cancel' }
  | { type: 'pet.interact'; interaction: 'tap' | 'drag' | 'pat' }
  | { type: 'pet.roam'; active?: boolean; direction?: -1 | 1 }
  | { type: 'tts.speak'; text: string }
  | { type: 'tts.stop' }
  | { type: 'tts.configure'; ttsEnabled?: boolean; ttsBaseUrl?: string; ttsModel?: string; ttsVoice?: string; ttsSpeed?: number; ttsApiKey?: string }
  | { type: 'settings.update'; settings: SettingsPatch }
  | { type: 'config.save'; apiKey?: string; baseUrl: string; model: string; mode?: ProviderMode }
  | { type: 'memory.delete'; id: string }
  | { type: 'memory.correct'; id: string; text: string }
  | { type: 'memory.remember'; text: string }
  | { type: 'watch.add'; title: string; condition?: string; checkAfterMinutes?: number }
  | { type: 'watch.dismiss'; id: string }
  | { type: 'browser.report'; report: Record<string, unknown> }
  | { type: 'browser.disconnect' }
  | { type: 'initiative.check' }
  | { type: 'initiative.feedback'; messageId: string; value: InitiativeFeedback }
  | { type: 'initiative.resetFeedback' }
  | { type: 'initiative.topic'; topic: InitiativeTopic; enabled: boolean }
  | { type: 'pet.emote'; action: PetAction; bubble?: string }
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
  synthesizeSpeech?(text: string): Promise<{ ok: boolean; provider?: string; audioBase64?: string; mimeType?: string; fallbackText?: string; voice?: string; speed?: number; error?: string }>;
  cancelSpeech?(): void;
  onSpeechStop?(listener: () => void): () => void;
};
declare global { interface Window { galagent: GalAgentBridge } }


