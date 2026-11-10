// Knockable things: scanned models from props.glb plus a few hand-built toys. Simple sphere physics.
import * as THREE from 'three';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const G = 20;

// Behaviour by asset id (longest matching prefix wins).
const DEFS = {
  'ceramic_vase': { snd: 'clink', brk: 'ceramic', tough: 3.2, name: 'vase', col: 0xf2f0ea },
  'antique_ceramic_vase': { snd: 'clink', brk: 'ceramic', tough: 3.0, name: 'antique vase', col: 0xdfe6f5, score: 3 },
  'jug_01': { snd: 'clink', brk: 'ceramic', tough: 3.2, name: 'flowery jug', col: 0xf5f2ea },
  'tea_set_01': { snd: 'clink', brk: 'ceramic', tough: 2.8, name: 'teacup', col: 0xf5f2ea },
  'tea_set_01#8': { snd: 'clink', brk: 'ceramic', tough: 3.0, name: 'teapot', col: 0xf5f2ea, score: 2 },
  'tea_set_01#2': { snd: 'clink', brk: 'ceramic', tough: 2.6, name: 'saucer', col: 0xf5f2ea },
  'planter_pot_clay': { snd: 'clink', brk: 'pot', tough: 3.0, name: 'flower pot', col: 0xc8734a },
  'potted_plant_04': { snd: 'clink', brk: 'pot', tough: 3.0, name: 'succulent', col: 0xf2f0ea },
  'marble_bust_01': { snd: 'thud', brk: 'ceramic', tough: 4.6, name: 'marble bust', col: 0xe9e6e0, mass: 2.4, score: 5 },
  'garden_gnome': { snd: 'clink', brk: 'ceramic', tough: 4.0, name: 'garden gnome', col: 0xd9433f, mass: 1.5, score: 3 },
  'concrete_cat_statue': { snd: 'thud', name: 'cat statue', mass: 2.5 },
  'standing_picture_frame': { snd: 'clink', brk: 'glass', tough: 3.4, name: 'photo frame', col: 0xd9d2c0 },
  'wine_bottles_01': { snd: 'clink', brk: 'glass', tough: 3.6, name: 'wine bottle', col: 0x35502f, score: 2 },
  'mantel_clock_01': { snd: 'wood', name: 'mantel clock', mass: 1.8 },
  'alarm_clock_01': { snd: 'jingle', name: 'alarm clock' },
  'brass_': { snd: 'metal', name: 'brass goblet' },
  'brass_vase': { snd: 'metal', name: 'brass vase', mass: 1.4 },
  'brass_pot': { snd: 'metal', name: 'brass pot', mass: 1.6 },
  'vintage_electric_kettle': { snd: 'metal', name: 'kettle', mass: 1.3 },
  'pot_enamel_01': { snd: 'metal', name: 'cooking pot', mass: 1.5 },
  'watering_can_metal_01': { snd: 'metal', name: 'watering can', mass: 1.3 },
  'wooden_spoon': { snd: 'wood', name: 'wooden spoon', carry: true },
  'carved_wooden_elephant': { snd: 'wood', name: 'wooden elephant' },
  'Ukulele_01': { snd: 'wood', name: 'ukulele', strum: true, mass: 1.2 },
  'food_': { snd: 'soft', name: 'fruit', round: true, bounce: 0.25, fric: 1.6 },
  'food_apple_01': { snd: 'soft', name: 'apple', round: true, bounce: 0.25, fric: 1.6 },
  'food_lime_01': { snd: 'soft', name: 'lime', round: true, bounce: 0.25, fric: 1.6 },
  'food_pomegranate_01': { snd: 'soft', name: 'pomegranate', round: true, bounce: 0.25, fric: 1.6 },
  'lemon': { snd: 'soft', name: 'lemon', round: true, bounce: 0.25, fric: 1.8 },
  'yellow_onion': { snd: 'soft', name: 'onion', round: true, bounce: 0.2, fric: 1.8 },
  'croissant': { snd: 'soft', name: 'croissant', carry: true },
  'bananas': { snd: 'soft', name: 'bananas' },
  'carrot_cake': { snd: 'soft', name: 'carrot cake', splat: 0xf2e2c0, score: 2 },
  'strawberry_chocolate_cake': { snd: 'soft', name: 'strawberry cake', splat: 0x5a2f22, score: 2 },
  'throw_pillows_01': { snd: 'soft', name: 'cushion', mass: 1.8, bounce: 0.1 },
  'baseball_01': { snd: 'thud', name: 'baseball', round: true, bounce: 0.5, fric: 0.8 },
  'american_football': { snd: 'boing', name: 'football', bounce: 0.6, fric: 1.2 },
  'rubber_duck_toy': { snd: 'boing', name: 'rubber duck', bounce: 0.55 },
  'binder_notebook': { snd: 'book', name: 'notebook' },
  'gamepad': { snd: 'plastic', name: 'gamepad' },
  'round_spectacles': { snd: 'tick', name: 'spectacles', carry: true },
  'rubber_boots': { snd: 'soft', name: 'rubber boot', mass: 1.3 },
  'plunger': { snd: 'plastic', name: 'plunger' },
};
function defFor(id) {
  let best = null, bl = -1;
  for (const k in DEFS) if (id.startsWith(k) && k.length > bl) { best = DEFS[k]; bl = k.length; }
  return best || { snd: 'thud', name: id.replace(/_\d+.*$/, '').replace(/_/g, ' ') };
}

