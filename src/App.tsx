import { useState } from 'react'
import { runSelfTest, type SelfTestRow } from './dev/selfTest.ts'

const STEPS = [
  { id: 1, label: '图片管线', done: true },
  { id: 2, label: '本地指标', done: false },
  { id: 3, label: 'CLI 通道', done: false },
  { id: 4, label: '诊断框架', done: false },
  { id: 5, label: '界面', done: false },
]

export default function App() {
  const [rows, setRows] = useState<SelfTestRow[] | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onRun() {
    setRunning(true)
    setError(null)
    try {
      setRows(await runSelfTest())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }

  const passed = rows?.filter((r) => r.ok).length ?? 0

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-baseline gap-3 border-b border-[var(--color-edge)] px-6 py-4">
        <h1 className="text-lg font-semibold tracking-tight">CosFix</h1>
        <span className="text-sm text-[var(--color-dim)]">场照诊断</span>
      </header>

      <main className="flex-1 overflow-auto p-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          <section className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel)] p-6">
            <p className="text-sm text-[var(--color-dim)]">M1 进度</p>
            <ul className="mt-4 space-y-2">
              {STEPS.map((s) => (
                <li key={s.id} className="flex items-center gap-3 text-sm">
                  <span
                    className="inline-block size-2 rounded-full"
                    style={{
                      background: s.done
                        ? 'var(--color-fix-post)'
                        : 'var(--color-edge)',
                    }}
                  />
                  <span className={s.done ? '' : 'text-[var(--color-dim)]'}>
                    Step {s.id} — {s.label}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel)] p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-medium">图片管线自检</h2>
                <p className="mt-1 text-xs text-[var(--color-dim)]">
                  合成一张 3000×2000 的特征已知测试图，跑完整条 ingest 管线
                </p>
              </div>
              <button
                onClick={onRun}
                disabled={running}
                className="shrink-0 rounded-md border border-[var(--color-edge)] px-4 py-2 text-sm hover:bg-[var(--color-edge)] disabled:opacity-50"
              >
                {running ? '运行中…' : '运行自检'}
              </button>
            </div>

            {error && (
              <p className="mt-4 rounded-md border border-[var(--color-fix-reshoot)] px-3 py-2 text-sm text-[var(--color-fix-reshoot)]">
                {error}
              </p>
            )}

            {rows && (
              <>
                <p className="mt-4 text-sm">
                  <span
                    style={{
                      color:
                        passed === rows.length
                          ? 'var(--color-fix-post)'
                          : 'var(--color-fix-reshoot)',
                    }}
                  >
                    {passed} / {rows.length} 通过
                  </span>
                </p>
                <ul className="mt-3 space-y-3">
                  {rows.map((r) => (
                    <li key={r.label} className="flex gap-3 text-sm">
                      <span
                        className="mt-1.5 inline-block size-2 shrink-0 rounded-full"
                        style={{
                          background: r.ok
                            ? 'var(--color-fix-post)'
                            : 'var(--color-fix-reshoot)',
                        }}
                      />
                      <div className="min-w-0">
                        <p>{r.label}</p>
                        <p className="mt-0.5 break-all font-mono text-xs text-[var(--color-dim)]">
                          {r.value}
                        </p>
                        {r.note && (
                          <p className="mt-0.5 text-xs text-[var(--color-dim)] italic">
                            {r.note}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  )
}
