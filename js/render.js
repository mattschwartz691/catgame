// Renderer, post-processing and adaptive quality.
import * as THREE from 'three';
import { EffectComposer } from '../vendor/addons/EffectComposer.js';
import { RenderPass } from '../vendor/addons/RenderPass.js';
import { ShaderPass } from '../vendor/addons/ShaderPass.js';
import { UnrealBloomPass } from '../vendor/addons/UnrealBloomPass.js';
import { OutputPass } from '../vendor/addons/OutputPass.js';
import { RoomEnvironment } from '../vendor/addons/RoomEnvironment.js';

// Final colour grade, applied on display-referred colour.
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uVig: { value: 0.32 }, uSat: { value: 1.1 }, uContrast: { value: 1.1 }, uWarm: { value: 0.02 }, uFade: { value: 0 }, uTime: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uVig, uSat, uContrast, uWarm, uFade, uTime; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSat);
      c = (c - 0.5) * uContrast + 0.5;
      c += vec3(uWarm, uWarm * 0.3, -uWarm);
      vec2 q = vUv - 0.5; float v = smoothstep(0.85, 0.2, length(q * vec2(1.0, 1.15)));
      c *= mix(1.0 - uVig, 1.0, v);
      float n = fract(sin(dot(vUv * (uTime + 1.0), vec2(12.9898, 78.233))) * 43758.5453);
      c += (n - 0.5) * 0.012;
      c = mix(c, vec3(0.02, 0.015, 0.02), uFade);
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export const TIERS = {
  high: { post: true, bloom: true, msaa: 4, pr: 2, shadow: 4096, shells: 16 },
  medium: { post: true, bloom: true, msaa: 4, pr: 1.5, shadow: 2048, shells: 10 },
  low: { post: false, bloom: false, msaa: 0, pr: 1.25, shadow: 2048, shells: 7 },
  potato: { post: false, bloom: false, msaa: 0, pr: 1, shadow: 1024, shells: 4 },
};
const ORDER = ['potato', 'low', 'medium', 'high'];

export function pickTier() {
  const q = new URLSearchParams(location.search).get('q');
  if (q && TIERS[q]) return q;
  try { const s = localStorage.getItem('quality'); if (s && TIERS[s]) return s; } catch {}
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform));
  const mem = navigator.deviceMemory || (mobile ? 4 : 8);
  if (!mobile) return 'high';
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent) || /Mac/.test(navigator.platform);   // no deviceMemory there; recent iPhones are quick
  return ios || mem >= 6 ? 'medium' : 'low';
}

export class Renderer {
  constructor(canvas, tierName) {
    this.canvas = canvas;
    this.tierName = tierName; this.tier = TIERS[tierName];
    const r = this.r = new THREE.WebGLRenderer({ canvas, antialias: !this.tier.post, powerPreference: 'high-performance', stencil: false });
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.95;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.scale = 1;          // dynamic resolution multiplier
    this.frameMs = 16; this.slow = 0; this.fast = 0;
    this.onTier = () => {};
  }

  envMap() {
    const pm = new THREE.PMREMGenerator(this.r);
    const t = pm.fromScene(new RoomEnvironment(), 0.03).texture; pm.dispose();
    return t;
  }

  setup(scene, camera) {
    this.scene = scene; this.camera = camera;
    this.buildComposer();
    this.resize();
  }

  buildComposer() {
    if (this.bloom) { this.bloom.dispose(); this.bloom = null; }
    if (this.composer) { this.composer.dispose(); this.composer = null; }
    if (!this.tier.post) { this.r.toneMapping = THREE.ACESFilmicToneMapping; return; }
    const size = this.r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(Math.max(4, size.x), Math.max(4, size.y), { type: THREE.HalfFloatType, samples: this.tier.msaa });
    const c = this.composer = new EffectComposer(this.r, rt);
    c.addPass(new RenderPass(this.scene, this.camera));
    if (this.tier.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.22, 0.55, 1.0);
      c.addPass(this.bloom);
    }
    c.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    c.addPass(this.grade);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, this.tier.pr) * this.scale;
    this.r.setPixelRatio(pr);
    this.r.setSize(w, h, false);
    if (this.composer) { this.composer.setPixelRatio(pr); this.composer.setSize(w, h); }
  }

  setTier(name) {
    if (name === this.tierName || !TIERS[name]) return;
    this.tierName = name; this.tier = TIERS[name]; this.scale = 1;
    this.buildComposer(); this.resize(); this.onTier(this.tier, name);
  }

  // Watch frame time and trade resolution / effects for smoothness.
  adapt(dt) {
    this.warm = (this.warm || 0) + dt;
    if (this.warm < 6 || document.hidden || this.locked) return;          // ignore shader-compile and loading hitches
    this.frameMs += (dt * 1000 - this.frameMs) * 0.05;
    if (this.frameMs > 24) { this.slow += dt; this.fast = 0; } else if (this.frameMs < 14) { this.fast += dt; this.slow = 0; } else { this.slow = Math.max(0, this.slow - dt); this.fast = 0; }
    if (this.slow > 2.5) {
      this.slow = 0;
      if (this.scale > 0.72) { this.scale -= 0.14; this.resize(); }
      else { const i = ORDER.indexOf(this.tierName); if (i > 0) this.setTier(ORDER[i - 1]); }
    }
  }

  render(time = 0, fade = 0) {
    if (this.composer) { this.grade.uniforms.uTime.value = time % 10; this.grade.uniforms.uFade.value = fade; this.composer.render(); }
    else this.r.render(this.scene, this.camera);
  }
}
