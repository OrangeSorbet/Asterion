/* ═══════════════════════════════════════════════════════════════
   CS Galaxy — index.js
   Three.js immersive space learning visualizer
   ═══════════════════════════════════════════════════════════════ */

'use strict';
const { readTextFile, writeTextFile } = window.__TAURI__.fs;

let _jsonFilePath = null;
let _jsonData = null;

async function resolveJsonPath() {
  _jsonFilePath = await window.__TAURI__.core.invoke('theory_json_path');
}

async function saveJsonData() {
  if (!_jsonFilePath || !_jsonData) return;
  await writeTextFile(_jsonFilePath, JSON.stringify(_jsonData, null, 2));
}

function ensureRefsAndDesc(obj) {
  if (!obj.references) obj.references = [];
  if (obj.description === undefined) obj.description = '';
  return obj;
}

function findJsonNode(userData) {
  if (!_jsonData) return null;
  if (!userData) return null;
  const { type, domain, subject, chapter, label } = userData;
  if (type === 'root') return _jsonData;
  const dom = _jsonData.domains.find(d => d.domain === domain);
  if (!dom) return null;
  if (type === 'domain') return ensureRefsAndDesc(dom);
  const subj = dom.subjects.find(s => s.name === (subject || label));
  if (!subj) return null;
  if (type === 'subject' || type === 'software' || type === 'hardware' || type === 'mixed') return ensureRefsAndDesc(subj);
  const chap = subj.chapters.find(c => c.chapter === (chapter || label));
  if (!chap) return null;
  if (type === 'chapter') return ensureRefsAndDesc(chap);
  const topics = chap.topics || chap.subtopics || [];
  const topic = topics.find(t => t.name === (type === 'subtopic' ? label : userData.subtopic));
  if (!topic) return null;
  if (type === 'subtopic') return ensureRefsAndDesc(topic);
  const concepts = topic.concepts || [];
  const con = concepts.find(c => (typeof c === 'object' ? c.name : c) === label);
  if (typeof con === 'string') {
    const idx = concepts.indexOf(con);
    concepts[idx] = { name: con, description: '', references: [] };
    return concepts[idx];
  }
  if (!con) return null;
  return ensureRefsAndDesc(con);
}

