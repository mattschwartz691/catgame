// Gameplay: to-do list, treats, chaos score + combos, contextual actions, interactive objects, creatures.
import * as THREE from 'three';
import { sfx, loops, music, setMusicOn, setSfxOn } from './audio.js';
import { CAT_S } from './cat.js';
import { Minigames } from './minigames.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[(Math.random() * a.length) | 0];
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const SAVE_KEY = 'catabout.v2';

const TASKS = [
  ['Mischief', 'knock', 'Knock 10 things off shelves and tables', 10],
  ['Mischief', 'smash', 'Smash 5 breakable things', 5],
  ['Mischief', 'bust', 'Send a marble bust to its doom', 1],
  ['Mischief', 'shred', 'Shred the sofa', 30],
  ['Mischief', 'curtains', 'Claw the curtains', 12],
  ['Mischief', 'tp', 'Unroll 8 metres of toilet paper', 8],
  ['Mischief', 'prints', 'Leave 40 messy paw prints', 40],
  ['Mischief', 'bin', 'Tip over the kitchen bin', 1],
  ['Mischief', 'cake', 'Ruin a perfectly good cake', 1],
  ['Mischief', 'chess', 'End the chess game early', 1],
  ['Mischief', 'socks', 'Steal 3 socks and stash them in your cat bed', 3],
  ['Mischief', 'keyboard', 'Help with the typing', 24],
  ['Mischief', 'piano', 'Compose a piano piece (16 notes)', 16],
  ['Mischief', 'tv', 'Put the telly on', 1],
  ['Mischief', 'flush', 'Flush the toilet', 1],
  ['Mischief', 'tap', 'Turn on a tap', 1],
  ['Hunter', 'fly', 'Catch the fly 3 times', 3],
  ['Hunter', 'mouse', 'Pounce on a toy mouse', 1],
  ['Hunter', 'yarn', 'Unravel 10 metres of yarn', 10],
  ['Hunter', 'dangle', 'Bat the dangly toy 10 times', 10],
  ['Hunter', 'zoomies', 'Get the zoomies', 1],
  ['Hunter', 'vacuum', 'Ride the robot vacuum for 10 seconds', 10],
  ['Explorer', 'treats', 'Find 25 fish treats', 25],
  ['Explorer', 'alltreats', 'Find every last fish treat', 0],
  ['Explorer', 'high', 'Reach 6 high places', 6],
  ['Explorer', 'under', 'Find the secret spot under the bed', 1],
  ['Explorer', 'box', 'If I fits, I sits (the cardboard box)', 1],
  ['Explorer', 'tub', 'Sit in the bathtub', 1],
  ['Explorer', 'birds', 'Chatter at the birds from a windowsill', 1],
  ['Explorer', 'visit', 'Visit the big house down the street', 1],
  ['Explorer', 'stairs', 'Climb to the top of the stairs', 1],
  ['Explorer', 'car', 'Sit on the roof of a car', 1],
  ['Explorer', 'attic', 'Find the attic of the big house', 1],
  ['Mischief', 'billiards', 'Pot 3 billiard balls the cat way', 3],
  ['Games', 'mgLaser', 'Laser Chase: score 12 (living room)', 12],
  ['Games', 'mgBird', 'Stalk the Sparrow: catch all 3 (across the street)', 3],
  ['Games', 'mgLava', 'The Floor Is Lava: every fish (basement of the red house)', 9],
  ['Games', 'mgVoles', 'Vole Patrol: bop 15 (behind the red house)', 15],
  ['Games', 'mgBells', 'Attic Bells: remember 6 in a row', 6],
  ['Comfort', 'naps', 'Nap in 3 different cosy spots', 3],
  ['Comfort', 'sun', 'Snooze in a sunbeam', 1],
  ['Comfort', 'knead', 'Make biscuits on something soft', 14],
  ['Comfort', 'snack', 'Have a snack and a drink', 2],
  ['Comfort', 'post', 'Have a good scratch on a post', 12],
  ['Comfort', 'litter', 'Visit the litter box', 1],
  ['Comfort', 'meow', 'Meow 10 times. Nobody is home.', 10],
].map(([g, id, text, target]) => ({ g, id, text, target }));
const REWARDS = [[15, 'crown', 'a tiny crown'], [TASKS.length, 'gold', 'the grand crown']];

const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();

export class Game {
  constructor(c) {
    Object.assign(this, c);
    const d = this.data = this.world.data;
    this.score = 0; this.comboN = 0; this.comboT = 0; this.mult = 1;
    this.prog = {}; this.done = new Set(); this.got = new Set(); this.spots = new Set(); this.naps = new Set(); this.snack = new Set(); this.unseen = 0;
    this.opts = { music: true, sound: true };
    this.fade = 0; this.time = 0; this.tipStage = 0; this.moved = 0;
    this.dirty = null; this.carry = null; this.zoomT = 0; this.zoomCool = 0; this.rideT = 0; this.sillT = 0; this.napT = 0;
    this.strokes = {}; this.shakeCam = () => {}; this.onceSet = new Set(); this.digT = 0; this.lastSite = this.world.site;
    this.load();
    this.buildTreats();
    this.buildItems();
    this.buildActors();
    this.buildAccessories();
    this.mini = new Minigames(this);
    this.bind();
    this.syncUI(false);
    setMusicOn(false); setSfxOn(this.opts.sound);
    const ui = this.ui;
    ui.onMusic = () => { this.opts.music = !this.opts.music; setMusicOn(this.opts.music && this.playing); this.save(); this.optUI(); };
    ui.onSound = () => { this.opts.sound = !this.opts.sound; setSfxOn(this.opts.sound); this.save(); this.optUI(); };
    ui.onReset = () => { try { localStorage.removeItem(SAVE_KEY); } catch {} location.reload(); };
    ui.onTasksOpen = (on) => { if (on) { this.unseen = 0; ui.setBadge(0); this.renderTasks(); sfx.open(); } else sfx.close(); };
    this.optUI();
  }
  optUI() { this.ui.setOptions({ music: this.opts.music, sound: this.opts.sound, quality: this.qualityName || 'auto' }); }

