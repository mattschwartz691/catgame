// Visual effects: particles, paw prints, spills, ribbons (yarn / toilet paper), light shafts, dust, blob shadow, sprites.
import * as THREE from 'three';

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function canvasTex(w, h, draw) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const pawTex = () => canvasTex(64, 64, (g) => {
  g.fillStyle = '#fff';
  g.beginPath(); g.ellipse(32, 42, 14, 12, 0, 0, 7); g.fill();
  for (const [x, y, r] of [[13, 24, 6.5], [25, 13, 7], [39, 13, 7], [51, 24, 6.5]]) { g.beginPath(); g.ellipse(x, y, r * 0.85, r, 0, 0, 7); g.fill(); }
});
const blobTex = (soft = 0.0) => canvasTex(128, 128, (g) => {
  const gr = g.createRadialGradient(64, 64, 64 * soft, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
});
const splatTex = () => canvasTex(128, 128, (g) => {
  g.fillStyle = '#fff';
  g.beginPath();
  for (let i = 0; i <= 40; i++) { const a = i / 40 * Math.PI * 2, r = 40 + Math.sin(a * 5 + 1) * 7 + Math.sin(a * 9) * 5 + Math.random() * 4; g.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r); }
  g.fill();
  for (let i = 0; i < 14; i++) { const a = rnd(0, 6.3), r = rnd(46, 60); g.beginPath(); g.arc(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, rnd(1.5, 4.5), 0, 7); g.fill(); }
});
const glyphTex = (ch, col) => canvasTex(64, 64, (g) => {
  g.font = 'bold 50px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.35)'; g.strokeText(ch, 32, 34); g.fillStyle = col; g.fillText(ch, 32, 34);
});

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0), FLAT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

export class Ribbon {
  // A strip laid along the path of something that rolls (yarn, toilet paper).
  constructor(scene, color, width, max = 500) {
    this.max = max; this.width = width; this.n = 0; this.length = 0;
    this.pts = new Float32Array(max * 3);
    const g = this.geo = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 6), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(max * 6).fill(0), 3));
    const idx = []; for (let i = 0; i < max - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    g.setIndex(idx); g.setDrawRange(0, 0);
    const n = g.attributes.normal.array; for (let i = 0; i < max * 2; i++) n[i * 3 + 1] = 1;
    this.mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.9, side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false; this.mesh.receiveShadow = true;
    scene.add(this.mesh);
  }
  add(x, y, z) {
    const n = this.n, P = this.pts;
    if (n > 0) {
      const dx = x - P[(n - 1) * 3], dy = y - P[(n - 1) * 3 + 1], dz = z - P[(n - 1) * 3 + 2], d = Math.hypot(dx, dy, dz);
      if (d < 0.045) return 0;
      if (n >= this.max) return 0;
      this.length += d;
    }
    P[n * 3] = x; P[n * 3 + 1] = y; P[n * 3 + 2] = z; this.n++;
    // rebuild the last couple of cross-sections
    const pos = this.geo.attributes.position.array, w = this.width / 2;
    for (let i = Math.max(0, this.n - 2); i < this.n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(this.n - 1, i + 1);
      let tx = P[b * 3] - P[a * 3], tz = P[b * 3 + 2] - P[a * 3 + 2]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      pos[i * 6] = P[i * 3] - tz * w; pos[i * 6 + 1] = P[i * 3 + 1]; pos[i * 6 + 2] = P[i * 3 + 2] + tx * w;
      pos[i * 6 + 3] = P[i * 3] + tz * w; pos[i * 6 + 4] = P[i * 3 + 1]; pos[i * 6 + 5] = P[i * 3 + 2] - tx * w;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.setDrawRange(0, Math.max(0, (this.n - 1) * 6));
    return 1;
  }
}

