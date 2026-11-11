// Five small games dotted around the world. Walk onto a glowing ring and press the orange button to play.
//   Laser Chase (first house)  ·  Stalk the Sparrow (across the street)  ·  The Floor Is Lava (basement)
//   Vole Patrol (back garden)  ·  Attic Bells (attic)
// Two more need friends (Play together): Fish Scramble (first house, a race) and Balloon Keepy-Uppy
// (front lawn, a team effort). Their rings are pink.
import * as THREE from 'three';
import { sfx } from './audio.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[(Math.random() * a.length) | 0];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const KEY = 'catabout.mg';
const B0 = -2.9, ATTIC = 5.8;

const STATIONS = {
  laser: { name: 'Laser Chase', area: 'home', pos: [-3.6, 0, 3.3], range: 9, hint: 'Step on the red dot for 1. Paw it for 2, pounce for 3. 40 seconds.', task: ['mgLaser', 12] },
  bird: { name: 'Stalk the Sparrow', area: 'home', pos: [29.0, 0, 22.6], range: 14, hint: 'Creep while it pecks. Freeze when it looks up. Then pounce.', task: ['mgBird', 3] },
  lava: { name: 'The Floor Is Lava', area: 'colonial', pos: [32.0, B0, 4.1], range: 9, hint: 'Hop the cushions, grab every fish, never touch the floor.', task: ['mgLava', 9] },
  voles: { name: 'Vole Patrol', area: 'colonial', pos: [25.8, 0, -6.6], range: 8, hint: 'Bop the voles. Leave the gnome alone. 40 seconds.', task: ['mgVoles', 15] },
  scram: { name: 'Fish Scramble', area: 'home', pos: [-5.8, 0, -0.3], range: 10, multi: 'vs', hint: 'Race for the fish. Gold ones are worth 3. Batting a rival is fair play. 60 seconds.' },
  balloon: { name: 'Balloon Keepy-Uppy', area: 'home', pos: [-0.8, 0, 8.1], range: 9, multi: 'coop', hint: 'Keep it off the grass. Nobody may touch it twice in a row: pass it on!' },
  bells: { name: 'Attic Bells', area: 'colonial', pos: [27.0, ATTIC, 2.4], range: 5, hint: 'Watch the bells, then paw them in the same order.', task: ['mgBells', 6] },
};

