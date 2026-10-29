import { contextBridge, ipcRenderer } from 'electron';
import type { AppCommand, AppSnapshot, GalAgentBridge } from '../shared/contracts';
const bridge: GalAgentBridge = {
  getSnapshot: () => ipcRenderer.invoke('galagent:snapshot'),
  getWindowVisibility: async()=>{
    const visible:unknown=await ipcRenderer.invoke('galagent:window-visibility');
    if(typeof visible!=='boolean')throw new Error('窗口可见性响应无效');
    return visible;
  },
  onWindowVisibility(listener){
    const handler=(_event:unknown,visible:unknown)=>{if(typeof visible==='boolean')listener(visible);};
    ipcRenderer.on('galagent:window-visibility',handler);
    return()=>ipcRenderer.removeListener('galagent:window-visibility',handler);
  },
  dispatch: (command: AppCommand) => ipcRenderer.invoke('galagent:command', command),
  onSnapshot(listener) {
    const handler = (_event: unknown, snapshot: AppSnapshot) => listener(snapshot);
    ipcRenderer.on('galagent:snapshot', handler);
    return () => ipcRenderer.removeListener('galagent:snapshot', handler);
  },
  onHitTest(listener) {
    const handler=(_event:unknown,point:{id:number;x:number;y:number})=>{
      if(!Number.isFinite(point.x)||!Number.isFinite(point.y)||!Number.isSafeInteger(point.id))return;
      ipcRenderer.send('galagent:hit-result',{id:point.id,interactive:!!listener({x:point.x,y:point.y})});
    };
    ipcRenderer.on('galagent:hit-test',handler);
    return ()=>ipcRenderer.removeListener('galagent:hit-test',handler);
  },
  onRoamState(listener) {
    const handler = (_event: unknown, state: { active: boolean; direction: -1 | 0 | 1 }) => {
      if (state && typeof state.active === 'boolean' && (state.direction === -1 || state.direction === 0 || state.direction === 1)) {
        listener(state);
      }
    };
    ipcRenderer.on('galagent:roam-state', handler);
    return () => ipcRenderer.removeListener('galagent:roam-state', handler);
  },
  synthesizeSpeech: (text: string) => ipcRenderer.invoke('galagent:tts-speak', text),
  cancelSpeech: () => ipcRenderer.send('galagent:tts-cancel'),
  onSpeechStop(listener) {
    const handler = () => listener();
    ipcRenderer.on('galagent:tts-stop', handler);
    return () => ipcRenderer.removeListener('galagent:tts-stop', handler);
  },
};
contextBridge.exposeInMainWorld('galagent', Object.freeze(bridge));
