import * as THREE from 'three';
import { Cat, COATS, angDiff, CAT_S } from './cat.js';
import { loadCatAssets } from './catmodel.js';
import { World, loadHouse } from './world.js';
import { Props } from './props.js';
import { Input } from './input.js';
import { Renderer, pickTier, TIERS } from './render.js';
import { FX } from './fx.js';
import { Game } from './game.js';
import { UI } from './ui.js';
import { initAudio, sfx, loops, music, setSfxOn, setMusicOn, suspendAudio, resumeAudio } from './audio.js';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
window.addEventListener('error', e => { const el = $('err'); if (el) el.textContent = 'Error: ' + e.message + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno; });
window.addEventListener('unhandledrejection', e => { const el = $('err'); if (el) el.textContent = 'Error: ' + (e.reason && e.reason.message || e.reason); });

// ------------------------------------------------------------------ boot
const ui = new UI();
const canvas = $('game');
const R = new Renderer(canvas, pickTier());
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.06, 120);
scene.environment = R.envMap();
scene.environmentIntensity = 0.5;

ui.loading(0.05, 'Fluffing the cat…');
const [catAssets, houseAssets] = await Promise.all([
  loadCatAssets(),
  loadHouse(R.r, 'assets/house/', (u, l, t) => { if (t) ui.loading(0.1 + 0.7 * l / t, 'Tidying the house (not for long)…'); }),
]);
ui.loading(0.9, 'Hiding the treats…');

const world = new World(scene, houseAssets, { shadowSize: R.tier.shadow });
const props = new Props(scene, world, houseAssets);
const fx = new FX(scene, world);
let coatIdx = 0;
try { coatIdx = clamp(parseInt(localStorage.getItem('coat') || '0', 10) || 0, 0, COATS.length - 1); } catch {}
const cat = new Cat(scene, catAssets, COATS[coatIdx]);
cat.model.setShells(R.tier.shells);
const sp = world.data.spawn;
cat.teleport(sp.x, 0, sp.z, sp.yaw);
const input = new Input(canvas);
const game = new Game({ scene, world, props, fx, cat, ui, input, camera });