// ─── UNIVERSAL TWEAK CONFIG ─────────────────────────────────────
// !! TWEAK THESE FREELY !!
const CONFIG = {
  // --- Orbit spacing ---
  domainRadiusBase: 200,        // how far domains orbit black hole
  domainRadiusStep: 14,         // spacing between domain orbits
  subjectRadiusBase: 34,        // subject orbit around domain
  subjectRadiusStep: 11,
  chapterRadiusBase: 14,        // chapter orbit around subject
  chapterRadiusStep: 5,
  subtopicRadiusBase: 7,        // subtopic orbit around chapter
  subtopicRadiusStep: 2.8,
  conceptRadiusBase: 2.8,       // concept orbit around subtopic
  conceptRadiusStep: 1.0,

  // --- Object sizes ---
  sunSizeBase: 9,               // domain star size
  subjectSunSize: 5,            // subject star size
  planetSize: 3.2,              // chapter planet size
  moonSize: 1.1,                // subtopic moon size
  asteroidSize: 0.38,           // concept asteroid size

  // --- Black hole ---
  bhCoreRadius: 19,             // black hole sphere radius
  bhDiskInner: 26,              // accretion disk inner edge
  bhDiskOuter: 200,             // accretion disk outer edge
  bhLensStrength: 0.045,        // gravitational lensing warp strength
  bhLensRadius: 0.07,           // lensing effect screen radius

  // --- Post processing ---
  bloomStrength: 0.1,           // bloom intensity
  bloomRadius: 0.1,             // bloom spread
  bloomThreshold: 0.95,         // what luminance triggers bloom
  motionBlur: 0.5,             // afterimage dampening (0=none, 0.95=heavy)

  // --- Visuals ---
  fogDensity: 0.00008,          // scene fog density
  sunEmissiveIntensity: 1.6,    // sun glow intensity
  sunLightIntensity: 2.2,       // sun point light intensity
  sunLightRange: 280,           // sun point light range
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
  const newState = !STATE.completed[nodeId];
  STATE.completed[nodeId] = newState;
  const mesh = nodeLookup[nodeId];
  if (mesh) {
    const descIds = getDescendantIds(mesh);
    for (const id of descIds) STATE.completed[id] = newState;
  }
  try { localStorage.setItem('cs_galaxy_progress', JSON.stringify(STATE.completed)); } catch (_) {}
  updateAllNodeMaterials();
  refreshPanel();
  triggerRipple(nodeId);
  if (window._refreshTreeView) window._refreshTreeView();
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
scene.fog = new THREE.FogExp2(0x000010, CONFIG.fogDensity);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 20000);
camera.position.set(0, 220, 520);

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
    bhStrength: { value: CONFIG.bhLensStrength },
    bhRadius: { value: CONFIG.bhLensRadius },
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
      vec2 diff = uv - bhScreen;
      diff.x *= aspect;
      float dist = length(diff);

      float sceneDepth = texture2D(tDepth, uv).r;
      bool isForeground = sceneDepth < uBhDepth - 0.0015;

      if (bhVisible < 0.5 || dist > bhRadius * 3.2 || isForeground) {
        gl_FragColor = texture2D(tDiffuse, uv);
        return;
      }

      vec2 dir = normalize(diff + 0.000001);
      dir.x /= aspect;

      if (dist < bhRadius * 1.02) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
      }

      float ringDist = abs(dist - bhRadius * 1.15);
      float ringFalloff = 1.0 - smoothstep(0.0, bhRadius * 1.6, ringDist);
      float bend = bhStrength * bhRadius * bhRadius / (dist * dist);
      bend *= (0.4 + ringFalloff * 2.2);
      bend = clamp(bend, 0.0, bhRadius * 1.8);

      vec2 warpedUv1 = uv - dir * bend;
      vec2 warpedUv2 = uv + dir * bend * 0.4;

      vec4 c1 = texture2D(tDiffuse, clamp(warpedUv1, vec2(0.0), vec2(1.0)));
      vec4 c2 = texture2D(tDiffuse, clamp(warpedUv2, vec2(0.0), vec2(1.0)));
      float mixAmt = ringFalloff * 0.5;
      gl_FragColor = mix(c1, c2, mixAmt);
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
    float fbm(vec2 p) {
      float v = 0.0; float amp = 0.5;
      for(int i=0;i<5;i++){ v += noise(p)*amp; p*=2.1; amp*=0.5; }
      return v;
    }
    vec2 rotate(vec2 p, float a) {
      float s = sin(a), c = cos(a);
      return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
    }
    void main() {
      float dist = length(vPos);
      float t = (dist - uInner) / (uOuter - uInner);
      if (dist < uInner || dist > uOuter) discard;

      // differential rotation — inner spins faster
      float shear = -uTime * (2.2 - t * 1.8) * 0.3;
      vec2 rp = rotate(vPos, shear);

      // multi octave turbulence
      float turb = fbm(rp * 0.05 + uTime * 0.01);
      float turb2 = fbm(rp * 0.12 - uTime * 0.008 + 7.3);
      float combined = turb * 0.65 + turb2 * 0.35;

      // bright filaments — stretched along rotation
      vec2 rp2 = rotate(vPos, shear * 1.4);
      float filament = pow(fbm(rp2 * vec2(0.03, 0.18) + uTime * 0.012), 1.8);

      float edgeFade = smoothstep(0.0, 0.08, t) * smoothstep(1.0, 0.55, t);
      float innerGlow = smoothstep(0.35, 0.0, t); // extra hot near black hole

      float heat = 1.0 - t;

      // color: white hot core → orange → deep red rim
      vec3 white = vec3(1.0, 0.98, 0.92);
      vec3 hot   = vec3(1.0, 0.85, 0.4);
      vec3 mid   = vec3(1.0, 0.45, 0.08);
      vec3 cool  = vec3(0.7, 0.12, 0.03);
      vec3 rim   = vec3(0.3, 0.04, 0.01);

      vec3 color = mix(rim, cool, smoothstep(0.0, 0.25, heat));
      color = mix(color, mid, smoothstep(0.2, 0.5, heat));
      color = mix(color, hot, smoothstep(0.45, 0.75, heat));
      color = mix(color, white, smoothstep(0.7, 1.0, heat) * innerGlow * 1.5);

      color += filament * vec3(1.0, 0.7, 0.3) * 0.4;

      // doppler beaming — left side rotating toward viewer = brighter
      float doppler = 0.5 + 0.5 * sin(atan(vPos.y, vPos.x));
      float dopplerBoost = 1.0 + doppler * 1.4;

      float alpha = edgeFade * (0.12 + combined * 0.08);
      alpha += innerGlow * 0.04;
      alpha *= (0.4 + doppler * 0.6);

      gl_FragColor = vec4(color * (0.5 + combined * 0.3 + filament * 0.2) * dopplerBoost, alpha);
    }
  `
};

const depthRenderTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight);
depthRenderTarget.texture.minFilter = THREE.NearestFilter;
depthRenderTarget.texture.magFilter = THREE.NearestFilter;
depthRenderTarget.depthTexture = new THREE.DepthTexture(window.innerWidth, window.innerHeight);
depthRenderTarget.depthTexture.type = THREE.UnsignedIntType;

const composer = new THREE.EffectComposer(renderer);
const renderPass = new THREE.RenderPass(scene, camera);
composer.addPass(renderPass);

const bloomPass = new THREE.UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  CONFIG.bloomStrength,
  CONFIG.bloomRadius,
  CONFIG.bloomThreshold
);
composer.addPass(bloomPass);

const afterimagePass = new THREE.AfterimagePass(CONFIG.motionBlur);
composer.addPass(afterimagePass);

const lensPass = new THREE.ShaderPass(new THREE.ShaderMaterial(lensShader), 'tDiffuse');
lensPass.renderToScreen = true;
composer.addPass(lensPass);

const _bhNdc = new THREE.Vector3();
const _bhWorldRadius = 20;
function updateLensUniforms() {
  _bhNdc.copy(blackHoleMesh.position).project(camera);
  lensPass.uniforms.bhScreen.value.set((_bhNdc.x + 1) / 2, (_bhNdc.y + 1) / 2);
  lensPass.uniforms.aspect.value = window.innerWidth / window.innerHeight;
  lensPass.uniforms.bhVisible.value = _bhNdc.z < 1 ? 1.0 : 0.0;
  lensPass.uniforms.uBhDepth.value = (_bhNdc.z + 1.0) / 2.0;

  const dist = camera.position.distanceTo(blackHoleMesh.position);
  const fovRad = camera.fov * Math.PI / 180;
  const visibleHeight = 2 * Math.tan(fovRad / 2) * dist;
  const radiusNdc = CONFIG.bhCoreRadius / visibleHeight;
  lensPass.uniforms.bhRadius.value = Math.min(Math.max(radiusNdc, 0.015), 0.5);
  lensPass.uniforms.bhStrength.value = CONFIG.bhLensStrength;
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
  for (let i = 0; i < 18; i++) {
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
  const snColors = ['rgba(255,160,200,0.9)', 'rgba(160,200,255,0.9)', 'rgba(255,210,140,0.9)', 'rgba(180,255,210,0.9)', 'rgba(255,140,140,0.9)', 'rgba(210,160,255,0.9)'];
  for (let i = 0; i < 16; i++) {
    const color = snColors[i % snColors.length];
    const tex = makeStarGlowTexture(color, 96);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.5 + Math.random() * 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 2 - 1);
    const r = 3000 + Math.random() * 6000;
    sprite.position.set(r * Math.sin(phi) * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta), r * Math.cos(phi));
    const s = 150 + Math.random() * 350;
    sprite.scale.set(s, s, 1);
    scene.add(sprite);

    // bright core flash at center of supernova
    const coreTex = makeStarGlowTexture('rgba(255,255,255,1)', 32);
    const coreMat = new THREE.SpriteMaterial({ map: coreTex, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const core = new THREE.Sprite(coreMat);
    core.position.copy(sprite.position);
    const cs = s * 0.18;
    core.scale.set(cs, cs, 1);
    scene.add(core);
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
  { type: 'ocean',  cloudAmt: 0.5 },
  { type: 'desert', cloudAmt: 0.1 },
  { type: 'forest', cloudAmt: 0.4 },
  { type: 'lava',   cloudAmt: 0.05 },
  { type: 'ice',    cloudAmt: 0.6 },
  { type: 'gas',    cloudAmt: 0.0 },
  { type: 'gas2',   cloudAmt: 0.0 },
  { type: 'rocky',  cloudAmt: 0.15 },
  { type: 'swamp',  cloudAmt: 0.55 },
  { type: 'arid',   cloudAmt: 0.08 },
];

function makePlanetTexture(seed, size = 256) {
  const cfg = PLANET_CONFIGS[seed % PLANET_CONFIGS.length];
  return makeProceduralTexture(size, (ctx, sz) => {
    const img = ctx.createImageData(sz, sz);
    const d = img.data;
    for (let y = 0; y < sz; y++) {
      for (let x = 0; x < sz; x++) {
        const u = x / sz, v = y / sz;

        // continent mask — large scale fbm
        const continent = fbm(u * 2.2, v * 2.2, seed * 17, 6);
        // detail noise
        const detail = fbm(u * 7, v * 7, seed * 31, 4);
        const fine = fbm(u * 18, v * 18, seed * 53, 3);
        // cloud layer
        const cloud = fbm(u * 4 + 0.5, v * 4 + 0.5, seed * 73, 5);
        const cloud2 = fbm(u * 9, v * 9, seed * 89, 3);
        const cloudMask = Math.max(0, cloud * 0.7 + cloud2 * 0.3 - (1.0 - cfg.cloudAmt));

        let r, g, b;

        if (cfg.type === 'gas') {
          // jupiter style — bands with turbulence
          const band = Math.sin(v * Math.PI * 10 + continent * 2.5) * 0.5 + 0.5;
          const storm = fbm(u * 6, v * 6, seed * 41, 4);
          const h = 25 + band * 30 + storm * 15;
          const s = 70 + storm * 20;
          const l = 38 + band * 22 + storm * 12;
          const [rr,gg,bb] = hsl2rgb(h/360, s/100, l/100);
          r=rr; g=gg; b=bb;

        } else if (cfg.type === 'gas2') {
          // saturn style — pale golden bands
          const band = Math.sin(v * Math.PI * 8 + continent * 1.8) * 0.5 + 0.5;
          const storm = fbm(u * 5, v * 5, seed * 37, 3);
          const h = 40 + band * 20;
          const s = 55 + storm * 15;
          const l = 55 + band * 18 + storm * 8;
          const [rr,gg,bb] = hsl2rgb(h/360, s/100, l/100);
          r=rr; g=gg; b=bb;

        } else if (cfg.type === 'lava') {
          // dark crust with glowing fissures
          const fissure = fbm(u * 12, v * 12, seed * 23, 5);
          const heat = Math.pow(Math.max(0, fissure - 0.45) / 0.55, 2.0);
          const crust = continent * 0.5 + detail * 0.3 + fine * 0.2;
          const h = heat > 0.3 ? 20 + heat * 20 : 0;
          const s = heat > 0.1 ? 90 : 20;
          const l = Math.max(4, heat * 70 + crust * 12);
          const [rr,gg,bb] = hsl2rgb(h/360, s/100, l/100);
          r=rr; g=gg; b=bb;

        } else if (cfg.type === 'ocean') {
          // deep ocean with islands/continents
          const land = continent > 0.54;
          const shallow = continent > 0.48 && !land;
          if (land) {
            // land — greens and browns
            const elevation = (continent - 0.54) / 0.46;
            const h = elevation > 0.5 ? 35 + detail * 15 : 105 + detail * 20;
            const s = elevation > 0.5 ? 40 : 55;
            const l = 25 + elevation * 25 + detail * 15;
            const [rr,gg,bb] = hsl2rgb(h/360, s/100, l/100);
            r=rr; g=gg; b=bb;
          } else if (shallow) {
            const [rr,gg,bb] = hsl2rgb(0.55, 0.75, 0.28 + detail * 0.1);
            r=rr; g=gg; b=bb;
          } else {
            // deep ocean
            const depth = (0.48 - continent) / 0.48;
            const [rr,gg,bb] = hsl2rgb(0.6, 0.8, Math.max(0.08, 0.22 - depth * 0.14 + detail * 0.05));
            r=rr; g=gg; b=bb;
          }

        } else if (cfg.type === 'ice') {
          // frozen world — white/blue with cracks
          const crack = fbm(u * 14, v * 14, seed * 29, 4);
          const isCrack = crack > 0.62;
          if (isCrack) {
            const [rr,gg,bb] = hsl2rgb(0.58, 0.6, 0.3 + detail * 0.1);
            r=rr; g=gg; b=bb;
          } else {
            const h = 0.55 + detail * 0.05;
            const s = 0.2 + continent * 0.2;
            const l = 0.72 + fine * 0.2;
            const [rr,gg,bb] = hsl2rgb(h, s, l);
            r=rr; g=gg; b=bb;
          }

        } else if (cfg.type === 'desert') {
          // dune world — orange/tan with rocky outcrops
          const dune = Math.sin(u * 20 + continent * 4) * 0.5 + 0.5;
          const rock = continent > 0.62;
          if (rock) {
            const [rr,gg,bb] = hsl2rgb(0.07, 0.5, 0.28 + detail * 0.12);
            r=rr; g=gg; b=bb;
          } else {
            const h = 0.08 + dune * 0.04 + detail * 0.02;
            const s = 0.65 + dune * 0.15;
            const l = 0.42 + dune * 0.18 + fine * 0.08;
            const [rr,gg,bb] = hsl2rgb(h, s, l);
            r=rr; g=gg; b=bb;
          }

        } else if (cfg.type === 'forest') {
          // lush world — deep greens with rivers
          const elevation = continent;
          const river = fbm(u * 10, v * 10, seed * 61, 4) > 0.66;
          if (river && elevation < 0.6) {
            const [rr,gg,bb] = hsl2rgb(0.58, 0.7, 0.2 + detail * 0.08);
            r=rr; g=gg; b=bb;
          } else {
            const h = 0.28 + (1-elevation) * 0.08 + detail * 0.04;
            const s = 0.6 + continent * 0.2;
            const l = 0.18 + elevation * 0.22 + detail * 0.12;
            const [rr,gg,bb] = hsl2rgb(h, s, l);
            r=rr; g=gg; b=bb;
          }

        } else if (cfg.type === 'swamp') {
          // murky greens and browns
          const h = 0.22 + continent * 0.08 + detail * 0.05;
          const s = 0.45 + detail * 0.25;
          const l = 0.14 + continent * 0.2 + fine * 0.1;
          const [rr,gg,bb] = hsl2rgb(h, s, l);
          r=rr; g=gg; b=bb;

        } else if (cfg.type === 'arid') {
          // cracked dry surface
          const crack = fbm(u * 16, v * 16, seed * 43, 4) > 0.6;
          if (crack) {
            const [rr,gg,bb] = hsl2rgb(0.06, 0.3, 0.15);
            r=rr; g=gg; b=bb;
          } else {
            const h = 0.06 + detail * 0.03;
            const s = 0.4 + fine * 0.2;
            const l = 0.35 + continent * 0.2 + detail * 0.1;
            const [rr,gg,bb] = hsl2rgb(h, s, l);
            r=rr; g=gg; b=bb;
          }

        } else {
          // rocky — grey browns
          const h = 0.06 + continent * 0.04;
          const s = 0.2 + detail * 0.15;
          const l = 0.18 + continent * 0.28 + detail * 0.1 + fine * 0.06;
          const [rr,gg,bb] = hsl2rgb(h, s, l);
          r=rr; g=gg; b=bb;
        }

        // cloud overlay — white wispy
        if (cloudMask > 0) {
          const cf = Math.min(1, cloudMask * 3.5);
          r = Math.round(r + (255 - r) * cf);
          g = Math.round(g + (255 - g) * cf);
          b = Math.round(b + (255 - b) * cf);
        }

        const idx = (y * sz + x) * 4;
        d[idx] = Math.min(255,Math.max(0,r));
        d[idx+1] = Math.min(255,Math.max(0,g));
        d[idx+2] = Math.min(255,Math.max(0,b));
        d[idx+3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
}

function makeMoonTexture(seed, size = 128) {
  return makeProceduralTexture(size, (ctx, sz) => {
    const img = ctx.createImageData(sz, sz);
    const d = img.data;
    for (let y = 0; y < sz; y++) {
      for (let x = 0; x < sz; x++) {
        const u = x/sz, v = y/sz;
        // base grey rocky surface
        const n = fbm(u*6, v*6, seed*13, 5);
        const n2 = fbm(u*18, v*18, seed*7, 3);
        // craters — circular dark depressions
        let craterDark = 0;
        const craterCount = 4 + (seed % 6);
        for (let c = 0; c < craterCount; c++) {
          const cu = noise(c * 3.7, seed * 0.4 + c);
          const cv = noise(seed * 0.6 + c, c * 2.9);
          const cr = 0.05 + noise(c, seed * 2.1) * 0.1;
          const cd = Math.sqrt((u-cu)*(u-cu)+(v-cv)*(v-cv));
          const rim = Math.max(0, 1 - Math.abs(cd - cr) / (cr * 0.3));
          const floor = Math.max(0, 1 - cd / (cr * 0.7));
          craterDark += floor * 0.35 - rim * 0.15;
        }
        const base = 0.45 + n * 0.3 + n2 * 0.1 - Math.max(0, craterDark);
        const grey = Math.min(255, Math.max(0, base * 200));
        // slight color variation — some moons more blue, some more brown
        const tint = (seed % 3);
        const rr = tint === 1 ? grey * 0.95 : grey;
        const gg = grey * 0.97;
        const bb = tint === 0 ? Math.min(255, grey * 1.08) : grey * 0.93;
        const idx = (y*sz+x)*4;
        d[idx] = rr; d[idx+1] = gg; d[idx+2] = bb; d[idx+3] = 255;
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

    // precompute sunspot centers (3-6 spots)
    const spotCount = 3 + (seed % 4);
    const spots = [];
    for (let s = 0; s < spotCount; s++) {
      spots.push({
        u: 0.2 + fbm(s * 3.1, seed * 0.7, s * 7, 1) * 0.6,
        v: 0.2 + fbm(seed * 0.3, s * 2.7, seed * 3, 1) * 0.6,
        r: 0.06 + fbm(s * 1.1, seed * 0.5, s, 1) * 0.09,
        depth: 0.7 + fbm(s * 1.7, seed * 1.3, s * 5, 1) * 0.3
      });
    }

    for (let y = 0; y < sz; y++) {
      for (let x = 0; x < sz; x++) {
        const u = x/sz, v = y/sz;
        const n = fbm(u*4, v*4, seed*7, 6);
        const n2 = fbm(u*10+2, v*10+2, seed*13, 4);
        const n3 = fbm(u*20+5, v*20+5, seed*19, 3);
        const dx = (x-cx)/cx, dy = (y-cy)/cy;
        const dist = Math.sqrt(dx*dx+dy*dy);

        // limb darkening — edges darker like real sun
        const limb = 1.0 - dist * dist * 0.5;
        const temp = limb * (1.0 - dist * 0.3) + n * 0.25;

        // granulation — tiny bright/dark cells
        const granule = fbm(u*28, v*28, seed*11, 3) * 0.12;

        // sunspot darkening
        let spotDark = 0.0;
        for (const sp of spots) {
          const sdx = u - sp.u, sdy = v - sp.v;
          const sd = Math.sqrt(sdx*sdx + sdy*sdy);
          const spotEdge = 1.0 - Math.min(1.0, sd / sp.r);
          const spotVal = Math.pow(Math.max(0, spotEdge), 2.0) * sp.depth;
          // umbra darker than penumbra
          const umbra = Math.pow(Math.max(0, spotEdge - 0.3) / 0.7, 2.0) * sp.depth * 0.6;
          spotDark = Math.max(spotDark, spotVal * 0.6 + umbra);
        }

        const finalTemp = Math.max(0, temp + granule - spotDark * 1.8);

        // color ramp: white core → yellow → orange → dark red edge
        let r, g, b;
        if (finalTemp > 0.75) {
          const t = (finalTemp - 0.75) / 0.25;
          r = 255; g = Math.min(255, 200 + t * 55); b = Math.min(255, t * 180);
        } else if (finalTemp > 0.45) {
          const t = (finalTemp - 0.45) / 0.30;
          r = 255; g = Math.min(255, 100 + t * 100); b = 0;
        } else if (finalTemp > 0.2) {
          const t = (finalTemp - 0.2) / 0.25;
          r = Math.min(255, 160 + t * 95); g = Math.min(255, t * 100); b = 0;
        } else {
          const t = finalTemp / 0.2;
          r = Math.min(255, t * 160); g = 0; b = 0;
        }

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
const nebulaShader = {
  uniforms: { uColorA: { value: new THREE.Color(0xff3366) }, uColorB: { value: new THREE.Color(0x3366ff) }, uSeed: { value: 0 } },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: `
    uniform vec3 uColorA; uniform vec3 uColorB; uniform float uSeed;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p); vec2 f = fract(p);
      float a = hash(i), b = hash(i+vec2(1,0)), c = hash(i+vec2(0,1)), d = hash(i+vec2(1,1));
      vec2 u = f*f*(3.0-2.0*f);
      return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
    }
    float fbm(vec2 p) {
      float v = 0.0, amp = 0.5;
      for (int i = 0; i < 5; i++) { v += noise(p) * amp; p *= 2.05; amp *= 0.55; }
      return v;
    }
    void main() {
      vec2 p = (vUv - 0.5) * 3.2;
      float d = length(p);
      float n = fbm(p * 1.6 + uSeed);
      float n2 = fbm(p * 3.2 - uSeed * 2.0);
      float cloud = fbm(p * 2.0 + n * 1.5);
      float falloff = smoothstep(1.7, 0.0, d);
      float density = pow(cloud, 1.6) * falloff;
      vec3 color = mix(uColorA, uColorB, n2);
      float alpha = density * 0.55;
      gl_FragColor = vec4(color * (0.6 + cloud * 0.8), alpha);
    }
  `
};

function buildNebulae() {
  const palettes = [
    [0xff3366, 0x3366ff], [0x33ffcc, 0xff6633], [0xaa33ff, 0x33ffaa],
    [0xff9933, 0x3399ff], [0xff3399, 0x33ff66], [0x33ccff, 0xffcc33],
    [0x9933ff, 0xff3333], [0x33ff99, 0xff33cc]
  ];
  for (let n = 0; n < 10; n++) {
    const [colA, colB] = palettes[n % palettes.length];
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uColorA: { value: new THREE.Color(colA) },
        uColorB: { value: new THREE.Color(colB) },
        uSeed: { value: Math.random() * 100 }
      },
      vertexShader: nebulaShader.vertexShader,
      fragmentShader: nebulaShader.fragmentShader,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geo, mat);
    const cx = (Math.random()-0.5)*4000;
    const cy = (Math.random()-0.5)*2000;
    const cz = (Math.random()-0.5)*4000;
    mesh.position.set(cx, cy, cz);
    mesh.lookAt(0, 0, 0);
    const s = 900 + Math.random() * 1400;
    mesh.scale.set(s, s, 1);
    mesh.rotation.z = Math.random() * Math.PI * 2;
    scene.add(mesh);
  }
}

// ─── Black Hole ───────────────────────────────────────────────
let blackHoleMesh, accretionMesh;
const accretionLayers = [];

function buildBlackHole() {
  // Core (absolute black sphere — renders on top)
  const geo = new THREE.SphereGeometry(CONFIG.bhCoreRadius, 64, 64);
  const mat = new THREE.MeshBasicMaterial({ color: 0x000000, depthWrite: true, depthTest: true });
  blackHoleMesh = new THREE.Mesh(geo, mat);
  blackHoleMesh.renderOrder = 999;
  blackHoleMesh.userData = { id: 'root', type: 'root', label: 'Computer Engineering', level: 0 };
  scene.add(blackHoleMesh);
  allNodes.push(blackHoleMesh);
  nodeLookup['root'] = blackHoleMesh;

  // Photon ring — razor thin gold, additive so it glows not greys
  const photonRing = new THREE.Mesh(
    new THREE.TorusGeometry(CONFIG.bhCoreRadius * 1.26, 0.18, 32, 256),
    new THREE.MeshBasicMaterial({ color: 0xffcc77, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  photonRing.rotation.x = Math.PI / 2;
  scene.add(photonRing);

  // Volumetric accretion disk — 6 stacked layers at slight angle offsets
  // gives illusion of thickness and volume
  const diskAngles = [0, 0.04, -0.04, 0.09, -0.09, 0.15, -0.15];
  const diskOpacities = [0.08, 0.05, 0.05, 0.03, 0.03, 0.015, 0.015];

  diskAngles.forEach((angleOffset, i) => {
    const accGeo = new THREE.RingGeometry(CONFIG.bhDiskInner, CONFIG.bhDiskOuter, 256, 1);
    const accMat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(accretionDiskShader.uniforms),
      vertexShader: accretionDiskShader.vertexShader,
      fragmentShader: accretionDiskShader.fragmentShader,
      transparent: true,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    accMat.uniforms.uInner.value = CONFIG.bhDiskInner;
    accMat.uniforms.uOuter.value = CONFIG.bhDiskOuter;
    const accLayer = new THREE.Mesh(accGeo, accMat);
    accLayer.rotation.x = Math.PI / 2 + 0.18 + angleOffset;
    accLayer.rotation.z = angleOffset * 0.5;
    scene.add(accLayer);
    accretionLayers.push({ mesh: accLayer, opacity: diskOpacities[i] });
    if (i === 0) accretionMesh = accLayer;
  });

  // Outer glow halo around black hole
  const haloGeo = new THREE.SphereGeometry(CONFIG.bhCoreRadius * 1.8, 32, 32);
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0xff6600,
    transparent: true,
    opacity: 0.015,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  scene.add(new THREE.Mesh(haloGeo, haloMat));

  // Deep outer atmospheric glow
  const atmoGeo = new THREE.SphereGeometry(CONFIG.bhCoreRadius * 3.5, 32, 32);
  const atmoMat = new THREE.MeshBasicMaterial({
    color: 0xff4400,
    transparent: true,
    opacity: 0.015,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  scene.add(new THREE.Mesh(atmoGeo, atmoMat));
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
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.0 });
  const line = new THREE.Line(geo, mat);
  line.userData.isConnection = true;
  line.frustumCulled = false;
  line.visible = false;
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

  const domains = data.domains || (data.domain ? [data] : []);
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
    const dGeo = makeSphere(CONFIG.sunSizeBase, 48);
    const dBump = makeBumpTexture(domainSeed * 3, 256);
    const dMat = new THREE.MeshStandardMaterial({
      map: dTex, bumpMap: dBump, bumpScale: 0.3,
      emissive: dColor, emissiveIntensity: CONFIG.sunEmissiveIntensity,
      roughness: 0.55, metalness: 0
    });
    const dMesh = new THREE.Mesh(dGeo, dMat);
    scene.add(dMesh);
    registerNode(dMesh, idFor('domain', domain.domain), domain.domain, 'domain', 1, { domain: domain.domain, description: domain.description, references: domain.references });

    // Corona glow sprite — additive halo around sun
    const coronaTex = makeStarGlowTexture(
      `rgba(${Math.round(dColor.r*255)},${Math.round(dColor.g*255)},${Math.round(dColor.b*255)},1.0)`, 128
    );
    const coronaMat = new THREE.SpriteMaterial({
      map: coronaTex, transparent: true,
      opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false
    });
    const coronaSprite = new THREE.Sprite(coronaMat);
    const coronaSize = CONFIG.sunSizeBase * 5.5;
    coronaSprite.scale.set(coronaSize, coronaSize, 1);
    dMesh.add(coronaSprite);

    // Secondary wider softer corona
    const corona2Mat = new THREE.SpriteMaterial({
      map: coronaTex, transparent: true,
      opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false
    });
    const corona2Sprite = new THREE.Sprite(corona2Mat);
    const corona2Size = CONFIG.sunSizeBase * 11;
    corona2Sprite.scale.set(corona2Size, corona2Size, 1);
    dMesh.add(corona2Sprite);

    // Domain point light — actual luminance
    const dLight = new THREE.PointLight(dColorHex, CONFIG.sunLightIntensity, CONFIG.sunLightRange);
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
      const sGeo = makeSphere(CONFIG.subjectSunSize, 32);
      const sBump = makeBumpTexture(domainSeed * 5, 128);
      const sMat = new THREE.MeshStandardMaterial({
        map: sTex, bumpMap: sBump, bumpScale: 0.25,
        emissive: sColor, emissiveIntensity: CONFIG.sunEmissiveIntensity * 0.8,
        roughness: 0.5
      });
      const sMesh = new THREE.Mesh(sGeo, sMat);
      scene.add(sMesh);
      registerNode(sMesh, idFor('subj', domain.domain, subj.name), subj.name, 'subject', 2, {
        domain: domain.domain, difficulty: subj.difficulty, type: subj.type, description: subj.description, references: subj.references
      });

      // Subject corona glow
      const sCoronaTex = makeStarGlowTexture(
        `rgba(${Math.round(sColor.r*255)},${Math.round(sColor.g*255)},${Math.round(sColor.b*255)},1.0)`, 96
      );
      const sCoronaMat = new THREE.SpriteMaterial({
        map: sCoronaTex, transparent: true,
        opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false
      });
      const sCorona = new THREE.Sprite(sCoronaMat);
      const sCoronaSize = CONFIG.subjectSunSize * 5;
      sCorona.scale.set(sCoronaSize, sCoronaSize, 1);
      sMesh.add(sCorona);

      const sLight = new THREE.PointLight(sColorHex, CONFIG.sunLightIntensity * 0.6, CONFIG.sunLightRange * 0.5);
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
        const cTex = makePlanetTexture(domainSeed, 256);
        const cBump = makeBumpTexture(domainSeed, 256);
        const cColorHex = getNodeColor(3);
        const cGeo = makeSphere(CONFIG.planetSize, 32);
        const cMat = new THREE.MeshStandardMaterial({
          map: cTex, bumpMap: cBump, bumpScale: 0.55,
          roughness: 0.78, metalness: 0.04,
          emissive: new THREE.Color(0x7ec8e3), emissiveIntensity: 0
        });
        const cMesh = new THREE.Mesh(cGeo, cMat);
        scene.add(cMesh);
        registerNode(cMesh, idFor('chap', domain.domain, subj.name, chap.chapter), chap.chapter, 'chapter', 3, {
          domain: domain.domain, subject: subj.name, description: chap.description, references: chap.references
        });

        // Atmosphere rim glow sprite
        const atmColor = new THREE.Color(cTex ? 0x4488ff : 0x88aaff);
        const atmTex = makeStarGlowTexture(`rgba(80,140,255,1.0)`, 64);
        const atmMat = new THREE.SpriteMaterial({
          map: atmTex, transparent: true,
          opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false
        });
        const atmSprite = new THREE.Sprite(atmMat);
        const atmSize = CONFIG.planetSize * 3.2;
        atmSprite.scale.set(atmSize, atmSize, 1);
        cMesh.add(atmSprite);

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
        const subtopics = chap.topics || chap.subtopics || [];
        subtopics.forEach((sub, sti) => {
          domainSeed++;
          const stRadius = CONFIG.subtopicRadiusBase + sti * CONFIG.subtopicRadiusStep;
          const stAngle = (sti / Math.max(subtopics.length, 1)) * Math.PI * 2;
          const stIncl = (Math.random() - 0.5) * 0.8;
          const stGeo = makeSphere(CONFIG.moonSize, 20);
          const stBump = makeBumpTexture(domainSeed * 9, 128);
          // moon color — grey rocky with slight blue tint variation
          const moonHue = 0.55 + (domainSeed % 7) * 0.04;
          const moonColor = new THREE.Color().setHSL(moonHue, 0.12, 0.55 + (domainSeed % 5) * 0.06);
          const stMoonTex = makeMoonTexture(domainSeed * 9, 128);
          const stMat = new THREE.MeshStandardMaterial({
            map: stMoonTex,
            bumpMap: stBump, bumpScale: 0.4,
            roughness: 0.92, metalness: 0.0,
            emissive: new THREE.Color(0x080818), emissiveIntensity: 0.2
          });
          const stMesh = new THREE.Mesh(stGeo, stMat);
          scene.add(stMesh);
          registerNode(stMesh, idFor('sub', domain.domain, subj.name, chap.chapter, sub.name), sub.name, 'subtopic', 4, {
            domain: domain.domain, subject: subj.name, chapter: chap.chapter,
            concepts: sub.concepts || [], description: sub.description, references: sub.references
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
            const conGeo = new THREE.IcosahedronGeometry(CONFIG.asteroidSize, 0);
            const conBump = makeBumpTexture(domainSeed * 11, 32);
            // asteroid color — dark rocky browns and greys
            const astColors = [0x5a4a3a, 0x4a4040, 0x3a3a2a, 0x6a5a4a, 0x3a3030];
            const astColor = astColors[domainSeed % astColors.length];
            const conMat = new THREE.MeshStandardMaterial({
              color: astColor,
              bumpMap: conBump, bumpScale: 0.3,
              roughness: 0.98, metalness: 0.05,
              emissive: new THREE.Color(0x0a0806), emissiveIntensity: 0
            });
            const conMesh = new THREE.Mesh(conGeo, conMat);
            conMesh.visible = false;
            const conObj = (typeof con === 'object' && con !== null);
            const conName2 = conObj ? con.name : con;
            const conDesc = conObj ? con.description : undefined;
            const conRefs = conObj ? con.references : undefined;
            registerNode(conMesh, idFor('con', domain.domain, subj.name, chap.chapter, sub.name, conName2), conName2, 'concept', 5, {
              domain: domain.domain, subject: subj.name, chapter: chap.chapter, subtopic: sub.name, description: conDesc, references: conRefs
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

let _iconRenderer = null, _iconScene = null, _iconCamera = null, _iconLight = null;
function renderIconForMesh(mesh) {
  try {
    if (!_iconRenderer) {
      _iconRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
      _iconRenderer.setSize(128, 128);
      _iconScene = new THREE.Scene();
      _iconCamera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
      _iconCamera.position.set(0, 0, 8);
      _iconScene.add(new THREE.AmbientLight(0x404060, 1.2));
      _iconLight = new THREE.DirectionalLight(0xffffff, 2.2);
      _iconLight.position.set(3, 4, 5);
      _iconScene.add(_iconLight);
    }
    const geo = mesh.geometry.clone();
    geo.computeBoundingSphere();
    const r = geo.boundingSphere ? geo.boundingSphere.radius : 1;
    const iconMesh = new THREE.Mesh(geo, mesh.material);
    iconMesh.scale.setScalar(2.6 / r);
    _iconScene.add(iconMesh);
    _iconCamera.position.set(0, 0, 8);
    _iconCamera.lookAt(0, 0, 0);
    _iconRenderer.render(_iconScene, _iconCamera);
    const url = _iconRenderer.domElement.toDataURL();
    _iconScene.remove(iconMesh);
    geo.dispose();
    return url;
  } catch (e) {
    return null;
  }
}

function makeKebabMenu(items) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:relative;display:inline-block;';
  const btn = document.createElement('button');
  btn.textContent = '⋮';
  btn.style.cssText = 'background:none;border:none;color:#6a7a9a;cursor:pointer;font-size:1rem;padding:0 4px;line-height:1;';
  const menu = document.createElement('div');
  menu.style.cssText = 'display:none;position:absolute;right:0;top:100%;background:#0d1030;border:1px solid #2a3460;border-radius:6px;z-index:999;min-width:100px;box-shadow:0 4px 12px rgba(0,0,0,0.5);';
  items.forEach(({ label, action, danger }) => {
    const item = document.createElement('div');
    item.textContent = label;
    item.style.cssText = `padding:8px 14px;cursor:pointer;font-size:0.78rem;color:${danger ? '#ff6060' : '#cfd8ff'};white-space:nowrap;`;
    item.addEventListener('mouseenter', () => item.style.background = 'rgba(255,255,255,0.06)');
    item.addEventListener('mouseleave', () => item.style.background = '');
    item.addEventListener('click', (e) => { e.stopPropagation(); menu.style.display = 'none'; action(); });
    menu.appendChild(item);
  });
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = menu.style.display === 'block';
    document.querySelectorAll('.kebab-menu-open').forEach(m => { m.style.display = 'none'; m.classList.remove('kebab-menu-open'); });
    menu.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) menu.classList.add('kebab-menu-open');
  });
  document.addEventListener('click', () => { menu.style.display = 'none'; }, { once: false });
  wrap.appendChild(btn);
  wrap.appendChild(menu);
  return wrap;
}

function renderDescriptionSection(body, d, jsonNode) {
  const sec = document.createElement('div');
  sec.className = 'panel-section';
  sec.dataset.descSection = '1';
  if (!jsonNode) {
    sec.innerHTML = '<p style="font-size:0.75rem;color:#c06060;">Could not match this node to theory.json (name mismatch) — editing disabled.</p>';
    body.appendChild(sec);
    return;
  }

  function rebuild() {
    sec.innerHTML = '';
    if (jsonNode && jsonNode.description) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:flex-start;gap:6px;margin-bottom:4px;';
      const sectionTitle = document.createElement('div');
      sectionTitle.style.cssText = 'font-size:0.7rem;text-transform:uppercase;letter-spacing:0.1em;color:#6a7a9a;font-weight:600;flex:1;padding-top:2px;';
      sectionTitle.textContent = 'Description';
      const kebab = makeKebabMenu([
        { label: 'Edit', action: () => showDescEdit() },
        { label: 'Delete', danger: true, action: () => {
          jsonNode.description = '';
          d.description = '';
          saveJsonData();
          rebuild();
        }}
      ]);
      row.appendChild(sectionTitle);
      row.appendChild(kebab);
      sec.appendChild(row);
      const p = document.createElement('p');
      p.style.cssText = 'font-size:0.8rem;color:#a0afc0;line-height:1.5;margin:0;';
      p.textContent = jsonNode.description;
      sec.appendChild(p);
    }

    function showDescEdit(existing) {
      sec.innerHTML = '';
      const label = document.createElement('div');
      label.style.cssText = 'font-size:0.7rem;text-transform:uppercase;letter-spacing:0.1em;color:#6a7a9a;font-weight:600;margin-bottom:6px;';
      label.textContent = 'Description';
      const ta = document.createElement('textarea');
      ta.value = existing || (jsonNode ? jsonNode.description : '') || '';
      ta.style.cssText = 'width:100%;min-height:80px;background:#0a0d25;border:1px solid #2a3460;border-radius:6px;color:#cfd8ff;font-size:0.8rem;padding:8px;resize:vertical;font-family:inherit;box-sizing:border-box;';
      const btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:8px;margin-top:6px;';
      const saveBtn = document.createElement('button');
      saveBtn.textContent = 'Save';
      saveBtn.style.cssText = 'background:#4f8cff;color:#fff;border:none;border-radius:6px;padding:5px 14px;cursor:pointer;font-size:0.78rem;';
      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.style.cssText = 'background:rgba(255,255,255,0.06);color:#cfd8ff;border:1px solid #2a3460;border-radius:6px;padding:5px 14px;cursor:pointer;font-size:0.78rem;';
      saveBtn.addEventListener('click', () => {
        const val = ta.value.trim();
        if (jsonNode) { jsonNode.description = val; d.description = val; }
        saveJsonData();
        rebuild();
      });
      cancelBtn.addEventListener('click', () => rebuild());
      btnRow.appendChild(saveBtn);
      btnRow.appendChild(cancelBtn);
      sec.appendChild(label);
      sec.appendChild(ta);
      sec.appendChild(btnRow);
    }

    if (!jsonNode?.description) {
      const addBtn = document.createElement('button');
      addBtn.textContent = '+ Add description';
      addBtn.style.cssText = 'background:none;border:1px dashed #2a3460;color:#6a7a9a;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:0.75rem;margin-top:2px;';
      addBtn.addEventListener('click', () => showDescEdit());
      sec.appendChild(addBtn);
    }
  }

  rebuild();
  body.appendChild(sec);
}

function renderReferencesSection(body, d, jsonNode) {
  const sec = document.createElement('div');
  sec.className = 'panel-section';
  if (!jsonNode) { return; }

  const REF_TYPES = ['Book', 'Video', 'Article', 'Website', 'Certification', 'Course', 'Paper', 'Documentation', 'Tool', 'Repo'];

  function rebuild() {
    sec.innerHTML = '';
    const refs = (jsonNode && jsonNode.references) ? jsonNode.references : [];

    if (refs.length) {
      const titleRow = document.createElement('div');
      titleRow.style.cssText = 'font-size:0.7rem;text-transform:uppercase;letter-spacing:0.1em;color:#6a7a9a;font-weight:600;margin-bottom:6px;';
      titleRow.textContent = 'References';
      sec.appendChild(titleRow);

      refs.forEach((ref, idx) => {
        const refObj = typeof ref === 'object' ? ref : { title: ref, url: ref, type: 'Website' };
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:5px;';
        const a = document.createElement('a');
        a.removeAttribute?.('href');
        a.dataset.url = refObj.url || '';
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          let url = a.dataset.url;
          if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
          if (url) window.__TAURI__.shell.open(url);
          return false;
        });
        a.style.cssText = 'flex:1;font-size:0.78rem;color:#4f8cff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;';
        a.textContent = refObj.title || refObj.url || '—';
        const typeBadge = document.createElement('span');
        typeBadge.textContent = refObj.type || '';
        typeBadge.style.cssText = 'font-size:0.65rem;color:#6a7a9a;background:rgba(255,255,255,0.05);border-radius:4px;padding:2px 5px;white-space:nowrap;';
        const kebab = makeKebabMenu([
          { label: 'Edit', action: () => showRefForm(idx, refObj) },
          { label: 'Delete', danger: true, action: () => {
            jsonNode.references.splice(idx, 1);
            d.references = jsonNode.references;
            saveJsonData();
            rebuild();
          }}
        ]);
        row.appendChild(a);
        row.appendChild(typeBadge);
        row.appendChild(kebab);
        sec.appendChild(row);
      });
    }

    function showRefForm(editIdx, existing) {
      const form = document.createElement('div');
      form.style.cssText = 'background:#0a0d25;border:1px solid #2a3460;border-radius:8px;padding:10px;margin-top:6px;';
      const fields = [
        { key: 'title', placeholder: 'Display name' },
        { key: 'url', placeholder: 'URL' },
      ];
      const inputs = {};
      fields.forEach(f => {
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.placeholder = f.placeholder;
        inp.value = existing ? (existing[f.key] || '') : '';
        inp.style.cssText = 'width:100%;background:#060918;border:1px solid #2a3460;border-radius:6px;color:#cfd8ff;font-size:0.78rem;padding:6px 8px;margin-bottom:6px;box-sizing:border-box;font-family:inherit;';
        inputs[f.key] = inp;
        form.appendChild(inp);
      });
      const sel = document.createElement('select');
      sel.style.cssText = 'width:100%;background:#060918;border:1px solid #2a3460;border-radius:6px;color:#cfd8ff;font-size:0.78rem;padding:6px 8px;margin-bottom:6px;box-sizing:border-box;font-family:inherit;';
      REF_TYPES.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t;
        opt.textContent = t;
        if (existing && existing.type === t) opt.selected = true;
        sel.appendChild(opt);
      });
      form.appendChild(sel);
      const btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:8px;';
      const saveBtn = document.createElement('button');
      saveBtn.textContent = 'Save';
      saveBtn.style.cssText = 'background:#4f8cff;color:#fff;border:none;border-radius:6px;padding:5px 14px;cursor:pointer;font-size:0.78rem;';
      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.style.cssText = 'background:rgba(255,255,255,0.06);color:#cfd8ff;border:1px solid #2a3460;border-radius:6px;padding:5px 14px;cursor:pointer;font-size:0.78rem;';
      saveBtn.addEventListener('click', () => {
        if (saveBtn.disabled) return;
        saveBtn.disabled = true;
        const newRef = { title: inputs.title.value.trim(), url: inputs.url.value.trim(), type: sel.value };
        if (!jsonNode.references || jsonNode.references === null) jsonNode.references = [];
        if (editIdx !== null && editIdx !== undefined) {
          jsonNode.references[editIdx] = newRef;
        } else {
          jsonNode.references.push(newRef);
        }
        d.references = jsonNode.references;
        saveJsonData();
        rebuild();
      });
      cancelBtn.addEventListener('click', () => { form.remove(); });
      btnRow.appendChild(saveBtn);
      btnRow.appendChild(cancelBtn);
      form.appendChild(btnRow);
      sec.appendChild(form);
    }

    const addBtn = document.createElement('button');
    addBtn.textContent = '+ Add reference';
    addBtn.style.cssText = 'background:none;border:1px dashed #2a3460;color:#6a7a9a;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:0.75rem;margin-top:4px;';
    addBtn.addEventListener('click', () => showRefForm(null, null));
    sec.appendChild(addBtn);
  }

  rebuild();
  body.appendChild(sec);
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

  const icon = document.getElementById('panel-icon');
  const lvl = d.level || 0;
  const colors = ['#000000','#ff6a00','#ffd700','#7ec8e3','#b0c4ff','#ccc'];
  icon.style.backgroundImage = 'none';
  icon.style.background = 'none';
  if (d.type === 'root') {
    icon.style.backgroundImage = `url(${getAccretionDiskIcon()})`;
    icon.style.backgroundSize = 'cover';
    icon.style.boxShadow = '0 0 18px #ff8800aa';
  } else if (mesh.material) {
    const dataUrl = renderIconForMesh(mesh);
    if (dataUrl) {
      icon.style.backgroundImage = `url(${dataUrl})`;
      icon.style.backgroundSize = 'cover';
      icon.style.boxShadow = `0 0 18px ${colors[lvl]}66`;
    } else {
      icon.style.background = `radial-gradient(circle at 35% 35%, ${colors[lvl]}, ${colors[lvl]}88)`;
      icon.style.boxShadow = `0 0 18px ${colors[lvl]}66`;
    }
  } else {
    icon.style.background = `radial-gradient(circle at 35% 35%, ${colors[lvl]}, ${colors[lvl]}88)`;
    icon.style.boxShadow = `0 0 18px ${colors[lvl]}66`;
  }

  const nodeIds = getDescendantIds(mesh);
  const total = nodeIds.length + 1;
  const done = nodeIds.filter(id => STATE.completed[id]).length + (STATE.completed[d.id] ? 1 : 0);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  document.getElementById('panel-progress-fill').style.width = pct + '%';
  document.getElementById('panel-progress-label').textContent = pct + '%';

  const body = document.getElementById('panel-body');
  body.innerHTML = '';

  const jsonNode = findJsonNode(d);

  renderDescriptionSection(body, d, jsonNode);
  renderReferencesSection(body, d, jsonNode);

  const selfSection = document.createElement('div');
  selfSection.className = 'panel-section';
  selfSection.innerHTML = `<div class="panel-section-title">This ${d.type}</div>`;
  const selfItem = makeConceptItem(d.id, d.label);
  selfSection.appendChild(selfItem);
  body.appendChild(selfSection);

  if (d.type === 'subtopic' && d.concepts && d.concepts.length) {
    const conSec = document.createElement('div');
    conSec.className = 'panel-section';
    conSec.innerHTML = '<div class="panel-section-title">Concepts</div>';
    d.concepts.forEach((c) => {
      const cName = (typeof c === 'object' && c !== null) ? c.name : c;
      const cid = idFor('con', d.domain, d.subject, d.chapter, d.label, cName);
      conSec.appendChild(makeConceptItem(cid, cName));
    });
    body.appendChild(conSec);
  }

  const childOrbs = orbits.filter(o => o.parentMesh === mesh && !o.isInstanced);
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
    span.addEventListener('click', () => {
      openPanel(m);
      if (window._focusTreeNode) window._focusTreeNode(m);
    });
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
  el.addEventListener('click', () => {
    const m = nodeLookup[id];
    if (!m) return;
    openPanel(m);
    if (window._focusTreeNode) window._focusTreeNode(m);
  });
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const m = nodeLookup[id];
      if (!m) return;
      openPanel(m);
      if (window._focusTreeNode) window._focusTreeNode(m);
    }
  });
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

  // Black hole accretion disk rotation — all layers
  for (let li = 0; li < accretionLayers.length; li++) {
    const layer = accretionLayers[li];
    // inner layers spin faster, outer slower
    const spinSpeed = 0.18 - li * 0.015;
    layer.mesh.rotation.z += delta * spinSpeed * speed;
    layer.mesh.material.uniforms.uTime.value = STATE.time;
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

// ─── Tree View ──────────────────────────────────────────────
let treeViewActive = false;
function buildTreeData() {
  function walk(mesh) {
    const children = orbits.filter(o => o.parentMesh === mesh && !o.isInstanced).map(o => walk(o.mesh));
    return { mesh, id: mesh.userData.id, label: mesh.userData.label, type: mesh.userData.type, children };
  }
  return walk(blackHoleMesh);
}

function initTreeView() {
  const overlay = document.createElement('div');
  overlay.id = 'tree-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:#000008;z-index:200;display:none;overflow:hidden;cursor:grab;';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('id', 'tree-svg');
  svg.style.cssText = 'width:100%;height:100%;';
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('id', 'tree-g');
  svg.appendChild(g);
  overlay.appendChild(svg);
  document.body.appendChild(overlay);

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕ Close Tree';
  closeBtn.style.cssText = 'position:fixed;top:16px;right:20px;z-index:210;background:#11142a;color:#cfd8ff;border:1px solid #3a4270;padding:8px 14px;border-radius:8px;font-family:inherit;cursor:pointer;font-size:13px;';
  closeBtn.addEventListener('click', () => {
    toggleTreeView(false);
    document.getElementById('view-galaxy-btn').classList.add('active');
    document.getElementById('view-tree-btn').classList.remove('active');
  });
  overlay.appendChild(closeBtn);

  const typeColors = { root:'#888888', domain:'#ff6a00', subject:'#ffd700', chapter:'#7ec8e3', subtopic:'#b0c4ff', concept:'#cccccc' };
  const nodeR = { root:16, domain:11, subject:8, chapter:6, subtopic:4.5, concept:3 };

  let panX = 0, panY = 0, zoom = 1;
  function applyTransform() {
    g.setAttribute('transform', `translate(${panX},${panY}) scale(${zoom})`);
  }

  let _lastTreeRoot = null;
  let dragging = false, dragStart = null, dragged = false;
  overlay.addEventListener('pointerdown', e => {
    if (e.target.closest('.tree-node')) return;
    dragging = true; dragged = false;
    dragStart = { x: e.clientX - panX, y: e.clientY - panY };
  });
  overlay.addEventListener('pointermove', e => {
    if (dragging) {
      const nx = e.clientX - dragStart.x, ny = e.clientY - dragStart.y;
      if (Math.abs(nx - panX) > 3 || Math.abs(ny - panY) > 3) dragged = true;
      panX = nx; panY = ny;
      applyTransform();
    }
  });
  overlay.addEventListener('pointerup', () => { dragging = false; });
  overlay.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = overlay.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const wx = (mx - panX) / zoom, wy = (my - panY) / zoom;
    const delta = -e.deltaY * 0.0012;
    const newZoom = Math.min(Math.max(zoom * Math.exp(delta), 0.15), 3);
    panX = mx - wx * newZoom;
    panY = my - wy * newZoom;
    zoom = newZoom;
    applyTransform();
    const showOuter = zoom > 1.4;
    g.querySelectorAll('.tree-label-outer').forEach(el => { el.style.display = showOuter ? 'block' : 'none'; });
  }, { passive: false });

  function layoutTree(root) {
    const RING_GAP = 110;       // radial distance between depth levels
    const MIN_ARC = 16;         // minimum arc length (px) reserved per leaf, scales radius outward

    // 1) leaf count under each node (its angular "weight")
    function countLeaves(node) {
      if (!node.children.length) { node._leaves = 1; return 1; }
      node._leaves = node.children.reduce((s, c) => s + countLeaves(c), 0);
      return node._leaves;
    }
    countLeaves(root);

    // 2) recursive radial layout: root at center (angle range 0..2π), each node gets an
    // angular slice proportional to its leaf count, children subdivide their parent's slice.
    // This naturally compacts every subtree (chapters, subtopics, concepts, everything)
    // the same way, with no wasted horizontal space.
    // radius per depth grows enough that each ring's circumference can fit
    // (leaves at that depth × MIN_ARC) without overlap
    const leavesAtDepth = {};
    function tally(node, depth) {
      leavesAtDepth[depth] = (leavesAtDepth[depth] || 0) + node._leaves;
      node.children.forEach(c => tally(c, depth + 1));
    }
    tally(root, 0);
    // compute the radius each ring would need based purely on leaf-arc requirements
    const rawRadius = [0];
    let maxDepth = 0;
    Object.keys(leavesAtDepth).forEach(d => maxDepth = Math.max(maxDepth, +d));
    for (let d = 1; d <= maxDepth; d++) {
      const needed = (leavesAtDepth[d] * MIN_ARC) / (Math.PI * 2);
      rawRadius[d] = Math.max(rawRadius[d-1] + RING_GAP, needed);
    }
    // rescale so radius grows by EQUAL increments per depth level (true even diameter spacing),
    // using the largest required increment across all levels as the uniform step —
    // this keeps domains close to center while every ring-to-ring gap stays identical.
    let maxStep = 0;
    for (let d = 1; d <= maxDepth; d++) maxStep = Math.max(maxStep, rawRadius[d] - rawRadius[d-1]);
    const radiusForDepth = [0];
    for (let d = 1; d <= maxDepth; d++) radiusForDepth[d] = radiusForDepth[d-1] + maxStep;

    function place(node, depth, angleStart, angleEnd) {
      const angle = (angleStart + angleEnd) / 2;
      const radius = radiusForDepth[depth] || 0;
      node._x = Math.cos(angle - Math.PI / 2) * radius;
      node._y = Math.sin(angle - Math.PI / 2) * radius;
      node._yOffset = 0;
      node._angle = angle;
      node._depth = depth;

      if (!node.children.length) return;
      let cursor = angleStart;
      const span = angleEnd - angleStart;
      node.children.forEach(c => {
        const slice = span * (c._leaves / node._leaves);
        place(c, depth + 1, cursor, cursor + slice);
        cursor += slice;
      });
    }
    place(root, 0, 0, Math.PI * 2);
  }

  function renderTree(root) {
    g.innerHTML = '';
    layoutTree(root);
    function drawEdges(node) {
      node.children.forEach(c => {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const nx = node._x, ny = node._y + node._yOffset;
        const cx = c._x, cy = c._y + c._yOffset;
        const midX = (nx + cx) / 2, midY = (ny + cy) / 2;
        line.setAttribute('d', `M${nx},${ny} Q${midX},${midY} ${cx},${cy}`);
        line.setAttribute('stroke', '#2a3050');
        line.setAttribute('stroke-width', '1.5');
        line.setAttribute('fill', 'none');
        g.appendChild(line);
        drawEdges(c);
      });
    }
    drawEdges(root);
    function drawNodes(node) {
      const done = isCompleted(node.mesh);
      const r = nodeR[node.type] || 4;
      const color = done ? '#ffd700' : (typeColors[node.type] || '#fff');
      const ny = node._y + node._yOffset;
      const circ = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circ.setAttribute('cx', node._x); circ.setAttribute('cy', ny); circ.setAttribute('r', r);
      circ.setAttribute('fill', color);
      circ.setAttribute('stroke', done ? '#fff7cc' : '#0a0a18');
      circ.setAttribute('stroke-width', '1.5');
      circ.setAttribute('class', 'tree-node');
      circ.style.cursor = 'pointer';
      circ.addEventListener('pointerup', e => {
        if (dragged) return;
        e.stopPropagation();
        e.preventDefault();
        openPanel(node.mesh);
      });
      g.appendChild(circ);

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', node._x);
      text.setAttribute('y', ny + r + 14);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('fill', done ? '#ffd700' : '#cfd8ff');
      const isOuter = node.type === 'concept' || node.type === 'subtopic';
      text.setAttribute('font-size', isOuter ? '7' : '12');
      text.setAttribute('font-family', 'inherit');
      text.textContent = node.label;
      text.style.pointerEvents = 'none';
      if (isOuter) text.style.display = zoom > 1.4 ? 'block' : 'none';
      text.setAttribute('class', 'tree-label' + (isOuter ? ' tree-label-outer' : ''));
      g.appendChild(text);

      node.children.forEach(drawNodes);
    }
    drawNodes(root);
  }

  window._refreshTreeView = () => { if (treeViewActive) { _lastTreeRoot = buildTreeData(); renderTree(_lastTreeRoot); } };

  window._focusTreeNode = (mesh) => {
    if (!treeViewActive) return;
    if (!_lastTreeRoot) _lastTreeRoot = buildTreeData();
    function find(node) {
      if (node.mesh === mesh) return node;
      for (const c of node.children) { const r = find(c); if (r) return r; }
      return null;
    }
    const target = find(_lastTreeRoot);
    if (!target) return;
    const rect = overlay.getBoundingClientRect();
    panX = rect.width / 2 - target._x * zoom;
    panY = rect.height / 2 - (target._y + target._yOffset) * zoom;
    applyTransform();
  };

  window._showTreeView = () => {
    overlay.style.display = 'block';
    panX = window.innerWidth / 2; panY = window.innerHeight / 2; zoom = 0.55;
    applyTransform();
    _lastTreeRoot = buildTreeData();
    renderTree(_lastTreeRoot);
  };
  window._hideTreeView = () => { overlay.style.display = 'none'; };
}

function toggleTreeView(show) {
  treeViewActive = show;
  if (show) window._showTreeView();
  else window._hideTreeView();
}

initTreeView();

document.getElementById('view-tree-btn').addEventListener('click', () => {
  document.getElementById('view-tree-btn').classList.add('active');
  document.getElementById('view-galaxy-btn').classList.remove('active');
  toggleTreeView(true);
});
document.getElementById('view-galaxy-btn').addEventListener('click', () => {
  document.getElementById('view-galaxy-btn').classList.add('active');
  document.getElementById('view-tree-btn').classList.remove('active');
  toggleTreeView(false);
});

canvas.addEventListener('mousemove', onMouseMove);

let _downPos = null;
let _downTime = 0;
let _wasDrag = false;
canvas.addEventListener('pointerdown', e => { _downPos = { x: e.clientX, y: e.clientY }; _downTime = performance.now(); _wasDrag = false; });
canvas.addEventListener('pointermove', e => {
  if (_downPos && !_wasDrag) {
    const dx = e.clientX - _downPos.x, dy = e.clientY - _downPos.y;
    if (Math.sqrt(dx*dx + dy*dy) > 6) {
      _wasDrag = true;
      const panel = document.getElementById('side-panel');
      if (panel.classList.contains('panel-open')) {
        panel.classList.remove('panel-open');
        panel.classList.add('panel-closed');
      }
    }
  }
});
canvas.addEventListener('pointerup', e => {
  const elapsed = performance.now() - _downTime;
  if (!_wasDrag && elapsed < 600) onClick(e);
  _downPos = null;
});

// ─── Resize ───────────────────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  bloomPass.setSize(window.innerWidth, window.innerHeight);
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
    await resolveJsonPath();
    const text = await readTextFile(_jsonFilePath);
    data = JSON.parse(text);
    _jsonData = data;
  } catch (err) {
    console.error(err);
    loadingText.textContent = 'Could not load theory.json — ' + err.message;
    return;
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