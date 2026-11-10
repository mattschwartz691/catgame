// Cat controller + fully procedural animation.
// A virtual rig (plain Object3Ds + IK'd joint positions) is posed every frame, then copied onto the
// skinned model's bones as cat-space delta matrices.
import * as THREE from 'three';
import { CatModel, COATS } from './catmodel.js';
export { COATS };

export const CAT_S = 0.94;      // visual scale of the cat
export const CAT_R = 0.145;      // collision radius (world)
export const CAT_H = 0.23;      // collision height (world)
const S = CAT_S;
const G = 24, JUMP_V = 8.1, WALK = 1.0, RUN = 3.0, STEP = 0.06;
const L1 = 0.12, L2 = 0.13;
const TAIL_N = 10;
const TAU = Math.PI * 2;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const smooth = t => t * t * (3 - 2 * t);
const sstep = (a, b, x) => smooth(clamp((x - a) / (b - a), 0, 1));
export function angDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3();
const _p = new THREE.Vector3(), _k = new THREE.Vector3(), _h = new THREE.Vector3(), _f = new THREE.Vector3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _w = new THREE.Vector3();
const _inv = new THREE.Matrix4(), _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _qi = new THREE.Quaternion();
const ONE = new THREE.Vector3(1, 1, 1), XAXIS = new THREE.Vector3(1, 0, 0);

// Frame with origin A, Y along A->B, X as close to `lat` as possible.
function frame(out, A, B, lat = XAXIS) {
  _y.subVectors(B, A).normalize();
  _x.copy(lat).addScaledVector(_y, -lat.dot(_y));
  if (_x.lengthSq() < 1e-6) _x.set(0, 0, 1).addScaledVector(_y, -_y.z);
  _x.normalize();
  _z.crossVectors(_x, _y);
  return out.makeBasis(_x, _y, _z).setPosition(A);
}

export class Cat {
  static COATS = COATS;

  constructor(scene, assets, coat) {
    this.root = new THREE.Group();
    this.root.scale.setScalar(S);
    scene.add(this.root);
    this.model = new CatModel(assets, coat);
    this.root.add(this.model.group);
    this.J = this.model.J;

    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.yaw = 0;
    this.grounded = true; this.ground = null;
    this.time = 0; this.phase = 0;
    this.jumpBuf = 0; this.coyote = 0; this.crouchT = 0; this.jumpCut = false;
    this.squash = 0; this.squashV = 0;
    this.moveW = 0; this.airW = 0; this.sitW = 0; this.lieW = 0; this.sleepW = 0; this.rearW = 0; this.stretchW = 0;
    this.eatW = 0; this.kneadW = 0; this.groomW = 0; this.crouchW = 0; this.runT = 0;
    this.yawRateS = 0; this.idle = 0; this.accS = 0; this.prevHs = 0;
    this.pawT = 1; this.pawSide = 1; this.pawHit = true;
    this.meowT = 1; this.jawOpen = 0;
    this.action = null; this.actPh = 0;
    this.holdT = 0; this.charge = 0; this.pouncing = false;
    this.groomT = 8; this.groomLeft = 0;
    this.speedMul = 1; this.carrying = false; this.purr = 0;
    this.lookAt = null; this.lookYaw = 0; this.lookPitch = 0; this.glance = 0; this.glanceT = 1;
    this.blinkT = 2; this.blink = 1; this.earT = 2; this.earK = [0, 0]; this.exc = 0;
    this.twitch = 0; this.twitchT = 3;
    this.tailPts = []; this.tailLoc = []; this.tailInit = false;
    for (let i = 0; i < TAIL_N; i++) { this.tailPts.push(new THREE.Vector3()); this.tailLoc.push(new THREE.Vector3()); }
    this.stance = [true, true, true, true];
    this.emit = () => {};
    this.buildRig();
  }

  setCoat(coat) { this.model.setCoat(coat); }
  get coat() { return this.model.coat; }

  teleport(x, y, z, yaw) {
    this.pos.set(x, y, z); this.vel.set(0, 0, 0); this.yaw = yaw;
    this.grounded = true; this.action = null; this.tailInit = false; this.charge = 0; this.pouncing = false;
  }

