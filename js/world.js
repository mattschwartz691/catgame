// The house: baked-GI static scene (art/house.py), collision queries, wall fading, lighting.
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/addons/GLTFLoader.js';
import { KTX2Loader } from '../vendor/addons/KTX2Loader.js';
import { MeshoptDecoder } from '../vendor/addons/meshopt_decoder.module.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const STEP = 0.06;

// Everything static: the two houses (each with its own baked lightmap), the street between them, and the knockable props.
export async function loadWorld(renderer, onProgress = () => {}) {
  const loader = new GLTFLoader();
  const ktx = new KTX2Loader().setTranscoderPath('vendor/addons/basis/').detectSupport(renderer);
  loader.setKTX2Loader(ktx); loader.setMeshoptDecoder(MeshoptDecoder);
  const seen = new Map();
  const tick = (url, e) => { seen.set(url, [e.loaded, e.total || e.loaded]); let l = 0, t = 0; for (const [a, b] of seen.values()) { l += a; t += b; } onProgress(l, Math.max(t, 30e6)); };
  const glb = url => new Promise((res, rej) => loader.load(url, res, e => tick(url, e), rej));
  const tex = url => new Promise((res, rej) => new THREE.TextureLoader().load(url, res, undefined, rej));
  const json = url => fetch(url).then(r => r.json());
  const area = async base => {
    const [data, g, lightmap] = await Promise.all([json(base + 'house.json'), glb(base + 'house.glb'), tex(base + 'lightmap.webp')]);
    lightmap.flipY = false; lightmap.colorSpace = THREE.SRGBColorSpace; lightmap.channel = 1;
    lightmap.generateMipmaps = false; lightmap.minFilter = THREE.LinearFilter;
    return { data, scene: g.scene, lightmap };
  };
  const [home, colonial, street, streetData, props, propInfo] = await Promise.all([
    area('assets/house/'), area('assets/house2/'), glb('assets/street/street.glb'), json('assets/street/street.json'),
    glb('assets/house/props.glb'), json('assets/house/props.json'),
  ]);
  const areas = [home, colonial];
  const data = { ...home.data };       // sun, spawn, wall height, vacuum route come from the first house
  for (const k of ['colliders', 'props', 'scratch', 'zones', 'lights', 'windows', 'items', 'treats'])
    data[k] = [].concat(...areas.map(a => a.data[k] || []), streetData[k] || []);
  data.outer = streetData.outer;
  return { data, areas, street: street.scene, props: props.scene, propInfo };
}

export class World {
  constructor(scene, assets, opts = {}) {
    this.scene = scene; this.data = assets.data;
    const d = assets.data, o = d.outer;
    this.bounds = { x0: o[0], x1: o[1], z0: o[2], z1: o[3] };
    this.H = d.wallH;
    this.boxes = d.colliders.map(c => ({
      minX: c.b[0], maxX: c.b[1], minY: c.b[2], maxY: c.b[3], minZ: c.b[4], maxZ: c.b[5],
      cam: !!c.cam, fade: c.fade || null, spot: c.spot || null, step: !!c.step,
    }));
    this.movers = [];                // moving platforms (robot vacuum)
    this.fades = new Map();          // key -> { mats: [], op, hit }
    this.sunDir = new THREE.Vector3(...d.sun.dir).normalize();
    this.areas = assets.areas.map(a => ({ root: a.scene, site: a.data.site || 'home', bounds: a.data.bounds, roofs: a.data.roofs || [a.data.bounds], probes: a.data.probes, shell: null, shellOp: 1, shellMats: [] }));
    this.site = this.areas[0].site;  // which house the cat is inside (null = outdoors)
    this.outW = 0;                   // 0 indoors .. 1 outdoors, eased
    this.setupScene(assets, opts);
    this.setupLights(opts);
  }

