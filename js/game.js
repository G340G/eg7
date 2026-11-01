import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// -----------------------------------------------------------------------------
// EPISTASSI — a self-contained, procedural first-person investigation.
// All environments, textures, props, characters and sound are generated locally.
// -----------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const canvas = $('world');
const clock = new THREE.Clock();
const collected = new Set();
const journal = [];
const clueCount = 8;
let currentZone = 'road';
let activeTarget = null;
let dialogueOpen = false;
let journalOpen = false;
let gameStarted = false;
let gameEnded = false;
let listeningPending = false;
let flashlightOn = true;
let audio = null;
let muted = false;
let elapsed = 0;
let dread = 0.12;
let glitchPulse = 0;
let toastTimer = null;
let fear = 0.12;
let eventClock = 0, scenePlayed = false, hiddenBreath = false;
// The thirteen are not background decoration: every one has a scripted fate.
const cultRoster = [];
const cultFateQueue = [];
let cultFateActive = null;
let cultFateClock = 0;
let cultFateCooldown = 0;
const storyFlags = new Set();
const windTrees = [];
const cropPlants = [];
const leafSpecks = [];
let dayNightBlend = 0;
let lastDayAnnouncement = '';

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
} catch (error) {
  const fatal = $('fatal');
  fatal.textContent = `WEBGL IS NOT AVAILABLE.\nOpen the game in an up-to-date desktop browser with hardware acceleration enabled.\nDetails: ${error.message}`;
  fatal.classList.remove('hidden');
  throw error;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.88;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb7b9b4);
scene.fog = new THREE.FogExp2(0xaeb2af, 0.018);
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.08, 190);
camera.position.set(0, 1.63, 0);
// Pointer lock is a convenience for mouse-look, never a prerequisite for movement.
// Keep the player transform separate from the camera so cinematic camera offsets
// cannot move the actual player or interfere with collision detection.
const playerAnchor = new THREE.Group();
playerAnchor.name = 'PLAYER_POSITION';
scene.add(playerAnchor);
playerAnchor.add(camera);
camera.rotation.order = 'YXZ';
const controls = new PointerLockControls(camera, canvas);

const zones = {};
let zone = null;
const forward = new THREE.Vector3();
const cameraWorld = new THREE.Vector3();
const targetVec = new THREE.Vector3();
const moveVec = new THREE.Vector3();
const rightVec = new THREE.Vector3();
const wishVec = new THREE.Vector3();
const velocity = new THREE.Vector3();
const keys = new Set();

// A subtle custom post-process: analogue grain, RGB drift and horizontal tearing.
const GlitchShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, strength: { value: 0.12 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `
    varying vec2 vUv; uniform sampler2D tDiffuse; uniform float time; uniform float strength;
    float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123); }
    void main(){
      vec2 uv=vUv;
      float row=floor(uv.y*190.0);
      float tear=step(0.992,hash(vec2(row,floor(time*7.0))))*strength;
      uv.x += (hash(vec2(row,time))-0.5)*tear*0.13;
      float chroma=(hash(vec2(floor(uv.y*90.0),floor(time*3.0)))-0.5)*0.003*strength;
      vec4 r=texture2D(tDiffuse,uv+vec2(chroma,0.0));
      vec4 g=texture2D(tDiffuse,uv);
      vec4 b=texture2D(tDiffuse,uv-vec2(chroma,0.0));
      vec3 col=vec3(r.r,g.g,b.b);
      float grain=(hash(uv*vec2(900.0,650.0)+time*13.0)-0.5)*0.075*strength;
      col += grain;
      float scan=sin(uv.y*920.0)*0.012*strength;
      col -= scan;
      gl_FragColor=vec4(col,1.0);
    }`
};
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.34, 0.62, 0.78);
composer.addPass(bloom);
const glitchPass = new ShaderPass(GlitchShader);
composer.addPass(glitchPass);

// -----------------------------------------------------------------------------
// Procedural materials and geometry
// -----------------------------------------------------------------------------
function noiseTexture(kind = 'plaster', seed = 1, size = 256) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  let s = seed >>> 0;
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const base = kind === 'concrete' ? [93, 96, 91] : kind === 'wood' ? [69, 52, 38] : kind === 'rust' ? [82, 49, 37] : [112, 112, 103];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const n = (rand() - 0.5) * (kind === 'wood' ? 52 : 72);
      const streak = kind === 'wood' ? Math.sin(y * 0.11 + rand() * 3) * 12 : 0;
      const stain = (rand() > 0.992 ? -40 : 0) + (rand() > 0.997 ? 34 : 0);
      img.data[i] = Math.max(0, Math.min(255, base[0] + n + streak + stain));
      img.data[i + 1] = Math.max(0, Math.min(255, base[1] + n + streak * 0.75 + stain));
      img.data[i + 2] = Math.max(0, Math.min(255, base[2] + n + streak * 0.5 + stain));
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // Layered damp blooms, mineral tide marks and soot: deliberately irregular, never clean tiling.
  for(let k=0;k<95;k++){const x=rand()*size,y=rand()*size,r=2+rand()*30;ctx.beginPath();ctx.fillStyle=`rgba(${kind==='rust'?68:24},${kind==='rust'?34:29},${kind==='rust'?20:24},${.025+rand()*.075})`;ctx.ellipse(x,y,r,r*(.25+rand()),rand()*3.14,0,Math.PI*2);ctx.fill();}
  for(let k=0;k<700;k++){const x=rand()*size,y=rand()*size;ctx.fillStyle=rand()>.5?'rgba(8,9,8,.16)':'rgba(205,198,177,.08)';ctx.fillRect(x,y,1+rand()*2,1+rand()*2);}
  // Fine cracks, plaster scars and wood grain are baked into the albedo.
  if (kind !== 'wood') {
    ctx.globalAlpha = 0.23; ctx.strokeStyle = '#151513'; ctx.lineWidth = 1;
    for (let n = 0; n < 22; n++) {
      let x = rand() * size, y = rand() * size;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let j = 0; j < 6; j++) { x += (rand() - 0.5) * 26; y += 5 + rand() * 24; ctx.lineTo(x, y); }
      ctx.stroke();
    }
  } else {
    ctx.globalAlpha = 0.12; ctx.strokeStyle = '#d2b48d';
    for (let i = 0; i < 35; i++) { const y = rand() * size; ctx.beginPath(); ctx.moveTo(0, y); ctx.bezierCurveTo(size * .3, y - 8, size * .6, y + 12, size, y + rand() * 6); ctx.stroke(); }
  }
  const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}
function brickTexture(seed = 211, size = 512) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d'); let state = seed >>> 0;
  const rand = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
  x.fillStyle = '#292824'; x.fillRect(0, 0, size, size);
  const brickW = 92, brickH = 37, mortar = 6;
  for (let row = 0; row < Math.ceil(size / (brickH + mortar)); row++) {
    const offset = row % 2 ? -brickW / 2 : 0;
    for (let col = -1; col < Math.ceil(size / brickW) + 1; col++) {
      const xx = col * brickW + offset + mortar / 2, yy = row * (brickH + mortar) + mortar / 2;
      const tone = Math.floor(55 + rand() * 42);
      x.fillStyle = `rgb(${tone+27},${tone+7},${tone-3})`;
      x.fillRect(xx, yy, brickW - mortar, brickH - mortar);
      x.fillStyle = 'rgba(7,8,7,.26)'; x.fillRect(xx, yy + brickH - mortar - 3, brickW - mortar, 3);
      x.fillStyle = 'rgba(202,174,143,.10)'; x.fillRect(xx + 4, yy + 3, brickW - mortar - 8, 2);
      for (let n=0;n<9;n++) { x.fillStyle = rand()>.5?'rgba(8,8,7,.15)':'rgba(220,190,150,.07)'; x.fillRect(xx+rand()*(brickW-mortar),yy+rand()*(brickH-mortar),1+rand()*5,1+rand()*2); }
    }
  }
  for (let i=0;i<600;i++) { x.fillStyle=rand()>.5?'rgba(0,0,0,.12)':'rgba(200,190,170,.06)'; x.fillRect(rand()*size,rand()*size,1+rand()*3,1+rand()*2); }
  const t = new THREE.CanvasTexture(c); t.wrapS=t.wrapT=THREE.RepeatWrapping; t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=8; t.repeat.set(2.4,1.1); return t;
}
const TEX = {
  concrete: noiseTexture('concrete', 17), plaster: noiseTexture('plaster', 28), wood: noiseTexture('wood', 49),
  rust: noiseTexture('rust', 81), road: noiseTexture('concrete', 107), brick: brickTexture()
};

// Archival photo fragments: Wikimedia Commons files marked public domain / PD-Art.
// The browser loads these at runtime; the images are not copied into the repository.
const PHOTO_ARCHIVE = {
  oldman: {
    url: 'https://upload.wikimedia.org/wikipedia/commons/1/17/Old_man_sitting_portrait.jpg',
    page: 'https://commons.wikimedia.org/wiki/File:Old_man_sitting_portrait.jpg',
    credit: 'Charles R. Savage / Harold B. Lee Library collection; public-domain photograph (photographer died 1909).',
    face: [.415,.205,.205,.185], mode: 'dark'
  },
  woman: {
    url: 'https://upload.wikimedia.org/wikipedia/commons/6/62/Portrait_of_a_woman_seated%2C_ca_1900_%28BOYD%2BBRAAS_152%29.jpg',
    page: 'https://commons.wikimedia.org/wiki/File:Portrait_of_a_woman_seated,_ca_1900_(BOYD+BRAAS_152).jpg',
    credit: 'George H. Braas, ca. 1900; public domain (photographer died 1914).',
    face: [.365,.105,.285,.205], mode: 'light'
  },
  elder: {
    url: 'https://upload.wikimedia.org/wikipedia/commons/f/f6/Photograph_of_an_unknown_elderly_woman_seated_in_a_chair%2C_1915_July_8_-_DPLA_-_a4514cc231ec6c8a825be296c0879ce4.jpg',
    page: 'https://commons.wikimedia.org/wiki/File:Photograph_of_an_unknown_elderly_woman_seated_in_a_chair,_1915_July_8_-_DPLA_-_a4514cc231ec6c8a825be296c0879ce4.jpg',
    credit: 'Unknown photographer, 8 July 1915; DPLA / Wikimedia Commons, public domain in the United States.',
    face: [.385,.285,.235,.155], mode: 'light'
  },
  roomwoman: {
    url: 'https://upload.wikimedia.org/wikipedia/commons/5/58/Charles_Henry_Currier_01945v.jpg',
    page: 'https://commons.wikimedia.org/wiki/File:Charles_Henry_Currier_01945v.jpg',
    credit: 'Charles Henry Currier, ca. 1890–1900; Library of Congress source, public-domain photograph.',
    face: [.495,.385,.095,.155], mode: 'light'
  },
  man: {
    url: 'https://upload.wikimedia.org/wikipedia/commons/8/82/Full-length_portrait_of_a_man_LCCN2006689630.jpg',
    page: 'https://commons.wikimedia.org/wiki/File:Full-length_portrait_of_a_man_LCCN2006689630.jpg',
    credit: 'Library of Congress, LCCN 2006689630; 19th-century portrait, public domain / no known publication restrictions.',
    face: [.415,.265,.185,.16], mode: 'light'
  }
};
const PHOTO_IMAGES = {};
const photoNPCs = [];
const evidenceRefreshers = [];
function makeFaceCanvas(image, spec) {
  const c=document.createElement('canvas'); c.width=256; c.height=320; const ctx=c.getContext('2d');
  const [x,y,w,h]=spec.face; ctx.save(); ctx.filter='grayscale(100%) contrast(1.28) brightness(.86) sepia(12%)';
  ctx.drawImage(image,x*image.width,y*image.height,w*image.width,h*image.height,0,0,256,320); ctx.restore();
  const d=ctx.getImageData(0,0,256,320);
  for(let i=0;i<d.data.length;i+=4){ const l=(d.data[i]+d.data[i+1]+d.data[i+2])/3; const v=Math.max(0,Math.min(1,(l-18)/220)); d.data[i]=Math.min(255,d.data[i]*.88+20); d.data[i+1]=Math.min(255,d.data[i+1]*.83+13); d.data[i+2]=Math.min(255,d.data[i+2]*.78+7); d.data[i+3]=Math.round(255*Math.min(1,v*1.7)); }
  ctx.putImageData(d,0,0); ctx.globalCompositeOperation='destination-in'; ctx.beginPath(); ctx.ellipse(128,160,119,153,0,0,Math.PI*2); ctx.fill();
  const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=4; return t;
}
function makeBodyCanvas(image, spec) {
  const c=document.createElement('canvas'); c.width=360; c.height=720; const ctx=c.getContext('2d');
  ctx.filter='grayscale(100%) contrast(1.32) brightness(.82) sepia(13%)';
  const scale=Math.min(340/image.width,700/image.height), w=image.width*scale, h=image.height*scale;
  ctx.drawImage(image,(360-w)/2,(720-h)/2,w,h); ctx.filter='none';
  const d=ctx.getImageData(0,0,360,720);
  for(let i=0;i<d.data.length;i+=4){ const r=d.data[i],g=d.data[i+1],b=d.data[i+2], lum=(r+g+b)/3; const edge=spec.mode==='dark' ? lum<20 : lum>249; if(edge)d.data[i+3]=0; }
  ctx.putImageData(d,0,0);
  // Torn archival edges: tiny irregular holes make the photograph read as a found cut-out.
  ctx.globalCompositeOperation='destination-out'; for(let i=0;i<170;i++){const xx=Math.random()*360, yy=Math.random()*720; if(xx<15||xx>345||yy<8||yy>712){ctx.fillStyle=`rgba(0,0,0,${Math.random()*.8})`;ctx.beginPath();ctx.arc(xx,yy,Math.random()*5,0,Math.PI*2);ctx.fill();}}
  const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=4; return t;
}
function refreshPhotoNPC(npc) {
  const key=npc.photoKey, image=PHOTO_IMAGES[key]; if(!image)return;
  const spec=PHOTO_ARCHIVE[key];
  try { const face=makeFaceCanvas(image,spec); npc.photoFace.material.map?.dispose?.(); npc.photoFace.material.map=face; npc.photoFace.material.needsUpdate=true; npc.photoFace.visible=true; } catch(err) { npc.photoFace.visible=false; console.warn('Could not crop archival face:',key,err); }
  if(npc.photoBody?.material&&spec.mode!=='dark') { try { const body=makeBodyCanvas(image,spec); npc.photoBody.material.map?.dispose?.(); npc.photoBody.material.map=body; npc.photoBody.material.needsUpdate=true; npc.photoBody.visible=true; } catch(err) { console.warn('Could not cut out archival body:',key,err); } }
}
function profileForNPC(name, variant) {
  const n=name.toLowerCase();
  if(n.includes('ines'))return 'woman'; if(n.includes('donna al canale'))return 'elder';
  if(n.includes('vedova')||n.includes('anna'))return 'elder'; if(n.includes('ottavio')||n.includes('cappotto'))return 'oldman';
  if(n.includes('remo')||n.includes('cantore')||n.includes('primo'))return 'man'; return variant===0?'woman':'oldman';
}
Object.entries(PHOTO_ARCHIVE).forEach(([key,spec])=>{
  const img=new Image(); img.crossOrigin='anonymous'; img.decoding='async';
  img.onload=()=>{PHOTO_IMAGES[key]=img; photoNPCs.filter(n=>n.photoKey===key).forEach(refreshPhotoNPC); evidenceRefreshers.forEach(fn=>fn());};
  img.onerror=()=>console.warn('Archival photo could not be loaded:', key, spec.url);
  img.src=spec.url;
} );
function mat(color, rough = .92, options = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: options.metalness ?? 0.02, map: options.map || null, bumpMap: options.map || null, bumpScale: options.bumpScale ?? 0.075,
    emissive: options.emissive || 0x000000, emissiveIntensity: options.emissiveIntensity || 0, side: options.side || THREE.FrontSide });
}
const M = {
  ground: mat(0x777b73, 1, { map: TEX.concrete }), asphalt: mat(0x343a38, 1, { map: TEX.road }), wall: mat(0x77756a, 1, { map: TEX.plaster }),
  darkWall: mat(0x393a35, 1, { map: TEX.concrete }), wood: mat(0x554332, 1, { map: TEX.wood }), darkWood: mat(0x2b241d, 1, { map: TEX.wood }),
  rust: mat(0x634033, 1, { map: TEX.rust }), brick: mat(0x76513e, 1, { map: TEX.brick }), black: mat(0x101210, 1), metal: mat(0x353735, .72, { metalness: .45 }),
  skin: mat(0x655b51, 1, { map: TEX.plaster, bumpScale: .035 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x9aa4a0, roughness: .22, metalness: .15, transparent: true, opacity: .23 }),
  blood: mat(0x3b090b, .5, { emissive: 0x250000, emissiveIntensity: .24 }),
  gold: mat(0x8c7148, .5, { metalness: .62 }),
  warmLight: mat(0x332112, .35, { emissive: 0xffb65c, emissiveIntensity: 2.4 }),
  clue: mat(0x9e8152, .65, { emissive: 0x6e4c27, emissiveIntensity: .48 })
};
function addBox(group, x, y, z, w, h, d, material, options = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z); mesh.castShadow = options.castShadow !== false; mesh.receiveShadow = options.receiveShadow !== false;
  if (options.rotation) mesh.rotation.set(...options.rotation);
  if (options.name) mesh.name = options.name;
  group.add(mesh); return mesh;
}
function addPlane(group, x, y, z, w, h, material, rotation = [-Math.PI / 2, 0, 0]) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material); mesh.position.set(x, y, z); mesh.rotation.set(...rotation); mesh.receiveShadow = true; group.add(mesh); return mesh;
}
function addLight(group, color, intensity, distance, x, y, z, options = {}) {
  const light = new THREE.PointLight(color, intensity, distance, options.decay || 2);
  light.position.set(x, y, z); light.castShadow = !!options.shadow; group.add(light); return light;
}
function addFog(group, count, span, color = 0xd6d9d6, seed = 10) {
  const fogGroup = new THREE.Group(); group.add(fogGroup);
  const texCanvas = document.createElement('canvas'); texCanvas.width = texCanvas.height = 128;
  const ctx = texCanvas.getContext('2d'); const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,.82)'); grad.addColorStop(.48, 'rgba(255,255,255,.24)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 128, 128);
  const fogTex = new THREE.CanvasTexture(texCanvas);
  const fogMaterial = new THREE.SpriteMaterial({ map: fogTex, color, transparent: true, opacity: .10, depthWrite: false });
  let s = seed;
  const rand = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  for (let i = 0; i < count; i++) {
    const sprite = new THREE.Sprite(fogMaterial);
    sprite.position.set((rand() - .5) * span, .4 + rand() * 4.2, (rand() - .5) * span);
    const sc = 9 + rand() * 24; sprite.scale.set(sc * (1.2 + rand()), sc * .58, 1); sprite.userData.phase = rand() * 6.28; fogGroup.add(sprite);
  }
  return fogGroup;
}
function makeLabelTexture(text, width = 512, height = 128) {
  const c = document.createElement('canvas'); c.width = width; c.height = height; const x = c.getContext('2d');
  x.fillStyle = '#d2c8b3'; x.fillRect(0, 0, width, height); x.fillStyle = 'rgba(35,31,25,.16)';
  for (let i = 0; i < 2500; i++) { x.fillRect(Math.random() * width, Math.random() * height, 1 + Math.random() * 3, 1); }
  x.fillStyle = '#282722'; x.font = '22px monospace'; x.textAlign = 'center'; x.fillText(text, width / 2, height / 2 + 8);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function makeEvidenceCanvas(title, id, imageKey='oldman') {
  const c=document.createElement('canvas'); c.width=512; c.height=352; const ctx=c.getContext('2d');
  const draw=()=>{
    ctx.fillStyle='#b6a98e';ctx.fillRect(0,0,512,352);ctx.fillStyle='#27241e';ctx.fillRect(10,10,492,332);
    ctx.fillStyle='#c9bda2';ctx.fillRect(17,17,478,318);ctx.fillStyle='#24231f';ctx.font='bold 19px monospace';ctx.fillText('ARCHIVIO 14-B   /   ' + id.toUpperCase(),30,45);
    ctx.fillStyle='#39352e';ctx.font='16px serif';ctx.fillText(title.toUpperCase(),30,72);
    const img=PHOTO_IMAGES[imageKey];
    if(img){const ar=img.width/img.height;let sw=img.width,sh=img.height;if(ar>1.55){sw=img.height*1.55; }else if(ar<.64){sh=img.width/.64;} const sx=(img.width-sw)/2,sy=(img.height-sh)/2;ctx.save();ctx.filter='grayscale(100%) sepia(18%) contrast(1.2)';ctx.drawImage(img,sx,sy,sw,sh,30,88,205,190);ctx.restore();}
    else {ctx.fillStyle='#655b4b';ctx.fillRect(30,88,205,190);ctx.strokeStyle='#27241e';ctx.lineWidth=2;for(let i=0;i<7;i++){ctx.beginPath();ctx.moveTo(34,100+i*25);ctx.lineTo(230,96+i*25);ctx.stroke();}}
    ctx.fillStyle='#3d392f';ctx.font='14px monospace';ctx.fillText('NEGATIVE / UNDEVELOPED',256,113);ctx.fillText('TIME: 03:17',256,143);ctx.fillText('DAMAGED EMULSION',256,173);
    ctx.strokeStyle='#29251f';ctx.lineWidth=1;for(let i=0;i<9;i++){ctx.beginPath();ctx.moveTo(256,200+i*12);ctx.lineTo(470-(i%3)*25,200+i*12);ctx.stroke();}
    ctx.fillStyle='rgba(50,35,25,.45)';ctx.font='italic 18px serif';ctx.fillText('do not stare for too long',30,312);
    for(let i=0;i<1400;i++){ctx.fillStyle=Math.random()>.5?'rgba(25,20,12,.09)':'rgba(255,255,255,.10)';ctx.fillRect(Math.random()*512,Math.random()*352,1+Math.random()*2,1);}
  };draw();const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;
  evidenceRefreshers.push(()=>{draw();t.needsUpdate=true;});return t;
}
function addClueMesh(group, pos, title, description, id, kind = 'paper') {
  const root = new THREE.Group(); root.position.copy(pos); group.add(root); let object;
  const imageKey=({clipping:'oldman',mass:'elder',photo:'man',voicemail:'woman'})[id]||'oldman';
  if (kind === 'paper') {
    object = new THREE.Mesh(new THREE.PlaneGeometry(.62, .43), new THREE.MeshStandardMaterial({ map: makeEvidenceCanvas(title,id,imageKey), side: THREE.DoubleSide, roughness: .96 }));
    object.rotation.x = -Math.PI / 2; object.rotation.z = -.12; object.position.y = .065;
    const curled=addBox(root,.28,.06,.17,.055,.018,.34,M.wood,{rotation:[0,0,.12],castShadow:false});
  } else if (kind === 'metal') {
    object = new THREE.Mesh(new THREE.CylinderGeometry(.085, .085, .55, 16), M.gold); object.rotation.z = Math.PI / 2; object.position.y = .16;
    const tag=new THREE.Mesh(new THREE.PlaneGeometry(.28,.19),new THREE.MeshBasicMaterial({map:makeEvidenceCanvas(title,id,imageKey),side:THREE.DoubleSide}));tag.position.set(0,.23,.13);root.add(tag);
  } else {
    object = new THREE.Mesh(new THREE.BoxGeometry(.34, .07, .25), M.wood); object.position.y = .06;
    const plate=new THREE.Mesh(new THREE.PlaneGeometry(.36,.25),new THREE.MeshBasicMaterial({map:makeEvidenceCanvas(title,id,imageKey),side:THREE.DoubleSide}));plate.rotation.x=-Math.PI/2;plate.position.y=.105;root.add(plate);
  }
  root.add(object);
  const glow = new THREE.PointLight(0xd5b27b, .23, 2.5); glow.position.y = .5; root.add(glow);
  const entry = { id, type: 'clue', object: root, point: root.position, radius: 3.0, prompt: `[ E ] COLLECT — ${title.toUpperCase()}`, title, description, kind };
  group.userData.interactables.push(entry); return root;
}
function makeNPC(group, x, z, name, coatColor = 0x272725, variant = 0) {
  const root = new THREE.Group(); root.position.set(x, 0, z); group.add(root);
  const coatMaterial=mat(coatColor,1,{map:TEX.wood,bumpScale:.04});
  const coat = new THREE.Mesh(new THREE.CapsuleGeometry(.33, .76, 6, 12), coatMaterial); coat.position.y = .94; coat.castShadow = true; root.add(coat);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.245, 24, 18), mat(variant === 1 ? 0x77766d : 0x4d4d48, 1)); head.position.y = 1.7; head.scale.set(.86, 1.12, .9); root.add(head);
  const eyeWhite=mat(0xb8b0a0,.82), pupilMat=mat(0x151412,.42), lidMat=mat(0x554b40,.98);
  const eyes=[], lids=[];
  for(const side of [-1,1]){
    const eye=new THREE.Mesh(new THREE.SphereGeometry(.026,10,8),eyeWhite);eye.position.set(side*.078,1.755,.258);root.add(eye);
    const pupil=new THREE.Mesh(new THREE.SphereGeometry(.011,8,6),pupilMat);pupil.position.set(side*.078,1.755,.281);root.add(pupil);
    const lid=new THREE.Mesh(new THREE.SphereGeometry(.039,10,8),lidMat);lid.scale.set(1,.08,.36);lid.position.set(side*.078,1.783,.265);root.add(lid);eyes.push(eye,pupil);lids.push(lid);
  }
  const faceMaterial=new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.97,side:THREE.DoubleSide,depthWrite:false});
  const photoFace=new THREE.Mesh(new THREE.PlaneGeometry(.29,.37),faceMaterial);photoFace.position.set(0,1.71,.226);photoFace.visible=false;root.add(photoFace);
  const mask = new THREE.Mesh(new THREE.BoxGeometry(.26, .085, .035), mat(0x0b0b0b, .8)); mask.position.set(0, 1.71, -.205); mask.visible=false; root.add(mask);
  const armMat=mat(coatColor,1,{map:TEX.wood,bumpScale:.04});
  const leftArm=new THREE.Mesh(new THREE.CapsuleGeometry(.095,.42,5,9),armMat);leftArm.position.set(-.39,1.0,.01);leftArm.rotation.z=-.16;root.add(leftArm);
  const rightArm=new THREE.Mesh(new THREE.CapsuleGeometry(.095,.42,5,9),armMat);rightArm.position.set(.39,1.0,.01);rightArm.rotation.z=.16;root.add(rightArm);
  const leftForearm=new THREE.Mesh(new THREE.CapsuleGeometry(.075,.31,4,8),M.skin);leftForearm.position.set(-.43,.67,.06);leftForearm.rotation.z=-.24;root.add(leftForearm);
  const rightForearm=new THREE.Mesh(new THREE.CapsuleGeometry(.075,.31,4,8),M.skin);rightForearm.position.set(.43,.67,.06);rightForearm.rotation.z=.24;root.add(rightForearm);
  const handMat=mat(0x6c6257,.95);for(const side of [-1,1]){const hand=new THREE.Mesh(new THREE.SphereGeometry(.085,10,8),handMat);hand.scale.set(.75,1.2,.6);hand.position.set(side*.47,.42,.08);root.add(hand);}
  const legMat=mat(0x292824,1,{map:TEX.wood}); const legs=[]; const shoes=[];
  for(const side of [-1,1]){const leg=new THREE.Mesh(new THREE.CapsuleGeometry(.13,.62,5,9),legMat);leg.position.set(side*.17,.28,0);root.add(leg);const shoe=new THREE.Mesh(new THREE.BoxGeometry(.18,.12,.32),M.black);shoe.position.set(side*.17,.055,.07);root.add(shoe);legs.push(leg);shoes.push(shoe);}
  const collar = new THREE.Mesh(new THREE.BoxGeometry(.43, .12, .28), M.darkWood); collar.position.y = 1.36; root.add(collar);
  // A photographed, torn-edged cut-out supplies actual archival face, torso and limb detail.
  const photoKey=profileForNPC(name,variant);
  const photoMat=new THREE.SpriteMaterial({color:0xffffff,transparent:true,opacity:.78,depthWrite:false,side:THREE.DoubleSide});
  const photoBody=new THREE.Sprite(photoMat);photoBody.position.set(0,1.03,.115);photoBody.scale.set(.92,1.88,1);photoBody.visible=false;root.add(photoBody);
  const npc = { id: `npc_${name.toLowerCase().replace(/\W/g, '_')}`, type: 'npc', object: root, point: root.position, radius: 3.4, prompt: `[ E ] SPEAK — ${name.toUpperCase()}`, name, phase: Math.random() * 7, coat, leftArm, rightArm, photoFace, photoBody, photoKey, leftForearm, rightForearm, legs, shoes, eyes, lids, blinkTimer:1.8+Math.random()*4, blinkAmount:0, walking:false, cultist:false, fate:'present' };
  photoNPCs.push(npc); refreshPhotoNPC(npc);
  group.userData.interactables.push(npc); return npc;
}
function registerCultist(npc, dialogue=null) {
  npc.cultist=true; npc.fate='present'; npc.object.userData.cultist=true;
  if(dialogue) npc.dialogue=dialogue;
  cultRoster.push(npc); return npc;
}
function addCultist(zone, x, z, name, coat=0x34332f, variant=0, line='We are not here to listen yet. We are here to make room.', choices=['What are you waiting for?','Who called you here?'], replies=['The moment someone stops having a name.','The room was full before we arrived.']) {
  const npc=makeNPC(zone.group,x,z,name,coat,variant);
  npc.dialogue={line,choices,replies}; return registerCultist(npc);
}
function queueCultFate(source='una traccia', preferred=null, mode=null) {
  const npc=preferred || [...cultRoster].reverse().find(n=>n.fate==='present');
  if(!npc || npc.fate!=='present') return null;
  npc.fate='queued';cultFateQueue.push({npc,source,mode:mode||(cultFateQueue.length%3===1?'collapse':'vanish')});
  return npc;
}
function removeQueuedCultist(npc) {
  for(let i=cultFateQueue.length-1;i>=0;i--) if(cultFateQueue[i].npc===npc) cultFateQueue.splice(i,1);
}
function transferCultist(npc, targetZone, x, z) {
  if(!npc || !targetZone) return;
  const oldParent=npc.object.parent; if(oldParent) oldParent.remove(npc.object);
  npc.object.position.set(x,0,z);npc.point=npc.object.position;targetZone.group.add(npc.object);
  const old=Object.values(zones).find(v=>v.interactables.includes(npc)); if(old) old.interactables.splice(old.interactables.indexOf(npc),1);
  npc.object.visible=true;
}
function startCultFate(entry) {
  if(!entry || cultFateActive) return;
  const npc=entry.npc; npc.fate='in-progress';npc.object.visible=true;
  const oldZone=Object.values(zones).find(v=>v.interactables.includes(npc));if(oldZone){const index=oldZone.interactables.indexOf(npc);if(index>=0)oldZone.interactables.splice(index,1);}
  const playerAt=currentPosition().clone();
  controls.getDirection(forward);forward.y=0;forward.normalize();
  const side=new THREE.Vector3(-forward.z,0,forward.x).multiplyScalar((cultRoster.indexOf(npc)%3-1)*.72);
  // Every fate is staged in the player's forward field of view, even when
  // the cultist already belongs to the current room. This avoids off-screen
  // removals when a clue is collected near one of the thirteen.
  const sx=THREE.MathUtils.clamp(playerAt.x+forward.x*5.3+side.x,zone.bounds.minX+1,zone.bounds.maxX-1);
  const sz=THREE.MathUtils.clamp(playerAt.z+forward.z*5.3+side.z,zone.bounds.minZ+1,zone.bounds.maxZ-1);
  if(npc.object.parent!==zone.group) transferCultist(npc,zone,sx,sz);
  else npc.object.position.set(sx,0,sz);
  npc.point=npc.object.position;
  npc.object.lookAt(playerAt.x,0,playerAt.z);
  const approach=playerAt.clone().addScaledVector(forward,1.45).addScaledVector(side,.18);
  approach.x=THREE.MathUtils.clamp(approach.x,zone.bounds.minX+1,zone.bounds.maxX-1);
  approach.z=THREE.MathUtils.clamp(approach.z,zone.bounds.minZ+1,zone.bounds.maxZ-1);
  cultFateActive={...entry,phase:0,start:npc.object.position.clone(),target:approach,elapsed:0};
  showToast(entry.mode==='collapse'?`${npc.name.toUpperCase()} HA SMESSO DI SOSTENERSI.`:`${npc.name.toUpperCase()} HA LASCIATO IL POSTO.`);
  if(entry.mode==='collapse') speakVoice(`${npc.name}. There is nothing left to fill.`,npc.name);
  else speakVoice(`${npc.name}: Do not remember my face.`,npc.name);
  glitchPulse=Math.max(glitchPulse,.85);audio?.killingAudio();
}
function updateCultSequence(dt,t) {
  if(cultFateActive){
    const a=cultFateActive,n=a.npc;a.elapsed+=dt;
    if(a.mode==='collapse'){
      const k=THREE.MathUtils.clamp(a.elapsed/1.55,0,1);n.object.rotation.x=THREE.MathUtils.lerp(0,1.43,k);n.object.rotation.z=Math.sin(k*2)*.18;n.object.position.y=-.18*k;
      n.object.position.x=a.start.x+Math.sin(k*4)*.08;
      if(k>=1&&a.elapsed>2.4){
        const stain=new THREE.Mesh(new THREE.CircleGeometry(.42,24),new THREE.MeshBasicMaterial({color:0x21090a,transparent:true,opacity:.55}));stain.rotation.x=-Math.PI/2;stain.position.set(n.object.position.x,.012,n.object.position.z);zone.group.add(stain);
        n.object.visible=false;n.fate='dead';cultFateActive=null;cultFateCooldown=listeningPending ? 0.48 : 3.8;
      }
    }else{
      const k=THREE.MathUtils.clamp(a.elapsed/2.9,0,1);n.object.position.lerpVectors(a.start,a.target,k);n.walking=true;
      if(!n.object.userData.fadeMaterialsCloned){n.object.traverse(o=>{if(o.isMesh&&o.material)o.material=Array.isArray(o.material)?o.material.map(m=>m.clone()):o.material.clone();});n.object.userData.fadeMaterialsCloned=true;}
      n.object.traverse(o=>{if(o.isMesh&&o.material){const list=Array.isArray(o.material)?o.material:[o.material];list.forEach(m=>{if('opacity'in m){m.transparent=true;m.opacity=1-k*.98;}});}});
      if(k>=1){n.object.visible=false;n.walking=false;n.fate='gone';cultFateActive=null;cultFateCooldown=listeningPending ? 0.48 : 3.8;}
    }
  }
  cultFateCooldown=Math.max(0,cultFateCooldown-dt);
  if(!cultFateActive&&cultFateQueue.length&&cultFateCooldown<=0){
    const index=0;
    if(index<cultFateQueue.length){const [next]=cultFateQueue.splice(index,1);startCultFate(next);cultFateCooldown=listeningPending ? 0.48 : 3.8;}
  }
}
function scheduleCultSceneFates(count,source,mode='collapse') {
  for(let i=0;i<count;i++) queueCultFate(source,null,(i%2===0)?mode:'vanish');
}
function addDoor(group, x, z, label, destination, spawn, locked = false) {
  const root = new THREE.Group(); root.position.set(x, 0, z); group.add(root);
  addBox(root, -.62, 1.15, 0, .16, 2.3, .16, M.darkWood);
  addBox(root, .62, 1.15, 0, .16, 2.3, .16, M.darkWood);
  addBox(root, 0, 2.22, 0, 1.4, .16, .18, M.darkWood);
  const slab = addBox(root, 0, 1.05, .06, 1.12, 2.05, .12, locked ? M.rust : M.wood);
  addBox(root, .39, 1.0, -.02, .045, .045, .035, M.gold);
  const entry = { id: `door_${destination}`, type: 'door', object: root, point: root.position, radius: 3.3, prompt: locked ? '[ E ] THE CELLAR HATCH IS LOCKED' : `[ E ] ENTER — ${label.toUpperCase()}`, label, destination, spawn, locked, slab };
  group.userData.interactables.push(entry); return entry;
}
function addHouseExterior(group, x, z, w, d, h, seed = 1, color = 0x85877f) {
  const g = new THREE.Group(); g.position.set(x, 0, z); group.add(g);
  const wallMat = mat(color, 1, { map: TEX.plaster });
  addBox(g, 0, h / 2, -d / 2, w, h, .42, wallMat);
  addBox(g, -w / 2, h / 2, 0, .42, h, d, wallMat);
  addBox(g, w / 2, h / 2, 0, .42, h, d, wallMat);
  addBox(g, 0, h / 2, d / 2, w, h, .42, wallMat);
  // A crude pitched roof assembled from two dark planes.
  const roofMat = mat(0x292a27, 1, { map: TEX.concrete });
  const r1 = addBox(g, -w * .24, h + .48, 0, w * .58, .22, d + .8, roofMat, { rotation: [0, 0, -.28] });
  const r2 = addBox(g, w * .24, h + .48, 0, w * .58, .22, d + .8, roofMat, { rotation: [0, 0, .28] });
  // Empty black windows with a dirty glass layer.
  for (const side of [-1, 1]) {
    const win = addBox(g, side * (w / 2 + .22), h * .55, -d * .12, .035, .72, .92, M.glass, { castShadow: false });
    addBox(g, side * (w / 2 + .25), h * .55, -d * .12, .08, .82, 1.02, M.darkWood, { castShadow: false });
  }
  // Three broken courses of damp brick peek through the failed limewash.
  for(let row=0;row<2;row++) for(let col=0;col<Math.floor(w/1.15);col++) {
    const bx=-w/2+.6+col*1.12+(row%2)*.48;
    addBox(g,bx,.20+row*.24,d/2+.24,1.02,.20,.055,M.brick,{castShadow:false});
  }
  for(let row=0;row<2;row++) for(let col=0;col<Math.floor(d/1.2);col++) {
    const bz=-d/2+.6+col*1.16;
    addBox(g,-w/2-.24,.20+row*.24,bz,.055,.20,1.02,M.brick,{castShadow:false});
  }
  // Boards across the front windows, some split and hanging loose.
  for (let i = 0; i < 3; i++) addBox(g, -w * .2 + i * .2, h * .56, d / 2 + .24, .9, .075, .08, M.darkWood, { rotation: [0, 0, -.06 + i * .05] });
  addBox(g, w*.08, h*.32, d/2+.26, .04, .72, .045, M.rust, {rotation:[0,0,.16],castShadow:false});
  const chimney = addBox(g, w * .25, h + 1.1, -d * .2, .6, 1.7, .6, M.rust);
  chimney.rotation.y = .16;
  return g;
}
const TREE_MATERIALS = [mat(0x28352b, 1), mat(0x34402f, 1), mat(0x444434, 1)];
function branchBetween(parent, a, b, radius, material) {
  const A=new THREE.Vector3(...a), B=new THREE.Vector3(...b), d=new THREE.Vector3().subVectors(B,A);
  const mesh=new THREE.Mesh(new THREE.CylinderGeometry(radius*.46,radius,d.length(),7),material);
  mesh.position.copy(A).add(B).multiplyScalar(.5); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());
  mesh.castShadow=true; parent.add(mesh); return mesh;
}
function addTree(group, x, z, h = 8, seed = 1) {
  const root = new THREE.Group(); root.position.set(x, 0, z); group.add(root);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.13, .38, h * .67, 9), M.darkWood);
  trunk.position.y = h * .335; trunk.castShadow = true; root.add(trunk);
  const crown=new THREE.Group(); crown.position.y=h*.43; root.add(crown);
  const sway=[];
  for(let i=0;i<5;i++){
    const a=i*2.399+seed*.17, len=h*(.18+(i%3)*.035);
    const base=[Math.cos(a)*.08,0,Math.sin(a)*.08];
    const tip=[Math.cos(a)*len*.65,h*(.18+(i%2)*.06),Math.sin(a)*len*.65];
    const limb=branchBetween(crown,base,tip,.09+(i%3)*.018,M.darkWood); sway.push(limb);
    const leafGroup=new THREE.Group();leafGroup.position.set(...tip);crown.add(leafGroup);
    for(let j=0;j<3;j++){
      const leaf=new THREE.Mesh(new THREE.IcosahedronGeometry(.55+(j%2)*.16,0),TREE_MATERIALS[(i+j)%TREE_MATERIALS.length]);
      leaf.position.set((Math.random()-.5)*1.25,(Math.random()-.5)*.75,(Math.random()-.5)*1.25);
      leaf.scale.set(.9,1.25,.8);leaf.castShadow=false;leafGroup.add(leaf);
    }
    sway.push(leafGroup);
  }
  root.userData.windPhase=seed*.73;root.userData.swayParts=sway;windTrees.push(root);
  return root;
}
function addCropRows(group, cx, cz, rows, length, spacing, kind='maize', seed=1) {
  let state=(seed*2654435761)>>>0; const rand=()=>{state=(state*1664525+1013904223)>>>0;return state/4294967296;};
  for(let r=0;r<rows;r++){
    for(let i=0;i<length;i++){
      const x=cx+(r-(rows-1)/2)*spacing+(rand()-.5)*.18;
      const z=cz+(i-(length-1)/2)*.72+(rand()-.5)*.22;
      const plant=new THREE.Group();plant.position.set(x,0,z);group.add(plant);
      const h=kind==='maize'?1.85+rand()*.8:.62+rand()*.26;
      const stem=new THREE.Mesh(new THREE.CylinderGeometry(.025,.045,h,5),mat(kind==='maize'?0x555c35:0x55583a,1));stem.position.y=h/2;plant.add(stem);
      const leaves=[];
      const n=kind==='maize'?6:4;
      for(let j=0;j<n;j++){
        const leaf=new THREE.Mesh(new THREE.ConeGeometry(kind==='maize'?.10:.045,kind==='maize'?.92:.48,5),mat(kind==='maize'?(j%2?0x616b3b:0x465333):(j%2?0x77744b:0x5e6540),1));
        const side=j%2?1:-1;leaf.position.set(side*(.16+(j%3)*.045),h*(.32+(j%3)*.13),0);leaf.rotation.z=side*(.66+(j%2)*.15);leaf.rotation.x=(rand()-.5)*.35;plant.add(leaf);leaves.push(leaf);
      }
      if(kind==='maize'&&rand()>.30){const cob=new THREE.Mesh(new THREE.CylinderGeometry(.045,.055,.36,7),mat(0x9d874b,1));cob.position.set(.08,h*.55,.03);cob.rotation.z=.48;plant.add(cob);}
      plant.userData.windPhase=rand()*6.28;plant.userData.leaves=leaves;plant.userData.windBase=kind==='maize'?.08:.14;
      cropPlants.push(plant);
    }
  }
}
function addManifesto(group, position, rotation, headline, subline='ARCHIVE 14-B / UNREGISTERED SHEET') {
  const c=document.createElement('canvas');c.width=768;c.height=512;const ctx=c.getContext('2d');
  ctx.fillStyle='#b7aa8e';ctx.fillRect(0,0,768,512);
  for(let i=0;i<9000;i++){ctx.fillStyle=Math.random()>.5?'rgba(20,18,15,.07)':'rgba(255,255,255,.06)';ctx.fillRect(Math.random()*768,Math.random()*512,1+Math.random()*3,1);}
  ctx.fillStyle='#28241e';ctx.font='bold 46px Georgia';ctx.textAlign='center';
  headline.split('\n').forEach((line,i)=>ctx.fillText(line,384,205+i*58,690));
  ctx.font='16px monospace';ctx.fillText(subline,384,443);
  ctx.strokeStyle='#4b3326';ctx.lineWidth=10;ctx.strokeRect(14,14,740,484);
  const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;
  const poster=new THREE.Mesh(new THREE.PlaneGeometry(2.45,1.63),new THREE.MeshStandardMaterial({map:tex,roughness:1,side:THREE.DoubleSide}));
  poster.position.set(...position);poster.rotation.set(...rotation);group.add(poster);
  const nailMat=M.rust;for(const [nx,ny] of [[-1.13,-.72],[1.13,-.72],[-1.13,.72],[1.13,.72]]){const nail=new THREE.Mesh(new THREE.SphereGeometry(.035,8,6),nailMat);nail.position.copy(poster.position);nail.position.add(new THREE.Vector3(nx,ny,0));group.add(nail);}
  return poster;
}
function addBench(group, x, z, rot = 0) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot; group.add(g);
  addBox(g, 0, .48, 0, 1.6, .13, .42, M.wood);
  addBox(g, -.58, .22, 0, .12, .48, .14, M.darkWood); addBox(g, .58, .22, 0, .12, .48, .14, M.darkWood);
  addBox(g, 0, .78, -.15, 1.6, .48, .12, M.wood);
  return g;
}