  buildRig() {
    const J = this.J, B = this.model.bone;
    const rig = this.rig = new THREE.Group(); this.root.add(rig);
    const mk = (parent, x, y, z) => { const o = new THREE.Object3D(); o.position.set(x, y, z); parent.add(o); return o; };
    const body = this.body = mk(rig, J.body.x, J.body.y, J.body.z);
    const chest = this.chestG = mk(body, 0, 0, J.chest.z);
    const hips = this.hipsG = mk(body, 0, 0, J.hipsP.z);
    const head = this.headG = mk(chest, 0, J.head.y - J.chest.y, J.head.z - J.chest.z);
    this.jawG = mk(head, 0, J.jaw.y - J.head.y, J.jaw.z - J.head.z);
    this.earG = [1, -1].map(s => { const e = mk(head, s * J.ear.x, J.ear.y - J.head.y, J.ear.z - J.head.z); e.userData.s = s; return e; });
    this.tailBase = mk(hips, 0, J.tail.y - J.hipsP.y, J.tail.z - J.hipsP.z);

    // body-chain bones follow rig objects
    this.follow = [[B.hips, hips], [B.chest, chest], [B.head, head], [B.jaw, this.jawG], [B.earL, this.earG[0]], [B.earR, this.earG[1]]];
    this.root.updateMatrixWorld(true);
    _inv.copy(this.root.matrixWorld).invert();
    for (const f of this.follow) f[2] = new THREE.Matrix4().multiplyMatrices(_inv, f[1].matrixWorld).invert();

    // legs
    this.legs = [];
    const mir = (v, s) => new THREE.Vector3(v.x * s, v.y, v.z);
    for (const d of [{ f: true, s: 1, n: 'FL' }, { f: true, s: -1, n: 'FR' }, { f: false, s: 1, n: 'HL' }, { f: false, s: -1, n: 'HR' }]) {
      const leg = { ...d };
      const top = d.f ? J.sh : J.hip;
      leg.joint = mk(d.f ? chest : hips, d.s * top.x, top.y - J.body.y, top.z - (d.f ? J.chest.z : J.hipsP.z));
      const P = (d.f ? [J.sh, J.el, J.fpaw] : [J.hip, J.knee, J.hock, J.hpaw]).map(v => mir(v, d.s));
      leg.bones = d.f ? [B[d.n + 'u'], B[d.n + 'l'], B[d.n + 'p']] : [B[d.n + 't'], B[d.n + 's'], B[d.n + 'm'], B[d.n + 'p']];
      leg.restInv = [];
      for (let i = 0; i < P.length - 1; i++) leg.restInv.push(frame(new THREE.Matrix4(), P[i], P[i + 1]).invert());
      leg.restDir = new THREE.Vector3().subVectors(P[P.length - 1], P[P.length - 2]).normalize();
      leg.restPaw = P[P.length - 1].clone();
      leg.pts = P.map(v => v.clone());
      leg.foot = new THREE.Vector3();
      this.legs.push(leg);
    }
    // tail
    const tp = this.model.meta.tail.map(a => new THREE.Vector3(...a));
    this.tailRestInv = [];
    for (let i = 0; i < TAIL_N - 1; i++) this.tailRestInv.push(frame(new THREE.Matrix4(), tp[i], tp[i + 1]).invert());
    this.tailBones = []; for (let i = 0; i < TAIL_N - 1; i++) this.tailBones.push(B['tail' + i]);
    this.tailSeg = this.model.meta.tailSeg;
    // mouth anchor for carried things
    const nose = this.model.meta.nose;
    this.mouth = new THREE.Object3D(); this.mouth.position.set(0, nose[1] - 0.045, nose[2] - 0.012); B.head.add(this.mouth);
  }

  meow(kind) { if (this.meowT >= 1) { this.meowT = 0; this.emit('meow', kind); } }

  // type: 'scratch' | 'nap' | 'eat' | 'drink' | 'knead'.  info: {x, z, yaw, type(for scratch), max, ...}
  startAction(kind, info = {}) {
    if (!this.grounded) return false;
    this.action = { ...info, kind, t: 0, n: 0 };
    this.actPh = 0; this.charge = 0;
    this.emit('actionStart', this.action);
    return true;
  }
  stopAction() { if (this.action) { const a = this.action; this.action = null; this.emit('actionEnd', a); } }

