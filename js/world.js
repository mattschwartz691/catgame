// The house: baked-GI static scene (art/house.py), collision queries, wall fading, lighting.
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/addons/GLTFLoader.js';
import { KTX2Loader } from '../vendor/addons/KTX2Loader.js';
import { MeshoptDecoder } from '../vendor/addons/meshopt_decoder.module.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const STEP = 0.06;

export async function loadHouse(renderer, base = 'assets/house/', onProgress = () => {}) {
  const loader = new GLTFLoader();
  const ktx = new KTX2Loader().setTranscoderPath('vendor/addons/basis/').detectSupport(renderer);
  loader.setKTX2Loader(ktx); loader.setMeshoptDecoder(MeshoptDecoder);
  const glb = url => new Promise((res, rej) => loader.load(url, res, e => onProgress(url, e.loaded, e.total), rej));
  const tex = url => new Promise((res, rej) => new THREE.TextureLoader().load(url, res, undefined, rej));
  const [data, house, props, propInfo, lightmap] = await Promise.all([
    fetch(base + 'house.json').then(r => r.json()),
    glb(base + 'house.glb'),
    glb(base + 'props.glb'),
    fetch(base + 'props.json').then(r => r.json()),
    tex(base + 'lightmap.webp'),
  ]);
  lightmap.flipY = false; lightmap.colorSpace = THREE.SRGBColorSpace; lightmap.channel = 1;
  lightmap.generateMipmaps = false; lightmap.minFilter = THREE.LinearFilter;
  return { data, house: house.scene, props: props.scene, propInfo, lightmap };
}

export class World {
  constructor(scene, assets, opts = {}) {
    this.scene = scene; this.data = assets.data;
    const d = assets.data;
    this.bounds = { x0: d.bounds[0] + 0.26, x1: d.bounds[1] - 0.26, z0: d.bounds[2] + 0.26, z1: d.bounds[3] - 0.26 };
    this.H = d.wallH;
    this.boxes = d.colliders.map(c => ({
      minX: c.b[0], maxX: c.b[1], minY: c.b[2], maxY: c.b[3], minZ: c.b[4], maxZ: c.b[5],
      cam: !!c.cam, fade: c.fade || null, spot: c.spot || null,
    }));
    this.movers = [];                // moving platforms (robot vacuum)
    this.fades = new Map();          // key -> { mats: [], op, hit }
    this.sunDir = new THREE.Vector3(...d.sun.dir).normalize();
    this.setupScene(assets, opts);
    this.setupLights(opts);
    const p = d.probes; this.probes = p;
  }

  // ------------------------------------------------------------ static scene + materials
  setupScene(assets, opts) {
    const d = this.data, lm = assets.lightmap, lmI = d.lightmap.max * Math.PI * 0.82;
    const root = this.root = assets.house;
    const fadeMat = (key, m) => {
      const c = m.clone();
      let f = this.fades.get(key); if (!f) { f = { mats: [], op: 1, hit: false }; this.fades.set(key, f); }
      f.mats.push(c); return c;
    };
    root.traverse(o => {
      if (!o.isMesh) return;
      let key = null;
      for (let p = o; p; p = p.parent) if (p.name && p.name.startsWith('fade_')) { key = p.name.slice(5); break; }
      const m = o.material, ext = m.name.startsWith('ext_');
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
      } else { m.envMapIntensity = 1.0; if (key) o.material = fadeMat(key, m); }
      if (m.name.startsWith('ext_grass')) { o.castShadow = false; }
      if (m.transparent || m.alphaTest > 0 || m.name.includes('leaf') || m.name.includes('plant')) { m.alphaTest = Math.max(m.alphaTest, 0.4); m.transparent = false; m.side = THREE.DoubleSide; }
    });
    this.scene.add(root);

    // window glass
    const glass = new THREE.MeshPhysicalMaterial({ color: 0xcfe6f2, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.16, envMapIntensity: 1.6, depthWrite: false });
    for (const w of d.windows) {
      const g = new THREE.Mesh(new THREE.PlaneGeometry(w.a[1] - w.a[0], w.y[1] - w.y[0]), w.fade ? fadeMat(w.fade, glass) : glass);
      const c = (w.a[0] + w.a[1]) / 2, y = (w.y[0] + w.y[1]) / 2;
      if (w.axis === 'x') { g.position.set(w.at, y, c); g.rotation.y = Math.PI / 2; } else g.position.set(c, y, w.at);
      g.material.side = THREE.DoubleSide; g.renderOrder = 5;
      this.scene.add(g);
    }
    // invisible roof: keeps the sun out except through the windows
    const b = d.bounds;
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(b[1] - b[0] + 0.5, b[3] - b[2] + 0.5), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide }));
    roof.rotation.x = -Math.PI / 2; roof.position.set((b[0] + b[1]) / 2, this.H + 0.02, (b[2] + b[3]) / 2); roof.castShadow = true;
    this.scene.add(roof);
  }

  setupLights(opts) {
    const d = this.data;
    const sun = this.sun = new THREE.DirectionalLight(new THREE.Color(...d.sun.color), d.sun.intensity);
    sun.position.copy(this.sunDir).multiplyScalar(22);
    sun.castShadow = true;
    const s = opts.shadowSize || 2048;
    sun.shadow.mapSize.set(s, s);
    // fit the shadow frustum to the house footprint as seen from the sun
    const cam = sun.shadow.camera; const b = d.bounds;
    sun.updateMatrixWorld(); sun.target.updateMatrixWorld();
    const view = new THREE.Matrix4().lookAt(sun.position, new THREE.Vector3(), new THREE.Vector3(0, 1, 0)).setPosition(sun.position).invert();
    let l = 1e9, r = -1e9, t = -1e9, bt = 1e9, n = 1e9, f = -1e9; const v = new THREE.Vector3();
    for (const x of [b[0] - 1, b[1] + 1]) for (const y of [0, this.H + 0.3]) for (const z of [b[2] - 1, b[3] + 1]) {
      v.set(x, y, z).applyMatrix4(view);
      l = Math.min(l, v.x); r = Math.max(r, v.x); bt = Math.min(bt, v.y); t = Math.max(t, v.y); n = Math.min(n, -v.z); f = Math.max(f, -v.z);
    }
    Object.assign(cam, { left: l, right: r, top: t, bottom: bt, near: Math.max(0.5, n - 1), far: f + 1 });
    cam.updateProjectionMatrix();
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.025; sun.shadow.radius = 2.2;
    this.scene.add(sun, sun.target);
  }

  // ------------------------------------------------------------ queries
  resolveXZ(pos, r, h, vel, airborne) {
    let assist = 0;
    for (const b of this.boxes) {
      if (pos.y >= b.maxY - STEP || pos.y + h <= b.minY) continue;
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
      if (vn < 0) {
        if (airborne && vn < -0.25 && b.maxY - pos.y < 0.34) assist = 1;
        vel.x -= vn * nx; vel.z -= vn * nz;
      }
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
    const p = this.probes, b = this.data.bounds;
    const fx = clamp((x - b[0]) / p.cell - 0.5, 0, p.nx - 1.001), fz = clamp((z - b[2]) / p.cell - 0.5, 0, p.nz - 1.001);
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz, v = p.v, w = p.nx;
    const a = v[iz * w + ix], c = v[iz * w + ix + 1], e = v[(iz + 1) * w + ix], g = v[(iz + 1) * w + ix + 1];
    return (a * (1 - tx) + c * tx) * (1 - tz) + (e * (1 - tx) + g * tx) * tz;
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