const texCache = {};
function canvasTex(key, w, h, draw) {
  if (texCache[key]) return texCache[key];
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return (texCache[key] = t);
}
const hex = c => '#' + c.toString(16).padStart(6, '0');
const yarnTex = col => canvasTex('yarn' + col, 128, 128, (g, W, H) => {
  g.fillStyle = hex(col); g.fillRect(0, 0, W, H);
  for (let i = 0; i < 70; i++) {
    g.strokeStyle = i % 2 ? 'rgba(255,255,255,.25)' : 'rgba(0,0,0,.25)'; g.lineWidth = 2;
    const y = rnd(0, H), s = rnd(-40, 40);
    g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(W * .3, y + s, W * .6, y - s, W, y); g.stroke();
  }
});
const std = (o) => new THREE.MeshStandardMaterial(o);

// Hand-built props. Meshes are authored around the sphere centre (base at y = -r).
function buildProc(kind, o) {
  const g = new THREE.Group();
  const add = (geo, m, x = 0, y = 0, z = 0) => { const s = new THREE.Mesh(geo, m); s.position.set(x, y, z); s.castShadow = true; s.receiveShadow = true; g.add(s); return s; };
  const col = o.col ?? 0xffffff;
  let d;
  switch (kind) {
    case 'yarn': d = { r: 0.09, round: true, bounce: 0.45, fric: 0.9, name: 'yarn ball', snd: 'soft', trail: 'yarn', col };
      add(new THREE.SphereGeometry(0.09, 20, 14), std({ map: yarnTex(col), roughness: 0.95 })); break;
    case 'ball': d = { r: 0.07, round: true, bounce: 0.72, fric: 0.7, name: 'bouncy ball', snd: 'boing' };
      add(new THREE.SphereGeometry(0.07, 20, 14), std({ color: col, roughness: 0.35 })); break;
    case 'bell': d = { r: 0.055, round: true, bounce: 0.5, fric: 0.8, name: 'jingle ball', snd: 'jingle' };
      add(new THREE.SphereGeometry(0.055, 18, 12), std({ color: 0xf2c14e, roughness: 0.2, metalness: 0.9 })); break;
    case 'pingpong': d = { r: 0.035, round: true, bounce: 0.84, fric: 0.5, name: 'ping-pong ball', snd: 'tick' };
      add(new THREE.SphereGeometry(0.035, 16, 10), std({ color: 0xffffff, roughness: 0.4 })); break;
    case 'mouse': d = { r: 0.045, fric: 3, name: 'toy mouse', snd: 'soft', bounce: 0.2, carry: true, prey: true }; {
      const fur = std({ color: 0x9aa0a8, roughness: 1 }), pink = std({ color: 0xf3b3a6, roughness: 0.8 });
      const b = add(new THREE.SphereGeometry(0.045, 14, 10), fur); b.scale.set(0.8, 0.75, 1.3); b.position.y = -0.011;
      add(new THREE.SphereGeometry(0.017, 8, 6), pink, 0.022, 0.018, 0.035); add(new THREE.SphereGeometry(0.017, 8, 6), pink, -0.022, 0.018, 0.035);
      add(new THREE.SphereGeometry(0.008, 6, 4), pink, 0, -0.012, 0.06);
      const t = add(new THREE.CylinderGeometry(0.004, 0.002, 0.11), pink, 0, -0.025, -0.1); t.rotation.x = Math.PI / 2 + 0.2;
    } break;
    case 'mug': d = { r: 0.05, name: 'mug', snd: 'clink', brk: 'ceramic', tough: 5.2, col }; {
      const m = std({ color: col, roughness: 0.25 });
      add(new THREE.CylinderGeometry(0.04, 0.036, 0.09, 16), m, 0, -0.005, 0);
      add(new THREE.CylinderGeometry(0.034, 0.034, 0.002, 14), std({ color: 0x4a2c18, roughness: 0.3 }), 0, 0.041, 0);
      add(new THREE.TorusGeometry(0.024, 0.007, 6, 12), m, 0.045, -0.005, 0);
    } break;
    case 'glass': d = { r: 0.045, name: 'glass of water', snd: 'clink', brk: 'glass', tough: 3, col: 0xcfeeff, wet: true };
      add(new THREE.CylinderGeometry(0.034, 0.028, 0.11, 14), new THREE.MeshPhysicalMaterial({ color: 0xdff3ff, transparent: true, opacity: 0.35, roughness: 0.03, envMapIntensity: 1.5 }), 0, 0.01, 0).castShadow = false;
      add(new THREE.CylinderGeometry(0.029, 0.025, 0.06, 14), std({ color: 0x8fd0ff, transparent: true, opacity: 0.6, roughness: 0.1 }), 0, -0.012, 0).castShadow = false; break;
    case 'perfume': d = { r: 0.04, name: 'perfume bottle', snd: 'clink', brk: 'glass', tough: 2.8, col: 0xf3b3d6 };
      add(new THREE.BoxGeometry(0.06, 0.08, 0.035), new THREE.MeshPhysicalMaterial({ color: 0xf3b3d6, transparent: true, opacity: 0.7, roughness: 0.05 }));
      add(new THREE.CylinderGeometry(0.012, 0.012, 0.03), std({ color: 0xd9b25a, metalness: 0.9, roughness: 0.3 }), 0, 0.055, 0); break;
    case 'ink': d = { r: 0.04, name: 'ink bottle', snd: 'clink', brk: 'glass', tough: 2.4, col: 0x1f2a6b, spill: { col: 0x1f2a6b, r: 0.42, kind: 'ink' } };
      add(new THREE.CylinderGeometry(0.035, 0.04, 0.06, 12), std({ color: 0x1f2a6b, roughness: 0.1 }), 0, -0.01, 0);
      add(new THREE.CylinderGeometry(0.016, 0.016, 0.03), std({ color: 0x222222, roughness: 0.5 }), 0, 0.035, 0); break;
    case 'cereal': d = { r: 0.09, name: 'cereal box', snd: 'paper', fric: 7, spillBits: [0xf2c14e, 0xe8a03d, 0xd98a3a] };
      add(new THREE.BoxGeometry(0.2, 0.3, 0.07), std({ color: 0xf2a03d, roughness: 0.7 }), 0, 0.06, 0); add(new THREE.BoxGeometry(0.14, 0.12, 0.072), std({ color: 0xfff1c9, roughness: 0.7 }), 0, 0.09, 0); break;
    case 'catfood': d = { r: 0.1, name: 'bag of kibble', snd: 'paper', fric: 7, mass: 1.5, spillBits: [0x8a5a2b, 0x6b4520, 0xa8743a] };
      add(new THREE.BoxGeometry(0.22, 0.34, 0.1), std({ color: 0x4f9bd9, roughness: 0.6 }), 0, 0.07, 0); add(new THREE.BoxGeometry(0.16, 0.14, 0.102), std({ color: 0xfbeed8, roughness: 0.6 }), 0, 0.1, 0); break;
    case 'flour': d = { r: 0.09, name: 'bag of flour', snd: 'paper', fric: 7, mass: 1.4, spill: { col: 0xf7f3ea, r: 0.6, kind: 'flour' }, spillBits: [0xffffff, 0xf7f3ea] };
      add(new THREE.BoxGeometry(0.17, 0.26, 0.1), std({ color: 0xf2ead8, roughness: 0.9 }), 0, 0.04, 0); add(new THREE.BoxGeometry(0.12, 0.08, 0.102), std({ color: 0xc0504d, roughness: 0.8 }), 0, 0.05, 0); break;
    case 'bleach': d = { r: 0.07, name: 'detergent bottle', snd: 'plastic', fric: 5 };
      add(new THREE.CylinderGeometry(0.055, 0.06, 0.2, 12), std({ color: 0x4fb0d9, roughness: 0.4 }), 0, 0.03, 0); add(new THREE.CylinderGeometry(0.022, 0.022, 0.05), std({ color: 0xf2c14e, roughness: 0.4 }), 0, 0.15, 0); break;
    case 'soap': d = { r: 0.03, name: 'bar of soap', snd: 'plastic', fric: 0.4, bounce: 0.2 };
      add(new THREE.BoxGeometry(0.08, 0.03, 0.05), std({ color: 0xf3c9e0, roughness: 0.3 }), 0, -0.012, 0); break;
    case 'sock': d = { r: 0.04, name: 'sock', snd: 'soft', fric: 8, bounce: 0, carry: true, sock: true }; {
      const m = std({ color: [0xd9534f, 0x4f9bd9, 0xf2c14e, 0x9bdb5a, 0xb07fd9][(Math.random() * 5) | 0], roughness: 1 });
      const a = add(new THREE.CapsuleGeometry(0.03, 0.1, 4, 8), m, 0, -0.012, 0); a.rotation.z = Math.PI / 2; a.scale.y = 0.6;
      const b = add(new THREE.CapsuleGeometry(0.03, 0.06, 4, 8), m, 0.07, -0.012, 0.035); b.rotation.x = Math.PI / 2; b.scale.y = 0.6;
    } break;
    case 'paper': d = { r: 0.02, name: 'paperwork', snd: 'paper', fric: 5, bounce: 0, light: true };
      add(new THREE.BoxGeometry(0.21, 0.002, 0.297), std({ color: 0xfbfaf5, roughness: 0.9 }), 0, -0.018, 0); break;
    case 'tproll': d = { r: 0.055, round: true, bounce: 0.2, fric: 1.2, name: 'toilet roll', snd: 'soft', trail: 'tp', col: 0xffffff }; {
      const m = add(new THREE.CylinderGeometry(0.055, 0.055, 0.1, 20), std({ color: 0xffffff, roughness: 0.95 })); m.rotation.z = Math.PI / 2;
      const c = add(new THREE.CylinderGeometry(0.02, 0.02, 0.102, 12), std({ color: 0xb89a70, roughness: 0.9 })); c.rotation.z = Math.PI / 2;
    } break;
    case 'bin': d = { r: 0.2, name: 'kitchen bin', snd: 'metal', fric: 5, mass: 3, tippy: true, spillBits: [0xf2ead8, 0x9bbb59, 0xd9534f, 0xc9a26b], score: 3 };
      add(new THREE.CylinderGeometry(0.17, 0.14, 0.5, 20), std({ color: 0x8a98a2, roughness: 0.35, metalness: 0.7 }), 0, 0.05, 0);
      add(new THREE.CylinderGeometry(0.175, 0.175, 0.03, 20), std({ color: 0x5c6870, roughness: 0.35, metalness: 0.7 }), 0, 0.31, 0); break;
    default: d = { r: 0.05, name: kind, snd: 'thud' }; add(new THREE.SphereGeometry(0.05, 10, 8), std({ color: col }));
  }
  return { g, d };
}