// -----------------------------------------------------------------------------
// World construction — six spaces, connected by thresholds.
// -----------------------------------------------------------------------------
function newZone(name, fogColor, density, bounds, spawn) {
  const group = new THREE.Group(); group.name = name; group.visible = false; scene.add(group);
  const ambient = new THREE.HemisphereLight(0x9ba4a0, 0x2d3028, .30); group.add(ambient);
  const moon = new THREE.DirectionalLight(0xc5c9c2, .38); moon.position.set(-18, 28, 14); moon.castShadow = false; group.add(moon);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ), M.ground); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; floor.position.set((bounds.minX + bounds.maxX) / 2, -.025, (bounds.minZ + bounds.maxZ) / 2); group.add(floor);
  const z = { name, group, bounds, spawn: new THREE.Vector3(...spawn), interactables: [], solids: [], fogColor, density, fog: null, mist: null, decor: [], ambient, moon };
  group.userData.interactables = z.interactables;
  zones[name] = z; return z;
}
function solid(z, x, zpos, w, d) { z.solids.push({ minX: x - w / 2, maxX: x + w / 2, minZ: zpos - d / 2, maxZ: zpos + d / 2 }); }
// The cult's departures, the Primo and the slaughterhouse carry the threat.
function triggerKillScene() {
  if(scenePlayed || !zones.church) return;
  scenePlayed=true;
  const z=zones.church;
  // Never create replacement extras: Nino and Dario are two of the thirteen.
  const victim=cultRoster.find(n=>n.name==='Pino'&&['present','queued'].includes(n.fate));
  const executioner=cultRoster.find(n=>n.name==='Dario'&&['present','queued'].includes(n.fate));
  if(!victim || !executioner){
    storyFlags.add('empty-choir');
    audio?.mechanicalEvent('bell');
    showToast('THE NAVE IS FULL ONLY OF THE RECORDING.');
    return;
  }
  removeQueuedCultist(victim);removeQueuedCultist(executioner);
  victim.fate='present';executioner.fate='present';
  transferCultist(victim,z,0,-1.9);transferCultist(executioner,z,2.7,-2.1);
  victim.object.scale.set(1.0,.9,1.0);victim.prompt='';executioner.object.scale.set(1.12,1.1,1.12);executioner.prompt='';
  for(const npc of [victim,executioner]){const ix=z.interactables.findIndex(v=>v.id===npc.id);if(ix>=0)z.interactables.splice(ix,1);}
  const stain=new THREE.Mesh(new THREE.CircleGeometry(.85,32),new THREE.MeshBasicMaterial({color:0x270708,transparent:true,opacity:0}));
  stain.rotation.x=-Math.PI/2;stain.position.set(0,.015,-1.8);z.group.add(stain);
  const event={id:'cantore_scene',type:'event',object:victim.object,point:victim.object.position,radius:4.8,prompt:'[ E ] REMAIN IN THE NAVE',done:false,run:()=>{
    if(event.done)return;event.done=true;controls.unlock();dialogueOpen=true;
    $('speaker').textContent='RECORDING / 03:17';
    $('subtitle').textContent='Dario tilts his head. The cantor stops singing. The bell keeps trembling, though no one touches it. From the tower, a name is spoken — not his.';
    speakVoice('Dario inclina la testa. The cantor stops singing. La campana continua a vibrare, anche se nessuno la tocca.','REGISTRAZIONE');
    $('subtitle-wrap').classList.add('visible');$('dialogue-options').innerHTML='<button class="dialogue-option" id="event-continue"><b>[↵]</b>Do not look again.</button>';
    $('event-continue').onclick=()=>{
      $('subtitle-wrap').classList.remove('visible');dialogueOpen=false;
      stain.material.opacity=.82;victim.object.rotation.x=1.42;victim.object.position.y=-.45;victim.fate='dead';victim.object.visible=true;
      executioner.object.position.set(3.8,0,-3.7);executioner.object.rotation.y=Math.PI;executioner.fate='present';
      queueCultFate('la navata',executioner,'vanish');scheduleCultSceneFates(1,'la campana','collapse');
      fear=Math.min(1,fear+.28);glitchPulse=1.2;audio?.killSting();controls.lock();showToast('THE CANTOR HAS BEEN REMOVED FROM THE RECORDING.');
    };
  }};
  z.interactables.push(event);
}
function triggerAnnaScene(z, annaMarker) {
  const anna=cultRoster.find(n=>n.name==='Anna');
  if(!anna || !annaMarker)return;
  const stain=new THREE.Mesh(new THREE.CircleGeometry(.62,28),new THREE.MeshBasicMaterial({color:0x260607,transparent:true,opacity:0}));
  stain.rotation.x=-Math.PI/2;stain.position.set(-5.2,.018,1.2);z.group.add(stain);
  const ev={id:'anna_scene',type:'event',object:annaMarker,point:annaMarker.position,radius:3.4,prompt:'[ E ] LOOK AT THE CHAIR',done:false,run:()=>{
    if(ev.done)return;ev.done=true;controls.unlock();dialogueOpen=true;
    const annaStillPresent=['present','queued'].includes(anna.fate);
    $('speaker').textContent='ANNA / CUCINA';
    $('subtitle').textContent=annaStillPresent?'Anna sets the plate before an empty place. “He only eats when no one is watching.” The kitchen light goes out.':'The plate is still warm. The chair was empty before you entered. Someone keeps chewing inside the wall.';
    speakVoice($('subtitle').textContent,'Anna');$('subtitle-wrap').classList.add('visible');
    $('dialogue-options').innerHTML='<button class="dialogue-option" id="anna-continue"><b>[↵]</b>Stay still.</button>';
    $('anna-continue').onclick=()=>{
      $('subtitle-wrap').classList.remove('visible');dialogueOpen=false;
      if(annaStillPresent){
        removeQueuedCultist(anna);if(anna.object.parent!==z.group)transferCultist(anna,z,-5.2,1.2);
        anna.object.position.set(-5.2,-.35,1.2);anna.object.rotation.x=1.35;anna.object.visible=true;anna.fate='dead';
        stain.material.opacity=.72;z.group.children.filter(c=>c.isPointLight).forEach(l=>l.intensity*=.22);
        fear=Math.min(1,fear+.22);glitchPulse=1;audio?.killSting();scheduleCultSceneFates(1,'il posto a tavola','vanish');
        showToast('THE PLACE AT THE TABLE HAS BEEN TAKEN.');
      }else{
        storyFlags.add('anna-empty-place');stain.material.opacity=.42;audio?.mechanicalEvent('drawer');glitchPulse=1.1;
        showToast('THE CHAIR WAS EMPTY BEFORE YOU CHOSE.');
      }
      controls.lock();
    };
  }};
  z.interactables.push(ev);
}

const rotatingMachines=[];
function addRoadSurfaceDetails(group) {
  // Leaf litter and flattened weeds are instanced to keep the open landscape light.
  const leafShape=new THREE.Shape();leafShape.moveTo(0,.14);leafShape.quadraticCurveTo(.14,.06,.07,-.13);leafShape.quadraticCurveTo(0,-.19,-.07,-.13);leafShape.quadraticCurveTo(-.14,.06,0,.14);
  const leafGeo=new THREE.ShapeGeometry(leafShape);const leafMat=new THREE.MeshStandardMaterial({color:0x655139,roughness:1,side:THREE.DoubleSide});
  const leaves=new THREE.InstancedMesh(leafGeo,leafMat,420);const dummy=new THREE.Object3D();
  for(let i=0;i<420;i++){let x=(Math.random()-.5)*120,z=(Math.random()-.5)*115;if(Math.abs(x)<7&&z>-28&&z<40)x+=(x<0?-8:8);dummy.position.set(x,.022+Math.random()*.006,z);dummy.rotation.set(-Math.PI/2,0,Math.random()*Math.PI*2);const sc=.35+Math.random()*1.5;dummy.scale.set(sc,sc,.6);dummy.updateMatrix();leaves.setMatrixAt(i,dummy.matrix);leaves.setColorAt(i,new THREE.Color().setHSL(.08+Math.random()*.08,.22,.18+Math.random()*.15));}group.add(leaves);
  const grassGeo=new THREE.PlaneGeometry(.085,.68,1,2);const grassMat=new THREE.MeshStandardMaterial({color:0x66714a,roughness:1,side:THREE.DoubleSide});const grass=new THREE.InstancedMesh(grassGeo,grassMat,780);
  for(let i=0;i<780;i++){let x=(Math.random()-.5)*125,z=(Math.random()-.5)*120;if(Math.abs(x)<7&&z>-28&&z<40)x+=(x<0?-10:10);dummy.position.set(x,.30,z);dummy.rotation.set((Math.random()-.5)*.18,Math.random()*Math.PI,(Math.random()-.5)*.5);dummy.scale.set(.45+Math.random(),.45+Math.random()*1.5,1);dummy.updateMatrix();grass.setMatrixAt(i,dummy.matrix);grass.setColorAt(i,new THREE.Color().setHSL(.20+Math.random()*.08,.17,.18+Math.random()*.15));}group.add(grass);
  // Broken concrete flags and patched road shoulders.
  const paverMat=mat(0x65645d,1,{map:TEX.concrete});const pavers=new THREE.InstancedMesh(new THREE.BoxGeometry(1.15,.09,.72),paverMat,85);
  for(let i=0;i<85;i++){const side=i%2?-1:1,zz=-52+Math.random()*100;dummy.position.set(side*(7.5+Math.random()*1.6),.015,zz);dummy.rotation.set(0,(Math.random()-.5)*.16,0);dummy.scale.set(.65+Math.random()*.7,1,.7+Math.random()*.6);dummy.updateMatrix();pavers.setMatrixAt(i,dummy.matrix);}group.add(pavers);
  // Puddles catch the wrong reflection, not the sky.
  const puddleMat=new THREE.MeshStandardMaterial({color:0x263332,roughness:.18,metalness:.28,transparent:true,opacity:.46,side:THREE.DoubleSide});
  for(let i=0;i<24;i++){const w=.4+Math.random()*2.4,h=.25+Math.random()*1.3;const puddle=new THREE.Mesh(new THREE.CircleGeometry(1,24),puddleMat);puddle.rotation.x=-Math.PI/2;puddle.scale.set(w,h,1);puddle.position.set((Math.random()-.5)*16,.022,(Math.random()-.5)*110);group.add(puddle);}
}

function addWoodPavement(group,x,zStart,length=18,width=3.1){
  const boards=[
    mat(0x594332,1,{map:TEX.wood,bumpScale:.12}),
    mat(0x44382c,1,{map:TEX.wood,bumpScale:.15}),
    mat(0x6a5239,1,{map:TEX.wood,bumpScale:.10})
  ];
  const count=Math.floor(length/.48);
  addBox(group,x,.0,zStart+length/2,width+.22,.14,length+.18,M.darkWood,{castShadow:false});
  for(let i=0;i<count;i++){
    const z=zStart+i*.48;
    const board=addBox(group,x,.095,z,width,.12,.445,boards[i%boards.length],{rotation:[0,(i%5-2)*.004,(i%7-3)*.003]});
    board.castShadow=true;board.receiveShadow=true;
    for(const side of [-1,1]){
      const nail=new THREE.Mesh(new THREE.SphereGeometry(.022,7,6),M.metal);
      nail.position.set(x+side*(width*.42),.163,z+(i%2?-.13:.13));group.add(nail);
    }
    if(i%6===2){const split=new THREE.Mesh(new THREE.BoxGeometry(width*.18,.012,.018),M.darkWood);split.position.set(x+(i%2?-.28:.24),.16,z+.05);split.rotation.y=.15;group.add(split);}
  }
  // The boards are slick and dark at the centre, as if the water has been rising through them.
  const wet=new THREE.Mesh(new THREE.PlaneGeometry(width*.72,length*.7),new THREE.MeshStandardMaterial({color:0x202c2b,roughness:.18,metalness:.25,transparent:true,opacity:.22}));
  wet.rotation.x=-Math.PI/2;wet.position.set(x,.17,zStart+length*.56);group.add(wet);
}

function addMachineComplex(group) {
  const g=new THREE.Group();g.position.set(23.3,0,4.3);group.add(g);
  addBox(g,0,.3,0,5.1,.55,3.2,M.darkWall);
  // Belt-driven motor with two visible flywheels and a trembling connecting shaft.
  for(const x of [-1.35,1.15]){
    const wheel=new THREE.Group();wheel.position.set(x,1.45,.25);g.add(wheel);
    const ring=new THREE.Mesh(new THREE.TorusGeometry(.88,.095,9,40),M.rust);wheel.add(ring);
    const hub=new THREE.Mesh(new THREE.CylinderGeometry(.19,.19,.25,18),M.metal);hub.rotation.x=Math.PI/2;wheel.add(hub);
    for(let j=0;j<8;j++){const spoke=addBox(wheel,0,0,0,.07,.78,.07,M.metal,{castShadow:true});spoke.rotation.z=j*Math.PI/4;}
    rotatingMachines.push({mesh:wheel,speed:x<0?1.1:-.78});
  }
  const crank=new THREE.Mesh(new THREE.CylinderGeometry(.11,.11,2.7,12),M.metal);crank.rotation.z=Math.PI/2;crank.position.set(-.1,1.45,.25);g.add(crank);
  const piston=new THREE.Group();piston.position.set(0,.75,-.95);g.add(piston);
  const tube=new THREE.Mesh(new THREE.CylinderGeometry(.19,.24,1.55,12),M.rust);tube.position.y=.72;piston.add(tube);
  const rod=new THREE.Mesh(new THREE.CylinderGeometry(.055,.055,1.1,10),M.gold);rod.position.y=1.9;piston.add(rod);rotatingMachines.push({mesh:piston,piston:true,speed:1.25});
  for(let i=0;i<5;i++){const pipe=new THREE.Mesh(new THREE.CylinderGeometry(.045,.045,1.3+Math.random()*1.5,8),M.rust);pipe.position.set(-2+i*.34,1.1,-1.2);pipe.rotation.z=(Math.random()-.5)*.3;g.add(pipe);}
  const tank=new THREE.Mesh(new THREE.CylinderGeometry(.72,.72,2.0,18),M.metal);tank.position.set(2.0,1.25,-.65);g.add(tank);
  const tankTop=new THREE.Mesh(new THREE.CylinderGeometry(.74,.74,.12,18),M.rust);tankTop.position.set(2,2.32,-.65);g.add(tankTop);
  for(let i=0;i<12;i++){const bolt=new THREE.Mesh(new THREE.SphereGeometry(.035,7,6),M.gold);const a=i/12*Math.PI*2;bolt.position.set(2+Math.cos(a)*.7,2.33,-.65+Math.sin(a)*.7);g.add(bolt);}
  addLight(g,0x983d25,.7,5,0,2.1,.5);
  const sign=new THREE.Mesh(new THREE.PlaneGeometry(1.7,.48),new THREE.MeshBasicMaterial({map:makeLabelTexture('MOTORE / 14-B',512,128),side:THREE.DoubleSide}));sign.position.set(0,2.7,1.55);g.add(sign);
}

