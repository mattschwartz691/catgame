// Play together: other players' cats, over a direct WebRTC link between the browsers.
// One player hosts under a four-letter code; the others join it. The host passes everyone's
// messages along. The cats, the things they knock about and the treats are shared; each player keeps
// their own score and to-do list.
import * as THREE from 'three';
import { Cat, COATS, angDiff, CAT_S } from './cat.js';

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ', PREFIX = 'catabout-game-', MAX = 4, RATE = 1 / 12;
const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;
const PROP_RATE = 1 / 10, _wp = new THREE.Vector3();
let lib = null;
const loadLib = () => lib || (lib = new Promise((res, rej) => {
  if (window.Peer) return res();
  const s = document.createElement('script'); s.src = 'vendor/peerjs.min.js'; s.onload = () => res(); s.onerror = () => { lib = null; rej(new Error('load')); };
  document.head.appendChild(s);
}));

function label(text) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d');
  g.font = '800 34px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const w = Math.min(240, g.measureText(text).width + 36);
  g.fillStyle = 'rgba(30,20,14,.62)'; g.beginPath(); g.roundRect(128 - w / 2, 8, w, 48, 24); g.fill();
  g.fillStyle = '#fff'; g.fillText(text, 128, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false })); s.scale.set(0.34, 0.085, 1); s.renderOrder = 30;
  return s;
}

export class Net {
  constructor({ scene, world, cat, catAssets, props, ui, sfx, game, fx, loops }) {
    Object.assign(this, { scene, world, cat, catAssets, props, ui, sfx, game, fx, loops });
    this.pending = new Map(); this.propT = 0; this.propAt = 0; this.snap = null; this.needAll = () => {};
    game.net = this; game.onTreat = i => { if (this.conns.length) this.send({ k: 'tr', id: this.id, l: [i] }); };
    const emit0 = cat.emit; cat.emit = (t, e) => { emit0(t, e); this.localEmit(t, e); };
    this.id = Math.random().toString(36).slice(2, 10);
    this.mode = 'off'; this.code = ''; this.peer = null; this.conns = []; this.others = new Map();
    this.ev = 0; this.ctl = { mx: 0, mz: 0, jump: false, pawHeld: false }; this.sendT = 0; this.shells = 3;
    this.onChange = () => {}; this.status = '';
    this._look = new THREE.Vector3();
  }
  get count() { return this.others.size + 1; }
  set(mode, status) { this.mode = mode; this.status = status; this.onChange(); }

