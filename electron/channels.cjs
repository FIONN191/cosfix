/**
 * CLI 通道的执行器。跑在主进程，是整个应用唯一能 spawn 子进程的地方。
 *
 * 安全边界在这里：**可执行文件白名单由本文件独占**。渲染层送过来的
 * plan 里带 exe 路径，但只有本文件探测过、确实存在、且在 CHANNEL_CANDIDATES
 * 里的路径才会被执行。渲染层想跑 /bin/sh 是跑不动的。
 *
 * 同理，plan.files 的文件名会被校验，不接受路径分隔符和 ..，
 * 免得写到工作目录外面去。
 */

const { spawn } = require('node:child_process')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const HOME = os.homedir()

/**
 * 候选可执行文件路径，按顺序探测。
 *
 * **不能只靠 PATH**：codex 装在 ChatGPT.app 内部，`command -v codex`
 * 是查不到的——这是本项目踩过的第一个坑。
 */
const CHANNEL_CANDIDATES = {
  codex: [
    '/Applications/ChatGPT.app/Contents/Resources/codex',
    path.join(HOME, 'Applications/ChatGPT.app/Contents/Resources/codex'),
    '/usr/local/bin/codex',
    '/opt/homebrew/bin/codex',
    path.join(HOME, '.npm-global/bin/codex'),
    'codex',
  ],
  qwen: [
    path.join(HOME, '.npm-global/bin/qwen'),
    '/usr/local/bin/qwen',
    '/opt/homebrew/bin/qwen',
    'qwen',
  ],
}

const CHANNEL_META = {
  codex: { label: 'Codex CLI', quotaSource: 'ChatGPT 订阅额度' },
  qwen: { label: 'Qwen Code CLI', quotaSource: '通义账号额度' },
}

function isExecutable(p) {
  try {
    fs.accessSync(p, fs.constants.X_OK)
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

/** 裸命令名走 PATH 查找 */
function resolveOnPath(name) {
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
  for (const dir of dirs) {
    const full = path.join(dir, name)
    if (isExecutable(full)) return full
  }
  return null
}

function resolveChannel(id) {
  for (const candidate of CHANNEL_CANDIDATES[id] ?? []) {
    if (candidate.includes(path.sep)) {
      if (isExecutable(candidate)) return candidate
    } else {
      const found = resolveOnPath(candidate)
      if (found) return found
    }
  }
  return null
}

/** 当前允许执行的路径集合。每次 detect 后刷新 */
let allowlist = new Set()

function detectChannels() {
  const out = []
  const allowed = new Set()

  for (const id of Object.keys(CHANNEL_CANDIDATES)) {
    const exe = resolveChannel(id)
    const meta = CHANNEL_META[id] ?? { label: id, quotaSource: '' }
    if (exe) allowed.add(exe)

    out.push({
      id,
      label: meta.label,
      quotaSource: meta.quotaSource,
      exe,
      available: Boolean(exe),
      reason: exe ? null : '本机没找到这个 CLI',
    })
  }

  allowlist = allowed
  return out
}

function assertSafeFileName(name) {
  if (
    typeof name !== 'string' ||
    name.length === 0 ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('..')
  ) {
    throw new Error(`非法的临时文件名：${String(name)}`)
  }
}

function validatePlan(plan) {
  if (!plan || typeof plan !== 'object') throw new Error('plan 不是对象')

  if (typeof plan.exe !== 'string') throw new Error('plan.exe 必须是字符串')
  if (!allowlist.has(plan.exe)) {
    // 允许先跑 detect 再执行的顺序颠倒：重新探测一次再判
    detectChannels()
    if (!allowlist.has(plan.exe)) {
      throw new Error(`拒绝执行不在白名单里的可执行文件：${plan.exe}`)
    }
  }

  if (!Array.isArray(plan.args) || plan.args.some((a) => typeof a !== 'string')) {
    throw new Error('plan.args 必须是字符串数组')
  }

  if (!Array.isArray(plan.files)) throw new Error('plan.files 必须是数组')
  for (const f of plan.files) {
    assertSafeFileName(f?.name)
    if (typeof f.content !== 'string') throw new Error('文件内容必须是字符串')
    if (f.encoding !== 'utf8' && f.encoding !== 'base64') {
      throw new Error(`不支持的编码：${String(f.encoding)}`)
    }
  }

  if (plan.readFrom?.kind === 'file') assertSafeFileName(plan.readFrom.name)
  else if (plan.readFrom?.kind !== 'stdout') throw new Error('plan.readFrom 非法')

  const t = Number(plan.timeoutMs)
  if (!Number.isFinite(t) || t <= 0 || t > 15 * 60_000) {
    throw new Error(`超时设置不合理：${String(plan.timeoutMs)}`)
  }
}

async function runPlan(plan) {
  validatePlan(plan)

  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cosfix-'))
  const started = Date.now()

  try {
    for (const f of plan.files) {
      await fsp.writeFile(path.join(workDir, f.name), f.content, f.encoding)
    }

    const outcome = await new Promise((resolve, reject) => {
      let stdout = ''
      let stderr = ''
      let timedOut = false

      const child = spawn(plan.exe, plan.args, {
        cwd: workDir,
        // stdin 必须关掉：codex 不关会卡在 "Reading additional input from stdin..."
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      })

      const timer = setTimeout(() => {
        timedOut = true
        child.kill('SIGKILL')
      }, plan.timeoutMs)

      child.stdout.on('data', (d) => {
        stdout += d.toString()
      })
      child.stderr.on('data', (d) => {
        stderr += d.toString()
      })

      child.on('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })

      child.on('close', (code) => {
        clearTimeout(timer)
        resolve({ exitCode: code, stdout, stderr, timedOut })
      })
    })

    let outputFile = null
    if (plan.readFrom.kind === 'file') {
      try {
        outputFile = await fsp.readFile(
          path.join(workDir, plan.readFrom.name),
          'utf8',
        )
      } catch {
        outputFile = null
      }
    }

    return { ...outcome, outputFile, elapsedMs: Date.now() - started }
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}

module.exports = { detectChannels, runPlan, CHANNEL_CANDIDATES }