function buildRoad() {
  const z = newZone('road', 0xb6b9b5, .017, { minX: -68, maxX: 68, minZ: -65, maxZ: 65 }, [0, 0, 29]);
  // Road, drainage ditches, canal and the flat Po Valley horizon.
  addPlane(z.group, 0, .005, 0, 12, 130, M.asphalt);
  for (let x of [-6.6, 6.6]) addBox(z.group, x, .08, 0, .17, .15, 130, M.darkWood, { castShadow: false });
  const canalMat = new THREE.MeshStandardMaterial({ color: 0x414c4b, roughness: .18, metalness: .38, transparent: true, opacity: .86 });
  addPlane(z.group, -31, -.01, -27, 13, 95, canalMat);
  for (let i = 0; i < 13; i++) { const reed = addBox(z.group, -38 + Math.random() * 14, .62 + Math.random() * .35, -67 + Math.random() * 78, .035, 1.3, .035, M.wood); reed.rotation.z = (Math.random() - .5) * .2; }
  // Bridge over the canal.
  addBox(z.group, -31, .38, -7, 17, .48, 5.8, M.darkWood);
  for (let side of [-1, 1]) addBox(z.group, -31 + side * 7.7, .8, -7, .17, .7, 5.7, M.rust);
  // Power poles and long cables disappear into white.
  for (let i = 0; i < 7; i++) {
    const x = 11 + (i % 2) * 5; const zz = 42 - i * 17;
    addBox(z.group, x, 5.2, zz, .18, 10.4, .18, M.darkWood);
    addBox(z.group, x, 9.7, zz, 3.8, .12, .12, M.rust);
  }
  const wire = new THREE.Mesh(new THREE.CylinderGeometry(.018, .018, 17, 5), M.black); wire.position.set(13, 9.0, 33); wire.rotation.x = Math.PI / 2.5; z.group.add(wire);
  // Trees, weeds, fence fragments.
  for (let i = 0; i < 54; i++) {
    const x = (Math.random() - .5) * 125; const zz = (Math.random() - .5) * 115;
    if (Math.abs(x) < 11 && zz > -20 && zz < 38) continue;
    if (Math.abs(x + 31) < 10) continue;
    addTree(z.group, x, zz, 5 + Math.random() * 6, i + 1);
  }
  // Po Valley cultivation: maize rows, winter wheat and a flooded rice plot with narrow banks.
  addCropRows(z.group,48,-7,4,25,.98,'maize',31);
  addCropRows(z.group,-51,24,4,22,.94,'maize',42);
  addCropRows(z.group,-48,-42,3,18,.78,'wheat',57);
  const paddy=new THREE.Mesh(new THREE.PlaneGeometry(20,.01),new THREE.MeshStandardMaterial({color:0x4d5d57,roughness:.16,metalness:.23,transparent:true,opacity:.78}));paddy.rotation.x=-Math.PI/2;paddy.position.set(45,.025,-42);z.group.add(paddy);
  for(let x=35;x<=55;x+=2){addBox(z.group,x,.08,-52,.12,.16,20,M.wood,{castShadow:false});}
  for(let i=0;i<110;i++){
    const leaf=new THREE.Mesh(new THREE.PlaneGeometry(.16+Math.random()*.2,.055+Math.random()*.08),new THREE.MeshStandardMaterial({color:[0x54503a,0x5f563e,0x343a2c][i%3],side:THREE.DoubleSide,roughness:1}));
    leaf.position.set((Math.random()-.5)*110,.04+Math.random()*.05,(Math.random()-.5)*110);leaf.rotation.set(-Math.PI/2,Math.random()*Math.PI,Math.random()*Math.PI);z.group.add(leaf);leafSpecks.push(leaf);
  }
  for (let i = 0; i < 26; i++) {
    const x = -16 + i * 1.3; addBox(z.group, x, .52, -41, .11, 1.0, .11, M.darkWood);
    if (i % 4 === 0) addBox(z.group, x, .76, -41, .11, .1, 1.0, M.darkWood, { rotation: [0, Math.PI / 2, 0] });
  }
  // Main farmhouse, chapel and abandoned dwelling.
  addHouseExterior(z.group, 0, -15, 15, 13, 5.4, 2, 0x87867b);
  addHouseExterior(z.group, 37, -25, 12, 15, 7.2, 3, 0x656860);
  addHouseExterior(z.group, -36, -14, 12, 10, 4.8, 4, 0x77766c);
  addHouseExterior(z.group, 27, 22, 10, 9, 4.2, 5, 0x555a55);
  addRoadSurfaceDetails(z.group); addWoodPavement(z.group,27,10.2,18.2,3.3); addMachineComplex(z.group);
  // The farmhouse's false golden window.
  addLight(z.group, 0xffb35d, 2.1, 18, 0, 2.0, -7, { decay: 1.5 });
  const windowGlow = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.1), new THREE.MeshBasicMaterial({ color: 0xc08a4a, transparent: true, opacity: .48 })); windowGlow.position.set(3.8, 3.0, -8.35); z.group.add(windowGlow);
  // Small derelict industrial shed to the east.
  addBox(z.group, 24, 2.2, 5, 16, 4.4, 12, M.darkWall);
  addBox(z.group, 24, 4.6, 5, 17, .3, 13, M.rust);
  for (let i = 0; i < 4; i++) addBox(z.group, 17 + i * 4.5, 2.1, -1.12, .55, 4.3, .2, M.black);
  // Distant industrial chimneys.
  for (let i = 0; i < 3; i++) { const chimney = new THREE.Mesh(new THREE.CylinderGeometry(.65, .8, 22 + i * 5, 8), M.rust); chimney.position.set(48 + i * 4, 12 + i * 2.5, 41); z.group.add(chimney); }
  // Doors into interiors.
  addDoor(z.group, 0, -7.0, 'the farmhouse', 'home', [0, 0, 6.2]);
  addDoor(z.group, 37, -17.1, 'the church', 'church', [0, 0, 9.4]);
  addDoor(z.group, -36, -8.6, 'the abandoned house', 'ruin', [0, 0, 5.8]);
  addDoor(z.group, 27, 28.3, 'the house of beasts', 'abattoir', [0,0,7.0]);
  addManifesto(z.group,[-9.5,2.0,-5.8],[0,.12,0],'SVUOTARSI\nPER ESSERE RIEMPITI','AFFISSO DEL CONSORZIO / 1977');
  addManifesto(z.group,[15.5,1.85,14.1],[0,Math.PI,0],'13 + 1 = 0','FOGLIO APPESO DAL LATO SBAGLIATO');
  // Clue at the roadside mailbox.
  addBox(z.group, -4.5, .63, 20, .55, 1.25, .48, M.rust);
  addBox(z.group, -4.5, 1.32, 20, .7, .09, .58, M.darkWood);
  addClueMesh(z.group, new THREE.Vector3(-4.0, .83, 19.7), '1977 Newspaper Clipping', 'A local newspaper reports that a choir was found dead in a country church in the winter of 1977. The recorder kept running. The article does not name the album.', 'clipping', 'paper');
  // A wet-coated figure at the bridge, more like a stain than a person.
  const woman = makeNPC(z.group, -31, -3, 'La donna al canale', 0x242a28, 1);
  woman.prompt = '[ E ] SPEAK — THE WOMAN BY THE CANAL';
  woman.dialogue = {
    line: 'The water does not run towards the sea. It runs towards the day it was poured.',
    choices: ['What happened here?', 'I do not know you.'],
    replies: ['They closed the church, but left the recording running.', 'That is better. Names let the air in.']
  };
  // Rusted sign and road debris.
  addBox(z.group, 8.8, 1.3, 25, .1, 2.6, .1, M.rust); addBox(z.group, 9.5, 2.1, 25, 2.2, .65, .12, M.darkWood);
  const signText = new THREE.Mesh(new THREE.PlaneGeometry(1.8, .42), new THREE.MeshBasicMaterial({ map: makeLabelTexture('PO / KM 14', 512, 128), transparent: true })); signText.position.set(9.5, 2.1, 24.91); z.group.add(signText);
  z.mist = addFog(z.group, 95, 125, 0xe1e3df, 49);
  z.fog = new THREE.FogExp2(z.fogColor, z.density);
  solid(z, 0, -15, 15.5, 13.5); solid(z, 37, -25, 12.5, 15.5); solid(z, -36, -14, 12.5, 10.5); solid(z, 24, 5, 16.5, 12.5);
  return z;
}
function buildHome() {
  const z = newZone('home', 0x393b36, .052, { minX: -10, maxX: 10, minZ: -9, maxZ: 9 }, [0, 0, 6.4]);
  const floorMat = mat(0x554e42, .98, { map: TEX.wood });
  addBox(z.group, 0, -.13, 0, 20, .26, 18, floorMat);
  // Walls with a deliberately low ceiling line.
  addBox(z.group, 0, 1.8, -9, 20, 3.6, .35, M.wall); addBox(z.group, -10, 1.8, 0, .35, 3.6, 18, M.wall); addBox(z.group, 10, 1.8, 0, .35, 3.6, 18, M.wall);
  addBox(z.group, -6.0, 1.8, 9, 8, 3.6, .35, M.wall); addBox(z.group, 6.0, 1.8, 9, 8, 3.6, .35, M.wall);
  // An incomplete partition and a narrow dark corridor.
  for(let i=0;i<14;i++){const drip=new THREE.Mesh(new THREE.BoxGeometry(.018,.18+Math.random()*.5,.018),M.rust);drip.position.set(-8.9+Math.random()*17.8,2.7-Math.random()*.8,-8.77);z.group.add(drip);}
  addBox(z.group, -3.2, 1.45, -1.4, .22, 2.9, 6.8, M.darkWall); addBox(z.group, 4.8, 1.45, -2.1, .22, 2.9, 6.0, M.wall);
  // Kitchen table, mismatched chairs and the permanently humming refrigerator.
  addBox(z.group, -5.2, .95, 2.0, 3.2, .16, 1.55, M.wood);
  for (const x of [-6.3, -4.1]) for (const zz of [1.0, 3.0]) { addBox(z.group, x, .48, zz, .16, .95, .16, M.darkWood); addBox(z.group, x, .97, zz - .25, .68, .13, .68, M.wood); }
  addBox(z.group, -8.5, 1.15, -3.8, 1.2, 2.3, 1.25, M.darkWall);
  addBox(z.group, -8.5, 2.34, -3.8, 1.32, .12, 1.35, M.black);
  addLight(z.group, 0xe9c78b, .85, 6, -8.1, 2.2, -3.8);
  // Harpsichord, open lid, keys and stool.
  addBox(z.group, 5.9, .85, -5.7, 3.9, .85, 1.2, M.darkWood);
  addBox(z.group, 5.9, 1.32, -5.65, 3.85, .08, 1.15, M.wood);
  const lid = addBox(z.group, 5.9, 1.76, -5.65, 3.75, .12, 1.05, M.darkWood, { rotation: [-.44, 0, 0] });
  for (let i = 0; i < 22; i++) addBox(z.group, 4.15 + i * .16, 1.34, -5.0, .145, .05, .34, i % 3 === 0 ? M.darkWood : M.glass, { castShadow: false });
  addBox(z.group, 5.9, .48, -3.9, 1.2, .18, .75, M.wood);
  addBox(z.group, 5.4, .23, -3.7, .1, .46, .1, M.darkWood); addBox(z.group, 6.4, .23, -3.7, .1, .46, .1, M.darkWood);
  // Lamp behind a painted window; its gold is deliberately false.
  addBox(z.group, 7.9, 2.2, -8.78, 2.0, 1.6, .1, M.warmLight, { castShadow: false });
  addBox(z.group, 7.9, 2.2, -8.66, 2.2, 1.8, .08, M.darkWood, { castShadow: false });
  addLight(z.group, 0xffac53, 3.2, 12, 7.9, 2.1, -7.4);
  // A television with no sound, a quiz show frozen on a question.
  addBox(z.group, -1.2, 1.4, -8.2, 2.1, 1.55, .32, M.black);
  const tv = new THREE.Mesh(new THREE.PlaneGeometry(1.75, 1.2), new THREE.MeshBasicMaterial({ map: makeLabelTexture('QUESTION NO. 14', 512, 256), color: 0xb3b1a7 })); tv.position.set(-1.2, 1.42, -8.02); z.group.add(tv);
  addManifesto(z.group,[-9.78,2.1,-2.6],[0,Math.PI/2,0],'DO NOT LISTEN\nTO UNDERSTAND','CIRCULAR 14-B');
  addManifesto(z.group,[.0,3.28,-8.78],[0,0,0],'THE VOID\nIS A DOOR','WRITTEN IN SOOT');
  // Pictures face the wall, not the room.
  const frame = addBox(z.group, 2.1, 2.25, -8.72, 1.0, .75, .08, M.gold); addBox(z.group, 2.1, 2.25, -8.66, .82, .58, .025, M.darkWall);
  // Characters.
  const ines = registerCultist(makeNPC(z.group, -6.5, -.2, 'Ines', 0x52483d, 0),{ line: 'The kitchen stays warm even when no one is hungry. Sit down. You do not have to give your name.', choices: ['Stay with us.','Help me leave.'], replies: ['It is not an invitation. The emptiness recognises you.', 'I have tried. The road always begins again at the table.'] });
  const ottavio = registerCultist(makeNPC(z.group, 3.2, -3.6, 'Ottavio', 0x373735, 1),{ line: 'I cannot hear the room. I can tell when someone decides to lie.', choices: ['What should I listen for?','Have you ever heard Il Bianco?'], replies: ['The refrigerator. It has held a flat B ever since the old man died.','No. But I have spent twenty years waiting for someone who could tell me what it was like.'] });
  const anna=addCultist(z,-5.2,1.2,'Anna',0x4a4035,0,'The plate stays warm for a man who no longer has a mouth. Do not clear it.', ['Do you want me to stay?','Why do you keep setting the table?'], ['Yes. But not in my place.','The table is the only thing that does not empty itself.']);
  anna.object.position.set(-5.2,0,1.2); anna.point=anna.object.position;
  const dario=addCultist(z,-8.0,-6.1,'Dario',0x302d28,1,'The record is not an object. It is the name that remains after every other name has been taken away.', ['Who leads the rite?','What happens to the one who listens?'], ['There is no leader. Only someone who has already made room.','Nothing happens. That is what frightens them.']);dario.isLeader=true;
  const sergio=addCultist(z,-.8,-6.5,'Sergio',0x4a443a,0,'I no longer believe in the record. But at home, only my own noise is waiting.', ['Could we leave together?','Then why do you stay?'], ['There is no outside that has stayed the same.','Company is a habit stronger than faith.']);
  addCultist(z,7.9,-6.2,'Marta',0x51483d,0,'I have forgotten my daughter's face. I remember the sound of her footsteps.');
  addCultist(z,8.05,.4,'Nino',0x3d423d,1,'The water pump has been running for three days. No one connected it to the power.');
  addCultist(z,8.05,6.1,'Livia',0x544b43,0,'The room is empty only from the side of the person looking in.');
  addCultist(z,.2,7.0,'Gabri',0x343a37,1,'I gave my name to the door. The door returned a number.');
  addCultist(z,-7.8,6.3,'Noemi',0x5a4c43,0,'They told me silence was a form of care.');
  addCultist(z,5.3,-1.3,'Franco',0x383b39,1,'The ice machine works even when it is unplugged.');
  addCultist(z,-1.4,5.3,'Elia',0x66574a,0,'There is no voice on the tape. Only the shape a voice left behind.');
  addCultist(z,2.7,6.6,'Don Remo',0x34322e,1,'The thirteenth chair has always faced the wall.');
  // A staged domestic killing: the room offers the player a choice to look.
  const annaMarker=new THREE.Mesh(new THREE.BoxGeometry(.22,.08,.22),M.clue);annaMarker.position.set(-5.2,.12,1.2);z.group.add(annaMarker);
  z.interactables.push({id:'anna_scene_trigger',type:'event',object:annaMarker,point:annaMarker.position,radius:3.2,prompt:'[ E ] LOOK AT THE EMPTY PLACE',run:()=>triggerAnnaScene(z,annaMarker)});
  // Evidence in plain sight, once you stop looking for the album.
  addClueMesh(z.group, new THREE.Vector3(-5.2, 1.1, 2.0), 'The seating list', 'A list of thirteen names. Beneath them, a fourteenth line has been scratched out so hard it has scored the paper.', 'list', 'paper');
  addClueMesh(z.group, new THREE.Vector3(5.8, 1.45, -5.0), 'Beats', 'A tuning fork. A=415 is engraved on the handle. The note does not match the one you have in your head.', 'fork', 'metal');
  addClueMesh(z.group, new THREE.Vector3(1.2, .06, 6.1), 'Engraved beam', 'Memories are cut into the wood. They do not seem to belong to the same person: a dog, a feast, a room without doors.', 'beam', 'wood');
  const exit = addDoor(z.group, 0, 8.95, 'the road', 'road', [0, 0, -3.4]); exit.prompt = '[ E ] RETURN TO THE ROAD';
  const hatch = addDoor(z.group, 8.7, -6.2, 'the cellar', 'cellar', [0, 0, 4.5], true); hatch.prompt = '[ E ] DESCEND — THE CELLAR';
  // Hide the hatch behind a stack of coal sacks until evidence is gathered.
  addBox(z.group, 8.6, .46, -5.0, 1.4, .9, 1.1, M.darkWall);
  addBox(z.group, 7.5, .33, -5.7, .8, .65, .7, M.rust);
  z.mist = addFog(z.group, 32, 23, 0xaeb0a9, 27);
  // Collision strips keep the player inside, leaving a gap for the front door.
  z.solids.push({ minX: -10, maxX: -9.7, minZ: -9, maxZ: 9 }, { minX: 9.7, maxX: 10, minZ: -9, maxZ: 9 }, { minX: -9, maxX: -4, minZ: 8.7, maxZ: 9 }, { minX: 4, maxX: 9, minZ: 8.7, maxZ: 9 }, { minX: -9, maxX: 9, minZ: -9, maxZ: -8.7 });
  z.solids.push({ minX: -3.5, maxX: -3.0, minZ: -5, maxZ: 2 });
  z.solids.push({ minX: 4.65, maxX: 4.95, minZ: -6, maxZ: -1 });
  return z;
}
function buildChurch() {
  const z = newZone('church', 0x222522, .042, { minX: -9, maxX: 9, minZ: -17, maxZ: 12 }, [0, 0, 9.2]);
  addBox(z.group, 0, -.14, -2, 18, .28, 30, M.darkWood);
  // Nave walls, broken upper windows and apse.
  const exposedNaveBrick=new THREE.Mesh(new THREE.PlaneGeometry(17.2,2.0),M.brick);exposedNaveBrick.position.set(0,1.0,-16.78);z.group.add(exposedNaveBrick);
  addBox(z.group, -9, 3.2, -2, .35, 6.4, 30, M.wall); addBox(z.group, 9, 3.2, -2, .35, 6.4, 30, M.wall);
  addBox(z.group, 0, 3.0, -17, 18, 6, .35, M.darkWall); addBox(z.group, -5.0, 2.2, 12, 8, 4.4, .35, M.wall); addBox(z.group, 5.0, 2.2, 12, 8, 4.4, .35, M.wall);
  addBox(z.group, 0, 6.3, -2, 18, .25, 30, M.darkWall);
  // A row of broken high windows admits cold vertical light.
  for (let side of [-1, 1]) for (let i = 0; i < 4; i++) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 2.2), new THREE.MeshBasicMaterial({ color: 0x99a5a4, transparent: true, opacity: .13, side: THREE.DoubleSide }));
    win.position.set(side * 8.78, 4.55, -12 + i * 6); win.rotation.y = side * Math.PI / 2; z.group.add(win);
  }
  // Pews, altar, rood beam and an organ that has not been maintained.
  for (let row = 0; row < 5; row++) for (let side of [-1, 1]) {
    const x = side * 3.5, zz = 5 - row * 3.7;
    addBench(z.group, x, zz, 0);
  }
  addBox(z.group, 0, 1.12, -12.0, 4.7, 1.25, 1.6, M.darkWood);
  addBox(z.group, 0, 1.82, -12.0, 5.0, .14, 1.8, M.gold);
  addBox(z.group, 0, 4.5, -15.4, .32, 7.4, .32, M.darkWood);
  addBox(z.group, 0, 7.6, -15.4, 5.2, .28, .32, M.darkWood);
  addBox(z.group, -5.9, 1.5, -13, 3.0, 2.7, 1.4, M.darkWood);
  for (let i = 0; i < 9; i++) addBox(z.group, -7.1 + i * .3, 1.65, -12.25, .055, 2.15, .06, M.gold);
  // Candles and red sanctuary light.
  for (let i = 0; i < 6; i++) { addBox(z.group, -2.1 + i * .85, 2.12, -11.3, .055, .58, .055, M.wood); addLight(z.group, 0xffa35b, .24, 3.2, -2.1 + i * .85, 2.55, -11.3); }
  addLight(z.group, 0x9d3026, 1.7, 12, 0, 4.1, -14.2);
  const remo = cultRoster.find(n=>n.name==='Don Remo') || makeNPC(z.group, 1.5, -8.2, 'Don Remo', 0xddd7c9, 1);
  if(remo.object.parent!==z.group)transferCultist(remo,z,1.5,-8.2);
  remo.dialogue = { line: 'The door is not locked. The room is on the other side.', choices: ['What is on the record?', 'Why is the cross turned upside down?'], replies: ['A sound that does not need to be heard. A place that does not need to be inhabited.', 'Because the earth looks at the sky from underneath. It is not a punishment. It is a point of view.'] };
  const bellMarker=new THREE.Mesh(new THREE.BoxGeometry(.18,.18,.18),M.clue);bellMarker.position.set(-6.8,.12,-5.8);z.group.add(bellMarker);z.interactables.push({id:'bell_event',type:'event',object:bellMarker,point:bellMarker.position,radius:2.8,prompt:'[ E ] PULL THE BELL ROPE',run:()=>{audio?.bell();triggerKillScene();}});
  addClueMesh(z.group, new THREE.Vector3(-5.8, 1.7, -13.6), 'Order of the Mass', 'The sheet lists a sequence of stations. The numbering jumps from the eleventh to the fourteenth. On the back: “no funerals.”', 'mass', 'paper');
  addDoor(z.group, 0, 11.9, 'the churchyard', 'road', [0, 0, -29]);
  z.mist = addFog(z.group, 38, 36, 0xb7bcb8, 67);
  z.solids.push({ minX: -9, maxX: -8.7, minZ: -17, maxZ: 12 }, { minX: 8.7, maxX: 9, minZ: -17, maxZ: 12 }, { minX: -9, maxX: 9, minZ: -17.3, maxZ: -17 }, { minX: -9, maxX: -5, minZ: 11.7, maxZ: 12 }, { minX: 5, maxX: 9, minZ: 11.7, maxZ: 12 });
  return z;
}
function buildRuin() {
  const z = newZone('ruin', 0x343633, .044, { minX: -8, maxX: 8, minZ: -8, maxZ: 8 }, [0, 0, 5.5]);
  addBox(z.group, 0, -.12, 0, 16, .24, 16, M.darkWood);
  addBox(z.group, -8, 1.9, 0, .32, 3.8, 16, M.wall); addBox(z.group, 8, 1.9, 0, .32, 3.8, 16, M.wall); addBox(z.group, 0, 1.9, -8, 16, 3.8, .32, M.wall);
  addBox(z.group, -5.2, 1.9, 8, 5.6, 3.8, .32, M.wall); addBox(z.group, 5.2, 1.9, 8, 5.6, 3.8, .32, M.wall);
  // Damp brick fragments show through the damaged limewash.
  const ruinBrick=new THREE.Mesh(new THREE.PlaneGeometry(7.2,1.2),M.brick);ruinBrick.position.set(-3.8,.72,-7.78);z.group.add(ruinBrick);
  // A ceiling hole lets a strip of white fog enter.
  addBox(z.group, -3.5, 3.65, -2.5, 7, .2, 11, M.darkWall);
  addBox(z.group, -2.1, .75, -4.4, 3.8, .22, 1.8, M.wood); addBox(z.group, -2.1, 1.1, -3.8, 3.8, .65, .12, M.rust);
  addBox(z.group, 4.8, 1.35, -4.8, 1.0, 2.6, 1.2, M.black);
  const staticScreen = new THREE.Mesh(new THREE.PlaneGeometry(.78, .58), new THREE.MeshBasicMaterial({ map: makeLabelTexture('NO SIGNAL', 512, 256), color: 0x8a8b83 })); staticScreen.position.set(4.8, 1.6, -4.16); z.group.add(staticScreen);
  addLight(z.group, 0x9caaa4, .45, 8, -4.5, 2.8, -6.0);
  const woman = makeNPC(z.group, 1.4, -.5, 'The widow', 0x2d302e, 0);
  woman.dialogue = { line: 'My husband is not dead. He has only stopped answering the telephone. Eleven winters have passed.', choices: ['Why do you keep the light on?', 'Did you know about the recording?'], replies: ['Because night comes in through the sockets. The light keeps it busy.', 'The tuner arrived with an empty case. He left with a song I cannot remember.'] };
  addClueMesh(z.group, new THREE.Vector3(-2.2, .95, -4.4), 'Burnt Photograph', 'Una fotografia of the church nel 1977. In un angolo, quasi fuori dall’inquadratura, si vede una piccola stufa a gas dietro il coro.', 'photo', 'paper');
  addClueMesh(z.group, new THREE.Vector3(5.0, .12, 1.0), 'Answering Machine', 'An unlabelled microcassette. The tape contains only the click of REC and someone inhaling before speaking.', 'voicemail', 'metal');
  addDoor(z.group, 0, 7.95, 'the road', 'road', [-28, 0, -2]);
  z.mist = addFog(z.group, 25, 20, 0xb2b7b3, 18);
  z.solids.push({ minX: -8, maxX: -7.7, minZ: -8, maxZ: 8 }, { minX: 7.7, maxX: 8, minZ: -8, maxZ: 8 }, { minX: -8, maxX: 8, minZ: -8.2, maxZ: -8 }, { minX: -8, maxX: -2.5, minZ: 7.7, maxZ: 8 }, { minX: 2.5, maxX: 8, minZ: 7.7, maxZ: 8 });
  return z;
}
function addHangingCarcass(group,x,z,phase=0) {
  const rig=new THREE.Group();rig.position.set(x,0,z);group.add(rig);
  const chainMat=mat(0x272a27,.56,{metalness:.62,map:TEX.rust});
  const chain=new THREE.Mesh(new THREE.CylinderGeometry(.018,.024,1.35,7),chainMat);chain.position.y=3.03;rig.add(chain);
  const hook=new THREE.Mesh(new THREE.TorusGeometry(.16,.035,7,14,Math.PI*1.35),M.rust);hook.position.y=2.30;hook.rotation.x=Math.PI/2;rig.add(hook);
  const hideMat=new THREE.MeshStandardMaterial({color:0x62544c,roughness:1,metalness:.02,transparent:true,opacity:.92,map:TEX.plaster,bumpMap:TEX.plaster,bumpScale:.045});
  const torso=new THREE.Mesh(new THREE.CapsuleGeometry(.55,.95,8,16),hideMat);
  torso.position.y=1.72;torso.scale.set(1.30,1.02,.68);rig.add(torso);
  const shoulder=new THREE.Mesh(new THREE.SphereGeometry(.52,12,10),M.blood);shoulder.position.set(0,2.19,0);shoulder.scale.set(1.2,.58,.72);rig.add(shoulder);
  // An unmistakably bovine but partially abstract head: long muzzle, split nose,
  // ears and curved horns keep the suspended forms legible as cattle, not people.
  const headMass=new THREE.Mesh(new THREE.CapsuleGeometry(.205,.43,6,12),hideMat);headMass.position.set(0,2.34,.32);headMass.rotation.x=Math.PI/2.7;headMass.scale.set(1.18,.92,.88);rig.add(headMass);
  const cheekFold=new THREE.Mesh(new THREE.SphereGeometry(.25,12,10),hideMat);cheekFold.position.set(0,2.19,.43);cheekFold.scale.set(1.18,.62,.9);rig.add(cheekFold);
  const muzzle=new THREE.Mesh(new THREE.SphereGeometry(.205,12,10),mat(0x4c4038,1,{map:TEX.plaster,bumpScale:.04}));muzzle.position.set(0,2.18,.66);muzzle.scale.set(1.22,.72,.8);rig.add(muzzle);
  for(const side of [-1,1]){
    const nostril=new THREE.Mesh(new THREE.SphereGeometry(.036,8,6),M.black);nostril.position.set(side*.105,2.19,.81);nostril.scale.set(.72,1,.55);rig.add(nostril);
    const ear=new THREE.Mesh(new THREE.ConeGeometry(.13,.48,7),hideMat);ear.position.set(side*.32,2.46,.24);ear.rotation.z=side*-.72;ear.rotation.x=-.18;rig.add(ear);
    const eye=new THREE.Mesh(new THREE.SphereGeometry(.035,8,6),M.black);eye.position.set(side*.205,2.39,.61);rig.add(eye);
    const hornCurve=new THREE.CatmullRomCurve3([new THREE.Vector3(side*.19,2.55,.36),new THREE.Vector3(side*.32,2.76,.31),new THREE.Vector3(side*.40,2.82,.20)]);
    const horn=new THREE.Mesh(new THREE.TubeGeometry(hornCurve,10,.045,6,false),mat(0xafa38d,.95));rig.add(horn);
    const leg=new THREE.Mesh(new THREE.CylinderGeometry(.12,.17,1.08,9),hideMat);leg.position.set(side*.37,.57,.24);leg.rotation.z=side*.12;rig.add(leg);
    const rearLeg=new THREE.Mesh(new THREE.CylinderGeometry(.13,.18,1.0,9),hideMat);rearLeg.position.set(side*.37,.57,-.28);rearLeg.rotation.z=side*.1;rig.add(rearLeg);
    for(const zoff of [.24,-.28]){
      const hoof=new THREE.Mesh(new THREE.CylinderGeometry(.16,.19,.20,8),mat(0x252522,.98));hoof.position.set(side*.37,.035,zoff);hoof.rotation.z=side*.08;rig.add(hoof);
      const cleft=new THREE.Mesh(new THREE.BoxGeometry(.022,.15,.15),M.rust);cleft.position.set(side*.37,.015,zoff);rig.add(cleft);
    }
  }
  const udder=new THREE.Mesh(new THREE.SphereGeometry(.22,10,8),mat(0x51413b,.96,{map:TEX.plaster}));udder.position.set(0,.98,-.40);udder.scale.set(1,.66,1.1);rig.add(udder);
  for(let i=0;i<4;i++){const teat=new THREE.Mesh(new THREE.CylinderGeometry(.035,.045,.24,7),M.blood);teat.position.set((i-1.5)*.085,.79,-.39);rig.add(teat);}
  const tailCurve=new THREE.CatmullRomCurve3([new THREE.Vector3(0,2.05,-.62),new THREE.Vector3(.05,1.7,-.91),new THREE.Vector3(.12,1.28,-1.02)]);
  const tail=new THREE.Mesh(new THREE.TubeGeometry(tailCurve,12,.035,6,false),hideMat);rig.add(tail);
  const tailTuft=new THREE.Mesh(new THREE.ConeGeometry(.09,.25,7),M.darkWood);tailTuft.position.set(.12,1.18,-1.02);tailTuft.rotation.x=-.2;rig.add(tailTuft);
  for(let i=0;i<7;i++){
    const rib=new THREE.Mesh(new THREE.TorusGeometry(.49-i*.012,.025,6,22,Math.PI),mat(i%2?0x54433c:0x7b685c,.92));
    rib.position.set(0,1.42+i*.19,.02);rib.rotation.x=Math.PI/2;rib.rotation.z=Math.PI;rib.scale.set(1.35,1,.62);rig.add(rib);
  }
  for(let i=0;i<3;i++){const strip=new THREE.Mesh(new THREE.PlaneGeometry(.22,.86+Math.random()*.42),new THREE.MeshStandardMaterial({color:[0x513a34,0x755d51,0x302b27][i],transparent:true,opacity:.62,side:THREE.DoubleSide,roughness:1}));strip.position.set((i-1)*.31,1.35,.42);strip.rotation.z=(i-1)*.14;rig.add(strip);}
  rig.userData.hangPhase=phase;rig.userData.hanging=true;return rig;
}
function buildAbattoir() {
  const z=newZone('abattoir',0x282522,.049,{minX:-12,maxX:12,minZ:-10,maxZ:10},[0,0,7.0]);
  const floor=mat(0x403a32,1,{map:TEX.wood,bumpScale:.14});addBox(z.group,0,-.15,0,24,.3,20,floor);
  addBox(z.group,0,2,-10,24,4,.35,M.wall);addBox(z.group,-12,2,0,.35,4,20,M.wall);addBox(z.group,12,2,0,.35,4,20,M.wall);addBox(z.group,0,2,10,24,4,.35,M.darkWall);
  addBox(z.group,0,4.0,0,24,.35,20,M.darkWood);
  // Brick courses, limescale, mould patches and peeled plaster leave the building legible as old masonry.
  for(let side of [-1,1]){
    const bricks=new THREE.Mesh(new THREE.PlaneGeometry(22,2.2),M.brick);bricks.position.set(side*11.78,1.12,-.2);bricks.rotation.y=side*Math.PI/2;z.group.add(bricks);
    for(let i=0;i<12;i++){const mould=new THREE.Mesh(new THREE.SphereGeometry(.35+Math.random()*.52,7,6),mat(0x29382c,1,{map:TEX.plaster}));mould.scale.set(1.8,.55,.24);mould.position.set(side*(11.55-Math.random()*.03),.8+Math.random()*2.5,-8+Math.random()*16);z.group.add(mould);}
  }
  for(let i=0;i<8;i++){const beam=addBox(z.group,-10+i*2.85,3.73,0,.16,.28,19,M.darkWood);beam.rotation.z=(Math.random()-.5)*.025;}
  // Meat rails and overhead hoists; carcasses are sculptural, not realistic gore.
  addBox(z.group,0,3.38,-1.6,19,.16,.18,M.rust);addBox(z.group,0,3.05,-1.6,19,.08,.08,M.metal);
  const carcasses=[];[-6.5,-2.2,2.2,6.5].forEach((x,i)=>carcasses.push(addHangingCarcass(z.group,x,-1.4,i*.7)));
  // A brutalist red enclosure frames the central hanging form.
  for(const x of [-3.0,3.0])addBox(z.group,x,2.05,-5.6,.16,4.1,.16,M.rust);
  for(const y of [.25,3.9])addBox(z.group,0,y,-5.6,6,.16,.16,M.rust);
  const redLight=addLight(z.group,0x8e241d,2.2,15,0,3.2,-5.4);redLight.castShadow=true;
  const overhead=addLight(z.group,0xe1d4b4,1.4,13,0,3.8,1.3);overhead.position.y=3.7;
  for(let i=0;i<6;i++){const chain=new THREE.Mesh(new THREE.CylinderGeometry(.012,.016,.8,6),M.rust);chain.position.set(-8+i*3.2,3.35,3.3);z.group.add(chain);}
  // The room contains manifestos that contradict each other, by design.
  addManifesto(z.group,[-11.78,2.3,-6.2],[0,Math.PI/2,0],'FLESH\nREMEMBERS','PARETE NORD / 1977');
  addManifesto(z.group,[11.78,2.1,6.4],[0,-Math.PI/2,0],'THERE IS NO\nRECORD','EAST WALL / 03:17');
  addManifesto(z.group,[0,3.0,-9.78],[0,0,0],'EMPTYING IS\nA FORM OF FAITH','MANIFESTO 13');
  // The cult leader is hidden at the far end; his face is turned away until spoken to.
  const leader=makeNPC(z.group,0,-7.2,'Il Primo',0x171716,1);leader.object.rotation.y=Math.PI;leader.dialogue={line:'I am not the leader. I was the first to understand that the room was not empty. We were taking up too much space.',choices:['Remove the tape.','Give me your place.'],replies:['There is no tape to remove. The machine turns without a reel.','The place is not mine. It is what remains when you give up your name.']};
  const eventMarker=new THREE.Mesh(new THREE.BoxGeometry(.34,.14,.34),M.clue);eventMarker.position.set(0,.12,1.7);z.group.add(eventMarker);
  z.interactables.push({id:'abattoir_ropes',type:'event',object:eventMarker,point:eventMarker.position,radius:3.0,prompt:'[ E ] CHOOSE WHAT TO DO WITH THE HOOKS',run:()=>{
    controls.unlock();dialogueOpen=true;$('speaker').textContent='THE ROOM / THE FOUR BODIES';$('subtitle').textContent='The chains are taut. A sentence rises from the floor: “If you release them, the room is left without witnesses. If you leave them, you become part of the inventory.” When you look again, one of the forms has changed position.';speakVoice($('subtitle').textContent,'THE ROOM');$('subtitle-wrap').classList.add('visible');
    $('dialogue-options').innerHTML='';
    [['CUT THE CHAINS','release'],['LEAVE EVERYTHING AS IT IS','keep']].forEach(([label,id])=>{const b=document.createElement('button');b.className='dialogue-option';b.textContent=label;b.onclick=()=>{storyFlags.add(id==='release'?'released':'complicit');if(id==='release'){carcasses[1].rotation.z=.8;carcasses[1].position.y=-.3;audio?.mechanicalEvent('hoist');fear=Math.min(1,fear+.2);scheduleCultSceneFates(2,'le catene', 'collapse');}else{carcasses[0].rotation.z=.42;storyFlags.add('leader-trust');scheduleCultSceneFates(2,'il silenzio dei ganci','vanish');}$('subtitle-wrap').classList.remove('visible');dialogueOpen=false;glitchPulse=1.3;$('event-flash').classList.add('active');setTimeout(()=>$('event-flash').classList.remove('active'),220);controls.lock();showToast(id==='release'?'THE IRON IS FREE. THE BODIES ARE NOT.':'THE MACHINE KEEPS TURNING.');};$('dialogue-options').appendChild(b);});
  }});
  // A passage that returns the player to the same room from the wrong direction.
  const loopMarker=new THREE.Mesh(new THREE.BoxGeometry(.4,.12,.4),M.gold);loopMarker.position.set(-8,.1,6.8);z.group.add(loopMarker);
  z.interactables.push({id:'impossible_threshold',type:'event',object:loopMarker,point:loopMarker.position,radius:2.6,prompt:'[ E ] CROSS THE SEWN THRESHOLD',run:()=>{playerAnchor.position.set(8.4,0,-6.8);camera.rotation.y+=Math.PI;glitchPulse=1.35;audio?.mechanicalEvent('latch');showToast('YOU ENTERED THROUGH THE SAME DOOR. THE DUST IS ON THE OTHER SIDE.');storyFlags.add('crossed-impossible');}});
  addClueMesh(z.group,new THREE.Vector3(-8.6,1.35,-8.8),'The slaughterhouse ledger','The ledger lists no animals purchased. It lists thirteen names, each crossed out after the same time: 03:17.','butcher-ledger','paper');
  addDoor(z.group,0,9.85,'the road','road',[27,0,29]);
  z.mist=addFog(z.group,32,27,0x8b8177,113);
  z.solids.push({minX:-12,maxX:-11.7,minZ:-10,maxZ:10},{minX:11.7,maxX:12,minZ:-10,maxZ:10},{minX:-12,maxX:12,minZ:-10.2,maxZ:-9.8},{minX:-12,maxX:-4.5,minZ:9.7,maxZ:10},{minX:4.5,maxX:12,minZ:9.7,maxZ:10});
  z.carcasses=carcasses;return z;
}