export class FX {
  constructor(scene, world) {
    this.scene = scene; this.world = world;
    // ---- particles
    this.parts = []; this.pi = 0;
    const geo = new THREE.TetrahedronGeometry(1);
    for (let i = 0; i < 140; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }));
      m.visible = false; m.castShadow = false; scene.add(m);
      this.parts.push({ m, vel: new THREE.Vector3(), life: 0, max: 1, grav: 1, size: 0.02 });
    }
    // ---- paw prints
    this.maxPrints = 500; this.printN = 0; this.printTotal = 0;
    const pm = new THREE.MeshBasicMaterial({ map: pawTex(), transparent: true, depthWrite: false, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.prints = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), pm, this.maxPrints);
    this.prints.count = 0; this.prints.frustumCulled = false; this.prints.renderOrder = 2;
    this.prints.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.maxPrints * 3).fill(1), 3);
    scene.add(this.prints);
    // ---- spills / decals
    this.spills = [];
    this.splat = splatTex(); this.blob = blobTex(0.1);
    // ---- blob shadow under the cat (the sun rarely reaches indoors)
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: blobTex(0.15), color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    this.shadow.quaternion.copy(FLAT); this.shadow.renderOrder = 1; scene.add(this.shadow);
    // ---- floating glyph sprites (zzz, hearts, notes)
    this.sprites = []; this.glyphs = {};
    for (let i = 0; i < 24; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false })); s.visible = false; s.renderOrder = 20; scene.add(s);
      this.sprites.push({ s, vel: new THREE.Vector3(), life: 0, max: 1, size: 0.1 });
    }
    this.si = 0;
    this.ribbons = [];
    this.marks = 0;
    this.buildShafts();
    this.buildBirds();
  }

  // a few garden birds flitting about outside, for the cat to chatter at
  buildBirds() {
    const b = this.world.data.bounds;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.09, -0.16, 0, -0.05, 0, 0, -0.03, 0, 0, 0.09, 0, 0, -0.03, 0.16, 0, -0.05], 3));
    geo.computeVertexNormals();
    this.birds = [];
    for (let i = 0; i < 7; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: [0x2b2b30, 0x5a4030, 0x8a2b20, 0x30506a][i % 4], side: THREE.DoubleSide }));
      this.scene.add(m);
      const south = i % 2 === 0;
      this.birds.push({ m, cx: south ? rnd(b[0], b[1]) : b[0] - rnd(3, 6), cz: south ? b[3] + rnd(2.5, 5.5) : rnd(-2, 5), r: rnd(1.5, 4), h: rnd(1.2, 3.2), sp: rnd(0.5, 1.1) * (i % 2 ? 1 : -1), ph: rnd(0, 6.28) });
    }
  }

  glyph(ch, col) { const k = ch + col; return this.glyphs[k] || (this.glyphs[k] = glyphTex(ch, col)); }
  float(pos, ch, col = '#fff', o = {}) {
    const q = this.sprites[this.si = (this.si + 1) % this.sprites.length];
    q.s.material.map = this.glyph(ch, col); q.s.material.needsUpdate = true; q.s.visible = true;
    q.s.position.copy(pos); q.vel.set(rnd(-0.12, 0.12), o.vy ?? 0.35, rnd(-0.12, 0.12));
    q.life = q.max = o.life ?? 1.4; q.size = o.size ?? 0.13; q.s.scale.setScalar(q.size);
  }

  burst(p, n, col, o = {}) {
    for (let i = 0; i < n; i++) {
      const q = this.parts[this.pi = (this.pi + 1) % this.parts.length];
      q.m.visible = true; q.m.material.color.set(Array.isArray(col) ? col[(Math.random() * col.length) | 0] : col);
      q.m.position.copy(p); q.m.rotation.set(rnd(0, 6), rnd(0, 6), 0);
      const sp = o.speed ?? 2.2;
      q.vel.set(rnd(-1, 1) * sp, rnd(o.up0 ?? 0.3, o.up ?? 1.4) * sp, rnd(-1, 1) * sp);
      q.life = q.max = rnd(0.4, 0.9) * (o.life ?? 1); q.grav = o.grav ?? 1; q.size = (o.size ?? 0.025) * rnd(0.6, 1.3);
      q.m.scale.setScalar(q.size);
    }
  }

  pawPrint(x, y, z, yaw, col, size = 0.085) {
    const i = this.printN % this.maxPrints; this.printN++; this.printTotal++;
    _q.setFromAxisAngle(UP, yaw + Math.PI).multiply(FLAT);
    _m.compose(_p.set(x, y + 0.006, z), _q, _s.set(size, size, size));
    this.prints.setMatrixAt(i, _m); this.prints.setColorAt(i, _c.set(col));
    this.prints.count = Math.min(this.printN, this.maxPrints);
    this.prints.instanceMatrix.needsUpdate = true; this.prints.instanceColor.needsUpdate = true;
  }

  // a puddle/patch on a surface; walking through it dirties the paws
  spill(x, y, z, r, col, kind) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ map: this.splat, color: col, transparent: true, depthWrite: false, roughness: kind === 'flour' ? 1 : 0.15, polygonOffset: true, polygonOffsetFactor: -1.5, polygonOffsetUnits: -1.5 }));
    m.quaternion.copy(FLAT); m.rotateZ(rnd(0, 6.28)); m.position.set(x, y + 0.004, z); m.scale.setScalar(0.01); m.receiveShadow = true; m.renderOrder = 1;
    this.scene.add(m);
    const s = { m, x, y, z, r, col, kind, grow: 0 }; this.spills.push(s); return s;
  }
  spillAt(x, y, z) { for (const s of this.spills) if (Math.abs(y - s.y) < 0.12 && (x - s.x) ** 2 + (z - s.z) ** 2 < (s.r * 0.42) ** 2 * s.grow * s.grow) return s; return null; }

  scratchMark(x, y, z, axis, n) {
    if (this.marks++ > 90) return;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.007, rnd(0.06, 0.12)), new THREE.MeshBasicMaterial({ color: 0xf2ebdf, transparent: true, opacity: 0.8 }));
    m.position.set(x, y, z); if (axis === 'x') m.rotation.y = n > 0 ? Math.PI / 2 : -Math.PI / 2; else m.rotation.y = n > 0 ? 0 : Math.PI;
    m.rotation.z = rnd(-0.12, 0.12); this.scene.add(m);
  }

  ribbon(color, width, max) { const r = new Ribbon(this.scene, color, width, max); this.ribbons.push(r); return r; }

  // ---- sunlight shafts through the windows the sun can see + drifting dust
  buildShafts() {
    const d = this.world.data, sun = this.world.sunDir, H = d.wallH;
    const b = d.bounds;
    const mat = this.shaftMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uI: { value: 0.018 }, uCol: { value: new THREE.Color(1.0, 0.86, 0.62) } },
      vertexShader: 'attribute float aT; attribute float aE; varying float vT; varying float vE; void main(){ vT = aT; vE = aE; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float uI; uniform vec3 uCol; varying float vT; varying float vE; void main(){ float a = (1.0 - vT) * (1.0 - vT) * smoothstep(0.0, 0.25, vE) * smoothstep(1.0, 0.75, vE); gl_FragColor = vec4(uCol * uI * a, 1.0); }',
    });
    const dust = [];
    for (const w of d.windows) {
      // outward normal of the wall this window sits in
      let nx = 0, nz = 0;
      if (!w.ext) continue;                                   // inner walls have no sun
      if (w.axis === 'x') nx = w.ext === 'neg' ? -1 : 1; else nz = w.ext === 'neg' ? -1 : 1;
      if (nx * sun.x + nz * sun.z < 0.15) continue;
      const pos = [], aT = [], aE = [], idx = [];
      const corners = [[w.a[0], w.y[0]], [w.a[1], w.y[0]], [w.a[1], w.y[1]], [w.a[0], w.y[1]]];
      const P = corners.map(([a, y]) => w.axis === 'x' ? new THREE.Vector3(w.at, y, a) : new THREE.Vector3(a, y, w.at));
      const Q = P.map(p => { const t = p.y / sun.y; return new THREE.Vector3(p.x - sun.x * t, 0.02, p.z - sun.z * t); });
      // two crossed sheets through the beam + the four sides, all very faint
      const quad = (a0, a1, b0, b1, e0, e1) => {
        const i = pos.length / 3;
        for (const [v, t, e] of [[a0, 0, e0], [a1, 0, e1], [b1, 1, e1], [b0, 1, e0]]) { pos.push(v.x, v.y, v.z); aT.push(t); aE.push(e); }
        idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
      };
      const mid = (u, v, t) => new THREE.Vector3().lerpVectors(u, v, t);
      for (const t of [0.2, 0.5, 0.8]) {
        quad(mid(P[0], P[1], t), mid(P[3], P[2], t), mid(Q[0], Q[1], t), mid(Q[3], Q[2], t), 0, 1);
        quad(mid(P[0], P[3], t), mid(P[1], P[2], t), mid(Q[0], Q[3], t), mid(Q[1], Q[2], t), 0, 1);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aT', new THREE.Float32BufferAttribute(aT, 1)); g.setAttribute('aE', new THREE.Float32BufferAttribute(aE, 1));
      g.setIndex(idx);
      const m = new THREE.Mesh(g, mat); m.renderOrder = 15; m.frustumCulled = false; this.scene.add(m);
      for (let i = 0; i < 46; i++) {       // dust motes inside this beam
        const u = Math.random(), v = Math.random(), t = Math.random() * 0.9;
        const p0 = mid(mid(P[0], P[1], u), mid(P[3], P[2], u), v), p1 = mid(mid(Q[0], Q[1], u), mid(Q[3], Q[2], u), v);
        const p = mid(p0, p1, t); dust.push(p.x, p.y, p.z);
      }
    }
    const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.Float32BufferAttribute(dust, 3));
    this.dustMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uT: { value: 0 }, uPx: { value: 1 } },
      vertexShader: `uniform float uT; uniform float uPx; varying float vA;
        void main(){ vec3 p = position; float h = fract(sin(dot(position.xz, vec2(12.9898, 78.233))) * 43758.5453);
          p.x += sin(uT * (0.2 + h * 0.3) + h * 40.0) * 0.12; p.y += sin(uT * (0.15 + h * 0.2) + h * 17.0) * 0.1; p.z += cos(uT * (0.18 + h * 0.25) + h * 9.0) * 0.12;
          vA = 0.35 + 0.65 * (0.5 + 0.5 * sin(uT * (0.8 + h) + h * 30.0));
          vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = uPx * (2.2 + 3.0 * h) / max(0.5, -mv.z); }`,
      fragmentShader: 'varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(vec3(1.0, 0.9, 0.7) * a * vA * 0.55, 1.0); }',
    });
    const pts = new THREE.Points(dg, this.dustMat); pts.frustumCulled = false; pts.renderOrder = 16; this.scene.add(pts);
  }

  update(dt, cat) {
    this.dustMat.uniforms.uT.value += dt; this.dustMat.uniforms.uPx.value = window.innerHeight * 0.0035;
    for (const q of this.parts) {
      if (q.life <= 0) continue;
      q.life -= dt;
      if (q.life <= 0) { q.m.visible = false; continue; }
      q.vel.y -= 9 * q.grav * dt;
      q.m.position.addScaledVector(q.vel, dt);
      if (q.m.position.y < 0.01) { q.m.position.y = 0.01; q.vel.set(q.vel.x * 0.5, -q.vel.y * 0.3, q.vel.z * 0.5); }
      q.m.rotation.x += dt * 6; q.m.rotation.y += dt * 4;
      q.m.scale.setScalar(q.size * Math.min(1, q.life / q.max * 2.5));
    }
    for (const q of this.sprites) {
      if (q.life <= 0) continue;
      q.life -= dt;
      if (q.life <= 0) { q.s.visible = false; continue; }
      q.s.position.addScaledVector(q.vel, dt);
      const k = q.life / q.max; q.s.material.opacity = Math.min(1, k * 2.5); q.s.scale.setScalar(q.size * (1.2 - 0.4 * k));
    }
    this.birdT = (this.birdT || 0) + dt;
    for (const b of this.birds) {
      const a = b.ph + this.birdT * b.sp, x = b.cx + Math.cos(a) * b.r, z = b.cz + Math.sin(a * 0.7) * b.r * 0.6, y = b.h + Math.sin(a * 1.9) * 0.5;
      b.m.rotation.set(0, Math.atan2(x - b.m.position.x, z - b.m.position.z), Math.sin(this.birdT * 14 + b.ph) * 0.5);
      b.m.position.set(x, y, z);
      b.m.scale.set(1, 1 + Math.abs(Math.sin(this.birdT * 14 + b.ph)) * 0.6, 1);
    }
    for (const s of this.spills) if (s.grow < 1) { s.grow = Math.min(1, s.grow + dt * 2.5); s.m.scale.setScalar(s.r * (1 - (1 - s.grow) ** 3)); }
    // blob shadow follows the ground under the cat
    const g = this.world.groundAt(cat.pos.x, cat.pos.z, cat.pos.y + 0.05);
    const h = cat.pos.y - g.y;
    this.shadow.position.set(cat.pos.x + Math.sin(cat.yaw) * 0.02, g.y + 0.022, cat.pos.z + Math.cos(cat.yaw) * 0.02);
    this.shadow.scale.setScalar(0.62 + h * 0.35); this.shadow.material.opacity = clamp(0.42 - h * 0.22, 0.08, 0.42);
  }
}
