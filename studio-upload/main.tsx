// AI 热点（STEPX 版）：页面是 public/ 里的原生脚本，和安卓原生版同一份代码；这里只负责按顺序装载。
// 原生能力在脚本里按壳区分：Studio 容器走 window.capsule.invoke，朗读走 window.mcp 的 speak_text。

const STYLES = ['fonts.css', 'style.css']
const SCRIPTS = ['dirs-stub.js', 'snapshot.js', 'core.js', 'dir-signal.js', 'listen.js', 'main.js']
const SHELL = `
<header class="studio"><span id="dataStatus" hidden></span></header>
<main class="stage">
  <div class="phone">
    <div class="statusbar"><span id="sbTime"></span></div>
    <div id="app"></div>
  </div>
  <aside class="notes" id="notes"></aside>
</main>`

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = './' + src
    s.async = false
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('脚本加载失败：' + src))
    document.body.appendChild(s)
  })
}

async function boot(): Promise<void> {
  document.documentElement.classList.add('app')
  for (const href of STYLES) {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = './' + href
    document.head.appendChild(link)
  }
  const root = document.getElementById('root')
  if (!root) throw new Error('#root not found')
  root.outerHTML = SHELL
  for (const src of SCRIPTS) await loadScript(src)
}

void boot()
