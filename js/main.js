import * as THREE from 'three';
import { Cat, COATS, angDiff, CAT_S } from './cat.js';
import { loadCatAssets } from './catmodel.js';
import { World, loadWorld, loadMore } from './world.js';
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
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 130);
scene.environment = R.envMap();
scene.environmentIntensity = 0.5;

ui.loading(0.05, 'Fluffing the cat…');
const [catAssets, houseAssets] = await Promise.all([
  loadCatAssets(),
  loadWorld(R.r, (l, t) => { ui.loading(0.1 + 0.75 * Math.min(1, l / t), 'Tidying the house (not for long)…'); }),
]);
ui.loading(0.9, 'Hiding the treats…');

const world = new World(scene, houseAssets, { shadowSize: R.tier.shadow });
const props = new Props(scene, world, houseAssets);
const fx = new FX(scene, world);
let coatIdx = 0;
try { coatIdx = Math.max(0, COATS.findIndex(c => c.id === localStorage.getItem('coatId'))); } catch {}
const cat = new Cat(scene, catAssets, COATS[coatIdx]);
cat.model.setShells(R.tier.shells);
const sp = world.data.spawn;
cat.teleport(sp.x, 0, sp.z, sp.yaw);
const input = new Input(canvas);
const game = new Game({ scene, world, props, fx, cat, ui, input, camera });

// the second house is big: fetch it in the background and keep the garden gate shut until it is there
const gate = world.addBox({ minX: -16, maxX: 16, minY: 0, maxY: 2.6, minZ: 12.4, maxZ: 12.7, cam: false, fade: null, spot: null });
let gateTold = 0;
let moreStarted = false, moreDone;
const moreReady = new Promise(res => { moreDone = res; });
const startMore = () => { if (moreStarted) return; moreStarted = true; loadMore(R.r, { half: R.tierName !== 'high' }).then(list => {
  for (const a of list) { world.addArea(a); props.addProps(a.data.props || []); fx.addShafts(a.data.windows || []); game.addArea(a.data); }
  world.boxes.splice(world.boxes.indexOf(gate), 1);
  if (state === 'play') ui.toast('The coast is clear: off you go', 'find');
  moreDone(true);
}).catch(e => { console.warn('second house failed to load', e); world.boxes.splice(world.boxes.indexOf(gate), 1); moreDone(false); }); };
if (new URLSearchParams(location.search).has('all')) startMore();

// sky dome
let sky;
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
  sky = new THREE.Mesh(g, m); sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);
}
scene.fog = new THREE.Fog(0xdfe8f0, 45, 115);

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
  if (s === 'play') { introT = 1.3; camPitch = 0.34; game.onEnterPlay(); }
  else { camPitch = 0.16; cat.vel.set(0, 0, 0); camYaw = cat.yaw + 0.5; cat.stopAction(); game.onLeavePlay(); }
  resize();
}
function resize() {
  const w = window.innerWidth, h = window.innerHeight, portrait = h > w;
  camera.aspect = w / h;
  camera.fov = (portrait ? 62 : 48);
  camDist = state === 'menu' ? (portrait ? 1.45 : 1.2) : (portrait ? 2.2 : 1.9);
  if (state === 'menu') {
    if (h <= 480) camera.setViewOffset(w, h, w * 0.22, 0, w, h);
    else camera.setViewOffset(w, h, 0, h * (portrait ? 0.2 : 0.22), w, h);
  } else camera.clearViewOffset();
  camera.updateProjectionMatrix();
  R.resize();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 250));
document.addEventListener('visibilitychange', () => { if (document.hidden) { suspendAudio(); game.save(); } else resumeAudio(); });
window.addEventListener('pagehide', () => game.save());

ui.onPick = (i) => {
  initAudio();
  if (i !== coatIdx) { coatIdx = i; cat.setCoat(COATS[i]); try { localStorage.setItem('coatId', COATS[i].id); } catch {} }
  cat.squashV = 2.2; cat.meow('chirp');
};
ui.onPlay = () => { initAudio(); loops.ambience.start(); sfx.pop(); setState('play'); };
ui.onMenu = () => setState('menu');
ui.buildMenu(COATS, coatIdx);
const QUAL = ['auto', 'lowest', 'low', 'medium', 'high'];
let qual = 'auto'; try { qual = localStorage.getItem('quality') || 'auto'; } catch {}
game.qualityName = qual; game.optUI(); R.locked = qual !== 'auto';
ui.onQuality = () => {
  qual = QUAL[(QUAL.indexOf(qual) + 1) % QUAL.length];
  try { if (qual === 'auto') localStorage.removeItem('quality'); else localStorage.setItem('quality', qual); } catch {}
  R.locked = qual !== 'auto'; R.setTier(qual === 'auto' ? pickTier() : qual);
  game.qualityName = qual; game.optUI();
};
game.shakeCam = (a) => { shake = Math.max(shake, a); };

