import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, Menu, nativeImage, safeStorage, screen, shell, Tray } from 'electron';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { CompanionService } from '../core/companion';
import { DesktopObserver } from '../desktop/observer';
import { validateCommand } from './validation';
import { SoakRecorder } from './soak';
import { ensureLocalProxyRunning } from './proxy-autostart';
import { synthesizeTtsSpeech } from './tts';
import type { AppSnapshot, CommandResult } from '../shared/contracts';
import { companionModes } from '../shared/companionship';
import type { ClipboardRead } from '../desktop/perception';

app.setName('GalAgent');
const override = process.env.GALAGENT_DATA_DIR;
if (override) app.setPath('userData', path.resolve(override));
if (process.env.GALAGENT_DEBUG_PORT && !app.isPackaged) app.commandLine.appendSwitch('remote-debugging-port', process.env.GALAGENT_DEBUG_PORT);
const rootDir = path.resolve(__dirname, '..');
/** Pet window at scale 1: room for the sprite, the status caption and a speech bubble above it. */
const PET_SIZE = { width: 320, height: 440 } as const;
let companion: CompanionService;
let observer: DesktopObserver;
let pet: BrowserWindow | undefined;
let chat: BrowserWindow | undefined;
let tray: Tray | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let roamTimer: ReturnType<typeof setInterval> | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let quitting = false;
let previousSettings = '';
let soak: SoakRecorder | undefined;
let cursorTimer: ReturnType<typeof setInterval> | undefined;
let hitSequence=0;
let pendingHit=0;
let nativeInteractive=false;
let inputOpen=false;
let roamDirection: -1 | 1 = -1;
/** Sub-pixel remainder so slow roaming speeds still move smoothly. */
let roamCarry = 0;
let roamManualUntil = 0;
let roamAutoPhaseUntil = 0;
let roamAutoActive = false;
let lastPublishedRoam = '';
let lastProxyCheckAt = 0;
const speechRequests = new Map<number, AbortController>();
let speechPolicy = '';
function stopSpeech(senderId?: number, notify = true) {
  for (const [id, controller] of speechRequests) if (senderId === undefined || id === senderId) {
    controller.abort(); speechRequests.delete(id);
  }
  if (notify) for (const win of [pet, chat]) if (win && !win.isDestroyed() && (senderId === undefined || win.webContents.id === senderId)) win.webContents.send('galagent:tts-stop');
}
// DUAL-CORE perception. Screenshots are captured in memory only for one attention
// evaluation and never written to disk; the signature is a 32x18 grayscale grid.
async function captureScreen(): Promise<{ dataUrl: string; signature: number[] } | undefined> {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const scale = Math.min(1, 1280 / Math.max(1, display.size.width));
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(display.size.width * scale), height: Math.round(display.size.height * scale) } });
  const source = sources.find(s => s.display_id === String(display.id)) || sources[0];
  if (!source || source.thumbnail.isEmpty()) return undefined;
  const bitmap = source.thumbnail.resize({ width: 32, height: 18 }).toBitmap();
  const signature: number[] = [];
  for (let i = 0; i + 3 < bitmap.length; i += 4) signature.push(Math.round(bitmap[i] * 0.114 + bitmap[i + 1] * 0.587 + bitmap[i + 2] * 0.299));
  return { dataUrl: 'data:image/jpeg;base64,' + source.thumbnail.toJPEG(70).toString('base64'), signature };
}
// Clipboard text arrives from the fixed observer helper, which checks the
// Windows sensitive-content formats before reading any text.
function onClipboard(read: ClipboardRead & { baseline?: boolean }) {
  if (!read) return;
  if (read.baseline) companion.primeClipboard(read); else companion.offerClipboard(read);
}
function setNativeInteractive(interactive:boolean){
  if(!pet||pet.isDestroyed()||interactive===nativeInteractive)return;
  nativeInteractive=interactive;
  if(interactive)pet.setIgnoreMouseEvents(false);else pet.setIgnoreMouseEvents(true,{forward:true});
}
const dataDir = app.getPath('userData');
const positionFile = path.join(dataDir, 'window-state.json');
async function atomicWrite(file: string, data: string | Uint8Array) { await mkdir(path.dirname(file), { recursive: true }); const temporary = `${file}.new`; await writeFile(temporary, data); await rename(temporary, file); }
const credentials = {
  async get() {
    const fromEnv = process.env.GALAGENT_API_KEY || process.env.MOONSHOT_API_KEY || process.env.KIMI_API_KEY;
    if (fromEnv) return fromEnv;
    try { const encrypted = await readFile(path.join(dataDir, 'provider-key.bin')); if (safeStorage.isEncryptionAvailable()){const key=safeStorage.decryptString(encrypted);if(key)return key;} } catch { /* no saved application key */ }
    const provider=companion?.getSnapshot().provider;
    if(!override&&provider?.mode!=='native-api'&&provider?.baseUrl==='http://127.0.0.1:18890/v1')try{return (await readFile(path.join(app.getPath('desktop'),'mira反代','kimi-api','.local-api-key'),'utf8')).trim()||undefined;}catch{/* existing proxy has no key file */}
    return undefined;
  },
  async set(key: string) { if (!safeStorage.isEncryptionAvailable()) throw new Error('系统密钥保护不可用，未保存密钥。'); await atomicWrite(path.join(dataDir, 'provider-key.bin'), safeStorage.encryptString(key)); },
};
const ttsCredentials = {
  async get() {
    if (process.env.MIMO_API_KEY || process.env.TTS_API_KEY) return process.env.MIMO_API_KEY || process.env.TTS_API_KEY;
    try {
      const encrypted = await readFile(path.join(dataDir, 'tts-key.bin'));
      if (safeStorage.isEncryptionAvailable()) {
        const key = safeStorage.decryptString(encrypted);
        if (key) return key;
      }
    } catch { /* no separate tts key */ }
    // Only reuse the provider key for a TTS endpoint on the same origin; never send it to a third-party TTS host.
    const snap = companion?.getSnapshot();
    try { if (snap?.settings.ttsBaseUrl && new URL(snap.settings.ttsBaseUrl.trim()).origin === new URL(snap.provider.baseUrl).origin) return await credentials.get(); } catch { /* invalid URL */ }
    return undefined;
  },
  async set(key: string) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统密钥保护不可用，未保存 TTS 密钥。');
    await atomicWrite(path.join(dataDir, 'tts-key.bin'), safeStorage.encryptString(key));
  },
};
function publishRoamState(active: boolean, direction: -1 | 0 | 1) {
  if (!pet || pet.isDestroyed() || pet.webContents.isDestroyed()) return;
  const sig = `${active}:${direction}`;
  if (sig === lastPublishedRoam) return;
  lastPublishedRoam = sig;
  pet.webContents.send('galagent:roam-state', { active, direction: active ? direction : 0 });
}
function stepDesktopRoam() {
  if (!pet || pet.isDestroyed() || !pet.isVisible() || !companion) return;
  const snap = companion.roamView();
  const now = Date.now();
  const quiet = snap.settings.quietUntil > now || (snap.settings.companionMode || 'daily') !== 'daily' || snap.sleeping || snap.busy;
  const reduced = snap.settings.reducedMotion;
  const forcedRun = now < roamManualUntil || snap.action === 'run';
  const autoAllowed = !process.env.GALAGENT_DEBUG_PORT && snap.settings.roamingEnabled !== false;
  if (now >= roamAutoPhaseUntil) {
    roamAutoActive = !roamAutoActive;
    roamAutoPhaseUntil = now + (roamAutoActive ? 14000 : 22000);
    if (roamAutoActive && Math.random() < 0.5) roamDirection = roamDirection === -1 ? 1 : -1;
  }
  const shouldRoam = !quiet && !reduced && !nativeInteractive && !inputOpen && (forcedRun || (autoAllowed && roamAutoActive));
  if (!shouldRoam) {
    publishRoamState(false, 0);
    return;
  }
  const bounds = pet.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  const minX = area.x + 12;
  const maxX = Math.max(minX, area.x + area.width - bounds.width - 12);
  const stepPx = Math.max(1, 3.2 * (snap.settings.petScale || 1) * (snap.settings.roamSpeed || 1));
  roamCarry += roamDirection * stepPx;
  const whole = Math.trunc(roamCarry); roamCarry -= whole;
  let nextX = bounds.x + whole;
  if (nextX <= minX) {
    nextX = minX;
    roamDirection = 1;
  } else if (nextX >= maxX) {
    nextX = maxX;
    roamDirection = -1;
  }
  if (nextX !== bounds.x && !process.env.GALAGENT_DEBUG_PORT) {
    pet.setBounds({ ...bounds, x: nextX });
  }
  publishRoamState(true, roamDirection);
}
function allowedSender(senderId: number) { return [pet, chat].some(win => win && !win.isDestroyed() && win.webContents.id === senderId); }
function senderWindow(senderId:number){return [pet,chat].find(win=>win&&!win.isDestroyed()&&win.webContents.id===senderId);}
function windowVisibility(win:BrowserWindow){return !win.isDestroyed()&&win.isVisible()&&!win.isMinimized();}
function publishWindowVisibility(win:BrowserWindow){if(!win.isDestroyed()&&!win.webContents.isDestroyed())win.webContents.send('galagent:window-visibility',windowVisibility(win));}
function wireWindowVisibility(win:BrowserWindow){
  const publish=()=>publishWindowVisibility(win);
  win.on('show',publish);win.on('hide',publish);win.on('minimize',publish);win.on('restore',publish);
  win.webContents.on('did-finish-load',()=>publishWindowVisibility(win));
}
function sendSnapshot(snapshot: AppSnapshot) {
  const nextPolicy = JSON.stringify([snapshot.settings.ttsEnabled, snapshot.settings.quietUntil, snapshot.settings.ttsBaseUrl, snapshot.settings.ttsModel, snapshot.settings.ttsVoice, snapshot.settings.ttsSpeed, snapshot.settings.companionMode]);
  if (speechPolicy && speechPolicy !== nextPolicy) stopSpeech();
  speechPolicy = nextPolicy;
  for (const win of [pet, chat]) if (win && !win.isDestroyed() && !win.webContents.isLoading()) win.webContents.send('galagent:snapshot', snapshot);
  const key = JSON.stringify([snapshot.settings.observationEnabled, snapshot.settings.windowTitlesEnabled, snapshot.settings.clipboardEnabled, snapshot.settings.companionMode]);
  if (key !== previousSettings) { previousSettings = key; observer?.setOptions({ enabled: snapshot.settings.observationEnabled && snapshot.settings.companionMode !== 'rest', includeTitles: snapshot.settings.windowTitlesEnabled, includeClipboard: snapshot.settings.observationEnabled && snapshot.settings.clipboardEnabled }); }
  if (pet && !pet.isDestroyed()) { pet.setTitle(snapshot.identity.name || 'GalAgent'); const scale = snapshot.settings.petScale; const width = Math.round(PET_SIZE.width * scale), height = Math.round(PET_SIZE.height * scale); const bounds = pet.getBounds(); if (bounds.width !== width || bounds.height !== height) pet.setBounds(clamp({ ...bounds, width, height })); }
}
function clamp(bounds: Electron.Rectangle): Electron.Rectangle {
  const area = screen.getDisplayMatching(bounds).workArea;
  const width = Math.min(bounds.width, area.width), height = Math.min(bounds.height, area.height);
  return { width, height, x: Math.max(area.x, Math.min(area.x + area.width - width, bounds.x)), y: Math.max(area.y, Math.min(area.y + area.height - height, bounds.y)) };
}
function safeWindow(win: BrowserWindow) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  win.webContents.session.setPermissionCheckHandler(() => false);
  win.webContents.on('will-redirect', event => event.preventDefault());
  win.webContents.on('will-attach-webview', event => event.preventDefault());
}
async function loadView(win: BrowserWindow, view: string) { await win.loadFile(path.join(rootDir, 'renderer/index.html'), { query: { view } }); }
function openChat(open = true) {
  if (!chat || chat.isDestroyed()) return;
  if (open) { chat.show(); chat.focus(); } else chat.hide();
}
function resetPet() { if (!pet || pet.isDestroyed()) return; const area = screen.getPrimaryDisplay().workArea; const { width, height } = pet.getBounds(); pet.setBounds(clamp({ x: area.x + area.width - width - 36, y: area.y + area.height - height - 24, width, height })); }
function menu() {
  const snapshot = companion.getSnapshot();
  return Menu.buildFromTemplate([
    { label: snapshot.identity.name ? `和 ${snapshot.identity.name} 说话` : '打开聊天', click: () => openChat() },
    { label: '陪伴模式', submenu: companionModes.map(mode => ({ label: mode.label, type: 'radio' as const, checked: (snapshot.settings.companionMode || 'daily') === mode.value, click: () => { void companion.handle({ type: 'settings.update', settings: { companionMode: mode.value } }); } })) },
    { type: 'separator' },
    { label: '切换角色', submenu: (snapshot.persona?.list || []).map(persona => ({ label: persona.name + (persona.builtin ? '' : '（自定义）'), type: 'radio' as const, checked: snapshot.persona?.active.id === persona.id, click: () => { void companion.handle({ type: 'persona.select', id: persona.id }); } })) },
    { label: '出去溜达一圈', click: () => { roamManualUntil = Date.now() + 20000; void companion.handle({ type: 'pet.roam', active: true }); stepDesktopRoam(); } },
    { label: '允许桌面自在漫步', type: 'checkbox', checked: snapshot.settings.roamingEnabled !== false, click: item => { void companion.handle({ type: 'settings.update', settings: { roamingEnabled: item.checked } }); } },
    { label: '语音合成朗读 (TTS)', type: 'checkbox', checked: Boolean(snapshot.settings.ttsEnabled), click: item => { void companion.handle({ type: 'settings.update', settings: { ttsEnabled: item.checked } }); } },
    { label: '停止当前朗读', click: () => stopSpeech() },
    { type: 'separator' },
    { label: snapshot.settings.quietUntil > Date.now() ? '恢复主动互动' : '安静一小时', click: () => { void companion.handle({ type: 'settings.update', settings: { quietUntil: snapshot.settings.quietUntil > Date.now() ? 0 : Date.now() + 3600000 } }); } },
    { label: '回到屏幕角落', click: resetPet },
    { label: snapshot.settings.observationEnabled ? '暂停观察（立即停止截屏与剪贴板）' : '恢复桌面观察', click: () => { void companion.handle({ type: 'settings.update', settings: { observationEnabled: !snapshot.settings.observationEnabled } }); } },
    { label: '一键隐私锁定', click: () => { void companion.handle({ type: 'privacy.lockdown' }); } },
    { label: '截屏观察', type: 'checkbox', enabled: snapshot.settings.observationEnabled, checked: snapshot.settings.screenCaptureEnabled, click: item => { void companion.handle({ type: 'settings.update', settings: { screenCaptureEnabled: item.checked } }); } },
    { label: '剪贴板观察（最近50条）', type: 'checkbox', enabled: snapshot.settings.observationEnabled, checked: snapshot.settings.clipboardEnabled, click: item => { void companion.handle({ type: 'settings.update', settings: { clipboardEnabled: item.checked } }); } },
    { type: 'separator' },
    { label: '退出 GalAgent', click: () => app.quit() },
  ]);
}
async function makeWindows() {
  const area = screen.getPrimaryDisplay().workArea;
  let position: Electron.Rectangle = { x: area.x + area.width - PET_SIZE.width - 36, y: area.y + area.height - PET_SIZE.height - 24, width: PET_SIZE.width, height: PET_SIZE.height };
  try { const saved = JSON.parse(await readFile(positionFile, 'utf8')); if (['x','y','width','height'].every(key => typeof saved[key] === 'number' && Number.isFinite(saved[key]))) position = clamp(saved); } catch { /* first launch */ }
  const common = { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true };
  pet = new BrowserWindow({ ...position, transparent: true, frame: false, resizable: false, hasShadow: false, focusable: false, skipTaskbar: true, show: false, alwaysOnTop: true, backgroundColor: '#00000000', webPreferences: common });
  pet.setIgnoreMouseEvents(true, { forward: true });
  chat = new BrowserWindow({ width: 1100, height: 800, minWidth: 860, minHeight: 600, show: false, backgroundColor: '#101b2b', title: 'GalAgent', autoHideMenuBar: true, titleBarStyle: 'hidden', titleBarOverlay: { color: '#101b2b', symbolColor: '#b5c8db', height: 42 }, webPreferences: common });
  safeWindow(pet); safeWindow(chat);
  wireWindowVisibility(pet);wireWindowVisibility(chat);
  chat.on('close', event => { if (!quitting) { event.preventDefault(); chat?.hide(); } });
  pet.on('closed', () => { pet = undefined; if (!quitting) app.quit(); });
  await Promise.all([loadView(pet, 'pet'), loadView(chat, 'chat')]);
  pet.showInactive();
  // The desktop character is the entry point. Connection and long-form views
  // remain available from the menu rather than replacing her on first launch.
  screen.on('display-removed', () => { if (pet && !pet.isDestroyed()) pet.setBounds(clamp(pet.getBounds())); });
}
async function runTts(text: string, senderId: number) {
  stopSpeech(senderId, false);
  const controller = new AbortController();
  speechRequests.set(senderId, controller);
  try {
  const snap = companion.getSnapshot();
  const ttsApiKey = await ttsCredentials.get();
  const persona = snap.persona?.active;
  return await synthesizeTtsSpeech({
    // TTS providers are third parties too: the same redaction as model requests applies.
    text: companion.redactOutbound(text, 'tts'),
    persona: persona ? { name: persona.name, tagline: persona.tagline, voiceStyle: persona.voiceStyle } : undefined,
    ttsBaseUrl: snap.settings.ttsBaseUrl,
    ttsApiKey,
    ttsModel: snap.settings.ttsModel,
    ttsVoice: snap.settings.ttsVoice,
    ttsSpeed: snap.settings.ttsSpeed,
    expression: snap.visual.expression,
    signal: controller.signal,
  });
  } finally { if (speechRequests.get(senderId) === controller) speechRequests.delete(senderId); }
}
async function shellCommand(raw: unknown, senderId: number): Promise<CommandResult> {
  if (!allowedSender(senderId)) return { ok: false, error: '无法识别的窗口。' };
  try {
    const command = validateCommand(raw);
    if (['chat.send', 'chat.cancel', 'app.import', 'tts.configure'].includes(command.type)) stopSpeech();
    switch (command.type) {
      case 'shell.chat': openChat(command.open ?? true); return { ok: true };
      case 'shell.input': {
        if (!pet || pet.isDestroyed() || pet.webContents.id !== senderId) return { ok: false };
        inputOpen = command.open;
        pet.setFocusable(command.open);
        if (command.open) { setNativeInteractive(true); pet.show(); pet.focus(); }
        return { ok: true };
      }
      case 'shell.pointer': if (pet?.webContents.id !== senderId) return { ok: false }; if(!cursorTimer)setNativeInteractive(command.interactive); return { ok: true };
      case 'shell.drag': {
        if (pet?.webContents.id !== senderId || pet.isDestroyed()) return { ok: false };
        const bounds = pet.getBounds(); pet.setBounds(clamp({ ...bounds, x: Math.round(bounds.x + command.dx), y: Math.round(bounds.y + command.dy) }));
        if (saveTimer) clearTimeout(saveTimer); saveTimer = setTimeout(() => { if (pet && !pet.isDestroyed()) void atomicWrite(positionFile, JSON.stringify(pet.getBounds())).catch(() => {}); }, 300);
        return { ok: true };
      }
      case 'pet.roam': {
        if (command.direction) roamDirection = command.direction;
        const nextActive = command.active !== undefined ? command.active : roamManualUntil <= Date.now();
        roamManualUntil = nextActive ? Date.now() + 20000 : 0;
        const res = await companion.handle(command);
        stepDesktopRoam();
        return res;
      }
      case 'config.save': {
        if (!override && command.mode !== 'native-api') {
          await ensureLocalProxyRunning({ baseUrl: command.baseUrl, desktopDir: app.getPath('desktop') }).catch(() => {});
        }
        return await companion.handle(command);
      }
      case 'tts.configure': {
        if (command.ttsApiKey !== undefined && command.ttsApiKey.trim()) {
          await ttsCredentials.set(command.ttsApiKey.trim());
        }
        return await companion.handle(command);
      }
      case 'tts.speak': {
        const res = await runTts(command.text, senderId);
        return { ok: res.ok, error: res.error, data: res };
      }
      case 'tts.stop': stopSpeech(); return { ok: true };
      case 'pet.openFolder': await mkdir(companion.pets.folder, { recursive: true }); await shell.openPath(companion.pets.folder); return { ok: true };
      case 'persona.export': {
        const result = await companion.handle(command);
        const data = result.data as { name: string; text: string } | undefined;
        if (!result.ok || !data) return result;
        const target = await dialog.showSaveDialog(chat!, { title: '导出角色卡', defaultPath: `${data.name.replace(/[\\/:*?"<>|]/g, '_')}.persona.json`, filters: [{ name: 'GalAgent 角色卡', extensions: ['json'] }] });
        if (!target.canceled && target.filePath) await atomicWrite(target.filePath, data.text);
        return { ok: true, data: { canceled: target.canceled } };
      }
      case 'shell.menu': menu().popup({ window: pet }); return { ok: true };
      case 'shell.resetPosition': resetPet(); return { ok: true };
      case 'app.export': {
        const result = await dialog.showSaveDialog(chat!, { title: '导出相处存档', defaultPath: `GalAgent-${new Date().toISOString().slice(0,10)}.json`, filters: [{ name: 'GalAgent 存档', extensions: ['json'] }] });
        if (!result.canceled && result.filePath) await atomicWrite(result.filePath, companion.exportArchive()); return { ok: true, data: { canceled: result.canceled } };
      }
      case 'app.import': {
        const result = await dialog.showOpenDialog(chat!, { title: '选择相处存档', properties: ['openFile'], filters: [{ name: 'GalAgent 存档', extensions: ['json'] }] });
        if (!result.canceled && result.filePaths[0]) { const answer = await dialog.showMessageBox(chat!, { type: 'question', title: '恢复相处存档', message: '恢复这份相处记录？', detail: '当前设备的删除记录仍会生效。历史存档可能包含旧记忆，请确认来源。', buttons: ['取消', '恢复'], defaultId: 0, cancelId: 0 }); if (answer.response === 1) await companion.importArchive(await readFile(result.filePaths[0], 'utf8')); }
        return { ok: true };
      }
      case 'app.quit': app.quit(); return { ok: true };
      default: return await companion.handle(command);
    }
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : '操作没有完成。' }; }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (pet && !pet.isDestroyed()) pet.showInactive(); });
  app.on('window-all-closed', () => { if (quitting) app.quit(); });
  app.whenReady().then(async () => {
    await mkdir(dataDir, { recursive: true });
    if (!override) {
      lastProxyCheckAt = Date.now();
      await ensureLocalProxyRunning({ baseUrl: 'http://127.0.0.1:18890/v1', desktopDir: app.getPath('desktop') }).catch(() => {});
    }
    const packagedModel = path.join(process.resourcesPath, 'models');
    const developmentModel = path.resolve(__dirname, '../../.cache/models/Xenova/multilingual-e5-small');
    const skillRoot = app.isPackaged ? path.join(process.resourcesPath, 'skills') : path.resolve(__dirname, '../../skills');
    companion = new CompanionService({ dataDir, credentials, skillRoots: [skillRoot], protectedWritePaths: [process.resourcesPath, path.join(app.getPath('desktop'), 'mira反代')], features: { attention: true, journal: true }, capture: captureScreen, embeddingWorkerPath: path.join(__dirname, 'embedding.mjs'), embeddingModelPath: existsSync(packagedModel) ? packagedModel : existsSync(developmentModel) ? developmentModel : undefined });
    await companion.init();
    if (!override) {
      const configuredBaseUrl = companion.getSnapshot().provider.baseUrl;
      if (configuredBaseUrl && configuredBaseUrl !== 'http://127.0.0.1:18890/v1') {
        await ensureLocalProxyRunning({ baseUrl: configuredBaseUrl, desktopDir: app.getPath('desktop') }).catch(() => {});
      }
    }
    observer = new DesktopObserver({ scriptPath: app.isPackaged ? path.join(process.resourcesPath, 'observer.ps1') : path.join(rootDir, 'desktop/observer.ps1'), onObservation: observation => companion.setObservation(observation), onClipboard });
    companion.on('snapshot', sendSnapshot);
    ipcMain.handle('galagent:snapshot', event => { if (!allowedSender(event.sender.id)) throw new Error('未知窗口'); return companion.getSnapshot(); });
    ipcMain.handle('galagent:window-visibility',event=>{const win=senderWindow(event.sender.id);if(!win)throw new Error('未知窗口');return windowVisibility(win);});
    ipcMain.handle('galagent:command', (event, command) => shellCommand(command, event.sender.id));
    ipcMain.handle('galagent:tts-speak', async (event, text: unknown) => {
      if (!allowedSender(event.sender.id)) throw new Error('未知窗口');
      if (typeof text !== 'string' || !text.trim() || text.length > 2000) return { ok: false, error: '无效语音文本' };
      return await runTts(text, event.sender.id);
    });
    ipcMain.on('galagent:tts-cancel', event => { if (allowedSender(event.sender.id)) stopSpeech(event.sender.id, false); });
    ipcMain.on('galagent:hit-result',(event,result)=>{
      if(pet?.webContents.id!==event.sender.id||!result||result.id!==pendingHit||typeof result.interactive!=='boolean')return;
      setNativeInteractive(result.interactive);
    });
    const browserBridgeFile = path.join(dataDir, 'browser-bridge.json');
    let lastBrowserObservedAt = '';
    const pollBrowserBridge = async () => {
      try {
        if (!existsSync(browserBridgeFile)) return;
        const raw = JSON.parse(await readFile(browserBridgeFile, 'utf8'));
        if (raw && typeof raw === 'object' && typeof raw.observedAt === 'string' && raw.observedAt !== lastBrowserObservedAt) {
          lastBrowserObservedAt = raw.observedAt;
          companion?.offerBrowser(raw);
        }
      } catch { /* ignore transient write contention */ }
    };
    await makeWindows();
    const trayPath = path.join(rootDir, 'renderer/assets/tray.png');
    let icon = existsSync(trayPath) ? nativeImage.createFromPath(trayPath) : nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFgAJ/1M0xXwAAAABJRU5ErkJggg==');
    tray = new Tray(icon.resize({ width: 20, height: 20 })); tray.setToolTip('GalAgent · 桌面相处'); tray.on('click', () => { if (pet && !pet.isDestroyed()) pet.showInactive(); }); tray.on('right-click', () => menu().popup());
    observer.start(); void pollBrowserBridge(); sendSnapshot(companion.getSnapshot());
    roamAutoPhaseUntil = Date.now() + 8000;
    roamTimer = setInterval(stepDesktopRoam, 30);
    cursorTimer=setInterval(()=>{
      if(!pet||pet.isDestroyed()||!pet.isVisible()||pet.webContents.isLoading())return;
      const point=screen.getCursorScreenPoint(),bounds=pet.getBounds();
      const x=point.x-bounds.x,y=point.y-bounds.y;
      pendingHit=++hitSequence;
      if((x<0||y<0||x>=bounds.width||y>=bounds.height)&&!nativeInteractive)setNativeInteractive(false);
      pet.webContents.send('galagent:hit-test',{id:pendingHit,x,y});
    },80);
    timer = setInterval(() => {
      void pollBrowserBridge();
      if (!override && !companion.getSnapshot().status.online && Date.now() - lastProxyCheckAt >= 60000) {
        lastProxyCheckAt = Date.now();
        void ensureLocalProxyRunning({ baseUrl: companion.getSnapshot().provider.baseUrl, desktopDir: app.getPath('desktop') }).catch(() => {});
      }
      void companion.tick();
    }, 10000);
    const duration=Number(process.env.GALAGENT_SOAK_SECONDS);
    if(process.env.GALAGENT_SOAK_PATH&&Number.isFinite(duration)&&duration>0){
      soak=new SoakRecorder(path.resolve(process.env.GALAGENT_SOAK_PATH),duration*1000,()=>companion.getSnapshot());
      await soak.start();
    }
  }).catch(error => { dialog.showErrorBox('GalAgent 启动失败', error instanceof Error ? error.message : '未知错误'); app.exit(1); });
  app.on('before-quit', event => {
    if (quitting) return;
    event.preventDefault(); quitting = true;
    stopSpeech();
    if (timer) clearInterval(timer); if (roamTimer) clearInterval(roamTimer); if (saveTimer) clearTimeout(saveTimer); if(cursorTimer)clearInterval(cursorTimer);
    observer?.stop();
    void (async () => {
      try { await soak?.stop(); if (pet && !pet.isDestroyed()) await atomicWrite(positionFile, JSON.stringify(pet.getBounds())).catch(() => {}); await companion?.close(); }
      catch { /* A close failure must not trap the user in a background application. */ }
      finally { tray?.destroy(); app.quit(); }
    })();
  });
}
