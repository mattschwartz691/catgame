// The house: baked-GI static scene (art/house.py), collision queries, wall fading, lighting.
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/addons/GLTFLoader.js';
import { KTX2Loader } from '../vendor/addons/KTX2Loader.js';
import { MeshoptDecoder } from '../vendor/addons/meshopt_decoder.module.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const STEP = 0.06;

const STOREY = 2.9;
const AREA_KEYS = ['colliders', 'props', 'scratch', 'zones', 'lights', 'windows', 'items', 'treats'];

function loaders(renderer, onProgress, floorBytes) {
  const loader = new GLTFLoader();
  const ktx = loaders.ktx || (loaders.ktx = new KTX2Loader().setTranscoderPath('vendor/addons/basis/').detectSupport(renderer));
  loader.setKTX2Loader(ktx); loader.setMeshoptDecoder(MeshoptDecoder);
  const seen = new Map();
  const tick = (url, e) => { seen.set(url, [e.loaded, e.total || e.loaded]); let l = 0, t = 0; for (const [a, b] of seen.values()) { l += a; t += b; } onProgress(l, Math.max(t, floorBytes)); };
  const glb = url => new Promise((res, rej) => loader.load(url, res, e => tick(url, e), rej));
  const tex = url => new Promise((res, rej) => new THREE.TextureLoader().load(url, res, undefined, rej));
  const json = url => fetch(url).then(r => r.json());
  const area = async (base, half) => {
    const data = await json(base + 'house.json');
    const big = data.lightmap.res > 2048;
    const [g, lightmap] = await Promise.all([glb(base + 'house.glb'), tex(base + (big && half ? 'lightmap_half.webp' : 'lightmap.webp'))]);
    lightmap.flipY = false; lightmap.colorSpace = THREE.SRGBColorSpace; lightmap.channel = 1;
    lightmap.generateMipmaps = false; lightmap.minFilter = THREE.LinearFilter;
    return { data, scene: g.scene, lightmap };
  };
  return { glb, json, area };
}

// What the game needs to start: the first house, the street outside and the knockable props.
export async function loadWorld(renderer, onProgress = () => {}) {
  const { glb, json, area } = loaders(renderer, onProgress, 20e6);
  const [home, street, streetData, props, propInfo, manifest] = await Promise.all([
    area('assets/house/'), glb('assets/street/street.glb'), json('assets/street/street.json'),
    glb('assets/house/props.glb'), json('assets/house/props.json'), json('assets/manifest.json').catch(() => ({})),
  ]);
  const data = { ...home.data };       // sun, spawn, wall height, vacuum route come from the first house
  for (const k of AREA_KEYS) data[k] = [].concat(home.data[k] || [], streetData[k] || []);
  data.outer = streetData.outer; data.manifest = manifest;
  return { data, areas: [home], street: street.scene, props: props.scene, propInfo };
}
// The big house down the street arrives in the background, once play has begun.
export async function loadMore(renderer, opts = {}) {
  const { area } = loaders(renderer, () => {}, 1);
  return [await area('assets/house2/', opts.half)];
}