export class Minigames {
  constructor(game) {
    this.g = game; this.scene = game.scene; this.world = game.world; this.cat = game.cat; this.ui = game.ui; this.fx = game.fx;
    this.stations = []; this.active = null; this.t = 0;
    try { this.best = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { this.best = {}; }
    this.clip = [this.world.clip];
    this.addStations('home');
  }
  mat(o) { return new THREE.MeshStandardMaterial({ clippingPlanes: this.clip, ...o }); }
  glow(color, opacity = 0.9) { return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, clippingPlanes: this.clip, side: THREE.DoubleSide }); }

  addStations(area) {
    for (const [id, d] of Object.entries(STATIONS)) {
      if (d.area !== area) continue;
      const g = new THREE.Group(); g.position.set(d.pos[0], d.pos[1], d.pos[2]);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.33, 0.42, 40), this.glow(d.multi ? 0xff7ad0 : 0xffc94a, 0.75)); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02;
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.085), this.mat(d.multi ? { color: 0xff9ad8, emissive: 0xff3aa8, emissiveIntensity: 1.2, roughness: 0.3, metalness: 0.4 } : { color: 0xffd76a, emissive: 0xffa520, emissiveIntensity: 1.2, roughness: 0.3, metalness: 0.4 })); gem.position.y = 0.8;
      g.add(ring, gem); this.scene.add(g);
      const st = { id, ...d, g, ring, gem };
      this.stations.push(st);
      if (this['build_' + id]) this['build_' + id](st);
    }
  }
  box(x0, x1, y0, y1, z0, z1, spot = null) { return this.world.addBox({ minX: x0, maxX: x1, minY: y0, maxY: y1, minZ: z0, maxZ: z1, cam: false, fade: null, spot }); }
  unbox(b) { const i = this.world.boxes.indexOf(b); if (i >= 0) this.world.boxes.splice(i, 1); }

  // ------------------------------------------------------------ hooks called by the game
  context() {
    const p = this.cat.pos;
    if (this.active) return { label: 'QUIT', kind: 'mini', quit: true };
    for (const st of this.stations) if (Math.hypot(p.x - st.pos[0], p.z - st.pos[2]) < 0.85 && Math.abs(p.y - st.pos[1]) < 0.5) return { label: 'PLAY', kind: 'mini', st, hot: true };
    return null;
  }
  act(c) {
    if (c.quit) return this.finish(false, 'Stopped');
    if (!c.st) return;
    if (!c.st.multi) return this.start(c.st);
    const net = this.g.net;
    if (!net || !net.others.size) return this.ui.toast('This one needs a friend: tap Play together in the menu');
    net.send({ k: 'mg', id: net.id, g: c.st.id });
    this.startMulti(c.st, net.id);
  }
  // everyone connected is whisked to the start, whoever pressed the button is the referee
  startMulti(st, ref) {
    const net = this.g.net;
    if (this.active) this.finish(false, 'Stopped');
    this.pendingMulti = { ref, ids: [net.id, ...net.others.keys()].sort() };
    this.start(st);
  }
  who(id) { const net = this.g.net; if (id === net.id) return 'You'; const o = net.others.get(id); return o ? o.coat.name : 'A cat'; }
  // messages from the other players
  netEvent(d) {
    const net = this.g.net, a = this.active;
    if (d.k === 'mg') { const st = this.stations.find(s => s.id === d.g && s.multi);
      if (a && a.st.multi && a.isRef && a.st.id === d.g && a.phase === 'intro' && net.id < d.id) return;        // both pressed PLAY at once: one referee is enough
      if (st && net.others.has(d.id)) { this.ui.toast(this.who(d.id) + ' started ' + st.name, 'find'); this.startMulti(st, d.id); } return; }
    if (!a || !a.st.multi) return;
    if (d.k === 'mgq') {
      if (!a.players.has(d.id)) return;
      a.players.delete(d.id); this.ui.toast(this.who(d.id) + ' left the game');
      if (d.id === a.ref || a.players.size < 2) { a.over = true; this.finish(true, 'The game ended'); }
      return;
    }
    const fn = this['net_' + a.st.id]; if (fn) fn.call(this, a, d);
  }
  onPaw(e, pounce) {
    const a = this.active; if (!a || a.phase !== 'run') return 0;
    const fn = this['paw_' + a.st.id]; return fn ? (fn.call(this, a, e.point, pounce) ? 1 : 0) : 0;
  }
  start(st) {
    if (this.active) return;
    const a = this.active = { st, t: 0, score: 0, phase: 'intro', objs: [], boxes: [] };
    if (st.multi) { const m = this.pendingMulti, net = this.g.net; a.ref = m.ref; a.me = net.id; a.isRef = m.ref === net.id; a.slot = Math.max(0, m.ids.indexOf(net.id)); a.players = new Map(m.ids.map(id => [id, { score: 0 }])); }
    this.ui.banner('Mini-game', st.name, st.hint); sfx.unlock();
    this['init_' + st.id](a);
    this.hud(a);
  }
  finish(done, why) {
    const a = this.active; if (!a) return;
    this.active = null;
    if (a.st.multi && !a.over && this.g.net) this.g.net.send({ k: 'mgq', id: this.g.net.id });
    this.cat.lookAt = null;
    for (const o of a.objs) this.scene.remove(o);
    for (const b of a.boxes) this.unbox(b);
    if (this['end_' + a.st.id]) this['end_' + a.st.id](a);
    const id = a.st.id, best = this.best[id] || 0, score = a.score;
    if (score > best) { this.best[id] = score; try { localStorage.setItem(KEY, JSON.stringify(this.best)); } catch {} }
    this.ui.banner(why || (done ? 'Finished' : 'Game over'), a.result || `${a.st.name}: ${score}`, score > best && score > 0 ? 'A new best!' : `Best ${Math.max(best, score)}`);
    if (score > 0) { sfx.taskDone(); this.g.score += score * 5; this.ui.setScore(this.g.score); }
    if (a.st.task) this.g.task(a.st.task[0], score, true);
    this.ui.setMini(null);
    this.g.save();
  }
  hud(a, info, frac) { this.ui.setMini(a.st.name, info === undefined ? 'Get ready…' : info, frac === undefined ? 1 : frac); }

  frame(dt, t) {
    this.t = t;
    const cut = this.world.cut, fl = this.world.floorY(this.cat.pos.y);
    for (const st of this.stations) {
      const vis = !this.active && st.pos[1] < cut - 1 && Math.abs(st.pos[1] - fl) < 3.5;
      st.g.visible = vis; if (!vis) continue;
      st.gem.rotation.y = t * 1.8; st.gem.position.y = 0.8 + Math.sin(t * 2.4 + st.pos[0]) * 0.06; st.ring.scale.setScalar(1 + Math.sin(t * 3) * 0.06);
    }
    const a = this.active; if (!a) return;
    a.t += dt;
    const p = this.cat.pos;
    if (Math.hypot(p.x - a.st.pos[0], p.z - a.st.pos[2]) > a.st.range || Math.abs(p.y - a.st.pos[1]) > 2.4) return this.finish(false, 'Wandered off');
    if (a.st.multi && !a.over) { const net = this.g.net; for (const id of [...a.players.keys()]) if (id !== a.me && !net.others.has(id)) this.netEvent({ k: 'mgq', id }); if (this.active !== a) return; }
    if (a.phase === 'intro') { if (a.t > 1.8) { a.phase = 'run'; a.t = 0; sfx.pop(); } else return; }
    this['run_' + a.st.id](a, dt, t);
  }

  // ============================================================ 6. Fish Scramble (first house; a race between friends)
  // The referee (whoever started it) puts the fish out and settles who got each one first.
  init_scram(a) {
    a.spots = [[-3.3, 3.3], [-1.9, 2.6], [-2.0, 4.4], [-3.6, 4.8], [-5.2, 3.6], [-6.5, 2.2], [-2.9, -0.4], [-2.9, 2.3], [-6.2, 4.1], [-7.2, 3.0], [-5.6, 2.6], [-1.6, 0.2], [-4.4, 2.8]];
    a.time = 60; a.fish = new Map(); a.next = 0; a.spawnT = 0;
    a.mats = [this.mat({ color: 0x9fd4ff, emissive: 0x3a9aff, emissiveIntensity: 0.9, roughness: 0.35, metalness: 0.3 }), this.mat({ color: 0xffc04a, emissive: 0xff9a1a, emissiveIntensity: 1.3, roughness: 0.3, metalness: 0.4 })];
    const s = [[-5.8, -0.3], [-5.2, -0.3], [-5.8, 0.3], [-5.2, 0.3]][a.slot % 4]; this.cat.teleport(s[0], 0, s[1], 0.6);
  }
  scramAdd(a, i, x, z, gold) {
    if (a.fish.has(i)) return;
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(gold ? 0.085 : 0.065), a.mats[gold ? 1 : 0]); m.scale.set(1.5, 0.8, 0.5); m.position.set(x, 0.22, z);
    this.scene.add(m); a.objs.push(m); a.fish.set(i, { m, gold, ask: -9 });
  }
  scramAward(a, i, by) {
    const f = a.fish.get(i); if (!f) return;
    a.fish.delete(i); this.scene.remove(f.m);
    const pl = a.players.get(by); if (pl) pl.score += f.gold ? 3 : 1;
    this.fx.burst(f.m.position, f.gold ? 14 : 7, f.gold ? [0xffd27a, 0xffffff] : [0x9fd4ff, 0xffffff], { speed: 1.3, size: 0.016, life: 0.6 });
    if (by === a.me) { a.score = pl.score; sfx.collect({ n: a.score }); if (f.gold) this.ui.toast('+3 gold fish!'); } else sfx.pop();
  }
  scramEnd(a, sc) {
    for (const [id, v] of Object.entries(sc || {})) { const pl = a.players.get(id); if (pl && Number.isFinite(v)) pl.score = v; }
    const rows = [...a.players.entries()].sort((x, y) => y[1].score - x[1].score), top = rows[0][1].score;
    const win = rows.filter(r => r[1].score === top).map(r => r[0]);
    a.score = a.players.get(a.me) ? a.players.get(a.me).score : 0;
    a.result = rows.map(([id, v]) => `${this.who(id)} ${v.score}`).join('  ·  ');
    a.over = true; this.finish(true, win.length > 1 ? 'A tie!' : win[0] === a.me ? 'You win!' : this.who(win[0]) + ' wins');
  }
  run_scram(a, dt, t) {
    const net = this.g.net, p = this.cat.pos, left = a.time - a.t;
    if (a.isRef) {
      a.spawnT -= dt;
      if (a.fish.size < 5 && a.spawnT <= 0) {
        const cats = [p, ...[...net.others.values()].map(o => o.cat.pos)];
        const free = a.spots.filter(s => cats.every(c => Math.hypot(c.x - s[0], c.z - s[1]) > 1.1) && [...a.fish.values()].every(f => Math.hypot(f.m.position.x - s[0], f.m.position.z - s[1]) > 0.7));
        if (free.length) { const s = pick(free), i = a.next++, g = Math.random() < 0.18 ? 1 : 0, x = s[0] + rnd(-0.15, 0.15), z = s[1] + rnd(-0.15, 0.15); net.send({ k: 'msf', id: a.me, i, x, z, g }); this.scramAdd(a, i, x, z, g); }
        a.spawnT = a.fish.size < 3 ? 0.15 : 0.7;
      }
      if (left <= 0) { const sc = {}; for (const [id, v] of a.players) sc[id] = v.score; net.send({ k: 'men', id: a.me, sc }); return this.scramEnd(a, sc); }
    } else if (left < -4) return this.scramEnd(a, null);
    for (const [i, f] of a.fish) {
      f.m.rotation.y = t * 2.4 + i; f.m.position.y = 0.22 + Math.sin(t * 3 + i) * 0.03;
      if (Math.hypot(p.x - f.m.position.x, p.z - f.m.position.z) < 0.4 && p.y < 0.6 && t - f.ask > 0.5) {
        if (a.isRef) { net.send({ k: 'mgt', id: a.me, i, by: a.me }); this.scramAward(a, i, a.me); }
        else { f.ask = t; net.send({ k: 'mcl', id: a.me, i }); }
      }
    }
    const others = [...a.players.entries()].filter(([id]) => id !== a.me).map(([id, v]) => `${this.who(id)} ${v.score}`).join(' · ');
    this.hud(a, `You ${a.players.get(a.me).score}  ·  ${others}`, Math.max(0, left) / a.time);
  }
  net_scram(a, d) {
    const net = this.g.net;
    if (d.k === 'msf' && d.id === a.ref && Number.isInteger(d.i) && Number.isFinite(d.x) && Number.isFinite(d.z)) this.scramAdd(a, d.i, d.x, d.z, !!d.g);
    else if (d.k === 'mcl' && a.isRef && a.fish.has(d.i) && a.players.has(d.id)) { net.send({ k: 'mgt', id: a.me, i: d.i, by: d.id }); this.scramAward(a, d.i, d.id); }
    else if (d.k === 'mgt' && d.id === a.ref) this.scramAward(a, d.i, d.by);
    else if (d.k === 'men' && d.id === a.ref && d.sc && typeof d.sc === 'object') this.scramEnd(a, d.sc);
  }

  // ============================================================ 7. Balloon Keepy-Uppy (front lawn; everyone on the same side)
  // Whoever touches the balloon decides where it goes next and tells the others; in between, every
  // player's game lets it drift down the same way.
  init_balloon(a) {
    const c = a.st.pos, g = new THREE.Group();
    const skin = this.mat({ color: 0xe8443a, roughness: 0.25, metalness: 0.05, emissive: 0x5a0a08, emissiveIntensity: 0.6 });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 16), skin); ball.scale.set(1, 1.16, 1); ball.castShadow = true;
    const knot = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.05, 8), skin); knot.position.y = -0.25;
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.4, 4), this.mat({ color: 0xf2f2f2 })); cord.position.y = -0.47;
    g.add(ball, knot, cord); this.scene.add(g); a.objs.push(g);
    const spot = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.22, 28), this.glow(0xffffff, 0.7)); spot.rotation.x = -Math.PI / 2; this.scene.add(spot); a.objs.push(spot);
    Object.assign(a, { ball: g, skin, spot, bp: new THREE.Vector3(c[0], 1.7, c[2] + 1.2), bv: new THREE.Vector3(), n: 0, last: null, grace: 0, box: [-4.6, 3.2, 7.3, 11.5] });
    const k = a.slot * 2.1 + 0.4; this.cat.teleport(c[0] + Math.sin(k) * 1.3, 0, c[2] + 1.2 + Math.cos(k) * 1.3, k + Math.PI);
  }
  balloonBop(a, dx, dz) {
    const l = Math.hypot(dx, dz) || 1, ang = Math.atan2(dx / l, dz / l) + rnd(-0.6, 0.6), s = rnd(1.5, 2.4);
    a.n++; a.last = a.me; a.score = a.n; a.grace = 0;
    a.bp.y = Math.max(a.bp.y, 0.35); a.bv.set(Math.sin(ang) * s, 2.5, Math.cos(ang) * s);
    sfx.piano({ note: [0, 4, 7, 12, 16][a.n % 5], vol: 0.6 }); sfx.bap();
    this.g.net.send({ k: 'mbb', id: a.me, n: a.n, p: a.bp.toArray(), v: a.bv.toArray() });
  }
  balloonPop(a) {
    this.fx.burst(a.bp, 26, [0xe8443a, 0xffb0a8, 0xffffff], { speed: 2.6, up: 1, size: 0.022, life: 0.7 }); sfx.pop(); sfx.error();
    a.score = a.n; a.result = `${a.n} in a row, together`; a.over = true; this.finish(true, 'Pop!');
  }
  run_balloon(a, dt, t) {
    const p = this.cat.pos, bp = a.bp, bv = a.bv, B = a.box;
    bv.y -= 1.5 * (1 + a.n * 0.03) * dt; bv.y = Math.max(bv.y, -(0.7 + a.n * 0.02));
    const f = Math.exp(-0.9 * dt); bv.x *= f; bv.z *= f;
    bp.addScaledVector(bv, dt);
    if (bp.x < B[0]) { bp.x = B[0]; bv.x = Math.abs(bv.x); } if (bp.x > B[1]) { bp.x = B[1]; bv.x = -Math.abs(bv.x); }
    if (bp.z < B[2]) { bp.z = B[2]; bv.z = Math.abs(bv.z); } if (bp.z > B[3]) { bp.z = B[3]; bv.z = -Math.abs(bv.z); }
    if (bp.y > 2.3) { bp.y = 2.3; bv.y = Math.min(bv.y, 0); }
    if (bp.y <= 0.22) {          // resting on the grass: a moment's grace for a pass that is already on its way
      bp.y = 0.22; bv.set(0, 0, 0); a.grace += dt;
      if (a.grace > 0.5) { this.g.net.send({ k: 'mbo', id: a.me, n: a.n }); return this.balloonPop(a); }
    }
    const mine = a.last !== a.me;
    if (mine && a.grace < 0.5 && Math.hypot(p.x - bp.x, p.z - bp.z) < 0.34 && Math.abs(p.y + 0.2 - bp.y) < 0.36) this.balloonBop(a, bp.x - p.x || Math.sin(this.cat.yaw), bp.z - p.z || Math.cos(this.cat.yaw));
    a.ball.position.copy(bp); a.ball.rotation.z = Math.sin(t * 2.2) * 0.12 + bv.x * 0.1; a.ball.rotation.x = bv.z * 0.1;
    a.skin.color.set(mine ? 0xe8443a : 0x9a8f8c); a.skin.emissiveIntensity = mine ? 0.6 : 0.1;
    a.spot.position.set(bp.x, 0.02, bp.z); a.spot.scale.setScalar(0.7 + bp.y * 0.6); a.spot.material.opacity = mine ? 0.75 : 0.25;
    this.cat.lookAt = bp;
    this.hud(a, `${a.n} in a row  ·  ${a.n === 0 ? 'Anyone: bump it!' : mine ? 'Your turn!' : 'Pass it on…'}`, 1);
  }
  paw_balloon(a, p, pounce) {
    if (a.last === a.me || Math.hypot(p.x - a.bp.x, p.z - a.bp.z) > 0.5 || Math.abs(p.y - a.bp.y) > 0.6) return false;
    this.balloonBop(a, Math.sin(this.cat.yaw), Math.cos(this.cat.yaw)); return true;
  }
  net_balloon(a, d) {
    const num = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
    if (d.k === 'mbb' && num(d.p) && num(d.v) && Number.isInteger(d.n) && (d.n > a.n || (d.n === a.n && d.id < a.last))) {
      a.n = d.n; a.last = d.id; a.score = a.n; a.grace = 0; a.bp.fromArray(d.p); a.bv.fromArray(d.v); sfx.piano({ note: [0, 4, 7, 12, 16][a.n % 5], vol: 0.45 });
    } else if (d.k === 'mbo' && d.n >= a.n) this.balloonPop(a);
  }

  // ============================================================ 1. Laser Chase (first house, living room)
  init_laser(a) {
    a.spots = [[-3.3, 3.3], [-1.9, 2.6], [-2.0, 4.4], [-3.6, 4.8], [-5.2, 3.6], [-6.5, 2.2], [-2.9, -0.4], [-2.9, 2.3], [-6.2, 4.1], [-7.2, 3.0], [-5.6, 2.6], [-5.8, -0.3], [-1.6, 0.2], [-4.4, 2.8]];
    const dot = new THREE.Group();
    const core = new THREE.Mesh(new THREE.CircleGeometry(0.035, 20), this.glow(0xff2a2a, 1)); core.rotation.x = -Math.PI / 2;
    const halo = new THREE.Mesh(new THREE.CircleGeometry(0.11, 24), this.glow(0xff2a2a, 0.35)); halo.rotation.x = -Math.PI / 2; halo.position.y = -0.001;
    dot.add(core, halo); dot.position.set(-3.3, 0.016, 3.3); this.scene.add(dot); a.objs.push(dot);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 1, 5), this.glow(0xff2a2a, 0.22)); this.scene.add(beam); a.objs.push(beam);
    Object.assign(a, { dot, beam, from: new THREE.Vector3(-4.2, 2.45, 2.2), tgt: new THREE.Vector3(-3.3, 0.016, 3.3), hold: 1.2, speed: 4, time: 40 });
  }
  run_laser(a, dt, t) {
    const d = a.dot.position, left = a.time - a.t;
    if (left <= 0) return this.finish(true, 'Time!');
    const to = a.tgt, dx = to.x - d.x, dz = to.z - d.z, dist = Math.hypot(dx, dz);
    if (dist > 0.03) { const s = Math.min(dist, a.speed * dt); d.x += dx / dist * s; d.z += dz / dist * s; }
    else {
      a.hold -= dt; d.x = to.x + Math.sin(t * 9) * 0.03; d.z = to.z + Math.cos(t * 11) * 0.03;       // the hand holding the pointer is never quite still
      const cd = Math.hypot(this.cat.pos.x - d.x, this.cat.pos.z - d.z);
      if (a.hold <= 0 || (cd < 0.75 && Math.random() < dt * 1.6)) this.laserHop(a);             // it darts off just as you close in
    }
    // simply walking onto the dot counts; a paw or pounce is worth more
    if (Math.hypot(this.cat.pos.x - d.x, this.cat.pos.z - d.z) < 0.3 && this.cat.pos.y < 0.3) this.laserGot(a, 1);
    a.beam.position.copy(a.from).lerp(d, 0.5); a.beam.scale.y = a.from.distanceTo(d); a.beam.lookAt(d); a.beam.rotateX(Math.PI / 2);
    this.cat.lookAt = d;
    this.hud(a, `Caught ${a.score}`, left / a.time);
  }
  laserHop(a) {
    const c = this.cat.pos; let s, n = 0;
    do { s = pick(a.spots); } while (++n < 12 && (Math.hypot(s[0] - c.x, s[1] - c.z) < 1.3 || Math.hypot(s[0] - a.dot.position.x, s[1] - a.dot.position.z) < 0.8));
    a.tgt.set(s[0] + rnd(-0.15, 0.15), 0.016, s[1] + rnd(-0.15, 0.15)); a.hold = rnd(0.55, 1.25) * Math.max(0.55, 1 - a.score * 0.03); a.speed = rnd(3.5, 6.5) + a.score * 0.12;
  }
  paw_laser(a, p, pounce) {
    const d = a.dot.position;
    if (Math.hypot(p.x - d.x, p.z - d.z) > (pounce ? 0.55 : 0.4) || p.y > 0.5) return false;
    this.laserGot(a, pounce ? 3 : 2); return true;
  }
  laserGot(a, n) {
    a.score += n; sfx.catch(); this.fx.burst(a.dot.position, 4 + n * 3, [0xff5a5a, 0xffffff], { speed: 1.4, size: 0.014, life: 0.5 });
    if (n > 1) this.ui.toast('+' + n + (n > 2 ? ' pounce!' : ' paw!'));
    this.laserHop(a); a.dot.position.copy(a.tgt);
  }

  // ============================================================ 2. Stalk the Sparrow (the lawn across the street)
  init_bird(a) {
    const g = new THREE.Group(), brown = this.mat({ color: 0x7a5a3c, roughness: 0.9 }), pale = this.mat({ color: 0xcdb89a, roughness: 0.9 }), dark = this.mat({ color: 0x2a2018, roughness: 0.6 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), brown); body.scale.set(0.85, 0.8, 1.25); body.position.y = 0.075;
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), pale); belly.scale.set(0.8, 0.7, 1.05); belly.position.set(0, 0.062, 0.012);
    const neck = new THREE.Group(); neck.position.set(0, 0.1, 0.05);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.036, 10, 8), brown); head.position.set(0, 0.03, 0.02);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.011, 0.035, 6), dark); beak.rotation.x = Math.PI / 2; beak.position.set(0, 0.028, 0.065);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.008, 0.09), dark); tail.position.set(0, 0.085, -0.1); tail.rotation.x = 0.35;
    neck.add(head, beak); g.add(body, belly, neck, tail); g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    this.scene.add(g); a.objs.push(g);
    Object.assign(a, { bird: g, neck, n: 0, total: 3, spook: 0, mode: 'gone', modeT: 0.6, fly: 0 });
  }
  birdSpawn(a) {
    const c = this.cat.pos; let x, z, n = 0;
    do { x = rnd(25.5, 36.5); z = rnd(23.6, 28.2); } while (++n < 30 && (Math.hypot(x - c.x, z - c.z) < 6.5 || Math.hypot(x - 34.4, z - 26.5) < 1.2));
    a.bird.position.set(x, 0, z); a.bird.rotation.set(0, rnd(0, 6.28), 0); a.bird.visible = true;
    a.n++; a.spook = 0; a.mode = 'peck'; a.modeT = rnd(2.4, 4.2); sfx.birdTweet();
  }
  run_bird(a, dt, t) {
    const b = a.bird, c = this.cat, hs = Math.hypot(c.vel.x, c.vel.z), dist = Math.hypot(c.pos.x - b.position.x, c.pos.z - b.position.z);
    a.modeT -= dt;
    if (a.mode === 'gone') {
      b.visible = false;
      if (a.modeT <= 0) { if (a.n >= a.total) return this.finish(true); this.birdSpawn(a); }
    } else if (a.mode === 'flee') {
      a.fly += dt; b.position.y += dt * (2 + a.fly * 5); b.position.x += Math.sin(b.rotation.y) * dt * 4; b.position.z += Math.cos(b.rotation.y) * dt * 4; b.rotation.z = Math.sin(t * 40) * 0.5;
      if (a.modeT <= 0) { a.mode = 'gone'; a.modeT = 0.8; b.rotation.z = 0; }
    } else {
      const alert = a.mode === 'alert';
      a.neck.rotation.x = alert ? -0.25 : a.mode === 'tell' ? 0.1 : 0.75 + Math.sin(t * 13) * 0.35;      // pecking, pausing, head up
      if (alert) b.rotation.y += Math.sin(t * 2.3) * dt * 1.6;
      if (alert && hs > 0.2 && dist < 12) a.spook += dt * (dist < 3 ? 3.2 : 2.0);                  // movement is what it sees
      else if (hs > 1.7 && dist < 5.5) a.spook += dt * 1.6;                                        // and it hears a gallop
      else a.spook = Math.max(0, a.spook - dt * 0.25);
      if (c.pouncing && dist < 0.55) return this.birdCatch(a);
      if (a.spook >= 1 || (alert && dist < 0.9)) {
        a.mode = 'flee'; a.modeT = 1.3; a.fly = 0; b.rotation.y = Math.atan2(b.position.x - c.pos.x, b.position.z - c.pos.z); sfx.birdTweet(); this.ui.toast(alert ? 'It saw you!' : 'Too loud!');
      } else if (a.modeT <= 0) {
        if (a.mode === 'peck') { a.mode = 'tell'; a.modeT = 0.4; sfx.birdTweet(); }
        else if (a.mode === 'tell') { a.mode = 'alert'; a.modeT = rnd(1.0, 1.9); }
        else { a.mode = 'peck'; a.modeT = rnd(2.2, 4.4); }
      }
      this.cat.lookAt = b.position;
    }
    const label = a.mode === 'alert' ? 'FREEZE!' : a.mode === 'tell' ? 'careful…' : a.mode === 'peck' ? 'creep closer' : '';
    this.hud(a, `Bird ${Math.min(a.n, a.total)}/${a.total}  ·  caught ${a.score}  ·  ${label}`, 1 - clamp(a.spook, 0, 1));
  }
  birdCatch(a) {
    a.score++; sfx.catch(); this.fx.burst(a.bird.position.clone().setY(0.1), 14, [0x7a5a3c, 0xcdb89a, 0xffffff], { speed: 1.6, up: 1.2, grav: 0.4, size: 0.02, life: 1.1 });
    this.ui.toast('Got it! (It gets away unharmed, a little embarrassed.)', 'find'); a.mode = 'gone'; a.modeT = 1.2; return true;
  }
  paw_bird(a, p, pounce) {
    if (a.mode === 'gone' || a.mode === 'flee') return false;
    const b = a.bird.position; if (Math.hypot(p.x - b.x, p.z - b.z) > (pounce ? 0.7 : 0.5)) return false;
    return this.birdCatch(a);
  }

  // ============================================================ 3. The Floor Is Lava (basement play room)
  init_lava(a) {
    const y = B0, cols = [0xb8483e, 0x3f6f8a, 0xd9a441, 0x6a8a5a, 0x8a5a8a];
    const pads = [[32.3, 3.2], [33.2, 2.5], [34.3, 2.3], [35.4, 2.45], [36.6, 2.6], [36.9, 4.9], [35.7, 5.0], [34.5, 4.9], [33.8, 3.7]];
    a.pads = pads; a.fish = []; a.lives = 3; a.time = 80; a.safe = 0; a.hurtT = 0;
    pads.forEach(([x, z], i) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.2, 0.52), this.mat({ color: cols[i % cols.length], roughness: 0.95 })); m.position.set(x, y + 0.1, z); m.rotation.y = (i * 0.7) % 0.6 - 0.3; m.castShadow = m.receiveShadow = true;
      this.scene.add(m); a.objs.push(m); a.boxes.push(this.box(x - 0.27, x + 0.27, y, y + 0.2, z - 0.27, z + 0.27));
    });
    const fishMat = this.mat({ color: 0xffc04a, emissive: 0xff9a1a, emissiveIntensity: 1.0, roughness: 0.35, metalness: 0.3 });
    const spots = pads.slice(1).map(([x, z]) => [x, y + 0.5, z]).concat([[35.6, y + 1.05, 3.9]]);        // one on every cushion, one on the table
    for (const s of spots) { const f = new THREE.Mesh(new THREE.OctahedronGeometry(0.07), fishMat); f.position.set(...s); f.scale.set(1.5, 0.8, 0.5); this.scene.add(f); a.objs.push(f); a.fish.push(f); }
    const lava = new THREE.Mesh(new THREE.PlaneGeometry(6.0, 3.8), this.glow(0xff5a1a, 0.42)); lava.rotation.x = -Math.PI / 2; lava.position.set(34.4, y + 0.03, 3.5); this.scene.add(lava); a.objs.push(lava); a.lava = lava;
    const lamp = new THREE.PointLight(0xff6a2a, 1.6, 7, 1.6); lamp.position.set(34.4, y + 0.5, 3.5); this.scene.add(lamp); a.objs.push(lamp);
    this.cat.teleport(pads[0][0], y + 0.2, pads[0][1], 1.2);
  }
  run_lava(a, dt, t) {
    const c = this.cat, p = c.pos, y = B0, left = a.time - a.t;
    a.lava.material.opacity = 0.36 + Math.sin(t * 3.1) * 0.08;
    for (const f of a.fish) {
      if (!f.visible) continue;
      f.rotation.y = t * 2; if (Math.hypot(p.x - f.position.x, p.z - f.position.z) < 0.42 && Math.abs(p.y + 0.2 - f.position.y) < 0.55) { f.visible = false; a.score++; sfx.collect({ n: a.score }); this.fx.burst(f.position, 8, [0xffd27a, 0xfff1c9], { speed: 1.2, grav: 0.3, size: 0.016, life: 0.8 }); }
    }
    a.pads.forEach(([x, z], i) => { if (c.grounded && Math.abs(p.x - x) < 0.3 && Math.abs(p.z - z) < 0.3 && p.y > y + 0.15) a.safe = i; });
    a.hurtT -= dt;
    const inRoom = p.x > 31.5 && p.x < 37.35 && p.z > 1.7 && p.z < 5.35;
    if (inRoom && c.grounded && p.y < y + 0.08 && a.hurtT <= 0) {
      a.lives--; a.hurtT = 1; sfx.error(); this.fx.burst(p, 16, [0xff7a2a, 0xffd27a], { speed: 2, up: 1.5, size: 0.02, life: 0.7 }); this.g.shakeCam(0.03);
      if (a.lives <= 0) return this.finish(false, 'Toasted paws');
      const s = a.pads[a.safe]; c.teleport(s[0], y + 0.2, s[1], c.yaw); this.ui.toast('Hot hot hot!');
    }
    if (a.score >= a.fish.length) { a.score += a.lives; return this.finish(true, 'Cool as a cucumber'); }
    if (left <= 0) return this.finish(true, 'Time!');
    this.hud(a, `Fish ${a.score}/${a.fish.length}  ·  ${'♥'.repeat(a.lives)}`, left / a.time);
  }

  // ============================================================ 4. Vole Patrol (the colonial's back garden)
  build_voles(st) {
    const dirt = this.mat({ color: 0x5a4030, roughness: 1 }), fur = this.mat({ color: 0x8a7458, roughness: 0.95 }), nose = this.mat({ color: 0xd98a8a, roughness: 0.6 }), dark = this.mat({ color: 0x1a1410, roughness: 0.4 });
    const red = this.mat({ color: 0xb8322c, roughness: 0.7 }), skin = this.mat({ color: 0xe8c4a0, roughness: 0.8 }), white = this.mat({ color: 0xf4f1ea, roughness: 0.9 });
    st.holes = [];
    for (let i = 0; i < 9; i++) {
      const x = 25.6 + (i % 3 - 1) * 1.25, z = -8.4 + (Math.floor(i / 3) - 1) * 1.25;
      const mound = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), dirt); mound.scale.y = 0.3; mound.position.set(x, 0, z); mound.receiveShadow = true; this.scene.add(mound);
      const hole = new THREE.Mesh(new THREE.CircleGeometry(0.12, 14), dark); hole.rotation.x = -Math.PI / 2; hole.position.set(x, 0.092, z); this.scene.add(hole);
      const vole = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.1, 4, 10), fur); body.position.y = 0.07;
      const snout = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), nose); snout.position.set(0, 0.13, 0.075);
      for (const s of [1, -1]) { const ear = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), fur); ear.position.set(s * 0.05, 0.19, 0); const eye = new THREE.Mesh(new THREE.SphereGeometry(0.01, 6, 5), dark); eye.position.set(s * 0.032, 0.155, 0.062); vole.add(ear, eye); }
      vole.add(body, snout);
      const gnome = new THREE.Group();
      const gb = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.06, 4, 10), this.mat({ color: 0x3f6f8a, roughness: 0.8 })); gb.position.y = 0.05;
      const gh = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), skin); gh.position.y = 0.16;
      const gd = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.09, 8), white); gd.position.set(0, 0.1, 0.045); gd.rotation.x = Math.PI;
      const hat = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.2, 10), red); hat.position.y = 0.29;
      gnome.add(gb, gh, gd, hat);
      for (const o of [vole, gnome]) { o.position.set(x, -0.4, z); o.traverse(q => { if (q.isMesh) q.castShadow = true; }); this.scene.add(o); }
      st.holes.push({ x, z, vole, gnome, up: 0, t: 0, kind: null });
    }
  }
  init_voles(a) { a.time = 40; a.next = 0.5; for (const h of a.st.holes) { h.kind = null; h.up = 0; } }
  end_voles(a) { for (const h of a.st.holes) { h.kind = null; h.up = 0; h.vole.position.y = h.gnome.position.y = -0.4; } }
  run_voles(a, dt, t) {
    const left = a.time - a.t; if (left <= 0) return this.finish(true, 'Time!');
    const prog = a.t / a.time;
    a.next -= dt;
    if (a.next <= 0) {
      const free = a.st.holes.filter(h => !h.kind);
      if (free.length > 5) { const h = pick(free); h.kind = Math.random() < 0.16 ? 'gnome' : 'vole'; h.t = rnd(1.5, 2.1) - prog * 0.8; h.bopped = false; h.vole.rotation.y = h.gnome.rotation.y = Math.atan2(this.cat.pos.x - h.x, this.cat.pos.z - h.z); }
      a.next = rnd(0.55, 1.0) - prog * 0.3;
    }
    for (const h of a.st.holes) {
      if (h.kind) { h.show = h.kind; h.t -= dt; h.up = Math.min(1, h.up + dt * 7); if (h.t <= 0) h.kind = null; }
      else h.up = Math.max(0, h.up - dt * (h.bopped ? 12 : 5));
      const o = h.show === 'gnome' ? h.gnome : h.vole, other = o === h.gnome ? h.vole : h.gnome;
      o.position.y = -0.4 + h.up * 0.46 + (h.kind ? Math.sin(t * 16 + h.x) * 0.006 : 0); other.position.y = -0.4;
    }
    this.hud(a, `Bopped ${a.score}`, left / a.time);
  }
  paw_voles(a, p, pounce) {
    let hit = false;
    for (const h of a.st.holes) {
      if (!h.kind || h.bopped || h.up < 0.5 || Math.hypot(p.x - h.x, p.z - h.z) > (pounce ? 0.7 : 0.55)) continue;
      h.bopped = true; h.t = 0.12; hit = true;
      if (h.kind === 'gnome') { a.score = Math.max(0, a.score - 2); sfx.error(); this.ui.toast('Not the gnome!  −2'); }
      else { a.score++; sfx.bap(); sfx.pop(); this.fx.burst(new THREE.Vector3(h.x, 0.15, h.z), 8, [0x5a4030, 0x8a7458], { speed: 1.5, up: 1.4, grav: 0.5, size: 0.022, life: 0.6 }); }
    }
    return hit;
  }

  // ============================================================ 5. Attic Bells (a memory game among the old things)
  build_bells(st) {
    const y = ATTIC, brass = this.mat({ color: 0x8a6a3a, roughness: 0.4, metalness: 0.7 });
    const defs = [[27.0, 1.72, 0xc8483e, 0], [27.75, 2.4, 0x3f7fc0, 4], [27.0, 3.08, 0x5fae5a, 7], [26.25, 2.4, 0xe0b030, 12]];
    st.bells = defs.map(([x, z, col, note]) => {
      const g = new THREE.Group(); g.position.set(x, y, z);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.05, 0.16, 10), brass); post.position.y = 0.08;
      const m = this.mat({ color: col, roughness: 0.3, metalness: 0.5, emissive: col, emissiveIntensity: 0.05 });
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.13, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), m); dome.position.y = 0.15;
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), brass); knob.position.y = 0.29;
      g.add(post, dome, knob); g.traverse(o => { if (o.isMesh) o.castShadow = true; }); this.scene.add(g);
      this.box(x - 0.1, x + 0.1, y, y + 0.28, z - 0.1, z + 0.1);
      return { x, z, g, m, note, flash: 0 };
    });
  }
  ring(st, i) { const b = st.bells[i]; b.flash = 1; sfx.piano({ note: b.note, vol: 0.7 }); }
  init_bells(a) { a.seq = [pick([0, 1, 2, 3])]; a.show = 0; a.showT = 0.9; a.inp = -1; a.wait = 0; }
  end_bells(a) { for (const b of a.st.bells) { b.flash = 0; b.m.emissiveIntensity = 0.05; b.g.scale.setScalar(1); } }
  run_bells(a, dt, t) {
    for (const b of a.st.bells) { b.flash = Math.max(0, b.flash - dt * 2.6); b.m.emissiveIntensity = 0.05 + b.flash * 1.6; b.g.scale.setScalar(1 + b.flash * 0.12); }
    if (a.inp < 0) {                                   // showing the tune
      a.showT -= dt;
      if (a.showT <= 0) {
        if (a.show < a.seq.length) { this.ring(a.st, a.seq[a.show++]); a.showT = Math.max(0.34, 0.62 - a.seq.length * 0.02); }
        else { a.inp = 0; a.wait = 9; }
      }
      this.hud(a, `Round ${a.seq.length}  ·  watch…`, 1);
    } else {
      a.wait -= dt;
      if (a.wait <= 0) return this.finish(false, 'Too slow');
      this.hud(a, `Round ${a.seq.length}  ·  your turn: ${a.inp}/${a.seq.length}`, a.wait / 9);
    }
  }
  paw_bells(a, p, pounce) {
    if (a.inp < 0) return false;
    let best = -1, bd = pounce ? 0.6 : 0.5;
    a.st.bells.forEach((b, i) => { const d = Math.hypot(p.x - b.x, p.z - b.z); if (d < bd) { bd = d; best = i; } });
    if (best < 0) return false;
    this.ring(a.st, best);
    if (best !== a.seq[a.inp]) { sfx.error(); this.finish(false, 'Wrong bell'); return true; }
    a.inp++; a.wait = 9;
    if (a.inp >= a.seq.length) { a.score = a.seq.length; a.seq.push(pick([0, 1, 2, 3])); a.inp = -1; a.show = 0; a.showT = 1.1; sfx.collect({ n: a.score }); }
    return true;
  }
}