function buildCellar() {
  const z = newZone('cellar', 0x171713, .062, { minX: -9, maxX: 9, minZ: -8, maxZ: 8 }, [0, 0, 5.5]);
  addBox(z.group, 0, -.15, 0, 18, .3, 16, M.darkWood);
  addBox(z.group, -9, 1.8, 0, .3, 3.6, 16, M.darkWall); addBox(z.group, 9, 1.8, 0, .3, 3.6, 16, M.darkWall); addBox(z.group, 0, 1.8, -8, 18, 3.6, .3, M.darkWall); addBox(z.group, -4.4, 1.8, 8, 9.2, 3.6, .3, M.darkWall); addBox(z.group, 4.4, 1.8, 8, 9.2, 3.6, .3, M.darkWall);
  // Old cellar joists, posts, damp masonry and a long empty table.
  const cellarBrick=new THREE.Mesh(new THREE.PlaneGeometry(17.2,2.4),M.brick);cellarBrick.position.set(0,1.2,-7.78);z.group.add(cellarBrick);
  for (let i = 0; i < 8; i++) { addBox(z.group, -8 + i * 2.25, 3.05, 0, .18, .2, 16, M.wood); }
  for (let x of [-7, 0, 7]) for (let zz of [-5, 0, 5]) addBox(z.group, x, 1.7, zz, .22, 3.4, .22, M.darkWood);
  for (let i = 0; i < 7; i++) { addBox(z.group, -6 + i * 2, .52, -1.0, 1.0, .08, .65, M.wood); addBox(z.group, -6 + i * 2, .22, -1.0, .08, .5, .08, M.darkWood); }
  // The artificial sun: harsh light in an otherwise unlit room.
  addBox(z.group, 0, 3.15, -4.8, 1.1, .16, .55, M.warmLight);
  addLight(z.group, 0xffb451, 5.8, 15, 0, 2.95, -4.3, { shadow: true, decay: 1.45 });
  // Turntable and the blank acetate. No record audio exists in this game.
  addBox(z.group, 0, .9, -2.2, 2.2, .9, 1.8, M.darkWood);
  addBox(z.group, 0, 1.38, -2.2, 2.05, .1, 1.65, M.black);
  const platter = new THREE.Mesh(new THREE.CylinderGeometry(.59, .59, .07, 48), M.metal); platter.position.set(0, 1.49, -2.2); z.group.add(platter);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(.51, .51, .018, 64), mat(0x111210, .24, { metalness: .45 })); disc.position.set(0, 1.54, -2.2); z.group.add(disc);
  const label = new THREE.Mesh(new THREE.CircleGeometry(.115, 32), mat(0xd1caba, .9)); label.rotation.x = -Math.PI / 2; label.position.set(0, 1.555, -2.2); z.group.add(label);
  const arm = addBox(z.group, .72, 1.65, -2.0, .07, .05, .8, M.gold, { rotation: [0, 0, -.16] });
  // A separate reel-to-reel deck: visible spools turn even though no tape is fitted.
  const reelDeck=new THREE.Group();reelDeck.position.set(-6.15,0,-2.65);z.group.add(reelDeck);
  addBox(reelDeck,0,.62,0,2.55,.92,.72,M.darkWood);
  addBox(reelDeck,0,.73,.385,2.38,.53,.035,M.metal);
  addBox(reelDeck,0,1.08,.405,2.28,.12,.045,M.black);
  const meter=new THREE.Mesh(new THREE.PlaneGeometry(.52,.18),new THREE.MeshBasicMaterial({map:makeLabelTexture('03:17  /  REC',512,128),side:THREE.DoubleSide}));meter.position.set(0,1.08,.435);reelDeck.add(meter);
  const reels=[];
  for(const x of [-.72,.72]){
    const spool=new THREE.Group();spool.position.set(x,1.47,.48);reelDeck.add(spool);
    const flange=new THREE.Mesh(new THREE.CylinderGeometry(.36,.36,.09,40),M.metal);flange.rotation.x=Math.PI/2;spool.add(flange);
    const rim=new THREE.Mesh(new THREE.TorusGeometry(.34,.035,8,40),M.gold);spool.add(rim);
    const inner=new THREE.Mesh(new THREE.TorusGeometry(.22,.022,7,32),M.rust);spool.add(inner);
    const hub=new THREE.Mesh(new THREE.CylinderGeometry(.115,.115,.14,24),M.black);hub.rotation.x=Math.PI/2;spool.add(hub);
    for(let i=0;i<8;i++){
      const spoke=addBox(spool,0,0,.075,.045,.56,.035,M.rust,{castShadow:false});spoke.rotation.z=i*Math.PI/4;
      const aperture=new THREE.Mesh(new THREE.CircleGeometry(.035,10),M.black);const a=i*Math.PI/4;aperture.position.set(Math.cos(a)*.245,Math.sin(a)*.245,.076);spool.add(aperture);
    }
    const noTape=new THREE.Mesh(new THREE.TorusGeometry(.405,.012,5,48),M.darkWood);spool.add(noTape);
    reels.push(spool);rotatingMachines.push({mesh:spool,speed:x<0?.34:-.29});
  }
  const tapePath=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(-.36,1.48,.47),new THREE.Vector3(-.13,1.33,.5),new THREE.Vector3(.08,1.33,.5),new THREE.Vector3(.36,1.48,.47)]),18,.018,5,false),M.black);reelDeck.add(tapePath);
  for(let i=0;i<5;i++){const knob=new THREE.Mesh(new THREE.CylinderGeometry(.055,.055,.075,12),M.gold);knob.rotation.x=Math.PI/2;knob.position.set(-.85+i*.42,.76,.43);reelDeck.add(knob);}
  addManifesto(reelDeck,[0,1.55,-.03],[0,0,0],'THERE IS NO\nTAPE','REEL UNIT 14-B / 03:17');
  // Thirteen chairs, one turned towards the viewer.
  for (let i = 0; i < 13; i++) {
    const a = i / 13 * Math.PI * 2; const x = Math.cos(a) * 5.0; const zz = Math.sin(a) * 4.1 + .3;
    const chair = new THREE.Group(); chair.position.set(x, 0, zz); chair.rotation.y = -a + Math.PI; z.group.add(chair);
    addBox(chair, 0, .53, 0, .72, .12, .65, M.wood); addBox(chair, 0, 1.05, -.29, .72, 1.0, .12, M.darkWood);
    addBox(chair, -.28, .25, 0, .08, .5, .08, M.darkWood); addBox(chair, .28, .25, 0, .08, .5, .08, M.darkWood);
  }
  // A human outline that could be a coat on a hook.
  const hanging = makeNPC(z.group, -7.0, -4.9, 'Il cappotto', 0x141614, 1); hanging.object.scale.set(.72, 1.12, .72); hanging.prompt = '[ E ] EXAMINE — THE COAT';
  hanging.dialogue = { line: 'The sleeves are still warm. There is no one inside.', choices: ['Who left it here?', 'Do not touch it.'], replies: ['Someone who wears other people's clothes when they are cold.', 'It has already been touched. From the side you cannot see.'] };
  addDoor(z.group, 0, 7.95, 'the stairs', 'home', [7.5, 0, -5.2]);
  const turntableEntry = { id: 'listen', type: 'listen', object: disc, point: disc.position, radius: 3.0, prompt: '[ E ] EXAMINE THE WHITE', title: 'Il Bianco' };
  z.interactables.push(turntableEntry);
  z.mist = addFog(z.group, 18, 22, 0x8d8c7d, 92);
  z.solids.push({ minX: -9, maxX: -8.7, minZ: -8, maxZ: 8 }, { minX: 8.7, maxX: 9, minZ: -8, maxZ: 8 }, { minX: -9, maxX: -4.5, minZ: -8.2, maxZ: -8 }, { minX: 4.5, maxX: 9, minZ: -8.2, maxZ: -8 }, { minX: -9, maxX: -4.6, minZ: 7.7, maxZ: 8 }, { minX: 4.6, maxX: 9, minZ: 7.7, maxZ: 8 });
  return z;
}

buildRoad(); buildHome(); buildChurch(); buildRuin(); buildAbattoir(); buildCellar();

// The cellar is deliberately inaccessible until all eight traces have been read.
const cellarDoor = zones.home.interactables.find(i => i.destination === 'cellar');

function enterZone(name, spawn) {
  Object.values(zones).forEach(v => { v.group.visible = false; });
  zone = zones[name]; currentZone = name; zone.group.visible = true;
  playerAnchor.position.set(spawn[0], 0, spawn[2]);
  camera.position.set(0, 1.63, 0);
  velocity.set(0, 0, 0);
  scene.fog = zone.fog || new THREE.FogExp2(zone.fogColor, zone.density);
  scene.background.set(zone.fogColor);
  $('location').textContent = ({ road: 'THE FOG ROAD', home: 'FARMHOUSE / THIRTEEN PLACES', church: 'DECONSECRATED CHURCH', ruin: 'ABANDONED HOUSE', cellar: 'CELLAR / 14-B', abattoir: 'ABATTOIR / THE EMPTY ROOM' })[name];
  glitchPulse = Math.max(glitchPulse, .42); audio?.stinger(.32); audio?.setZone(name); if(name==='abattoir'){fear=Math.min(1,fear+.19);audio?.mechanicalEvent('hoist');} if(name==='church' && collected.size>=2 && !scenePlayed) showToast('THE BELL ROPE IS WET.'); if(name==='cellar'){fear=Math.min(1,fear+.18);}
  showToast(({ road: 'THE ROAD IS NOT WHERE YOU LEFT IT', home: 'NO ONE HAS ASKED YOUR NAME', church: 'THE NAVE IS LONGER FROM INSIDE', ruin: 'SOMEONE IS WAITING FOR THE PHONE HERE', cellar: 'THE ROOM HAS KEPT THE HEAT', abattoir: 'FLESH HAS A LONG MEMORY HERE' })[name]);
}
function currentPosition() { return playerAnchor.position; }
function playerInputEnabled() { return gameStarted && !gameEnded && !listeningPending && !cultFateActive && !dialogueOpen && !journalOpen; }

// -----------------------------------------------------------------------------
// Sound: entirely synthesised, layered and intentionally non-musical.
// -----------------------------------------------------------------------------
class AmbientSound {
  constructor() { this.ctx = null; this.master = null; this.noiseGain = null; this.droneGain = null; this.nodes = []; this.ready = false; this.zoneGain=null; this.pulseGain=null; this.currentZone='road'; }
  async start() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    this.ctx = new AC(); if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.master = this.ctx.createGain(); this.master.gain.value = muted ? 0 : .62;
    const low = this.ctx.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 130; low.gain.value = 9;
    const comp = this.ctx.createDynamicsCompressor(); comp.threshold.value = -24; comp.ratio.value = 3.2; comp.attack.value = .02; comp.release.value = .3;
    this.master.connect(low); low.connect(comp); comp.connect(this.ctx.destination);
    // Brown-noise bed with a moving band-pass: wind, room tone, tape hiss.
    const size = this.ctx.sampleRate * 3; const buffer = this.ctx.createBuffer(1, size, this.ctx.sampleRate); const data = buffer.getChannelData(0); let last = 0;
    for (let i = 0; i < size; i++) { const white = Math.random() * 2 - 1; last = (last + .025 * white) / 1.025; data[i] = last * 3.1; }
    const src = this.ctx.createBufferSource(); src.buffer = buffer; src.loop = true;
    const filter = this.ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 620;
    const hiss = this.ctx.createGain(); hiss.gain.value = .20; src.connect(filter); filter.connect(hiss); hiss.connect(this.master); src.start();
    this.nodes.push(src, filter, hiss);
    this.noiseGain = hiss;
    // Inharmonic low drone; no melody and no representation of the forbidden record.
    this.droneGain = this.ctx.createGain(); this.droneGain.gain.value = .15; this.droneGain.connect(this.master);
    this.zoneGain=this.ctx.createGain();this.zoneGain.gain.value=.10;this.zoneGain.connect(this.master);
    this.pulseGain=this.ctx.createGain();this.pulseGain.gain.value=.025;this.pulseGain.connect(this.master);
    [55, 58.27, 82.41, 110.8].forEach((f, i) => {
      const o = this.ctx.createOscillator(); o.type = i === 0 ? 'sine' : 'triangle'; o.frequency.value = f;
      const g = this.ctx.createGain(); g.gain.value = [.33, .065, .035, .025][i];
      const lfo = this.ctx.createOscillator(); lfo.frequency.value = .05 + i * .027;
      const lg = this.ctx.createGain(); lg.gain.value = .5 + i * .17; lfo.connect(lg); lg.connect(o.frequency);
      o.connect(g); g.connect(this.droneGain); o.start(); lfo.start(); this.nodes.push(o, g, lfo, lg);
    });
    // A detuned, unstable metallic cluster: bowed iron rather than a conventional score.
    [41.2,43.7,61.7,92.5,117.3].forEach((f,i)=>{const o=this.ctx.createOscillator();o.type=i%2?'sawtooth':'triangle';o.frequency.value=f;const filter=this.ctx.createBiquadFilter();filter.type='bandpass';filter.frequency.value=170+i*115;filter.Q.value=2.4;const g=this.ctx.createGain();g.gain.value=[.012,.009,.006,.004,.003][i];o.connect(filter);filter.connect(g);g.connect(this.zoneGain);o.start();this.nodes.push(o,filter,g);});
    const pulse=this.ctx.createOscillator();pulse.type='square';pulse.frequency.value=.17;const pg=this.ctx.createGain();pg.gain.value=12;pulse.connect(pg);pg.connect(this.pulseGain.gain);pulse.start();this.nodes.push(pulse,pg);
    this.ready = true; this.setZone('road'); this.scheduleKnock(); this.scheduleMechanical();
  }
  scheduleKnock() {
    if (!this.ready || !this.ctx) return;
    const delay = 9000 + Math.random() * 18000;
    setTimeout(() => { if (this.ready && !muted) this.knock(); this.scheduleKnock(); }, delay);
  }
  knock() {
    if (!this.ctx || muted) return;
    const t = this.ctx.currentTime; const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(76 + Math.random() * 32, t); o.frequency.exponentialRampToValueAtTime(32, t + .8);
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 280;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.22, t + .035); g.gain.exponentialRampToValueAtTime(.0001, t + 1.1);
    o.connect(f); f.connect(g); g.connect(this.master); o.start(t); o.stop(t + 1.15);
  }
  stinger(intensity = .4) {
    if (!this.ctx || !this.ready || muted) return;
    const t = this.ctx.currentTime; const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(180 + Math.random() * 110, t); o.frequency.exponentialRampToValueAtTime(42, t + .55);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.18 * intensity, t + .025); g.gain.exponentialRampToValueAtTime(.0001, t + .7);
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 510; f.Q.value = .8;
    o.connect(f); f.connect(g); g.connect(this.master); o.start(t); o.stop(t + .72);
  }
  setTension(v) { if (this.droneGain && this.ctx) {this.droneGain.gain.setTargetAtTime(.10 + v * .25, this.ctx.currentTime, .7); if(this.pulseGain)this.pulseGain.gain.setTargetAtTime(.018+v*.10,this.ctx.currentTime,.8);} }
  setZone(name){if(!this.ready||!this.ctx)return;this.currentZone=name;const vals={road:.055,home:.11,church:.16,ruin:.20,cellar:.28,abattoir:.32};this.zoneGain.gain.setTargetAtTime(vals[name]??.1,this.ctx.currentTime,1.8);this.noiseGain.gain.setTargetAtTime(({road:.13,home:.2,church:.17,ruin:.26,cellar:.32,abattoir:.38})[name]??.18,this.ctx.currentTime,1.5);}
  powerSurge(){if(!this.ctx)return;const t=this.ctx.currentTime;const o=this.ctx.createOscillator(),g=this.ctx.createGain();o.type='sawtooth';o.frequency.setValueAtTime(38,t);o.frequency.exponentialRampToValueAtTime(430,t+.35);o.frequency.exponentialRampToValueAtTime(27,t+1.1);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.25,t+.04);g.gain.exponentialRampToValueAtTime(.0001,t+1.3);o.connect(g);g.connect(this.master);o.start(t);o.stop(t+1.35);}
  bell(){if(!this.ctx)return;const t=this.ctx.currentTime;[73.4,110,146.8,221].forEach((f,i)=>{const o=this.ctx.createOscillator(),g=this.ctx.createGain();o.type='sine';o.frequency.value=f;g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.12/(i+1),t+.02);g.gain.exponentialRampToValueAtTime(.0001,t+5+i);o.connect(g);g.connect(this.master);o.start(t);o.stop(t+6+i);});}
  killSting(){if(!this.ctx)return;const t=this.ctx.currentTime;const o=this.ctx.createOscillator(),g=this.ctx.createGain(),f=this.ctx.createBiquadFilter();o.type='sawtooth';o.frequency.setValueAtTime(260,t);o.frequency.exponentialRampToValueAtTime(24,t+2.6);f.type='lowpass';f.frequency.value=500;g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.38,t+.08);g.gain.exponentialRampToValueAtTime(.0001,t+3);o.connect(f);f.connect(g);g.connect(this.master);o.start(t);o.stop(t+3.1);} 
  mechanicalNoise(duration=.7, frequency=700, q=1.2, volume=.14, pan=0) {
    if(!this.ctx||!this.ready||muted)return;const t=this.ctx.currentTime;
    const length=Math.ceil(this.ctx.sampleRate*duration);const buffer=this.ctx.createBuffer(1,length,this.ctx.sampleRate);const data=buffer.getChannelData(0);let last=0;
    for(let i=0;i<length;i++){const white=Math.random()*2-1;last=(last+.07*white)/1.07;data[i]=last*4.2;}
    const src=this.ctx.createBufferSource();src.buffer=buffer;const filter=this.ctx.createBiquadFilter();filter.type='bandpass';filter.frequency.value=frequency;filter.Q.value=q;
    const gain=this.ctx.createGain();gain.gain.setValueAtTime(.0001,t);gain.gain.exponentialRampToValueAtTime(volume,t+Math.min(.035,duration*.28));gain.gain.setTargetAtTime(volume*.55,t+Math.min(.08,duration*.5),Math.max(.025,duration*.18));gain.gain.exponentialRampToValueAtTime(.0001,t+duration);
    const stereo=this.ctx.createStereoPanner?this.ctx.createStereoPanner():this.ctx.createGain();if(stereo.pan)stereo.pan.value=pan;
    src.connect(filter);filter.connect(gain);gain.connect(stereo);stereo.connect(this.master);src.start(t);src.stop(t+duration+.04);
  }
  mechanicalTone(start=180,end=65,duration=1.2,type='sine',volume=.075,pan=0){
    if(!this.ctx||!this.ready||muted)return;const t=this.ctx.currentTime,o=this.ctx.createOscillator(),f=this.ctx.createBiquadFilter(),g=this.ctx.createGain();
    o.type=type;o.frequency.setValueAtTime(start,t);o.frequency.exponentialRampToValueAtTime(Math.max(15,end),t+duration);f.type='lowpass';f.frequency.value=1500;g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(volume,t+.06);g.gain.exponentialRampToValueAtTime(.0001,t+duration);
    const panNode=this.ctx.createStereoPanner?this.ctx.createStereoPanner():this.ctx.createGain();if(panNode.pan)panNode.pan.value=pan;o.connect(f);f.connect(g);g.connect(panNode);panNode.connect(this.master);o.start(t);o.stop(t+duration+.03);
  }
  mechanicalEvent(kind=null){
    if(!this.ctx||muted)return;const zone=this.currentZone;const pan=(Math.random()-.5)*1.7;
    const pool=kind?[kind]:({road:['chain','pipe','metal','gear','hoist'],home:['hinge','drawer','glass','fridge','utensil','clock'],church:['rope','bench','organ','metal','bellows'],ruin:['telephone','cassette','hinge','pipe','latch'],cellar:['ratchet','valve','scrape','bearing','screwdriver'],abattoir:['hoist','chain','hook','meat-saw','drain','latch','hammer']})[zone]||['metal','scrape'];
    const event=pool[Math.floor(Math.random()*pool.length)];
    if(event==='hinge'){this.mechanicalNoise(1.45,380,2.8,.18,pan);this.mechanicalTone(210,74,1.35,'sawtooth',.035,pan);}
    else if(event==='drawer'){this.mechanicalNoise(.72,950,1.8,.12,pan);setTimeout(()=>this.knock(),220);}
    else if(event==='glass'){this.mechanicalNoise(.42,1850,8,.095,pan);this.mechanicalTone(620,480,.8,'sine',.025,pan);}
    else if(event==='fridge'){this.mechanicalTone(52,44,3.2,'sine',.095,pan);this.mechanicalNoise(1.7,240,1.1,.07,pan);}
    else if(event==='chain'||event==='rope'){for(let i=0;i<5;i++)setTimeout(()=>{this.mechanicalNoise(.13+Math.random()*.12,1300+Math.random()*1300,5,.08,pan);},i*95);this.mechanicalTone(175,88,1.1,'triangle',.035,pan);}
    else if(event==='gear'||event==='ratchet'){for(let i=0;i<8;i++)setTimeout(()=>{this.mechanicalNoise(.07,750+Math.random()*800,6,.09,pan);this.mechanicalTone(95+Math.random()*80,38,.12,'square',.014,pan);},i*85);}
    else if(event==='pipe'||event==='valve'||event==='bearing'){this.mechanicalNoise(1.8,220,1.7,.16,pan);this.mechanicalTone(95+Math.random()*35,28,2.3,'sawtooth',.07,pan);}
    else if(event==='telephone'){this.mechanicalTone(420,390,.6,'sine',.05,pan);this.mechanicalTone(422,397,.6,'sine',.04,pan);this.mechanicalNoise(.18,2600,7,.075,pan);}
    else if(event==='cassette'){this.mechanicalNoise(2.1,1450,1.4,.095,pan);this.mechanicalTone(68,56,2.2,'sawtooth',.035,pan);}
    else if(event==='organ'){this.mechanicalNoise(.22,900,4,.07,pan);this.mechanicalTone(71,70,2.8,'triangle',.055,pan);}
    else if(event==='bench'){this.mechanicalNoise(.8,320,2.3,.12,pan);this.mechanicalTone(115,58,.75,'sawtooth',.04,pan);}
    else if(event==='utensil'){this.mechanicalNoise(.09,2600,9,.09,pan);setTimeout(()=>this.mechanicalNoise(.12,1750,8,.055,-pan),145);}
    else if(event==='screwdriver'){this.mechanicalNoise(.34,3100,10,.12,pan);this.mechanicalTone(240,95,.48,'square',.025,pan);setTimeout(()=>this.mechanicalNoise(.24,2500,8,.08,pan),260);}
    else if(event==='scrape'){this.mechanicalNoise(2.1,510,1.1,.15,pan);this.mechanicalTone(148,46,1.9,'sawtooth',.035,pan);}
    else if(event==='hoist'||event==='hook'){for(let i=0;i<4;i++)setTimeout(()=>this.mechanicalNoise(.16,1750+Math.random()*500,7,.075,pan),i*180);this.mechanicalTone(82,39,2.8,'sawtooth',.055,pan);}
    else if(event==='meat-saw'){this.mechanicalNoise(2.0,1250,2.1,.12,pan);this.mechanicalTone(120,98,1.7,'square',.025,pan);}
    else if(event==='drain'){this.mechanicalNoise(2.5,350,1.3,.12,pan);this.mechanicalTone(43,28,2.4,'sine',.06,pan);}
    else if(event==='hammer'){for(let i=0;i<3;i++)setTimeout(()=>this.knock(),i*240);}
    else if(event==='clock'){this.mechanicalNoise(.07,2400,10,.06,pan);setTimeout(()=>this.mechanicalNoise(.07,2300,10,.05,-pan),480);this.mechanicalTone(62,60,1.5,'sine',.018,pan);}
    else if(event==='latch'){this.mechanicalNoise(.35,1350,5,.14,pan);this.mechanicalTone(220,76,.6,'triangle',.03,pan);}
    else if(event==='bellows'){this.mechanicalNoise(1.8,420,1.4,.095,pan);this.mechanicalTone(61,55,1.6,'sine',.04,pan);}
    else {this.mechanicalNoise(.95,540+Math.random()*1200,2+Math.random()*4,.13,pan);this.mechanicalTone(135+Math.random()*150,42,.85,'triangle',.04,pan);}
  }
  scheduleMechanical(){if(!this.ready)return;const delay=4300+Math.random()*11700;setTimeout(()=>{if(this.ready&&!muted)this.mechanicalEvent();this.scheduleMechanical();},delay);}
  killingAudio(){
    if(!this.ctx||!this.ready||muted)return;
    const t=this.ctx.currentTime;
    this.mechanicalNoise(2.25,310,.72,.16,(Math.random()-.5)*.7);
    this.mechanicalTone(92,18,2.4,'sawtooth',.10,(Math.random()-.5)*.4);
    setTimeout(()=>{if(this.ready&&!muted)this.mechanicalNoise(.11,3200,9,.13,(Math.random()-.5)*1.2);},720);
    setTimeout(()=>{if(this.ready&&!muted)this.mechanicalNoise(.065,1450,12,.065,(Math.random()-.5)*1.2);},910);
  }
  setDayNight(night){
    if(!this.ctx||!this.ready||!this.noiseGain)return;
    this.noiseGain.gain.setTargetAtTime(.12+night*.13,this.ctx.currentTime,3.2);
    if(this.droneGain)this.droneGain.gain.setTargetAtTime(.10+night*.12,this.ctx.currentTime,4.0);
  }
  toggle() { muted = !muted; if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : .62, this.ctx.currentTime, .08); $('sound-button').innerHTML = muted ? 'MUTED <b>[M]</b>' : 'SOUND <b>[M]</b>'; }
}
audio = new AmbientSound();

// -----------------------------------------------------------------------------
// Dialogue, journal, clues and interaction state
// -----------------------------------------------------------------------------
function showToast(text) {
  const el = $('toast'); el.textContent = text; el.classList.add('visible'); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), 2600);
}
function updateProgress() {
  const n = collected.size; $('evidence-count').textContent = `${n} / ${clueCount} CLUES`;
  $('inventory-count').textContent = String(n);
  $('progress-fill').style.width = `${n / clueCount * 100}%`;
  if (n === 0) $('objective-text').textContent = 'Find the farmhouse. They have been expecting the piano tuner.';
  else if (n < clueCount) $('objective-text').textContent = 'Eight documents. Thirteen people. The house is making room.';
  else $('objective-text').textContent = 'The room beneath the house is open. Go down when you are ready.';
  if (cellarDoor) {
    cellarDoor.locked = n < clueCount;
    cellarDoor.prompt = n < clueCount ? `[ E ] LOCKED — ${clueCount - n} CLUES` : '[ E ] DESCEND — THE CELLAR';
    if (cellarDoor.slab) cellarDoor.slab.material = n < clueCount ? M.rust : M.wood;
  }
  $('journal-total').textContent = `${journal.length} OBJECTS CATALOGUED`;
}
function updateJournalCount(){ $('journal-total').textContent = `${journal.length} OBJECTS CATALOGUED`; $('inventory-count').textContent=String(journal.length); }
function collectClue(item) {
  if (collected.has(item.id)) return;
  collected.add(item.id);
  journal.push({ id: item.id, title: item.title, description: item.description, kind: item.kind || 'documento', zone: currentZone }); updateJournalCount();
  zone.group.remove(item.object);
  zone.interactables.splice(zone.interactables.indexOf(item), 1);
  dread = Math.min(1, dread + .13); glitchPulse = Math.max(glitchPulse, .85); audio.stinger(.85);
  showToast(`CLUE RECORDED // ${item.title.toUpperCase()}`); updateProgress();
  if (collected.size === clueCount) showToast('THE HOUSE HAS FINISHED COUNTING. THE HATCH IS OPEN.');
  const next=cultRoster.find(n=>n.fate==='present');if(next)queueCultFate(`traccia ${collected.size}`,next,collected.size%3===0?'collapse':'vanish');
}
function speakVoice(){ /* subtitle-only game; no spoken voiceover. */ }

function openDialogue(npc) {
  if (dialogueOpen) return;
  dialogueOpen = true; controls.unlock(); $('subtitle-wrap').classList.add('visible');
  $('speaker').textContent = npc.name.toUpperCase(); $('subtitle').textContent = npc.dialogue?.line || 'There is no answer. Only the sound of clothing.'; speakVoice(npc.dialogue?.line || 'There is no answer.',npc.name);
  const options = $('dialogue-options'); options.innerHTML = '';
  (npc.dialogue?.choices || ['Listen.', 'Step away.']).forEach((choice, i) => {
    const b = document.createElement('button'); b.className = 'dialogue-option'; b.innerHTML = `<b>[${i + 1}]</b>${choice}`;
    b.addEventListener('click', () => chooseDialogue(npc, i)); options.appendChild(b);
  });
  activeTarget = null; $('prompt').classList.remove('visible');
}
function chooseDialogue(npc, index) {
  let reply = npc.dialogue?.replies?.[index] || 'The answer comes from a room that does not exist.';
  const lower=(npc.name||'').toLowerCase();
  if(lower==='ines'){storyFlags.add(index===0?'ines-trust':'ines-betrayed');}
  if(lower==='sergio'){storyFlags.add(index===0?'sergio-truth':'sergio-silence');}
  if(lower==='dario'||lower==='il primo'){storyFlags.add(index===0?'challenged-leader':'accepted-leader');}
  if(lower==='ottavio'&&index===1)storyFlags.add('ottavio-audio');
  if(lower==='anna')storyFlags.add(index===0?'anna-mercy':'anna-table');
  $('subtitle').textContent = reply; speakVoice(reply,npc.name); $('dialogue-options').innerHTML = '<button class="dialogue-option" id="dialogue-end"><b>[↵]</b>Say nothing more.</button>'; 
  $('dialogue-end').addEventListener('click', closeDialogue);
  glitchPulse = Math.max(glitchPulse, .28); audio.stinger(.25);
}
function closeDialogue() { dialogueOpen = false; $('subtitle-wrap').classList.remove('visible');  controls.lock(); }
function openJournal() {
  if (!gameStarted || gameEnded || listeningPending || dialogueOpen) return;
  journalOpen = true; controls.unlock(); $('journal').classList.add('active'); renderJournal();
}
function closeJournal() { journalOpen = false; $('journal').classList.remove('active'); if (gameStarted && !gameEnded) controls.lock(); }
function renderJournal() {
  const list = $('journal-list'); list.innerHTML = '';
  if (!journal.length) { list.innerHTML = '<div class="empty-note">No clues recorded.<br><br>The farmhouse is not yet in view.</div>'; return; }
  journal.forEach((entry, i) => {
    const b = document.createElement('button'); b.className = `journal-entry${i === 0 ? ' active' : ''}`;
    b.innerHTML = `<small>${String(i + 1).padStart(2, '0')} / ${entry.zone.toUpperCase()}</small><strong>${entry.title}</strong>`;
    b.addEventListener('click', () => {
      list.querySelectorAll('.journal-entry').forEach(x => x.classList.remove('active')); b.classList.add('active');
      $('journal-detail').innerHTML = `<div class="detail-stamp">EPISTASSI / CLUE ${String(i + 1).padStart(2, '0')}</div><h3>${entry.title}</h3><p>${entry.description}</p><div class="detail-foot">FOUND IN: ${entry.zone.toUpperCase()} · KEPT IN THE JOURNAL</div>`;
    });
    list.appendChild(b);
  });
  list.querySelector('.journal-entry')?.click();
}
function inspectTarget(item) {
  if (item.type === 'clue') { collectClue(item); return; }
  if (item.type === 'event') { if(item.used)return;item.used=true;const ix=zone.interactables.indexOf(item);if(ix>=0)zone.interactables.splice(ix,1);item.run?.();return; }
  if (item.type === 'npc') { openDialogue(item); return; }
  if (item.type === 'door') {
    if (item.locked && collected.size < clueCount) { showToast(`MISSING ${clueCount - collected.size} CLUES. LA PORTA NON RICONOSCE LE TUE MANI.`); audio.stinger(.22); return; }
    enterZone(item.destination, item.spawn); return;
  }
  if (item.type === 'listen') { beginListening(); return; }
}
function beginListening() {
  if (collected.size < clueCount) { showToast('THE PLATTER IS EMPTY. YOU HAVE NOT BROUGHT ENOUGH OF THE HOUSE DOWN HERE YET.'); return; }
  if (listeningPending || gameEnded) return;
  // Lock the player inside the listening room. Every remaining cultist is brought
  // into view and receives a visible fate before the ending choices are revealed.
  listeningPending=true;controls.unlock();keys.clear();hiddenBreath=false;activeTarget=null;
  camera.position.set(0,1.63,0);camera.rotation.z=0;cameraDirector.active=false;cameraDirector.cooldown=999;playerRig.visible=false;occludeMat.opacity=0;occludeRight.material.opacity=0;
  $('hud').classList.add('hidden-hud');$('prompt').classList.remove('visible');
  if(audio?.master&&audio.ctx)audio.master.gain.setTargetAtTime(.26,audio.ctx.currentTime,1.2);
  cultRoster.filter(n=>n.fate==='present').forEach((npc,i)=>queueCultFate('il giro del disco',npc,i%4===0?'collapse':'vanish'));
  showToast('THIRTEEN NAMES. THE ROOM WANTS TO WATCH THEM LEAVE.');
  speakVoice('Do not lower your eyes. The room must be emptied before you can choose.','REGISTRAZIONE 14-B');
  if(!cultFateActive && cultFateQueue.length===0) finishListening();
}
function finishListening() {
  if(!listeningPending)return;
  listeningPending=false;gameEnded=true;controls.unlock();keys.clear();$('hud').classList.add('hidden-hud');
  const screen=$('ending-screen');screen.classList.add('active');
  $('ending-title').textContent='Il Bianco has not been heard.';
  $('ending-copy').textContent='Thirteen people have left the room. The machine keeps turning. The platter is empty, but no one has a name left to offer it.';
  $('ending-small').textContent='THE THIRTEEN HAVE LEFT. YOUR NAME REMAINS.';
  $('ending-choices').classList.add('visible');$('ending-result').classList.remove('visible');
  speakVoice('Thirteen empty places. Now choose what to do with yours.','REGISTRAZIONE 14-B');
}
function resolveEnding(choice) {
  const choices={
    fill:{title:'The Fourteenth Place',copy:'You gave them your name. No one heard the record. The room has learned to use your voice as a chair.',small:'ENDING I / FILLING',voice:'You left your name on the table. Now the room can speak.'},
    expose:{title:'The Open Window',copy:'You cut the power and opened the windows. The 1977 choir was not killed by a song: gas had stolen the air from the room. The thirteen have already left the farmhouse. No explanation can return their faces.',small:'ENDING II / AIR',voice:'The room was saturated. It was not the record. It was not only the record.'},
    preserve:{title:'The Recording Without Tape',copy:'You left everything as it was. The platter keeps turning. When you leave, someone wearing your coat is already sitting in your place.',small:'ENDING III / PRESERVATION',voice:'You did not choose. It is a choice the room knows well.'}
  };
  const result={...(choices[choice]||choices.preserve)};
  if(choice==='expose' && storyFlags.has('sergio-truth')) result.copy='Sergio left you the report: carbon monoxide, blocked ventilation, a choir that died without ever hearing the record. You opened the windows. The explanation cannot bring the thirteen back, but it breaks the liturgy.';
  if(choice==='fill' && storyFlags.has('accepted-leader')) result.copy='You took Dario's place. He was not the leader; he was only the first to empty himself. Your name is engraved on the fourteenth chair, beneath the other thirteen.';
  if(choice==='preserve' && storyFlags.has('crossed-impossible')) result.copy='The sewn threshold returned you to the same room, but from the opposite wall. You left the platter turning. When you leave, the door opens inward onto the room you have just left.';
  if(choice==='fill' && storyFlags.has('released')) result.copy += ' You cut the chains but freed no one. The place was filled by a choice you cannot take back.';
  if(choice==='expose' && storyFlags.has('complicit')) result.copy += ' You left the hooks untouched when you could have intervened. The truth arrives, but it is not innocent.';
  $('ending-title').textContent=result.title;$('ending-copy').textContent=result.copy;$('ending-small').textContent=result.small;
  $('ending-choices').classList.remove('visible');$('ending-result').classList.add('visible');
  storyFlags.add(`ending-${choice}`);speakVoice(result.voice,'REGISTRAZIONE 14-B');
  $('event-flash').classList.add('active');setTimeout(()=>$('event-flash').classList.remove('active'),420);
  glitchPulse=1.4;audio?.killSting();
  if(choice==='preserve'){fear=1;}
}
// -----------------------------------------------------------------------------
// Weather and an intrusive camera director: the camera sometimes behaves like
// a hidden observer rather than a neutral first-person instrument.
// -----------------------------------------------------------------------------
const rainGeometry=new THREE.BufferGeometry();const rainCount=1150;const rainPositions=new Float32Array(rainCount*3);
for(let i=0;i<rainCount;i++){rainPositions[i*3]=(Math.random()-.5)*32;rainPositions[i*3+1]=Math.random()*16;rainPositions[i*3+2]=(Math.random()-.5)*32;}
rainGeometry.setAttribute('position',new THREE.BufferAttribute(rainPositions,3));
const rainPoints=new THREE.Points(rainGeometry,new THREE.PointsMaterial({color:0x9ba7a5,size:.045,transparent:true,opacity:.23,depthWrite:false,sizeAttenuation:true}));scene.add(rainPoints);
const rainStreakArray=new Float32Array(260*6);const rainStreakGeometry=new THREE.BufferGeometry();rainStreakGeometry.setAttribute('position',new THREE.BufferAttribute(rainStreakArray,3));
const rainStreaks=new THREE.LineSegments(rainStreakGeometry,new THREE.LineBasicMaterial({color:0x9daaa8,transparent:true,opacity:.14}));scene.add(rainStreaks);
const weatherState={lightning:0,nextLightning:36+Math.random()*38,wind:0};
const playerRig=new THREE.Group();playerRig.visible=false;controls.getObject().add(playerRig);
const playerCoat=new THREE.Mesh(new THREE.CapsuleGeometry(.29,.66,5,9),M.darkWood);playerCoat.position.y=.98;playerRig.add(playerCoat);
const playerHead=new THREE.Mesh(new THREE.SphereGeometry(.19,12,10),M.black);playerHead.position.y=1.58;playerRig.add(playerHead);
for(const x of [-.34,.34]){const arm=new THREE.Mesh(new THREE.CapsuleGeometry(.075,.46,4,7),M.darkWood);arm.position.set(x,.97,0);arm.rotation.z=x<0?-.13:.13;playerRig.add(arm);}
const directorOccluder=new THREE.Group();camera.add(directorOccluder);
const occludeMat=new THREE.MeshBasicMaterial({color:0x080907,transparent:true,opacity:.0,depthWrite:false,side:THREE.DoubleSide});
const occludeLeft=new THREE.Mesh(new THREE.PlaneGeometry(.34,2.3),occludeMat);occludeLeft.position.set(-.92,.02,-.64);directorOccluder.add(occludeLeft);
const occludeRight=new THREE.Mesh(new THREE.PlaneGeometry(.24,2.1),occludeMat.clone());occludeRight.material.opacity=0;occludeRight.position.set(.94,.02,-.72);directorOccluder.add(occludeRight);
const cameraDirector={timer:0,cooldown:0,active:false,side:1,phase:0,roll:0};
const ambientNightColor=new THREE.Color(0x202b3d), ambientDayColor=new THREE.Color(0xb8c0b3);
const moonNightColor=new THREE.Color(0x53648c), moonDayColor=new THREE.Color(0xffd7aa);
function updateDayNight(dt,t) {
  const phase=((elapsed/265)+.72)%1;
  const sun=Math.max(0,Math.sin((phase-.20)*Math.PI*2)*.5+.5);
  const night=1-sun;dayNightBlend=night;
  const isOutside=currentZone==='road'||currentZone==='ruin';
  for(const z of Object.values(zones)){
    z.ambient.intensity=z.name==='road'||z.name==='ruin' ? .12+sun*.54 : z.name==='abattoir' ? .12+sun*.04 : .11+sun*.18;
    if(isOutside)z.ambient.color.lerpColors(ambientNightColor,ambientDayColor,sun);else z.ambient.color.setHex(0x77736a);
    z.moon.intensity=z.name==='road'||z.name==='ruin' ? .14+night*.48 : .22;
    if(isOutside)z.moon.color.lerpColors(moonNightColor,moonDayColor,sun);else z.moon.color.setHex(0xc0b49c);
  }
  if(isOutside){
    const dawn=new THREE.Color(0x777f80),day=new THREE.Color(0xb9beb5),nightCol=new THREE.Color(0x171e2c);
    const sky=new THREE.Color().lerpColors(nightCol,day,sun);
    if(sun<.24)sky.lerp(dawn,Math.sin((.24-sun)/.24*Math.PI)*.24);
    scene.background.copy(sky);if(scene.fog?.color)scene.fog.color.copy(sky);
    if(sun<.22&&lastDayAnnouncement!=='NIGHT'){lastDayAnnouncement='NIGHT';showToast('THE DAY HAS LEFT THE CANAL.');}
    else if(sun>.72&&lastDayAnnouncement!=='DAWN'){lastDayAnnouncement='DAWN';showToast('THE LIGHT RETURNS WITHOUT THE SUN.');}
  }
  audio?.setDayNight(night);
  const wind=.5+Math.sin(t*.00013)*.5;
  for(const tree of windTrees){if(!tree.parent)continue;const a=Math.sin(t*.0007+tree.userData.windPhase)*(.008+wind*.018);tree.rotation.z=a;tree.rotation.x=Math.cos(t*.00053+tree.userData.windPhase)*.012;}
  for(const plant of cropPlants){if(!plant.parent)continue;const sway=Math.sin(t*.0011+plant.userData.windPhase)*plant.userData.windBase;plant.rotation.z=sway;plant.userData.leaves.forEach((leaf,i)=>{leaf.rotation.z=(i%2?1:-1)*(.5+sway);});}
  for(const leaf of leafSpecks){leaf.position.x+=Math.sin(t*.0003+leaf.position.z)*dt*.09;leaf.position.z+=Math.cos(t*.00025+leaf.position.x)*dt*.06;}
}
function updateWeather(dt,t){
  const p=currentPosition();const outdoors=currentZone==='road'||currentZone==='ruin';rainPoints.visible=outdoors;rainStreaks.visible=outdoors;
  if(outdoors){rainPoints.position.set(p.x,0,p.z);const a=rainGeometry.attributes.position.array;
    for(let i=0;i<rainCount;i++){const ix=i*3;a[ix+1]-=dt*(9+Math.sin(i)*2);a[ix]-=dt*.6;if(a[ix+1]<.3){a[ix+1]=12+Math.random()*5;a[ix]=(Math.random()-.5)*32;a[ix+2]=(Math.random()-.5)*32;}}rainGeometry.attributes.position.needsUpdate=true;
    for(let i=0;i<260;i++){const x=(Math.random()-.5)*30,z=(Math.random()-.5)*30,y=Math.random()*13;rainStreakArray[i*6]=x;rainStreakArray[i*6+1]=y;rainStreakArray[i*6+2]=z;rainStreakArray[i*6+3]=x-.08;rainStreakArray[i*6+4]=y-.42;rainStreakArray[i*6+5]=z;}rainStreakGeometry.attributes.position.needsUpdate=true;rainStreaks.position.set(p.x,0,p.z);
  }
  weatherState.nextLightning-=dt;if(weatherState.nextLightning<=0&&outdoors){weatherState.lightning=.18;weatherState.nextLightning=38+Math.random()*55;glitchPulse=Math.max(glitchPulse,.7);}
  if(weatherState.lightning>0){weatherState.lightning-=dt;const flash=weatherState.lightning>0?Math.sin(Math.PI*(weatherState.lightning/.18))*1.4:0;const amb=zone?.ambient;if(amb)amb.intensity=.18+flash;}
  if(zone?.mist)zone.mist.rotation.y=Math.sin(t*.00007)*.012;
}
function updateCameraDirector(dt,t){
  cameraDirector.cooldown=Math.max(0,cameraDirector.cooldown-dt);
  const p=currentPosition();
  // Narrow thresholds and furniture can briefly force an over-shoulder, obstructed framing.
  const cover = (currentZone==='home'&&(Math.abs(p.x+3.2)<1.35||Math.abs(p.x-4.8)<1.1)) ||
    (currentZone==='church'&&Math.abs(Math.abs(p.x)-3.5)<.8&&p.z<7&&p.z>-11) ||
    (currentZone==='ruin'&&p.z<-2.8&&Math.abs(p.x+2.1)<1.2) ||
    (currentZone==='cellar'&&Math.abs(p.x)<1.1&&p.z<1.2&&p.z>-3.5) ||
    (currentZone==='abattoir'&&Math.abs(p.x)<3.8&&p.z<-3.5);
  if(!dialogueOpen&&!journalOpen&&!cameraDirector.active&&cameraDirector.cooldown<=0&&((cover&&Math.random()<.012)|| (fear>.38&&elapsed>24&&Math.random()<.0009))){
    cameraDirector.active=true;cameraDirector.timer=1.35+Math.random()*1.7;cameraDirector.side=Math.random()<.5?-1:1;cameraDirector.phase=0;cameraDirector.roll=(Math.random()-.5)*.035;
    showToast('THE RECORDING IS NOT BEHIND YOUR EYES.');
  }
  if(cameraDirector.active){cameraDirector.timer-=dt;cameraDirector.phase=Math.min(1,cameraDirector.phase+dt*1.7);const fade=cameraDirector.timer<.7?Math.max(0,cameraDirector.timer/.7):1;const pull=cameraDirector.phase*fade;
    const desiredZ=2.1*pull, desiredX=cameraDirector.side*.34*pull;
    camera.position.x+= (desiredX-camera.position.x)*Math.min(1,dt*4.5);camera.position.z+=(desiredZ-camera.position.z)*Math.min(1,dt*4.2);
    camera.rotation.z+=(cameraDirector.roll*pull-camera.rotation.z)*Math.min(1,dt*3.5);
    playerRig.visible=pull>.18;occludeMat.opacity=.68*pull;occludeRight.material.opacity=.46*pull;
    if(cameraDirector.timer<=0){cameraDirector.active=false;cameraDirector.cooldown=30+Math.random()*28;}
  }else{
    camera.position.x+=(0-camera.position.x)*Math.min(1,dt*3.5);camera.position.z+=(0-camera.position.z)*Math.min(1,dt*3.5);camera.rotation.z+=(0-camera.rotation.z)*Math.min(1,dt*2.5);
    playerRig.visible=false;occludeMat.opacity+=(0-occludeMat.opacity)*Math.min(1,dt*4);occludeRight.material.opacity+=(0-occludeRight.material.opacity)*Math.min(1,dt*4);
  }
  // Unstable handheld drift remains present even when the hidden camera is inactive.
  camera.rotation.z+=Math.sin(t*.00083)*.0007*(1+fear*2);
}