const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _u = new THREE.Vector3(), _ax = new THREE.Vector3();
const UPV = new THREE.Vector3(0, 1, 0);

export class Props {
  constructor(scene, world, assets) {
    this.scene = scene; this.world = world;
    this.lib = {}; assets.props.children.forEach(c => { this.lib[c.name] = c; });
    this.info = assets.propInfo;
    this.list = [];
    this.emit = () => {};
    assets.props.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.material.envMapIntensity = 0.7; if (o.material.transparent) { o.material.alphaTest = 0.4; o.material.transparent = false; } } });
    for (const m of new Set(Object.values(this.lib).flatMap(c => { const a = []; c.traverse(o => { if (o.isMesh) a.push(o.material); }); return a; }))) m.clippingPlanes = [world.clip];
    for (const p of world.data.props) this.spawn(p);
  }
  addProps(list) { for (const p of list) this.spawn(p); }

  spawn(p) {
    const id = p.asset, scale = p.scale || 1;
    const g = new THREE.Group();
    let d, inner;
    const src = this.lib[id.replace('#', '__')];
    if (src) {
      const s = this.info[id].size;
      const r = clamp(Math.min(Math.max(s[0], s[2]) / 2, Math.max(s[1] / 2, 0.022)), 0.022, 0.22) * scale;
      d = { r, bounce: 0.28, fric: 6, mass: 1, ...defFor(id) };
      d.r = r;
      inner = new THREE.Group(); inner.add(src.clone());       // keep the model's own (de-quantisation) transform intact
      inner.position.set(0, -r, 0); inner.scale.setScalar(scale);
      g.add(inner);
    } else {
      const b = buildProc(id, p); d = { bounce: 0.3, fric: 6, mass: 1, ...b.d }; g.add(b.g);
    }
    g.position.set(p.p[0], p.p[1] + d.r, p.p[2]);
    g.rotation.y = THREE.MathUtils.degToRad(p.rot || 0) + (src ? 0 : rnd(0, 6.28));
    this.scene.add(g);
    const P = { id, d, g, pos: g.position, vel: new THREE.Vector3(), spin: new THREE.Vector3(), r: d.r, asleep: true, still: 0,
      homeY: p.p[1], fallen: false, dead: false, held: false, name: d.name };
    this.list.push(P);
    return P;
  }

  kick(p, vx, vy, vz) {
    const k = 1 / (p.d.mass || 1);
    p.vel.x += vx * k; p.vel.y += vy * k; p.vel.z += vz * k;
    p.spin.set(rnd(-8, 8), rnd(-4, 4), rnd(-8, 8));
    p.asleep = false; p.still = 0;
  }

  // paw swipe / pounce: returns how many things were hit
  hit(e, radius = 0.3, power = 1) {
    let n = 0;
    for (const p of this.list) {
      if (p.dead || p.held) continue;
      const dx = p.pos.x - e.point.x, dy = p.pos.y - e.point.y, dz = p.pos.z - e.point.z, rr = radius + p.r;
      if (Math.abs(dy) > 0.42 || dx * dx + dz * dz > rr * rr) continue;
      const s = e.side || 0, sx = e.fz * s, sz = -e.fx * s;
      this.kick(p, (e.fx * 2.9 - sx * 1.3 + rnd(-0.3, 0.3)) * power, (p.d.round ? 2.2 : 1.5) * power, (e.fz * 2.9 - sz * 1.3 + rnd(-0.3, 0.3)) * power);
      if (p.d.tippy) this.tip(p, e.fx, e.fz);
      n++; this.emit('bap', p);
    }
    return n;
  }

  // heavy things do not tumble on their own: lay them over in the direction of the shove
  tip(p, fx, fz) {
    if (p.tipped) return;
    p.tipped = true;
    const l = Math.hypot(fx, fz) || 1;
    _ax.set(fz / l, 0, -fx / l); _q.setFromAxisAngle(_ax, Math.PI / 2);
    p.g.quaternion.premultiply(_q); p.spin.set(0, 0, 0);
    p.asleep = false; p.still = 0;
    this.emit('tipped', p);
  }

  nearest(pos, maxD, filter) {
    let best = null, bd = maxD * maxD;
    for (const p of this.list) {
      if (p.dead || p.held || (filter && !filter(p))) continue;
      const d = p.pos.distanceToSquared(pos);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  breakProp(p) { p.dead = true; this.scene.remove(p.g); this.emit('smash', p); }

  update(dt, cat) {
    const bd = this.world.bounds, boxes = this.world.boxes;
    const cx = cat.pos.x + Math.sin(cat.yaw) * 0.08, cz = cat.pos.z + Math.cos(cat.yaw) * 0.08, cy = cat.pos.y + 0.17;
    const cut = this.world.cut, lo = this.world.floorY(cat.pos.y) - 0.6;
    for (const p of this.list) {
      if (p.dead || p.held) continue;
      const dx = p.pos.x - cx, dy = p.pos.y - cy, dz = p.pos.z - cz, rr = 0.2 + p.r;
      // only what is near the cat and on its storey is drawn (hundreds of ornaments two houses away cost a lot)
      const near = dx * dx + dz * dz < (this.world.site ? 17 * 17 : 9 * 9) && p.pos.y < cut + 0.2 && p.pos.y > lo;
      if (near !== p.g.visible) p.g.visible = near;
      if (!near && p.asleep) continue;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < rr * rr && d2 > 1e-6) {          // the cat barges through
        const hd = Math.hypot(dx, dz) || 1e-3, nx = dx / hd, nz = dz / hd;
        const push = rr - Math.sqrt(d2), k = 1 / (p.d.mass || 1);
        p.pos.x += nx * push * 0.6 * Math.min(1, k * 1.2); p.pos.z += nz * push * 0.6 * Math.min(1, k * 1.2);
        const vn = Math.max(0, cat.vel.x * nx + cat.vel.z * nz);
        const want = (vn * 1.15 + 0.35) * k, have = p.vel.x * nx + p.vel.z * nz;
        if (have < want) { p.vel.x += nx * (want - have); p.vel.z += nz * (want - have); }
        if (p.asleep && vn > 0.5) this.emit('nudge', p);
        if (p.d.tippy && vn > 1.8) this.tip(p, nx, nz);
        p.asleep = false; p.still = 0;
      }
      if (p.asleep) continue;

      const d = p.d, r = p.r;
      p.vel.y -= G * dt * (d.light ? 0.25 : 1);
      if (d.light) { p.vel.x += Math.sin(p.pos.y * 9 + p.pos.x * 5) * 2.5 * dt; p.vel.z += Math.cos(p.pos.y * 8) * 2.5 * dt; p.vel.multiplyScalar(Math.exp(-2.5 * dt)); }
      p.pos.addScaledVector(p.vel, dt);
      let ground = false, impact = 0;
      const base = this.world.baseY(p.pos.x, p.pos.z);
      if (p.pos.y < base + r) { impact = Math.max(impact, -p.vel.y); p.pos.y = base + r; p.vel.y = -p.vel.y > 1 ? -p.vel.y * d.bounce : 0; ground = true; }
      for (const b of boxes) {
        if (p.pos.x < b.minX - r || p.pos.x > b.maxX + r || p.pos.y < b.minY - r || p.pos.y > b.maxY + r || p.pos.z < b.minZ - r || p.pos.z > b.maxZ + r) continue;
        const qx = clamp(p.pos.x, b.minX, b.maxX), qy = clamp(p.pos.y, b.minY, b.maxY), qz = clamp(p.pos.z, b.minZ, b.maxZ);
        let nx = p.pos.x - qx, ny = p.pos.y - qy, nz = p.pos.z - qz, dd = Math.hypot(nx, ny, nz), pen;
        if (dd > 1e-6) { if (dd >= r) continue; nx /= dd; ny /= dd; nz /= dd; pen = r - dd; }
        else {
          const up = b.maxY - p.pos.y, l = p.pos.x - b.minX, rt = b.maxX - p.pos.x, n = p.pos.z - b.minZ, f = b.maxZ - p.pos.z;
          const m = Math.min(up + 0.02, l, rt, n, f);
          nx = 0; ny = 0; nz = 0;
          if (m === up + 0.02) { ny = 1; pen = up + r; } else if (m === l) { nx = -1; pen = l + r; } else if (m === rt) { nx = 1; pen = rt + r; }
          else if (m === n) { nz = -1; pen = n + r; } else { nz = 1; pen = f + r; }
        }
        p.pos.x += nx * pen; p.pos.y += ny * pen; p.pos.z += nz * pen;
        const vn = p.vel.x * nx + p.vel.y * ny + p.vel.z * nz;
        if (vn < 0) {
          const e = -vn > 1 ? d.bounce : 0;
          p.vel.x -= (1 + e) * vn * nx; p.vel.y -= (1 + e) * vn * ny; p.vel.z -= (1 + e) * vn * nz;
          impact = Math.max(impact, -vn);
        }
        if (ny > 0.7) ground = true;
      }
      p.pos.x = clamp(p.pos.x, bd.x0 - 0.1, bd.x1 + 0.1); p.pos.z = clamp(p.pos.z, bd.z0 - 0.1, bd.z1 + 0.1);

      const sp = Math.hypot(p.vel.x, p.vel.z);
      if (ground) {
        const f = Math.exp(-d.fric * dt); p.vel.x *= f; p.vel.z *= f;
        if (!d.round) {
          p.spin.multiplyScalar(Math.exp(-12 * dt));
          _u.set(0, 1, 0).applyQuaternion(p.g.quaternion);     // settle upright or flat on its side
          if (_u.y > 0.75 || d.light) _q.setFromUnitVectors(_u, UPV);
          else { _v.set(_u.x, 0, _u.z); if (_v.lengthSq() < 1e-4) _v.set(1, 0, 0); _q.setFromUnitVectors(_u, _v.normalize()); }
          _q.multiply(p.g.quaternion);
          p.g.quaternion.slerp(_q, 1 - Math.exp(-10 * dt));
        }
      }
      if (d.round) {
        if (sp > 0.01) { _ax.set(p.vel.z, 0, -p.vel.x).normalize(); _q.setFromAxisAngle(_ax, sp * dt / r); p.g.quaternion.premultiply(_q); }
      } else if (p.spin.lengthSq() > 0.01) {
        const w = p.spin.length(); _ax.copy(p.spin).multiplyScalar(1 / w); _q.setFromAxisAngle(_ax, w * dt); p.g.quaternion.premultiply(_q);
      }
      p.onGround = ground; p.speed = sp;

      if (impact > 1.2) {
        if (d.brk && impact > d.tough) { this.breakProp(p); continue; }
        this.emit('impact', { p, impact });
        if (impact > 3 && !p.spilled && (d.spillBits || d.spill || d.splat)) { p.spilled = true; this.emit('spill', p); }
      }
      if (!p.fallen && p.homeY - this.world.floorY(p.homeY) > 0.3 && p.pos.y < p.homeY - 0.25) { p.fallen = true; this.emit('knocked', p); }
      if (ground && sp < 0.04 && Math.abs(p.vel.y) < 0.3) { p.still += dt; if (p.still > 0.6) { p.asleep = true; p.vel.set(0, 0, 0); } } else p.still = 0;
    }
  }
}
