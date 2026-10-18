const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('probeHost',{onVisibility:callback=>ipcRenderer.on('probe:visibility',(_event,value)=>callback(value)),exerciseVisibility:()=>ipcRenderer.invoke('probe:exercise-visibility'),toggleFullscreen:()=>ipcRenderer.invoke('probe:toggle-fullscreen')});