// -----------------------------------------------------------------------------
// Player, flashlight and target selection
// -----------------------------------------------------------------------------
const flashlight = new THREE.SpotLight(0xe4e3d6, 4.6, 25, Math.PI / 7.5, .48, 1.35);
flashlight.position.set(0, 0, 0); flashlight.target.position.set(0, 0, -8); flashlight.castShadow = true; flashlight.shadow.mapSize.set(512, 512);
camera.add(flashlight); camera.add(flashlight.target);
const fillFlash = new THREE.PointLight(0xe3e2d9, .25, 4); fillFlash.position.set(0, -.2, -.3); camera.add(fillFlash);
function toggleFlashlight() { flashlightOn = !flashlightOn; flashlight.visible = flashlightOn; fillFlash.visible = flashlightOn; $('torch-state').textContent = flashlightOn ? 'ON' : 'OFF'; audio.stinger(.18); }
function findTarget() {
  if (!zone || !playerInputEnabled()) return null;
  controls.getDirection(forward); camera.getWorldPosition(cameraWorld);
  let best = null; let bestScore = Infinity;
  for (const item of zone.interactables) {
    if (!item.object || !item.object.parent) continue;
    const p = item.point || item.object.position; targetVec.set(p.x, p.y + (item.type === 'npc' ? 1.15 : .25), p.z);
    const dist = cameraWorld.distanceTo(targetVec); if (dist > (item.radius || 3.0)) continue;
    const dir = targetVec.clone().sub(cameraWorld).normalize(); const dot = forward.dot(dir);
    if (dot < .58) continue;
    const score = dist + (1 - dot) * 2.1;
    if (score < bestScore) { bestScore = score; best = item; }
  }
  return best;
}
function updatePlayer(dt) {
  if (!playerInputEnabled()) return;
  const sprinting=keys.has('ShiftLeft') || keys.has('ShiftRight'); const speed = sprinting ? 5.3 : 3.15; if(sprinting&&wishVec.lengthSq()>.1)fear=Math.min(1,fear+dt*.012);
  const f = hiddenBreath ? 0 : ((keys.has('KeyW') || keys.has('ArrowUp')) ? 1 : 0) - ((keys.has('KeyS') || keys.has('ArrowDown')) ? 1 : 0);
  const s = hiddenBreath ? 0 : ((keys.has('KeyD') || keys.has('ArrowRight')) ? 1 : 0) - ((keys.has('KeyA') || keys.has('ArrowLeft')) ? 1 : 0);
  controls.getDirection(forward); forward.y = 0; forward.normalize();
  rightVec.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  wishVec.set(0, 0, 0).addScaledVector(forward, f).addScaledVector(rightVec, s);
  if (wishVec.lengthSq() > 1) wishVec.normalize();
  velocity.x += (wishVec.x * speed - velocity.x) * Math.min(1, dt * 7.5);
  velocity.z += (wishVec.z * speed - velocity.z) * Math.min(1, dt * 7.5);
  if (wishVec.lengthSq() === 0) { velocity.x *= Math.max(0, 1 - dt * 5); velocity.z *= Math.max(0, 1 - dt * 5); }
  const p = currentPosition(); const nx = p.x + velocity.x * dt; const nz = p.z + velocity.z * dt;
  const b = zone.bounds; const r = .34;
  const collides = (x, z) => zone.solids.some(o => x + r > o.minX && x - r < o.maxX && z + r > o.minZ && z - r < o.maxZ);
  if (nx >= b.minX && nx <= b.maxX && !collides(nx, p.z)) p.x = nx; else velocity.x = 0;
  if (nz >= b.minZ && nz <= b.maxZ && !collides(p.x, nz)) p.z = nz; else velocity.z = 0;
  const moving = Math.abs(velocity.x) + Math.abs(velocity.z) > .5;
  camera.position.y = 1.63 + (moving ? Math.sin(elapsed * 9.2) * .023 : Math.sin(elapsed * 1.4) * .006);
}
function updateTargets() {
  activeTarget = findTarget();
  const prompt = $('prompt'); const cross = $('center-mark');
  if (activeTarget) { prompt.textContent = activeTarget.prompt; prompt.classList.add('visible'); cross.classList.add('targeted'); }
  else { prompt.classList.remove('visible'); cross.classList.remove('targeted'); }
}

// -----------------------------------------------------------------------------
// Input and interface
// -----------------------------------------------------------------------------
function requestMouseLock() {
  // Browsers with strict privacy/input policies may reject pointer lock. That must
  // not disable keyboard movement; the game has a click-and-drag look fallback.
  try {
    const result = controls.lock();
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch (_) {
    showToast('MOUSE FREE — WASD IS ACTIVE, DRAG TO LOOK.');
  }
}
function startGame() {
  if (gameStarted) return;
  gameStarted = true;
  keys.clear();
  $('start-screen').classList.remove('active');
  enterZone('road', [0, 0, 29]);
  $('hud').classList.remove('hidden-hud');
  audio.start().catch(() => {});
  requestMouseLock();
}
$('start-button').addEventListener('click', startGame);
$('journal-button').addEventListener('click', openJournal);
$('journal-close').addEventListener('click', closeJournal);
$('sound-button').addEventListener('click', () => audio.toggle());
$('return-button').addEventListener('click', () => location.reload());
$('retry-button').addEventListener('click',()=>location.reload());
$('ending-fill').addEventListener('click',()=>resolveEnding('fill'));
$('ending-expose').addEventListener('click',()=>resolveEnding('expose'));
$('ending-preserve').addEventListener('click',()=>resolveEnding('preserve'));
controls.addEventListener('unlock', () => {
  fallbackLookDragging = false;
  if (gameStarted && !dialogueOpen && !journalOpen && !gameEnded) $('prompt').classList.remove('visible');
});
document.addEventListener('pointerlockerror', () => {
  if (playerInputEnabled()) showToast('MOUSE LOCK UNAVAILABLE — WASD IS ACTIVE, DRAG TO LOOK.');
});

const movementCodes = new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight']);
window.addEventListener('keydown', (e) => {
  if (playerInputEnabled() && movementCodes.has(e.code)) e.preventDefault();
  keys.add(e.code);
  if(e.code==='KeyZ'&&!e.repeat&&playerInputEnabled()&&activeTarget){
    e32.zoom=true;$('inspect-hint')?.classList.add('visible');
    e32Toast('CLOSE INSPECTION. THE IMAGE WILL NOT HOLD STILL.');
  }
  if(e.code==='KeyX'&&!e.repeat){
    e32.zoom=false;$('inspect-hint')?.classList.remove('visible');
  }
  if (e.code === 'KeyF' && !e.repeat && playerInputEnabled()) toggleFlashlight();
  if(e.code==='KeyQ' && playerInputEnabled() && !e.repeat){hiddenBreath=true;showToast('HOLD YOUR BREATH. DO NOT MOVE.');}
  if (e.code === 'KeyM' && !e.repeat) audio.toggle();
  if (e.code === 'Tab' && !e.repeat && !listeningPending) { e.preventDefault(); journalOpen ? closeJournal() : openJournal(); }
  if (e.code === 'KeyE' && playerInputEnabled() && activeTarget) inspectTarget(activeTarget);
  if (dialogueOpen && (e.code === 'Digit1' || e.code === 'Digit2')) $('dialogue-options').querySelectorAll('button')[Number(e.code.slice(-1)) - 1]?.click();
  if (dialogueOpen && e.code === 'Escape') closeDialogue();
});
window.addEventListener('keyup', e => {keys.delete(e.code);if(e.code==='KeyQ')hiddenBreath=false;});
window.addEventListener('blur', () => { keys.clear(); hiddenBreath = false; fallbackLookDragging = false; });

// Mouse-look fallback: hold the mouse button and drag over the scene if the
// browser refuses Pointer Lock. Keyboard movement works with or without it.
let fallbackLookDragging = false;
let fallbackPointerX = 0;
let fallbackPointerY = 0;
canvas.addEventListener('pointerdown', (e) => {
  if (!playerInputEnabled() || controls.isLocked) return;
  fallbackLookDragging = true;
  fallbackPointerX = e.clientX;
  fallbackPointerY = e.clientY;
  try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
});
window.addEventListener('pointermove', (e) => {
  if (!fallbackLookDragging || controls.isLocked || !playerInputEnabled()) return;
  const dx = e.clientX - fallbackPointerX;
  const dy = e.clientY - fallbackPointerY;
  fallbackPointerX = e.clientX;
  fallbackPointerY = e.clientY;
  camera.rotation.order = 'YXZ';
  camera.rotation.y -= dx * 0.0024;
  camera.rotation.x -= dy * 0.0024;
  camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x, -Math.PI / 2 + 0.04, Math.PI / 2 - 0.04);
});
window.addEventListener('pointerup', () => { fallbackLookDragging = false; });
window.addEventListener('pointercancel', () => { fallbackLookDragging = false; });
canvas.addEventListener('click', () => {
  if (playerInputEnabled() && !controls.isLocked) requestMouseLock();
});
canvas.addEventListener('contextmenu', (e) => { if (gameStarted) e.preventDefault(); });

// -----------------------------------------------------------------------------
// Ambient motion and render loop
// -----------------------------------------------------------------------------
function animateZone(t, dt) {
  rotatingMachines.forEach(m=>{if(m.piston){m.mesh.position.y=.75+Math.sin(t*.001*m.speed)*.11;}else m.mesh.rotation.z+=dt*m.speed;});
  zones.abattoir?.carcasses?.forEach(c=>{c.rotation.z=Math.sin(t*.00062+c.userData.hangPhase)*.035;c.rotation.x=Math.cos(t*.00047+c.userData.hangPhase)*.018;});
  for (const z of Object.values(zones)) {
    if (!z.group.visible) continue;
    if (z.mist) z.mist.children.forEach((s, i) => {
      s.position.x += Math.sin(t * .00021 + s.userData.phase) * dt * .20;
      s.position.z += Math.cos(t * .00017 + s.userData.phase * 1.3) * dt * .13;
      s.material.opacity = (.07 + dread * .07) * (z.name === 'cellar' ? .55 : 1);
    });
    [...new Set([...z.interactables.filter(x => x.type === 'npc'),...cultRoster.filter(n=>n.object.parent===z.group)])].forEach(n => {
      const phase=t*.0011+n.phase, stride=n.walking?Math.sin(t*.008+n.phase):Math.sin(phase)*.035;
      const bob=n.walking?Math.abs(Math.sin(t*.008+n.phase))*.035:Math.sin(phase)*.009;
      n.object.position.y = n.fate==='dead'?n.object.position.y:bob;
      n.leftArm.rotation.z = -.13 + stride*.46 + Math.sin(phase)*.018;
      n.rightArm.rotation.z = .13 - stride*.46 - Math.sin(phase)*.018;
      n.leftForearm.rotation.z=-.24+stride*.25;n.rightForearm.rotation.z=.24-stride*.25;
      if(n.legs?.length===2){n.legs[0].rotation.x=stride*.52;n.legs[1].rotation.x=-stride*.52;n.shoes?.forEach((shoe,i)=>{shoe.rotation.x=i===0?stride*.52:-stride*.52;});}
      n.blinkTimer-=dt;if(n.blinkTimer<=0){n.blinkAmount=Math.min(1,n.blinkAmount+dt*15);if(n.blinkAmount>=1){n.blinkTimer=.12;n.blinkAmount=Math.max(0,n.blinkAmount-dt*15);}if(n.blinkAmount===0)n.blinkTimer=2.4+Math.random()*4.8;}
      n.lids?.forEach(lid=>{lid.scale.y=.08+n.blinkAmount*.72;lid.position.y=1.783-n.blinkAmount*.004;});
      if(n.photoBody.visible)n.photoBody.material.opacity=.70+Math.sin(t*.00065+n.phase)*.06;
    });
  }
}
function triggerDeath(reason='THE ROOM HAS FOUND YOU') {
  if(gameEnded)return;gameEnded=true;controls.unlock();keys.clear();$('hud').classList.add('hidden-hud');$('death-title').textContent=reason;$('death-copy').textContent='The recording continues for eleven seconds after the body has stopped.';$('death-screen').classList.add('active');audio?.killSting();
}
function updateHorror(dt,t){
  if(!gameStarted||gameEnded||!zone||dialogueOpen||journalOpen)return;
  eventClock+=dt;const p=currentPosition();
  // Fear rises in darkness and falls slowly in lit, occupied rooms.
  const darkFactor=flashlightOn?0.0:.022;const zoneFactor=currentZone==='cellar'?.014:currentZone==='abattoir'?.018:currentZone==='ruin'?.009:0;
  fear=Math.min(1,Math.max(.04,fear+(darkFactor+zoneFactor-.002)*dt));
  // Brief, mischievous anomalies: the room seems to answer from the wrong side.
  if(fear>.52&&eventClock>26&&Math.random()<.00075){glitchPulse=Math.max(glitchPulse,.65);audio?.mechanicalEvent('clock');showToast('THIRTEEN BREATHS. ONE IS OUT OF TIME.');}
  if(fear>.995&&currentZone==='abattoir'){triggerDeath('THE ROOM HAS TAKEN YOUR BODY.');return;}
  if(fear>.88&&Math.random()<.0012){glitchPulse=1.15;audio?.stinger(.9);$('event-flash').classList.add('active');setTimeout(()=>$('event-flash').classList.remove('active'),130);}
  if(hiddenBreath){fear=Math.max(.08,fear-.075*dt);}
  $('fear-value').textContent=`${Math.round(fear*100)}%`;
}

function updateHud(dt) {
  elapsed += dt; const mins = Math.floor(elapsed / 60); const secs = Math.floor(elapsed % 60); const frames = Math.floor((elapsed % 1) * 25);
  $('tape-counter').textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
  const signal = Math.max(8, Math.round(94 - dread * 42 - Math.sin(elapsed * .31) * 4 - glitchPulse * 17));
  $('signal-value').textContent = `${signal}%`;
  $('clock').textContent = `03:${String(17 + Math.floor(elapsed / 90)).padStart(2, '0')}`;
  $('coords').textContent = currentZone === 'road' ? '45° 02′ N — 10° 41′ E' : ({ home: '45° 02′ N — 10° 41′ E', church: '45° 02′ N — 10° 41′ E', ruin: '45° 02′ N — 10° 41′ E', cellar: '45° 02′ N — 10° 41′ E', abattoir: '45° 02′ N — 10° 41′ E' })[currentZone];
}
let previousTargetId = '';
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), .04); const t = performance.now();
  if (gameStarted && !gameEnded) {
    updatePlayer(dt); updateTargets(); animateZone(t, dt); updateCultSequence(dt,t);
    if(listeningPending && !cultFateActive && cultFateQueue.length===0) finishListening();
    if(!gameEnded){updateHorror(dt,t);updateDayNight(dt,t);updateWeather(dt,t);updateCameraDirector(dt,t);updateHud(dt);}
    if (activeTarget?.id !== previousTargetId && activeTarget) audio.stinger(.07);
    previousTargetId = activeTarget?.id || '';
  }
  dread = Math.min(1, .12 + collected.size * .11 + fear*.36 + (currentZone === 'cellar' ? .22 : 0));
  if (zone) { scene.fog.density += (zone.density + dread * .012 - scene.fog.density) * Math.min(1, dt * .8); }
  audio.setTension(dread);
  glitchPulse = Math.max(0, glitchPulse - dt * 1.45);
  glitchPass.uniforms.time.value = t * .001;
  glitchPass.uniforms.strength.value = .10 + dread * .13 + glitchPulse * .5;
  bloom.strength = .24 + dread * .15; bloom.threshold = .78 - dread * .12;
  composer.render();
}
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
});
window.addEventListener('error', e => { const f = $('fatal'); f.textContent = `ERRORE DI SISTEMA\n${e.message}\n${e.filename || ''}:${e.lineno || ''}`; f.classList.remove('hidden'); });
window.addEventListener('unhandledrejection', e => { const f = $('fatal'); f.textContent = `ERRORE DI SISTEMA\n${e.reason?.stack || e.reason}`; f.classList.remove('hidden'); });
updateProgress();
requestAnimationFrame(loop);


