const STEPS = [
  { id: 1, label: '图片管线', done: false },
  { id: 2, label: '本地指标', done: false },
  { id: 3, label: 'CLI 通道', done: false },
  { id: 4, label: '诊断框架', done: false },
  { id: 5, label: '界面', done: false },
]

export default function App() {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-baseline gap-3 border-b border-[var(--color-edge)] px-6 py-4">
        <h1 className="text-lg font-semibold tracking-tight">CosFix</h1>
        <span className="text-sm text-[var(--color-dim)]">场照诊断</span>
      </header>

      <main className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel)] p-6">
          <p className="text-sm text-[var(--color-dim)]">
            脚手架已就位。M1 剩余步骤：
          </p>
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
        </div>
      </main>
    </div>
  )
}
