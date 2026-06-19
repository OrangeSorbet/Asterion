/* ═══════════════════════════════════════════════════════════════
   CS Galaxy — index.js
   Three.js immersive space learning visualizer
   ═══════════════════════════════════════════════════════════════ */

'use strict';

// ─── State ────────────────────────────────────────────────────
const STATE = {
  speed: 1,
  showOrbits: true,
  showTrails: true,
  audioOn: false,
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
  masterGain.gain.setValueAtTime(0.06, audioCtx.currentTime);
  masterGain.connect(audioCtx.destination);

  const convolver = audioCtx.createConvolver();
  const impulseLen = audioCtx.sampleRate * 3;
  const impulse = audioCtx.createBuffer(2, impulseLen, audioCtx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = impulse.getChannelData(c);
    for (let i = 0; i < impulseLen; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / impulseLen, 2);
  }
  convolver.buffer = impulse;
  convolver.connect(masterGain);

  const freqs = [55, 82.4, 110, 146.8, 164.8];
  freqs.forEach((f, i) => {
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = i % 2 === 0 ? 'sine' : 'triangle';
    osc.frequency.setValueAtTime(f, audioCtx.currentTime);
    g.gain.setValueAtTime(0.12 / freqs.length, audioCtx.currentTime);
    osc.connect(g); g.connect(convolver);
    osc.start();
    drones.push({ osc, gain: g });
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
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000008);
scene.fog = new THREE.FogExp2(0x000010, 0.0008);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 20000);
camera.position.set(0, 180, 420);

const controls = new THREE.OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 20;
controls.maxDistance = 4000;
controls.autoRotate = false;

// ─── Lighting ─────────────────────────────────────────────────
const ambientLight = new THREE.AmbientLight(0x0a0a1a, 1.2);
scene.add(ambientLight);

// Black hole core subtle emanation
const coreLight = new THREE.PointLight(0x9b59b6, 6, 300);
coreLight.position.set(0, 0, 0);
scene.add(coreLight);

// ─── Procedural Textures ─────────────────────────────────────
function makeProceduralTexture(size, fn) {
  const canvas2 = document.createElement('canvas');
  canvas2.width = canvas2.height = size;
  const ctx = canvas2.getContext('2d');
  fn(ctx, size);
  return new THREE.CanvasTexture(canvas2);
}

function noise(x, y, seed = 0) {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed) * 43758.5453;
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
    size: 1.4, sizeAttenuation: true, vertexColors: true,
    transparent: true, opacity: 0.85
  });
  scene.add(new THREE.Points(geo, mat));
}

// ─── Nebula Clouds ───────────────────────────────────────────
function buildNebulae() {
  const nebulaColors = [0x1a0030, 0x001a40, 0x002010, 0x300010];
  for (let n = 0; n < 4; n++) {
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
  const geo = new THREE.SphereGeometry(14, 64, 64);
  const mat = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 1, metalness: 0 });
  blackHoleMesh = new THREE.Mesh(geo, mat);
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
    new THREE.TorusGeometry(18, 1.4, 32, 128),
    new THREE.MeshStandardMaterial({ color: 0x9b59b6, emissive: 0x9b59b6, emissiveIntensity: 3, transparent: true, opacity: 0.7 })
  );
  ring1.rotation.x = Math.PI / 2;
  scene.add(ring1);

  // Accretion disk (flat ring)
  const accGeo = new THREE.RingGeometry(16, 38, 128);
  const accMat = new THREE.MeshBasicMaterial({
    color: 0xff6a00, transparent: true, opacity: 0.18, side: THREE.DoubleSide
  });
  accretionMesh = new THREE.Mesh(accGeo, accMat);
  accretionMesh.rotation.x = Math.PI / 2 + 0.2;
  scene.add(accretionMesh);

  // Second accretion ring (blue)
  const acc2 = new THREE.Mesh(
    new THREE.RingGeometry(20, 50, 128),
    new THREE.MeshBasicMaterial({ color: 0x4f8cff, transparent: true, opacity: 0.08, side: THREE.DoubleSide })
  );
  acc2.rotation.x = Math.PI / 2 - 0.15;
  scene.add(acc2);

  // Gravitational lensing effect — outer glow sphere
  const lensGeo = new THREE.SphereGeometry(22, 32, 32);
  const lensMat = new THREE.MeshBasicMaterial({ color: 0x6c3483, transparent: true, opacity: 0.07, side: THREE.BackSide });
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
  const pts = [];
  for (let i = 0; i < maxLen; i++) pts.push(new THREE.Vector3());
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.4, vertexColors: false });
  const line = new THREE.Line(geo, mat);
  line.userData.isTrail = true;
  line.frustumCulled = false;
  scene.add(line);
  return { line, points: pts.map(() => new THREE.Vector3()), head: 0, maxLen };
}

