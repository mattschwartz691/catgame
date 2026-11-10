// The cat's visible body: a skinned mesh sculpted offline (art/cat_build.py), shell fur, eyes, whiskers.
// Bones carry *delta* transforms in cat space (bind pose = identity), which the animation rig fills in.
import * as THREE from 'three';

export const COATS = [
  { id: 'noons', name: 'Noons', desc: 'Black & white', eye: [0x6c7a1c, 0xcfd45c], lid: 0x1b1b20, swatch: { head: '#24242a', ear: '#1b1b20', muzzle: '#f7f4ee', eye: '#b9c24a', nose: '#e29a92' }, fur: 0.9, tint: 0xe8f0ff, sheen: 0xaebbd8 },
  { id: 'moons', name: 'Moons', desc: 'Brown tabby', eye: [0x5f8a2a, 0xd6dc6c], lid: 0x3a2e24, swatch: { head: '#6f5f4b', ear: '#5a4a38', muzzle: '#dccbb0', eye: '#b4cf58', nose: '#a4584e' }, fur: 0.85, tint: 0xfff2e2, sheen: 0xe6d4b8 },
  { id: 'mango', name: 'Mango', desc: 'Orange tabby', eye: [0x5c8f1e, 0xc8e05a], lid: 0xc9701c, swatch: { head: '#e08a30', ear: '#c9701c', muzzle: '#fbebd0', eye: '#8fc43c', nose: '#e07f86' }, fur: 1.0, tint: 0xfff0e0, sheen: 0xffd9a8 },
  { id: 'domino', name: 'Domino', desc: 'Tuxedo', eye: [0xb98a10, 0xffe066], lid: 0x1b1b20, swatch: { head: '#24242a', ear: '#1b1b20', muzzle: '#f7f5f0', eye: '#f2c93a', nose: '#e8a0aa' }, fur: 0.9, tint: 0xe8f0ff, sheen: 0xaebbd8 },
  { id: 'miso', name: 'Miso', desc: 'Siamese', eye: [0x1f6fc4, 0x8fd4ff], lid: 0x3a281e, swatch: { head: '#f1e6d2', ear: '#3a281e', muzzle: '#4a3428', eye: '#4aa8ee', nose: '#2a1c18' }, fur: 0.85, tint: 0xfff4e4, sheen: 0xfff1dc },
];

const texLoader = new THREE.TextureLoader();
const loadTex = url => new Promise((res, rej) => texLoader.load(url, t => {
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; res(t);
}, undefined, rej));

export async function loadCatAssets(base = 'assets/cat/') {
  const [meta, buf, ...coats] = await Promise.all([
    fetch(base + 'cat.json').then(r => r.json()),
    fetch(base + 'cat.bin').then(r => r.arrayBuffer()),
    ...COATS.map(c => loadTex(base + `coat_${c.id}.webp`)),
  ]);
  const n = meta.nVerts, t = meta.nTris;
  let o = 0;
  const f32 = k => { const a = new Float32Array(buf, o, n * k); o += n * k * 4; return a; };
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(f32(3), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(f32(3), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(f32(2), 2));
  const si = new Uint8Array(buf, o, n * 4); o += n * 4;
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(Uint16Array.from(si), 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(f32(4), 4));
  geo.setAttribute('groom', new THREE.BufferAttribute(f32(4), 4));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(buf, o, t * 3), 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.3, 0), 1);
  const tex = {};
  COATS.forEach((c, i) => { tex[c.id] = coats[i]; });
  return { meta, geo, tex };
}

// ---------------------------------------------------------------- fur shells
const FUR_VERT_PARS = /* glsl */`
attribute vec4 groom;
uniform float uShell;      // 0 (skin) .. 1 (tips)
uniform float uFurLen;
uniform vec3 uFurForce;    // droop + motion lag, cat space
varying vec3 vRest;
varying float vShellH;
`;
const FUR_VERT = /* glsl */`
vRest = position;
vShellH = uShell;
{
  float fl = groom.w * uFurLen;
  transformed += groom.xyz * (fl * uShell) + uFurForce * (fl * uShell * uShell);
}
`;
const FUR_FRAG_PARS = /* glsl */`
uniform float uShell;
uniform float uDensity;
uniform vec3 uTint;
varying vec3 vRest;
varying float vShellH;
float furHash(vec3 p) { p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
`;
const FUR_FRAG = /* glsl */`
{
  float h = vShellH;
  if (h > 0.0) {
    // two octaves of strand clumps living in rest-pose space, so they stay glued to the skin
    vec3 q = vRest * uDensity;
    vec3 c = floor(q); vec3 f = fract(q) - 0.5;
    float r1 = furHash(c);
    vec3 o = vec3(furHash(c + 7.1), furHash(c + 3.7), furHash(c + 11.3)) - 0.5;
    float d = length(f - o * 0.55);
    float len = 0.45 + 0.55 * r1;
    float keep = (0.62 * (1.0 - h / len)) - d;
    vec3 q2 = vRest * uDensity * 2.3 + 13.7;
    vec3 c2 = floor(q2); vec3 f2 = fract(q2) - 0.5;
    float len2 = 0.35 + 0.65 * furHash(c2);
    keep = max(keep, 0.5 * (1.0 - h / len2) - length(f2));
    if (keep < 0.0) discard;
  }
  float ao = mix(0.5, 1.0, pow(h, 0.7));
  diffuseColor.rgb *= ao * mix(vec3(1.0), uTint, h * h);
}
`;