  update(dt, ctl, world) {
    const t = (this.time += dt);
    const pos = this.pos, vel = this.vel, root = this.root, model = this.model;
    const mag = Math.min(1, Math.hypot(ctl.mx, ctl.mz));
    const moving = mag > 0.08;

    this.jumpBuf = ctl.jumpPressed ? 0.14 : Math.max(0, this.jumpBuf - dt);
    this.coyote = this.grounded ? 0.1 : Math.max(0, this.coyote - dt);
    if (ctl.meowPressed) this.meow();

    // ---------------- actions
    let act = this.action;
    if (act) {
      act.t += dt;
      const sc = act.kind === 'scratch', kn = act.kind === 'knead';
      const rate = sc ? 2.6 : kn ? 1.7 : act.kind === 'eat' ? 3 : act.kind === 'drink' ? 4 : 0.35;
      this.actPh += dt * rate * TAU;
      const n = Math.floor(act.t * rate * (sc || kn ? 2 : 1));
      if (n > act.n) {
        act.n = n;
        if (sc) { _v.set(0, act.type === 'floor' ? 0.03 : 0.5, 0.3); root.localToWorld(_v); this.emit('scratch', { sc: act, point: _v.clone() }); }
        else this.emit(act.kind, act);
      }
      const minT = sc ? 0.45 : 0.7;
      if (!this.grounded || ctl.jumpPressed || (moving && act.t > minT) || (act.max && act.t > act.max)) { this.stopAction(); act = null; }
    }
    // paw: tap = swipe, hold = wind up a pounce
    if (ctl.pawPressed && !act && this.pawT >= 0.8) { this.pawT = 0; this.pawSide = -this.pawSide; this.pawHit = false; }
    if (ctl.pawHeld && this.grounded && !act) {
      this.holdT += dt;
      if (this.holdT > 0.26) { if (this.charge === 0) this.emit('charge'); this.charge = Math.min(1, this.charge + dt / 0.55); }
    } else {
      if (this.charge > 0.3 && this.grounded && !act) {
        const c = this.charge, fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
        vel.x = fx * (3.0 + 3.4 * c); vel.z = fz * (3.0 + 3.4 * c); vel.y = 4.4 + 2.6 * c;
        this.grounded = false; this.coyote = 0; this.jumpCut = true; this.pouncing = true; this.squashV += 2.4;
        this.emit('pounce', c);
      }
      this.charge = 0; this.holdT = Math.min(this.holdT, 0); if (!ctl.pawHeld) this.holdT = 0;
    }
    if (this.pawT < 1) {
      this.pawT = Math.min(1, this.pawT + dt / 0.32);
      if (!this.pawHit && this.pawT >= 0.42) {
        this.pawHit = true;
        _v.set(-this.pawSide * 0.02, 0.1, 0.4); root.localToWorld(_v);
        this.emit('paw', { point: _v.clone(), fx: Math.sin(this.yaw), fz: Math.cos(this.yaw), side: this.pawSide });
      }
    }
    if (this.meowT < 1) this.meowT = Math.min(1, this.meowT + dt / 0.7);
    const env = this.pawT < 1 ? Math.sin(Math.PI * this.pawT) : 0;
    const menv = this.meowT < 1 ? Math.sin(Math.PI * this.meowT) : 0;

    // ---------------- locomotion
    let speedT = 0;
    if (moving && !act) {
      const run = RUN * this.speedMul;
      speedT = mag < 0.55 ? WALK * mag / 0.55 : WALK + (run - WALK) * (mag - 0.55) / 0.45;
      if (this.pawT < 1) speedT *= 0.45;
      if (this.charge > 0) speedT *= 0.12;
    }
    const inv = moving ? 1 / Math.hypot(ctl.mx, ctl.mz) : 0;
    const acc = this.grounded ? 14 : (this.pouncing ? 0.3 : moving ? 5 : 0.8);
    vel.x = damp(vel.x, ctl.mx * inv * speedT, acc, dt);
    vel.z = damp(vel.z, ctl.mz * inv * speedT, acc, dt);

    const prevYaw = this.yaw;
    if (act) {
      if (act.yaw !== undefined) this.yaw += angDiff(this.yaw, act.yaw) * (1 - Math.exp(-10 * dt));
      if (act.x !== undefined) { pos.x = damp(pos.x, act.x, 9, dt); pos.z = damp(pos.z, act.z, 9, dt); }
      vel.x = vel.z = 0;
    } else if (moving) {
      const rate = this.grounded ? (this.charge > 0 ? 4 : 11) : 6;
      this.yaw += angDiff(this.yaw, Math.atan2(ctl.mx, ctl.mz)) * (1 - Math.exp(-rate * dt));
    }
    this.yawRateS = damp(this.yawRateS, angDiff(prevYaw, this.yaw) / dt, 10, dt);

    // jump: tiny crouch (anticipation) then launch
    if (this.crouchT > 0) {
      this.crouchT -= dt;
      if (this.crouchT <= 0) {
        vel.y = JUMP_V; this.grounded = false; this.coyote = 0; this.jumpCut = false;
        this.squashV += 2.4; this.emit('jump');
      }
    } else if (this.jumpBuf > 0 && (this.grounded || this.coyote > 0)) {
      this.jumpBuf = 0; this.crouchT = 0.07; this.squashV -= 1.7; this.stopAction(); act = null; this.charge = 0; this.holdT = -0.4;
    }
    // releasing early gives a shorter hop, but a quick tap still clears a coffee table
    this.airT = this.grounded ? 0 : (this.airT || 0) + dt;
    if (!ctl.jump && !this.grounded && vel.y > 3 && !this.jumpCut && this.airT > 0.11) { vel.y *= 0.72; this.jumpCut = true; }

    // ---------------- physics
    if (!this.grounded) vel.y -= G * dt;
    const prevY = pos.y;
    pos.x += vel.x * dt; pos.z += vel.z * dt;
    const assist = world.resolveXZ(pos, CAT_R, CAT_H, vel, !this.grounded, ctl.mx * inv * Math.min(1, mag * 2), ctl.mz * inv * Math.min(1, mag * 2));
    if (assist && vel.y < 5.2 && vel.y > -7) { vel.y = 5.2; this.jumpCut = true; }   // scramble up a ledge
    if (!this.grounded) {
      pos.y += vel.y * dt;
      { const top = world.ceilY ? world.ceilY(prevY, pos.x, pos.z) : world.H; if (top && pos.y + CAT_H > top) { pos.y = top - CAT_H; if (vel.y > 0) vel.y = 0; } }     // there is a ceiling, even if we cannot see it
      if (vel.y > 0) {
        const c = world.ceilingAt(pos.x, pos.z, prevY + CAT_H);
        if (pos.y + CAT_H > c) { pos.y = c - CAT_H; vel.y = 0; }
      } else {
        const g = world.groundAt(pos.x, pos.z, prevY + 0.02);
        if (pos.y <= g.y) {
          const impact = -vel.y;
          pos.y = g.y; vel.y = 0; this.grounded = true; this.ground = g.box;
          this.squashV -= Math.min(2.8, impact * 0.3);
          this.emit('land', impact);
          if (this.pouncing) {
            this.pouncing = false;
            _v.set(Math.sin(this.yaw) * 0.3, 0.06, Math.cos(this.yaw) * 0.3).add(pos);
            this.emit('pounceLand', { point: _v.clone(), fx: Math.sin(this.yaw), fz: Math.cos(this.yaw) });
            vel.x *= 0.35; vel.z *= 0.35;
          }
        }
      }
    } else {
      const g = world.groundAt(pos.x, pos.z, pos.y + STEP);
      if (g.y > pos.y - 0.09) { pos.y = g.y; this.ground = g.box; }
      else { this.grounded = false; vel.y = 0; this.jumpCut = true; }
    }

    this.squashV += (-300 * this.squash - 20 * this.squashV) * dt;
    this.squash = clamp(this.squash + this.squashV * dt, -0.11, 0.05);

    // ---------------- blend weights
    const hs = Math.hypot(vel.x, vel.z);
    this.accS = damp(this.accS, clamp((hs - this.prevHs) / dt, -30, 30), 8, dt); this.prevHs = hs;
    const kind = act ? act.kind : null;
    const active = moving || !this.grounded || this.pawT < 1 || !!act || this.crouchT > 0 || this.meowT < 1 || this.charge > 0;
    this.idle = active ? 0 : this.idle + dt;
    if (this.idle > 5 && this.idle < 13) {            // a quick wash now and then
      this.groomT -= dt;
      if (this.groomT < 0 && this.groomLeft <= 0) { this.groomLeft = 2.6 + Math.random() * 1.5; this.groomT = 9 + Math.random() * 10; }
    }
    if (this.idle === 0) this.groomLeft = 0;
    const grooming = this.groomLeft > 0;
    if (grooming) { this.groomLeft -= dt; if (Math.floor(this.groomLeft * 3) !== Math.floor((this.groomLeft + dt) * 3)) this.emit('lick'); }
    const napping = kind === 'nap';
    const sitT = (this.idle > 3.5 && this.idle < 16) ? 1 : 0;
    const lieT = napping || this.idle >= 16 ? 1 : 0;
    this.moveW = damp(this.moveW, this.grounded && hs > 0.12 ? 1 : 0, 10, dt);
    this.airW = damp(this.airW, this.grounded ? 0 : 1, 16, dt);
    this.sitW = damp(this.sitW, sitT, sitT ? 4.5 : 10, dt);
    this.lieW = damp(this.lieW, lieT, lieT ? 3.2 : 8, dt);
    this.sleepW = damp(this.sleepW, napping && act.t > 2.2 ? 1 : 0, napping ? 1.6 : 6, dt);
    this.rearW = damp(this.rearW, kind === 'scratch' && act.type !== 'floor' ? 1 : 0, 10, dt);
    this.stretchW = damp(this.stretchW, kind === 'scratch' && act.type === 'floor' ? 1 : 0, 9, dt);
    this.eatW = damp(this.eatW, kind === 'eat' || kind === 'drink' ? 1 : 0, 7, dt);
    this.kneadW = damp(this.kneadW, kind === 'knead' ? 1 : 0, 7, dt);
    this.groomW = damp(this.groomW, grooming ? 1 : 0, 6, dt);
    this.crouchW = damp(this.crouchW, this.charge > 0 ? 0.35 + 0.65 * this.charge : 0, 14, dt);
    this.runT = damp(this.runT, sstep(1.3, 2.5, hs), 8, dt);
    const { moveW, airW, rearW, stretchW, eatW, kneadW, groomW, crouchW, runT } = this;
    this.sitW *= 1 - clamp(Math.abs(this.yawRateS) * dt * 2, 0, 1);
    const lieE = smooth(this.lieW), sleepE = smooth(this.sleepW);
    const sitE = smooth(this.sitW) * (1 - lieE);
    const foldE = Math.max(sitE, lieE);           // hind legs folded under
    if (this.sleepW > 0.5 && Math.floor(t / 1.9) !== Math.floor((t - dt) / 1.9)) this.emit('snore', Math.floor(t / 1.9) % 2);

    const duty = lerp(0.62, 0.36, runT);
    const stride = lerp(0.2, 0.32, runT) * clamp(hs / 0.6, 0.4, 1);
    // turning on the spot: shuffle the feet instead of spinning like a statue
    const turnW = this.turnW = damp(this.turnW || 0, clamp(Math.abs(this.yawRateS) / 3.5, 0, 1) * (1 - this.moveW) * (this.grounded && !act ? 1 : 0), 10, dt);
    if (this.grounded) this.phase = (this.phase + ((hs / S) * duty / stride + turnW * 2.4) * dt) % 1;
    const ph = this.phase;

    // ---------------- body pose
    const u = clamp(vel.y / 6, -1, 1);
    const gal = runT * moveW;
    const wig = crouchW * Math.sin(t * 21);                  // the pre-pounce butt wiggle
    const br = Math.sin(t * lerp(2.3, 1.1, sleepE));
    const p = sitE * 0.63 + rearW * 1.0 - stretchW * 0.38 + airW * (u * 0.45 + 0.05)
      + gal * 0.09 * Math.sin(TAU * (ph + 0.3)) - env * 0.05 - eatW * 0.2 - crouchW * 0.16 - kneadW * 0.12
      - clamp(this.accS * 0.006, -0.1, 0.1) * moveW;
    const hipY = Math.max(0.088, 0.25 - sitE * 0.155 - lieE * 0.158 - rearW * 0.08 + stretchW * 0.02 - gal * 0.02
      - crouchW * 0.06 + this.squash * (1 - 0.6 * foldE)
      + moveW * (1 - runT) * 0.005 * Math.sin(2 * TAU * ph) + gal * 0.022 * Math.sin(TAU * (ph + 0.05))
      + kneadW * 0.004 * Math.sin(this.actPh * 2));
    const hipZ = -0.15 + sitE * 0.05 + rearW * 0.1 - stretchW * 0.05 - crouchW * 0.02;
    const roll = clamp(-this.yawRateS * hs * 0.022, -0.3, 0.3) * moveW - env * this.pawSide * 0.07
      + moveW * (1 - runT) * 0.03 * Math.sin(TAU * ph) + sleepE * 0.2 + wig * 0.05;
    const bend = clamp(this.yawRateS * 0.05, -0.5, 0.5);
    const body = this.body, cp = Math.cos(p), sp = Math.sin(p);
    body.position.set(0, hipY + 0.03 * cp + 0.15 * sp, hipZ - 0.03 * sp + 0.15 * cp);
    body.rotation.set(-p, 0, roll);
    const breath = 1 + (0.012 + 0.02 * sleepE) * br;
    this.chestG.scale.set(breath, breath, 1);
    this.chestG.rotation.set(-crouchW * 0.05, bend * 0.6 - env * this.pawSide * 0.12 + sleepE * 0.25, 0);
    this.hipsG.rotation.set(gal * 0.2 * Math.sin(TAU * ph + 1.2) + crouchW * 0.12, -bend * 0.5 + wig * 0.14 - sleepE * 0.25, wig * 0.06);

    // ---------------- head
    let ty = 0, tp = 0;
    if (this.lookAt && sleepE < 0.3) {
      _v.copy(this.lookAt); root.worldToLocal(_v);
      const dx = _v.x, dz = _v.z - 0.3, a = Math.atan2(dx, dz);
      if (Math.abs(a) < 2.0) { ty = clamp(a, -1.1, 1.1); tp = clamp(-Math.atan2(_v.y - 0.4, Math.hypot(dx, dz)), -0.7, 0.6); }
    } else if (this.idle > 1 && !grooming) {
      this.glanceT -= dt;
      if (this.glanceT < 0) { this.glance = (Math.random() - 0.5) * 1.5; this.glanceT = 1.5 + Math.random() * 3; }
      ty = this.glance * (1 - sleepE);
    }
    if (moving && !act) ty += clamp(angDiff(this.yaw, Math.atan2(ctl.mx, ctl.mz)), -0.8, 0.8);
    this.lookYaw = damp(this.lookYaw, ty, 7, dt);
    this.lookPitch = damp(this.lookPitch, tp, 7, dt);
    const headComp = sitE * 0.56 + rearW * 0.7 - stretchW * 0.27 + airW * u * 0.2 - crouchW * 0.2 - kneadW * 0.05;
    const chew = eatW * (0.1 * Math.max(0, Math.sin(this.actPh)));
    const lickBob = groomW * 0.12 * Math.sin(t * 9);
    this.headG.rotation.set(
      headComp + this.lookPitch * (1 - eatW) + env * 0.3 - menv * 0.3 + moveW * 0.03 * Math.sin(2 * TAU * ph + 1)
        + eatW * 0.95 + chew + sleepE * 0.7 + groomW * 0.75 + lickBob + kneadW * 0.25,
      this.lookYaw * (1 - eatW) * (1 - groomW) + bend * 0.8 + sleepE * 0.9 - groomW * 0.25 * this.pawSide,
      sitE * 0.1 * Math.sin(t * 0.7) * (1 - groomW) + sleepE * 0.35 + groomW * 0.2 * this.pawSide);
    this.jawOpen = damp(this.jawOpen, Math.max(menv * 0.5, chew * 2.2, this.carrying ? 0.3 : 0, groomW * 0.18), 25, dt);
    this.jawG.rotation.x = this.jawOpen;

    root.position.copy(pos);
    root.rotation.y = this.yaw;
    root.updateMatrixWorld(true);
    _inv.copy(root.matrixWorld).invert();

    // ---------------- legs (IK to procedural foot targets)
    const lift = lerp(0.035, 0.075, runT);
    const k = (u + 1) / 2;
    for (let li = 0; li < 4; li++) {
      const leg = this.legs[li], s = leg.s, f = leg.f;
      leg.joint.getWorldPosition(_h).applyMatrix4(_inv);
      const off = f ? (s > 0 ? lerp(0.25, 0.55, runT) : lerp(0.75, 0.65, runT)) : (s > 0 ? 0 : lerp(0.5, 0.1, runT));
      const tt = (ph + off) % 1;
      let gz, gy = 0;
      const st = tt < duty;
      if (st) gz = 0.5 - tt / duty;
      else { const sw = (tt - duty) / (1 - duty); gz = -0.5 + smooth(sw); gy = Math.sin(Math.PI * sw); }
      let fx = s * (f ? 0.062 : 0.068) + gz * turnW * 0.035 * (f ? 1 : -1) * Math.sign(this.yawRateS || 1), fy = 0.03 + gy * lift * Math.max(moveW, turnW * 0.6), fz = (f ? 0.15 : -0.165) + gz * stride * moveW;
      if (f) {
        fx = lerp(fx, s * 0.045, sitE); fz = lerp(fz, 0.15, sitE);
        fx = lerp(fx, s * 0.05, lieE); fz = lerp(fz, 0.24, lieE);
        fz += crouchW * 0.03;
        if (rearW > 0.001) {
          const a = this.actPh + (s > 0 ? 0 : Math.PI);
          fx = lerp(fx, s * 0.045, rearW); fy = lerp(fy, 0.5 + 0.09 * Math.sin(a), rearW);
          fz = lerp(fz, 0.24 - 0.025 * Math.cos(a), rearW);
        }
        if (stretchW > 0.001) {
          const a = this.actPh + (s > 0 ? 0 : Math.PI);
          fx = lerp(fx, s * 0.05, stretchW); fy = lerp(fy, 0.03 + Math.max(0, Math.cos(a)) * 0.025, stretchW);
          fz = lerp(fz, 0.29 + 0.055 * Math.sin(a), stretchW);
        }
        if (kneadW > 0.001) {
          const a = this.actPh + (s > 0 ? 0 : Math.PI);
          fy += kneadW * Math.max(0, Math.sin(a)) * 0.035; fz += kneadW * (0.03 + 0.012 * Math.cos(a)); fx = lerp(fx, s * 0.05, kneadW);
        }
      } else {
        fx = lerp(fx, s * 0.098, foldE); fz = lerp(fz, lerp(0.0, -0.06, lieE), foldE);
        fz = lerp(fz, -0.07, rearW); fz = lerp(fz, -0.22, stretchW);
        fz += crouchW * 0.035 + crouchW * s * 0.008 * Math.sin(t * 21);
      }
      _f.set(fx, fy, fz);
      if (st && !this.stance[li] && moveW > 0.4 && this.grounded) {     // footfall
        _v.copy(_f).applyMatrix4(root.matrixWorld);
        this.emit('step', { leg: li, x: _v.x, y: pos.y, z: _v.z, yaw: this.yaw, speed: hs });
      }
      this.stance[li] = st;
      if (airW > 0.001) {
        if (f) _a.set(_h.x, _h.y + lerp(-0.25, -0.17, k), _h.z + lerp(0.09, 0.17, k) + (this.pouncing ? 0.05 : 0));
        else _a.set(_h.x, _h.y + lerp(-0.17, -0.23, k), _h.z + lerp(0.09, -0.15, k));
        _f.lerp(_a, airW);
      }
      if (f && s === this.pawSide && this.pawT < 1) {     // paw swipe
        const q = this.pawT;
        _a.set(_h.x + s * 0.05, _h.y - 0.05, _h.z + 0.11);
        _b.set(_h.x - s * 0.1, _h.y - 0.12, _h.z + 0.24);
        if (q < 0.35) _f.lerp(_a, smooth(q / 0.35));
        else if (q < 0.6) _f.copy(_a).lerp(_b, (q - 0.35) / 0.25);
        else _f.lerpVectors(_b, _f, smooth((q - 0.6) / 0.4));
      }
      if (f && s === this.pawSide && groomW > 0.001) {    // paw up to the mouth for a wash
        this.mouth.getWorldPosition(_a).applyMatrix4(_inv);
        _a.y -= 0.025 + 0.012 * Math.sin(t * 9); _a.z += 0.02; _a.x += s * 0.012;
        _f.lerp(_a, groomW);
      }
      // Front: shoulder -> elbow (points back) -> paw.   Hind: hip -> knee (forward) -> hock -> paw.
      let my = 0, mz = 0;
      if (f) _p.set(s * groomW * 0.6, lerp(0.15, -1, rearW), lerp(-1, -0.5, rearW));
      else {
        _p.set(0, lerp(0.35, -0.25, gal * (1 - foldE)), 1);      // keep galloping knees tucked under, not above the back
        my = lerp(0.072, 0.014, foldE); mz = lerp(-0.026, -0.072, foldE) - airW * 0.02;
        _f.y += my; _f.z += mz;
      }
      _d.subVectors(_f, _h);
      let L = _d.length();
      const max = L1 + L2 - 0.003;
      if (L > max) { _d.multiplyScalar(max / L); L = max; _f.addVectors(_h, _d); }
      if (L < 0.03) { _d.set(0, -0.03, 0); L = 0.03; _f.addVectors(_h, _d); }
      _d.multiplyScalar(1 / L);
      const a = (L1 * L1 - L2 * L2 + L * L) / (2 * L), hh = Math.sqrt(Math.max(0, L1 * L1 - a * a));
      _p.addScaledVector(_d, -_p.dot(_d));
      if (_p.lengthSq() < 1e-6) _p.set(0, 0, -1);
      _p.normalize();
      _k.copy(_h).addScaledVector(_d, a).addScaledVector(_p, hh);
      const P = leg.pts;
      P[0].copy(_h); P[1].copy(_k); P[2].copy(_f);
      if (!f) P[3].set(_f.x, _f.y - my, _f.z - mz);
      const nb = P.length - 1;
      for (let i = 0; i < nb; i++) {
        const b = leg.bones[i];
        b.matrix.multiplyMatrices(frame(_m, P[i], P[i + 1]), leg.restInv[i]); b.matrixWorldNeedsUpdate = true;
      }
      // paw: flat when planted, follows the shin when lifted
      const paw = P[nb];
      _w.subVectors(P[nb], P[nb - 1]).normalize();
      const w = sstep(0.0, 0.05, paw.y - 0.03) * 0.85;
      _q.setFromUnitVectors(leg.restDir, _w); _qi.identity().slerp(_q, w);
      const pb = leg.bones[nb];
      _m.compose(paw, _qi, ONE); _m2.makeTranslation(-leg.restPaw.x, -leg.restPaw.y, -leg.restPaw.z);
      pb.matrix.multiplyMatrices(_m, _m2); pb.matrixWorldNeedsUpdate = true;
      leg.foot.copy(paw);
    }

    // ---------------- ears, then copy the body chain onto bones
    this.earT -= dt;
    if (this.earT < 0) { this.earT = 1.2 + Math.random() * 4; this.earK[Math.random() < 0.5 ? 0 : 1] = 1; }
    for (let i = 0; i < 2; i++) {
      const e = this.earG[i], s = e.userData.s;
      this.earK[i] *= Math.exp(-9 * dt);
      e.rotation.x = -0.5 * Math.max(airW * (this.pouncing ? 0.3 : 1), runT * 0.5, sleepE * 0.5) + crouchW * 0.25;
      e.rotation.z = -s * (0.4 * this.earK[i] + 0.25 * sleepE);
      e.rotation.y = s * this.earK[i] * 0.3;
    }
    root.updateMatrixWorld(true);
    for (const f of this.follow) { f[0].matrix.multiplyMatrices(_inv, f[1].matrixWorld).multiply(f[2]); f[0].matrixWorldNeedsUpdate = true; }

    // ---------------- tail: lagged chain toward a posed rest curve
    this.twitchT -= dt;
    if (this.twitchT < 0) { this.twitchT = 2 + Math.random() * 4; this.twitch = 1; }
    this.twitch = Math.max(0, this.twitch - dt * 1.4);
    const tw = Math.max(this.twitch, crouchW * 0.9);
    const pts = this.tailPts;
    this.tailBase.getWorldPosition(pts[0]);
    _a.copy(pts[0]).applyMatrix4(_inv);
    const floorY = this.grounded ? pos.y : -1e9;
    const calm = Math.max(rearW, stretchW, eatW * 0.6);
    const SEG = this.tailSeg;
    for (let i = 1; i < TAIL_N; i++) {
      const fi = i / (TAIL_N - 1);
      let e = lerp(0.7, 1.9, fi);
      e = lerp(e, 0.2 + 0.12 * Math.sin(TAU * ph + i * 0.6), gal);
      e = lerp(e, 0.55 + u * 0.35, airW);
      e = lerp(e, i < 2 ? -0.5 : 0, foldE);
      e = lerp(e, 0.35, calm);
      e = lerp(e, 0.15 + 0.1 * fi, crouchW);
      const az = Math.sin(t * 1.4 + i * 0.4) * 0.25 * fi * (1 - sleepE) + moveW * Math.sin(TAU * ph + i * 0.5) * 0.12
        + foldE * 0.42 * i + tw * Math.sin(t * 18) * 0.5 * fi * fi + kneadW * Math.sin(t * 2.2 + i * 0.5) * 0.3 * fi;
      const ce = Math.cos(e);
      _a.x += Math.sin(az) * ce * SEG; _a.y += Math.sin(e) * SEG; _a.z -= Math.cos(az) * ce * SEG;
      _v.copy(_a).applyMatrix4(root.matrixWorld);
      if (!this.tailInit) pts[i].copy(_v);
      else pts[i].lerp(_v, 1 - Math.exp(-lerp(40, 10, fi) * dt));
      _d.subVectors(pts[i], pts[i - 1]);
      const len = _d.length() || 1;
      pts[i].copy(pts[i - 1]).addScaledVector(_d, SEG * S / len);
      if (pts[i].y < floorY + 0.03) pts[i].y = floorY + 0.03;
      // a tail does not go through walls or furniture: slide it along the surface, curling upward
      const sb = world.solidAt && world.solidAt(pts[i].x, pts[i].y, pts[i].z);
      if (sb) {
        const p = pts[i], l = p.x - sb.minX, r = sb.maxX - p.x, n = p.z - sb.minZ, f = sb.maxZ - p.z, up = sb.maxY - p.y, m = Math.min(l, r, n, f, up < 0.12 ? up : 1e9);
        if (m === up) p.y = sb.maxY + 0.01;
        else { if (m === l) p.x = sb.minX - 0.012; else if (m === r) p.x = sb.maxX + 0.012; else if (m === n) p.z = sb.minZ - 0.012; else p.z = sb.maxZ + 0.012; p.y += SEG * S * 0.55; }
        _d.subVectors(p, pts[i - 1]); const l2 = _d.length() || 1; p.copy(pts[i - 1]).addScaledVector(_d, SEG * S / l2);
      }
    }
    this.tailInit = true;
    for (let i = 0; i < TAIL_N; i++) this.tailLoc[i].copy(pts[i]).applyMatrix4(_inv);
    for (let i = 0; i < TAIL_N - 1; i++) {
      const b = this.tailBones[i];
      b.matrix.multiplyMatrices(frame(_m, this.tailLoc[i], this.tailLoc[i + 1]), this.tailRestInv[i]); b.matrixWorldNeedsUpdate = true;
    }

    // ---------------- face + fur
    this.blinkT -= dt;
    if (this.blinkT < 0) { this.blinkT = 1.8 + Math.random() * 4; this.blink = 0; }
    if (this.blink < 1) this.blink = Math.min(1, this.blink + dt / 0.16);
    const bl = Math.sin(Math.PI * this.blink);
    this.purr = damp(this.purr, Math.max(kneadW, sleepE, lieE * 0.6), 3, dt);
    model.setLids(Math.max(bl, sleepE, groomW * 0.6), Math.max(sitE * 0.2, kneadW * 0.7, lieE * 0.45, eatW * 0.4));
    this.exc = damp(this.exc, Math.max(airW, env, rearW, runT * 0.6, crouchW, this.lookAt ? 0.4 : 0.15), 6, dt);
    model.setPupil(lerp(0.12, 1, this.exc));
    // fur lags behind motion and droops a little
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const lvx = vel.x * cy - vel.z * sy, lvz = vel.x * sy + vel.z * cy;
    const ff = model.shared.uFurForce.value;
    ff.set(damp(ff.x, clamp(-lvx * 0.1 - this.yawRateS * 0.02, -0.5, 0.5), 8, dt),
      damp(ff.y, clamp(-0.22 - vel.y * 0.06, -0.7, 0.4), 8, dt), damp(ff.z, clamp(-lvz * 0.12, -0.6, 0.3), 8, dt));
  }
}