export class World {
  constructor(scene, assets, opts = {}) {
    this.scene = scene; this.data = assets.data;
    const d = assets.data, o = d.outer;
    this.bounds = { x0: o[0], x1: o[1], z0: o[2], z1: o[3] };
    this.H = d.wallH;
    this.boxes = [];
    this.addBoxes(d.colliders);
    this.movers = [];                // moving platforms (robot vacuum)
    this.fades = new Map();          // key -> { mats: [], op, hit }
    this.sunDir = new THREE.Vector3(...d.sun.dir).normalize();
    this.areas = []; this.pits = [];
    this.clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6);      // hides the storeys above the cat in a multi-storey house
    this.cut = 1e6;
    this.site = d.site || 'home';    // which house the cat is inside (null = outdoors)
    this.outW = 0;                   // 0 indoors .. 1 outdoors, eased
    this.street = assets.street;
    this.dress(assets.street, null, 0, null); this.scene.add(assets.street);
    this.glassMat = new THREE.MeshPhysicalMaterial({ color: 0xcfe6f2, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.16, envMapIntensity: 1.6, depthWrite: false });
    this.roofMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide });
    for (const a of assets.areas) this.addArea(a, true);
    this.setupLights(opts);
  }

  addBoxes(list) {
    for (const c of list) this.boxes.push({
      minX: c.b[0], maxX: c.b[1], minY: c.b[2], maxY: c.b[3], minZ: c.b[4], maxZ: c.b[5],
      cam: !!c.cam, fade: c.fade || null, spot: c.spot || null, step: !!c.step, slab: !!c.slab,
    });
  }
  floorY(y) { return Math.floor((y + 0.75) / STOREY) * STOREY; }
  ceilY(y) { return this.floorY(y) + this.H; }
  baseY(x, z) { for (const p of this.pits) if (x > p[0] && x < p[1] && z > p[2] && z < p[3]) return p[4]; return 0; }

  // ------------------------------------------------------------ static scene + materials
  fadeMat(key, m, clip) {
    const c = m.clone(); if (clip) c.clippingPlanes = [this.clip];
    let f = this.fades.get(key); if (!f) { f = { mats: [], op: 1, hit: false }; this.fades.set(key, f); }
    f.mats.push(c); return c;
  }
  dress(root, lm, lmI, area) {
    const clip = area && area.multi, fadeY = (area && area.fadeY) || {};
    root.traverse(o => {
      if (!o.isMesh) return;
      let key = null, lv = 0;
      for (let p = o; p; p = p.parent) {
        if (!p.name) continue;
        if (p.name.startsWith('fade_')) { key = p.name.slice(5); lv = fadeY[key] || 0; break; }
        if (p.name.startsWith('static_')) { lv = (+p.name.split('_')[1] || 0) / 100; break; }
      }
      if (area) { o.userData.lv = lv; area.meshes.push(o); }
      const m = o.material, ext = !lm || m.name.startsWith('ext_');
      o.castShadow = true; o.receiveShadow = true;
      if (!m.userData.dressed) {
        m.userData.dressed = true;
        if (clip) m.clippingPlanes = [this.clip];
        if (!ext) {
          m.lightMap = lm; m.lightMapIntensity = lmI;
          m.envMapIntensity = 0.3;
          if (m.name.startsWith('fl_')) { m.roughnessMap = null; m.metalnessMap = null; m.roughness = m.name === 'fl_parquet' ? 0.5 : 0.62; m.metalness = 0; }
          if (m.emissiveMap || (m.emissive && (m.emissive.r + m.emissive.g + m.emissive.b) > 0)) m.emissiveIntensity = Math.min(m.emissiveIntensity, 3);
        } else m.envMapIntensity = 2.2;
        // flat things lying on other flat things (rugs, paths, road markings) win the depth test cleanly
        if (/^(rug_|ext_walk|ext_road|ext_line|ext_drive|ext_brickpath|ext_path|ext_deck)/.test(m.name)) { m.polygonOffset = true; m.polygonOffsetFactor = m.name.startsWith('ext_line') || m.name.startsWith('rug_') ? -4 : -2; m.polygonOffsetUnits = -4; }
        if (m.transparent || m.alphaTest > 0 || m.name.includes('leaf') || m.name.includes('plant')) { m.alphaTest = Math.max(m.alphaTest, 0.4); m.transparent = false; m.side = THREE.DoubleSide; }
      }
      if (key) o.material = this.fadeMat(key, m, clip);
      if (/^ext_(grass|road|walk|drive|line|brickpath)/.test(m.name)) o.castShadow = false;
    });
  }

  // A house: lightmapped rooms, its colliders, window glass, roofs. first = the one we start in (its data is already merged).
  addArea(a, first = false) {
    const d = a.data, levels = d.levels && d.levels.length ? d.levels : [{ y: 0, v: d.probes.v }];
    const area = { root: a.scene, site: d.site || 'home', bounds: d.bounds, roofs: d.roofs || [d.bounds], probes: d.probes, levels, multi: levels.length > 1,
      fadeY: d.fadeY || {}, meshes: [], shell: null, shellOp: 1, shellMats: [] };
    this.areas.push(area);
    if (!first) { this.addBoxes(d.colliders); for (const k of AREA_KEYS) this.data[k].push(...(d[k] || [])); }
    for (const p of d.pits || []) this.pits.push([p[0], p[1], p[2], p[3], d.pitY]);
    this.dress(a.scene, a.lightmap, d.lightmap.max * Math.PI * 0.82, area); this.scene.add(a.scene);
    // roofs and upper storeys as seen from outside; lifted off while the cat is indoors
    const sh = this.street.getObjectByName('shell_' + area.site);
    if (sh) {
      area.shell = sh; const cache = new Map();
      sh.traverse(o => { if (!o.isMesh) return; let c = cache.get(o.material); if (!c) { c = o.material.clone(); cache.set(o.material, c); area.shellMats.push(c); } o.material = c; });
    }
    for (const w of d.windows) {
      const mat = w.fade ? this.fadeMat(w.fade, this.glassMat, area.multi) : this.glassMat;
      const g = new THREE.Mesh(new THREE.PlaneGeometry(w.a[1] - w.a[0], w.y[1] - w.y[0]), mat);
      const c = (w.a[0] + w.a[1]) / 2, y = (w.y[0] + w.y[1]) / 2;
      if (w.axis === 'x') { g.position.set(w.at, y, c); g.rotation.y = Math.PI / 2; } else g.position.set(c, y, w.at);
      g.material.side = THREE.DoubleSide; g.renderOrder = 5;
      g.userData.lv = this.floorY(w.y[0]); area.meshes.push(g);
      this.scene.add(g);
    }
    // invisible ceilings: keep the sun out except through the windows
    for (const lv of levels) for (const b of area.roofs) {
      const roof = new THREE.Mesh(new THREE.PlaneGeometry(b[1] - b[0] + 0.5, b[3] - b[2] + 0.5), this.roofMat);
      roof.rotation.x = -Math.PI / 2; roof.position.set((b[0] + b[1]) / 2, lv.y + this.H + 0.02, (b[2] + b[3]) / 2); roof.castShadow = true;
      this.scene.add(roof);
    }
    this.shadowKey = null; this.cutKey = null;
    return area;
  }

  setupLights(opts) {
    const d = this.data;
    const sun = this.sun = new THREE.DirectionalLight(new THREE.Color(...d.sun.color), d.sun.intensity);
    sun.castShadow = true;
    const s = opts.shadowSize || 2048;
    sun.shadow.mapSize.set(s, s);
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.025; sun.shadow.radius = 2.2;
    this.scene.add(sun, sun.target);
    this.shadowKey = null;
    this.update({ x: d.spawn.x, y: 0, z: d.spawn.z }, 1);
  }

  // Fit the sun's shadow frustum to a box (x0, x1, z0, z1, y0, y1) as seen from the sun.
  fitShadow(x0, x1, z0, z1, y0, y1) {
    const sun = this.sun, cam = sun.shadow.camera, c = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    sun.position.copy(c).addScaledVector(this.sunDir, 60); sun.target.position.copy(c);
    sun.updateMatrixWorld(); sun.target.updateMatrixWorld();
    const view = new THREE.Matrix4().lookAt(sun.position, c, new THREE.Vector3(0, 1, 0)).setPosition(sun.position).invert();
    let l = 1e9, r = -1e9, t = -1e9, bt = 1e9, n = 1e9, f = -1e9; const v = new THREE.Vector3();
    for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) {
      v.set(x, y, z).applyMatrix4(view);
      l = Math.min(l, v.x); r = Math.max(r, v.x); bt = Math.min(bt, v.y); t = Math.max(t, v.y); n = Math.min(n, -v.z); f = Math.max(f, -v.z);
    }
    Object.assign(cam, { left: l, right: r, top: t, bottom: bt, near: Math.max(0.5, n - 30), far: f + 1 });
    cam.updateProjectionMatrix();
  }

  inRoofs(a, x, z, m = 0) { for (const b of a.roofs) if (x > b[0] - m && x < b[1] + m && z > b[2] - m && z < b[3] + m) return true; return false; }

  // Called every frame with the cat's position: which house and storey are we in, roofs on or off, where the sun's shadows are focused.
  update(pos, dt) {
    let site = null;
    for (const a of this.areas) if (this.inRoofs(a, pos.x, pos.z, a.site === this.site ? 0.12 : -0.12)) site = a.site;
    this.site = site;
    const fl = this.floorY(pos.y);
    this.outW += ((site ? 0 : 1) - this.outW) * (1 - Math.exp(-3 * dt));
    for (const a of this.areas) {
      if (!a.shell) continue;
      const target = a.site === site ? 0 : 1;
      if (a.shellOp === target) continue;
      a.shellOp += Math.sign(target - a.shellOp) * Math.min(Math.abs(target - a.shellOp), dt * 2.2);
      a.shell.visible = a.shellOp > 0.01;
      const k = a.shellOp * a.shellOp * (3 - 2 * a.shellOp);
      for (const m of a.shellMats) { m.transparent = k < 0.995; m.opacity = k; m.depthWrite = k > 0.5; }
    }
    // storeys above the cat are cut away (from outside you only ever see ground floors under their roofs)
    const cur = this.areas.find(q => q.site === site);
    const cut = (cur && cur.multi ? fl : 0) + this.H + 0.02;
    this.cut = cut; this.clip.constant = cut;
    const ck = site + ':' + cut;
    if (ck !== this.cutKey) {
      this.cutKey = ck;
      for (const a of this.areas) for (const o of a.meshes) o.visible = o.userData.lv < cut - 1;
    }
    // a house far down the street does not need drawing
    for (const a of this.areas) {
      const b = a.bounds, dx = Math.max(b[0] - pos.x, 0, pos.x - b[1]), dz = Math.max(b[2] - pos.z, 0, pos.z - b[3]);
      a.root.visible = a.site === site || (!site && dx * dx + dz * dz < 26 * 26);
    }
    const key = site ? site + fl : ('o' + Math.round(pos.x / 7) + ':' + Math.round(pos.z / 7));
    if (key !== this.shadowKey) {
      this.shadowKey = key;
      if (cur) this.fitShadow(cur.bounds[0] - 1, cur.bounds[1] + 1, cur.bounds[2] - 1, cur.bounds[3] + 1, fl, fl + this.H + 0.3);
      else { const cx = Math.round(pos.x / 7) * 7, cz = Math.round(pos.z / 7) * 7; this.fitShadow(cx - 17, cx + 17, cz - 17, cz + 17, 0, 3); }
    }
  }

  // ------------------------------------------------------------ queries
  resolveXZ(pos, r0, h, vel, airborne, wx = 0, wz = 0) {
    let assist = 0;
    for (const b of this.boxes) {
      if (pos.y >= b.maxY - STEP || pos.y + h <= b.minY) continue;
      const r = b.step ? 0.03 : r0;          // stair treads: only the next one up may stop you, not the ones your whiskers reach
      const cx = clamp(pos.x, b.minX, b.maxX), cz = clamp(pos.z, b.minZ, b.maxZ);
      const dx = pos.x - cx, dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      let nx, nz;
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2); nx = dx / d; nz = dz / d;
        pos.x += nx * (r - d); pos.z += nz * (r - d);
      } else {
        const l = pos.x - b.minX, rr = b.maxX - pos.x, n = pos.z - b.minZ, f = b.maxZ - pos.z, m = Math.min(l, rr, n, f);
        nx = 0; nz = 0;
        if (m === l) { nx = -1; pos.x = b.minX - r; } else if (m === rr) { nx = 1; pos.x = b.maxX + r; }
        else if (m === n) { nz = -1; pos.z = b.minZ - r; } else { nz = 1; pos.z = b.maxZ + r; }
      }
      const vn = vel.x * nx + vel.z * nz;
      if (airborne && !b.step && b.maxY - pos.y < 0.34 && b.maxY + h <= this.ceilY(pos.y) && (vn < -0.25 || wx * nx + wz * nz < -0.3)) assist = 1;   // only onto things there is room to stand on
      if (vn < 0) { vel.x -= vn * nx; vel.z -= vn * nz; }
    }
    const bd = this.bounds;
    pos.x = clamp(pos.x, bd.x0, bd.x1); pos.z = clamp(pos.z, bd.z0, bd.z1);
    return assist;
  }
  groundAt(x, z, maxY) {
    let y = this.baseY(x, z), box = null;
    if (y > maxY) y = -1e3;
    const m = 0.06;
    for (const b of this.boxes) {
      if (b.maxY > maxY || b.maxY <= y) continue;
      if (x < b.minX - m || x > b.maxX + m || z < b.minZ - m || z > b.maxZ + m) continue;
      y = b.maxY; box = b;
    }
    return { y, box };
  }
  ceilingAt(x, z, fromY) {
    let y = Infinity;
    for (const b of this.boxes) {
      if (b.minY < fromY - 0.05 || b.minY >= y) continue;
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
      y = b.minY;
    }
    return y;
  }
  addBox(b) { this.boxes.push(b); return b; }

  // Baked ambient light level at a spot (0..~1.5), for lighting dynamic objects.
  ambientAt(x, z, y = 0) {
    const a = this.areas.find(q => this.inRoofs(q, x, z));
    if (!a) return 0.6;                                     // open sky
    const p = a.probes, b = a.bounds, fl = this.floorY(y);
    const lv = a.levels.find(q => Math.abs(q.y - fl) < 0.1) || a.levels[0], v = lv.v, w = p.nx;
    const fx = clamp((x - b[0]) / p.cell - 0.5, 0, p.nx - 1.001), fz = clamp((z - b[2]) / p.cell - 0.5, 0, p.nz - 1.001);
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
    const c0 = v[iz * w + ix], c = v[iz * w + ix + 1], e = v[(iz + 1) * w + ix], g = v[(iz + 1) * w + ix + 1];
    return (c0 * (1 - tx) + c * tx) * (1 - tz) + (e * (1 - tx) + g * tx) * tz;
  }
  // Is this point inside something solid? Returns the box (used to keep the tail out of walls).
  solidAt(x, y, z) {
    for (const b of this.boxes) {
      if (b.step || b.slab || b.mover || b.maxY - b.minY < 0.3) continue;
      if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && y > b.minY && y < b.maxY) return b;
    }
    return null;
  }

  // Distance along a->b (0..1) at which furniture first blocks the view; fading walls are ignored.
  viewBlock(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z; let best = 1;
    for (const bx of this.boxes) {
      if (bx.fade || bx.mover || bx.slab || bx.step || bx.maxY - bx.minY < 0.12) continue;
      let t0 = 0, t1 = best, hit = true;
      for (let i = 0; i < 3; i++) {
        const o = i === 0 ? a.x : i === 1 ? a.y : a.z, d = i === 0 ? dx : i === 1 ? dy : dz;
        const mn = (i === 0 ? bx.minX : i === 1 ? bx.minY : bx.minZ) - 0.06, mx = (i === 0 ? bx.maxX : i === 1 ? bx.maxY : bx.maxZ) + 0.06;
        if (Math.abs(d) < 1e-9) { if (o < mn || o > mx) { hit = false; break; } continue; }
        let ta = (mn - o) / d, tb = (mx - o) / d;
        if (ta > tb) { const s = ta; ta = tb; tb = s; }
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        if (t0 > t1) { hit = false; break; }
      }
      if (hit && t0 > 0.02 && t0 < best) best = t0;
    }
    return best;
  }

  // True when the straight line a->b is not blocked by a wall or tall furniture.
  segClear(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    for (const bx of this.boxes) {
      if (!bx.cam || bx.slab) continue;
      let t0 = 0, t1 = 1, hit = true;
      for (let i = 0; i < 3; i++) {
        const o = i === 0 ? a.x : i === 1 ? a.y : a.z, d = i === 0 ? dx : i === 1 ? dy : dz;
        const mn = i === 0 ? bx.minX : i === 1 ? bx.minY : bx.minZ, mx = i === 0 ? bx.maxX : i === 1 ? bx.maxY : bx.maxZ;
        if (Math.abs(d) < 1e-9) { if (o < mn || o > mx) { hit = false; break; } continue; }
        let ta = (mn - o) / d, tb = (mx - o) / d;
        if (ta > tb) { const s = ta; ta = tb; tb = s; }
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        if (t0 > t1) { hit = false; break; }
      }
      if (hit) return false;
    }
    return true;
  }

  // Fade walls / tall furniture between the camera (b) and the subject (a).
  camFade(a, b, dt) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, pad = 0.12;
    for (const f of this.fades.values()) f.hit = false;
    for (const bx of this.boxes) {
      if (!bx.cam || !bx.fade) continue;
      const f = this.fades.get(bx.fade); if (!f || f.hit) continue;
      let t0 = 0, t1 = 1, hit = true;
      for (let i = 0; i < 3; i++) {
        const o = i === 0 ? a.x : i === 1 ? a.y : a.z, d = i === 0 ? dx : i === 1 ? dy : dz;
        const mn = i === 0 ? bx.minX - pad : i === 1 ? bx.minY : bx.minZ - pad, mx = i === 0 ? bx.maxX + pad : i === 1 ? bx.maxY : bx.maxZ + pad;
        if (Math.abs(d) < 1e-9) { if (o < mn || o > mx) { hit = false; break; } continue; }
        let ta = (mn - o) / d, tb = (mx - o) / d;
        if (ta > tb) { const s = ta; ta = tb; tb = s; }
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        if (t0 > t1) { hit = false; break; }
      }
      if (hit) f.hit = true;
    }
    for (const f of this.fades.values()) {
      const target = f.hit ? 0.0 : 1;
      if (Math.abs(f.op - target) < 0.004) { if (f.op !== target) { f.op = target; this.applyFade(f); } continue; }
      f.op += (target - f.op) * (1 - Math.exp(-9 * dt));
      this.applyFade(f);
    }
  }
  applyFade(f) {
    for (const m of f.mats) {
      const base = m.userData.baseOp ?? (m.userData.baseOp = m.opacity);
      const solid = f.op > 0.995;
      if (m.userData.baseOp < 1) { m.opacity = base * f.op; continue; }   // glass
      m.transparent = !solid; m.opacity = f.op; m.depthWrite = f.op > 0.5;
    }
  }
}