// =============================================================================
// EPISTASSI 3.2 — THE BACON DIRECTOR
// Additional story missions, a stalking presence, practical light, scene windows,
// point inspection and consequence-aware endings. Appended to preserve the base
// Thirteen Cut systems while extending their existing world and story state.
// =============================================================================
const e32 = {
  zoom:false, zoomValue:72, enemyDistance:22, enemyApproach:0, enemyFootClock:0, enemyZone:null, enemyPositioned:false,
  windowClock:0, windowScene:null, practicals:[], questLast:'', speechToken:0,
  digStep:0, missionLog:new Set()
};
const e32Quest = {
  shovel:false, grave:false, crank:false, pump:false, vent:false,
  windowHome:false, windowRuin:false
};
function e32Journal(id,title,description,kind='verbale') {
  if (journal.some(item=>item.id===id)) return;
  journal.push({id,title,description,kind,zone:currentZone});
  updateJournalCount();
}
function e32Toast(text) { showToast(text); audio?.stinger(.32); }
function e32QuestText() {
  if (!e32Quest.shovel) return '01 — ABANDONED HOUSE: recupera la vanga sotto il tavolo da lavoro.';
  if (!e32Quest.grave) return '01 — CIMITERO: scava la tomba di Elena Bassi (1977).';
  if (!e32Quest.crank) return '02 — CHIESA: trova la manovella dell’organo.';
  if (!e32Quest.pump) return '02 — CANAL: fit the crank to the pump and stop it.';
  if (!e32Quest.vent) return '03 — CHURCH: open the blocked duct using what you have found.';
  return 'THE THREE PIECES OF EVIDENCE ARE TOGETHER. Return to the farmhouse. No explanation is innocent.';
}
function e32UpdateQuestHud() {
  const line=$('mission-line'), count=$('mission-count');
  if (line) line.textContent=e32QuestText();
  if (count) count.textContent=[e32Quest.grave,e32Quest.pump,e32Quest.vent].filter(Boolean).length+'/3';
}
function e32AddPractical(z,x,y,zz,color=0xffa75e,intensity=.85,range=6) {
  const holder=new THREE.Group();holder.position.set(x,y,zz);z.group.add(holder);
  const stem=new THREE.Mesh(new THREE.CylinderGeometry(.035,.045,.24,8),M.darkWood);stem.position.y=-.09;holder.add(stem);
  const flame=new THREE.Mesh(new THREE.SphereGeometry(.065,9,7),new THREE.MeshBasicMaterial({color:0xffbd70,transparent:true,opacity:.88}));
  flame.scale.set(.62,1.75,.62);flame.position.y=.075;holder.add(flame);
  const halo=new THREE.Mesh(new THREE.SphereGeometry(.18,9,7),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.12,depthWrite:false}));
  halo.position.copy(flame.position);holder.add(halo);
  const light=new THREE.PointLight(color,intensity,range,1.65);light.position.set(0,.16,0);light.castShadow=false;holder.add(light);
  e32.practicals.push({light,flame,halo,phase:Math.random()*9,base:intensity});
  return holder;
}
function e32BaconCage(npc,index) {
  if(!npc?.object||npc.object.userData.e32Caged)return;
  npc.object.userData.e32Caged=true;
  const root=npc.object;
  const head=root.children.find(o=>o.isMesh&&o.geometry?.type==='SphereGeometry');
  if(head){head.scale.set(.72+(.06*(index%3)),1.48,.76);head.position.x+=(index%2?-.055:.04);head.position.y+=.055;}
  if(npc.coat){npc.coat.scale.set(1.18+(index%3)*.06,1.12,.78);npc.coat.rotation.z+=(index%2?.09:-.07);}
  if(npc.leftArm){npc.leftArm.scale.y=1.26;npc.leftArm.position.x-=.055;}
  if(npc.rightArm){npc.rightArm.scale.y=1.38;npc.rightArm.position.x+=.045;}
  if(npc.photoFace){npc.photoFace.scale.y*=1.24;npc.photoFace.rotation.z+=(index%2?.07:-.09);}
  const cage=new THREE.Group();cage.position.set(0,1.15,-.035);root.add(cage);
  const wire=new THREE.MeshStandardMaterial({color:index%3===0?0x6e2520:0x725d4d,metalness:.48,roughness:.72,transparent:true,opacity:.72});
  for(let i=0;i<3;i++){
    const ring=new THREE.Mesh(new THREE.TorusGeometry(.37+i*.075,.012,5,32),wire);
    ring.scale.set(.78,1.85,.72);ring.rotation.y=i*.42-.42;ring.rotation.z=(i-1)*.14;cage.add(ring);
  }
  const cross=new THREE.Mesh(new THREE.TorusGeometry(.46,.014,5,32),wire);
  cross.rotation.x=Math.PI/2;cross.rotation.z=.18;cage.add(cross);
  for(const x of [-.29,.29]){
    const bar=new THREE.Mesh(new THREE.CylinderGeometry(.012,.018,.94,5),wire);
    bar.position.set(x,.05,0);bar.rotation.z=x<0?-.11:.17;cage.add(bar);
  }
  npc.baconCage=cage;
}
function e32BaconRoom(z,x=0,zz=0) {
  const frame=new THREE.Group();frame.position.set(x,0,zz);z.group.add(frame);
  const red=new THREE.MeshStandardMaterial({color:0x60211f,roughness:.78,metalness:.22});
  for(const side of [-1,1]){
    const post=new THREE.Mesh(new THREE.BoxGeometry(.13,4.5,.18),red);post.position.set(side*2.1,2.15,0);frame.add(post);
    const diagonal=new THREE.Mesh(new THREE.BoxGeometry(.09,4.15,.11),red);diagonal.position.set(side*1.05,2.1,.03);diagonal.rotation.z=side*.43;frame.add(diagonal);
  }
  const top=new THREE.Mesh(new THREE.BoxGeometry(4.4,.13,.18),red);top.position.set(0,4.37,0);frame.add(top);
  const ellipse=new THREE.Mesh(new THREE.TorusGeometry(1.35,.026,6,48),red);ellipse.position.set(0,2.28,.12);ellipse.scale.set(.72,1.5,1);frame.add(ellipse);
  return frame;
}
function e32Window(z,id,x,y,zz,rotY=0) {
  const frame=new THREE.Group();frame.position.set(x,y,zz);frame.rotation.y=rotY;z.group.add(frame);
  const darkGlass=new THREE.Mesh(new THREE.PlaneGeometry(1.72,1.66),new THREE.MeshBasicMaterial({color:0x090e0f,transparent:true,opacity:.88,side:THREE.DoubleSide}));
  frame.add(darkGlass);
  const glassFog=new THREE.Mesh(new THREE.PlaneGeometry(1.58,1.52),new THREE.MeshBasicMaterial({color:0x718080,transparent:true,opacity:.12,side:THREE.DoubleSide,depthWrite:false}));glassFog.position.z=.012;frame.add(glassFog);
  for(const xx of [-.91,.91]){const post=new THREE.Mesh(new THREE.BoxGeometry(.11,1.85,.13),M.darkWood);post.position.x=xx;frame.add(post);}
  for(const yy of [-.9,.9]){const rail=new THREE.Mesh(new THREE.BoxGeometry(1.92,.11,.13),M.darkWood);rail.position.y=yy;frame.add(rail);}
  const apparition=new THREE.Group();apparition.position.set(0,-.68,-.09);frame.add(apparition);
  const black=new THREE.MeshBasicMaterial({color:0x030303});
  const torso=new THREE.Mesh(new THREE.CapsuleGeometry(.23,.77,5,8),black);torso.position.y=.7;torso.scale.set(.72,1.28,.55);apparition.add(torso);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.19,12,9),new THREE.MeshBasicMaterial({color:0x140e0d}));head.scale.set(.55,1.48,.62);head.position.set(.04,1.5,0);apparition.add(head);
  for(const side of [-1,1]){const limb=new THREE.Mesh(new THREE.CapsuleGeometry(.052,.73,4,7),black);limb.position.set(side*.37,.68,.015);limb.rotation.z=side*.2;apparition.add(limb);}
  apparition.visible=false;
  const marker=new THREE.Mesh(new THREE.SphereGeometry(.11,8,6),new THREE.MeshBasicMaterial({color:0x8e3029,transparent:true,opacity:.26}));
  marker.position.set(x,y-1.1,zz+(rotY===0?.65:0));z.group.add(marker);
  const event={id:'e32_window_'+id,type:'event',object:marker,point:marker.position,radius:3.3,prompt:'[ E ] LOOK THROUGH THE GLASS',run:()=>{
    if(id==='home')e32Quest.windowHome=true;else e32Quest.windowRuin=true;
    storyFlags.add('window-witnessed');e32.windowScene={group:apparition,frame,elapsed:0,id};
    apparition.visible=true;apparition.position.x=-.34;
    audio?.mechanicalEvent('glass');audio?.mechanicalTone(64,38,2.4,'sawtooth',.065);
    speakVoice(id==='home'?'On the other side of the window, someone sets a table for thirteen. One chair faces the glass.':'The woman behind the glass does not move. Her reflection, however, walks away.',id==='home'?'THE FARMHOUSE':'THE WIDOW');
    fear=Math.min(1,fear+.13);glitchPulse=1.1;e32UpdateQuestHud();
  }};
  z.interactables.push(event);
  return {frame,apparition,event};
}
function e32BuildGraveyard() {
  const z=newZone('graveyard',0x202622,.028,{minX:-11,maxX:11,minZ:-10,maxZ:10},[0,0,7.1]);
  addBox(z.group,0,-.12,0,22,.24,20,mat(0x343b31,1,{map:TEX.concrete}));
  // Old brick cemetery wall and a gate which opens inward onto the same field.
  for(const side of [-1,1])addBox(z.group,side*10.8,1.35,0,.35,2.7,20,M.brick);
  addBox(z.group,0,1.35,-9.8,22,2.7,.35,M.brick);
  addBox(z.group,-7,1.35,9.8,8,2.7,.35,M.brick);addBox(z.group,7,1.35,9.8,8,2.7,.35,M.brick);
  for(let i=0;i<11;i++){
    const x=-8.5+(i%4)*5.5,zz=-6.4+Math.floor(i/4)*4.8;
    const stone=new THREE.Mesh(new THREE.BoxGeometry(.72,1.05,.18),mat(i%3===0?0x514d45:0x66665b,1,{map:TEX.concrete}));
    stone.position.set(x,.53,zz);stone.rotation.z=(Math.random()-.5)*.09;z.group.add(stone);
    const cross=new THREE.Mesh(new THREE.BoxGeometry(.07,.48,.055),M.rust);cross.position.set(x,.66,zz+.11);z.group.add(cross);
    const line=new THREE.Mesh(new THREE.BoxGeometry(.32,.018,.025),M.gold);line.position.set(x,.46,zz+.12);z.group.add(line);
  }
  // Elena's mound, coffin and folded sheet are hidden until the third dig action.
  const mound=new THREE.Mesh(new THREE.SphereGeometry(1,18,12),mat(0x292d25,1,{map:TEX.concrete,bumpScale:.18}));
  mound.scale.set(1.85,.38,1.2);mound.position.set(0,.22,-2.5);z.group.add(mound);
  const openedEarth=new THREE.Mesh(new THREE.BoxGeometry(1.95,.06,2.45),mat(0x151713,1,{map:TEX.rust}));openedEarth.position.set(0,.045,-2.5);openedEarth.visible=false;z.group.add(openedEarth);
  const coffin=new THREE.Group();coffin.position.set(0,-.14,-2.5);coffin.visible=false;z.group.add(coffin);
  addBox(coffin,0,.12,0,1.18,.22,2.08,M.darkWood);
  const lid=addBox(coffin,0,.28,-.03,1.3,.12,2.18,M.wood);
  lid.rotation.x=-.08;
  const foldedSheet=new THREE.Mesh(new THREE.PlaneGeometry(.74,.82),new THREE.MeshStandardMaterial({color:0xb4aa94,roughness:1,transparent:true,opacity:.72,side:THREE.DoubleSide}));
  foldedSheet.position.set(0,.39,-.08);coffin.add(foldedSheet);
  const headstone=new THREE.Mesh(new THREE.BoxGeometry(1.65,1.15,.22),M.darkWood);headstone.position.set(0,.58,-4.0);z.group.add(headstone);
  const graveText=new THREE.Mesh(new THREE.PlaneGeometry(1.36,.6),new THREE.MeshBasicMaterial({map:makeLabelTexture('ELENA BASSI\n1977 / 03:17',512,256),transparent:true}));
  graveText.position.set(0,.72,-3.875);z.group.add(graveText);
  const marker=new THREE.Mesh(new THREE.SphereGeometry(.14,10,8),M.gold);marker.position.set(0,.24,-2.5);z.group.add(marker);
  const digEvent={id:'e32_dig_grave',type:'event',repeatable:true,object:marker,point:marker.position,radius:3.4,prompt:'[ E ] SCAVA — ELENA BASSI',run:()=>{
    if(!e32Quest.shovel){e32Toast('YOU NEED A SPADE. THE GROUND WILL NOT YIELD TO BARE HANDS.');return;}
    e32.digStep++;audio?.mechanicalEvent('scrape');audio?.mechanicalNoise(.5,420,1.3,.12,.12);fear=Math.min(1,fear+.045);glitchPulse=Math.max(glitchPulse,.24);
    if(e32.digStep===1){mound.scale.y=.31;showToast('THE EARTH IS SOFTER BENEATH THE SURFACE. (1/3)');}
    if(e32.digStep===2){mound.scale.set(1.55,.19,1.0);openedEarth.visible=true;showToast('THE WOOD IS STILL DRY. (2/3)');}
    if(e32.digStep>=3){
      digEvent.repeatable=false;coffin.visible=true;lid.rotation.x=-.72;lid.position.y=.39;
      const hand=new THREE.Mesh(new THREE.CapsuleGeometry(.07,.55,5,8),mat(0x8a7968,1));hand.position.set(.34,.49,.45);hand.rotation.z=-.82;coffin.add(hand);
      storyFlags.add('grave-proof');e32Quest.grave=true;
      e32Journal('grave-elena','Elena Bassi's medical file','The report records carbon monoxide asphyxiation. It was folded around a tuning fork: A=415. On the back, in pencil: “the choir never heard anything.”','referto');
      speakVoice('Elena Bassi. No injuries. No recorded sound. The death was certified before the tape began to turn.','ELENA / 1977');
      e32Toast('THE GRAVE DOES NOT CONTAIN A BODY. IT CONTAINS AN EXPLANATION.');
      zone.interactables.splice(zone.interactables.indexOf(digEvent),1);
      marker.visible=false;audio?.killSting();glitchPulse=1.25;
    }
    e32UpdateQuestHud();
  }};
  z.interactables.push(digEvent);
  e32AddPractical(z,-8,1.8,7.8,0xd08b4d,.95,9);e32AddPractical(z,8,1.8,7.8,0xd08b4d,.95,9);
  const gate=addDoor(z.group,0,9.45,'the field','road',[47,0,16]);
  gate.prompt='[ E ] RETURN TO THE FIELD';
  z.mist=addFog(z.group,22,24,0x899086,142);
  z.solids.push(
    {minX:-11,maxX:-10.6,minZ:-10,maxZ:10},{minX:10.6,maxX:11,minZ:-10,maxZ:10},
    {minX:-11,maxX:11,minZ:-10,maxZ:-9.6},{minX:-11,maxX:-4,minZ:9.6,maxZ:10},
    {minX:4,maxX:11,minZ:9.6,maxZ:10}
  );
  z.graveMound=mound;
  return z;
}
// Build new connected spaces and mission objects only after the original world exists.
const e32Graveyard=e32BuildGraveyard();
const e32GraveDoor=addDoor(zones.road.group,51,19,'il cimitero senza data','graveyard',[0,0,7.1]);
e32GraveDoor.prompt='[ E ] ENTER — THE UNDATED CEMETERY';
addManifesto(zones.road.group,[55,1.8,22],[0,Math.PI/2,0],'QUI RIPOSA\nIL GIORNO','NO DATE OF DEPARTURE');
e32AddPractical(zones.home,-4.7,1.4,2.4,0xff9b48,.6,5);
e32AddPractical(zones.home,6.6,1.4,-5.3,0xffae55,.7,6);
e32AddPractical(zones.church,-2.0,2.2,-11.2,0xff914e,.45,4.7);
e32AddPractical(zones.ruin,3.6,1.3,3.3,0x9eacaa,.55,5);
e32AddPractical(zones.abattoir,0,3.2,5.6,0xb84332,.65,7);
e32AddPractical(zones.cellar,-4.5,1.8,3.2,0xff9a45,.55,4.5);
e32BaconRoom(zones.abattoir,0, -5.9);
e32BaconRoom(zones.home,0, -5.4);
const e32HomeWindow=e32Window(zones.home,'home',-.2,1.85,-8.79,0);
const e32RuinWindow=e32Window(zones.ruin,'ruin',-7.79,1.9,-.8,Math.PI/2);
// Add asymmetric portrait cages to all thirteen and the principal non-cultist figures.
[...cultRoster,
  ...['road','church','ruin','abattoir','cellar'].flatMap(k=>zones[k].interactables.filter(i=>i.type==='npc'))
].forEach((npc,i)=>e32BaconCage(npc,i));
// The hidden antagonist: an elongated, caged silhouette that approaches from the
// space behind the player and withdraws when looked at directly.
const e32Enemy=new THREE.Group();e32Enemy.name='IL_QUATTORDICESIMO';
const e32EnemyMat=new THREE.MeshStandardMaterial({color:0x120f0e,roughness:1,metalness:.08});
const e32EnemyTorso=new THREE.Mesh(new THREE.CapsuleGeometry(.34,.98,7,12),e32EnemyMat);e32EnemyTorso.position.y=1.12;e32EnemyTorso.scale.set(.74,1.56,.72);e32Enemy.add(e32EnemyTorso);
const e32EnemyHead=new THREE.Mesh(new THREE.SphereGeometry(.24,18,14),new THREE.MeshStandardMaterial({color:0x28201c,roughness:1}));e32EnemyHead.position.set(.04,2.38,0);e32EnemyHead.scale.set(.62,1.72,.66);e32Enemy.add(e32EnemyHead);
for(const side of [-1,1]){
  const arm=new THREE.Mesh(new THREE.CapsuleGeometry(.085,.85,5,9),e32EnemyMat);arm.position.set(side*.48,1.26,.02);arm.rotation.z=side*.16;e32Enemy.add(arm);
  const hand=new THREE.Mesh(new THREE.SphereGeometry(.095,8,6),new THREE.MeshStandardMaterial({color:0x4d332b}));hand.position.set(side*.53,.62,.04);e32Enemy.add(hand);
  const leg=new THREE.Mesh(new THREE.CapsuleGeometry(.105,.82,5,8),e32EnemyMat);leg.position.set(side*.18,.2,0);e32Enemy.add(leg);
}
for(let i=0;i<3;i++){
  const cage=new THREE.Mesh(new THREE.TorusGeometry(.52+i*.09,.018,5,42),new THREE.MeshStandardMaterial({color:0x7c2c25,metalness:.52,roughness:.7}));
  cage.position.set(0,1.3+i*.26,-.08);cage.rotation.set(Math.PI/2+(i*.16),i*.32,.18-i*.16);cage.scale.set(.82,1.65,.72);e32Enemy.add(cage);
}
const e32EnemyGlow=new THREE.PointLight(0x9f2923,1.25,6,1.8);e32EnemyGlow.position.set(0,2.2,.2);e32Enemy.add(e32EnemyGlow);
e32Enemy.visible=false;scene.add(e32Enemy);
function e32UpdateEnemy(dt,t) {
  if(!gameStarted||gameEnded||listeningPending||!zone){e32Enemy.visible=false;e32.enemyApproach=0;e32.enemyPositioned=false;return;}
  controls.getDirection(forward);forward.y=0;forward.normalize();
  const p=currentPosition(),right=new THREE.Vector3(-forward.z,0,forward.x);
  if(!e32.enemyPositioned||e32.enemyZone!==currentZone){
    const spawn=p.clone().addScaledVector(forward,-18).addScaledVector(right,2.1);
    e32Enemy.position.set(spawn.x,0,spawn.z);
    e32.enemyZone=currentZone;e32.enemyPositioned=true;e32.enemyDistance=spawn.distanceTo(p);
  }
  const toPlayer=p.clone().sub(e32Enemy.position);toPlayer.y=0;
  const dist=toPlayer.length();
  const toward=toPlayer.lengthSq()>.001?toPlayer.normalize():new THREE.Vector3(0,0,1);
  const toEnemy=e32Enemy.position.clone().sub(p);toEnemy.y=0;
  const facing=toEnemy.lengthSq()>.001?forward.dot(toEnemy.normalize()):0;
  const storyPressure=Math.min(.28,collected.size*.035),fearPressure=fear*.42;
  const timePressure=Math.min(.22,elapsed/520);
  const roomPressure=['abattoir','cellar','graveyard'].includes(currentZone) ? .16 : 0;
  const pressure=THREE.MathUtils.clamp(.10+storyPressure+fearPressure+timePressure+roomPressure,0,.82);
  if(facing>.72&&dist<19){
    e32Enemy.position.addScaledVector(toward,-dt*(2.4+pressure*1.8));
    if(dist<7.5&&Math.random()<dt*.45){glitchPulse=Math.max(glitchPulse,.38);audio?.mechanicalEvent('latch');}
  }else e32Enemy.position.addScaledVector(toward,dt*(.18+pressure*.68));
  e32Enemy.lookAt(p.x,0,p.z);
  e32.enemyDistance=e32Enemy.position.distanceTo(p);
  e32.enemyApproach=THREE.MathUtils.clamp((19-e32.enemyDistance)/16,0,1);
  e32Enemy.visible=e32.enemyDistance<18&&facing>-.35;
  e32EnemyHead.rotation.z=Math.sin(t*.0017)*.065;e32EnemyTorso.rotation.z=Math.sin(t*.0008)*.045;
  e32EnemyGlow.intensity=.35+e32.enemyApproach*2.5+Math.sin(t*.006)*.18;
  if(e32.enemyDistance<14){
    e32.enemyFootClock-=dt;
    if(e32.enemyFootClock<=0){
      e32.enemyFootClock=1.55-e32.enemyApproach*.92+Math.random()*.22;
      const pan=THREE.MathUtils.clamp(right.dot(toEnemy.clone().normalize()),-1,1);
      audio?.mechanicalNoise(.18,185+Math.random()*90,1.6,.035+e32.enemyApproach*.06,pan);
      audio?.mechanicalTone(47,31,.48,'sine',.018+e32.enemyApproach*.035,pan);
    }
  }
  if(e32.enemyDistance<2.0&&facing<.35)triggerDeath('THE FOURTEENTH HAS TAKEN YOUR PLACE.');
}
const e32BaseSetTension=audio.setTension.bind(audio);
audio.setTension=function(value){
  e32BaseSetTension(Math.min(1,value+e32.enemyApproach*.58));
  if(this.zoneGain&&this.ctx)this.zoneGain.gain.setTargetAtTime(.08+value*.15+e32.enemyApproach*.25,this.ctx.currentTime,.34);
  if(this.noiseGain&&this.ctx)this.noiseGain.gain.setTargetAtTime(.13+value*.07+e32.enemyApproach*.13,this.ctx.currentTime,.5);
};
speakVoice=function(){ /* all dialogue is text-only. */ };
const e32BaseChooseDialogue=chooseDialogue;
chooseDialogue=function(npc,index){
  e32BaseChooseDialogue(npc,index);
  const name=(npc?.name||'').toLowerCase();
  storyFlags.add('spoke-'+name.replace(/[^a-z0-9]+/g,'-')+'-'+index);
  if(name==='ines'&&index===0){storyFlags.add('ines-trust');e32UpdateQuestHud();}
  if(name==='sergio'&&index===0){
    storyFlags.add('sergio-truth');
    e32Journal('sergio-confession','Sergio's confession','Sergio says the 1977 choir died because a ventilation duct was blocked. The record came later. “I do not want absolution. I want the report to exist.”','testimonianza');
  }
  if(name==='dario'||name==='il primo'){
    if(index===0){storyFlags.add('challenged-leader');storyFlags.delete('accepted-leader');}
    else{storyFlags.add('accepted-leader');storyFlags.delete('challenged-leader');}
  }
  if(name==='ottavio'&&index===1){
    storyFlags.add('ottavio-audio');
    e32Toast('OTTAVIO HAS TAUGHT YOU TO RECOGNISE THE SOUND THAT PRECEDES A FOOTSTEP.');
  }
  if(name==='anna'&&index===0)storyFlags.add('anna-mercy');
  if(name==='the woman by the canal'&&index===0)storyFlags.add('canal-witness');
  e32UpdateQuestHud();
};
const e32BaseInspect=inspectTarget;
inspectTarget=function(item){
  if(item?.repeatable){item.run?.();return;}
  e32BaseInspect(item);
};
const e32BaseEnterZone=enterZone;
enterZone=function(name,spawn){
  e32BaseEnterZone(name,spawn);
  if(name==='graveyard'){$('location').textContent='CEMETERY / ELENA BASSI · 1977';fear=Math.min(1,fear+.08);audio?.mechanicalEvent('latch');}
  if(name==='home'&&e32Quest.windowHome)showToast('THE GLASS REFLECTS A ROOM THAT IS NO LONGER HERE.');
  e32UpdateQuestHud();
};
const e32BaseDayNight=updateDayNight;
updateDayNight=function(dt,t){
  e32BaseDayNight(dt,t);
  if(currentZone==='graveyard'){
    const night=dayNightBlend;
    const sky=new THREE.Color(0xb0b4a9).lerp(new THREE.Color(0x151d21),night);
    scene.background.copy(sky);if(scene.fog?.color)scene.fog.color.copy(sky);
    zones.graveyard.ambient.intensity=.34-night*.2;
    zones.graveyard.moon.intensity=.3+night*.62;
  }
};
const e32BaseWeather=updateWeather;
updateWeather=function(dt,t){
  e32BaseWeather(dt,t);
  if(currentZone==='graveyard'){
    rainPoints.visible=true;rainStreaks.visible=true;
    const p=currentPosition();rainPoints.position.set(p.x,0,p.z);rainStreaks.position.set(p.x,0,p.z);
  }
};
const e32BaseHorror=updateHorror;
updateHorror=function(dt,t){e32BaseHorror(dt,t);e32UpdateEnemy(dt,t);};
const e32BaseCamera=updateCameraDirector;
updateCameraDirector=function(dt,t){
  e32BaseCamera(dt,t);
  if(e32.enemyApproach>.76&&!dialogueOpen&&!journalOpen&&!cameraDirector.active&&cameraDirector.cooldown<=0){
    cameraDirector.active=true;cameraDirector.timer=1.1;cameraDirector.side=Math.random()<.5?-1:1;cameraDirector.phase=0;cameraDirector.roll=.025;
    showToast('SOMEONE HAS ENTERED THE FRAME.');
  }
};
const e32BaseTargets=updateTargets;
updateTargets=function(){
  e32BaseTargets();
  const hint=$('inspect-hint');
  if(hint)hint.classList.toggle('visible',!!activeTarget&&playerInputEnabled()&&e32.zoom);
};
const e32BasePlayer=updatePlayer;
updatePlayer=function(dt){
  e32BasePlayer(dt);
  const carView=(typeof e33!=='undefined')&&['drive','stop','betrayal'].includes(e33.carPhase);
  const target=carView?63:(e32.zoom?27:72);
  if(Math.abs(camera.fov-target)>.12){camera.fov+= (target-camera.fov)*Math.min(1,dt*7);camera.updateProjectionMatrix();}
};
const e32BaseAnimate=animateZone;
animateZone=function(t,dt){
  e32BaseAnimate(t,dt);
  e32.practicals.forEach(p=>{
    const f=.82+Math.sin(t*.009+p.phase)*.11+Math.sin(t*.037+p.phase*2)*.045;
    p.light.intensity=p.base*f;p.flame.scale.y=1.45+f*.4;p.halo.material.opacity=.08+f*.06;
  });
  if(e32.windowScene){
    const w=e32.windowScene;w.elapsed+=dt;w.group.position.x=-.34+Math.min(1,w.elapsed/2.1)*.72;
    w.group.rotation.z=Math.sin(t*.002)*.035;
    if(w.elapsed>4.8){w.group.visible=false;e32.windowScene=null;glitchPulse=Math.max(glitchPulse,.55);}
  }
  // Cultists never stand quite still: small delayed weight transfers and
  // shoulder/neck contractions create a slow, badly synchronised walking rhythm.
  for(const npc of cultRoster){
    if(npc.fate!=='present'||npc.walking)continue;
    if(Math.sin(t*.00019+npc.phase*1.7)>.982){
      npc.walking=true;npc.userDataWalkUntil=t+980;
      npc.e32ShambleOrigin=npc.object.position.clone();npc.e32ShambleStart=t;
      npc.e32ShambleSide=(Math.random()-.5)*.18;
    }
    if(npc.object?.visible){
      npc.object.rotation.z+=(Math.sin(t*.00053+npc.phase)*.026-npc.object.rotation.z)*Math.min(1,dt*.45);
      if(npc.baconCage)npc.baconCage.rotation.y=Math.sin(t*.00041+npc.phase)*.11;
    }
  }
  for(const npc of cultRoster){
    if(npc.walking&&npc.userDataWalkUntil&&npc.fate==='present'){
      const k=(t-(npc.e32ShambleStart||t))*.005;
      if(npc.e32ShambleOrigin){
        npc.object.position.x=npc.e32ShambleOrigin.x+Math.sin(k)*.10;
        npc.object.position.z=npc.e32ShambleOrigin.z+Math.cos(k*.5)*.055;
        npc.object.rotation.y+=Math.sin(k*.7)*.0008;
      }
      if(t>npc.userDataWalkUntil){
        npc.walking=false;
        if(npc.e32ShambleOrigin)npc.object.position.set(npc.e32ShambleOrigin.x,npc.object.position.y,npc.e32ShambleOrigin.z);
        npc.e32ShambleOrigin=null;
      }
    }
  }
  if(e32Enemy.visible){e32Enemy.rotation.z=Math.sin(t*.0011)*.012;}
};
const e32BaseHud=updateHud;
updateHud=function(dt){e32BaseHud(dt);if(currentZone==='graveyard')$('coords').textContent='45° 02′ N — 10° 41′ E / CEMETERY';e32UpdateQuestHud();};
const e32BaseFinish=finishListening;
finishListening=function(){
  e32BaseFinish();
  const secret=e32Quest.grave&&e33.candlesLit&&e33.carRideComplete&&e33.confessionSeen&&e32Quest.pump&&e32Quest.vent&&storyFlags.has('ines-trust')&&storyFlags.has('ottavio-audio')&&storyFlags.has('sergio-truth')&&storyFlags.has('challenged-leader')&&storyFlags.has('escaped-primo');
  const button=$('ending-witness');
  if(button)button.hidden=!secret;
  if(secret)showToast('THERE IS A FOURTEENTH PLACE. IT IS NOT FOR THE RECORD.');
};
const e32BaseEnding=resolveEnding;
resolveEnding=function(choice){
  if(choice==='witness'){
    storyFlags.add('ending-witness');
    $('ending-title').textContent='The voice that does not fill.';
    $('ending-copy').textContent='You dug a grave, stopped a pump and opened a duct. Ines entrusted Elena's name to you; Ottavio recognised the sound that precedes a footstep; Sergio allowed the report to exist. You did not hear Il Bianco. You prevented emptiness from being mistaken for a promise.';
    $('ending-small').textContent='ENDING IV / WITNESS — THE TAPE REMAINS WHITE';
    $('ending-choices').classList.remove('visible');$('ending-result').classList.add('visible');
    speakVoice('We did not empty ourselves to be filled. We emptied ourselves because no one had listened to our names.','INES / REGISTRAZIONE');
    audio?.killSting();glitchPulse=1.2;return;
  }
  e32BaseEnding(choice);
  if(choice==='expose'){
    if(!(e32Quest.grave&&e32Quest.vent&&storyFlags.has('sergio-truth'))){
      $('ending-title').textContent='The Window Without Air.';
      $('ending-copy').textContent='You opened the windows, but found neither the report nor the way to clear the duct. Cold air filled the room. The explanation remained outside, behind the glass.';
      $('ending-small').textContent='ENDING II / AIR INSUFFICIENTE';
    }else{
      $('ending-title').textContent='The Saturated Room.';
      $('ending-copy').textContent='Elena’s grave, Sergio’s confession and the blocked duct point to the same event. The 1977 choir died of carbon monoxide poisoning. The album came later, giving a name to something no one could bear.';
      $('ending-small').textContent='ENDING II / EVIDENCE AND VENTILATION';
    }
  }
  if(choice==='fill'&&storyFlags.has('accepted-leader')){
    $('ending-title').textContent='The First Name.';
    $('ending-copy').textContent='You accepted the First One's account. Now you understand that there was no leader: only an order of people willing to give up their names. The fourteenth chair is not a throne. It is a shift.';
  }
  if(choice==='preserve'&&storyFlags.has('window-witnessed')){
    $('ending-title').textContent='The room behind the glass.';
    $('ending-copy').textContent='You preserved the recording. Behind the window, the figure keeps setting the table. When the tape stops, your reflection appears in the glass, seated in the thirteenth place.';
  }
};
$('ending-witness').addEventListener('click',()=>resolveEnding('witness'));
// The shovel is not inventory decoration: it opens a three-stage grave mission.
{
  const z=zones.ruin;
  const tool=new THREE.Group();tool.position.set(-4.65,0,-4.35);z.group.add(tool);
  const shaft=new THREE.Mesh(new THREE.CylinderGeometry(.035,.045,1.1,8),M.wood);shaft.position.y=.55;shaft.rotation.z=-.14;tool.add(shaft);
  const blade=new THREE.Mesh(new THREE.BoxGeometry(.22,.36,.045),M.rust);blade.position.set(.08,.1,0);blade.rotation.z=-.16;tool.add(blade);
  const pickup={id:'e32_spade',type:'event',object:tool,point:tool.position,radius:3.3,prompt:'[ E ] TAKE THE SPADE',run:()=>{
    e32Quest.shovel=true;tool.visible=false;z.interactables.splice(z.interactables.indexOf(pickup),1);
    e32Journal('spade','The spade','The handle has been polished by a hand that dug in the same place again and again. Black earth clings to the blade, along with a flake of white paint.','oggetto');
    e32Toast('YOU FOUND THE SPADE. THE CEMETERY LIES BEYOND THE MAIZE FIELD.');e32UpdateQuestHud();
  }};
  z.interactables.push(pickup);
}
// The church organ has lost its crank. It is the only tool that fits the canal pump.
{
  const z=zones.church;const crank=new THREE.Group();crank.position.set(-7.2,.25,5.9);z.group.add(crank);
  const wheel=new THREE.Mesh(new THREE.TorusGeometry(.22,.035,7,24),M.rust);wheel.rotation.x=Math.PI/2;crank.add(wheel);
  const grip=new THREE.Mesh(new THREE.CylinderGeometry(.035,.035,.48,7),M.metal);grip.rotation.z=Math.PI/2;crank.add(grip);
  const pickup={id:'e32_crank',type:'event',object:crank,point:crank.position,radius:3.0,prompt:'[ E ] TAKE THE CRANK',run:()=>{
    e32Quest.crank=true;crank.visible=false;z.interactables.splice(z.interactables.indexOf(pickup),1);
    e32Journal('crank','The crank','The organ crank has worn threads. Its hub is engraved: HYDRAULIC CONSORTIUM / 1977.','oggetto');
    audio?.mechanicalEvent('gear');e32Toast('THE CRANK DOES NOT BELONG TO THE ORGAN.');e32UpdateQuestHud();
  }};
  z.interactables.push(pickup);
}
// The canal pump can be stopped only after the crank is recovered from the church.
{
  const z=zones.road;const wheel=new THREE.Group();wheel.position.set(20.7,1.05,10.1);z.group.add(wheel);
  const ring=new THREE.Mesh(new THREE.TorusGeometry(.54,.075,8,32),M.rust);wheel.add(ring);
  const hub=new THREE.Mesh(new THREE.CylinderGeometry(.12,.12,.22,12),M.metal);hub.rotation.x=Math.PI/2;wheel.add(hub);
  for(let i=0;i<4;i++){const spoke=new THREE.Mesh(new THREE.BoxGeometry(.08,.98,.07),M.rust);spoke.rotation.z=i*Math.PI/4;wheel.add(spoke);}
  const casing=addBox(z.group,20.7,.65,10.1,1.5,1.25,.75,M.darkWall);
  const marker=new THREE.Mesh(new THREE.SphereGeometry(.12,9,7),M.gold);marker.position.set(19.2,.2,10.5);z.group.add(marker);
  z.interactables.push({id:'e32_pump',type:'event',repeatable:true,object:marker,point:marker.position,radius:4.4,prompt:'[ E ] STOP THE CANAL PUMP',run:()=>{
    if(!e32Quest.crank){e32Toast('THE PIN IS BROKEN. YOU NEED A CRANK.');return;}
    if(e32Quest.pump){e32Toast('THE PUMP IS STILL. SOMETHING BREATHES BENEATH THE NOISE.');return;}
    e32Quest.pump=true;storyFlags.add('pump-restored');wheel.rotation.z=Math.PI*2;casing.material=M.rust;
    audio?.powerSurge();audio?.mechanicalEvent('valve');fear=Math.min(1,fear+.11);
    e32Journal('pump-ledger','Zero pressure','The pump did not send water to the fields. It returned it to the church duct. The counter records thirteen cycles and a fourteenth without pressure.','registro');
    speakVoice('The pump is still. But the noise continues underground.','IL CANALE');
    e32Toast('THE CANAL HAS STOPPED BREATHING.');e32UpdateQuestHud();
  }});
}
// A blocked church duct explains how the 1977 choir room became lethal.
// It can be opened only after both the grave record and pump ledger are recovered.
{
  const z=zones.church;const duct=new THREE.Group();duct.position.set(7.1,2.0,-1.2);z.group.add(duct);
  const pipe=new THREE.Mesh(new THREE.CylinderGeometry(.31,.31,1.5,12),M.rust);pipe.rotation.z=Math.PI/2;duct.add(pipe);
  const grille=new THREE.Mesh(new THREE.BoxGeometry(.12,.92,.7),M.metal);grille.position.x=-.34;duct.add(grille);
  for(let i=0;i<5;i++){const bar=new THREE.Mesh(new THREE.BoxGeometry(.15,.035,.62),M.darkWood);bar.position.set(-.42,.3-i*.15,0);duct.add(bar);}
  const marker=new THREE.Mesh(new THREE.SphereGeometry(.13,9,7),M.gold);marker.position.set(6.4,.35,-.1);z.group.add(marker);
  z.interactables.push({id:'e32_vent',type:'event',repeatable:true,object:marker,point:marker.position,radius:3.4,prompt:'[ E ] OPEN THE DUCT',run:()=>{
    if(!e32Quest.grave||!e32Quest.pump){e32Toast('EVIDENCE IS MISSING. FORCE WILL NOT OPEN THE DUCT.');return;}
    if(e32Quest.vent){e32Toast('AIR PASSES THROUGH. THE SMELL DOES NOT.');return;}
    e32Quest.vent=true;storyFlags.add('vent-open');duct.rotation.z=.32;grille.rotation.y=.9;
    audio?.powerSurge();audio?.mechanicalEvent('valve');fear=Math.max(.2,fear-.16);
    e32Journal('vent-report','Choir ventilation duct','The duct was shut from the inside and then bricked up. The black residue matches the gas heater photographed in 1977. Elena's report was not a forgery.','referto');
    speakVoice('The room was not cursed. It was sealed. Someone chose to call the gas a voice.','LA CONDOTTA');
    e32Toast('THE DUCT IS OPEN. THE MYTH HAS A CRACK.');e32UpdateQuestHud();
  }});
}
e32HomeWindow.event.prompt='[ E ] LOOK AT THE ROOM BEHIND THE WINDOW';
e32RuinWindow.event.prompt='[ E ] EXAMINE THE REFLECTION';
e32UpdateQuestHud();



// =============================================================================
// EPISTASSI 3.3 — THE NEW ARRIVAL
// A text-led induction story: Il Primo gives the newcomer apparently humane
// work, while each task makes him more useful to the ritual that will empty him.
// The album is never heard. No synthesized or recorded character voice is used.
// =============================================================================
const e33 = {
  candlesLit:false, primoWelcomed:false, carInvitation:false, carRideStarted:false,
  carRideComplete:false, confessionSeen:false, handVisible:false,
  candleObjects:[], flames:[], smokeEmitters:[], relicsUpgraded:false,
  forestSounds:0, industrialClock:0, confessionHand:null, forestPrimo:null,
  carRoot:null, roadCar:null, carPhase:'idle', carTimer:0, escapeElapsed:0,
  escapeStart:null, gate:null, backgroundWindows:[], lastMission:''
};
e32Quest.candles = false;
e32Quest.car = false;
const e33QuestText = function(){
  if(!e33.primoWelcomed && currentZone==='road') return 'ARRIVAL — Find the farmhouse. They are expecting the piano tuner.';
  if(!e33.primoWelcomed && currentZone==='home') return 'THE HOUSE — Meet Ines and Ottavio. The man who called you is waiting in the outbuilding.';
  if(!e33.primoWelcomed && currentZone==='abattoir') return 'IL PRIMO — Speak to the man beside the suspended forms. He has a task for you.';
  if(!e33.primoWelcomed) return 'THE NEW ARRIVAL — Find the man who arranged your visit.';
  if(!e32Quest.shovel) return 'IL PRIMO’S FIRST TASK — Find a spade in the abandoned house. Elena’s grave is beyond the fields.';
  if(!e32Quest.grave) return 'THE GRAVE — Dig until you find what Elena left beneath the stone.';
  if(!e33.candlesLit) return 'THE CHURCH — Light the seven candles. Il Primo says the order matters.';
  if(!e33.carRideComplete) return 'THE RIDE — Il Primo is waiting by the car at the roadside.';
  if(!e32Quest.crank) return 'THE PUMP — Find the missing organ crank in the church.';
  if(!e32Quest.pump) return 'THE CANAL — Fit the crank and stop the pump.';
  if(!e32Quest.vent) return 'THE CHOIR — Open the blocked ventilation duct in the church.';
  return 'THE CELLAR — The White is waiting beneath the house. The thirteen are making room.';
};
e32QuestText = e33QuestText;
function e33UpdateMission(){
  e32UpdateQuestHud();
  const line=$('mission-line'), count=$('mission-count');
  if(line)line.textContent=e33QuestText();
  if(count)count.textContent=[e32Quest.grave,e33.candlesLit,e32Quest.pump,e32Quest.vent].filter(Boolean).length+'/4';
  if(!e33.primoWelcomed&&currentZone==='road')$('objective-text').textContent='You are the newest arrival. Find the farmhouse. They have called you here to tune a harpsichord.';
  else if(!e33.primoWelcomed&&currentZone==='home')$('objective-text').textContent='The welcome is almost too ordinary. Meet Ines and Ottavio, then look for the outbuilding beyond the fields.';
  else if(!e33.primoWelcomed&&currentZone==='abattoir')$('objective-text').textContent='A man is waiting in the slaughterhouse. He says he can show you how this place works.';
  else if(!e32Quest.grave)$('objective-text').textContent='Il Primo has given you a simple task. Do not keep him waiting.';
  else if(!e33.candlesLit)$('objective-text').textContent='The candles must be lit before the others gather.';
  else if(!e33.carRideComplete)$('objective-text').textContent='Il Primo has something else to show you. Find his car.';
  else if(!listeningPending&&collected.size<clueCount)$('objective-text').textContent='The house has thirteen places. You have been given the fourteenth.';
  else if(collected.size>=clueCount)$('objective-text').textContent='The White is below the house. The needle is waiting.';
  if(e32Quest.grave&&e33.candlesLit&&!e33.carRideStarted&&!e33.carInvitation){
    e33.carInvitation=true;
    e33CarEvent.enabled=true;
    if(!zones.road.interactables.includes(e33CarEvent))zones.road.interactables.push(e33CarEvent);
    if(e33PrimoAtCar)e33PrimoAtCar.object.visible=true;
    showToast('IL PRIMO IS WAITING BY HIS CAR. HE SAYS THERE IS SOMETHING YOU SHOULD SEE.');
  }
}
function e33SetSubtitle(speaker, text, options=[]){
  $('speaker').textContent=(speaker||'').toUpperCase();
  $('subtitle').textContent=text;
  const root=$('dialogue-options');root.innerHTML='';
  options.forEach((option,i)=>{
    const b=document.createElement('button');b.className='dialogue-option';
    b.innerHTML='<b>['+(i+1)+']</b>'+option.label;
    b.addEventListener('click',option.run);
    root.appendChild(b);
  });
  $('subtitle-wrap').classList.add('visible');
}
function e33CloseSubtitle(){
  
  $('subtitle-wrap').classList.remove('visible');$('dialogue-options').innerHTML='';
  dialogueOpen=false;
  if(gameStarted&&!gameEnded&&!journalOpen)controls.lock();
}
function e33SmokeTexture(){
  const c=document.createElement('canvas');c.width=c.height=128;
  const ctx=c.getContext('2d');
  const g=ctx.createRadialGradient(64,64,2,64,64,62);
  g.addColorStop(0,'rgba(245,244,231,.48)');
  g.addColorStop(.24,'rgba(185,185,174,.30)');
  g.addColorStop(.62,'rgba(95,100,98,.13)');
  g.addColorStop(1,'rgba(60,64,62,0)');
  ctx.fillStyle=g;ctx.fillRect(0,0,128,128);
  for(let i=0;i<280;i++){
    const x=Math.random()*128,y=Math.random()*128,r=1+Math.random()*9;
    ctx.fillStyle='rgba(35,37,36,'+(Math.random()*.05)+')';
    ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();
  }
  const tex=new THREE.CanvasTexture(c);tex.needsUpdate=true;return tex;
}
const e33SmokeMap=e33SmokeTexture();
function e33SmokeEmitter(parent,x,y,z,scale=1,color=0x989b96,count=5){
  const emitter={particles:[],x,y,z,scale,color,active:true};
  for(let i=0;i<count;i++){
    const material=new THREE.SpriteMaterial({map:e33SmokeMap,color,transparent:true,opacity:.07,depthWrite:false});
    const sprite=new THREE.Sprite(material);
    sprite.position.set(x,y+i*.62,z);
    sprite.scale.set(scale*(.8+Math.random()*.6),scale*(1.1+Math.random()*.7),1);
    sprite.userData.phase=Math.random();
    sprite.userData.baseY=y+i*.62;
    sprite.userData.offset=(Math.random()-.5)*.45;
    parent.add(sprite);emitter.particles.push(sprite);
  }
  e33.smokeEmitters.push(emitter);return emitter;
}
function e33AddIndustry(parent,x,z,scale=1,seed=0){
  const g=new THREE.Group();g.position.set(x,0,z);g.scale.setScalar(scale);parent.add(g);
  const concrete=mat(0x474944,1,{map:TEX.concrete,bumpScale:.12});
  const windowMat=new THREE.MeshStandardMaterial({color:0x8a887b,emissive:0xc28c50,emissiveIntensity:.55,roughness:.5,metalness:.08});
  const office=addBox(g,0,3.4,0,10.2,6.8,6.8,concrete);
  addBox(g,0,6.95,0,10.8,.22,7.4,M.rust);
  for(let floor=0;floor<4;floor++)for(let col=0;col<7;col++){
    const xx=-4.15+col*1.38,yy=1.15+floor*1.35;
    const lit=((floor*7+col+seed)%5===0)||((floor+col+seed)%9===0);
    const pane=new THREE.Mesh(new THREE.PlaneGeometry(.76,.72),lit?windowMat:M.black);
    pane.position.set(xx,yy,3.43);g.add(pane);
    addBox(g,xx,yy-.39,3.47,.86,.045,.06,M.rust,{castShadow:false});
  }
  // Elevated pipes carry an unknown fluid between the office, boiler house and bore.
  for(let i=0;i<3;i++){
    const y=2.5+i*.82;
    const pipe=new THREE.Mesh(new THREE.CylinderGeometry(.15-i*.025,.15-i*.025,18,10),i===1?M.rust:M.metal);
    pipe.rotation.z=Math.PI/2;pipe.position.set(0,y,-5.9-i*.38);g.add(pipe);
    for(let p=-1;p<=1;p++){
      const brace=addBox(g,p*5.4,y-.33,-5.9-i*.38,.13,.72,.13,M.rust);
      brace.rotation.z=.08*p;
    }
  }
  // Two drilling heads and a derrick: they never visibly serve the fields.
  for(const dx of [-7.4,7.4]){
    const rig=new THREE.Group();rig.position.set(dx,0,-7.8);g.add(rig);
    const mast=new THREE.Mesh(new THREE.CylinderGeometry(.09,.24,8.8,7),M.rust);mast.position.y=4.4;rig.add(mast);
    const crown=addBox(rig,0,8.75,0,1.2,.28,1.2,M.metal);
    for(let n=0;n<4;n++){
      const strut=new THREE.Mesh(new THREE.CylinderGeometry(.035,.045,8.8,5),M.metal);
      strut.position.set((n%2?1:-1)*.38,4.4,(n<2?1:-1)*.38);
      strut.rotation.z=(n%2?1:-1)*.11;rig.add(strut);
    }
    const drill=new THREE.Mesh(new THREE.CylinderGeometry(.04,.09,3.2,8),M.gold);drill.position.y=-1.35;rig.add(drill);
    const beacon=addLight(rig,0xc45a39,.34,11,0,8.4,0);
    beacon.userData.pulse=true;
  }
  for(let i=0;i<3;i++){
    const h=13+i*3;
    const stack=new THREE.Mesh(new THREE.CylinderGeometry(.42+i*.06,.72+i*.08,h,10),M.rust);
    stack.position.set(-2.8+i*2.65,h/2,-9.4);g.add(stack);
    const rim=new THREE.Mesh(new THREE.TorusGeometry(.5+i*.06,.075,6,16),M.metal);rim.position.set(-2.8+i*2.65,h,-9.4);rim.rotation.x=Math.PI/2;g.add(rim);
    e33SmokeEmitter(g,-2.8+i*2.65,h+.15,-9.4,2.0+i*.25,0x858984,7);
  }
  const pipeBridge=new THREE.Mesh(new THREE.CylinderGeometry(.22,.22,15,10),M.rust);
  pipeBridge.rotation.z=Math.PI/2;pipeBridge.position.set(0,8,-12);g.add(pipeBridge);
  addLight(g,0xb15c3e,.7,18,0,8,-8);
  return g;
}
function e33MakeCar(parent,x,z){
  const g=new THREE.Group();g.position.set(x,0,z);parent.add(g);
  const chassis=mat(0x242827,.72,{metalness:.42});
  const paint=mat(0x343a38,.46,{metalness:.52});
  const rubber=mat(0x10110f,1);
  const chrome=mat(0x77766d,.36,{metalness:.82});
  const glass=new THREE.MeshStandardMaterial({color:0x35484a,roughness:.12,metalness:.18,transparent:true,opacity:.17,side:THREE.DoubleSide});
  addBox(g,0,.52,0,2.1,.48,4.75,paint);
  addBox(g,0,.78,-1.55,2.02,.36,1.48,paint);
  addBox(g,0,.75,1.55,2.0,.34,1.1,paint);
  addBox(g,0,1.39,.05,1.8,.92,2.14,paint);
  addBox(g,0,1.91,.05,1.92,.15,2.28,chassis);
  // Windscreen, rear glass and narrow side windows; the cabin remains visible from inside.
  const wind=new THREE.Mesh(new THREE.PlaneGeometry(1.66,.69),glass);wind.position.set(0,1.47,-1.04);wind.rotation.x=-.12;g.add(wind);
  const rear=new THREE.Mesh(new THREE.PlaneGeometry(1.63,.63),glass);rear.position.set(0,1.48,1.12);rear.rotation.x=Math.PI+.1;g.add(rear);
  for(const side of [-1,1]){
    const window=new THREE.Mesh(new THREE.PlaneGeometry(1.78,.63),glass);
    window.position.set(side*.907,1.48,.02);window.rotation.y=side*Math.PI/2;g.add(window);
    addBox(g,side*.94,1.05,.08,.12,.8,2.1,chassis);
    addBox(g,side*.94,.63,.04,.12,.18,2.0,chrome);
    for(const zz of [-1.48,1.46]){
      const wheel=new THREE.Mesh(new THREE.CylinderGeometry(.43,.43,.25,24),rubber);
      wheel.rotation.z=Math.PI/2;wheel.position.set(side*1.03,.45,zz);g.add(wheel);
      const hub=new THREE.Mesh(new THREE.CylinderGeometry(.22,.22,.27,20),chrome);hub.rotation.z=Math.PI/2;hub.position.copy(wheel.position);g.add(hub);
      for(let k=0;k<5;k++){
        const bolt=new THREE.Mesh(new THREE.SphereGeometry(.035,7,6),M.gold);
        bolt.position.set(side*1.18,.45+Math.cos(k*1.256)*.13,zz+Math.sin(k*1.256)*.13);g.add(bolt);
      }
    }
  }
  // Dashboard, glove compartment, instrument glass, passenger seat and steering wheel.
  addBox(g,0,1.03,-.98,1.8,.25,.36,chassis);
  addBox(g,.55,1.16,-1.05,.42,.08,.12,chrome);
  const dial=new THREE.Mesh(new THREE.PlaneGeometry(.5,.18),new THREE.MeshBasicMaterial({map:makeLabelTexture('03:17  /  A=415',512,128),transparent:true,side:THREE.DoubleSide}));
  dial.position.set(-.25,1.2,-.79);g.add(dial);
  const steering=new THREE.Mesh(new THREE.TorusGeometry(.26,.025,7,28),chrome);steering.position.set(-.52,1.34,-.81);steering.rotation.y=.15;g.add(steering);
  addBox(g,.45,.87,.28,.62,.85,.72,M.darkWood);
  addBox(g,-.5,.87,.28,.62,.85,.72,M.darkWood);
  // Headlights and rear lamps.
  for(const side of [-1,1]){
    const lamp=new THREE.Mesh(new THREE.SphereGeometry(.14,10,8),new THREE.MeshBasicMaterial({color:0xe1cf9e}));
    lamp.position.set(side*.67,.76,-2.38);g.add(lamp);
    const beam=new THREE.SpotLight(0xc4b99b,.65,22,Math.PI/5,.65,1.5);
    beam.position.set(side*.67,.76,-2.28);beam.target.position.set(side*.67,.6,-10);g.add(beam);g.add(beam.target);
    const tail=new THREE.Mesh(new THREE.BoxGeometry(.25,.14,.04),new THREE.MeshBasicMaterial({color:0x9d2c24,emissive:0x5b0906,emissiveIntensity:1.1}));
    tail.position.set(side*.72,.72,2.39);g.add(tail);
  }
  addBox(g,0,.28,-2.32,1.35,.16,.08,chrome);
  addBox(g,0,.28,2.32,1.3,.16,.08,chrome);
  g.userData.wheels=g.children.filter(o=>o.geometry?.type==='CylinderGeometry');
  return g;
}
function e33AddCandle(parent,x,y,z,index){
  const g=new THREE.Group();g.position.set(x,y,z);parent.add(g);
  const wax=mat(index%3===0?0xd0c4a8:0xbeb59f,.96,{map:TEX.plaster,bumpScale:.035});
  const holder=new THREE.Mesh(new THREE.CylinderGeometry(.16,.20,.08,16),M.gold);holder.position.y=.05;g.add(holder);
  const foot=new THREE.Mesh(new THREE.TorusGeometry(.13,.025,6,20),M.metal);foot.position.y=.09;g.add(foot);
  const body=new THREE.Mesh(new THREE.CylinderGeometry(.075,.09,.47,12),wax);body.position.y=.32;g.add(body);
  for(let n=0;n<3;n++){
    const drip=new THREE.Mesh(new THREE.CapsuleGeometry(.018,.10+Math.random()*.07,3,6),wax);
    drip.position.set((Math.random()-.5)*.1,.22+Math.random()*.24,.07);drip.rotation.z=(Math.random()-.5)*.5;g.add(drip);
  }
  const wick=new THREE.Mesh(new THREE.CylinderGeometry(.012,.012,.07,5),M.black);wick.position.y=.57;g.add(wick);
  const flame=new THREE.Group();flame.position.y=.64;flame.visible=false;g.add(flame);
  const outer=new THREE.Mesh(new THREE.ConeGeometry(.09,.32,9),new THREE.MeshBasicMaterial({color:0xe98942,transparent:true,opacity:.72}));
  outer.position.y=.14;flame.add(outer);
  const inner=new THREE.Mesh(new THREE.ConeGeometry(.043,.19,8),new THREE.MeshBasicMaterial({color:0xffd68a,transparent:true,opacity:.95}));
  inner.position.y=.105;flame.add(inner);
  const core=new THREE.Mesh(new THREE.SphereGeometry(.026,8,7),new THREE.MeshBasicMaterial({color:0xffefc5}));
  core.position.y=.045;flame.add(core);
  const light=new THREE.PointLight(0xffa24f,0,4.2,1.75);light.position.set(0,.78,0);g.add(light);
  const smoke=e33SmokeEmitter(g,0,.78,0,.37,0xaaa99f,4);smoke.active=false;
  const candle={group:g,flame,light,smoke,index,lit:false,phase:Math.random()*9};
  e33.candleObjects.push(candle);return candle;
}
function e33BuildRitualObjects(){
  const church=zones.church;
  // A worn altar cloth, a water chalice and a prayer book: parish objects, not imported occult props.
  const cloth=new THREE.Mesh(new THREE.PlaneGeometry(4.45,1.48),new THREE.MeshStandardMaterial({color:0xbdb6a1,roughness:1,side:THREE.DoubleSide}));
  cloth.rotation.x=-Math.PI/2;cloth.position.set(0,1.91,-12.0);church.group.add(cloth);
  for(let i=0;i<7;i++)e33AddCandle(church.group,-2.45+i*.81,1.98,-10.0,i);
  const chalice=new THREE.Group();chalice.position.set(0,2.06,-12.0);church.group.add(chalice);
  const bowlPoints=[new THREE.Vector2(0,0),new THREE.Vector2(.11,.04),new THREE.Vector2(.14,.18),new THREE.Vector2(.24,.28),new THREE.Vector2(.26,.39),new THREE.Vector2(.21,.46),new THREE.Vector2(0,.46)];
  const bowl=new THREE.Mesh(new THREE.LatheGeometry(bowlPoints,28),M.gold);chalice.add(bowl);
  const stem=new THREE.Mesh(new THREE.CylinderGeometry(.045,.07,.36,12),M.gold);stem.position.y=-.18;chalice.add(stem);
  const foot=new THREE.Mesh(new THREE.CylinderGeometry(.19,.23,.06,20),M.gold);foot.position.y=-.39;chalice.add(foot);
  const water=new THREE.Mesh(new THREE.CircleGeometry(.18,24),new THREE.MeshStandardMaterial({color:0x596d6b,roughness:.14,metalness:.25,transparent:true,opacity:.78}));
  water.rotation.x=-Math.PI/2;water.position.y=.405;chalice.add(water);
  const book=new THREE.Group();book.position.set(-3.35,2.03,-11.65);book.rotation.y=.18;church.group.add(book);
  const cover=addBox(book,0,.045,0,.74,.09,1.02,M.darkWood);
  addBox(book,0,.096,0,.68,.025,.94,mat(0xc8b99d,.96));
  for(let row=0;row<8;row++)addBox(book,-.20,.112,-.33+row*.09,.30,.006,.009,M.black,{castShadow:false});
  for(let row=0;row<8;row++)addBox(book,.17,.112,-.33+row*.09,.24,.006,.009,M.black,{castShadow:false});
  const crossStem=addBox(book,0,.13,.34,.045,.015,.24,M.gold,{castShadow:false});
  const crossArm=addBox(book,0,.13,.34,.17,.015,.045,M.gold,{castShadow:false});
  const censer=new THREE.Group();censer.position.set(3.45,2.28,-12.5);church.group.add(censer);
  const bowl2=new THREE.Mesh(new THREE.SphereGeometry(.18,12,9),M.metal);bowl2.scale.y=.62;censer.add(bowl2);
  const lid=new THREE.Mesh(new THREE.ConeGeometry(.17,.19,12),M.gold);lid.position.y=.18;censer.add(lid);
  for(const side of [-1,1]){const chain=new THREE.Mesh(new THREE.CylinderGeometry(.012,.012,.76,5),M.metal);chain.position.set(side*.12,.53,0);chain.rotation.z=side*.08;censer.add(chain);}
  e33SmokeEmitter(church.group,3.45,2.75,-12.5,.68,0xaaa69b,7);
}
e33BuildRitualObjects();

// The 1977 sleeve and the bare acetate become the centre of the cellar, not a background prop.
function e33BuildAlbum(){
  const cellar=zones.cellar;
  const sleeve=new THREE.Group();sleeve.position.set(-3.55,1.0,-2.45);sleeve.rotation.set(-.1,.16,-.13);cellar.group.add(sleeve);
  const card=new THREE.Mesh(new THREE.BoxGeometry(1.35,1.55,.055),mat(0xbdb5a3,.98,{map:TEX.plaster}));
  sleeve.add(card);
  const faceCanvas=document.createElement('canvas');faceCanvas.width=512;faceCanvas.height=512;
  const ctx=faceCanvas.getContext('2d');ctx.fillStyle='#c8c0ac';ctx.fillRect(0,0,512,512);
  ctx.fillStyle='#252521';ctx.font='32px Georgia';ctx.textAlign='center';ctx.fillText('IL BIANCO',256,96);
  ctx.fillStyle='#7c7467';ctx.font='14px monospace';ctx.fillText('MATRICE 14-B  /  A=415',256,132);
  ctx.strokeStyle='#736c60';ctx.lineWidth=2;ctx.strokeRect(20,20,472,472);
  ctx.beginPath();ctx.arc(256,292,118,0,Math.PI*2);ctx.stroke();
  ctx.beginPath();ctx.arc(256,292,22,0,Math.PI*2);ctx.stroke();
  for(let i=0;i<13;i++){const y=175+i*18;ctx.fillStyle='rgba(35,34,30,.50)';ctx.fillRect(70,y,Math.max(35,120+(i%4)*38),2);}
  ctx.fillStyle='#4a4740';ctx.font='italic 15px Georgia';ctx.fillText('DO NOT WRITE A TITLE ON THE DISC',256,470);
  const coverTex=new THREE.CanvasTexture(faceCanvas);coverTex.colorSpace=THREE.SRGBColorSpace;
  const coverFace=new THREE.Mesh(new THREE.PlaneGeometry(1.29,1.49),new THREE.MeshBasicMaterial({map:coverTex,side:THREE.DoubleSide}));
  coverFace.position.z=.031;sleeve.add(coverFace);
  const corner=new THREE.Mesh(new THREE.TorusGeometry(.085,.016,5,16),M.gold);corner.position.set(.53,-.62,.05);sleeve.add(corner);
  const label=new THREE.Mesh(new THREE.PlaneGeometry(.5,.18),new THREE.MeshBasicMaterial({map:makeLabelTexture('14-B / UNPLAYED',512,128),side:THREE.DoubleSide}));
  label.position.set(0,-.73,.04);sleeve.add(label);
  const marker=new THREE.Mesh(new THREE.BoxGeometry(.22,.16,.12),M.clue);marker.position.set(-3.55,1.0,-2.45);cellar.group.add(marker);
  const event={id:'e33_il_bianco',type:'event',repeatable:true,object:marker,point:marker.position,radius:3.5,prompt:'[ E ] EXAMINE THE SLEEVE OF IL BIANCO',run:()=>{
    if(!storyFlags.has('bianco-sleeve')){
      storyFlags.add('bianco-sleeve');
      e32Journal('il-bianco-sleeve','The sleeve of Il Bianco','The sleeve is almost new, but the paper has been handled at the corners. There is no track list, no publisher and no matrix number beyond 14-B. The disc is a bare acetate. Its grooves begin at the outer edge and stop before the label. No one has written a title on it.','album / object');
      e33SetSubtitle('THE CELLAR / THE WHITE','The thirteen chairs are arranged for a listening that none of them can describe. On the sleeve, thirteen short lines have been crossed out. A fourteenth line has been left blank.',[
        {label:'Close the sleeve.',run:()=>{e33CloseSubtitle();}}
      ]);
      glitchPulse=Math.max(glitchPulse,.5);
    }else showToast('THE SLEEVE HAS NOT CHANGED. THE BLANK LINE IS STILL THERE.');
  }};
  cellar.interactables.push(event);
  // Concentric etched grooves and a labelless centre make the record readable as an acetate.
  const platter=cellar.group.children.find(o=>o.isMesh&&o.geometry?.type==='CylinderGeometry'&&Math.abs(o.position.x)<.1&&Math.abs(o.position.z+2.2)<.1&&o.position.y>1.5);
  if(platter){
    for(let i=0;i<18;i++){
      const groove=new THREE.Mesh(new THREE.TorusGeometry(.19+i*.017,.0035,4,64),new THREE.MeshStandardMaterial({color:i%2?0x3c403d:0x77766a,metalness:.45,roughness:.24}));
      groove.rotation.x=Math.PI/2;groove.position.set(0,1.553,-2.2);cellar.group.add(groove);
    }
  }
}
e33BuildAlbum();

// Upgrade every discoverable object: paper has fibres, folds, marks and seals; metal has real mechanisms.
function e33UpgradeRelics(){
  const all=Object.values(zones).flatMap(z=>z.interactables.filter(i=>i.type==='clue'));
  all.forEach((item,index)=>{
    if(item.object.userData.e33Detailed)return;item.object.userData.e33Detailed=true;
    const root=item.object,id=item.id;
    const paperMat=mat(0xc2b69a,.98,{map:TEX.plaster,bumpScale:.035});
    if(['clipping','mass','photo','list','beam','butcher-ledger','voicemail'].includes(id)){
      const size=id==='list'?[.7,.025,.52]:[.66,.025,.46];
      const second=addBox(root,.035,.025,-.025,size[0],size[1],size[2],paperMat,{rotation:[0,0,.025]});
      const fold=addBox(root,-.22,.047,.12,.16,.008,.24,mat(0x96856a,1),{rotation:[0,0,-.12],castShadow:false});
      for(let row=0;row<5;row++)addBox(root,-.12,.052,-.16+row*.065,.25+(row%2)*.08,.004,.008,M.black,{castShadow:false});
      const seal=new THREE.Mesh(new THREE.CylinderGeometry(.067,.072,.025,18),mat(0x762f25,.68,{metalness:.04}));
      seal.position.set(.22,.06,.14);root.add(seal);
      const stamp=new THREE.Mesh(new THREE.TorusGeometry(.045,.008,4,18),M.gold);stamp.rotation.x=Math.PI/2;stamp.position.set(.22,.077,.14);root.add(stamp);
      for(const side of [-1,1]){
        const staple=new THREE.Mesh(new THREE.TorusGeometry(.045,.009,4,12,Math.PI),M.metal);
        staple.position.set(side*.24,.057,-.17);staple.rotation.x=Math.PI/2;root.add(staple);
      }
      if(id==='clipping'){
        addBox(root,-.19,.058,.16,.22,.012,.14,M.black,{castShadow:false});
        for(let row=0;row<6;row++)addBox(root,.12,.059,-.14+row*.045,.2,.004,.006,M.black,{castShadow:false});
      }
      if(id==='mass'){
        const crossV=addBox(root,0,.066,.12,.038,.009,.18,M.gold,{castShadow:false});
        const crossH=addBox(root,0,.066,.12,.13,.009,.035,M.gold,{castShadow:false});
      }
      if(id==='photo'){
        const scorch=new THREE.Mesh(new THREE.PlaneGeometry(.49,.32),new THREE.MeshBasicMaterial({color:0x221c17,transparent:true,opacity:.22,side:THREE.DoubleSide}));
        scorch.rotation.x=-Math.PI/2;scorch.position.set(0,.054,.02);root.add(scorch);
        for(let i=0;i<4;i++){const fleck=new THREE.Mesh(new THREE.BoxGeometry(.04,.004,.018),M.black);fleck.position.set((Math.random()-.5)*.55,.06,(Math.random()-.5)*.33);root.add(fleck);}
      }
      if(id==='list'){
        for(let n=0;n<13;n++){
          const mark=new THREE.Mesh(new THREE.SphereGeometry(.018,6,5),M.rust);
          mark.position.set(-.25+(n%2)*.16,.065,-.20+Math.floor(n/2)*.055);root.add(mark);
        }
      }
      if(id==='butcher-ledger'){
        const binding=new THREE.Mesh(new THREE.CylinderGeometry(.026,.026,.5,8),M.rust);binding.rotation.z=Math.PI/2;binding.position.set(-.32,.08,0);root.add(binding);
        addBox(root,0,.09,-.18,.035,.02,.26,M.gold);
      }
    }
    if(id==='fork'){
      const object=root.children.find(o=>o.isMesh&&o.geometry?.type==='CylinderGeometry');
      if(object){object.material=M.metal;object.scale.set(.75,.55,.75);}
      for(const side of [-1,1]){
        const tine=new THREE.Mesh(new THREE.CylinderGeometry(.026,.031,.48,8),M.gold);
        tine.position.set(side*.105,.35,.08);tine.rotation.z=side*.08;root.add(tine);
        const shoulder=new THREE.Mesh(new THREE.SphereGeometry(.055,8,6),M.metal);shoulder.position.set(side*.105,.12,.08);root.add(shoulder);
      }
      const handle=new THREE.Mesh(new THREE.CylinderGeometry(.045,.07,.28,9),M.gold);handle.position.set(0,-.08,0);root.add(handle);
      const engraving=new THREE.Mesh(new THREE.PlaneGeometry(.16,.1),new THREE.MeshBasicMaterial({map:makeLabelTexture('415 Hz',256,128),side:THREE.DoubleSide}));
      engraving.position.set(0,.025,.09);root.add(engraving);
    }
    if(id==='voicemail'){
      const cassette=new THREE.Group();cassette.position.set(0,.10,0);root.add(cassette);
      addBox(cassette,0,.015,0,.4,.07,.26,M.black);
      for(const x of [-.11,.11]){
        const spool=new THREE.Mesh(new THREE.TorusGeometry(.055,.012,5,18),M.metal);spool.position.set(x,.058,.025);cassette.add(spool);
        const hub=new THREE.Mesh(new THREE.CylinderGeometry(.018,.018,.02,10),M.gold);hub.position.set(x,.06,.025);cassette.add(hub);
      }
      addBox(cassette,0,.062,-.08,.18,.01,.09,mat(0xb6a98e,.96));
      const tapeWindow=new THREE.Mesh(new THREE.PlaneGeometry(.3,.07),new THREE.MeshBasicMaterial({map:makeLabelTexture('REC / 03:17',256,128),side:THREE.DoubleSide}));
      tapeWindow.position.set(0,.071,.105);cassette.add(tapeWindow);
      for(const x of [-.15,.15])for(const z of [-.09,.09]){
        const screw=new THREE.Mesh(new THREE.CylinderGeometry(.014,.014,.01,8),M.metal);screw.position.set(x,.075,z);cassette.add(screw);
      }
    }
    if(id==='beam'){
      const chisel=new THREE.Mesh(new THREE.BoxGeometry(.4,.013,.025),M.darkWood);chisel.position.set(0,.12,.07);root.add(chisel);
      for(let i=0;i<6;i++){const cut=new THREE.Mesh(new THREE.BoxGeometry(.025,.009,.18),M.black);cut.position.set(-.22+i*.085,.12,-.05);cut.rotation.z=(i%2?.1:-.1);root.add(cut);}
    }
  });
  e33.relicsUpgraded=true;
}
e33UpgradeRelics();

// Open the farmhouse and ruin windows onto actual landscapes, not black panels.
function e33CutWindow(z,wall,centerX,centerY,centerZ,width,height,rotationY=0){
  if(!wall||wall.parent!==z.group)return;
  z.group.remove(wall);
  const left=centerX-width/2,right=centerX+width/2,bottom=centerY-height/2,top=centerY+height/2;
  if(rotationY===0){
    addBox(z.group,(z.bounds.minX+left)/2,centerY,centerZ,(left-z.bounds.minX),z.bounds.maxY-z.bounds.minY,.35,M.wall);
    addBox(z.group,(right+z.bounds.maxX)/2,centerY,centerZ,(z.bounds.maxX-right),z.bounds.maxY-z.bounds.minY,.35,M.wall);
    addBox(z.group,centerX,(top+z.bounds.maxY)/2,centerZ,width,z.bounds.maxY-top,.35,M.wall);
    addBox(z.group,centerX,(bottom+z.bounds.minY)/2,centerZ,width,bottom-z.bounds.minY,.35,M.wall);
  }else{
    const minZ=z.bounds.minZ,maxZ=z.bounds.maxZ;
    addBox(z.group,centerX,(z.bounds.maxY+top)/2,(minZ+maxZ)/2,.35,z.bounds.maxY-top,maxZ-minZ,M.wall);
    addBox(z.group,centerX,(bottom+z.bounds.minY)/2,(minZ+maxZ)/2,.35,bottom-z.bounds.minY,maxZ-minZ,M.wall);
    addBox(z.group,centerX,centerY,(minZ+centerZ-width/2)/2,.35,height,centerZ-width/2-minZ,M.wall);
    addBox(z.group,centerX,centerY,(centerZ+width/2+maxZ)/2,.35,height,maxZ-(centerZ+width/2),M.wall);
  }
}
function e33BuildWindowViews(){
  // Replace the solid back-wall panel with a true aperture matching the false painted window.
  const home=zones.home;
  const homeWall=home.group.children.find(o=>o.isMesh&&o.geometry?.type==='BoxGeometry'&&o.position.x===0&&o.position.y===1.8&&o.position.z===-9&&o.geometry.parameters.width===20);
  if(homeWall){
    home.group.remove(homeWall);
    addBox(home.group,-5.55,1.8,-9,8.9,3.6,.35,M.wall);
    addBox(home.group,5.35,1.8,-9,9.3,3.6,.35,M.wall);
    addBox(home.group,-.2,3.15,-9,1.8,.9,.35,M.wall);
    addBox(home.group,-.2,.51,-9,1.8,1.02,.35,M.wall);
    addBox(home.group,-.2,1.01,-8.77,2.0,.09,.22,M.darkWood);
    addBox(home.group,-.2,2.69,-8.77,2.0,.09,.22,M.darkWood);
  }
  // The abandoned-house side window becomes a slit over a drainage ditch and distant works.
  const ruin=zones.ruin;
  const ruinWall=ruin.group.children.find(o=>o.isMesh&&o.geometry?.type==='BoxGeometry'&&o.position.x===-8&&o.position.y===1.9&&o.position.z===0&&o.geometry.parameters.depth===16);
  if(ruinWall){
    ruin.group.remove(ruinWall);
    addBox(ruin.group,-8,1.9,-4.85,.32,3.8,6.3,M.wall);
    addBox(ruin.group,-8,1.9,4.05,.32,3.8,7.9,M.wall);
    addBox(ruin.group,-8,3.35,-.8,.32,.9,1.8,M.wall);
    addBox(ruin.group,-8,.45,-.8,.32,.9,1.8,M.wall);
  }
  e33AddIndustry(home.group,-.5,-14.8,.30,4);
  e33AddIndustry(ruin.group,-12.5,-1.5,.17,6);
  // Low silhouettes, the canal and the industrial horizon remain visible behind both windows.
  for(let i=0;i<6;i++){
    const tree=new THREE.Group();tree.position.set(-3.8+i*1.45,.05,-13.5-(i%2)*1.2);home.group.add(tree);
    const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.06,.09,2.4,6),M.darkWood);trunk.position.y=1.2;tree.add(trunk);
    for(let j=0;j<5;j++){const branch=new THREE.Mesh(new THREE.ConeGeometry(.28,.9,6),TREE_MATERIALS[(i+j)%TREE_MATERIALS.length]);branch.position.set((j%2?-.12:.12),1.7+j*.22,0);branch.scale.set(1,1.5,1);tree.add(branch);}
  }
  addLight(home.group,0xd18d51,.28,6,.1,1.8,-10.8);
}
e33BuildWindowViews();

// The confession is a quiet discovery; the hand appears behind the lattice only after the answer.
function e33BuildConfessional(){
  const z=zones.church;
  const booth=new THREE.Group();booth.position.set(-6.7,0,1.45);booth.rotation.y=.04;z.group.add(booth);
  addBox(booth,0,1.3,0,2.2,2.6,.28,M.darkWood);
  addBox(booth,0,1.3,-.45,2.25,2.6,.2,M.darkWall);
  addBox(booth,0,2.58,-.2,2.38,.16,.9,M.wood);
  addBox(booth,0,.12,-.2,2.45,.22,1.05,M.wood);
  const grille=new THREE.Group();grille.position.set(0,1.55,.18);booth.add(grille);
  for(let x=-.56;x<=.56;x+=.14){
    const bar=new THREE.Mesh(new THREE.CylinderGeometry(.018,.018,.74,5),M.gold);bar.position.set(x,0,0);grille.add(bar);
  }
  for(let y=-.3;y<=.3;y+=.15){
    const bar=new THREE.Mesh(new THREE.CylinderGeometry(.018,.018,1.2,5),M.gold);bar.rotation.z=Math.PI/2;bar.position.y=y;grille.add(bar);
  }
  const curtain=new THREE.Mesh(new THREE.PlaneGeometry(.52,.75),new THREE.MeshStandardMaterial({color:0x4b1717,roughness:1,side:THREE.DoubleSide}));
  curtain.position.set(.75,1.5,.2);booth.add(curtain);
  const kneeler=addBox(booth,0,.45,.75,1.2,.12,.35,M.darkWood);
  const marker=new THREE.Mesh(new THREE.SphereGeometry(.14,9,7),M.gold);marker.position.set(-6.7,.25,2.8);z.group.add(marker);
  const event={id:'e33_confession',type:'event',repeatable:true,object:marker,point:marker.position,radius:3.5,prompt:'[ E ] ENTER THE CONFESSIONAL',run:()=>{
    if(e33.confessionSeen){e33SetSubtitle('THE CONFESSIONAL','The lattice is empty. The smell of candle wax remains.');return;}
    controls.unlock();dialogueOpen=true;
    e33SetSubtitle('BEHIND THE LATTICE','A voice does not answer your name. It asks what you heard when you tuned the harpsichord.',[
      {label:'Ask who is speaking.',run:()=>{
        e33SetSubtitle('BEHIND THE LATTICE','“I have not heard a sound since 2004. I know when you speak because the air changes against my hand. I have been waiting for someone who can tell me what remains.”',[
          {label:'Ask whether he means Ottavio.',run:()=>e33RevealConfession()},
          {label:'Say nothing.',run:()=>e33RevealConfession()}
        ]);
      }},
      {label:'Ask what Il Bianco will do.',run:()=>{
        e33SetSubtitle('BEHIND THE LATTICE','“It will fill what we have emptied. Memory first. Then the voice. Then the blood. There is no reason to hurry. The room has waited a long time.”',[
          {label:'Ask who has been emptied.',run:()=>e33RevealConfession()},
          {label:'Say nothing.',run:()=>e33RevealConfession()}
        ]);
      }}
    ]);
  }};
  z.interactables.push(event);
  const hand=new THREE.Group();hand.position.set(0,1.45,-.06);hand.visible=false;booth.add(hand);
  const sleeve=new THREE.Mesh(new THREE.CylinderGeometry(.13,.17,.82,10),mat(0x51473e,1,{map:TEX.wood}));sleeve.position.y=-.36;sleeve.rotation.z=-.3;hand.add(sleeve);
  const palm=new THREE.Mesh(new THREE.CapsuleGeometry(.16,.34,5,9),M.skin);palm.position.y=.18;palm.scale.set(1.05,.86,.65);palm.rotation.z=-.2;hand.add(palm);
  const digits=[];
  for(let i=0;i<4;i++){
    const finger=new THREE.Mesh(new THREE.CapsuleGeometry(.035,.24-(Math.abs(1.5-i)*.025),4,7),M.skin);
    finger.position.set(-.12+i*.08,.47,.03);finger.rotation.z=(i-1.5)*.11;hand.add(finger);digits.push(finger);
  }
  const thumb=new THREE.Mesh(new THREE.CapsuleGeometry(.045,.19,4,7),M.skin);thumb.position.set(-.21,.27,.04);thumb.rotation.z=-.75;hand.add(thumb);digits.push(thumb);
  const cold=addLight(hand,0x9cb6b0,.55,4,0,.22,.1);
  e33.confessionHand={group:hand,digits,light:cold,phase:Math.random()*6};
  function e33RevealConfession(){
    e33.confessionSeen=true;e33.handVisible=true;hand.visible=true;hand.position.y=1.45;
    storyFlags.add('ottavio-deafness');storyFlags.add('confessional-hand');
    e32Journal('ottavio-confession','The confession','The man behind the lattice has been deaf since 2004. He has not heard the harpsichord, the bell or the voices in the house. He feels the vibrations through his palm. He has waited for someone else to tell him whether the sound exists.','confession');
    e33SetSubtitle('THE CONFESSIONAL','A hand rises behind the screen. It is not attached to a body you can see. The fingers open once, slowly, as if testing the shape of a note.',[
      {label:'Leave the booth.',run:()=>{e33CloseSubtitle();showToast('THE CONFESSION HAS NOT BEEN ENTERED IN THE LEDGER.');}}
    ]);
    audio?.mechanicalTone(64,38,2.2,'sine',.06,0);
    audio?.mechanicalNoise(.36,980,2.1,.07,.4);glitchPulse=1.1;
  }
  event.reveal=e33RevealConfession;
}
e33BuildConfessional();

// Il Primo's welcome is useful, quiet and carefully noncommittal.
const e33Primo=zones.abattoir.interactables.find(n=>n.type==='npc'&&n.name==='Il Primo');
if(e33Primo){
  if(e33Primo.baconCage)e33Primo.baconCage.visible=false;
  e33Primo.object.rotation.set(0,0,0);
  e33Primo.coat.scale.set(1.02,1.08,.94);
  e33Primo.coat.material.color.setHex(0x4b4942);
  const head=e33Primo.object.children.find(o=>o.isMesh&&o.geometry?.type==='SphereGeometry');
  if(head){head.scale.set(.86,1.12,.9);head.position.set(0,1.7,0);}
  if(e33Primo.leftArm)e33Primo.leftArm.scale.y=1;
  if(e33Primo.rightArm)e33Primo.rightArm.scale.y=1;
  if(e33Primo.photoFace)e33Primo.photoFace.scale.y=.37;
  if(e33Primo.baconCage)e33Primo.baconCage.visible=false;
  e33Primo.dialogue={
    line:'You arrived at the right time. A house is easier to enter when it has a task ready for you. The others will tell you what they need. I will tell you what to do.',
    choices:['Tell me where to begin.','Why are you helping me?'],
    replies:[
      'Elena’s grave first. Find a spade in the abandoned house and dig until you find her name. Then go to the church. Light the seven candles, one at a time. Do not hurry.',
      'Someone did the same for me. You need not trust me yet. Just do the next thing correctly.'
    ]
  };
}
const e33PrimoAtCar=makeNPC(zones.road.group,8.8,21.8,'Il Primo',0x4c4941,1);
const e33PrimoRoadIx=zones.road.interactables.indexOf(e33PrimoAtCar);
if(e33PrimoRoadIx>=0)zones.road.interactables.splice(e33PrimoRoadIx,1);
e33PrimoAtCar.object.visible=false;
e33PrimoAtCar.object.rotation.y=Math.PI;
const e33RoadCar=e33MakeCar(zones.road.group,8.0,23.2);
const carLamp=addLight(zones.road.group,0xe0cda0,.45,12,8.0,.8,20.7);
e33.roadCar=e33RoadCar;

// A second, denser industrial skyline is visible beyond the fields and in the forest.
e33AddIndustry(zones.road.group,53,-10,.9,3);
e33AddIndustry(zones.road.group,-56,36,.62,7);

// The forest exists as a real navigable zone. The road through it leads back to the first arrival point.
function e33BuildForest(){
  const z=newZone('forest',0x242a2b,.047,{minX:-34,maxX:34,minZ:-42,maxZ:40},[0,0,9]);
  addPlane(z.group,0,.012,0,8.2,82,mat(0x343932,1,{map:TEX.concrete}));
  for(let i=0;i<72;i++){
    const side=i%2===0?-1:1;
    const zz=-38+Math.random()*73;
    const xx=side*(5.5+Math.random()*24);
    addTree(z.group,xx,zz,7+Math.random()*9,i+231);
  }
  for(let i=0;i<40;i++){
    const x=(Math.random()-.5)*58,zp=-38+Math.random()*74;
    if(Math.abs(x)<5.2)continue;
    const bush=new THREE.Mesh(new THREE.SphereGeometry(.65+Math.random()*.6,7,6),TREE_MATERIALS[i%TREE_MATERIALS.length]);
    bush.position.set(x,.45,zp);bush.scale.set(1.7,.7,1.2);z.group.add(bush);
  }
  for(let side of [-1,1]){
    for(let i=0;i<8;i++){
      const stump=new THREE.Mesh(new THREE.CylinderGeometry(.16,.29,.7,7),M.darkWood);
      stump.position.set(side*(4.8+Math.random()*2),.33,-27+i*7);stump.rotation.z=(Math.random()-.5)*.18;z.group.add(stump);
    }
  }
  // The forest never hides the industrial horizon completely: pipes and drills puncture the dusk.
  e33AddIndustry(z.group,-23,-25,.62,8);
  e33AddIndustry(z.group,24,-30,.48,2);
  const pylon=new THREE.Group();pylon.position.set(-12,0,-23);z.group.add(pylon);
  for(const side of [-1,1]){
    const beam=new THREE.Mesh(new THREE.CylinderGeometry(.05,.12,13,7),M.rust);beam.position.set(side*1.2,6.5,0);beam.rotation.z=side*.16;pylon.add(beam);
    const foot=addBox(pylon,side*1.2,.15,0,.42,.3,.42,M.darkWood);
  }
  for(let h=4;h<=11;h+=2)addBox(pylon,0,h,0,3.4,.1,.12,M.metal);
  const car=e33MakeCar(z.group,0,9.4);e33.carRoot=car;
  const industrialSign=addBox(z.group,16,1.6,-17,3.2,2.3,.2,M.rust);
  const signText=new THREE.Mesh(new THREE.PlaneGeometry(2.7,.38),new THREE.MeshBasicMaterial({map:makeLabelTexture('CONSORZIO / PO 14-B',512,128),side:THREE.DoubleSide}));
  signText.position.set(16,1.75,-16.88);z.group.add(signText);
  addDoor(z.group,0,37.8,'the first road','road',[0,0,29]);
  z.mist=addFog(z.group,44,68,0x929993,173);
  z.solids.push(
    {minX:-34,maxX:-33.7,minZ:-42,maxZ:40},{minX:33.7,maxX:34,minZ:-42,maxZ:40},
    {minX:-34,maxX:34,minZ:-42.3,maxZ:-42}
  );
  const gate=z.interactables.find(i=>i.destination==='road');
  if(gate)gate.prompt='[ E ] REACH THE ROAD — RETURN TO THE FARMHOUSE';
  return z;
}
const e33Forest=e33BuildForest();
e33.forestZone=e33Forest;
const e33ForestExit=e33Forest.interactables.find(i=>i.destination==='road');
if(e33ForestExit){e33.gate=e33ForestExit;}

// A separate, restrained double of Il Primo for the car scene; only his movements expose him.
const e33ForestPrimo=makeNPC(e33Forest.group,2.1,-13.0,'Il Primo',0x33332e,1);
const forestPrimoIx=e33Forest.interactables.indexOf(e33ForestPrimo);
if(forestPrimoIx>=0)e33Forest.interactables.splice(forestPrimoIx,1);
e33ForestPrimo.object.visible=false;
e33ForestPrimo.object.scale.set(1.02,1.05,1);
e33ForestPrimo.object.rotation.y=Math.PI;
e33.forestPrimo=e33ForestPrimo;
const e33Iron=new THREE.Mesh(new THREE.CylinderGeometry(.035,.065,.82,7),M.rust);
e33Iron.position.set(.47,.75,.13);e33Iron.rotation.z=.38;e33ForestPrimo.object.add(e33Iron);

function e33StartCarRide(){
  if(e33.carRideStarted||!e33.carInvitation)return;
  e33.carRideStarted=true;e33.carPhase='drive';e33.carTimer=0;e33.escapeElapsed=0;
  const carIndex=zones.road.interactables.indexOf(e33CarEvent);if(carIndex>=0)zones.road.interactables.splice(carIndex,1);
  e33ForestPrimo.object.visible=false;
  enterZone('forest',[.43,0,9.8]);
  playerAnchor.position.set(.43,0,9.8);
  camera.position.set(0,1.26,0);camera.rotation.set(0,0,0);
  camera.fov=63;camera.updateProjectionMatrix();
  controls.unlock();dialogueOpen=false;keys.clear();velocity.set(0,0,0);
  e33SetSubtitle('IL PRIMO / CAR','The road leaves the fields behind. Il Primo does not turn on the radio. He says the drive is short, and that the others will not miss you.',[]);
  audio?.setZone('ruin');audio?.mechanicalTone(45,32,5.5,'sine',.08,0);
  audio?.mechanicalNoise(2.1,125,1.2,.06,.1);
  e33UpdateMission();
}
const e33CarEventMarker=new THREE.Mesh(new THREE.SphereGeometry(.14,9,7),M.gold);
e33CarEventMarker.position.set(7.0,.35,21.4);zones.road.group.add(e33CarEventMarker);
const e33CarEvent={id:'e33_car_ride',type:'event',repeatable:true,object:e33CarEventMarker,point:e33CarEventMarker.position,radius:4.1,prompt:'[ E ] GET INTO IL PRIMO’S CAR',enabled:false,run:()=>e33StartCarRide()};

function e33UpdateCarScene(dt,t){
  if(e33.carPhase==='drive'){
    e33.carTimer+=dt;
    e33.carRoot.position.z-=dt*1.72;
    playerAnchor.position.set(.43,0,e33.carRoot.position.z+.36);
    camera.position.set(0,1.26,0);
    camera.rotation.y=Math.sin(t*.0007)*.035;
    camera.rotation.x=Math.sin(t*.00045)*.012;
    if(e33.carTimer>4&&e33.carTimer<4+dt*1.5){
      e33SetSubtitle('IL PRIMO / CAR','You have been here before, he says. You only do not remember the first time.',[]);
    }
    if(e33.carTimer>8&&e33.carTimer<8+dt*1.5){
      e33SetSubtitle('IL PRIMO / CAR','He points through the passenger window. Between the trees, a line of factory offices glows without anyone moving inside.',[]);
      audio?.mechanicalNoise(1.1,210,1.3,.07,-.35);
    }
    if(e33.carTimer>13){
      e33.carPhase='stop';e33.carTimer=0;
      e33SetSubtitle('IL PRIMO / CAR','The engine stops. The forest has been cut into a circle around the car. On the horizon, a drill turns slowly behind the trees.',[]);
      audio?.mechanicalTone(58,29,3.2,'sawtooth',.07,0);
      audio?.mechanicalEvent('latch');
    }
  }else if(e33.carPhase==='stop'){
    e33.carTimer+=dt;
    if(e33.carTimer>3.2){
      e33.carPhase='betrayal';e33.carTimer=0;
      e33ForestPrimo.object.position.set(-1.8,0,e33.carRoot.position.z+.5);
      e33ForestPrimo.object.visible=true;e33ForestPrimo.object.lookAt(playerAnchor.position.x,0,playerAnchor.position.z);
      e33SetSubtitle('IL PRIMO','You have done everything correctly. The grave. The candles. You have made room for the others.',[]);
      audio?.mechanicalNoise(.22,1600,5,.09,0);glitchPulse=1;
    }
  }else if(e33.carPhase==='betrayal'){
    e33.carTimer+=dt;
    e33ForestPrimo.object.rotation.y=Math.atan2(playerAnchor.position.x-e33ForestPrimo.object.position.x,playerAnchor.position.z-e33ForestPrimo.object.position.z);
    e33ForestPrimo.rightArm.rotation.z=-.8-Math.min(1,e33.carTimer*.2);
    e33ForestPrimo.object.position.x+=Math.sin(t*.004)*.001;
    if(e33.carTimer>2.6){
      e33.carPhase='escape';e33.escapeElapsed=0;
      playerAnchor.position.set(.2,0,e33.carRoot.position.z+1.8);
      camera.position.set(0,1.63,0);camera.rotation.set(0,Math.PI,0);
      camera.fov=72;camera.updateProjectionMatrix();
      e33ForestPrimo.object.position.set(-1.8,0,playerAnchor.position.z-3.1);
      e33ForestPrimo.object.rotation.y=Math.PI;
      e33SetSubtitle('IL PRIMO','You were not brought here to listen. You were brought here to be emptied.',[
        {label:'RUN.',run:()=>{e33CloseSubtitle();}}
      ]);
      dialogueOpen=true;controls.unlock();glitchPulse=1.4;audio?.killSting();
      showToast('HE IS COMING. RUN BACK TO THE ROAD.');
      storyFlags.add('primo-betrayal');
    }
  }else if(e33.carPhase==='escape'){
    e33.escapeElapsed+=dt;
    const p=playerAnchor.position;
    const enemy=e33ForestPrimo.object;
    const dx=p.x-enemy.position.x,dz=p.z-enemy.position.z;
    const dist=Math.hypot(dx,dz);
    if(dist>0.001){
      enemy.position.x+=(dx/dist)*dt*3.62;
      enemy.position.z+=(dz/dist)*dt*3.62;
      enemy.object?.rotation?.set?.(0,Math.atan2(dx,dz),0);
      enemy.rotation.y=Math.atan2(dx,dz);
      enemy.leftArm.rotation.z=-.35+Math.sin(t*.014)*.26;
      enemy.rightArm.rotation.z=.55+Math.sin(t*.014+1)*.28;
    }
    if(e33.escapeElapsed>2.0&&Math.floor(e33.escapeElapsed*1.25)!==Math.floor((e33.escapeElapsed-dt)*1.25)){
      audio?.mechanicalNoise(.16,145+Math.random()*70,1.8,.04,.18);
      audio?.mechanicalTone(42,29,.34,'sine',.022,0);
    }
    if(dist<1.25){triggerDeath('IL PRIMO HAS TAKEN YOUR PLACE.');return;}
    // Reach the gate and press E. The threshold is the same road where the newcomer arrived.
  }else if(e33.carPhase==='escaped'){
    e33.carTimer+=dt;
    if(e33.carTimer>3.4){e33.carPhase='complete';e33.carTimer=0;e33UpdateMission();}
  }
}
function e33UpdateForestEnemy(dt,t){
  if(currentZone!=='forest'||e33.carPhase!=='escape')return;
  const enemy=e33ForestPrimo.object;
  if(!enemy.visible)enemy.visible=true;
  e33UpdateCarScene(dt,t);
}
function e33BuildIndustrialSound(dt,t){
  if(currentZone!=='road'&&currentZone!=='forest')return;
  e33.industrialClock-=dt;
  if(e33.industrialClock<=0){
    e33.industrialClock=currentZone==='forest'?2.1+Math.random()*2.6:3.5+Math.random()*4.2;
    const pan=(Math.random()-.5)*1.2;
    audio?.mechanicalTone(currentZone==='forest'?38:54,currentZone==='forest'?24:32,2.8+Math.random()*2,'sawtooth',currentZone==='forest'?.055:.034,pan);
    if(Math.random()>.35)audio?.mechanicalNoise(.9+Math.random(),currentZone==='forest'?310:220,1.3,.045,pan);
  }
}

// The candle ceremony is a task, not a decorative switch: seven individual flames are lit in sequence.
function e33BuildCandleEvent(){
  const z=zones.church;
  const marker=new THREE.Mesh(new THREE.SphereGeometry(.13,9,7),M.gold);marker.position.set(0,.3,-8.8);z.group.add(marker);
  const event={id:'e33_candle_rite',type:'event',repeatable:true,object:marker,point:marker.position,radius:3.8,prompt:'[ E ] LIGHT THE SEVEN CANDLES',run:()=>{
    if(!e33.primoWelcomed){showToast('IL PRIMO HAS NOT GIVEN YOU THIS TASK.');return;}
    if(e33.candlesLit){showToast('THE CANDLES ARE STILL BURNING.');return;}
    e33SetSubtitle('THE ALTAR','Seven candles. Seven places in the order. The wax has already been warmed by someone else.',[
      {label:'Light the first candle.',run:()=>{
        e33CloseSubtitle();controls.unlock();
        e33.candleObjects.forEach((c,i)=>{
          setTimeout(()=>{
            c.lit=true;c.flame.visible=true;c.smoke.active=true;
            c.light.intensity=.75+Math.random()*.24;
            audio?.mechanicalNoise(.10,1900-i*90,6,.035,0);
            audio?.mechanicalTone(160-i*8,80-i*4,.36,'triangle',.024,0);
          },i*610);
        });
        setTimeout(()=>{
          e33.candlesLit=true;e32Quest.candles=true;storyFlags.add('candles-lit');
          e32Journal('seven-candles','Seven candles','Each wick has been cut to the same length. The first is blackened already, though the wax below it has never melted. The seven flames burn at slightly different heights, as if they are answering seven people who are not in the church.','ritual');
          showToast('THE SEVEN CANDLES ARE LIT. IL PRIMO WILL BE PLEASED.');
          e33UpdateMission();
        },e33.candleObjects.length*610+300);
      }}
    ]);
    dialogueOpen=true;controls.unlock();
  }};
  z.interactables.push(event);e33.candleEvent=event;
}
e33BuildCandleEvent();


// Rebuild the thirteen as people with different reasons for staying, not as generic occult NPCs.
function e33SetCultDialogue(name,line,choices,replies){
  const npc=cultRoster.find(n=>n.name.toLowerCase()===name.toLowerCase());
  if(npc)npc.dialogue={line,choices,replies};
}
e33SetCultDialogue('Ines',
  'You must be Tobia. Leave your case by the stairs. There is soup if you want it. Nobody here will ask you to explain why you came.',
  ['Thank her and sit down.','Ask how long the others have been here.'],
  ['You look cold. Eat first. There will be time for names later.','Long enough to know which floorboards complain. Not long enough to leave them behind.']);
e33SetCultDialogue('Ottavio',
  'Put your hand here. Not on the keys. On the wood. The instrument has a pulse before it has a note.',
  ['Ask what he can hear.','Ask whether he has heard Il Bianco.'],
  ['Tell me when the beating between the strings stops. I can follow that.','I have never heard it. I want to know whether there is anything to hear.']);
e33SetCultDialogue('Anna',
  'There is a place for you. The plate is warm. My husband used to sit there, but he has not been home for a long time.',
  ['Ask whether she expects him back.','Offer to clear the place.'],
  ['He knows the way. He will come when the house is ready.','No. Leave it. He dislikes finding the table changed.']);
e33SetCultDialogue('Dario',
  'The Mass is not a performance. The words are older than the people saying them. The room does not care whether you believe.',
  ['Ask what the Mass is preparing them for.','Ask why he serves Don Remo.'],
  ['For the arrival of Il Bianco. We must be empty before it comes.','He remembers every word. I only make sure the room is ready.']);
e33SetCultDialogue('Sergio',
  'I used to come here because I believed. Now I come because they know when I am not at the table.',
  ['Ask when he stopped believing.','Ask why he does not leave.'],
  ['I could not tell you the day. It happened in the same way as getting old.','The road is there. I know it. I have driven it all my life.']);
e33SetCultDialogue('Marta',
  'I cut the memories into the beams. The wood holds them better than the people do. Some of them ask me to stop. Later they ask me to continue.',
  ['Ask what she is engraving now.','Ask whether she remembers her own childhood.'],
  ['A list. It has thirteen lines, but the last one has no name.','I remember the colour of a kitchen. I cannot remember who was in it.']);
e33SetCultDialogue('Pino',
  'I drove lorries for twenty years. You learn how to leave a place without saying goodbye. Here I keep finding reasons to stay one more night.',
  ['Ask him to show you the road out.','Ask what keeps him here.'],
  ['I can show you the road. I cannot promise it will take you anywhere.','A bed, a meal, a warm room. Small things become heavy when you have been without them.']);
e33SetCultDialogue('Livia',
  'Livia does not answer. She watches your mouth, then hums a phrase that falls by a semitone before it resolves.',
  ['Wait for her to finish.','Ask Ines why Livia will not speak.'],
  ['The note stops. Her mouth remains open for a moment.','She used to sing in the parish choir. Now she gives the words back without speaking them.']);
e33SetCultDialogue('Gabri',
  'The refrigerator light makes the kitchen look like morning. I sit here when I cannot sleep. The others say I am nearly ready.',
  ['Ask what he is ready for.','Ask him to come outside.'],
  ['They say I will feel full. I do not know what that means.','Outside is colder. The light here does not ask anything of me.']);
e33SetCultDialogue('Noemi',
  'Elia knows what I am going to say. Usually he says it first. It saves time. Sometimes I wish he would wait.',
  ['Ask her what she wants to say alone.','Ask where Elia is.'],
  ['I wanted to say that I am afraid. I have not said it before.','He is close. He is always close.']);
e33SetCultDialogue('Franco',
  'The butcher’s work is simple. You separate what belongs together and make it fit on the table. People are harder. They keep their names.',
  ['Ask what he is preparing.','Ask why he is hungry.'],
  ['A meal for the Mass. It is not for the living, though the living will eat it.','It is not the stomach. It is the part that remembers having enough.']);
e33SetCultDialogue('Elia',
  'Noemi finishes my sentences. I finish hers. We have done it so long that I no longer know which one of us began.',
  ['Ask him to let Noemi speak.','Ask what he fears.'],
  ['She can speak whenever she wants. I am not holding her mouth shut.','The day she says something I cannot finish.']);
e33SetCultDialogue('Don Remo',
  'The words of the Mass remain after belief has left the mouth. I have not found another language that can hold what happens here.',
  ['Ask what Il Bianco promises.','Ask whether he still believes in God.'],
  ['That the empty can be filled. The rest is not for me to describe.','I still know the prayers. I no longer know who receives them.']);
const e33OriginalChoose=chooseDialogue;
chooseDialogue=function(npc,index){
  e33OriginalChoose(npc,index);
  const name=(npc?.name||'').toLowerCase();
  if(name==='il primo'){
    if(index===0){
      e33.primoWelcomed=true;storyFlags.add('primo-welcome');storyFlags.delete('challenged-leader');storyFlags.add('accepted-leader');
      showToast('IL PRIMO HAS GIVEN YOU A TASK. THE OTHERS ARE WAITING.');
    }else{
      e33.primoWelcomed=true;
      storyFlags.add('primo-questioned');storyFlags.add('challenged-leader');storyFlags.delete('accepted-leader');
      showToast('IL PRIMO DOES NOT ANSWER THE QUESTION. HE SMILES INSTEAD.');
    }
    e33UpdateMission();
  }
  if(name==='ottavio'&&index===1){
    storyFlags.add('ottavio-audio');
    e32Journal('ottavio-sound','Ottavio’s lesson','Ottavio asks you to describe the beat between two strings. He does not ask whether the note is correct. He asks when the sound stops being wrong.','conversation');
  }
  if(name==='ines'&&index===0)storyFlags.add('ines-trust');
  if(name==='sergio'&&index===0){
    storyFlags.add('sergio-truth');
    e32Journal('sergio-sun','Sergio’s sunlight','Sergio says he stopped believing years ago. He stayed because no one else waited with him. Outside his window, a patch of real sunlight falls across an empty chair.','conversation');
  }
  e33UpdateMission();
};
const e33OriginalUpdateProgress=updateProgress;
updateProgress=function(){
  e33OriginalUpdateProgress();
  if(e33.primoWelcomed||e33.carRideComplete)e33UpdateMission();
};
const e33OriginalEnterZone=enterZone;
enterZone=function(name,spawn){
  e33OriginalEnterZone(name,spawn);
  if(name==='forest'){
    $('location').textContent='THE FOREST / THE ROAD BACK';
    scene.background.set(0x202829);scene.fog=new THREE.FogExp2(0x68716d,.047);
    audio?.setZone('ruin');
  }
  e33UpdateMission();
};
const e33BaseInspect=inspectTarget;
inspectTarget=function(item){
  if(item?.id==='e33_car_ride'&&!item.enabled){showToast('IL PRIMO HAS NOT INVITED YOU YET.');return;}
  if(item?.type==='door'&&currentZone==='forest'&&e33.carPhase==='escape'&&item.destination==='road'){
    e33.carPhase='escaped';e33.carRideComplete=true;e32Quest.car=true;
    storyFlags.add('escaped-primo');
    e33BaseInspect(item);
    camera.rotation.set(0,0,0);velocity.set(0,0,0);controls.unlock();
    e33SetSubtitle('THE ROAD','The same mailbox. The same fog. The farmhouse is where you left it. The road has not brought you any farther away.',[
      {label:'Go back to the house.',run:()=>{e33CloseSubtitle();}}
    ]);
    dialogueOpen=true;e33UpdateMission();return;
  }
  e33BaseInspect(item);
};
const e33OriginalInput=playerInputEnabled;
playerInputEnabled=function(){
  if(e33.carPhase==='drive'||e33.carPhase==='stop'||e33.carPhase==='betrayal')return false;
  return e33OriginalInput();
};
const e33OriginalHorror=updateHorror;
updateHorror=function(dt,t){
  if(currentZone==='forest'){
    // The cinematic and pursuit are advanced once per frame by animateZone.
    return;
  }
  e33OriginalHorror(dt,t);
};
const e33OriginalDayNight=updateDayNight;
updateDayNight=function(dt,t){
  e33OriginalDayNight(dt,t);
  if(currentZone==='forest'){
    const dusk=new THREE.Color(0x5d625e).lerp(new THREE.Color(0x151c21),Math.min(.84,.52+dayNightBlend*.3));
    scene.background.copy(dusk);if(scene.fog?.color)scene.fog.color.copy(dusk);
    zones.forest.ambient.intensity=.17;zones.forest.moon.intensity=.44;
    zones.forest.moon.color.setHex(0x7c897f);
  }
};
const e33OriginalWeather=updateWeather;
updateWeather=function(dt,t){
  e33OriginalWeather(dt,t);
  if(currentZone==='forest'){
    rainPoints.visible=true;rainStreaks.visible=true;
    const p=currentPosition();rainPoints.position.set(p.x,0,p.z);rainStreaks.position.set(p.x,0,p.z);
  }
};
const e33OriginalAnimate=animateZone;
animateZone=function(t,dt){
  e33OriginalAnimate(t,dt);
  for(const candle of e33.candleObjects){
    const flicker=.86+Math.sin(t*.012+candle.phase)*.10+Math.sin(t*.043+candle.phase*2)*.045;
    candle.flame.scale.set(.9+flicker*.13, .92+flicker*.16, .9+flicker*.13);
    candle.light.intensity=candle.lit?(.68+flicker*.35):0;
    candle.flame.rotation.z=Math.sin(t*.008+candle.phase)*.08;
  }
  for(const emitter of e33.smokeEmitters){
    emitter.particles.forEach((s,i)=>{
      const active=emitter.active;
      const cycle=(t*.00013+s.userData.phase+i*.11)%1;
      s.position.x=emitter.x+Math.sin(t*.00037+s.userData.phase)*emitter.scale*.13;
      s.position.y=s.userData.baseY+cycle*emitter.scale*2.7;
      s.position.z=emitter.z+Math.cos(t*.00029+s.userData.phase)*emitter.scale*.12;
      s.material.opacity=active?.11*(1-cycle):.015;
      s.scale.set(emitter.scale*(.7+cycle*1.7),emitter.scale*(.8+cycle*2.2),1);
    });
  }
  if(e33.confessionHand?.group.visible){
    const h=e33.confessionHand.group;
    h.position.y=1.45+Math.sin(t*.0013+e33.confessionHand.phase)*.27;
    h.rotation.z=Math.sin(t*.0011)*.11;
    e33.confessionHand.digits.forEach((d,i)=>{d.rotation.z+=Math.sin(t*.002+i)*.0008;});
    e33.confessionHand.light.intensity=.45+Math.sin(t*.004)*.18;
  }
  if(e33.carPhase!=='idle'&&e33.carPhase!=='complete'&&e33.carPhase!=='escaped')e33UpdateCarScene(dt,t);
  e33BuildIndustrialSound(dt,t);
};
const e33OriginalHud=updateHud;
updateHud=function(dt){e33OriginalHud(dt);e33UpdateMission();};
const e33OriginalFinish=finishListening;
finishListening=function(){
  e33OriginalFinish();
  const expose=$('ending-expose'),lie=$('ending-fill'),loop=$('ending-preserve');
  if(expose){expose.querySelector('span').textContent='TELL THEM THE TRUTH';expose.querySelector('small').textContent='“There was nothing. It was only music.”';}
  if(lie){lie.querySelector('span').textContent='SAY YOU HEARD IT';lie.querySelector('small').textContent='Give them the proof they have been waiting for.';}
  if(loop){loop.querySelector('span').textContent='DO NOT ANSWER';loop.querySelector('small').textContent='Leave the door open. Let the fog return.';}
  $('ending-title').textContent='The White has not been heard.';
  $('ending-copy').textContent='The needle falls. The room is still here. Thirteen people wait for the sound to become something. You are the fourteenth.';
  $('ending-small').textContent='THE LISTENING / STATION XII';
};
const e33OriginalEnding=resolveEnding;
resolveEnding=function(choice){
  const hasCar=storyFlags.has('primo-betrayal')&&storyFlags.has('escaped-primo');
  if(choice==='expose'){
    e33OriginalEnding(choice);
    $('ending-title').textContent='The truth that does not count.';
    $('ending-copy').textContent='“There was nothing. It was only music.” Ines smiles, almost with pity. “Everyone who comes back up says that.” Ottavio lays his palm against your chest to feel you speak. He nods. The truth has been absorbed as proof.';
    $('ending-small').textContent='ENDING B / THE TRUTH THAT DOES NOT COUNT';
  }else if(choice==='fill'){
    e33OriginalEnding(choice);
    $('ending-title').textContent='The lie.';
    $('ending-copy').textContent='You tell them you heard it. The relief is immediate. Ines closes her eyes. Ottavio keeps his hand on the soundboard. No one asks what you heard. They only thank you for confirming that the room is ready.';
    $('ending-small').textContent='ENDING A / THE LIE';
  }else if(choice==='preserve'){
    e33OriginalEnding(choice);
    $('ending-title').textContent='The loop only.';
    $('ending-copy').textContent='You leave without answering. The door opens onto the same white fog. Headlights approach along the road. Someone is coming to the farmhouse, carrying an empty case. You know what you are supposed to do.';
    $('ending-small').textContent='ENDING C / THE LOOP ONLY';
  }
  if(hasCar)$('ending-copy').textContent += ' Il Primo brought you to the forest to empty you. He gave you a purpose only to make you useful to the last station.';
};
$('start-screen').querySelector('.eyebrow').textContent='THE NEW ARRIVAL / DOCUMENT 14-B';
$('start-screen').querySelector('.subtitle-title').textContent='IL BIANCO — THE ALBUM NO ONE HAS HEARD';
$('start-screen').querySelector('.start-copy').innerHTML='You have arrived at a farmhouse in the Po Valley to tune a harpsichord.<br>The fog has closed the roads. Thirteen people are waiting. You are the newest arrival.';
$('start-screen').querySelector('.start-quote').textContent='“I can hear when something stops being wrong.”';
$('start-button').innerHTML='ENTER THE HOUSE <span>→</span>';
$('start-screen').querySelector('.controls-note').innerHTML='W A S D — MOVE &nbsp; / &nbsp; MOUSE — LOOK &nbsp; / &nbsp; E — INTERACT<br>F — FLASHLIGHT &nbsp; / &nbsp; SHIFT — RUN &nbsp; / &nbsp; TAB — JOURNAL &nbsp; / &nbsp; M — SOUND<br>HOLD Q — HOLD YOUR BREATH &nbsp; / &nbsp; Z — INSPECT / ZOOM &nbsp; / &nbsp; X — RESET VIEW';
$('objective').querySelector('.micro-label').textContent='YOUR FIRST NIGHT';
$('mission-panel').querySelector('.mission-heading span').textContent='IL PRIMO’S INSTRUCTIONS';
$('mission-line').textContent='Find the farmhouse. They have been expecting the piano tuner.';
$('inspect-hint').textContent='[ Z ] INSPECT / ZOOM &nbsp; · &nbsp; [ X ] RESET VIEW';
$('subtitle-help').textContent='[1] / [2] CHOOSE · [ESC] CLOSE';
$('journal-button').innerHTML='JOURNAL <b>[TAB]</b>';
$('journal-close').textContent='CLOSE [TAB]';
$('torch-state').textContent='ON';
$('death-title').textContent='The room has kept you.';
$('death-copy').textContent='Someone continued counting after you stopped.';
$('death-screen').querySelector('.ending-small').textContent='RECORDING CANNOT BE RECOVERED';
$('retry-button').innerHTML='RETURN TO THE BEGINNING <span>↺</span>';
$('ending-fill').querySelector('b').textContent='I';
$('ending-expose').querySelector('b').textContent='II';
$('ending-preserve').querySelector('b').textContent='III';
e33UpdateMission();
updateProgress();