function updateTrail(trail, pos) {
  trail.points[trail.head].copy(pos);
  trail.head = (trail.head + 1) % trail.maxLen;
  const ordered = [];
  for (let i = 0; i < trail.maxLen; i++) {
    ordered.push(trail.points[(trail.head + i) % trail.maxLen]);
  }
  trail.line.geometry.setFromPoints(ordered);
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
    const pts = [c.from.position.clone(), c.to.position.clone()];
    c.line.geometry.setFromPoints(pts);
    c.line.geometry.attributes.position.needsUpdate = true;
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
  const colors = [0x9b59b6, 0xff6a00, 0xffd700, 0x7ec8e3, 0xb0c4ff, 0xffffff];
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

// ─── Node Point Light (suns) ──────────────────────────────────
function addSunLight(mesh, color) {
  const light = new THREE.PointLight(color, 3, 200);
  mesh.add(light);
}

// ─── Build Galaxy from JSON ───────────────────────────────────
let jsonData = null;

function idFor(...parts) { return parts.join('__').replace(/\s+/g, '_'); }

function makeSphere(radius, segments = 32) {
  return new THREE.SphereGeometry(radius, segments, segments);
}

function registerNode(mesh, id, label, type, level, extra = {}) {
  mesh.userData = { id, label, type, level, ...extra };
  mesh.castShadow = true;
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
  const domainRadius = 220;

  domains.forEach((domain, di) => {
    const dAngle = (di / domainCount) * Math.PI * 2;
    const dIncl = (Math.random() - 0.5) * 0.4;
    domainSeed++;

    // Domain supercluster — large glowing sun
    const dColor = new THREE.Color().setHSL(di / domainCount, 0.85, 0.55);
    const dColorHex = dColor.getHex();
    const dTex = makeSunTexture(domainSeed * 3, 256);
    const dGeo = makeSphere(9, 48);
    const dMat = new THREE.MeshStandardMaterial({
      map: dTex, emissive: dColor, emissiveIntensity: 1.8,
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
      const sRadius = 40 + si * 8;
      const sAngle = (si / Math.max(subjects.length, 1)) * Math.PI * 2;
      const sIncl = (Math.random() - 0.5) * 0.5;
      const sTex = makeSunTexture(domainSeed * 5, 128);
      const sColor = new THREE.Color().setHSL((di / domainCount + 0.05 * si) % 1, 0.75, 0.62);
      const sColorHex = sColor.getHex();
      const sGeo = makeSphere(4.5, 32);
      const sMat = new THREE.MeshStandardMaterial({
        map: sTex, emissive: sColor, emissiveIntensity: 1.4, roughness: 0.5
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
        const cRadius = 16 + ci * 5;
        const cAngle = (ci / Math.max(chapters.length, 1)) * Math.PI * 2;
        const cIncl = (Math.random() - 0.5) * 0.7;
        const cTex = makePlanetTexture(domainSeed, 128);
        const cBump = makeBumpTexture(domainSeed, 128);
        const cColorHex = getNodeColor(3);
        const cGeo = makeSphere(2.2, 24);
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
          const stRadius = 5 + sti * 2.5;
          const stAngle = (sti / Math.max(subtopics.length, 1)) * Math.PI * 2;
          const stIncl = (Math.random() - 0.5) * 0.8;
          const stGeo = makeSphere(0.85, 16);
          const stMat = new THREE.MeshStandardMaterial({
            color: 0xb0c4ff, roughness: 0.8, metalness: 0,
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
            const conRadius = 2.2 + coni * 0.9;
            const conAngle = (coni / Math.max(concepts.length, 1)) * Math.PI * 2;
            const conIncl = (Math.random() - 0.5) * 1.2;
            const conGeo = new THREE.DodecahedronGeometry(0.25 + Math.random() * 0.15, 0);
            const conMat = new THREE.MeshStandardMaterial({
              color: 0xcccccc, roughness: 1, metalness: 0.1,
              emissive: new THREE.Color(0x111111), emissiveIntensity: 0
            });
            const conMesh = new THREE.Mesh(conGeo, conMat);
            scene.add(conMesh);
            registerNode(conMesh, idFor('con', domain.domain, subj.name, chap.chapter, sub.name, con), con, 'concept', 5, {
              domain: domain.domain, subject: subj.name, chapter: chap.chapter, subtopic: sub.name
            });
            orbits.push({
              mesh: conMesh, radius: conRadius, parentMesh: stMesh,
              speed: 0.9 + Math.random() * 0.5,
              angle: conAngle, inclination: conIncl,
              orbitLine: null, orbitParent: stMesh
            });
            const conTrail = makeTrail(0x667788, 15);
            trails.push({ trail: conTrail, mesh: conMesh });
          });
        });
      });
    });
  });

  updateAllNodeMaterials();
}

