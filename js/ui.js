// DOM interface: loader, menu, HUD, toasts, to-do sheet.
const $ = id => document.getElementById(id);

export class UI {
  constructor() {
    this.onPick = this.onPlay = this.onMenu = this.onMusic = this.onSound = this.onQuality = this.onReset = this.onTasksOpen = () => {};
    this.tasksOpen = false; this.state = 'load';
    $('play').addEventListener('click', () => this.onPlay());
    $('pauseBtn').addEventListener('click', () => this.onMenu());
    $('tasksBtn').addEventListener('click', () => this.showTasks(true));
    $('tasksClose').addEventListener('click', () => this.showTasks(false));
    $('tasks').addEventListener('click', e => { if (e.target.id === 'tasks') this.showTasks(false); });
    $('optMusic').addEventListener('click', () => this.onMusic());
    $('optSound').addEventListener('click', () => this.onSound());
    $('optQuality').addEventListener('click', () => this.onQuality());
    $('optReset').addEventListener('click', () => { if (confirm('Start over? This clears your to-do list, treats and score.')) this.onReset(); });
    this.tipT = 0;
  }

  loading(p, msg) {
    $('loadBar').style.width = Math.round(p * 100) + '%';
    if (msg !== undefined && msg !== '') $('loadMsg').textContent = msg;
    if (p >= 1) { $('loader').classList.add('done'); setTimeout(() => $('loader').classList.add('hidden'), 700); }
  }

  buildMenu(coats, sel) {
    const cards = $('cards'); cards.innerHTML = '';
    coats.forEach((c, i) => {
      const s = c.swatch, b = document.createElement('button');
      b.className = 'card';
      b.innerHTML = `<div class="swatch"><i class="e1" style="border-bottom-color:${s.ear}"></i><i class="e2" style="border-bottom-color:${s.ear}"></i>` +
        `<i class="hd" style="background:${s.head}"></i><i class="mz" style="background:${s.muzzle}"></i>` +
        `<i class="y1" style="background:${s.eye}"></i><i class="y2" style="background:${s.eye}"></i><i class="ns" style="background:${s.nose}"></i></div>` +
        `<b>${c.name}</b><span>${c.desc}</span>`;
      b.addEventListener('click', () => { this.sel = i; this.refreshCards(); this.onPick(i); });
      cards.appendChild(b);
    });
    this.sel = sel; this.refreshCards();
  }
  refreshCards() { [...$('cards').children].forEach((el, i) => el.classList.toggle('sel', i === this.sel)); }
  setPlayLabel(t) { $('play').textContent = t; }
  setOptions(o) {
    $('optMusic').textContent = 'Music: ' + (o.music ? 'on' : 'off');
    $('optSound').textContent = 'Sound: ' + (o.sound ? 'on' : 'off');
    $('optQuality').textContent = 'Graphics: ' + o.quality;
  }

  setState(s) {
    this.state = s;
    $('menu').classList.toggle('hidden', s !== 'menu');
    $('hud').classList.toggle('hidden', s !== 'play');
    if (s !== 'play') this.showTasks(false);
  }

  toast(msg, cls = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + cls; el.textContent = msg;
    const box = $('toasts');
    box.appendChild(el);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => el.remove(), 2700);
  }
  banner(small, title, sub = '') {
    const b = $('banner');
    b.innerHTML = `<small>${small}</small><b>${title}</b>${sub ? `<em>${sub}</em>` : ''}`;
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  }
  tip(text, secs = 6) {
    const el = $('tip'); el.textContent = text; el.style.opacity = text ? 1 : 0;
    clearTimeout(this.tipT); if (text && secs) this.tipT = setTimeout(() => { el.style.opacity = 0; }, secs * 1000);
  }
  bump(id) { const s = $(id); s.classList.remove('bump'); void s.offsetWidth; s.classList.add('bump'); }
  setScore(n, bump = true) { $('scoreNum').textContent = n.toLocaleString(); if (bump) this.bump('chaos'); }
  setCombo(mult, frac) {
    $('combo').textContent = mult > 1 ? '×' + mult : '';
    const bar = $('comboBar'); bar.style.opacity = mult > 1 ? 1 : 0; bar.firstElementChild.style.width = Math.round(frac * 100) + '%';
  }
  setTreats(n, total, bump = true) { $('treatNum').textContent = n; $('treatTotal').textContent = '/' + total; if (bump) this.bump('treats'); }
  setAct(label, pulse = false) {
    const b = $('btnAct');
    if (label === this.actLabel && pulse === this.actPulse) return;
    this.actLabel = label; this.actPulse = pulse;
    b.classList.toggle('none', !label); b.classList.toggle('pulse', !!pulse);
    if (label) $('actLabel').textContent = label;
  }
  setBadge(n) { const b = $('tasksBadge'); b.style.display = n > 0 ? 'block' : 'none'; b.textContent = n; }

  showTasks(on) {
    if (on === this.tasksOpen) return;
    this.tasksOpen = on; $('tasks').classList.toggle('hidden', !on);
    this.onTasksOpen(on);
  }
  renderTasks(groups, done, total, reward) {
    $('taskProgress').innerHTML = `${done} of ${total} done${reward ? ' · next reward: ' + reward : ''}<div class="bar"><i style="width:${Math.round(done / total * 100)}%"></i></div>`;
    let h = '';
    for (const g of groups) {
      h += `<h3>${g.name}</h3>`;
      for (const t of g.tasks) {
        const n = t.target > 1 && !t.done ? `<span class="n">${Math.min(t.n, t.target)}/${t.target}</span>` : '';
        h += `<div class="task${t.done ? ' done' : ''}"><span class="box">${t.done ? '✓' : ''}</span><span>${t.text}</span>${n}</div>`;
      }
    }
    $('taskList').innerHTML = h;
  }
}
