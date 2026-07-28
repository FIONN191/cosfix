const { app, BrowserWindow, ipcMain, session } = require('electron')
const path = require('node:path')
const { detectChannels, runPlan } = require('./channels.cjs')

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

ipcMain.handle('channel:detect', () => detectChannels())

ipcMain.handle('channel:run', async (_event, plan) => {
  try {
    return { ok: true, outcome: await runPlan(plan) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0b0d10',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (DEV_SERVER_URL) {
    // 开发期把渲染层的 console 转到主进程 stdout，
    // 否则渲染层出了什么事只能开 devtools 才看得到
    win.webContents.on('console-message', (_e, level, message) => {
      console.log(`[renderer:${level}] ${message}`)
    })
    win.loadURL(DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

/**
 * 打包版加一道 CSP。界面全是本地资源，不需要任何外部来源；
 * 模型输出一律当纯文本渲染，但多一层兜底不亏。
 * 开发期不加——vite 的 HMR 需要内联脚本和 ws 连接。
 */
function applyContentSecurityPolicy() {
  if (DEV_SERVER_URL) return

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'",
        ],
      },
    })
  })
}

app.whenReady().then(() => {
  applyContentSecurityPolicy()

  // 启动就报一次通道探测结果，排查「为什么没有可用通道」时第一手信息
  for (const c of detectChannels()) {
    console.log(
      `[channel] ${c.id}: ${c.available ? c.exe : `不可用（${c.reason}）`}`,
    )
  }

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
