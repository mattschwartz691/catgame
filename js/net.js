// Play together: other players' cats, over a direct WebRTC link between the browsers.
// One player hosts under a four-letter code; the others join it. The host passes everyone's
// messages along. Only the cats are shared: each player keeps their own house and to-do list.
import * as THREE from 'three';
import { Cat, COATS, angDiff } from './cat.js';

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ', PREFIX = 'catabout-game-', MAX = 4, RATE = 1 / 12;
const r2 = v => Math.round(v * 100) / 100;
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
  constructor({ scene, world, cat, catAssets, props, ui, sfx }) {
    Object.assign(this, { scene, world, cat, catAssets, props, ui, sfx });
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
    c.on('open', () => { clearTimeout(giveUp); this.set('guest', ''); });
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
    }
    if (d.c !== o.coat.id) { const coat = COATS.find(c => c.id === d.c); if (coat) { o.coat = coat; o.cat.setCoat(coat); o.cat.root.remove(o.tag); o.tag = label(coat.name); o.tag.position.y = 0.6; o.cat.root.add(o.tag); } }
    o.net = d; o.age = 0; o.ev |= d.e | 0; o.fresh = true;
  }
  drop(id, tell) {
    const o = this.others.get(id); if (!o) return;
    this.others.delete(id); this.scene.remove(o.cat.root);
    for (const s of o.cat.model.shells) s.material.dispose();
    if (tell) this.ui.toast(o.coat.name + ' went home');
    this.onChange();
  }
  remoteEmit(o, type, e) {
    const near = o.cat.pos.distanceTo(this.cat.pos);
    if (type === 'meow') { if (near < 14) this.sfx.meow({ kind: e || 'meow' }); }
    else if (type === 'paw') this.props.hit(e);
    else if (type === 'pounceLand') this.props.hit({ ...e, side: 0 }, 0.42, 1.35);
  }

  // called once per physics step with the local player's controls
  local(ctl) { this.ev |= (ctl.jumpPressed ? 1 : 0) | (ctl.pawPressed ? 2 : 0) | (ctl.meowPressed ? 4 : 0); this.ctl = ctl; }

  step(dt) {
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
      c.lookAt = d < 2.5 && d > 0.25 ? this._look.copy(this.cat.pos).setY(this.cat.pos.y + 0.22) : null;
    }
  }

  frame(dt) {
    for (const o of this.others.values()) o.cat.root.visible = o.cat.pos.y < this.world.cut - 0.3;
    if (!this.conns.length) return;
    this.sendT += dt; if (this.sendT < RATE) return; this.sendT = 0;
    const c = this.cat, k = this.ctl, a = c.action;
    this.send({ id: this.id, c: c.coat.id, p: [r2(c.pos.x), r2(c.pos.y), r2(c.pos.z)], v: [r2(c.vel.x), r2(c.vel.y), r2(c.vel.z)], y: r2(c.yaw), g: c.grounded ? 1 : 0,
      m: [r2(k.mx || 0), r2(k.mz || 0)], h: (k.jump ? 1 : 0) | (k.pawHeld ? 2 : 0), e: this.ev,
      a: a ? [a.kind, r2(a.x ?? c.pos.x), r2(a.z ?? c.pos.z), r2(a.yaw ?? c.yaw), a.type || 0] : 0 });
    this.ev = 0;
  }
  setShells(n) { this.shells = Math.max(2, Math.min(4, Math.round(n))); for (const o of this.others.values()) o.cat.model.setShells(this.shells); }
}