  // ------------------------------------------------------------ static scene + materials
  setupScene(assets, opts) {
    const fadeMat = (key, m) => {
      const c = m.clone();
      let f = this.fades.get(key); if (!f) { f = { mats: [], op: 1, hit: false }; this.fades.set(key, f); }
      f.mats.push(c); return c;
    };
    const dress = (root, lm, lmI) => root.traverse(o => {
      if (!o.isMesh) return;
      let key = null;
      for (let p = o; p; p = p.parent) if (p.name && p.name.startsWith('fade_')) { key = p.name.slice(5); break; }
      const m = o.material, ext = !lm || m.name.startsWith('ext_');
      o.castShadow = true; o.receiveShadow = true;
      if (!ext) {
        if (!m.userData.lm) {
          m.userData.lm = true;
          m.lightMap = lm; m.lightMapIntensity = lmI;
          m.envMapIntensity = 0.3;
          if (m.name.startsWith('fl_')) { m.roughnessMap = null; m.metalnessMap = null; m.roughness = m.name === 'fl_parquet' ? 0.5 : 0.62; m.metalness = 0; }
          if (m.emissiveMap || (m.emissive && (m.emissive.r + m.emissive.g + m.emissive.b) > 0)) m.emissiveIntensity = Math.min(m.emissiveIntensity, 3);
        }
        if (key) o.material = fadeMat(key, m);
      } else { m.envMapIntensity = 2.2; if (key) o.material = fadeMat(key, m); }
      if (m.name.startsWith('ext_grass') || m.name.startsWith('ext_road') || m.name.startsWith('ext_walk') || m.name.startsWith('ext_drive')) { o.castShadow = false; }
      if (m.transparent || m.alphaTest > 0 || m.name.includes('leaf') || m.name.includes('plant')) { m.alphaTest = Math.max(m.alphaTest, 0.4); m.transparent = false; m.side = THREE.DoubleSide; }
    });
    assets.areas.forEach(a => { dress(a.scene, a.lightmap, a.data.lightmap.max * Math.PI * 0.82); this.scene.add(a.scene); });
    dress(assets.street, null, 0); this.scene.add(assets.street);
    // roofs and upper storeys: shown from outside, lifted off while the cat is indoors
    for (const a of this.areas) {
      const sh = assets.street.getObjectByName('shell_' + a.site); if (!sh) continue;
      a.shell = sh; const cache = new Map();
      sh.traverse(o => { if (!o.isMesh) return; let c = cache.get(o.material); if (!c) { c = o.material.clone(); cache.set(o.material, c); a.shellMats.push(c); } o.material = c; });
    }

    // window glass
    const glass = new THREE.MeshPhysicalMaterial({ color: 0xcfe6f2, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.16, envMapIntensity: 1.6, depthWrite: false });
    for (const w of this.data.windows) {
      const g = new THREE.Mesh(new THREE.PlaneGeometry(w.a[1] - w.a[0], w.y[1] - w.y[0]), w.fade ? fadeMat(w.fade, glass) : glass);
      const c = (w.a[0] + w.a[1]) / 2, y = (w.y[0] + w.y[1]) / 2;
      if (w.axis === 'x') { g.position.set(w.at, y, c); g.rotation.y = Math.PI / 2; } else g.position.set(c, y, w.at);
      g.material.side = THREE.DoubleSide; g.renderOrder = 5;
      this.scene.add(g);
    }
    // invisible roofs: keep the sun out except through the windows
    const roofMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide });
    for (const a of this.areas) for (const b of a.roofs) {
      const roof = new THREE.Mesh(new THREE.PlaneGeometry(b[1] - b[0] + 0.5, b[3] - b[2] + 0.5), roofMat);
      roof.rotation.x = -Math.PI / 2; roof.position.set((b[0] + b[1]) / 2, this.H + 0.02, (b[2] + b[3]) / 2); roof.castShadow = true;
      this.scene.add(roof);
    }
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

  // Fit the sun's shadow frustum to a box (x0, x1, z0, z1, height) as seen from the sun.
  fitShadow(x0, x1, z0, z1, h) {
    const sun = this.sun, cam = sun.shadow.camera, c = new THREE.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2);
    sun.position.copy(c).addScaledVector(this.sunDir, 60); sun.target.position.copy(c);
    sun.updateMatrixWorld(); sun.target.updateMatrixWorld();
    const view = new THREE.Matrix4().lookAt(sun.position, c, new THREE.Vector3(0, 1, 0)).setPosition(sun.position).invert();
    let l = 1e9, r = -1e9, t = -1e9, bt = 1e9, n = 1e9, f = -1e9; const v = new THREE.Vector3();
    for (const x of [x0, x1]) for (const y of [0, h]) for (const z of [z0, z1]) {
      v.set(x, y, z).applyMatrix4(view);
      l = Math.min(l, v.x); r = Math.max(r, v.x); bt = Math.min(bt, v.y); t = Math.max(t, v.y); n = Math.min(n, -v.z); f = Math.max(f, -v.z);
    }
    Object.assign(cam, { left: l, right: r, top: t, bottom: bt, near: Math.max(0.5, n - 30), far: f + 1 });
    cam.updateProjectionMatrix();
  }

  inRoofs(a, x, z, m = 0) { for (const b of a.roofs) if (x > b[0] - m && x < b[1] + m && z > b[2] - m && z < b[3] + m) return true; return false; }

  // Called every frame with the cat's position: which house are we in, roofs on or off, where the sun's shadows are focused.
  update(pos, dt) {
    let site = null;
    for (const a of this.areas) if (this.inRoofs(a, pos.x, pos.z, a.site === this.site ? 0.12 : -0.12)) site = a.site;
    this.site = site;
    this.outW += ((site ? 0 : 1) - this.outW) * (1 - Math.exp(-3 * dt));
    for (const a of this.areas) {
      if (!a.shell) continue;
      const target = a.site === site ? 0 : 1;
      if (a.shellOp === target) continue;
      a.shellOp += Math.sign(target - a.shellOp) * Math.min(Math.abs(target - a.shellOp), dt * 3.5);
      a.shell.visible = a.shellOp > 0.01;
      for (const m of a.shellMats) { m.transparent = a.shellOp < 0.995; m.opacity = a.shellOp; m.depthWrite = a.shellOp > 0.5; }
    }
    // a house far down the street does not need drawing
    for (const a of this.areas) {
      const b = a.bounds, dx = Math.max(b[0] - pos.x, 0, pos.x - b[1]), dz = Math.max(b[2] - pos.z, 0, pos.z - b[3]);
      a.root.visible = a.site === site || (!site && dx * dx + dz * dz < 26 * 26);
    }
    const key = site || ('o' + Math.round(pos.x / 7) + ':' + Math.round(pos.z / 7));
    if (key !== this.shadowKey) {
      this.shadowKey = key;
      const a = this.areas.find(q => q.site === site);
      if (a) this.fitShadow(a.bounds[0] - 1, a.bounds[1] + 1, a.bounds[2] - 1, a.bounds[3] + 1, this.H + 0.3);
      else { const cx = Math.round(pos.x / 7) * 7, cz = Math.round(pos.z / 7) * 7; this.fitShadow(cx - 17, cx + 17, cz - 17, cz + 17, 3); }
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
      if (airborne && b.maxY - pos.y < 0.34 && b.maxY + h <= this.H && (vn < -0.25 || wx * nx + wz * nz < -0.3)) assist = 1;   // only onto things there is room to stand on
      if (vn < 0) { vel.x -= vn * nx; vel.z -= vn * nz; }
    }
    const bd = this.bounds;
    pos.x = clamp(pos.x, bd.x0, bd.x1); pos.z = clamp(pos.z, bd.z0, bd.z1);
    return assist;
  }
  groundAt(x, z, maxY) {
    let y = 0, box = null;
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
  ambientAt(x, z) {
    const a = this.areas.find(q => this.inRoofs(q, x, z));
    if (!a) return 0.6;                                     // open sky
    const p = a.probes, b = a.bounds;
    const fx = clamp((x - b[0]) / p.cell - 0.5, 0, p.nx - 1.001), fz = clamp((z - b[2]) / p.cell - 0.5, 0, p.nz - 1.001);
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz, v = p.v, w = p.nx;
    const c0 = v[iz * w + ix], c = v[iz * w + ix + 1], e = v[(iz + 1) * w + ix], g = v[(iz + 1) * w + ix + 1];
    return (c0 * (1 - tx) + c * tx) * (1 - tz) + (e * (1 - tx) + g * tx) * tz;
  }

  // Distance along a->b (0..1) at which furniture first blocks the view; fading walls are ignored.
  viewBlock(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z; let best = 1;
    for (const bx of this.boxes) {
      if (bx.fade || bx.mover || bx.maxY - bx.minY < 0.12) continue;
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
      if (!bx.cam) continue;
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