  async open(id) {
    await loadLib();
    return new Promise((res, rej) => {
      const p = id ? new window.Peer(id, { debug: 0 }) : new window.Peer({ debug: 0 });
      p.once('open', () => res(p)); p.once('error', e => { try { p.destroy(); } catch {} rej(e); });
    });
  }
  async host() {
    if (this.mode !== 'off') return;
    this.set('busy', 'Setting up…');
    for (let tries = 0; tries < 4; tries++) {
      const code = Array.from({ length: 4 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');
      try { this.peer = await this.open(PREFIX + code); this.code = code; break; }
      catch (e) { if (e.type !== 'unavailable-id') return this.set('off', 'Could not reach the meeting point. Check the connection and try again.'); }
    }
    if (!this.peer) return this.set('off', 'Could not set up a game just now.');
    const p = this.peer;
    p.on('connection', c => {
      this.needAll();
      if (this.conns.length >= MAX - 1) { c.on('open', () => { c.send({ full: 1 }); setTimeout(() => c.close(), 300); }); return; }
      this.wire(c);
    });
    p.on('disconnected', () => { if (this.peer === p && !p.destroyed) setTimeout(() => { try { p.reconnect(); } catch {} }, 2000); });
    p.on('error', () => {});
    this.set('host', '');
  }
  async join(code) {
    code = (code || '').toUpperCase().replace(/[^A-Z]/g, '');
    if (this.mode !== 'off') return;
    if (code.length !== 4) return this.set('off', 'The code is four letters.');
    this.set('busy', 'Looking for ' + code + '…');
    try { this.peer = await this.open(); } catch { return this.set('off', 'Could not reach the meeting point. Check the connection and try again.'); }
    const p = this.peer; this.code = code;
    p.on('error', e => { if (this.mode === 'busy') { this.leave(); this.set('off', e.type === 'peer-unavailable' ? 'No game with the code ' + code + '.' : 'Could not connect.'); } });
    const c = p.connect(PREFIX + code, { reliable: true, serialization: 'json' });
    const giveUp = setTimeout(() => { if (this.mode === 'busy') { this.leave(); this.set('off', 'Could not connect to ' + code + '. On different networks this sometimes fails.'); } }, 15000);
    c.on('open', () => { clearTimeout(giveUp); this.set('guest', ''); this.needAll(); this.send({ k: 'tr', id: this.id, l: [...this.game.got] }); });
    this.wire(c);
  }
  wire(c) {
    this.conns.push(c);
    c.on('data', d => this.recv(d, c));
    const gone = () => {
      const i = this.conns.indexOf(c); if (i < 0) return; this.conns.splice(i, 1);
      if (this.mode === 'guest') { this.leave(); this.set('off', 'The game ended.'); this.ui.toast('The other cats have gone home'); }
      else if (c.catId) { this.drop(c.catId, true); this.send({ bye: c.catId }); }
    };
    c.on('close', gone); c.on('error', gone);
  }
  leave() {
    for (const id of [...this.others.keys()]) this.drop(id, false);
    this.conns = [];
    if (this.peer) { try { this.peer.destroy(); } catch {} this.peer = null; }
    this.code = ''; this.set('off', '');
  }
  send(d, except) { for (const c of this.conns) if (c !== except && c.open) { try { c.send(d); } catch {} } }

  recv(d, from) {
    if (!d || typeof d !== 'object') return;
    if (d.full) { this.leave(); return this.set('off', 'That game is full.'); }
    if (d.bye) return this.drop(d.bye, true);
    if (typeof d.id !== 'string' || d.id === this.id) return;
    if (d.k) {
      if (this.mode === 'host' && d.k !== 'snap') this.send(d, from);
      try { this.event(d); } catch (e) { console.warn('net', e); }
      return;
    }
    if (typeof d.id !== 'string' || d.id === this.id || !Array.isArray(d.p) || d.p.length !== 3 || !d.p.every(Number.isFinite)) return;
    if (this.mode === 'host') { from.catId = d.id; this.send(d, from); }
    let o = this.others.get(d.id);
    if (!o) {
      if (this.others.size >= MAX - 1) return;
      const coat = COATS.find(c => c.id === d.c) || COATS[0];
      const cat = new Cat(this.scene, this.catAssets, coat); cat.model.setShells(this.shells);
      cat.teleport(d.p[0], d.p[1], d.p[2], +d.y || 0);
      const tag = label(coat.name); tag.position.y = 0.6; cat.root.add(tag);
      cat.emit = (type, e) => this.remoteEmit(o, type, e);
      o = { id: d.id, cat, coat, tag, ctl: { mx: 0, mz: 0, jump: false, jumpPressed: false, pawPressed: false, pawHeld: false, meowPressed: false }, net: d, age: 0, ev: 0 };
      this.others.set(d.id, o); this.ui.toast(coat.name + ' has come to play', 'find'); this.sfx.meow({ kind: 'chirp' }); this.onChange();
      if (this.mode === 'host') this.sendSnapshot();
    }
    if (d.c !== o.coat.id) { const coat = COATS.find(c => c.id === d.c); if (coat) { o.coat = coat; o.cat.setCoat(coat); o.cat.root.remove(o.tag); o.tag = label(coat.name); o.tag.position.y = 0.6; o.cat.root.add(o.tag); } }
    o.net = d; o.age = 0; o.ev |= d.e | 0; o.fresh = true;
  }
  drop(id, tell) {
    const o = this.others.get(id); if (!o) return;
    for (const p of this.props.list) if (p.heldBy === id) { o.cat.mouth.getWorldPosition(_wp); this.scene.add(p.g); p.g.scale.setScalar(1); p.pos.copy(_wp); p.held = false; p.heldBy = null; p.asleep = false; p.still = 0; }
    this.others.delete(id); this.scene.remove(o.cat.root);
    for (const s of o.cat.model.shells) s.material.dispose();
    if (tell) this.ui.toast(o.coat.name + ' went home');
    this.onChange();
  }
  remoteEmit(o, type, e) {
    const near = o.cat.pos.distanceTo(this.cat.pos);
    if (type === 'meow') { if (near < 14) this.sfx.meow({ kind: e || 'meow' }); }
  }

  // ---------------------------------------------------------------- cats meeting cats
  nearest(maxD) {
    let best = null, bd = maxD;
    for (const o of this.others.values()) { const d = o.cat.pos.distanceTo(this.cat.pos); if (d < bd && o.cat.root.visible) { bd = d; best = o; } }
    return best;
  }
  localEmit(type, e) {
    if (!this.others.size || (type !== 'paw' && type !== 'pounceLand')) return;
    const pounce = type === 'pounceLand', me = this.cat.pos;
    for (const o of this.others.values()) {
      const q = o.cat.pos;
      if (Math.hypot(q.x - e.point.x, q.z - e.point.z) > (pounce ? 0.5 : 0.4) || Math.abs(q.y + 0.12 - e.point.y) > 0.45) continue;
      let fx = q.x - me.x, fz = q.z - me.z; if (Math.hypot(fx, fz) < 0.05) { fx = e.fx; fz = e.fz; }
      const w = pounce ? 1.5 : 1;
      o.cat.recoil(fx, fz, w); this.sfx.bap();
      this.fx.burst(e.point, 5, 0xffffff, { speed: 1, size: 0.012, life: 0.4 });
      this.send({ k: 'hit', id: this.id, to: o.id, f: [r2(fx), r2(fz)], w });
    }
    if (!pounce) this.send({ k: 'paw', id: this.id, p: [r2(e.point.x), r2(e.point.y), r2(e.point.z)], f: [r2(e.fx), r2(e.fz)], s: e.side });
  }
  event(d) {
    const num = a => Array.isArray(a) && a.every(Number.isFinite);
    switch (d.k) {
      case 'hit': {
        if (!num(d.f) || d.f.length !== 2) return; const w = Math.min(2, Math.max(0.5, +d.w || 1));
        if (d.to === this.id) { this.cat.recoil(d.f[0], d.f[1], w); this.sfx.bap(); this.game.shakeCam(0.035); }
        else { const o = this.others.get(d.to); if (o) o.cat.recoil(d.f[0], d.f[1], w); }
      } break;
      case 'paw': if (num(d.p) && d.p.length === 3 && num(d.f)) this.game.pawItems({ point: new THREE.Vector3(...d.p), fx: d.f[0], fz: d.f[1], side: d.s || 0, remote: true }); break;
      case 'tr': if (num(d.l)) for (const i of d.l.slice(0, 5000)) this.game.remoteTreat(i); break;
      case 'pr': if (Array.isArray(d.l)) for (const s of d.l.slice(0, 80)) if (num(s) && s.length === 12) this.applyProp(s, d.id); break;
      case 'mg': case 'mgq': case 'msf': case 'mcl': case 'mgt': case 'men': case 'mbb': case 'mbo': this.game.mini.netEvent(d); break;
      case 'snap': {
        if (this.mode !== 'guest' || !Array.isArray(d.l)) return;
        if (d.first || !this.snap) this.snap = new Set();
        for (const s of d.l.slice(0, 80)) if (num(s) && s.length === 12) { this.snap.add(s[0]); this.applyProp(s, d.id, true); }
        if (d.last) {            // anything I had disturbed that the host has not goes back where it was
          const now = performance.now();
          this.props.list.forEach((p, i) => { if (p.dirty && !this.snap.has(i) && !(p.mine && now - p.mine < 1500) && p !== this.game.carry) this.props.reset(p); });
          this.snap = null;
        }
      } break;
    }
  }

  // ---------------------------------------------------------------- the shared house
  propState(p, i) {
    let x = p.pos.x, y = p.pos.y, z = p.pos.z; const q = p.g.quaternion;
    if (p.held) { p.g.getWorldPosition(_wp); x = _wp.x; y = _wp.y; z = _wp.z; }
    return [i, r3(x), r3(y), r3(z), r3(q.x), r3(q.y), r3(q.z), r3(q.w), r2(p.vel.x), r2(p.vel.y), r2(p.vel.z), (p.dead ? 1 : 0) | (p.tipped ? 2 : 0) | (p.held ? 4 : 0) | (p.asleep ? 8 : 0)];
  }
  applyProp(s, from, force) {
    const i = s[0], P = this.props, p = P.list[i];
    if (!Number.isInteger(i) || i < 0 || i > 20000) return;
    if (!p) { this.pending.set(i, [s, from]); return; }
    if (p === this.game.carry) return;
    if (!force && p.mine && performance.now() - p.mine < 350) return;        // I am handling it right now
    p.mine = 0; p.dirty = true;
    const fl = s[11];
    if (fl & 1) { if (!p.dead) { if (p.heldBy) this.unhold(p); p.pos.set(s[1], s[2], s[3]); P.breakProp(p); } return; }
    if (p.dead) { p.dead = false; this.scene.add(p.g); }
    if (fl & 4) {
      const o = this.others.get(from);
      if (o && p.heldBy !== from) { p.held = true; p.heldBy = from; p.asleep = true; o.cat.mouth.add(p.g); p.g.position.set(0, -p.r * 0.2, p.r * 0.5); p.g.rotation.set(0, Math.PI / 2, 0); p.g.scale.setScalar(1 / CAT_S); p.g.visible = true; }
      return;
    }
    if (p.heldBy) this.unhold(p);
    p.pos.set(s[1], s[2], s[3]); p.g.quaternion.set(s[4], s[5], s[6], s[7]).normalize(); p.vel.set(s[8], s[9], s[10]);
    if ((fl & 2) && !p.tipped) { p.tipped = true; P.emit('tipped', p); }
    p.asleep = !!(fl & 8); p.still = 0; if (p.asleep) p.spin.set(0, 0, 0);
  }
  unhold(p) { this.scene.add(p.g); p.g.scale.setScalar(1); p.held = false; p.heldBy = null; }
  flushPending() { const l = [...this.pending.values()]; this.pending.clear(); for (const [s, from] of l) this.applyProp(s, from, true); }
  sendSnapshot() {
    const all = []; this.props.list.forEach((p, i) => { if (p.dirty && !p.heldBy) all.push(this.propState(p, i)); });
    for (let k = 0; k === 0 || k < all.length; k += 40) this.send({ k: 'snap', id: this.id, l: all.slice(k, k + 40), first: k === 0 ? 1 : 0, last: k + 40 >= all.length ? 1 : 0 });
    this.send({ k: 'tr', id: this.id, l: [...this.game.got] });
  }
  sendProps(dt) {
    this.propT += dt; if (this.propT < PROP_RATE) return; this.propT = 0;
    const L = this.props.list, out = [], now = performance.now(), n = L.length;
    if (this.game.carry) this.game.carry.mine = now;
    for (let k = 0; k < n && out.length < 30; k++) {
      const i = (this.propAt + k) % n, p = L[i];
      if (!p.mine) continue;
      if (p.heldBy) { p.mine = 0; continue; }
      out.push(this.propState(p, i));
      if ((p.asleep && !p.held) || p.dead) p.mine = 0;            // settled: that was the last word on it
      if (out.length === 30) this.propAt = (i + 1) % n;
    }
    if (out.length) this.send({ k: 'pr', id: this.id, l: out });
  }

  // called once per physics step with the local player's controls
  local(ctl) { this.ev |= (ctl.jumpPressed ? 1 : 0) | (ctl.pawPressed ? 2 : 0) | (ctl.meowPressed ? 4 : 0); this.ctl = ctl; }

  step(dt) {
    let petted = false;
    for (const o of this.others.values()) {
      const c = o.cat, n = o.net, k = o.ctl;
      o.age += dt;
      if (o.age > 8) { this.drop(o.id, true); continue; }
      const live = o.age < 0.6;
      k.mx = live ? n.m[0] : 0; k.mz = live ? n.m[1] : 0; k.jump = live && !!(n.h & 1); k.pawHeld = live && !!(n.h & 2);
      k.jumpPressed = !!(o.ev & 1); k.pawPressed = !!(o.ev & 2); k.meowPressed = !!(o.ev & 4); o.ev = 0;
      // what the other cat is doing (napping, eating, scratching…)
      const a = n.a;
      if (a && (!c.action || c.action.kind !== a[0])) { c.grounded = true; c.startAction(a[0], { x: a[1], z: a[2], yaw: a[3], type: a[4] || undefined }); }
      else if (!a && c.action) c.stopAction();
      c.update(dt, k, this.world);
      // ease toward where the other player's game says the cat really is
      const lead = Math.min(o.age, 0.25), tx = n.p[0] + n.v[0] * lead, tz = n.p[2] + n.v[2] * lead, ty = n.p[1];
      const ex = tx - c.pos.x, ez = tz - c.pos.z, ey = ty - c.pos.y, far = Math.hypot(ex, ez);
      if (far > 2.2 || Math.abs(ey) > 1.6) { c.teleport(n.p[0], n.p[1], n.p[2], n.y); c.grounded = !!n.g; c.vel.set(n.v[0], n.v[1], n.v[2]); }
      else {
        const s = 1 - Math.exp(-7 * dt); c.pos.x += ex * s; c.pos.z += ez * s;
        if (!n.g) { if (o.fresh) { c.grounded = false; c.vel.y = n.v[1]; } c.pos.y += ey * s; }
        else if (c.grounded && Math.abs(ey) > 0.04) c.pos.y += ey * s;
        else if (!c.grounded && ey > 0.3) c.pos.y += ey * s;
        if (Math.hypot(k.mx, k.mz) < 0.08) c.yaw += angDiff(c.yaw, n.y) * (1 - Math.exp(-8 * dt));
      }
      o.fresh = false;
      const d = c.pos.distanceTo(this.cat.pos);
      if (d < 0.75 && c.action && c.action.kind === 'groom') petted = true;
      // cats do not stand inside one another: each player eases their own cat aside
      const sx = this.cat.pos.x - c.pos.x, sz = this.cat.pos.z - c.pos.z, sd = Math.hypot(sx, sz);
      if (sd < 0.27 && sd > 1e-3 && Math.abs(this.cat.pos.y - c.pos.y) < 0.25 && this.cat.grounded && !this.cat.action) { const push = (0.27 - sd) * 9; this.cat.vel.x += sx / sd * push * dt * 14; this.cat.vel.z += sz / sd * push * dt * 14; }
      c.lookAt = d < 2.5 && d > 0.25 ? this._look.copy(this.cat.pos).setY(this.cat.pos.y + 0.22) : null;
    }
    // being washed by a friend: purr, and the odd heart
    this.cat.petW = petted ? 1 : 0;
    if (petted) {
      if (!this.petOn) { this.petOn = true; this.loops.purr.start(); }
      this.petT = (this.petT || 0) - dt;
      if (this.petT < 0) { this.petT = 0.9; this.fx.float(this._look.copy(this.cat.pos).setY(this.cat.pos.y + 0.42), '♥', '#ff8fa3', { size: 0.1 }); }
    } else this.petOn = false;
  }

  frame(dt) {
    for (const o of this.others.values()) o.cat.root.visible = o.cat.pos.y < this.world.cut - 0.3;
    if (!this.conns.length) return;
    this.sendProps(dt);
    this.sendT += dt; if (this.sendT < RATE) return; this.sendT = 0;
    const c = this.cat, k = this.ctl, a = c.action;
    this.send({ id: this.id, c: c.coat.id, p: [r2(c.pos.x), r2(c.pos.y), r2(c.pos.z)], v: [r2(c.vel.x), r2(c.vel.y), r2(c.vel.z)], y: r2(c.yaw), g: c.grounded ? 1 : 0,
      m: [r2(k.mx || 0), r2(k.mz || 0)], h: (k.jump ? 1 : 0) | (k.pawHeld ? 2 : 0), e: this.ev,
      a: a ? [a.kind, r2(a.x ?? c.pos.x), r2(a.z ?? c.pos.z), r2(a.yaw ?? c.yaw), a.type || 0] : 0 });
    this.ev = 0;
  }
  setShells(n) { this.shells = Math.max(2, Math.min(4, Math.round(n))); for (const o of this.others.values()) o.cat.model.setShells(this.shells); }
}