// ─── Raycasting ───────────────────────────────────────────────
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function onMouseMove(e) {
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(allNodes);

  const tooltip = document.getElementById('tooltip');
  if (intersects.length > 0) {
    const hit = intersects[0].object;
    if (hit !== STATE.hoveredNode) {
      STATE.hoveredNode = hit;
      const d = hit.userData;
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
  const intersects = raycaster.intersectObjects(allNodes);
  if (intersects.length > 0) {
    const hit = intersects[0].object;
    openPanel(hit);
  }
}

// ─── Side Panel ───────────────────────────────────────────────
function openPanel(mesh) {
  STATE.selectedNode = mesh;
  const panel = document.getElementById('side-panel');
  panel.classList.add('panel-open');
  panel.classList.remove('panel-closed');
  refreshPanel();

  // Fly camera toward node
  const target = mesh.position.clone();
  const dist = camera.position.distanceTo(target);
  const dir = camera.position.clone().sub(target).normalize();
  const offset = dist > 150 ? 80 : Math.max(dist * 0.6, 20);
  const newPos = target.clone().add(dir.multiplyScalar(offset));

  // Animate camera
  const start = camera.position.clone();
  const startTarget = controls.target.clone();
  let t = 0;
  function camAnim() {
    t += 0.025;
    camera.position.lerpVectors(start, newPos, Math.min(t, 1));
    controls.target.lerpVectors(startTarget, target, Math.min(t, 1));
    controls.update();
    if (t < 1) requestAnimationFrame(camAnim);
  }
  camAnim();
}

function refreshPanel() {
  const mesh = STATE.selectedNode;
  if (!mesh) return;
  const d = mesh.userData;
  document.getElementById('panel-title').textContent = d.label || '—';
  document.getElementById('panel-type').textContent =
    (d.type ? d.type.charAt(0).toUpperCase() + d.type.slice(1) : '') +
    (d.domain ? ' · ' + d.domain : '') +
    (d.difficulty ? ' · ' + d.difficulty : '');

  // Set icon color
  const icon = document.getElementById('panel-icon');
  const lvl = d.level || 0;
  const colors = ['#9b59b6','#ff6a00','#ffd700','#7ec8e3','#b0c4ff','#ccc'];
  icon.style.background = `radial-gradient(circle at 35% 35%, ${colors[lvl]}, ${colors[lvl]}88)`;
  icon.style.boxShadow = `0 0 18px ${colors[lvl]}66`;

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

function makeConceptItem(id, label) {
  const el = document.createElement('div');
  el.className = 'concept-item' + (STATE.completed[id] ? ' done' : '');
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  el.setAttribute('aria-label', (STATE.completed[id] ? 'Mark incomplete: ' : 'Mark complete: ') + label);
  el.innerHTML = `<div class="concept-checkbox"><div class="concept-checkbox-inner"></div></div><span class="concept-label">${label}</span>`;
  const toggle = () => { toggleCompleted(id); el.classList.toggle('done', !!STATE.completed[id]); };
  el.addEventListener('click', toggle);
  el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
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
function applySearch(query) {
  STATE.searchQuery = query.toLowerCase().trim();
  for (const n of allNodes) {
    const label = (n.userData.label || '').toLowerCase();
    if (!STATE.searchQuery) {
      n.material && (n.material.opacity = n.userData.level >= 4 ? 0.55 : 1);
    } else {
      const matches = label.includes(STATE.searchQuery);
      if (n.material) {
        n.material.opacity = matches ? 1 : 0.08;
        if (matches) {
          triggerRipple(n.userData.id);
        }
      }
    }
  }
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

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  STATE.time += delta;
  const speed = STATE.speed;

  // Black hole accretion disk rotation
  if (accretionMesh) accretionMesh.rotation.z += delta * 0.4 * speed;

  // Update orbits
  for (const o of orbits) {
    o.angle += delta * o.speed * speed;
    const parent = o.parentMesh;
    const px = parent.position.x;
    const py = parent.position.y;
    const pz = parent.position.z;
    const cosI = Math.cos(o.inclination);
    const sinI = Math.sin(o.inclination);
    const localX = Math.cos(o.angle) * o.radius;
    const localZ = Math.sin(o.angle) * o.radius;
    o.mesh.position.set(
      px + localX,
      py + localZ * sinI,
      pz + localZ * cosI
    );
    // Rotate the mesh itself
    o.mesh.rotation.y += delta * 0.3 * speed;
  }

  // Update trails
  if (STATE.showTrails) {
    for (const t of trails) updateTrail(t.trail, t.mesh.position);
  }

  // Update connection lines
  updateConnections();

  // Update ripples
  for (let i = ripples.length - 1; i >= 0; i--) {
    const rip = ripples[i];
    const age = STATE.time - rip.born;
    const dur = 1.5;
    if (age > dur) { scene.remove(rip.mesh); ripples.splice(i, 1); continue; }
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

  controls.update();
  renderer.render(scene, camera);
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
document.getElementById('panel-close').addEventListener('click', () => {
  const panel = document.getElementById('side-panel');
  panel.classList.remove('panel-open');
  panel.classList.add('panel-closed');
  STATE.selectedNode = null;
});
document.getElementById('search-input').addEventListener('input', e => {
  applySearch(e.target.value);
});

canvas.addEventListener('mousemove', onMouseMove);
canvas.addEventListener('click', onClick);

// ─── Resize ───────────────────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ─── Load JSON & Start ────────────────────────────────────────
async function init() {
  const loadingText = document.getElementById('loading-text');
  loadingText.textContent = 'Loading theory.json…';
  loadProgress();
  buildStarfield();
  buildNebulae();

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