// ------------------------------------------------------------------ loop
const dir = new THREE.Vector3(), tgt = new THREE.Vector3(), _cw = new THREE.Vector3();
const ctl = { mx: 0, mz: 0, jump: false, jumpPressed: false, pawPressed: false, pawHeld: false, meowPressed: false };
let last = performance.now(), ambS = 0.5, liftS = 0, frameNo = 0, lookUp = 0;
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
    camYaw -= input.lookX * 0.0055; camPitch = clamp(camPitch + input.lookY * 0.0065, -0.75, 1.4);
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
  world.update(cat.pos, dbg.every ? 1 : dt);
  if (!moreStarted && state === 'play' && (!world.site || cat.pos.z > 3.5 && Math.abs(cat.pos.x - 0.4) < 1.2)) startMore();      // heading for the front door: fetch the neighbours
  if (world.boxes.includes(gate) && state === 'play' && cat.pos.z > 11.9 && now - gateTold > 9000) { gateTold = now; ui.toast('Not yet… (the neighbourhood is still unpacking)'); }
  ambS = damp(ambS, clamp(world.ambientAt(cat.pos.x, cat.pos.z, cat.pos.y) * 2.2 + 0.25, 0.3, 1.6), 4, dt);
  for (const s of cat.model.shells) s.material.envMapIntensity = ambS;

  // ---- camera
  const sleepy = cat.sleepW;
  if (dbg.every) camT.set(cat.pos.x, cat.pos.y + 0.28, cat.pos.z);
  camT.x = damp(camT.x, cat.pos.x, 12, dt); camT.z = damp(camT.z, cat.pos.z, 12, dt);
  camT.y = damp(camT.y, cat.pos.y + (state === 'menu' ? 0.23 : 0.28), 7, dt);
  fovKick = damp(fovKick, clamp((hs - 3.2) * 3, 0, 9) + (cat.pouncing ? 4 : 0), 5, dt);
  const baseFov = window.innerHeight > window.innerWidth ? 62 : 48;
  if (Math.abs(camera.fov - (baseFov + fovKick)) > 0.05) { camera.fov = baseFov + fovKick; camera.updateProjectionMatrix(); }
  tgt.copy(camT);
  // if furniture is in the way, look over it from higher up before moving in closer
  const wantD = camDist * (1 + sleepy * 0.12) * (1 + world.outW * 0.55);       // pull back for a wider view out of doors
  let bestLift = 0, bestClear = -1;
  for (let k = 0; k < 6; k++) {
    const lift = k * 0.2, pt = Math.min(1.45, Math.max(0.04, camPitch) + sleepy * 0.25 + lift), c0 = Math.cos(pt);
    dir.set(Math.sin(camYaw) * c0, Math.sin(pt), Math.cos(camYaw) * c0);
    _cw.copy(tgt).addScaledVector(dir, wantD);
    const c = world.viewBlock(tgt, _cw);
    if (c > bestClear + 0.08) { bestClear = c; bestLift = lift; }
    if (c > 0.9) break;
  }
  liftS = damp(liftS, bestLift, bestLift > liftS ? 8 : 2, dt);
  const pitch = Math.min(1.45, Math.max(0.04, camPitch) + sleepy * 0.25 + liftS);
  const cp = Math.cos(pitch);
  dir.set(Math.sin(camYaw) * cp, Math.sin(pitch), Math.cos(camYaw) * cp);
  _cw.copy(tgt).addScaledVector(dir, wantD);
  // never crowd the cat: past a point it is better to let the camera pass through furniture than to fill the screen with fur
  const clearD = Math.max(Math.min(wantD, 1.25), wantD * world.viewBlock(tgt, _cw) - 0.12);
  curDist = clearD < curDist ? damp(curDist, clearD, 10, dt) : damp(curDist, Math.min(wantD, clearD), 2.5, dt);
  if (dbg.every) { liftS = bestLift; curDist = Math.min(wantD, clearD); }
  camera.position.copy(tgt).addScaledVector(dir, curDist);
  if (shake > 0.001) { camera.position.x += (Math.random() - 0.5) * shake; camera.position.y += (Math.random() - 0.5) * shake; shake *= Math.exp(-9 * dt); }
  { const cf = Math.min(world.floorY(cat.pos.y), world.baseY(camera.position.x, camera.position.z)) + 0.12; if (camera.position.y < cf) camera.position.y = cf; }
  lookUp = damp(lookUp, Math.max(0, 0.04 - camPitch) * 2.6, 14, dt);          // tilting past level looks up, over the cat
  if (lookUp > 0.001) { _cw.copy(tgt); _cw.y += lookUp; camera.lookAt(_cw); } else camera.lookAt(tgt);
  sky.position.copy(camera.position);
  world.camFade(tgt, camera.position, dbg.every ? 1 : dt);

  // the sun does not move: on lighter tiers refresh its shadow map every other frame
  frameNo++; world.sun.shadow.autoUpdate = false; if (R.tierName === 'high' || frameNo % (R.tierName === 'lowest' ? 3 : 2) === 0) world.sun.shadow.needsUpdate = true;
  game.frame(dt, t, state === 'play');
  if (!dbg.every) R.adapt(dt);
  R.render(t, game.fade);
}

setState('menu');
ui.loading(1, '');
requestAnimationFrame(frame);

if (new URLSearchParams(location.search).get('bench')) setTimeout(() => { ui.onPlay(); import('./bench.js').then(m => m.runBench(window.__game)); }, 2500);

window.__game = { cat, world, props, fx, game, input, camera, scene, R, setState, step, dbg, THREE, sfx, moreReady,
  get state() { return state; }, set camYaw(v) { camYaw = v; }, get camYaw() { return camYaw; }, set camPitch(v) { camPitch = v; }, set camDist(v) { camDist = v; } };
