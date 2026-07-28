const { contextBridge, ipcRenderer } = require('electron')

// 渲染层跟主进程的唯一通道。只暴露这两个方法——
// 可执行文件白名单和参数校验都在主进程侧，见 channels.cjs。
contextBridge.exposeInMainWorld('cosfix', {
  isDesktop: true,
  platform: process.platform,
  detectChannels: () => ipcRenderer.invoke('channel:detect'),
  runPlan: (plan) => ipcRenderer.invoke('channel:run', plan),
})