// sky dome
{
  const g = new THREE.SphereGeometry(90, 24, 12);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uSun: { value: world.sunDir } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vP; uniform vec3 uSun;
      void main(){ float h = clamp(vP.y, -0.1, 1.0);
        vec3 top = vec3(0.25, 0.52, 0.92), hor = vec3(0.86, 0.9, 0.96), gnd = vec3(0.45, 0.6, 0.38);
        vec3 c = mix(hor, top, pow(max(h, 0.0), 0.5));
        c = mix(c, gnd, smoothstep(0.0, -0.06, vP.y));
        float s = max(dot(normalize(vP), uSun), 0.0);
        c += vec3(1.0, 0.85, 0.6) * (pow(s, 40.0) * 0.5 + pow(s, 900.0) * 6.0);
        gl_FragColor = vec4(c * 1.6, 1.0); }`,
  });
  const sky = new THREE.Mesh(g, m); sky.renderOrder = -10; scene.add(sky);
}
scene.fog = new THREE.Fog(0xdfe8f0, 40, 110);

R.setup(scene, camera);
R.onTier = (t) => { cat.model.setShells(t.shells); world.sun.shadow.mapSize.set(t.shadow, t.shadow); if (world.sun.shadow.map) { world.sun.shadow.map.dispose(); world.sun.shadow.map = null; } };

// ------------------------------------------------------------------ state + camera
let state = 'menu';
let camYaw = 0.5, camPitch = 0.2, camDist = 1.7, curDist = 1.7, introT = 0, shake = 0, fovKick = 0;
const camT = new THREE.Vector3(cat.pos.x, 0.3, cat.pos.z);

function setState(s) {
  state = s;
  ui.setState(s);
  input.enabled = s === 'play';
  input.jx = input.jy = 0; input.jump = input.paw = false;
  if (s === 'play') { introT = 1.3; camPitch = 0.5; game.onEnterPlay(); }
  else { camPitch = 0.16; cat.vel.set(0, 0, 0); camYaw = cat.yaw + 0.5; }
  resize();
}
function resize() {
  const w = window.innerWidth, h = window.innerHeight, portrait = h > w;
  camera.aspect = w / h;
  camera.fov = (portrait ? 62 : 48);
  camDist = state === 'menu' ? (portrait ? 1.9 : 1.55) : (portrait ? 2.3 : 2.0);
  if (state === 'menu') {
    if (h <= 480) camera.setViewOffset(w, h, w * 0.22, 0, w, h);
    else camera.setViewOffset(w, h, 0, h * (portrait ? 0.2 : 0.22), w, h);
  } else camera.clearViewOffset();
  camera.updateProjectionMatrix();
  R.resize();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 250));
document.addEventListener('visibilitychange', () => { if (document.hidden) suspendAudio(); else resumeAudio(); });

ui.onPick = (i) => {
  initAudio();
  if (i !== coatIdx) { coatIdx = i; cat.setCoat(COATS[i]); try { localStorage.setItem('coat', String(i)); } catch {} }
  cat.squashV = 2.2; cat.meow('chirp');
};
ui.onPlay = () => { initAudio(); loops.ambience.start(); sfx.pop(); setState('play'); };
ui.onMenu = () => setState('menu');
ui.buildMenu(COATS, coatIdx);
const QUAL = ['auto', 'low', 'medium', 'high'];
let qual = 'auto'; try { qual = localStorage.getItem('quality') || 'auto'; } catch {}
game.qualityName = qual; game.optUI();
ui.onQuality = () => {
  qual = QUAL[(QUAL.indexOf(qual) + 1) % QUAL.length];
  try { if (qual === 'auto') localStorage.removeItem('quality'); else localStorage.setItem('quality', qual); } catch {}
  R.setTier(qual === 'auto' ? pickTier() : qual);
  game.qualityName = qual; game.optUI();
};
game.shakeCam = (a) => { shake = Math.max(shake, a); };

// ------------------------------------------------------------------ loop
const dir = new THREE.Vector3(), tgt = new THREE.Vector3(), _cw = new THREE.Vector3();
const ctl = { mx: 0, mz: 0, jump: false, jumpPressed: false, pawPressed: false, pawHeld: false, meowPressed: false };
let last = performance.now(), ambS = 0.5, liftS = 0;
const dbg = { manual: false, freezeCam: false, every: +(new URLSearchParams(location.search).get('every') || 0) };

function step(dt) {
  if (state === 'play') {
    const [jx, jy] = input.move();
    const sy = Math.sin(camYaw), cy = Math.cos(camYaw);
    ctl.mx = cy * jx + sy * jy; ctl.mz = -sy * jx + cy * jy;
    ctl.jump = input.jump; ctl.pawHeld = input.paw;
    ctl.jumpPressed = input.take('jump'); ctl.pawPressed = input.take('paw'); ctl.meowPressed = input.take('meow');
    if (input.take('act')) game.act();
  } else {
    ctl.mx = ctl.mz = 0; ctl.jump = ctl.pawHeld = ctl.jumpPressed = ctl.pawPressed = ctl.meowPressed = false;
    cat.idle = clamp(cat.idle, 5, 12);
  }
  game.preStep(dt);
  cat.update(dt, ctl, world);
  props.update(dt, cat);
  game.step(dt, state === 'play');
  fx.update(dt, cat);
}

function frame(now) {
  requestAnimationFrame(frame);
  if (dbg.every && now - (dbg.lastR || 0) < dbg.every) return;
  dbg.lastR = now;
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (dt <= 0) return;
  const t = now / 1000;
  if (!dbg.manual) { if (dt > 0.022) { step(dt / 2); step(dt / 2); } else step(dt); }

  const hs = Math.hypot(cat.vel.x, cat.vel.z);
  if (state === 'play') {
    camYaw -= input.lookX * 0.0055; camPitch = clamp(camPitch + input.lookY * 0.004, 0.05, 1.35);
    input.lookX = input.lookY = 0;
    if (introT > 0) { introT -= dt; camYaw += angDiff(camYaw, cat.yaw + Math.PI) * (1 - Math.exp(-5 * dt)); }
    else if (hs > 0.3 && t - input.lastLook > 1.2) {
      const d = angDiff(camYaw, cat.yaw + Math.PI);
      if (Math.abs(d) < 2.3) camYaw += d * Math.min(1, 1.3 * dt) * clamp(hs / 2, 0.3, 1);
    }
  } else if (!dbg.freezeCam) {
    camYaw = cat.yaw + Math.sin(t * 0.35) * 0.45;
    cat.lookAt = camera.position;
  }

  // dynamic objects pick up the baked ambient level where they stand
  ambS = damp(ambS, clamp(world.ambientAt(cat.pos.x, cat.pos.z) * 2.2 + 0.25, 0.3, 1.6), 4, dt);
  for (const s of cat.model.shells) s.material.envMapIntensity = ambS;

  // ---- camera
  const sleepy = cat.sleepW;
  if (dbg.every) camT.set(cat.pos.x, cat.pos.y + 0.36, cat.pos.z);
  camT.x = damp(camT.x, cat.pos.x, 12, dt); camT.z = damp(camT.z, cat.pos.z, 12, dt);
  camT.y = damp(camT.y, cat.pos.y + (state === 'menu' ? 0.3 : 0.36), 7, dt);
  fovKick = damp(fovKick, clamp((hs - 3.2) * 3, 0, 9) + (cat.pouncing ? 4 : 0), 5, dt);
  const baseFov = window.innerHeight > window.innerWidth ? 62 : 48;
  if (Math.abs(camera.fov - (baseFov + fovKick)) > 0.05) { camera.fov = baseFov + fovKick; camera.updateProjectionMatrix(); }
  tgt.copy(camT);
  // if furniture is in the way, look over it from higher up before moving in closer
  const wantD = camDist * (1 - sleepy * 0.2);
  let bestLift = 0, bestClear = 0;
  for (let k = 0; k < 5; k++) {
    const lift = k * 0.22, pt = Math.min(1.45, camPitch + sleepy * 0.25 + lift), c0 = Math.cos(pt);
    dir.set(Math.sin(camYaw) * c0, Math.sin(pt), Math.cos(camYaw) * c0);
    _cw.copy(tgt).addScaledVector(dir, wantD);
    const c = world.viewBlock(tgt, _cw);
    if (c > bestClear + 0.05) { bestClear = c; bestLift = lift; }
    if (c > 0.92) break;
  }
  liftS = damp(liftS, bestLift, bestLift > liftS ? 9 : 2.5, dt);
  const pitch = Math.min(1.45, camPitch + sleepy * 0.25 + liftS);
  const cp = Math.cos(pitch);
  dir.set(Math.sin(camYaw) * cp, Math.sin(pitch), Math.cos(camYaw) * cp);
  _cw.copy(tgt).addScaledVector(dir, wantD);
  const clearD = Math.max(0.45 + liftS * 0.9, wantD * world.viewBlock(tgt, _cw) - 0.12);
  curDist = clearD < curDist ? damp(curDist, clearD, 14, dt) : damp(curDist, Math.min(wantD, clearD), 2.5, dt);
  if (dbg.every) { liftS = bestLift; curDist = Math.min(wantD, clearD); }
  camera.position.copy(tgt).addScaledVector(dir, curDist);
  if (shake > 0.001) { camera.position.x += (Math.random() - 0.5) * shake; camera.position.y += (Math.random() - 0.5) * shake; shake *= Math.exp(-9 * dt); }
  if (camera.position.y < 0.12) camera.position.y = 0.12;
  camera.lookAt(tgt);
  world.camFade(tgt, camera.position, dt);

  game.frame(dt, t, state === 'play');
  if (!dbg.every) R.adapt(dt);
  R.render(t, game.fade);
}

setState('menu');
ui.loading(1, '');
requestAnimationFrame(frame);

window.__game = { cat, world, props, fx, game, input, camera, scene, R, setState, step, dbg, THREE, sfx,
  get state() { return state; }, set camYaw(v) { camYaw = v; }, get camYaw() { return camYaw; }, set camPitch(v) { camPitch = v; }, set camDist(v) { camDist = v; } };