function furMaterial(map, shell, shared) {
  const m = new THREE.MeshPhysicalMaterial({ map, roughness: 0.82, metalness: 0, envMapIntensity: 0.55, sheen: 0.7, sheenRoughness: 0.55, sheenColor: shared.sheen });
  m.onBeforeCompile = s => {
    s.uniforms.uShell = { value: shell };
    s.uniforms.uFurLen = shared.uFurLen; s.uniforms.uFurForce = shared.uFurForce;
    s.uniforms.uDensity = shared.uDensity; s.uniforms.uTint = shared.uTint;
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\n' + FUR_VERT_PARS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + FUR_VERT);
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\n' + FUR_FRAG_PARS)
      .replace('#include <map_fragment>', '#include <map_fragment>\n' + FUR_FRAG);
  };
  m.customProgramCacheKey = () => 'catfur';
  return m;
}

// ---------------------------------------------------------------- eyes
function eyeMaterial(coat) {
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.3 });
  const u = { uPupil: { value: 0.3 }, uIrisA: { value: new THREE.Color(coat.eye[0]) }, uIrisB: { value: new THREE.Color(coat.eye[1]) } };
  m.userData.u = u;
  m.onBeforeCompile = s => {
    Object.assign(s.uniforms, u);
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vEyeP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEyeP = position;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vEyeP; uniform float uPupil; uniform vec3 uIrisA; uniform vec3 uIrisB;`)
      .replace('#include <map_fragment>', `
      {
        vec3 n = normalize(vEyeP);
        float r = length(n.xy);
        float ang = atan(n.y, n.x);
        float ri = 0.80;
        float streak = 0.5 + 0.5 * sin(ang * 46.0 + sin(ang * 9.0) * 2.0);
        vec3 iris = mix(uIrisB, uIrisA, smoothstep(0.12, ri, r) * 0.85 + streak * 0.15);
        iris *= 0.75 + 0.35 * smoothstep(-0.6, 0.6, -n.y);          // lit from below-ish like a real cornea
        iris = mix(iris, uIrisB * 1.15, (1.0 - smoothstep(0.0, 0.3, r)) * 0.35);
        float limb = smoothstep(ri - 0.1, ri, r);
        vec3 col = mix(iris, vec3(0.02, 0.015, 0.01), limb * 0.92);
        col = mix(col, vec3(0.05, 0.04, 0.035), smoothstep(ri, ri + 0.04, r));
        float pw = mix(0.07, 0.5, uPupil), ph = mix(0.46, 0.56, uPupil);
        float pd = length(vec2(n.x / pw, n.y / ph));
        col = mix(vec3(0.0), col, smoothstep(0.92, 1.08, pd));
        if (n.z < 0.0) col = vec3(0.05, 0.04, 0.035);
        diffuseColor.rgb = col;
      }`);
  };
  m.customProgramCacheKey = () => 'cateye';
  return m;
}

export class CatModel {
  constructor(assets, coat, opts = {}) {
    this.assets = assets; this.meta = assets.meta;
    this.group = new THREE.Group();               // lives under the cat root (cat space)
    const names = this.meta.bones;
    this.bones = names.map(n => { const b = new THREE.Bone(); b.name = n; b.matrixAutoUpdate = false; this.group.add(b); return b; });
    this.bone = {}; names.forEach((n, i) => { this.bone[n] = this.bones[i]; });
    this.skeleton = new THREE.Skeleton(this.bones, this.bones.map(() => new THREE.Matrix4()));
    this.shared = { uFurLen: { value: 1 }, uFurForce: { value: new THREE.Vector3() }, uDensity: { value: 230 }, uTint: { value: new THREE.Color(0xffffff) }, sheen: new THREE.Color(0xffffff) };
    this.shells = [];
    this.nShells = opts.shells ?? 14;
    this.J = {}; for (const k in this.meta.joints) this.J[k] = new THREE.Vector3(...this.meta.joints[k]);
    this.buildFace();
    this.setCoat(coat);
  }

  setCoat(coat) {
    this.coat = coat;
    for (const s of this.shells) { this.group.remove(s); s.material.dispose(); }
    this.shells = [];
    const map = this.assets.tex[coat.id];
    this.shared.uTint.value.set(coat.tint); this.shared.sheen.set(coat.sheen);
    this.shared.uFurLen.value = coat.fur * Math.min(1, 0.5 + this.nShells / 16);      // fewer shells: shorter fur, so the layers do not read as dots
    for (let i = 0; i < this.nShells; i++) {
      const h = this.nShells > 1 ? i / (this.nShells - 1) : 0;
      const m = new THREE.SkinnedMesh(this.assets.geo, furMaterial(map, h, this.shared));
      m.bind(this.skeleton, new THREE.Matrix4());
      m.frustumCulled = false;
      m.castShadow = i === 0; m.receiveShadow = true;
      m.renderOrder = i;
      this.group.add(m); this.shells.push(m);
    }
    this.eyeMat.userData.u.uIrisA.value.set(coat.eye[0]); this.eyeMat.userData.u.uIrisB.value.set(coat.eye[1]);
    this.lidMat.color.set(coat.lid);
  }

  setShells(n) { if (n !== this.nShells) { this.nShells = n; this.setCoat(this.coat); } }

  buildFace() {
    const head = this.bone.head, J = this.J, R = this.meta.eyeR;
    this.eyeMat = eyeMaterial(COATS[0]);
    this.lidMat = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.9 });
    const eyeGeo = new THREE.SphereGeometry(R, 28, 20).rotateX(Math.PI / 2);         // poles on the gaze axis
    const lidGeo = new THREE.SphereGeometry(R * 1.045, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.5);
    const glint = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.eyes = []; this.lids = [];
    for (const s of [1, -1]) {
      const g = new THREE.Group(); g.position.set(J.eye.x * s, J.eye.y, J.eye.z); g.rotation.y = s * 0.2;
      head.add(g);
      const ball = new THREE.Mesh(eyeGeo, this.eyeMat); g.add(ball);
      const gl = new THREE.Mesh(new THREE.SphereGeometry(R * 0.11, 8, 6), glint); gl.position.set(R * 0.3, R * 0.36, R * 0.9); g.add(gl);
      const gl2 = new THREE.Mesh(new THREE.SphereGeometry(R * 0.05, 6, 4), glint); gl2.position.set(-R * 0.28, -R * 0.3, R * 0.93); g.add(gl2);
      const up = new THREE.Mesh(lidGeo, this.lidMat); g.add(up);
      const lo = new THREE.Mesh(lidGeo, this.lidMat); lo.scale.y = -1; g.add(lo);
      this.eyes.push(g); this.lids.push({ up, lo });
    }
    this.setLids(0, 0);
    // whiskers
    const wm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
    const nose = new THREE.Vector3(...this.meta.nose);
    this.whiskers = new THREE.Group(); head.add(this.whiskers);
    for (const s of [1, -1]) {
      for (let k = 0; k < 4; k++) {
        const a = (k - 1.5) * 0.22, len = 0.085 + (k === 1 || k === 2 ? 0.02 : 0);
        const p0 = new THREE.Vector3(s * 0.03, nose.y - 0.018 - k * 0.0035, nose.z - 0.038);
        const p2 = p0.clone().add(new THREE.Vector3(s * Math.cos(a) * len, Math.sin(a) * len - 0.012, -0.015));
        const p1 = p0.clone().lerp(p2, 0.5).add(new THREE.Vector3(0, 0.012, 0.012));
        const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(p0, p1, p2), 8, 0.00055, 4), wm);
        this.whiskers.add(tube);
      }
      for (let k = 0; k < 2; k++) {       // brow whiskers
        const p0 = new THREE.Vector3(s * (0.03 + k * 0.012), this.J.eye.y + 0.036, this.J.eye.z + 0.012);
        const p2 = p0.clone().add(new THREE.Vector3(s * (0.02 + k * 0.02), 0.05, -0.005));
        const p1 = p0.clone().lerp(p2, 0.5).add(new THREE.Vector3(0, 0.004, 0.012));
        this.whiskers.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(p0, p1, p2), 6, 0.0006, 4), wm));
      }
    }
  }

  // close: 0 open .. 1 shut;  squint: 0..1 raises the lower lid (happy / sleepy)
  setLids(close, squint) {
    for (const l of this.lids) {
      l.up.rotation.x = THREE.MathUtils.lerp(-1.0, 0.62, Math.min(1, close + squint * 0.25));
      l.lo.rotation.x = THREE.MathUtils.lerp(1.15, 0.5, Math.min(1, close * 0.9 + squint * 0.7));
    }
  }
  setPupil(v) { this.eyeMat.userData.u.uPupil.value = v; }
}
