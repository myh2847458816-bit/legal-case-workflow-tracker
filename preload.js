const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('caseTracker', {
  loadState: () => ipcRenderer.invoke('state:load'),
  saveState: (state) => ipcRenderer.invoke('state:save', state),
  getDataPath: () => ipcRenderer.invoke('app:data-path'),
  getStorageInfo: () => ipcRenderer.invoke('storage:info'),
  getStorageHealth: () => ipcRenderer.invoke('storage:health'),
  exportBackup: (state) => ipcRenderer.invoke('backup:export', state),
  inspectImport: () => ipcRenderer.invoke('backup:inspect-import'),
  inspectBackup: () => ipcRenderer.invoke('backup:inspect-import'),
  applyImport: (token) => ipcRenderer.invoke('backup:apply-import', token),
  applyBackup: (token) => ipcRenderer.invoke('backup:apply-import', token),
  listBackups: () => ipcRenderer.invoke('backup:list'),
  listLocalBackups: () => ipcRenderer.invoke('backup:list'),
  restoreBackup: (id) => ipcRenderer.invoke('backup:restore', id),
  restoreLocalBackup: (id) => ipcRenderer.invoke('backup:restore', id),
  exportText: (payload) => ipcRenderer.invoke('file:export-text', payload),
  showExportInFolder: (token) => ipcRenderer.invoke('file:show-export-in-folder', token),
  onPrepareClose: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = async (_event, payload) => {
      const requestId = String(payload?.requestId || '');
      if (!requestId) return;
      try {
        await callback();
        ipcRenderer.send('window:close-ready', { requestId, ok: true });
      } catch (error) {
        ipcRenderer.send('window:close-ready', { requestId, ok: false, message: String(error?.message || error || '保存失败').slice(0, 500) });
      }
    };
    ipcRenderer.on('window:prepare-close', listener);
    return () => ipcRenderer.removeListener('window:prepare-close', listener);
  }
});
