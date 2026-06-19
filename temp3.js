/* ═══════════════════════════════════════════════════════════════
   CS Galaxy — index.js
   Three.js immersive space learning visualizer
   ═══════════════════════════════════════════════════════════════ */

'use strict';

// ─── UNIVERSAL TWEAK CONFIG ─────────────────────────────────────
const CONFIG = {
  domainRadiusBase: 140,
  domainRadiusStep: 10,
  subjectRadiusBase: 24,
  subjectRadiusStep: 8,
  chapterRadiusBase: 10,
  chapterRadiusStep: 3.5,
  subtopicRadiusBase: 5,
  subtopicRadiusStep: 2,
  conceptRadiusBase: 2,
  conceptRadiusStep: 0.7,
};

// ─── State ────────────────────────────────────────────────────
const STATE = {
  speed: 0.1,
  showOrbits: true,
  showTrails: true,
  audioOn: true,
  completed: {},          // key: nodeId → true
  searchQuery: '',
  hoveredNode: null,
  selectedNode: null,
  time: 0,
};

// ─── Audio ────────────────────────────────────────────────────
let audioCtx = null;
let drones = [];

function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const masterGain = audioCtx.createGain();
  masterGain.gain.setValueAtTime(0.35, audioCtx.currentTime);
  masterGain.connect(audioCtx.destination);

  const convolver = audioCtx.createConvolver();
  const impulseLen = audioCtx.sampleRate * 8;
  const impulse = audioCtx.createBuffer(2, impulseLen, audioCtx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = impulse.getChannelData(c);
    for (let i = 0; i < impulseLen; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / impulseLen, 2);
  }
  convolver.buffer = impulse;
  convolver.connect(masterGain);

  const freqs = [55, 82.4, 110, 146.8, 164.8, 220, 277, 329.6];
  freqs.forEach((f, i) => {
    const osc = audioCtx.createOscillator();
    const lfo = audioCtx.createOscillator();
    const lfoGain = audioCtx.createGain();
    const g = audioCtx.createGain();
    const dryGain = audioCtx.createGain();
    const wetGain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f, audioCtx.currentTime);
    lfo.frequency.setValueAtTime(0.03 + i * 0.015, audioCtx.currentTime);
    lfoGain.gain.setValueAtTime(f * 0.015, audioCtx.currentTime);
    lfo.connect(lfoGain); lfoGain.connect(osc.frequency);
    g.gain.setValueAtTime(0.6 / freqs.length, audioCtx.currentTime);
    dryGain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    wetGain.gain.setValueAtTime(0.85, audioCtx.currentTime);
    osc.connect(g);
    g.connect(dryGain); dryGain.connect(masterGain);
    g.connect(wetGain); wetGain.connect(convolver);
    osc.start(); lfo.start();
    drones.push({ osc, gain: g, lfo });
  });
}

function setAudio(on) {
  if (on) {
    initAudio();
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  } else {
    if (audioCtx) audioCtx.suspend();
  }
}

// ─── Completion helpers ────────────────────────────────────────
function getKey(node) { return node.userData.id; }

function isCompleted(node) { return !!STATE.completed[getKey(node)]; }

function toggleCompleted(nodeId) {
  STATE.completed[nodeId] = !STATE.completed[nodeId];
  try { localStorage.setItem('cs_galaxy_progress', JSON.stringify(STATE.completed)); } catch (_) {}
  updateAllNodeMaterials();
  refreshPanel();
  triggerRipple(nodeId);
}

function loadProgress() {
  try {
    const s = localStorage.getItem('cs_galaxy_progress');
    if (s) Object.assign(STATE.completed, JSON.parse(s));
  } catch (_) {}
}

// ─── Three.js Setup ───────────────────────────────────────────
const canvas = document.getElementById('galaxy-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000008);
scene.fog = new THREE.FogExp2(0x000010, 0.00012);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 20000);
camera.position.set(0, 180, 420);

const controls = new THREE.OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 20;
controls.maxDistance = 4000;
controls.autoRotate = false;

