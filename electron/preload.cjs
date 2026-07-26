const { contextBridge } = require('electron')

// 渲染层只能通过这里跟主进程说话。Step 3 会在这里加 invokeChannel /
// detectChannels，用来 spawn 本机的 agentic CLI。
contextBridge.exposeInMainWorld('cosfix', {
  isDesktop: true,
  platform: process.platform,
})