  // ------------------------------------------------------------ persistence
  load() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); if (!s) return;
      this.score = s.score || 0; this.prog = s.prog || {}; this.done = new Set(s.done || []); this.got = new Set(s.got || []);
      this.highs = new Set(s.highs || []); this.spots = new Set(s.spots || []); this.naps = new Set(s.naps || []); this.snack = new Set(s.snack || []); Object.assign(this.opts, s.opts || {});
      this.tipStage = s.tip || 0;
    } catch {}
  }
  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ score: this.score, prog: this.prog, done: [...this.done], got: [...this.got], spots: [...this.spots], highs: [...(this.highs || [])], naps: [...this.naps], snack: [...this.snack], opts: this.opts, tip: this.tipStage }));
    } catch {}
  }

  // ------------------------------------------------------------ tasks + score
  renderTasks() {
    const groups = [];
    for (const t of TASKS) {
      let g = groups.find(x => x.name === t.g); if (!g) groups.push(g = { name: t.g, tasks: [] });
      g.tasks.push({ text: t.text, target: t.target, n: Math.floor(this.prog[t.id] || 0), done: this.done.has(t.id) });
    }
    const next = REWARDS.find(r => this.done.size < r[0]);
    this.ui.renderTasks(groups, this.done.size, TASKS.length, next ? `${next[2]} at ${next[0]}` : '');
  }
  task(id, n = 1, absolute = false) {
    if (this.done.has(id)) return;
    const t = TASKS.find(x => x.id === id); if (!t) return;
    const before = this.prog[id] || 0;
    this.prog[id] = absolute ? Math.max(before, n) : before + n;
    if (this.prog[id] >= t.target) {
      this.done.add(id); this.unseen++; this.ui.setBadge(this.unseen);
      const before = REWARDS.filter(r => this.done.size - 1 >= r[0]).length, after = REWARDS.filter(r => this.done.size >= r[0]).length;
      this.score += 150; this.ui.setScore(this.score);
      if (after > before) {
        const r = REWARDS[after - 1];
        this.ui.banner('New look unlocked', `You earned ${r[2]}!`, `${this.done.size} of ${TASKS.length} to-do's done`); sfx.unlock(); this.applyAccessories();
      } else { this.ui.banner('To-do done', t.text, `${this.done.size} of ${TASKS.length}`); sfx.taskDone(); }
      this.save();
    }
    if (this.ui.tasksOpen && Math.floor(this.prog[id]) !== Math.floor(before)) this.renderTasks();
  }
  // one-off bonuses, so flushing forty times is not a winning strategy
  once(key, points, msg) { if (this.onceSet.has(key)) return false; this.onceSet.add(key); this.chaos(points, msg); return true; }
  chaos(points, msg) {
    this.comboN++; this.comboT = 4.5;
    const m = Math.min(8, 1 + Math.floor((this.comboN - 1) / 2));
    if (m > this.mult) sfx.combo({ n: m });
    this.mult = m;
    const gain = points * m;
    this.score += gain; this.ui.setScore(this.score);
    if (msg) this.ui.toast(msg + (m > 1 ? `  +${gain} ×${m}` : `  +${gain}`), 'score');
    if (m >= 4 && this.zoomT <= 0 && this.zoomCool <= 0) this.zoomies();
  }
  zoomies() {
    this.zoomT = 12; this.zoomCool = 40; this.cat.speedMul = 1.55;
    this.ui.banner('Uh oh', 'ZOOMIES!', 'Maximum speed for 12 seconds'); sfx.zoomies(); music.setMood('zoomies'); this.task('zoomies');
  }
  discover(key, msg, pts = 20) {
    if (this.spots.has(key)) return false;
    this.spots.add(key); this.ui.toast(msg, 'find'); sfx.pop(); this.score += pts; this.ui.setScore(this.score); this.save(); return true;
  }
  syncUI(bump) { this.ui.setScore(this.score, bump); this.ui.setTreats(this.got.size, this.treatTotal, bump); this.ui.setCombo(1, 0); }

  // ------------------------------------------------------------ treats
  buildTreats() {
    const body = new THREE.SphereGeometry(0.05, 12, 8); body.scale(1.35, 0.8, 0.45);
    const tail = new THREE.ConeGeometry(0.04, 0.06, 3); tail.rotateZ(Math.PI / 2); tail.scale(1, 1, 0.4); tail.translate(-0.085, 0, 0);
    const pos = [], nor = [], idx = []; let off = 0;
    for (const g of [body, tail]) {
      const gi = g.index ? g.toNonIndexed() : g;
      pos.push(...gi.attributes.position.array); nor.push(...gi.attributes.normal.array);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    if (this.treatMesh) { this.scene.remove(this.treatMesh); this.treatMesh.dispose(); }
    const mat = new THREE.MeshStandardMaterial({ clippingPlanes: [this.world.clip], color: 0xffc04a, emissive: 0xff9a1a, emissiveIntensity: 0.9, roughness: 0.35, metalness: 0.3 });
    const T = this.data.treats;
    this.treatMesh = new THREE.InstancedMesh(geo, mat, T.length); this.treatMesh.frustumCulled = false; this.treatMesh.castShadow = false;
    this.scene.add(this.treatMesh);
    this.treatPh = T.map(() => rnd(0, 6.28));
    this.treatTotal = Math.max(T.length, (this.data.manifest && this.data.manifest.treats) || 0);
    TASKS.find(t => t.id === 'alltreats').target = this.treatTotal;
  }
  updateTreats(dt, t) {
    const T = this.data.treats, cat = this.cat;
    for (let i = 0; i < T.length; i++) {
      const p = T[i];
      if (this.got.has(i)) { _m.makeScale(0, 0, 0); this.treatMesh.setMatrixAt(i, _m); continue; }
      const ph = this.treatPh[i], y = p[1] + Math.sin(t * 2 + ph) * 0.025;
      _q.setFromAxisAngle(_v.set(0, 1, 0), t * 1.6 + ph);
      _m.compose(_a.set(p[0], y, p[2]), _q, _s.set(0.62, 0.62, 0.62)); this.treatMesh.setMatrixAt(i, _m);
      const dx = p[0] - cat.pos.x, dy = y - (cat.pos.y + 0.2), dz = p[2] - cat.pos.z;
      if (this.playing && dx * dx + dz * dz < 0.16 && Math.abs(dy) < 0.42) {
        this.got.add(i); if (this.onTreat) this.onTreat(i); this.treatCombo = (this.treatT > 0 ? (this.treatCombo || 0) + 1 : 0); this.treatT = 3;
        sfx.collect({ n: this.treatCombo }); this.fx.burst(_a, 8, [0xffd27a, 0xfff1c9], { speed: 1.2, grav: 0.3, size: 0.016, life: 0.8 });
        this.score += 10; this.ui.setScore(this.score, false); this.ui.setTreats(this.got.size, this.treatTotal);
        this.task('treats', this.got.size, true); this.task('alltreats', this.got.size, true); this.save();
      }
    }
    this.treatMesh.instanceMatrix.needsUpdate = true;
    if (this.treatT > 0) this.treatT -= dt;
  }

  // ------------------------------------------------------------ interactive items
  // a friend found this one: it is gone from the shared house, and counts for everybody
  remoteTreat(i) {
    if (!Number.isInteger(i) || i < 0 || i > 5000 || this.got.has(i)) return;
    this.got.add(i); this.ui.setTreats(this.got.size, this.treatTotal);
    this.task('treats', this.got.size, true); this.task('alltreats', this.got.size, true); this.save();
  }

  buildItems(list = this.data.items) {
    const sc = this.scene, clip = [this.world.clip];
    const fresh = list.map(i => ({ ...i }));
    this.items = (this.items || []).concat(fresh);
    const by = k => fresh.filter(i => i.kind === k);
    // TV
    for (const it of by('tv')) {
      const cv = document.createElement('canvas'); cv.width = 128; cv.height = 96; it.cv = cv; it.g = cv.getContext('2d');
      it.tex = new THREE.CanvasTexture(cv); it.tex.colorSpace = THREE.SRGBColorSpace;
      it.mat = new THREE.MeshBasicMaterial({ map: it.tex, color: 0x000000, clippingPlanes: clip });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(it.size[0], it.size[1]), it.mat);
      m.position.set(it.p[0], it.p[1], it.p[2]); m.rotation.y = Math.atan2(it.n[0], it.n[1]); sc.add(m);
      it.on = false; it.birds = [0, 1, 2].map(i => ({ x: rnd(0, 128), y: 22 + i * 16, v: rnd(18, 34) }));
    }
    // laptop screen
    for (const it of by('laptop')) {
      const cv = document.createElement('canvas'); cv.width = 128; cv.height = 96; it.cv = cv; it.g = cv.getContext('2d'); it.text = 'Dear diary,\n';
      it.tex = new THREE.CanvasTexture(cv); it.tex.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(it.size[0] * 0.62, it.size[1] * 0.62), new THREE.MeshBasicMaterial({ map: it.tex }));
      m.position.set(it.screen[0], it.screen[1], it.screen[2] + 0.012); m.rotation.x = -0.12; sc.add(m);
      this.drawLaptop(it);
    }
    // taps: a stream of water that can be switched on
    for (const it of by('faucet')) {
      const h = it.p[1] - it.basin[1];
      it.water = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.01, h, 6), new THREE.MeshPhysicalMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.6, roughness: 0.05, clippingPlanes: clip }));
      it.water.position.set(it.p[0], it.p[1] - h / 2, it.p[2]); it.water.visible = false; sc.add(it.water); it.on = false;
    }
    // toilet-roll holder on the wall
    for (const it of by('tp')) {
      const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, side: THREE.DoubleSide, clippingPlanes: clip });
      const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.1, 18), white); roll.rotation.x = Math.PI / 2;
      roll.position.set(it.p[0], it.p[1], it.p[2]); roll.castShadow = true; sc.add(roll); it.roll = roll;
      it.sheet = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 1), white); it.sheet.rotation.y = Math.PI / 2;
      it.sheet.position.set(it.p[0] + it.n[0] * 0.056, it.p[1], it.p[2]); it.sheet.scale.y = 0.001; sc.add(it.sheet);
      it.len = 0; it.floor = null;
    }
    // dangly toy
    for (const it of by('dangle')) {
      const piv = new THREE.Group(); piv.position.set(it.p[0], it.p[1], it.p[2]); sc.add(piv);
      const str = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, it.len), new THREE.MeshBasicMaterial({ color: 0xffffff })); str.position.y = -it.len / 2; piv.add(str);
      const bob = new THREE.Mesh(new THREE.SphereGeometry(0.055, 14, 10), new THREE.MeshStandardMaterial({ color: 0xe8556a, roughness: 0.6 })); bob.position.y = -it.len; bob.castShadow = true; piv.add(bob);
      for (let i = 0; i < 4; i++) { const f = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.1, 6), new THREE.MeshStandardMaterial({ color: [0xf2c14e, 0x4f9bd9, 0x9bdb5a, 0xffffff][i] })); f.position.set(Math.sin(i * 1.6) * 0.03, -it.len - 0.08, Math.cos(i * 1.6) * 0.03); f.rotation.x = Math.PI; piv.add(f); }
      Object.assign(it, { piv, ax: 0, az: 0, vx: 0, vz: 0, bob: new THREE.Vector3(it.p[0], it.p[1] - it.len, it.p[2]) });
    }
    if (!this.trails) { this.trails = new Map(); this.sockStash = 0; }
  }
  // a house that finished loading after play began
  addArea(d) { this.buildTreats(); this.buildItems(d.items || []); this.syncUI(false); this.mini.addStations(d.site || 'colonial'); }
  drawTV(it, t) {
    const g = it.g; const gr = g.createLinearGradient(0, 0, 0, 96); gr.addColorStop(0, '#7cc4f2'); gr.addColorStop(0.7, '#d9f0fb'); gr.addColorStop(0.71, '#7fbf6a'); gr.addColorStop(1, '#5fa04e');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 96);
    g.fillStyle = '#fff'; g.beginPath(); g.arc(30 + Math.sin(t * 0.2) * 8, 20, 9, 0, 7); g.arc(44 + Math.sin(t * 0.2) * 8, 17, 11, 0, 7); g.fill();
    for (const b of it.birds) {
      b.x += b.v * 0.1; if (b.x > 140) { b.x = -12; b.y = rnd(14, 56); }
      const w = Math.sin(t * 14 + b.v) * 5; g.strokeStyle = '#333'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(b.x - 8, b.y - w); g.quadraticCurveTo(b.x - 3, b.y - 3, b.x, b.y); g.quadraticCurveTo(b.x + 3, b.y - 3, b.x + 8, b.y - w); g.stroke();
    }
    g.fillStyle = 'rgba(0,0,0,.12)'; for (let y = 0; y < 96; y += 3) g.fillRect(0, y, 128, 1);
    it.tex.needsUpdate = true;
  }
  drawLaptop(it) {
    const g = it.g; g.fillStyle = '#101820'; g.fillRect(0, 0, 128, 96); g.fillStyle = '#7dffa0'; g.font = '9px monospace';
    const lines = it.text.split('\n').slice(-8); lines.forEach((l, i) => g.fillText(l.slice(-22), 5, 13 + i * 10.5));
    it.tex.needsUpdate = true;
  }
  pawItems(e) {
    let hit = 0; const P = e.point;
    for (const it of this.items) {
      if (!it.p) continue;
      const r = it.kind === 'tv' ? 0.75 : (it.r || 0.55);       // reach is judged flat on the floor, with a generous height window
      if (Math.hypot(it.p[0] - P.x, it.p[2] - P.z) > r || Math.abs(it.p[1] - P.y) > 0.85) continue;
      switch (it.kind) {
        case 'tv': it.on = !it.on; it.mat.color.set(it.on ? 0xffffff : 0x000000); it.on ? sfx.tvOn() : sfx.tvOff(); if (it.on) { loops.tvStatic.start(); loops.tvStatic.set(0.35); this.task('tv'); this.once('tv', 15, 'Telly time'); } else loops.tvStatic.stop(); hit++; break;
        case 'boombox': this.opts.music = !this.opts.music || this.boom !== true; this.boom = this.opts.music; setMusicOn(this.opts.music); music.setMood(this.opts.music ? 'playful' : 'calm'); sfx.click(); this.optUI();
          this.ui.toast(this.opts.music ? 'Tunes on' : 'Tunes off'); hit++; break;
        case 'faucet': it.on = !it.on; it.water.visible = it.on; sfx.click(); if (it.on) { this.task('tap'); this.once('tap' + it.p[0], 15, 'Left the tap running'); } hit++; break;
        case 'flush': sfx.flush(); this.task('flush'); this.once('flush', 15, 'Flushed'); hit++; break;
        case 'tp': this.unrollTP(it, 0.3); hit++; break;
        case 'chess': if (!it.done) { it.done = true; this.fx.burst(new THREE.Vector3(...it.p), 22, [0x151515, 0xf2f0ea], { speed: 2, size: 0.022 }); sfx.hit({ kind: 'wood', vol: 0.8 }); this.task('chess'); this.chaos(40, 'Checkmate'); hit++; } break;
      }
    }
    for (const it of this.items) if (it.kind === 'dangle' && _v.copy(it.bob).sub(P).length() < 0.45) {
      it.vx += e.fx * 5 - e.fz * e.side * 2; it.vz += e.fz * 5 + e.fx * e.side * 2; hit++; sfx.hit({ kind: 'jingle', vol: 0.5 }); this.task('dangle');
    }
    if (e.remote) return hit;
    const v = this.vac;
    if (v && Math.hypot(v.pos.x - P.x, v.pos.z - P.z) < 0.4 && Math.abs(P.y - 0.1) < 0.4) { v.on = !v.on; sfx.vacuumBeep(); hit++; this.ui.toast(v.on ? 'The robot wakes up' : 'The robot naps'); }
    const f = this.fly;
    if (f && f.alive && _v.copy(f.pos).sub(P).length() < 0.42) { this.catchFly(); hit++; }
    return hit;
  }
  unrollTP(it, n) {
    it.len += n; sfx.paperRip(); this.task('tp', n);
    const drop = Math.min(it.len, it.p[1] - 0.01);
    it.sheet.scale.y = drop; it.sheet.position.y = it.p[1] - drop / 2; it.roll.rotation.z += 1.3;
    if (it.len > drop) {
      if (!it.floor) it.floor = this.fx.ribbon(0xffffff, 0.1, 80);
      const k = it.len - drop;           // snake back and forth near the wall instead of running off through the house
      const row = Math.floor(k / 1.2), u = k - row * 1.2;
      it.floor.add(it.p[0] + it.n[0] * (0.08 + (row % 2 ? 1.2 - u : u)), 0.006 + row * 0.002, it.p[2] + 0.12 * row - 0.3 + Math.sin(k * 5) * 0.03);
    }
    this.once('tp', 10, 'Unrolling…');
  }

  // ------------------------------------------------------------ creatures
  buildActors() {
    const sc = this.scene, d = this.data;
    // robot vacuum: wanders like the real thing, and is a rideable platform
    const it = this.items.find(i => i.kind === 'vacuum');
    if (it) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.07, 28), new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: 0.3, metalness: 0.2 })); body.position.y = 0.045; body.castShadow = true; g.add(body);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.012, 28), new THREE.MeshStandardMaterial({ color: 0x3a3d45, roughness: 0.15, metalness: 0.5 })); top.position.y = 0.086; g.add(top);
      const led = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.006, 12), new THREE.MeshBasicMaterial({ color: 0x40ff90 })); led.position.set(0, 0.094, 0.08); g.add(led);
      g.position.set(it.p[0], 0, it.p[2]); sc.add(g);
      const box = this.world.addBox({ minX: 0, maxX: 0, minY: 0, maxY: 0.092, minZ: 0, maxZ: 0, cam: false, fade: null, spot: null, mover: true, dx: 0, dz: 0 });
      this.vac = { g, led, box, pos: g.position, dir: Math.PI, on: false, wake: 30, turn: 5, stuck: 0 };
    }
    // the fly
    {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4 })));
      const wm = new THREE.MeshBasicMaterial({ color: 0xdfefff, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false });
      const w1 = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.014), wm), w2 = w1.clone(); w1.position.set(0.016, 0.008, 0); w2.position.set(-0.016, 0.008, 0); g.add(w1, w2);
      sc.add(g);
      this.fly = { g, w1, w2, pos: g.position, vel: new THREE.Vector3(), tgt: new THREE.Vector3(), alive: true, sit: 0, respawn: 0, t: 0 };
      this.flyPerch(true);
    }
  }
  flyPerch(first) {
    const f = this.fly, T = this.data.treats;
    for (let k = 0; k < 30; k++) {
      const p = pick(T); _a.set(p[0], p[1] + 0.02, p[2]);
      if (first) { if (p[0] < -1 && p[2] > -1) { f.pos.copy(_a); f.tgt.copy(_a); f.sit = 2; return; } continue; }
      const dist = _a.distanceTo(f.pos);
      if (dist > 1.2 && dist < 7 && this.world.segClear(f.pos, _a)) { f.tgt.copy(_a); return; }
    }
    f.tgt.set(f.pos.x + rnd(-1, 1), clamp(f.pos.y + rnd(-0.3, 0.5), 0.3, 1.8), f.pos.z + rnd(-1, 1));
  }
  catchFly() {
    const f = this.fly; if (!f.alive) return;
    f.alive = false; f.g.visible = false; f.respawn = 9;
    sfx.catch(); this.fx.burst(f.pos, 6, [0xffffff, 0xffd27a], { speed: 1, grav: 0.2, size: 0.012 });
    this.task('fly'); this.chaos(50, pick(['Got it!', 'Fly: caught', 'Snack with wings']));
  }
  updateActors(dt, t) {
    const cat = this.cat, w = this.world;
    // ---- vacuum
    const v = this.vac;
    if (v) {
      if (!v.on && this.playing) { v.wake -= dt; if (v.wake < 0) { v.on = true; v.wake = 1e9; } }
      const ox = v.pos.x, oz = v.pos.z;
      if (v.on) {
        v.turn -= dt; if (v.turn < 0) { v.turn = rnd(4, 9); v.dir += rnd(-1.2, 1.2); }
        const sp = 0.42; _a.set(v.pos.x + Math.sin(v.dir) * sp * dt, 0, v.pos.z + Math.cos(v.dir) * sp * dt);
        const want = _b.copy(_a); v.box.maxY = -5; v.box.minY = -6;
        const vel = _v.set(Math.sin(v.dir), 0, Math.cos(v.dir));
        w.resolveXZ(_a, 0.19, 0.08, vel, false);
        v.box.minY = 0; v.box.maxY = 0.092;
        const blockedByCat = cat.grounded && cat.ground !== v.box && Math.hypot(cat.pos.x - _a.x, cat.pos.z - _a.z) < 0.4 && cat.pos.y < 0.2;
        if (_a.distanceTo(want) > 0.002 || blockedByCat) {
          v.dir += Math.PI * rnd(0.55, 1.1) * (Math.random() < 0.5 ? -1 : 1); v.turn = rnd(3, 7);
          if (t - (v.bumpT || 0) > 0.8) { v.bumpT = t; if (Math.hypot(cat.pos.x - v.pos.x, cat.pos.z - v.pos.z) < 5) sfx.vacuumBump({ vol: 0.5 }); }
        }
        if (!blockedByCat) { v.pos.x = _a.x; v.pos.z = _a.z; }
        v.g.rotation.y = v.dir;
        for (const p of this.props.list) {        // shoves small things along
          if (p.dead || p.held || p.pos.y > 0.25) continue;
          const dx = p.pos.x - v.pos.x, dz = p.pos.z - v.pos.z, dd = Math.hypot(dx, dz);
          if (dd < 0.19 + p.r && dd > 1e-3) { p.vel.x += dx / dd * 0.9 * dt * 60; p.vel.z += dz / dd * 0.9 * dt * 60; p.asleep = false; p.still = 0; }
        }
      }
      v.led.material.color.set(v.on ? 0x40ff90 : 0xff5040);
      const b = v.box; b.dx = v.pos.x - ox; b.dz = v.pos.z - oz;
      b.minX = v.pos.x - 0.15; b.maxX = v.pos.x + 0.15; b.minZ = v.pos.z - 0.15; b.maxZ = v.pos.z + 0.15;
      loops.vacuum.set(v.on ? clamp(1 - Math.hypot(cat.pos.x - v.pos.x, cat.pos.z - v.pos.z) / 7, 0, 1) * 0.8 : 0);
      if (cat.grounded && cat.ground === b && v.on) { this.rideT += dt; this.task('vacuum', dt); if (!this.rodeToast && this.rideT > 1) { this.rodeToast = true; this.ui.toast('All aboard the robot'); } }
    }
    // ---- fly
    const f = this.fly;
    if (!f.alive) { f.respawn -= dt; if (f.respawn < 0) { f.alive = true; f.g.visible = true; this.flyPerch(false); f.pos.copy(f.tgt); f.sit = 3; } }
    else {
      f.t += dt;
      const dc = f.pos.distanceTo(_a.set(cat.pos.x, cat.pos.y + 0.25, cat.pos.z));
      if (f.sit > 0) {
        f.sit -= dt; if (dc < 0.75 && cat.charge === 0 && Math.hypot(cat.vel.x, cat.vel.z) > 0.9) f.sit = 0;     // spooked by a clumsy approach
        if (f.sit <= 0) this.flyPerch(false);
        f.w1.rotation.z = 0.2; f.w2.rotation.z = -0.2;
      } else {
        _b.subVectors(f.tgt, f.pos); const d = _b.length();
        if (d < 0.08) { f.pos.copy(f.tgt); f.sit = rnd(3, 7); f.vel.set(0, 0, 0); }
        else {
          _b.multiplyScalar(1 / d); f.vel.lerp(_b.multiplyScalar(1.7), 1 - Math.exp(-4 * dt));
          f.pos.addScaledVector(f.vel, dt);
          f.pos.x += Math.sin(f.t * 13) * 0.25 * dt; f.pos.y += Math.sin(f.t * 17 + 1) * 0.3 * dt; f.pos.z += Math.cos(f.t * 11) * 0.25 * dt;
        }
        f.w1.rotation.z = Math.sin(f.t * 90) * 0.9; f.w2.rotation.z = -Math.sin(f.t * 90) * 0.9;
      }
      loops.fly.set(f.sit > 0 ? 0 : clamp(1 - dc / 3.5, 0, 1) * 0.7);
      if (cat.pouncing && dc < 0.32) this.catchFly();
    }
    if (!f.alive) loops.fly.set(0);
    // ---- dangly toys
    for (const s of this.items) {
      if (s.kind !== 'dangle') continue;
      s.vx += (-22 * s.ax - 1.1 * s.vx) * dt; s.vz += (-22 * s.az - 1.1 * s.vz) * dt;
      s.ax = clamp(s.ax + s.vx * dt, -1.3, 1.3); s.az = clamp(s.az + s.vz * dt, -1.3, 1.3);
      s.piv.rotation.set(-s.az, 0, s.ax);
      s.bob.set(s.p[0] + Math.sin(s.ax) * s.len, s.p[1] - Math.cos(Math.hypot(s.ax, s.az)) * s.len, s.p[2] + Math.sin(s.az) * s.len);
      const dx = s.bob.x - cat.pos.x, dz = s.bob.z - cat.pos.z, dy = s.bob.y - (cat.pos.y + 0.25);
      if (dx * dx + dz * dz + dy * dy < 0.06) { s.vx += dx * 30 * dt + cat.vel.x * 3 * dt; s.vz += dz * 30 * dt + cat.vel.z * 3 * dt; }
    }
    // ---- screens
    this.tvT = (this.tvT || 0) + dt;
    if (this.tvT > 0.1) { this.tvT = 0; for (const it of this.items) if (it.kind === 'tv' && it.on) this.drawTV(it, t); }
  }

  // ------------------------------------------------------------ accessories earned from the to-do list
  buildAccessories() {
    const cat = this.cat, J = cat.J, head = cat.model.bone.head;
    const g = this.acc = new THREE.Group(); head.add(g);
    const red = new THREE.MeshStandardMaterial({ color: 0xc8322c, roughness: 0.6 }), gold = new THREE.MeshStandardMaterial({ color: 0xffc94a, roughness: 0.25, metalness: 0.9 });
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.078, 0.011, 8, 28), red); collar.position.set(0, J.head.y - 0.062, J.head.z - 0.035); collar.rotation.x = Math.PI / 2 - 0.75; collar.scale.set(1, 0.95, 1);
    const bell = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), gold); bell.position.set(0, J.head.y - 0.118, J.head.z + 0.03);
    const bow = new THREE.Group(); bow.position.set(0, J.head.y - 0.105, J.head.z + 0.035);
    const blue = new THREE.MeshStandardMaterial({ color: 0x2f5fb0, roughness: 0.7 });
    for (const s of [1, -1]) { const c = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.05, 4), blue); c.rotation.z = s * Math.PI / 2; c.position.x = s * 0.03; c.scale.z = 0.5; bow.add(c); }
    bow.add(new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), blue));
    const crown = new THREE.Group(); crown.position.set(0, J.head.y + 0.105, J.head.z - 0.005);
    crown.add(new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.032, 0.022, 14, 1, true), gold));
    for (let i = 0; i < 5; i++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.01, 0.03, 4), gold); const a = i / 5 * Math.PI * 2; sp.position.set(Math.sin(a) * 0.034, 0.025, Math.cos(a) * 0.034); crown.add(sp); }
    for (const m of [collar, bell, bow, crown]) g.add(m);
    this.accParts = { collar, bell, bow, crown, gold };
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    this.applyAccessories();
  }
  applyAccessories() {
    const n = this.done.size, a = this.accParts;
    a.collar.visible = a.bell.visible = a.bow.visible = false;          // no collars: these cats answer to nobody
    a.crown.visible = n >= REWARDS[0][0]; a.crown.scale.setScalar(n >= REWARDS[1][0] ? 1.35 : 1);
  }

  // ------------------------------------------------------------ events
  bind() {
    const cat = this.cat, fx = this.fx, props = this.props;
    cat.emit = (type, e) => {
      switch (type) {
        case 'jump': sfx.jump(); break;
        case 'land': sfx.land({ impact: e }); if (e > 7) { fx.burst(_v.copy(cat.pos).setY(cat.pos.y + 0.03), 6, 0xe9e2d6, { speed: 0.9, up: 0.8, grav: 0.25, size: 0.03, life: 0.7 }); this.shakeCam(0.012); } break;
        case 'meow': sfx.meow({ kind: e || pick(['meow', 'meow', 'meow', 'chirp', 'kitten']) }); if (this.playing && (!e || e === 'meow')) this.task('meow'); break;
        case 'step': this.onStep(e); break;
        case 'paw': { const n = props.hit(e) + this.pawItems(e) + this.mini.onPaw(e, false); if (n) sfx.bap(); else sfx.swipe(); } break;
        case 'pounce': sfx.pounce(); this.pounceCaught = false; break;
        case 'pounceLand': {
          props.hit({ ...e, side: 0 }, 0.42, 1.35); this.mini.onPaw(e, true);
          const f = this.fly; if (f.alive && f.pos.distanceTo(e.point) < 0.6) this.catchFly();
          const prey = props.nearest(e.point, 0.5, p => p.d.prey);
          if (prey && !this.pounceCaught) { this.pounceCaught = true; sfx.catch(); this.task('mouse'); this.chaos(30, 'Pounced!'); fx.burst(prey.pos, 5, 0xffffff, { speed: 1, size: 0.012 }); }
        } break;
        case 'scratch': this.onScratch(e); break;
        case 'snore': e ? sfx.snoreOut() : sfx.snoreIn(); if (!e) fx.float(_v.copy(cat.pos).add(_a.set(0.1, 0.35, 0)), 'z', '#cfe6ff', { size: 0.11, life: 1.8, vy: 0.22 }); break;
        case 'eat': sfx.crunch(); break;
        case 'groom': sfx.lap(); if (Math.random() < 0.45) fx.float(_v.copy(cat.pos).add(_a.set(Math.sin(cat.yaw) * 0.3 + rnd(-0.08, 0.08), 0.4, Math.cos(cat.yaw) * 0.3)), '♥', '#ff8fa3', { size: 0.09 }); break;
        case 'drink': sfx.lap(); break;
        case 'knead': this.task('knead'); if (Math.random() < 0.3) fx.float(_v.copy(cat.pos).add(_a.set(rnd(-0.1, 0.1), 0.4, 0)), '♥', '#ff8fa3', { size: 0.1 }); break;
        case 'actionEnd': if (e.kind === 'nap') { music.setMood(this.zoomT > 0 ? 'zoomies' : this.boom ? 'playful' : 'calm'); } break;
      }
    };
    props.emit = (type, e) => {
      switch (type) {
        case 'bap': sfx.hit({ kind: e.d.snd, vol: 0.6 }); if (e.d.strum) for (let i = 0; i < 4; i++) setTimeout(() => sfx.piano({ note: [4, 9, 12, 16][i], vol: 0.5 }), i * 45); break;
        case 'impact': sfx.hit({ kind: e.p.d.snd, vol: clamp(e.impact * 0.14, 0.1, 0.9) }); break;
        case 'smash': {
          const p = e, d = p.d;
          sfx.smash({ kind: d.brk }); this.shakeCam(0.03);
          fx.burst(p.pos, 16, [d.col ?? 0xffffff, d.col ?? 0xffffff, 0xffffff], { speed: 2.4, size: 0.03 });
          if (d.brk === 'pot') fx.burst(p.pos, 8, [0x5a3a22, 0x5fa55a], { speed: 1.6 });
          const gy = this.world.groundAt(p.pos.x, p.pos.z, p.pos.y + 0.05).y;
          if (d.wet) fx.spill(p.pos.x, gy, p.pos.z, 0.5, 0x8fb8d0, 'water');
          if (d.spill) fx.spill(p.pos.x, gy, p.pos.z, d.spill.r * 1.6, d.spill.col, d.spill.kind);
          this.task('smash'); if (p.id.startsWith('marble_bust')) this.task('bust');
          this.chaos(25 * (d.score || 1), `Smashed the ${d.name}`);
        } break;
        case 'tipped': this.fx.burst(e.pos, 20, e.d.spillBits || [0xffffff], { speed: 1.6, size: 0.02 }); sfx.hit({ kind: 'metal', vol: 1 }); this.task('bin'); this.chaos(30, 'Bin day'); break;
        case 'knocked': if (e.id.startsWith('marble_bust')) this.task('bust');
          if (e.id === 'ball' && e.homeY < -1) this.task('billiards');
          this.task('knock'); this.chaos(10 * (e.d.score || 1), pick([`Knocked the ${e.name} off`, `The ${e.name} was in the way`, `Gravity check: ${e.name}`, `Bye bye, ${e.name}`])); break;
        case 'spill': {
          const p = e, d = p.d, gy = this.world.groundAt(p.pos.x, p.pos.z, p.pos.y + 0.05).y;
          if (d.spillBits) fx.burst(p.pos, 18, d.spillBits, { speed: 1.5, size: 0.016 });
          if (d.spill) { fx.spill(p.pos.x, gy, p.pos.z, d.spill.r * 2, d.spill.col, d.spill.kind); this.chaos(20, `Spilled the ${d.name}`); }
          if (d.splat) { fx.spill(p.pos.x, gy, p.pos.z, 0.5, d.splat, 'cake'); this.task('cake'); this.chaos(30, `Splatted the ${d.name}`); sfx.splash({ vol: 0.5 }); p.dead = true; this.scene.remove(p.g); }
        } break;
      }
    };
  }
  surfaceAt(x, y, z) {
    const fl = this.world.floorY(y);
    if (y - fl > 0.05) return 'wood';
    if (this.world.site === 'home') { if (x < -0.6 && z < -1.2) return 'tile'; if (x > 1.4 && x < 8 && z > -2 && z < 0.9) return 'tile'; }
    else if (!this.world.site) return 'tile';
    for (const s of this.data.scratch) if (s.type === 'floor' && (s.y0 || 0) === fl && x > s.b[0] && x < s.b[1] && z > s.b[2] && z < s.b[3]) return 'carpet';
    return 'wood';
  }
  onStep(e) {
    if (!this.playing) return;
    const cat = this.cat;
    if (e.speed > 2.2) sfx.step({ surface: this.surfaceAt(e.x, e.y, e.z), vol: clamp(0.06 + e.speed * 0.03, 0.08, 0.2) });      // cats walk silently; only a gallop patters
    const sp = this.fx.spillAt(e.x, e.y, e.z);
    if (sp) this.dirty = { col: sp.col, n: sp.kind === 'water' ? 14 : 30, kind: sp.kind };
    else if (this.dirty && this.dirty.n > 0) {
      this.dirty.n--; this.fx.pawPrint(e.x, e.y, e.z, e.yaw, this.dirty.col); this.task('prints');
    }
    for (const it of this.items) {
      if (it.kind === 'piano' && Math.abs(e.y - it.y) < 0.06 && e.x > it.b[0] && e.x < it.b[1] && e.z > it.b[2] - 0.1 && e.z < it.b[3] + 0.1) {
        const n = clamp(Math.floor((e.x - it.b[0]) / (it.b[1] - it.b[0]) * it.keys), 0, it.keys - 1);
        sfx.piano({ note: n }); this.task('piano'); this.fx.float(_v.set(e.x, e.y + 0.3, e.z), pick(['♪', '♫']), '#ffe08a', { size: 0.12 });
      }
      if (it.kind === 'laptop' && Math.abs(e.y - (it.p[1] - 0.03)) < 0.1 && Math.hypot(e.x - it.p[0], e.z - it.p[2]) < 0.34) {
        it.text += pick('asdfjkl;qwertyuiopzxcvbnm,./    ') + (Math.random() < 0.3 ? pick('asdfjkl;') : ''); if (it.text.length > 400) it.text = it.text.slice(-300);
        this.drawLaptop(it); sfx.hit({ kind: 'tick', vol: 0.4 }); this.task('keyboard');
      }
    }
  }
  onScratch(e) {
    const sc = e.sc, cat = this.cat;
    sfx.scratch({ surface: sc.surface || 'rope' });
    this.fx.burst(e.point, 2, sc.type === 'post' ? 0xd8b98a : 0xf5efe6, { speed: 0.8, up: 1, grav: 0.5, size: 0.014 });
    const k = sc.name; this.strokes[k] = (this.strokes[k] || 0) + 1;
    if (sc.type === 'wall') {
      const off = rnd(-0.1, 0.1), y = rnd(0.2, 0.52);
      if (sc.axis === 'x') this.fx.scratchMark(sc.at + sc.n * 0.004, y, cat.pos.z + off, 'x', sc.n); else this.fx.scratchMark(cat.pos.x + off, y, sc.at + sc.n * 0.004, 'z', sc.n);
      if (k === 'sofa') { this.task('shred'); if (this.strokes[k] % 10 === 5) this.chaos(15, 'Shredding the sofa'); }
      if (k === 'curtains') { this.task('curtains'); if (this.strokes[k] % 10 === 5) this.chaos(15, 'Curtains: improved'); }
    } else if (sc.type === 'post') this.task('post');
  }

  // Something scratchable right in front of the cat?
  findScratch(wantFloor) {
    const pos = this.cat.pos, yaw = this.cat.yaw, fx = Math.sin(yaw), fz = Math.cos(yaw), S = CAT_S;
    let best = null, bd = 0.8;
    const fl = this.world.floorY(pos.y), fy = pos.y - fl;
    for (const s of this.data.scratch) {
      if (s.type === 'post') {
        if (pos.y < s.y[0] - 0.1 || pos.y > s.y[1] - 0.45) continue;
        const dx = s.p[0] - pos.x, dz = s.p[1] - pos.z, d = Math.hypot(dx, dz);
        if (d < bd && d > 0.05 && (dx * fx + dz * fz) / d > 0.2) {
          const st = s.r + 0.3 * S;
          best = { type: 'post', name: s.name, surface: s.surface, x: s.p[0] - dx / d * st, z: s.p[1] - dz / d * st, yaw: Math.atan2(dx, dz) }; bd = d;
        }
      } else if (s.type === 'wall') {
        if (fy > 0.1 || (s.y0 || 0) !== fl) continue;
        const along = s.axis === 'x' ? pos.z : pos.x, perp = ((s.axis === 'x' ? pos.x : pos.z) - s.at) * s.n;
        const facing = -(s.axis === 'x' ? fx : fz) * s.n;
        if (along < s.a[0] - 0.1 || along > s.a[1] + 0.1 || perp < 0 || perp > 0.65 || facing < 0.2 || perp > bd) continue;
        const a = clamp(along, s.a[0], s.a[1]), st = s.at + s.n * 0.3 * S;
        best = { type: 'wall', name: s.name, surface: s.surface, axis: s.axis, at: s.at, n: s.n, x: s.axis === 'x' ? st : a, z: s.axis === 'x' ? a : st, yaw: s.axis === 'x' ? Math.atan2(-s.n, 0) : Math.atan2(0, -s.n) };
        bd = perp;
      }
    }
    if (best || !wantFloor) return best;
    if (pos.y - this.world.floorY(pos.y) < 0.05) for (const s of this.data.scratch) if ((s.y0 || 0) === this.world.floorY(pos.y))
      if (s.type === 'floor' && pos.x > s.b[0] && pos.x < s.b[1] && pos.z > s.b[2] && pos.z < s.b[3]) return { type: 'floor', name: s.name, surface: s.surface };
    return null;
  }

  // ------------------------------------------------------------ contextual action
  context() {
    const cat = this.cat, pos = cat.pos;
    if (!cat.grounded || cat.action) return cat.action ? { label: 'GET UP', kind: 'stop' } : null;
    if (this.carry) return { label: 'DROP', kind: 'drop', hot: true };
    const mg = this.mini.context(); if (mg) return mg;
    _v.set(pos.x + Math.sin(cat.yaw) * 0.3, pos.y + 0.12, pos.z + Math.cos(cat.yaw) * 0.3);
    const grab = this.props.nearest(_v, 0.45, p => p.d.carry && p.asleep !== false || (p.d.carry && p.speed < 0.6));
    if (grab) return { label: 'GRAB', kind: 'grab', prop: grab, hot: true };
    const sc = this.findScratch(false);
    if (sc) return { label: 'SCRATCH', kind: 'scratch', sc, hot: true };
    for (const it of this.items) {
      if (it.kind === 'food' || it.kind === 'water') {
        if (Math.hypot(pos.x - it.stand[0], pos.z - it.stand[1]) < 0.6 && Math.abs(pos.y - (it.p[1] - 0.06)) < 0.1) return { label: it.kind === 'food' ? 'EAT' : 'DRINK', kind: it.kind === 'food' ? 'eat' : 'drink', it, hot: true };
      }
      if (it.kind === 'faucet' && it.on && Math.hypot(pos.x - it.basin[0], pos.z - it.basin[2]) < 0.55 && Math.abs(pos.y - it.basin[1]) < 0.25) return { label: 'DRINK', kind: 'drink', hot: true, tap: it };
    }
    for (const z of this.data.zones) {
      if (z.kind === 'knead' && pos.x > z.b[0] && pos.x < z.b[1] && pos.z > z.b[2] && pos.z < z.b[3] && Math.abs(pos.y - z.y) < 0.12) {
        const nap = this.data.zones.find(n => n.kind === 'nap' && Math.hypot(pos.x - n.p[0], pos.z - n.p[2]) < n.r * 0.6 && Math.abs(pos.y - n.p[1]) < 0.15);
        if (!nap) return { label: 'KNEAD', kind: 'knead', hot: true };
      }
      if (z.kind === 'litter' && Math.abs(pos.y - (z.y0 || 0)) < 0.3 && pos.x > z.b[0] && pos.x < z.b[1] && pos.z > z.b[2] && pos.z < z.b[3]) return { label: 'DIG', kind: 'litter', hot: true };
    }
    const fl = this.findScratch(true);
    const cosy = this.napSpot();
    const pal = this.net && this.net.nearest(0.62);
    if (pal) return { label: 'GROOM', kind: 'groom', hot: true, pal };
    if (cosy) return { label: 'NAP', kind: 'nap', hot: true };
    if (fl) return { label: 'STRETCH', kind: 'scratch', sc: fl };
    return { label: 'NAP', kind: 'nap' };
  }
  napSpot() {
    const cat = this.cat, pos = cat.pos;
    for (const z of this.data.zones) {
      if (z.kind === 'nap' && Math.hypot(pos.x - z.p[0], pos.z - z.p[2]) < z.r && Math.abs(pos.y - z.p[1]) < 0.2) return { name: z.name };
      if (z.kind === 'box' && Math.hypot(pos.x - z.p[0], pos.z - z.p[2]) < z.r && Math.abs(pos.y - z.p[1]) < 0.1) return { name: z.name, box: true };
    }
    for (const z of this.data.zones) if (z.kind === 'sun' && (z.y0 || 0) === this.world.floorY(pos.y) && pos.y - (z.y0 || 0) < 0.1 && pos.x > z.b[0] && pos.x < z.b[1] && pos.z > z.b[2] && pos.z < z.b[3]) return { name: z.name, sun: true };
    const sp = cat.ground && cat.ground.spot;
    if (sp && sp !== 'windowsill') return { name: sp, tub: sp === 'the bathtub' };
    if (sp === 'windowsill') return { name: 'a windowsill' };
    return null;
  }
  act() {
    const c = this.ctx, cat = this.cat; if (!c) return;
    switch (c.kind) {
      case 'mini': this.mini.act(c); break;
      case 'stop': cat.stopAction(); break;
      case 'scratch': cat.startAction('scratch', { ...c.sc, max: 6 }); break;
      case 'eat': case 'drink':
        if (c.it) cat.startAction(c.kind, { x: c.it.stand[0], z: c.it.stand[1], yaw: c.it.yaw, max: 5 }); else cat.startAction('drink', { max: 4 });
        if (!this.snack.has(c.kind)) { this.snack.add(c.kind); this.task('snack'); }
        break;
      case 'knead': cat.startAction('knead', { max: 9 }); loops.purr.start(); break;
      case 'litter': cat.startAction('scratch', { type: 'floor', surface: 'carpet', name: 'litter', max: 2.5 }); this.task('litter'); this.fx.burst(_v.copy(cat.pos).setY(cat.pos.y + 0.05), 12, [0xe8d9b5, 0xd9c7a0], { speed: 1.2, size: 0.014 }); if (this.time - this.digT > 30) { this.digT = this.time; this.chaos(10, 'Business concluded'); } break;
      case 'nap': cat.startAction('nap', {}); this.napT = 0; this.napInfo = this.napSpot(); loops.purr.start(); music.setMood('sleepy'); break;
      case 'grab': {
        const p = c.prop; p.held = true; p.asleep = true; this.props.touch(p); this.carry = p; cat.carrying = true;
        cat.mouth.add(p.g); p.g.position.set(0, -p.r * 0.2, p.r * 0.5); p.g.rotation.set(0, Math.PI / 2, 0); p.g.scale.setScalar(1 / CAT_S);
        sfx.bap(); if (p.d.sock) this.ui.tip('Carry the sock to your cat bed in the bedroom, then DROP it', 5);
      } break;
      case 'drop': this.drop(); break;
      case 'groom': { const q = c.pal.cat.pos; cat.startAction('groom', { yaw: Math.atan2(q.x - cat.pos.x, q.z - cat.pos.z), max: 7 }); } break;
    }
  }
  drop() {
    const p = this.carry, cat = this.cat; if (!p) return;
    p.g.getWorldPosition(_v); this.scene.add(p.g); p.g.position.copy(_v); p.g.scale.setScalar(1); p.g.rotation.set(0, cat.yaw, 0);
    p.held = false; p.asleep = false; p.still = 0; this.props.touch(p); p.vel.set(Math.sin(cat.yaw) * 0.8, 0.6, Math.cos(cat.yaw) * 0.8); this.carry = null; cat.carrying = false;
    if (p.d.sock && !p.stashed) {
      const bed = this.data.zones.find(z => z.kind === 'nap' && z.name === 'the cat bed');
      if (bed && Math.hypot(cat.pos.x - bed.p[0], cat.pos.z - bed.p[2]) < 0.7) { p.stashed = true; this.task('socks'); this.chaos(25, 'Sock secured'); }
    }
  }

  // ------------------------------------------------------------ per-frame
  onEnterPlay() {
    this.playing = true;
    setMusicOn(this.opts.music); music.setMood('calm');
    if (!this.loopsOn) { this.loopsOn = true; for (const k of ['purr', 'wind', 'vacuum', 'fly']) { loops[k].start(); loops[k].set(0); } }
    if (this.tipStage === 0) this.ui.tip('Drag the left side to move  ·  drag the right side to look', 0);
    this.renderTasks();
  }
  onLeavePlay() { this.playing = false; if (this.mini.active) this.mini.finish(false, 'Paused'); this.save(); music.setMood('calm'); }
  preStep(dt) {
    const cat = this.cat, g = cat.ground;
    if (cat.grounded && g && g.mover) { cat.pos.x += g.dx; cat.pos.z += g.dz; }
  }
  step(dt, playing) {
    this.playing = playing; this.time += dt;
    const cat = this.cat, t = this.time;
    this.updateActors(dt, t);
    this.fade = damp(this.fade, playing ? cat.sleepW * 0.3 : 0, 2, dt);
    if (!playing) return;
    // combo + zoomies timers
    if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) { this.comboN = 0; this.mult = 1; this.save(); } }
    if (this.zoomCool > 0) this.zoomCool -= dt;
    if (this.zoomT > 0) {
      this.zoomT -= dt;
      if (Math.random() < 0.5 && Math.hypot(cat.vel.x, cat.vel.z) > 2) this.fx.burst(_v.copy(cat.pos).setY(cat.pos.y + 0.1), 1, [0xffe08a, 0xffffff, 0xff9a3d], { speed: 0.5, grav: 0.1, size: 0.014, life: 0.7 });
      if (this.zoomT <= 0) { cat.speedMul = 1; music.setMood(this.boom ? 'playful' : 'calm'); }
    }
    // trails behind things that unroll
    for (const p of this.props.list) {
      if (!p.d.trail || p.dead || p.asleep || p.held || !p.onGround || p.speed < 0.08) continue;
      let r = this.trails.get(p);
      if (!r) { r = this.fx.ribbon(p.d.col ?? 0xffffff, p.d.trail === 'tp' ? 0.1 : 0.012, p.d.trail === 'tp' ? 260 : 420); this.trails.set(p, r); }
      const before = r.length;
      if (r.add(p.pos.x, p.pos.y - p.r + 0.005, p.pos.z)) { const dl = r.length - before; this.task(p.d.trail === 'tp' ? 'tp' : 'yarn', dl); if (p.d.trail === 'tp' && Math.random() < 0.08) sfx.paperRip({ vol: 0.4 }); }
    }
    // a pounce catches prey it sails over, not only what it lands on
    if (cat.pouncing && !this.pounceCaught) {
      const prey = this.props.nearest(_v.set(cat.pos.x, cat.pos.y, cat.pos.z), 0.42, p => p.d.prey);
      if (prey) { this.pounceCaught = true; sfx.catch(); this.task('mouse'); this.chaos(30, 'Pounced!'); this.fx.burst(prey.pos, 5, 0xffffff, { speed: 1, size: 0.012 }); this.props.kick(prey, cat.vel.x * 0.4, 1.5, cat.vel.z * 0.4); }
    }
    // places
    if (cat.grounded) {
      const g = cat.ground, pos = cat.pos;
      if (g && g.spot && g.spot !== 'windowsill') {
        if (this.discover(g.spot, `Found ${g.spot}`) || true) { if (pos.y >= 1.4) { if (!this.highs) this.highs = new Set(); if (!this.highs.has(g.spot)) { this.highs.add(g.spot); this.task('high', this.highs.size, true); this.save(); } } }
        if (g.spot === 'the bathtub' && cat.sitW > 0.7) this.task('tub');
        if (g.spot === 'the top of the stairs') this.task('stairs');
        if (g.spot.includes('car') && g.spot.endsWith('roof')) this.task('car');
        if (g.spot === 'the cardboard box' && (cat.sitW > 0.7 || cat.lieW > 0.5)) this.task('box');
      }
      if (g && g.spot === 'windowsill' && cat.idle > 1.5) { this.sillT += dt; if (this.sillT > 1.2) { this.sillT = -8; cat.meow('chatter'); this.task('birds'); this.discover('sill', 'Birds! So many birds.'); } } else if (this.sillT > 0) this.sillT = 0; else if (this.sillT < 0) this.sillT += dt;
      for (const z of this.data.zones) if (z.kind === 'under' && Math.abs(pos.y - (z.y0 || 0)) < 0.05 && pos.x > z.b[0] && pos.x < z.b[1] && pos.z > z.b[2] && pos.z < z.b[3]) { this.task('under'); this.discover(z.name.includes('bed') ? 'under' : z.name, 'Found ' + z.name, 40); }
    }
    // out and about
    const site = this.world.site;
    if (site === 'colonial' && cat.pos.y > 5.5) this.task('attic');
    if (site !== this.lastSite) {
      this.lastSite = site;
      if (site === null) this.discover('outdoors', 'The great outdoors!', 30);
      if (site === 'colonial') { this.task('visit'); this.discover('colonial', 'The big house down the street', 50); }
    }
    // napping
    if (cat.action && cat.action.kind === 'nap' && cat.sleepW > 0.85) {
      this.napT += dt;
      if (this.napT > 2.5 && this.napInfo && !this.napInfo.used) {
        this.napInfo.used = true; const n = this.napInfo;
        if (!this.naps.has(n.name)) { this.naps.add(n.name); this.task('naps'); this.ui.toast(`A lovely nap in ${n.name}`, 'find'); this.save(); }
        if (n.sun) this.task('sun'); if (n.box) this.task('box'); if (n.tub) this.task('tub');
      }
    }
    // tips for first-timers
    if (this.tipStage < 3) {
      this.moved += Math.hypot(cat.vel.x, cat.vel.z) * dt;
      if (this.tipStage === 0 && this.moved > 2.5) { this.tipStage = 1; this.ui.tip('Hold JUMP to leap higher · PAW at things · hold PAW, then let go, to pounce', 9); }
      else if (this.tipStage === 1 && this.moved > 14) { this.tipStage = 2; this.ui.tip('The orange button changes with where you are: scratch, nap, eat…', 8); }
      else if (this.tipStage === 2 && this.moved > 30) { this.tipStage = 3; this.ui.tip('Tap the list (top right) to see your Cat To-Do List', 8); this.save(); }
    }
  }
  frame(dt, t, playing) {
    const cat = this.cat;
    this.updateTreats(dt, t);
    if (!playing) { loops.purr.set(0); return; }
    this.mini.frame(dt, t);
    this.ctx = this.context();
    this.ui.setAct(this.ctx ? this.ctx.label : null, !!(this.ctx && this.ctx.hot));
    this.ui.setCombo(this.mult, this.comboT / 4.5);
    if (this.input.take('tasks')) this.ui.showTasks(!this.ui.tasksOpen);
    // what the cat is looking at: the fly, or the nearest thing that moves
    this.lookT = (this.lookT || 0) - dt;
    if (this.lookT < 0) {
      this.lookT = 0.25; let best = null, bd = 6;
      const f = this.fly; if (f.alive && f.pos.distanceToSquared(cat.pos) < 9) { best = f.pos; bd = 0; }
      if (!best) for (const p of this.props.list) { if (p.dead || p.asleep || p.held) continue; const d = p.pos.distanceToSquared(cat.pos); if (d < bd) { bd = d; best = p.pos; } }
      this.lookAt = best;
    }
    cat.lookAt = this.lookAt;
    loops.purr.set(cat.purr * 0.9);
    loops.wind.set(clamp((Math.hypot(cat.vel.x, cat.vel.z) - 2.6) / 2.5, 0, 1) * 0.5);
    for (const it of this.items) if (it.kind === 'faucet') { if (it.on) { this.tapOn = true; } }
    const anyTap = this.items.some(i => i.kind === 'faucet' && i.on);
    if (anyTap !== this.tapWas) { this.tapWas = anyTap; anyTap ? loops.faucet.start() : loops.faucet.stop(); }
    if (anyTap) { let near = 9; for (const it of this.items) if (it.kind === 'faucet' && it.on) near = Math.min(near, Math.hypot(cat.pos.x - it.p[0], cat.pos.z - it.p[2])); loops.faucet.set(clamp(1 - near / 6, 0, 1)); }
  }
}