// ─── Gravitational Lensing Post-Process ───────────────────────
const lensShader = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    bhScreen: { value: new THREE.Vector2(0.5, 0.5) },
    bhStrength: { value: 0.025 },
    bhRadius: { value: 0.05 },
    aspect: { value: window.innerWidth / window.innerHeight },
    bhVisible: { value: 1.0 },
    uBhDepth: { value: 0.5 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform vec2 bhScreen;
    uniform float bhStrength;
    uniform float bhRadius;
    uniform float aspect;
    uniform float bhVisible;
    uniform float uBhDepth;
    varying vec2 vUv;
    void main() {
      vec2 uv = vUv;
      float sceneDepth = texture2D(tDepth, uv).r;
      if (sceneDepth < uBhDepth - 0.0006) {
        gl_FragColor = texture2D(tDiffuse, uv);
        return;
      }
      vec2 diff = uv - bhScreen;
      diff.x *= aspect;
      float dist = length(diff);
      float bend = bhStrength * bhRadius / max(dist, 0.0001);
      bend *= smoothstep(bhRadius * 3.0, bhRadius * 1.0, dist);
      vec2 dir = normalize(diff + 0.00001);
      dir.x /= aspect;
      vec2 warpedUv = uv - dir * bend * bhVisible;
      gl_FragColor = texture2D(tDiffuse, warpedUv);
    }
  `
};

const accretionDiskShader = {
  uniforms: { uTime: { value: 0 }, uInner: { value: 26.0 }, uOuter: { value: 160.0 } },
  vertexShader: `
    varying vec2 vPos;
    void main() {
      vPos = position.xy;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform float uTime; uniform float uInner; uniform float uOuter;
    varying vec2 vPos;
    float hash(float n) { return fract(sin(n) * 43758.5453123); }
    float noise(vec2 p) {
      vec2 i = floor(p); vec2 f = fract(p);
      float a = hash(i.x + i.y * 57.0);
      float b = hash(i.x + 1.0 + i.y * 57.0);
      float c = hash(i.x + (i.y + 1.0) * 57.0);
      float d = hash(i.x + 1.0 + (i.y + 1.0) * 57.0);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
    }
    vec2 rotate(vec2 p, float a) {
      float s = sin(a), c = cos(a);
      return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
    }
    void main() {
      float dist = length(vPos);
      float t = (dist - uInner) / (uOuter - uInner);
      if (dist < uInner || dist > uOuter) discard;
      float shear = -uTime * (2.0 - t) * 0.25;
      vec2 rp = rotate(vPos, shear);
      float turb = noise(rp * 0.06) * 0.6 + noise(rp * 0.16 + 11.0) * 0.4;
      float edgeFade = smoothstep(0.0, 0.22, t) * smoothstep(1.0, 0.65, t);
      float heat = 1.0 - t;
      vec3 hot = vec3(1.0, 0.95, 0.85);
      vec3 mid = vec3(1.0, 0.55, 0.1);
      vec3 cool = vec3(0.6, 0.1, 0.05);
      vec3 color = mix(mid, hot, smoothstep(0.0, 0.35, heat));
      color = mix(cool, color, smoothstep(0.0, 0.6, heat));
      float alpha = edgeFade * (0.18 + turb * 0.32);
      gl_FragColor = vec4(color * (0.6 + turb * 0.8), alpha);
    }
  `
};

const depthRenderTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight);
depthRenderTarget.depthTexture = new THREE.DepthTexture(window.innerWidth, window.innerHeight);
depthRenderTarget.depthTexture.type = THREE.UnsignedShortType;

const composer = new THREE.EffectComposer(renderer);
const renderPass = new THREE.RenderPass(scene, camera);
composer.addPass(renderPass);
const lensPass = new THREE.ShaderPass(new THREE.ShaderMaterial(lensShader), 'tDiffuse');
lensPass.renderToScreen = true;
composer.addPass(lensPass);

const _bhNdc = new THREE.Vector3();
const _bhWorldRadius = 28;
function updateLensUniforms() {
  _bhNdc.copy(blackHoleMesh.position).project(camera);
  lensPass.uniforms.bhScreen.value.set((_bhNdc.x + 1) / 2, (_bhNdc.y + 1) / 2);
  lensPass.uniforms.aspect.value = window.innerWidth / window.innerHeight;
  lensPass.uniforms.bhVisible.value = _bhNdc.z < 1 ? 1.0 : 0.0;
  lensPass.uniforms.uBhDepth.value = (_bhNdc.z + 1.0) / 2.0;

  const dist = camera.position.distanceTo(blackHoleMesh.position);
  const fovRad = camera.fov * Math.PI / 180;
  const screenHeightAtDist = 2 * Math.tan(fovRad / 2) * dist;
  const radiusNdc = (_bhWorldRadius / screenHeightAtDist) * 1.6;
  lensPass.uniforms.bhRadius.value = Math.min(Math.max(radiusNdc, 0.03), 0.4);
}
// ─── Lighting ─────────────────────────────────────────────────
const ambientLight = new THREE.AmbientLight(0x0a0a1a, 1.2);
scene.add(ambientLight);

// Black hole core subtle emanation
const coreLight = new THREE.PointLight(0x222222, 6, 300);
coreLight.position.set(0, 0, 0);
scene.add(coreLight);

const diskLight = new THREE.PointLight(0xff9944, 4.5, 260, 2);
diskLight.position.set(0, 0, 0);
scene.add(diskLight);

// ─── Procedural Textures ─────────────────────────────────────
function makeProceduralTexture(size, fn) {
  const canvas2 = document.createElement('canvas');
  canvas2.width = canvas2.height = size;
  const ctx = canvas2.getContext('2d');
  fn(ctx, size);
  return new THREE.CanvasTexture(canvas2);
}

function makeGalaxyTexture(size = 128) {
  return makeProceduralTexture(size, (ctx, sz) => {
    const cx = sz / 2, cy = sz / 2;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, sz * 0.5);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.15, 'rgba(255,240,220,0.55)');
    grad.addColorStop(0.4, 'rgba(180,180,255,0.22)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(cx, cy, sz * 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    for (let arm = 0; arm < 2; arm++) {
      ctx.beginPath();
      for (let i = 0; i < 200; i++) {
        const t = i / 200;
        const ang = t * Math.PI * 4 + arm * Math.PI;
        const r = t * sz * 0.45;
        const x = cx + Math.cos(ang) * r;
        const y = cy + Math.sin(ang) * r * 0.55;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = 'rgba(200,210,255,0.18)';
      ctx.lineWidth = sz * 0.05;
      ctx.stroke();
    }
  });
}

function buildDistantGalaxies() {
  const tex = makeGalaxyTexture(128);
  for (let i = 0; i < 9; i++) {
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.3 + Math.random() * 0.25, blending: THREE.AdditiveBlending, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 2 - 1);
    const r = 5000 + Math.random() * 4000;
    sprite.position.set(r * Math.sin(phi) * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta) * 0.6, r * Math.cos(phi));
    const s = 300 + Math.random() * 500;
    sprite.scale.set(s, s * 0.6, 1);
    sprite.material.rotation = Math.random() * Math.PI * 2;
    scene.add(sprite);
  }
}

function makeStarGlowTexture(color, size = 64) {
  return makeProceduralTexture(size, (ctx, sz) => {
    const cx = sz / 2, cy = sz / 2;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, sz * 0.5);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, sz, sz);
  });
}

function buildSupernovae() {
  for (let i = 0; i < 6; i++) {
    const tex = makeStarGlowTexture('rgba(255,160,200,0.9)', 96);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.5 + Math.random() * 0.3, blending: THREE.AdditiveBlending, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 2 - 1);
    const r = 4000 + Math.random() * 5000;
    sprite.position.set(r * Math.sin(phi) * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta), r * Math.cos(phi));
    const s = 150 + Math.random() * 250;
    sprite.scale.set(s, s, 1);
    scene.add(sprite);
  }
}

function buildBrightStars() {
  const colors = ['rgba(255,220,180,0.8)', 'rgba(180,210,255,0.8)', 'rgba(255,180,180,0.8)', 'rgba(220,255,230,0.8)'];
  for (let i = 0; i < 40; i++) {
    const color = colors[Math.floor(Math.random() * colors.length)];
    const tex = makeStarGlowTexture(color, 64);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 2 - 1);
    const r = 1500 + Math.random() * 6000;
    sprite.position.set(r * Math.sin(phi) * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta), r * Math.cos(phi));
    const s = 20 + Math.random() * 140;
    sprite.scale.set(s, s, 1);
    scene.add(sprite);
  }
}

function noise(x, y, seed = 0) {  const n = Math.sin(x * 127.1 + y * 311.7 + seed) * 43758.5453;
  return n - Math.floor(n);
}

function fbm(x, y, seed = 0, octaves = 5) {
  let v = 0, amp = 0.5, freq = 1, max = 0;
  for (let i = 0; i < octaves; i++) {
    v += noise(x * freq, y * freq, seed + i * 137) * amp;
    max += amp; amp *= 0.5; freq *= 2.1;
  }
  return v / max;
}

const PLANET_CONFIGS = [
  // [baseH, saturation style, type]
  { h1: 200, h2: 240, s: 80, type: 'rocky' },     // ice world
  { h1: 30,  h2: 60,  s: 90, type: 'desert' },    // desert
  { h1: 120, h2: 160, s: 70, type: 'forest' },    // forest
  { h1: 0,   h2: 20,  s: 85, type: 'lava' },      // lava
  { h1: 190, h2: 220, s: 75, type: 'ocean' },     // ocean
  { h1: 260, h2: 290, s: 60, type: 'gas' },       // gas giant purple
  { h1: 40,  h2: 80,  s: 60, type: 'gas' },       // gas giant yellow
  { h1: 340, h2: 360, s: 80, type: 'rocky' },     // red rocky
];

function makePlanetTexture(seed, size = 256) {
  const cfg = PLANET_CONFIGS[seed % PLANET_CONFIGS.length];
  return makeProceduralTexture(size, (ctx, sz) => {
    const img = ctx.createImageData(sz, sz);
    const d = img.data;
    for (let y = 0; y < sz; y++) {
      for (let x = 0; x < sz; x++) {
        const u = x / sz, v = y / sz;
        const n = fbm(u * 3, v * 3, seed * 17);
        const n2 = fbm(u * 8 + 1, v * 8 + 1, seed * 31);
        let h, s, l;
        if (cfg.type === 'gas') {
          const band = Math.sin(v * Math.PI * 8 + n * 2) * 0.5 + 0.5;
          h = cfg.h1 + (cfg.h2 - cfg.h1) * band;
          s = cfg.s - n2 * 20;
          l = 35 + band * 25 + n2 * 15;
        } else if (cfg.type === 'ocean') {
          h = n > 0.52 ? 110 + n2 * 30 : cfg.h1 + n2 * 20;
          s = n > 0.52 ? 60 : 80;
          l = n > 0.52 ? 30 + n * 20 : 20 + n * 30;
        } else if (cfg.type === 'lava') {
          h = n > 0.5 ? 0 + n2 * 30 : 20 + n2 * 20;
          s = 90;
          l = n > 0.5 ? 50 + n2 * 30 : 8 + n * 10;
        } else {
          h = cfg.h1 + (cfg.h2 - cfg.h1) * n;
          s = cfg.s - n2 * 15;
          l = 20 + n * 35 + n2 * 15;
        }
        // hsl to rgb
        const [r, g, b] = hsl2rgb(h / 360, s / 100, l / 100);
        const idx = (y * sz + x) * 4;
        d[idx] = r; d[idx+1] = g; d[idx+2] = b; d[idx+3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
}

function makeBumpTexture(seed, size = 256) {
  return makeProceduralTexture(size, (ctx, sz) => {
    const img = ctx.createImageData(sz, sz);
    const d = img.data;
    for (let y = 0; y < sz; y++) {
      for (let x = 0; x < sz; x++) {
        const u = x/sz, v = y/sz;
        const n = fbm(u*6, v*6, seed*13) * 255;
        const idx = (y*sz+x)*4;
        d[idx] = d[idx+1] = d[idx+2] = n; d[idx+3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
}

function makeSunTexture(seed, size = 256) {
  return makeProceduralTexture(size, (ctx, sz) => {
    const img = ctx.createImageData(sz, sz);
    const d = img.data;
    const cx = sz/2, cy = sz/2;
    for (let y = 0; y < sz; y++) {
      for (let x = 0; x < sz; x++) {
        const u = x/sz, v = y/sz;
        const n = fbm(u*4, v*4, seed*7, 6);
        const n2 = fbm(u*10+2, v*10+2, seed*13, 4);
        const dx = (x-cx)/cx, dy = (y-cy)/cy;
        const dist = Math.sqrt(dx*dx+dy*dy);
        const temp = 1 - dist * 0.6 + n * 0.3;
        // corona colors: yellow → orange → red → dark
        const r = Math.min(255, temp * 280 + n2 * 60);
        const g = Math.min(255, temp * 160 + n2 * 20);
        const b = Math.min(255, temp * 20 + n2 * 10);
        const idx = (y*sz+x)*4;
        d[idx] = r; d[idx+1] = g; d[idx+2] = b; d[idx+3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
}

let _accretionIconURL = null;
function getAccretionDiskIcon(size = 128) {
  if (_accretionIconURL) return _accretionIconURL;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  const cx = size / 2, cy = size / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, 0.38);
  ctx.translate(-cx, -cy);
  const grad = ctx.createRadialGradient(cx, cy, size * 0.16, cx, cy, size * 0.5);
  grad.addColorStop(0, '#000000');
  grad.addColorStop(0.32, '#ff4d0099');
  grad.addColorStop(0.55, '#ffd700dd');
  grad.addColorStop(0.78, '#ff8800aa');
  grad.addColorStop(1, '#00000000');
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.5, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.17, 0, Math.PI * 2);
  ctx.fillStyle = '#000';
  ctx.fill();
  _accretionIconURL = c.toDataURL();
  return _accretionIconURL;
}

function hsl2rgb(h, s, l) {
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1/6) return p + (q-p)*6*t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q-p)*(2/3-t)*6;
      return p;
    };
    const q = l < 0.5 ? l*(1+s) : l+s-l*s;
    const p = 2*l-q;
    r = hue2rgb(p,q,h+1/3); g = hue2rgb(p,q,h); b = hue2rgb(p,q,h-1/3);
  }
  return [Math.round(r*255), Math.round(g*255), Math.round(b*255)];
}

// ─── Node Registry ───────────────────────────────────────────
const allNodes = [];         // all Three.js mesh objects with userData
const orbits = [];           // {mesh, radius, parent, speed, angle, inclination}
const trails = [];           // {mesh, points, maxLen}
const ripples = [];          // {mesh, born, nodeId}
const connections = [];      // {line, from, to}
const nodeLookup = {};       // id → mesh

// ─── Starfield ────────────────────────────────────────────────
function buildStarfield() {
  const count = 12000;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  const starColors = [
    [1, 1, 1], [0.8, 0.9, 1], [1, 0.9, 0.7], [0.7, 0.8, 1], [1, 0.7, 0.6]
  ];
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 2 - 1);
    const r = 3000 + Math.random() * 7000;
    pos[i*3] = r * Math.sin(phi) * Math.cos(theta);
    pos[i*3+1] = r * Math.sin(phi) * Math.sin(theta);
    pos[i*3+2] = r * Math.cos(phi);
    sizes[i] = Math.random() * 2.5 + 0.3;
    const c = starColors[Math.floor(Math.random() * starColors.length)];
    colors[i*3] = c[0]; colors[i*3+1] = c[1]; colors[i*3+2] = c[2];
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: 1.8, sizeAttenuation: true, vertexColors: true,
    transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false
  });
  scene.add(new THREE.Points(geo, mat));
}

// ─── Nebula Clouds ───────────────────────────────────────────
function buildNebulae() {
  const nebulaColors = [0x1a0030, 0x001a40, 0x002010, 0x300010, 0x301a00, 0x1a0010, 0x002a2a, 0x2a0030];
  for (let n = 0; n < 8; n++) {
    const count = 800;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const cx = (Math.random()-0.5)*2000;
    const cy = (Math.random()-0.5)*1000;
    const cz = (Math.random()-0.5)*2000;
    for (let i = 0; i < count; i++) {
      pos[i*3]   = cx + (Math.random()-0.5)*600;
      pos[i*3+1] = cy + (Math.random()-0.5)*300;
      pos[i*3+2] = cz + (Math.random()-0.5)*600;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      size: 18, color: nebulaColors[n], transparent: true, opacity: 0.04, sizeAttenuation: true
    });
    scene.add(new THREE.Points(geo, mat));
  }
}

// ─── Black Hole ───────────────────────────────────────────────
let blackHoleMesh, accretionMesh;
function buildBlackHole() {
  // Core (dark sphere)
  const geo = new THREE.SphereGeometry(19, 64, 64);
  const mat = new THREE.MeshBasicMaterial({ color: 0x000000, depthWrite: true, depthTest: true });
  blackHoleMesh = new THREE.Mesh(geo, mat);
  blackHoleMesh.renderOrder = 999;
  blackHoleMesh.userData = {
    id: 'root',
    type: 'root',
    label: 'Computer Engineering',
    level: 0
  };
  scene.add(blackHoleMesh);
  allNodes.push(blackHoleMesh);
  nodeLookup['root'] = blackHoleMesh;

  // Photon ring glow (torus)
  const ring1 = new THREE.Mesh(
    new THREE.TorusGeometry(24, 0.3, 32, 128),
    new THREE.MeshBasicMaterial({ color: 0x555555, transparent: true, opacity: 0.08 })
  );
  ring1.rotation.x = Math.PI / 2;
  scene.add(ring1);

  // Accretion disk — real shader-driven glowing disk
  const accGeo = new THREE.RingGeometry(26, 160, 256, 1);
  const accMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(accretionDiskShader.uniforms),
    vertexShader: accretionDiskShader.vertexShader,
    fragmentShader: accretionDiskShader.fragmentShader,
    transparent: true, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthWrite: false
  });
  accretionMesh = new THREE.Mesh(accGeo, accMat);
  accretionMesh.rotation.x = Math.PI / 2 + 0.2;
  scene.add(accretionMesh);

  // Gravitational lensing effect — outer glow sphere
  const lensGeo = new THREE.SphereGeometry(28, 32, 32);
  const lensMat = new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.03, side: THREE.BackSide });
  scene.add(new THREE.Mesh(lensGeo, lensMat));
}

// ─── Orbit Ring ───────────────────────────────────────────────
function makeOrbitLine(radius, inclination = 0, color = 0x334466, opacity = 0.25) {
  const segments = 128;
  const geo = new THREE.BufferGeometry();
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push(Math.cos(a) * radius, 0, Math.sin(a) * radius);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
  const line = new THREE.Line(geo, mat);
  line.rotation.x = inclination;
  line.userData.isOrbit = true;
  return line;
}

// ─── Trail ────────────────────────────────────────────────────
function makeTrail(color, maxLen = 60) {
  const posArr = new Float32Array(maxLen * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.4, vertexColors: false });
  const line = new THREE.Line(geo, mat);
  line.userData.isTrail = true;
  line.frustumCulled = false;
  scene.add(line);
  const points = [];
  for (let i = 0; i < maxLen; i++) points.push(new THREE.Vector3());
  return { line, points, head: 0, maxLen, posArr };
}

function updateTrail(trail, pos) {
  trail.points[trail.head].copy(pos);
  trail.head = (trail.head + 1) % trail.maxLen;
  const arr = trail.posArr;
  for (let i = 0; i < trail.maxLen; i++) {
    const p = trail.points[(trail.head + i) % trail.maxLen];
    arr[i*3] = p.x; arr[i*3+1] = p.y; arr[i*3+2] = p.z;
  }
  trail.line.geometry.attributes.position.needsUpdate = true;
}

// ─── Connection Pulse Lines ────────────────────────────────────
function makeConnection(fromMesh, toMesh, color = 0x223355) {
  const pts = [fromMesh.position.clone(), toMesh.position.clone()];
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.15 });
  const line = new THREE.Line(geo, mat);
  line.userData.isConnection = true;
  line.frustumCulled = false;
  scene.add(line);
  connections.push({ line, from: fromMesh, to: toMesh, mat });
}

function updateConnections() {
  for (const c of connections) {
    const pos = c.line.geometry.attributes.position;
    pos.array[0] = c.from.position.x; pos.array[1] = c.from.position.y; pos.array[2] = c.from.position.z;
    pos.array[3] = c.to.position.x;   pos.array[4] = c.to.position.y;   pos.array[5] = c.to.position.z;
    pos.needsUpdate = true;
    const completed = isCompleted(c.from) && isCompleted(c.to);
    c.mat.color.setHex(completed ? 0xffd700 : 0x223355);
    c.mat.opacity = completed ? 0.45 : 0.15;
  }
}

// ─── Ripple Effect ────────────────────────────────────────────
function triggerRipple(nodeId) {
  const mesh = nodeLookup[nodeId];
  if (!mesh) return;
  const geo = new THREE.RingGeometry(0.1, 0.5, 48);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffd700, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(geo, mat);
  ring.position.copy(mesh.position);
  ring.lookAt(camera.position);
  scene.add(ring);
  ripples.push({ mesh: ring, born: STATE.time, nodeId, baseMesh: mesh });
}

// ─── Node Material Helpers ────────────────────────────────────
function getNodeColor(level) {
  const colors = [0x000000, 0xff6a00, 0xffd700, 0x7ec8e3, 0xb0c4ff, 0xffffff];
  return colors[Math.min(level, colors.length - 1)];
}

function applyCompletionStyle(mesh) {
  const done = isCompleted(mesh);
  const mat = mesh.material;
  if (!mat) return;
  const level = mesh.userData.level || 0;
  if (done) {
    if (mat.emissive) {
      mat.emissive.setHex(0xffd700);
      mat.emissiveIntensity = level <= 2 ? 2.5 : 1.5;
    }
    if (mat.opacity !== undefined) mat.opacity = 1;
    mat.color && mat.color.setHex(0xffd700);
  } else {
    const baseColor = getNodeColor(level);
    mat.color && mat.color.setHex(baseColor);
    if (mat.emissive) {
      mat.emissive.setHex(level <= 2 ? baseColor : 0x000000);
      mat.emissiveIntensity = level <= 2 ? 1.2 : 0;
    }
    if (mat.opacity !== undefined) mat.opacity = level >= 4 ? 0.55 : 1;
  }
}

function updateAllNodeMaterials() {
  for (const n of allNodes) applyCompletionStyle(n);
}

let highlightedChildren = [];
function clearHighlights() {
  for (const n of highlightedChildren) {
    applyCompletionStyle(n);
  }
  highlightedChildren = [];
}
function highlightChildren(mesh) {
  const childOrbs = orbits.filter(o => o.parentMesh === mesh && !o.isInstanced);
  for (const o of childOrbs) {
    const m = o.mesh;
    if (m.material && m.material.emissive) {
      m.material.emissive.setHex(0xffffff);
      m.material.emissiveIntensity = 3;
      highlightedChildren.push(m);
    }
  }
}

// ─── Node Point Light (suns) ──────────────────────────────────
function addSunLight(mesh, color) {
  return;
}

// ─── Build Galaxy from JSON ───────────────────────────────────
let jsonData = null;

function idFor(...parts) { return parts.join('__').replace(/\s+/g, '_'); }

function makeSphere(radius, segments = 32) {
  return new THREE.SphereGeometry(radius, segments, segments);
}

function registerNode(mesh, id, label, type, level, extra = {}) {
  mesh.userData = { id, label, type, level, ...extra };
  allNodes.push(mesh);
  nodeLookup[id] = mesh;
  applyCompletionStyle(mesh);
  return mesh;
}

let domainSeed = 0;
function buildGalaxy(data) {
  jsonData = data;
  buildBlackHole();

  const domains = data.domains || [];
  const domainCount = domains.length;

  domains.forEach((domain, di) => {
    const domainRadius = CONFIG.domainRadiusBase + di * CONFIG.domainRadiusStep;
    const dAngle = (di / domainCount) * Math.PI * 2 + di * 0.6;
    const dIncl = (di / domainCount) * 0.5 - 0.25;
    domainSeed++;

    // Domain supercluster — large glowing sun
    const dColor = new THREE.Color().setHSL(di / domainCount, 0.85, 0.55);
    const dColorHex = dColor.getHex();
    const dTex = makeSunTexture(domainSeed * 3, 256);
    const dGeo = makeSphere(7, 48);
    const dBump = makeBumpTexture(domainSeed * 3, 256);
    const dMat = new THREE.MeshStandardMaterial({
      map: dTex, bumpMap: dBump, bumpScale: 0.2, emissive: dColor, emissiveIntensity: 1.8,
      roughness: 0.6, metalness: 0
    });
    const dMesh = new THREE.Mesh(dGeo, dMat);
    scene.add(dMesh);
    registerNode(dMesh, idFor('domain', domain.domain), domain.domain, 'domain', 1, { domain: domain.domain });
    addSunLight(dMesh, dColorHex);

    // Domain point light
    const dLight = new THREE.PointLight(dColorHex, 2.5, 280);
    dMesh.add(dLight);

    // Domain orbit
    const dOrbitLine = makeOrbitLine(domainRadius, dIncl, dColorHex, 0.2);
    scene.add(dOrbitLine);

    orbits.push({
      mesh: dMesh,
      radius: domainRadius,
      parentMesh: blackHoleMesh,
      speed: 0.05 + Math.random() * 0.04,
      angle: dAngle,
      inclination: dIncl,
      orbitLine: dOrbitLine,
    });
    makeConnection(blackHoleMesh, dMesh, dColorHex);

    const dTrail = makeTrail(dColorHex, 80);
    trails.push({ trail: dTrail, mesh: dMesh });

    // Subjects = suns around domain
    const subjects = domain.subjects || [];
    subjects.forEach((subj, si) => {
      domainSeed++;
      const sRadius = CONFIG.subjectRadiusBase + si * CONFIG.subjectRadiusStep;
      const sAngle = (si / Math.max(subjects.length, 1)) * Math.PI * 2;
      const sIncl = (Math.random() - 0.5) * 0.5;
      const sTex = makeSunTexture(domainSeed * 5, 128);
      const sColor = new THREE.Color().setHSL((di / domainCount + 0.05 * si) % 1, 0.75, 0.62);
      const sColorHex = sColor.getHex();
      const sGeo = makeSphere(4, 32);
      const sBump = makeBumpTexture(domainSeed * 5, 128);
      const sMat = new THREE.MeshStandardMaterial({
        map: sTex, bumpMap: sBump, bumpScale: 0.25, emissive: sColor, emissiveIntensity: 1.4, roughness: 0.5
      });
      const sMesh = new THREE.Mesh(sGeo, sMat);
      scene.add(sMesh);
      registerNode(sMesh, idFor('subj', domain.domain, subj.name), subj.name, 'subject', 2, {
        domain: domain.domain, difficulty: subj.difficulty, type: subj.type
      });
      addSunLight(sMesh, sColorHex);
      const sLight = new THREE.PointLight(sColorHex, 1.5, 100);
      sMesh.add(sLight);

      const sOrbitLine = makeOrbitLine(sRadius, sIncl, sColorHex, 0.18);
      dMesh.add(sOrbitLine);

      orbits.push({
        mesh: sMesh,
        radius: sRadius,
        parentMesh: dMesh,
        speed: 0.12 + Math.random() * 0.08,
        angle: sAngle,
        inclination: sIncl,
        orbitLine: sOrbitLine,
        orbitParent: dMesh,
      });
      makeConnection(dMesh, sMesh, sColorHex);
      const sTrail = makeTrail(sColorHex, 60);
      trails.push({ trail: sTrail, mesh: sMesh });

      // Chapters = planets around subject-sun
      const chapters = subj.chapters || [];
      chapters.forEach((chap, ci) => {
        domainSeed++;
        const cRadius = CONFIG.chapterRadiusBase + ci * CONFIG.chapterRadiusStep;
        const cAngle = (ci / Math.max(chapters.length, 1)) * Math.PI * 2;
        const cIncl = (Math.random() - 0.5) * 0.7;
        const cTex = makePlanetTexture(domainSeed, 128);
        const cBump = makeBumpTexture(domainSeed, 128);
        const cColorHex = getNodeColor(3);
        const cGeo = makeSphere(2.5, 24);
        const cMat = new THREE.MeshStandardMaterial({
          map: cTex, bumpMap: cBump, bumpScale: 0.3,
          roughness: 0.75, metalness: 0.05,
          emissive: new THREE.Color(0x7ec8e3), emissiveIntensity: 0
        });
        const cMesh = new THREE.Mesh(cGeo, cMat);
        scene.add(cMesh);
        registerNode(cMesh, idFor('chap', domain.domain, subj.name, chap.chapter), chap.chapter, 'chapter', 3, {
          domain: domain.domain, subject: subj.name
        });

        const cOrbitLine = makeOrbitLine(cRadius, cIncl, 0x3a5a7a, 0.15);
        sMesh.add(cOrbitLine);

        orbits.push({
          mesh: cMesh, radius: cRadius, parentMesh: sMesh,
          speed: 0.25 + Math.random() * 0.15,
          angle: cAngle, inclination: cIncl,
          orbitLine: cOrbitLine, orbitParent: sMesh
        });
        makeConnection(sMesh, cMesh, 0x7ec8e3);
        const cTrail = makeTrail(0x7ec8e3, 40);
        trails.push({ trail: cTrail, mesh: cMesh });

        // Subtopics = moons around planets
        const subtopics = chap.subtopics || [];
        subtopics.forEach((sub, sti) => {
          domainSeed++;
          const stRadius = CONFIG.subtopicRadiusBase + sti * CONFIG.subtopicRadiusStep;
          const stAngle = (sti / Math.max(subtopics.length, 1)) * Math.PI * 2;
          const stIncl = (Math.random() - 0.5) * 0.8;
          const stGeo = makeSphere(0.85, 16);
          const stBump = makeBumpTexture(domainSeed * 9, 64);
          const stMat = new THREE.MeshStandardMaterial({
            color: 0xb0c4ff, bumpMap: stBump, bumpScale: 0.15, roughness: 0.8, metalness: 0,
            emissive: new THREE.Color(0x102050), emissiveIntensity: 0.5
          });
          const stMesh = new THREE.Mesh(stGeo, stMat);
          scene.add(stMesh);
          registerNode(stMesh, idFor('sub', domain.domain, subj.name, chap.chapter, sub.name), sub.name, 'subtopic', 4, {
            domain: domain.domain, subject: subj.name, chapter: chap.chapter,
            concepts: sub.concepts || []
          });

          const stOrbitLine = makeOrbitLine(stRadius, stIncl, 0x2a3a5a, 0.12);
          cMesh.add(stOrbitLine);

          orbits.push({
            mesh: stMesh, radius: stRadius, parentMesh: cMesh,
            speed: 0.5 + Math.random() * 0.3,
            angle: stAngle, inclination: stIncl,
            orbitLine: stOrbitLine, orbitParent: cMesh
          });
          makeConnection(cMesh, stMesh, 0x405070);
          const stTrail = makeTrail(0x8898aa, 30);
          trails.push({ trail: stTrail, mesh: stMesh });

          // Concepts = asteroids
          const concepts = sub.concepts || [];
          concepts.forEach((con, coni) => {
            domainSeed++;
            const conRadius = CONFIG.conceptRadiusBase + coni * CONFIG.conceptRadiusStep;
            const conAngle = (coni / Math.max(concepts.length, 1)) * Math.PI * 2;
            const conIncl = (Math.random() - 0.5) * 1.2;
            const conGeo = new THREE.DodecahedronGeometry(0.3, 0);
            const conBump = makeBumpTexture(domainSeed * 11, 32);
            const conMat = new THREE.MeshStandardMaterial({
              color: 0xcccccc, bumpMap: conBump, bumpScale: 0.1, roughness: 1, metalness: 0.1,
              emissive: new THREE.Color(0x111111), emissiveIntensity: 0
            });
            const conMesh = new THREE.Mesh(conGeo, conMat);
            conMesh.visible = false;
            registerNode(conMesh, idFor('con', domain.domain, subj.name, chap.chapter, sub.name, con), con, 'concept', 5, {
              domain: domain.domain, subject: subj.name, chapter: chap.chapter, subtopic: sub.name
            });
            orbits.push({
              mesh: conMesh, radius: conRadius, parentMesh: stMesh,
              speed: 0.9 + Math.random() * 0.5,
              angle: conAngle, inclination: conIncl,
              orbitLine: null, orbitParent: stMesh, isInstanced: true
            });
          });
        });
      });
    });
  });

  updateAllNodeMaterials();
  buildConceptInstances();
}

let conceptInstancedMesh = null;
function buildConceptInstances() {
  const conceptOrbits = orbits.filter(o => o.isInstanced);
  const geo = new THREE.DodecahedronGeometry(0.3, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 1, metalness: 0.1 });
  conceptInstancedMesh = new THREE.InstancedMesh(geo, mat, conceptOrbits.length);
  conceptInstancedMesh.userData.orbitRefs = conceptOrbits;
  scene.add(conceptInstancedMesh);
}

// ─── Raycasting ───────────────────────────────────────────────
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function onMouseMove(e) {
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const targets = conceptInstancedMesh ? allNodes.concat([conceptInstancedMesh]) : allNodes;
  const intersects = raycaster.intersectObjects(targets);

  const tooltip = document.getElementById('tooltip');
  const TOOLTIP_RANGE = 120;
  if (intersects.length > 0 && intersects[0].distance < TOOLTIP_RANGE) {
    const hitObj = intersects[0].object;
    let hit, d;
    if (hitObj === conceptInstancedMesh) {
      const ref = conceptInstancedMesh.userData.orbitRefs[intersects[0].instanceId];
      hit = ref.mesh;
      d = hit.userData;
    } else {
      hit = hitObj;
      d = hit.userData;
    }
    if (hit !== STATE.hoveredNode) {
      STATE.hoveredNode = hit;
      tooltip.innerHTML = `<strong>${d.label || '—'}</strong><span>${d.type || ''} ${d.difficulty ? '· ' + d.difficulty : ''}</span>`;
    }
    tooltip.style.left = (e.clientX + 14) + 'px';
    tooltip.style.top = (e.clientY - 10) + 'px';
    tooltip.classList.add('visible');
    canvas.style.cursor = 'pointer';
  } else {
    STATE.hoveredNode = null;
    tooltip.classList.remove('visible');
    canvas.style.cursor = 'grab';
  }
}

function onClick(e) {
  raycaster.setFromCamera(mouse, camera);
  const targets = conceptInstancedMesh ? allNodes.concat([conceptInstancedMesh]) : allNodes;
  const intersects = raycaster.intersectObjects(targets);
  if (intersects.length > 0) {
    const hitObj = intersects[0].object;
    if (hitObj === conceptInstancedMesh) {
      const ref = conceptInstancedMesh.userData.orbitRefs[intersects[0].instanceId];
      openPanel(ref.mesh);
    } else {
      openPanel(hitObj);
    }
  } else {
    const panel = document.getElementById('side-panel');
    if (panel.classList.contains('panel-open')) {
      closeSidePanel();
    } else {
      STATE.selectedNode = null;
      clearHighlights();
    }
  }
}

// ─── Side Panel ───────────────────────────────────────────────
function openPanel(mesh) {
  clearHighlights();
  highlightChildren(mesh);
  const panel = document.getElementById('side-panel');
  panel.classList.add('panel-open');
  panel.classList.remove('panel-closed');

  if (STATE.selectedNode === mesh) {
    STATE.selectedNode = mesh;
    refreshPanel();
    return;
  }

  STATE.selectedNode = mesh;
  refreshPanel();

  // Fly camera toward node, keep fixed follow distance
  const target = mesh.position.clone();
  const dist = camera.position.distanceTo(target);
  const dir = camera.position.clone().sub(target).normalize();
  const radius = mesh.geometry && mesh.geometry.parameters && mesh.geometry.parameters.radius ? mesh.geometry.parameters.radius : 2;
  const offset = Math.max(radius * 8, Math.min(dist * 0.6, 60));
  const newPos = target.clone().add(dir.multiplyScalar(offset));
  STATE._followOffset = offset;

  // Animate camera
  const start = camera.position.clone();
  const startTarget = controls.target.clone();
  let t = 0;
  STATE._camAnimating = true;
  function camAnim() {
    t += 0.025;
    camera.position.lerpVectors(start, newPos, Math.min(t, 1));
    controls.target.lerpVectors(startTarget, target, Math.min(t, 1));
    controls.update();
    if (t < 1) requestAnimationFrame(camAnim);
    else { STATE._camAnimating = false; STATE._lastSelPos = mesh.position.clone(); }
  }
  camAnim();
}

function refreshPanel() {
  const mesh = STATE.selectedNode;
  if (!mesh) return;
  const d = mesh.userData;
  renderBreadcrumbs(mesh);
  document.getElementById('panel-title').textContent = d.label || '—';
  document.getElementById('panel-type').textContent =
    (d.type ? d.type.charAt(0).toUpperCase() + d.type.slice(1) : '') +
    (d.domain ? ' · ' + d.domain : '') +
    (d.difficulty ? ' · ' + d.difficulty : '');

  // Set icon visuals — real texture for planets/suns, accretion disk for the core
  const icon = document.getElementById('panel-icon');
  const lvl = d.level || 0;
  const colors = ['#000000','#ff6a00','#ffd700','#7ec8e3','#b0c4ff','#ccc'];
  icon.style.backgroundImage = 'none';
  icon.style.background = 'none';
  if (d.type === 'root') {
    icon.style.backgroundImage = `url(${getAccretionDiskIcon()})`;
    icon.style.backgroundSize = 'cover';
    icon.style.boxShadow = '0 0 18px #ff8800aa';
  } else if (mesh.material && mesh.material.map && mesh.material.map.image && mesh.material.map.image.toDataURL) {
    icon.style.backgroundImage = `url(${mesh.material.map.image.toDataURL()})`;
    icon.style.backgroundSize = 'cover';
    icon.style.boxShadow = `0 0 18px ${colors[lvl]}66`;
  } else {
    icon.style.background = `radial-gradient(circle at 35% 35%, ${colors[lvl]}, ${colors[lvl]}88)`;
    icon.style.boxShadow = `0 0 18px ${colors[lvl]}66`;
  }

  // Progress
  const nodeIds = getDescendantIds(mesh);
  const total = nodeIds.length + 1; // include self
  const done = nodeIds.filter(id => STATE.completed[id]).length + (STATE.completed[d.id] ? 1 : 0);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  document.getElementById('panel-progress-fill').style.width = pct + '%';
  document.getElementById('panel-progress-label').textContent = pct + '%';

  // Body
  const body = document.getElementById('panel-body');
  body.innerHTML = '';

  // Mark self
  const selfSection = document.createElement('div');
  selfSection.className = 'panel-section';
  selfSection.innerHTML = `<div class="panel-section-title">This ${d.type}</div>`;
  const selfItem = makeConceptItem(d.id, d.label);
  selfSection.appendChild(selfItem);
  body.appendChild(selfSection);

  // Show concepts if subtopic
  if (d.type === 'subtopic' && d.concepts && d.concepts.length) {
    const conSec = document.createElement('div');
    conSec.className = 'panel-section';
    conSec.innerHTML = '<div class="panel-section-title">Concepts</div>';
    d.concepts.forEach((c, i) => {
      const cid = idFor('con', d.domain, d.subject, d.chapter, d.label, c);
      conSec.appendChild(makeConceptItem(cid, c));
    });
    body.appendChild(conSec);
  }

  // Children quick list
  const childOrbs = orbits.filter(o => o.parentMesh === mesh);
  if (childOrbs.length) {
    const childSec = document.createElement('div');
    childSec.className = 'panel-section';
    const childType = childOrbs[0]?.mesh?.userData?.type || 'children';
    childSec.innerHTML = `<div class="panel-section-title">${childType}s (${childOrbs.length})</div>`;
    childOrbs.slice(0, 20).forEach(o => {
      const cm = o.mesh;
      childSec.appendChild(makeConceptItem(cm.userData.id, cm.userData.label));
    });
    body.appendChild(childSec);
  }
}

function getAncestorChain(mesh) {
  const chain = [mesh];
  let cur = mesh;
  while (true) {
    const parentOrbit = orbits.find(o => o.mesh === cur);
    if (!parentOrbit) break;
    chain.unshift(parentOrbit.parentMesh);
    cur = parentOrbit.parentMesh;
    if (cur === blackHoleMesh) break;
  }
  return chain;
}

function renderBreadcrumbs(mesh) {
  let bc = document.getElementById('panel-breadcrumbs');
  if (!bc) {
    bc = document.createElement('div');
    bc.id = 'panel-breadcrumbs';
    bc.style.fontSize = '11px';
    bc.style.opacity = '0.7';
    bc.style.marginBottom = '8px';
    const titleEl = document.getElementById('panel-title');
    titleEl.parentNode.insertBefore(bc, titleEl);
  }
  bc.innerHTML = '';
  const chain = getAncestorChain(mesh);
  chain.forEach((m, i) => {
    const span = document.createElement('span');
    span.textContent = m.userData.label || 'Core';
    span.style.cursor = 'pointer';
    span.style.textDecoration = 'underline';
    span.addEventListener('click', () => openPanel(m));
    bc.appendChild(span);
    if (i < chain.length - 1) {
      const sep = document.createElement('span');
      sep.textContent = ' › ';
      bc.appendChild(sep);
    }
  });
}

function makeConceptItem(id, label) {
  const el = document.createElement('div');
  el.className = 'concept-item' + (STATE.completed[id] ? ' done' : '');
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  el.setAttribute('aria-label', (STATE.completed[id] ? 'Mark incomplete: ' : 'Mark complete: ') + label);
  el.innerHTML = `<div class="concept-checkbox"><div class="concept-checkbox-inner"></div></div><span class="concept-label">${label}</span>`;
  const checkbox = el.querySelector('.concept-checkbox');
  const toggle = (ev) => { ev.stopPropagation(); toggleCompleted(id); el.classList.toggle('done', !!STATE.completed[id]); };
  checkbox.addEventListener('click', toggle);
  checkbox.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(e); } });
  el.addEventListener('click', () => { const m = nodeLookup[id]; if (m) openPanel(m); });
  el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const m = nodeLookup[id]; if (m) openPanel(m); } });
  return el;
}

function getDescendantIds(mesh) {
  const ids = [];
  const children = orbits.filter(o => o.parentMesh === mesh);
  for (const c of children) {
    ids.push(c.mesh.userData.id);
    ids.push(...getDescendantIds(c.mesh));
  }
  return ids;
}

// ─── Search ───────────────────────────────────────────────────
let searchDebounceTimer = null;
function applySearch(query) {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => doSearch(query), 150);
}

function doSearch(query) {
  STATE.searchQuery = query.toLowerCase().trim();
  const dropdown = document.getElementById('search-results');
  dropdown.innerHTML = '';
  if (!STATE.searchQuery) { dropdown.classList.remove('visible'); return; }
  const matches = allNodes.filter(n => (n.userData.label || '').toLowerCase().includes(STATE.searchQuery)).slice(0, 20);
  if (!matches.length) { dropdown.classList.remove('visible'); return; }
  matches.forEach(n => {
    const item = document.createElement('div');
    item.className = 'search-result-item';
    item.innerHTML = `<strong>${n.userData.label}</strong><span>${n.userData.type}</span>`;
    item.addEventListener('click', () => {
      openPanel(n);
      dropdown.classList.remove('visible');
      document.getElementById('search-input').value = '';
    });
    dropdown.appendChild(item);
  });
  dropdown.classList.add('visible');
}

// ─── Orbit Toggle ─────────────────────────────────────────────
function setOrbitsVisible(visible) {
  for (const o of orbits) {
    if (o.orbitLine) o.orbitLine.visible = visible;
    // top-level orbit lines added to scene (not parent)
    if (!o.orbitParent && o.orbitLine) o.orbitLine.visible = visible;
  }
  // All children orbit lines
  scene.traverse(obj => {
    if (obj.userData && obj.userData.isOrbit) obj.visible = visible;
  });
}

function setTrailsVisible(visible) {
  scene.traverse(obj => {
    if (obj.userData && obj.userData.isTrail) obj.visible = visible;
  });
}

// ─── Animation Loop ───────────────────────────────────────────
const clock = new THREE.Clock();
const dummyMatrix = new THREE.Matrix4();
const dummyPos = new THREE.Vector3();

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  STATE.time += delta;
  const speed = STATE.speed;

  // Black hole accretion disk rotation
  if (accretionMesh) {
    accretionMesh.rotation.z += delta * 0.15 * speed;
    accretionMesh.material.uniforms.uTime.value = STATE.time;
  }

  // Update orbits
  for (let oi = 0; oi < orbits.length; oi++) {
    const o = orbits[oi];
    o.angle += delta * o.speed * speed;
    const parent = o.parentMesh;
    const px = parent.position.x;
    const py = parent.position.y;
    const pz = parent.position.z;
    const cosI = Math.cos(o.inclination);
    const sinI = Math.sin(o.inclination);
    const localX = Math.cos(o.angle) * o.radius;
    const localZ = Math.sin(o.angle) * o.radius;
    dummyPos.set(
      px + localX,
      py - localZ * sinI,
      pz + localZ * cosI
    );
    if (o.isInstanced) {
      o.mesh.position.copy(dummyPos);
      dummyMatrix.makeTranslation(dummyPos.x, dummyPos.y, dummyPos.z);
      const idx = conceptInstancedMesh.userData.orbitRefs.indexOf(o);
      if (idx !== -1) conceptInstancedMesh.setMatrixAt(idx, dummyMatrix);
    } else {
      o.mesh.position.copy(dummyPos);
      o.mesh.rotation.y += delta * 0.3 * speed;
    }
  }
  if (conceptInstancedMesh) conceptInstancedMesh.instanceMatrix.needsUpdate = true;

  // Update trails
  if (STATE.showTrails) {
    for (const t of trails) updateTrail(t.trail, t.mesh.position);
  }

  // Update connection lines
  if (STATE.showOrbits) updateConnections();

  // Update ripples
  for (let i = ripples.length - 1; i >= 0; i--) {
    const rip = ripples[i];
    const age = STATE.time - rip.born;
    const dur = 1.5;
    if (age > dur) { scene.remove(rip.mesh); rip.mesh.geometry.dispose(); rip.mesh.material.dispose(); ripples.splice(i, 1); continue; }
    const prog = age / dur;
    const scale = 1 + prog * 12;
    rip.mesh.scale.setScalar(scale);
    rip.mesh.material.opacity = (1 - prog) * 0.7;
    rip.mesh.position.copy(rip.baseMesh.position);
    rip.mesh.lookAt(camera.position);
  }

  // Animate core light pulse
  if (coreLight) {
    coreLight.intensity = 5 + Math.sin(STATE.time * 1.2) * 2;
  }
  if (diskLight) {
    diskLight.intensity = 4 + Math.sin(STATE.time * 0.8 + 1.0) * 1.5;
  }

  if (STATE.selectedNode && !STATE._camAnimating) {
    const delta2 = STATE.selectedNode.position.clone().sub(STATE._lastSelPos || STATE.selectedNode.position);
    controls.target.add(delta2);
    camera.position.add(delta2);
    STATE._lastSelPos = STATE.selectedNode.position.clone();
  }

  controls.update();
  updateLensUniforms();
  renderer.setRenderTarget(depthRenderTarget);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  lensPass.uniforms.tDepth.value = depthRenderTarget.depthTexture;
  composer.render();
}

// ─── HUD Controls ─────────────────────────────────────────────
document.getElementById('toggle-orbits').addEventListener('change', e => {
  STATE.showOrbits = e.target.checked;
  setOrbitsVisible(e.target.checked);
});
document.getElementById('toggle-trails').addEventListener('change', e => {
  STATE.showTrails = e.target.checked;
  setTrailsVisible(e.target.checked);
});
document.getElementById('toggle-audio').addEventListener('change', e => {
  STATE.audioOn = e.target.checked;
  setAudio(e.target.checked);
});
document.getElementById('speed-slider').addEventListener('input', e => {
  STATE.speed = parseFloat(e.target.value);
  document.getElementById('speed-val').textContent = STATE.speed.toFixed(1) + '×';
});
function closeSidePanel() {
  const panel = document.getElementById('side-panel');
  panel.classList.remove('panel-open');
  panel.classList.add('panel-closed');
  STATE.selectedNode = null;
  clearHighlights();
}
document.getElementById('panel-close').addEventListener('click', (e) => {
  e.stopPropagation();
  closeSidePanel();
});
document.getElementById('search-input').addEventListener('input', e => {
  applySearch(e.target.value);
});

canvas.addEventListener('mousemove', onMouseMove);

let _downPos = null;
let _wasDrag = false;
canvas.addEventListener('mousedown', e => { _downPos = { x: e.clientX, y: e.clientY }; _wasDrag = false; });
canvas.addEventListener('mousemove', e => {
  if (_downPos && !_wasDrag) {
    const dx = e.clientX - _downPos.x, dy = e.clientY - _downPos.y;
    if (Math.sqrt(dx*dx + dy*dy) > 4) {
      _wasDrag = true;
      const panel = document.getElementById('side-panel');
      if (panel.classList.contains('panel-open')) {
        panel.classList.remove('panel-open');
        panel.classList.add('panel-closed');
      }
    }
  }
});
canvas.addEventListener('mouseup', e => {
  if (!_wasDrag) onClick(e);
  _downPos = null;
});

// ─── Resize ───────────────────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  depthRenderTarget.setSize(window.innerWidth, window.innerHeight);
});

// ─── Load JSON & Start ────────────────────────────────────────
async function init() {
  const legendEl = document.getElementById('legend');
  if (legendEl) {
    const help = document.createElement('div');
    help.style.fontSize = '11px';
    help.style.opacity = '0.8';
    help.style.marginBottom = '8px';
    help.style.maxWidth = '220px';
    help.innerHTML = 'Click an object to open its panel and highlight its direct children. Click a checkbox to mark complete; click the item text to navigate to it. Hover near objects to see tooltips.';
    help.style.position = 'fixed';
    help.style.left = '20px';
    help.style.bottom = '230px';
    help.style.background = 'rgba(0,0,0,0.6)';
    help.style.padding = '8px 10px';
    help.style.borderRadius = '6px';
    help.style.zIndex = '50';
    document.body.appendChild(help);
  }
  const loadingText = document.getElementById('loading-text');
  loadingText.textContent = 'Loading theory.json…';
  loadProgress();
  buildStarfield();
  buildNebulae();
  buildDistantGalaxies();
  buildBrightStars();
  buildSupernovae();

  let data;
  try {
    loadingText.textContent = 'Parsing curriculum data…';
    const res = await fetch('theory.json');
    if (!res.ok) throw new Error('Failed to fetch theory.json');
    data = await res.json();
  } catch (err) {
    console.error(err);
    loadingText.textContent = 'Could not load theory.json — using demo data.';
    data = getDemoData();
    await new Promise(r => setTimeout(r, 1200));
  }

  loadingText.textContent = 'Building galaxy…';
  await new Promise(r => setTimeout(r, 100));
  buildGalaxy(data);

  loadingText.textContent = 'Igniting stars…';
  await new Promise(r => setTimeout(r, 200));

  document.getElementById('loading-overlay').classList.add('hidden');
  animate();
}

// ─── Demo Data (fallback) ─────────────────────────────────────
function getDemoData() {
  return {
    domains: [
      {
        domain: 'Programming Fundamentals',
        subjects: [
          {
            name: 'C Programming', type: 'software', difficulty: 'fundamentals',
            chapters: [
              {
                chapter: 'Introduction to C',
                subtopics: [
                  { name: 'History and philosophy of C', concepts: ['Why C was created', 'C vs assembly', 'C standards'] },
                  { name: 'Setting up environment', concepts: ['GCC compiler', 'Makefiles', 'IDEs vs text editors'] },
                  { name: 'Structure of a C program', concepts: ['main function', 'header files', 'preprocessor directives'] }
                ]
              },
              {
                chapter: 'Data Types and Variables',
                subtopics: [
                  { name: 'Primitive types', concepts: ['int', 'char', 'float', 'double', 'void'] },
                  { name: 'Type modifiers', concepts: ['short', 'long', 'const', 'volatile', 'extern'] }
                ]
              }
            ]
          },
          {
            name: 'Python Basics', type: 'software', difficulty: 'fundamentals',
            chapters: [
              {
                chapter: 'Python Syntax',
                subtopics: [
                  { name: 'Variables', concepts: ['dynamic typing', 'naming conventions', 'assignment'] },
                  { name: 'Control Flow', concepts: ['if/else', 'for loops', 'while loops', 'break/continue'] }
                ]
              }
            ]
          }
        ]
      },
      {
        domain: 'Data Structures',
        subjects: [
          {
            name: 'Arrays & Lists', type: 'software', difficulty: 'fundamentals',
            chapters: [
              {
                chapter: 'Arrays',
                subtopics: [
                  { name: 'Static Arrays', concepts: ['declaration', 'indexing', 'traversal', 'memory layout'] },
                  { name: 'Dynamic Arrays', concepts: ['resizing', 'amortized cost', 'vectors'] }
                ]
              }
            ]
          },
          {
            name: 'Trees & Graphs', type: 'software', difficulty: 'intermediate',
            chapters: [
              {
                chapter: 'Binary Trees',
                subtopics: [
                  { name: 'Tree Traversal', concepts: ['inorder', 'preorder', 'postorder', 'BFS'] },
                  { name: 'BST', concepts: ['insert', 'delete', 'search', 'balance'] }
                ]
              }
            ]
          }
        ]
      },
      {
        domain: 'Computer Architecture',
        subjects: [
          {
            name: 'Digital Logic', type: 'hardware', difficulty: 'fundamentals',
            chapters: [
              {
                chapter: 'Logic Gates',
                subtopics: [
                  { name: 'Basic Gates', concepts: ['AND', 'OR', 'NOT', 'NAND', 'NOR', 'XOR'] },
                  { name: 'Boolean Algebra', concepts: ['De Morgan laws', 'simplification', 'Karnaugh maps'] }
                ]
              }
            ]
          }
        ]
      },
      {
        domain: 'Operating Systems',
        subjects: [
          {
            name: 'Process Management', type: 'software', difficulty: 'intermediate',
            chapters: [
              {
                chapter: 'Processes',
                subtopics: [
                  { name: 'Process States', concepts: ['ready', 'running', 'blocked', 'terminated'] },
                  { name: 'Scheduling', concepts: ['FCFS', 'Round Robin', 'Priority', 'SJF'] }
                ]
              }
            ]
          }
        ]
      },
      {
        domain: 'Networking',
        subjects: [
          {
            name: 'TCP/IP', type: 'software', difficulty: 'intermediate',
            chapters: [
              {
                chapter: 'OSI Model',
                subtopics: [
                  { name: 'Layers', concepts: ['Physical', 'Data Link', 'Network', 'Transport', 'Session', 'Presentation', 'Application'] }
                ]
              }
            ]
          }
        ]
      },
      {
        domain: 'Algorithms',
        subjects: [
          {
            name: 'Sorting', type: 'software', difficulty: 'intermediate',
            chapters: [
              {
                chapter: 'Comparison Sorts',
                subtopics: [
                  { name: 'O(n²) Sorts', concepts: ['Bubble Sort', 'Insertion Sort', 'Selection Sort'] },
                  { name: 'O(n log n) Sorts', concepts: ['Merge Sort', 'Quick Sort', 'Heap Sort'] }
                ]
              }
            ]
          }
        ]
      }
    ]
  };
}

init();