const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('native', {
  selectFile: () => ipcRenderer.invoke('native:selectFile'),
  readFile: (filePath) => ipcRenderer.invoke('native:readFile', filePath),
  saveFile: (filePath, content) => ipcRenderer.invoke('native:saveFile', { filePath, content }),
  getPrinters: () => ipcRenderer.invoke('native:getPrinters'),
  print: (options) => ipcRenderer.invoke('native:print', options),
  kickDrawer: (config) => ipcRenderer.invoke('native:kickDrawer', config),
  createDesktopShortcut: () => ipcRenderer.invoke('native:createDesktopShortcut'),
  onFileOpened: (cb) => ipcRenderer.on('native:fileOpened', (_event, payload) => cb(payload)),
  admin: {
    searchUsers: (query) => ipcRenderer.invoke('admin:searchUsers', query),
    getAdminStatus: (userId) => ipcRenderer.invoke('admin:getAdminStatus', userId),
    setAdminStatus: (payload) => ipcRenderer.invoke('admin:setAdminStatus', payload),
    listAudit: () => ipcRenderer.invoke('admin:listAudit'),
  },
  persistence: {
    load: (name, fallback) => ipcRenderer.invoke('data:load', name, fallback),
    save: (name, value) => ipcRenderer.invoke('data:save', name, value),
  },
  security: {
    isRevealAvailable: () => ipcRenderer.invoke('security:isRevealAvailable'),
    revealDefaultCredentials: (code) => ipcRenderer.invoke('security:revealDefaultCredentials', code),
    isRestoreAvailable: () => ipcRenderer.invoke('security:isRestoreAvailable'),
    restoreAdminUser: (payload) => ipcRenderer.invoke('security:restoreAdminUser', payload),
    getSystemFingerprint: () => ipcRenderer.invoke('security:getSystemFingerprint'),
  },
  db: {
    getConnectionString: () => ipcRenderer.invoke('db:getConnectionString'),
    getConnectionConfig: () => ipcRenderer.invoke('db:getConnectionConfig'),
    isConfigured: () => ipcRenderer.invoke('db:isConfigured'),
    completeFirstRun: () => ipcRenderer.invoke('db:completeFirstRun'),
    setConnectionString: (conn) => ipcRenderer.invoke('db:setConnectionString', conn),
    saveConnectionConfig: (config) => ipcRenderer.invoke('db:saveConnectionConfig', config),
    testConnection: (config) => ipcRenderer.invoke('db:testConnection', config),
    query: (sql, params) => ipcRenderer.invoke('db:query', { sql, params }),
    transaction: (operations) => ipcRenderer.invoke('db:transaction', { operations }),
    exec: (sql, actorUserId) => ipcRenderer.invoke('db:exec', { sql, actorUserId }),
    exportSqlDump: (options) => ipcRenderer.invoke('db:exportDump', options),
    onSetupRequired: (cb) => ipcRenderer.on('db:setup-required', (_event, payload) => cb(payload)),
    onStatus: (cb) => {
      ipcRenderer.on('db:status', (_event, payload) => cb(payload))
      ipcRenderer.on('db-status', (_event, payload) => cb(payload))
    },
    onError: (cb) => {
      ipcRenderer.on('db:error', (_event, payload) => cb(payload))
      ipcRenderer.on('db-error', (_event, payload) => cb(payload))
    },
    onLiveUpdate: (cb) => ipcRenderer.on('db:live-update', (_event, payload) => cb(payload)),
    retryInitialization: () => ipcRenderer.send('retry-db-initialization'),
  },
  app: {
    signalReady: () => ipcRenderer.send('ui-ready-for-main-window'),
    getTrainingMode: () => ipcRenderer.invoke('app:getTrainingMode'),
    setTrainingMode: (flag) => ipcRenderer.invoke('app:setTrainingMode', flag),
  },
  auth: {
    issueTokens: (payload) => ipcRenderer.invoke('auth:issueTokens', payload),
    refresh: (payload) => ipcRenderer.invoke('auth:refresh', payload),
    revokeSession: (payload) => ipcRenderer.invoke('auth:revokeSession', payload),
    register: (payload) => ipcRenderer.invoke('auth:register', payload),
    listUsers: () => ipcRenderer.invoke('auth:listUsers'),
    login: (payload) => ipcRenderer.invoke('auth:login', payload),
    updateUser: (id, patch) => ipcRenderer.invoke('auth:updateUser', { id, patch }),
    deleteUser: (id) => ipcRenderer.invoke('auth:deleteUser', { id }),
    heartbeat: (userId) => ipcRenderer.invoke('auth:heartbeat', { userId }),
  },
  update: {
    check: (config) => ipcRenderer.invoke('update:check', config),
    start: (config) => ipcRenderer.invoke('update:start', config),
    onStatus: (cb) => ipcRenderer.on('update:status', (_event, payload) => cb(payload)),
  },
  window: {
    getFullscreen: () => ipcRenderer.invoke('window:getFullscreen'),
    setFullscreen: (flag) => ipcRenderer.invoke('window:setFullscreen', flag),
    toggleFullscreen: () => ipcRenderer.invoke('window:toggleFullscreen'),
    onFullscreenChanged: (cb) => ipcRenderer.on('window:fullscreen-changed', (_event, payload) => cb(payload)),
  }
})

// Forward renderer runtime errors to main for diagnostics
window.addEventListener('error', (event) => {
  try {
    const payload = {
      message: String(event.message || 'renderer_error'),
      filename: String(event.filename || ''),
      lineno: Number(event.lineno || 0),
      colno: Number(event.colno || 0),
      stack: String(event.error && event.error.stack ? event.error.stack : ''),
    }
    ipcRenderer.send('renderer:error', payload)
  } catch { }
})

window.addEventListener('unhandledrejection', (event) => {
  try {
    const reason = event && event.reason ? event.reason : null
    const payload = {
      message: String((reason && reason.message) || 'unhandledrejection'),
      stack: String((reason && reason.stack) || ''),
    }
    ipcRenderer.send('renderer:error', payload)
  } catch { }
})
