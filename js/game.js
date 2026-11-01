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
  fatal.textContent = `WEBGL NON DISPONIBILE.\nApri il gioco in un browser desktop aggiornato con accelerazione grafica attiva.\nDettaglio: ${error.message}`;
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
    ctx.fillStyle='#3d392f';ctx.font='14px monospace';ctx.fillText('NEGATIVO / NON SVILUPPATO',256,113);ctx.fillText('ORA: 03:17',256,143);ctx.fillText('EMULSIONE DANNEGGIATA',256,173);
    ctx.strokeStyle='#29251f';ctx.lineWidth=1;for(let i=0;i<9;i++){ctx.beginPath();ctx.moveTo(256,200+i*12);ctx.lineTo(470-(i%3)*25,200+i*12);ctx.stroke();}
    ctx.fillStyle='rgba(50,35,25,.45)';ctx.font='italic 18px serif';ctx.fillText('non guardare troppo a lungo',30,312);
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
  const entry = { id, type: 'clue', object: root, point: root.position, radius: 3.0, prompt: `[ E ] RACCOGLI — ${title.toUpperCase()}`, title, description, kind };
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
  const npc = { id: `npc_${name.toLowerCase().replace(/\W/g, '_')}`, type: 'npc', object: root, point: root.position, radius: 3.4, prompt: `[ E ] PARLA — ${name.toUpperCase()}`, name, phase: Math.random() * 7, coat, leftArm, rightArm, photoFace, photoBody, photoKey, leftForearm, rightForearm, legs, shoes, eyes, lids, blinkTimer:1.8+Math.random()*4, blinkAmount:0, walking:false, cultist:false, fate:'present' };
  photoNPCs.push(npc); refreshPhotoNPC(npc);
  group.userData.interactables.push(npc); return npc;
}
function registerCultist(npc, dialogue=null) {
  npc.cultist=true; npc.fate='present'; npc.object.userData.cultist=true;
  if(dialogue) npc.dialogue=dialogue;
  cultRoster.push(npc); return npc;
}
function addCultist(zone, x, z, name, coat=0x34332f, variant=0, line='Non siamo qui per ascoltare. Siamo qui per lasciare spazio.', choices=['Che cosa aspettate?','Chi vi ha convocati?'], replies=['Il momento in cui qualcuno smette di avere un nome.','La stanza era già piena prima che arrivassimo.']) {
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
  if(entry.mode==='collapse') speakVoice(`${npc.name}. Non c'è più niente da riempire.`,npc.name);
  else speakVoice(`${npc.name}: non ricordare il mio volto.`,npc.name);
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
  const entry = { id: `door_${destination}`, type: 'door', object: root, point: root.position, radius: 3.3, prompt: locked ? '[ E ] LA BOTOLA È BLOCCATA' : `[ E ] ENTRA — ${label.toUpperCase()}`, label, destination, spawn, locked, slab };
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
function addManifesto(group, position, rotation, headline, subline='ARCHIVIO 14-B / FOGLIO NON PROTOCOLLATO') {
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
  const victim=cultRoster.find(n=>n.name==='Nino'&&['present','queued'].includes(n.fate));
  const executioner=cultRoster.find(n=>n.name==='Dario'&&['present','queued'].includes(n.fate));
  if(!victim || !executioner){
    storyFlags.add('empty-choir');
    audio?.mechanicalEvent('bell');
    showToast('LA NAVATA È PIENA SOLTANTO DELLA REGISTRAZIONE.');
    return;
  }
  removeQueuedCultist(victim);removeQueuedCultist(executioner);
  victim.fate='present';executioner.fate='present';
  transferCultist(victim,z,0,-1.9);transferCultist(executioner,z,2.7,-2.1);
  victim.object.scale.set(1.0,.9,1.0);victim.prompt='';executioner.object.scale.set(1.12,1.1,1.12);executioner.prompt='';
  for(const npc of [victim,executioner]){const ix=z.interactables.findIndex(v=>v.id===npc.id);if(ix>=0)z.interactables.splice(ix,1);}
  const stain=new THREE.Mesh(new THREE.CircleGeometry(.85,32),new THREE.MeshBasicMaterial({color:0x270708,transparent:true,opacity:0}));
  stain.rotation.x=-Math.PI/2;stain.position.set(0,.015,-1.8);z.group.add(stain);
  const event={id:'cantore_scene',type:'event',object:victim.object,point:victim.object.position,radius:4.8,prompt:'[ E ] RESTA NELLA NAVATA',done:false,run:()=>{
    if(event.done)return;event.done=true;controls.unlock();dialogueOpen=true;
    $('speaker').textContent='REGISTRAZIONE / 03:17';
    $('subtitle').textContent='Dario inclina la testa. Il cantore smette di cantare. La campana continua a vibrare, anche se nessuno la tocca. Una voce, dal campanile, pronuncia un nome che non è il suo.';
    speakVoice('Dario inclina la testa. Il cantore smette di cantare. La campana continua a vibrare, anche se nessuno la tocca.','REGISTRAZIONE');
    $('subtitle-wrap').classList.add('visible');$('dialogue-options').innerHTML='<button class="dialogue-option" id="event-continue"><b>[↵]</b>Non guardare più.</button>';
    $('event-continue').onclick=()=>{
      if('speechSynthesis'in window)window.speechSynthesis.cancel();$('subtitle-wrap').classList.remove('visible');dialogueOpen=false;
      stain.material.opacity=.82;victim.object.rotation.x=1.42;victim.object.position.y=-.45;victim.fate='dead';victim.object.visible=true;
      executioner.object.position.set(3.8,0,-3.7);executioner.object.rotation.y=Math.PI;executioner.fate='present';
      queueCultFate('la navata',executioner,'vanish');scheduleCultSceneFates(1,'la campana','collapse');
      fear=Math.min(1,fear+.28);glitchPulse=1.2;audio?.killSting();controls.lock();showToast('IL CANTORE È STATO TOLTO DALLA REGISTRAZIONE.');
    };
  }};
  z.interactables.push(event);
}
function triggerAnnaScene(z, annaMarker) {
  const anna=cultRoster.find(n=>n.name==='Anna');
  if(!anna || !annaMarker)return;
  const stain=new THREE.Mesh(new THREE.CircleGeometry(.62,28),new THREE.MeshBasicMaterial({color:0x260607,transparent:true,opacity:0}));
  stain.rotation.x=-Math.PI/2;stain.position.set(-5.2,.018,1.2);z.group.add(stain);
  const ev={id:'anna_scene',type:'event',object:annaMarker,point:annaMarker.position,radius:3.4,prompt:'[ E ] GUARDA LA SEDIA',done:false,run:()=>{
    if(ev.done)return;ev.done=true;controls.unlock();dialogueOpen=true;
    const annaStillPresent=['present','queued'].includes(anna.fate);
    $('speaker').textContent='ANNA / CUCINA';
    $('subtitle').textContent=annaStillPresent?'Anna posa il piatto davanti a un posto vuoto. «Lui mangia soltanto quando nessuno lo guarda». La luce della cucina si spegne.':'Il piatto è ancora caldo. La sedia è vuota da prima che tu entrassi. Qualcuno continua a masticare dall’interno del muro.';
    speakVoice($('subtitle').textContent,'Anna');$('subtitle-wrap').classList.add('visible');
    $('dialogue-options').innerHTML='<button class="dialogue-option" id="anna-continue"><b>[↵]</b>Resta immobile.</button>';
    $('anna-continue').onclick=()=>{
      if('speechSynthesis'in window)window.speechSynthesis.cancel();$('subtitle-wrap').classList.remove('visible');dialogueOpen=false;
      if(annaStillPresent){
        removeQueuedCultist(anna);if(anna.object.parent!==z.group)transferCultist(anna,z,-5.2,1.2);
        anna.object.position.set(-5.2,-.35,1.2);anna.object.rotation.x=1.35;anna.object.visible=true;anna.fate='dead';
        stain.material.opacity=.72;z.group.children.filter(c=>c.isPointLight).forEach(l=>l.intensity*=.22);
        fear=Math.min(1,fear+.22);glitchPulse=1;audio?.killSting();scheduleCultSceneFates(1,'il posto a tavola','vanish');
        showToast('IL POSTO A TAVOLA È STATO OCCUPATO.');
      }else{
        storyFlags.add('anna-empty-place');stain.material.opacity=.42;audio?.mechanicalEvent('drawer');glitchPulse=1.1;
        showToast('LA SEDIA ERA VUOTA PRIMA DELLA TUA SCELTA.');
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
  addDoor(z.group, 0, -7.0, 'la casa', 'home', [0, 0, 6.2]);
  addDoor(z.group, 37, -17.1, 'la chiesa', 'church', [0, 0, 9.4]);
  addDoor(z.group, -36, -8.6, 'la casa vuota', 'ruin', [0, 0, 5.8]);
  addDoor(z.group, 27, 28.3, 'la casa delle bestie', 'abattoir', [0,0,7.0]);
  addManifesto(z.group,[-9.5,2.0,-5.8],[0,.12,0],'SVUOTARSI\nPER ESSERE RIEMPITI','AFFISSO DEL CONSORZIO / 1977');
  addManifesto(z.group,[15.5,1.85,14.1],[0,Math.PI,0],'13 + 1 = 0','FOGLIO APPESO DAL LATO SBAGLIATO');
  // Clue at the roadside mailbox.
  addBox(z.group, -4.5, .63, 20, .55, 1.25, .48, M.rust);
  addBox(z.group, -4.5, 1.32, 20, .7, .09, .58, M.darkWood);
  addClueMesh(z.group, new THREE.Vector3(-4.0, .83, 19.7), 'Cronaca 1977', 'Un ritaglio locale racconta di un coro trovato morto in una chiesa di campagna nell’inverno del 1977. Il registratore continuò a girare. Il giornale non nomina il disco.', 'clipping', 'paper');
  // A wet-coated figure at the bridge, more like a stain than a person.
  const woman = makeNPC(z.group, -31, -3, 'La donna al canale', 0x242a28, 1);
  woman.prompt = '[ E ] PARLA — LA DONNA AL CANALE';
  woman.dialogue = {
    line: 'L’acqua non scorre verso il mare. Scorre verso il giorno in cui è stata versata.',
    choices: ['Che cosa è successo qui?', 'Non ti conosco.'],
    replies: ['Hanno chiuso la chiesa, ma hanno lasciato aperta la registrazione.', 'È meglio così. I nomi fanno entrare aria.']
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
  const tv = new THREE.Mesh(new THREE.PlaneGeometry(1.75, 1.2), new THREE.MeshBasicMaterial({ map: makeLabelTexture('DOMANDA N. 14', 512, 256), color: 0xb3b1a7 })); tv.position.set(-1.2, 1.42, -8.02); z.group.add(tv);
  addManifesto(z.group,[-9.78,2.1,-2.6],[0,Math.PI/2,0],'NON ASCOLTARE\nPER CAPIRE','CIRCOLARE 14-B');
  addManifesto(z.group,[.0,3.28,-8.78],[0,0,0],'IL VUOTO\nÈ UNA PORTA','SCRITTO CON FULIGGINE');
  // Pictures face the wall, not the room.
  const frame = addBox(z.group, 2.1, 2.25, -8.72, 1.0, .75, .08, M.gold); addBox(z.group, 2.1, 2.25, -8.66, .82, .58, .025, M.darkWall);
  // Characters.
  const ines = registerCultist(makeNPC(z.group, -6.5, -.2, 'Ines', 0x52483d, 0),{ line: 'La cucina resta calda anche quando nessuno ha fame. Siediti. Non serve che tu dica il tuo nome.', choices: ['Resta con noi.','Aiutami a uscire.'], replies: ['Non è un invito. È il vuoto che ti riconosce.', 'Ho già provato. La strada ricomincia sempre dal tavolo.'] });
  const ottavio = registerCultist(makeNPC(z.group, 3.2, -3.6, 'Ottavio', 0x373735, 1),{ line: 'Non sento la stanza. Sento quando qualcuno decide di mentire.', choices: ['Che cosa dovrei ascoltare?','Hai mai sentito Il Bianco?'], replies: ['Il frigorifero. Tiene un si bemolle da quando è morto il vecchio.','No. Ma ho passato vent’anni a preparare qualcuno che potesse dirmi com’era.'] });
  const anna=addCultist(z,-5.2,1.2,'Anna',0x4a4035,0,'Il piatto resta caldo per un uomo che non ha più bocca. Non sparecchiare.', ['Vuoi che resti?','Perché continui ad apparecchiare?'], ['Sì. Ma non al mio posto.','La tavola è l’unica cosa che non si svuota da sola.']);
  anna.object.position.set(-5.2,0,1.2); anna.point=anna.object.position;
  const dario=addCultist(z,-8.0,-6.1,'Dario',0x302d28,1,'Il disco non è un oggetto. È il nome che resta quando tutti i nomi sono stati tolti.', ['Chi guida il rito?','Che cosa succede a chi ascolta?'], ['Non c’è un capo. C’è soltanto chi ha già fatto spazio.','Non succede niente. È questo che li spaventa.']);dario.isLeader=true;
  const sergio=addCultist(z,-.8,-6.5,'Sergio',0x4a443a,0,'Non credo più al disco. Ma se torno a casa, mi aspetta soltanto il mio rumore.', ['Possiamo uscire insieme?','Allora perché resti?'], ['Non c’è un fuori che sia rimasto uguale.','La compagnia è un vizio più forte della fede.']);
  addCultist(z,7.9,-6.2,'Teresa',0x51483d,0,'Ho dimenticato il volto di mia figlia. Ricordo il rumore dei suoi passi.');
  addCultist(z,8.05,.4,'Nino',0x3d423d,1,'La pompa dell’acqua gira da tre giorni. Nessuno l’ha collegata alla corrente.');
  addCultist(z,8.05,6.1,'Vanda',0x544b43,0,'La stanza è vuota soltanto dalla parte di chi guarda.');
  addCultist(z,.2,7.0,'Agostino',0x343a37,1,'Ho consegnato il mio nome alla porta. La porta mi ha restituito un numero.');
  addCultist(z,-7.8,6.3,'Mirella',0x5a4c43,0,'Mi hanno detto che il silenzio era una forma di cura.');
  addCultist(z,5.3,-1.3,'Gino',0x383b39,1,'La macchina per il ghiaccio lavora anche quando la spina è fuori.');
  addCultist(z,-1.4,5.3,'Ada',0x66574a,0,'Non c’è una voce dentro il nastro. C’è la forma lasciata da una voce.');
  addCultist(z,2.7,6.6,'Elio',0x34322e,1,'La tredicesima sedia è sempre stata rivolta verso il muro.');
  // A staged domestic killing: the room offers the player a choice to look.
  const annaMarker=new THREE.Mesh(new THREE.BoxGeometry(.22,.08,.22),M.clue);annaMarker.position.set(-5.2,.12,1.2);z.group.add(annaMarker);
  z.interactables.push({id:'anna_scene_trigger',type:'event',object:annaMarker,point:annaMarker.position,radius:3.2,prompt:'[ E ] GUARDA IL POSTO VUOTO',run:()=>triggerAnnaScene(z,annaMarker)});
  // Evidence in plain sight, once you stop looking for the album.
  addClueMesh(z.group, new THREE.Vector3(-5.2, 1.1, 2.0), 'Lista dei posti', 'Una lista di tredici nomi. Sotto, una quattordicesima riga cancellata con tanta pressione da aver inciso il foglio.', 'list', 'paper');
  addClueMesh(z.group, new THREE.Vector3(5.8, 1.45, -5.0), 'Battimenti', 'Una forcella d’accordatura. Sul manico è inciso: A=415. La nota non coincide con quella che hai in testa.', 'fork', 'metal');
  addClueMesh(z.group, new THREE.Vector3(1.2, .06, 6.1), 'Trave incisa', 'Nel legno sono incisi ricordi che non sembrano appartenere alla stessa persona: un cane, una festa, una stanza senza porte.', 'beam', 'wood');
  const exit = addDoor(z.group, 0, 8.95, 'la strada', 'road', [0, 0, -3.4]); exit.prompt = '[ E ] TORNA ALLA STRADA';
  const hatch = addDoor(z.group, 8.7, -6.2, 'la cantina', 'cellar', [0, 0, 4.5], true); hatch.prompt = '[ E ] SCENDI — LA CANTINA';
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
  const remo = makeNPC(z.group, 1.5, -8.2, 'Don Remo', 0xddd7c9, 1);
  remo.dialogue = { line: 'La porta non è chiusa. È la stanza a essere dall’altra parte.', choices: ['Che cosa c’è nel disco?', 'Perché la croce è girata?'], replies: ['Un suono che non ha bisogno di essere ascoltato. Un posto che non ha bisogno di essere abitato.', 'Perché la terra guarda il cielo da sotto. Non è una punizione. È una prospettiva.'] };
  const bellMarker=new THREE.Mesh(new THREE.BoxGeometry(.18,.18,.18),M.clue);bellMarker.position.set(-6.8,.12,-5.8);z.group.add(bellMarker);z.interactables.push({id:'bell_event',type:'event',object:bellMarker,point:bellMarker.position,radius:2.8,prompt:'[ E ] TIRA LA CORDA DELLA CAMPANA',run:()=>{audio?.bell();triggerKillScene();}});
  addClueMesh(z.group, new THREE.Vector3(-5.8, 1.7, -13.6), 'Ordine della Messa', 'Il foglio riporta una sequenza di stazioni. La numerazione salta dall’undicesima alla quattordicesima. Sul retro: “nessun funerale”.', 'mass', 'paper');
  addDoor(z.group, 0, 11.9, 'il sagrato', 'road', [0, 0, -29]);
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
  const woman = makeNPC(z.group, 1.4, -.5, 'La vedova', 0x2d302e, 0);
  woman.dialogue = { line: 'Mio marito non è morto. Ha soltanto smesso di rispondere al telefono. Sono passati undici inverni.', choices: ['Perché tieni la luce accesa?', 'Conoscevi la registrazione?'], replies: ['Perché la notte entra dalle prese. La luce la tiene occupata.', 'Il tecnico venne con una valigia vuota. Se ne andò con una canzone che non ricordo.'] };
  addClueMesh(z.group, new THREE.Vector3(-2.2, .95, -4.4), 'Fotografia bruciata', 'Una fotografia della chiesa nel 1977. In un angolo, quasi fuori dall’inquadratura, si vede una piccola stufa a gas dietro il coro.', 'photo', 'paper');
  addClueMesh(z.group, new THREE.Vector3(5.0, .12, 1.0), 'Segreteria telefonica', 'Una microcassetta senza etichetta. Sul nastro si sente soltanto il clic del tasto REC e qualcuno che inspira prima di parlare.', 'voicemail', 'metal');
  addDoor(z.group, 0, 7.95, 'la strada', 'road', [-28, 0, -2]);
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
  const skull=new THREE.Mesh(new THREE.SphereGeometry(.29,14,12),hideMat);skull.position.set(0,2.36,.39);skull.scale.set(.88,.82,1.22);rig.add(skull);
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
  addManifesto(z.group,[-11.78,2.3,-6.2],[0,Math.PI/2,0],'LA CARNE\nRICORDA','PARETE NORD / 1977');
  addManifesto(z.group,[11.78,2.1,6.4],[0,-Math.PI/2,0],'NON C’È\nNESSUN DISCO','PARETE EST / 03:17');
  addManifesto(z.group,[0,3.0,-9.78],[0,0,0],'SVUOTARSI È\nUNA FORMA DI FEDE','MANIFESTO 13');
  // The cult leader is hidden at the far end; his face is turned away until spoken to.
  const leader=makeNPC(z.group,0,-7.2,'Il Primo',0x171716,1);leader.object.rotation.y=Math.PI;leader.dialogue={line:'Non sono il capo. Sono il primo che ha capito che la stanza non era vuota: eravamo noi a occupare troppo spazio.',choices:['Togli il nastro.','Dammi il tuo posto.'],replies:['Non c’è nastro da togliere. La macchina gira senza bobina.','Il posto non è mio. È quello che resta quando rinunci al tuo nome.']};
  const eventMarker=new THREE.Mesh(new THREE.BoxGeometry(.34,.14,.34),M.clue);eventMarker.position.set(0,.12,1.7);z.group.add(eventMarker);
  z.interactables.push({id:'abattoir_ropes',type:'event',object:eventMarker,point:eventMarker.position,radius:3.0,prompt:'[ E ] SCEGLI COSA FARE AI GANCI',run:()=>{
    controls.unlock();dialogueOpen=true;$('speaker').textContent='IL LOCALE / I QUATTRO CORPI';$('subtitle').textContent='Le catene sono in tensione. Una voce arriva dal pavimento: «Se li liberi, la stanza resta senza testimoni. Se li lasci, diventi parte dell’inventario». Quando guardi di nuovo, uno dei corpi ha cambiato posizione.';speakVoice($('subtitle').textContent,'IL LOCALE');$('subtitle-wrap').classList.add('visible');
    $('dialogue-options').innerHTML='';
    [['TAGLIA LE CATENE','release'],['LASCIA TUTTO COM’È','keep']].forEach(([label,id])=>{const b=document.createElement('button');b.className='dialogue-option';b.textContent=label;b.onclick=()=>{storyFlags.add(id==='release'?'released':'complicit');if(id==='release'){carcasses[1].rotation.z=.8;carcasses[1].position.y=-.3;audio?.mechanicalEvent('hoist');fear=Math.min(1,fear+.2);scheduleCultSceneFates(2,'le catene', 'collapse');}else{carcasses[0].rotation.z=.42;storyFlags.add('leader-trust');scheduleCultSceneFates(2,'il silenzio dei ganci','vanish');}if('speechSynthesis'in window)window.speechSynthesis.cancel();$('subtitle-wrap').classList.remove('visible');dialogueOpen=false;glitchPulse=1.3;$('event-flash').classList.add('active');setTimeout(()=>$('event-flash').classList.remove('active'),220);controls.lock();showToast(id==='release'?'IL FERRO È LIBERO. I CORPI NO.':'LA MACCHINA CONTINUA A GIRARE.');};$('dialogue-options').appendChild(b);});
  }});
  // A passage that returns the player to the same room from the wrong direction.
  const loopMarker=new THREE.Mesh(new THREE.BoxGeometry(.4,.12,.4),M.gold);loopMarker.position.set(-8,.1,6.8);z.group.add(loopMarker);
  z.interactables.push({id:'impossible_threshold',type:'event',object:loopMarker,point:loopMarker.position,radius:2.6,prompt:'[ E ] ATTRAVERSA LA SOGLIA CUCITA',run:()=>{playerAnchor.position.set(8.4,0,-6.8);camera.rotation.y+=Math.PI;glitchPulse=1.35;audio?.mechanicalEvent('latch');showToast('SEI ENTRATO DALLA STESSA PORTA. LA POLVERE È DALL’ALTRO LATO.');storyFlags.add('crossed-impossible');}});
  addClueMesh(z.group,new THREE.Vector3(-8.6,1.35,-8.8),'Registro della macelleria','Il registro non riporta animali acquistati. Riporta tredici nomi, ciascuno cancellato dopo una singola data: 03:17.','butcher-ledger','paper');
  addDoor(z.group,0,9.85,'la strada','road',[27,0,29]);
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
  addManifesto(reelDeck,[0,1.55,-.03],[0,0,0],'NON C’È\nNASTRO','ROTORE 14-B / 03:17');
  // Thirteen chairs, one turned towards the viewer.
  for (let i = 0; i < 13; i++) {
    const a = i / 13 * Math.PI * 2; const x = Math.cos(a) * 5.0; const zz = Math.sin(a) * 4.1 + .3;
    const chair = new THREE.Group(); chair.position.set(x, 0, zz); chair.rotation.y = -a + Math.PI; z.group.add(chair);
    addBox(chair, 0, .53, 0, .72, .12, .65, M.wood); addBox(chair, 0, 1.05, -.29, .72, 1.0, .12, M.darkWood);
    addBox(chair, -.28, .25, 0, .08, .5, .08, M.darkWood); addBox(chair, .28, .25, 0, .08, .5, .08, M.darkWood);
  }
  // A human outline that could be a coat on a hook.
  const hanging = makeNPC(z.group, -7.0, -4.9, 'Il cappotto', 0x141614, 1); hanging.object.scale.set(.72, 1.12, .72); hanging.prompt = '[ E ] ESAMINA — IL CAPOTTO';
  hanging.dialogue = { line: 'Le maniche sono ancora calde. Non c’è nessuno dentro.', choices: ['Chi lo ha lasciato?', 'Non toccarlo.'], replies: ['La persona che indossa i vestiti degli altri quando ha freddo.', 'È già stato toccato. Dal lato che non vedi.'] };
  addDoor(z.group, 0, 7.95, 'le scale', 'home', [7.5, 0, -5.2]);
  const turntableEntry = { id: 'listen', type: 'listen', object: disc, point: disc.position, radius: 3.0, prompt: '[ E ] ASCOLTA IL BIANCO', title: 'Il Bianco' };
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
  $('location').textContent = ({ road: 'STRADA DELLE NEBBIE', home: 'CASA / TREDICI POSTI', church: 'CHIESA SCONSACRATA', ruin: 'CASA VUOTA', cellar: 'SOTTERRANEO / 14-B', abattoir: 'MACELLO / SALA DEL VUOTO' })[name];
  glitchPulse = Math.max(glitchPulse, .42); audio?.stinger(.32); audio?.setZone(name); if(name==='abattoir'){fear=Math.min(1,fear+.19);audio?.mechanicalEvent('hoist');} if(name==='church' && collected.size>=2 && !scenePlayed) showToast('LA CORDA DELLA CAMPANA È UMIDA.'); if(name==='cellar'){fear=Math.min(1,fear+.18);}
  showToast(({ road: 'LA STRADA NON È DOVE L’HAI LASCIATA', home: 'NESSUNO TI HA CHIESTO IL NOME', church: 'LA NAVATA È PIÙ LUNGA DALL’INTERNO', ruin: 'QUI QUALCUNO ASPETTA IL TELEFONO', cellar: 'LA STANZA HA TRATTENUTO IL CALDO', abattoir: 'QUI LA CARNE HA UNA MEMORIA LUNGA' })[name]);
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
  const n = collected.size; $('evidence-count').textContent = `${n} / ${clueCount} TRACCE`;
  $('inventory-count').textContent = String(n);
  $('progress-fill').style.width = `${n / clueCount * 100}%`;
  if (n === 0) $('objective-text').textContent = 'Trova la casa. Cerca il luogo dove vengono appese le bestie.';
  else if (n < clueCount) $('objective-text').textContent = 'Otto documenti. Tredici persone. La stanza si svuota.';
  else $('objective-text').textContent = 'La stanza sotto la casa ha aperto la bocca. Scendi quando sei pronto.';
  if (cellarDoor) {
    cellarDoor.locked = n < clueCount;
    cellarDoor.prompt = n < clueCount ? `[ E ] BLOCCATO — MANCA ${clueCount - n} TRACCE` : '[ E ] SCENDI — LA CANTINA';
    if (cellarDoor.slab) cellarDoor.slab.material = n < clueCount ? M.rust : M.wood;
  }
  $('journal-total').textContent = `${journal.length} OGGETTI CATALOGATI`;
}
function updateJournalCount(){ $('journal-total').textContent = `${journal.length} OGGETTI CATALOGATI`; $('inventory-count').textContent=String(journal.length); }
function collectClue(item) {
  if (collected.has(item.id)) return;
  collected.add(item.id);
  journal.push({ id: item.id, title: item.title, description: item.description, kind: item.kind || 'documento', zone: currentZone }); updateJournalCount();
  zone.group.remove(item.object);
  zone.interactables.splice(zone.interactables.indexOf(item), 1);
  dread = Math.min(1, dread + .13); glitchPulse = Math.max(glitchPulse, .85); audio.stinger(.85);
  showToast(`TRACCIA REGISTRATA // ${item.title.toUpperCase()}`); updateProgress();
  if (collected.size === clueCount) showToast('LA CASA HA FINITO DI CONTARE. LA BOTOLA È APERTA.');
  const next=cultRoster.find(n=>n.fate==='present');if(next)queueCultFate(`traccia ${collected.size}`,next,collected.size%3===0?'collapse':'vanish');
}
function speakVoice(text,npcName='') {
  if(!('speechSynthesis' in window)||!text)return;
  try{window.speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.lang='it-IT';u.rate=(npcName||'').toLowerCase().includes('primo') ? 0.64 : 0.76;u.pitch=(npcName||'').toLowerCase().includes('primo') ? 0.42 : 0.72;u.volume=.78;
    const voices=window.speechSynthesis.getVoices();const italian=voices.filter(v=>/^it(-|_)/i.test(v.lang));
    if(italian.length){const idx=Math.abs((npcName||'').split('').reduce((a,c)=>a+c.charCodeAt(0),0))%italian.length;u.voice=italian[idx];}
    window.speechSynthesis.speak(u);
  }catch(err){console.warn('NPC voiceover unavailable',err);}
}
function openDialogue(npc) {
  if (dialogueOpen) return;
  dialogueOpen = true; controls.unlock(); $('subtitle-wrap').classList.add('visible');
  $('speaker').textContent = npc.name.toUpperCase(); $('subtitle').textContent = npc.dialogue?.line || 'Non c’è risposta. Soltanto il rumore dei vestiti.'; speakVoice(npc.dialogue?.line || 'Non c’è risposta.',npc.name);
  const options = $('dialogue-options'); options.innerHTML = '';
  (npc.dialogue?.choices || ['Ascolta.', 'Allontanati.']).forEach((choice, i) => {
    const b = document.createElement('button'); b.className = 'dialogue-option'; b.innerHTML = `<b>[${i + 1}]</b>${choice}`;
    b.addEventListener('click', () => chooseDialogue(npc, i)); options.appendChild(b);
  });
  activeTarget = null; $('prompt').classList.remove('visible');
}
function chooseDialogue(npc, index) {
  let reply = npc.dialogue?.replies?.[index] || 'La risposta arriva da una stanza che non esiste.';
  const lower=(npc.name||'').toLowerCase();
  if(lower==='ines'){storyFlags.add(index===0?'ines-trust':'ines-betrayed');}
  if(lower==='sergio'){storyFlags.add(index===0?'sergio-truth':'sergio-silence');}
  if(lower==='dario'||lower==='il primo'){storyFlags.add(index===0?'challenged-leader':'accepted-leader');}
  if(lower==='ottavio'&&index===1)storyFlags.add('ottavio-audio');
  if(lower==='anna')storyFlags.add(index===0?'anna-mercy':'anna-table');
  $('subtitle').textContent = reply; speakVoice(reply,npc.name); $('dialogue-options').innerHTML = '<button class="dialogue-option" id="dialogue-end"><b>[↵]</b>Non aggiungere altro.</button>'; 
  $('dialogue-end').addEventListener('click', closeDialogue);
  glitchPulse = Math.max(glitchPulse, .28); audio.stinger(.25);
}
function closeDialogue() { dialogueOpen = false; $('subtitle-wrap').classList.remove('visible'); if('speechSynthesis' in window)window.speechSynthesis.cancel(); controls.lock(); }
function openJournal() {
  if (!gameStarted || gameEnded || listeningPending || dialogueOpen) return;
  journalOpen = true; controls.unlock(); $('journal').classList.add('active'); renderJournal();
}
function closeJournal() { journalOpen = false; $('journal').classList.remove('active'); if (gameStarted && !gameEnded) controls.lock(); }
function renderJournal() {
  const list = $('journal-list'); list.innerHTML = '';
  if (!journal.length) { list.innerHTML = '<div class="empty-note">Nessuna traccia registrata.<br><br>La casa non è ancora visibile.</div>'; return; }
  journal.forEach((entry, i) => {
    const b = document.createElement('button'); b.className = `journal-entry${i === 0 ? ' active' : ''}`;
    b.innerHTML = `<small>${String(i + 1).padStart(2, '0')} / ${entry.zone.toUpperCase()}</small><strong>${entry.title}</strong>`;
    b.addEventListener('click', () => {
      list.querySelectorAll('.journal-entry').forEach(x => x.classList.remove('active')); b.classList.add('active');
      $('journal-detail').innerHTML = `<div class="detail-stamp">EPISTASSI / TRACCIA ${String(i + 1).padStart(2, '0')}</div><h3>${entry.title}</h3><p>${entry.description}</p><div class="detail-foot">RITROVATO IN: ${entry.zone.toUpperCase()} · CUSTODITO NEL TACCUINO</div>`;
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
    if (item.locked && collected.size < clueCount) { showToast(`MANCANO ${clueCount - collected.size} TRACCE. LA PORTA NON RICONOSCE LE TUE MANI.`); audio.stinger(.22); return; }
    enterZone(item.destination, item.spawn); return;
  }
  if (item.type === 'listen') { beginListening(); return; }
}
function beginListening() {
  if (collected.size < clueCount) { showToast('IL PIATTO È VUOTO. NON HAI ANCORA PORTATO ABBASTANZA STANZA QUI SOTTO.'); return; }
  if (listeningPending || gameEnded) return;
  // Lock the player inside the listening room. Every remaining cultist is brought
  // into view and receives a visible fate before the ending choices are revealed.
  listeningPending=true;controls.unlock();keys.clear();hiddenBreath=false;activeTarget=null;
  camera.position.set(0,1.63,0);camera.rotation.z=0;cameraDirector.active=false;cameraDirector.cooldown=999;playerRig.visible=false;occludeMat.opacity=0;occludeRight.material.opacity=0;
  $('hud').classList.add('hidden-hud');$('prompt').classList.remove('visible');
  if(audio?.master&&audio.ctx)audio.master.gain.setTargetAtTime(.26,audio.ctx.currentTime,1.2);
  cultRoster.filter(n=>n.fate==='present').forEach((npc,i)=>queueCultFate('il giro del disco',npc,i%4===0?'collapse':'vanish'));
  showToast('TREDICI NOMI. LA STANZA LI VUOLE VEDERE USCIRE.');
  speakVoice('Non abbassare gli occhi. La stanza deve svuotarsi prima che tu possa scegliere.','REGISTRAZIONE 14-B');
  if(!cultFateActive && cultFateQueue.length===0) finishListening();
}
function finishListening() {
  if(!listeningPending)return;
  listeningPending=false;gameEnded=true;controls.unlock();keys.clear();$('hud').classList.add('hidden-hud');
  const screen=$('ending-screen');screen.classList.add('active');
  $('ending-title').textContent='Il Bianco non è stato ascoltato.';
  $('ending-copy').textContent='Tredici persone hanno lasciato la stanza. La macchina continua a girare: il piatto è vuoto, ma nessuno ha più un nome da offrirgli.';
  $('ending-small').textContent='I TREDICI SONO USCITI. RESTA IL TUO NOME.';
  $('ending-choices').classList.add('visible');$('ending-result').classList.remove('visible');
  speakVoice('Tredici posti vuoti. Ora scegli che cosa fare del tuo.','REGISTRAZIONE 14-B');
}
function resolveEnding(choice) {
  const choices={
    fill:{title:'Il quattordicesimo posto',copy:'Hai consegnato il tuo nome. Nessuno ha ascoltato il disco. La stanza ha imparato a usare la tua voce come una sedia.',small:'FINALE I / RIEMPIMENTO',voice:'Hai lasciato il tuo nome sul tavolo. Ora la stanza può parlare.'},
    expose:{title:'La finestra aperta',copy:'Hai interrotto la corrente e spalancato le finestre. Il coro del 1977 non era stato ucciso da una canzone: il gas aveva tolto l’aria alla stanza. I tredici hanno già lasciato la casa; nessuna spiegazione restituisce loro un volto.',small:'FINALE II / ARIA',voice:'La stanza era satura. Non era il disco. Non era soltanto il disco.'},
    preserve:{title:'La registrazione senza nastro',copy:'Hai lasciato tutto com’era. Il piatto continua a girare. Quando esci, il tuo posto è già occupato da qualcuno che ha il tuo cappotto.',small:'FINALE III / CONSERVAZIONE',voice:'Non hai scelto. È una scelta che la stanza conosce bene.'}
  };
  const result={...(choices[choice]||choices.preserve)};
  if(choice==='expose' && storyFlags.has('sergio-truth')) result.copy='Sergio ti ha lasciato il foglio con la diagnosi: monossido di carbonio, ventilazione ostruita, un coro morto senza aver mai ascoltato il disco. Hai aperto le finestre. La spiegazione non restituisce i tredici, ma spezza la liturgia.';
  if(choice==='fill' && storyFlags.has('accepted-leader')) result.copy='Hai preso il posto di Dario. Lui non era il capo: era soltanto il primo a svuotarsi. Il tuo nome viene inciso sulla quattordicesima sedia, sotto gli altri tredici.';
  if(choice==='preserve' && storyFlags.has('crossed-impossible')) result.copy='La soglia cucita ti ha restituito nello stesso locale, ma dalla parete opposta. Hai lasciato il piatto girare. Quando esci, la porta si apre verso l’interno della stanza che hai appena lasciato.';
  if(choice==='fill' && storyFlags.has('released')) result.copy += ' Hai tagliato le catene ma non hai liberato nessuno: il posto è stato riempito da una scelta che non puoi più ritirare.';
  if(choice==='expose' && storyFlags.has('complicit')) result.copy += ' Hai lasciato intatti i ganci quando potevi intervenire; la verità arriva, ma non è innocente.';
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
    if(sun<.22&&lastDayAnnouncement!=='NIGHT'){lastDayAnnouncement='NIGHT';showToast('IL GIORNO HA LASCIATO IL CANALE.');}
    else if(sun>.72&&lastDayAnnouncement!=='DAWN'){lastDayAnnouncement='DAWN';showToast('LA LUCE RITORNA SENZA IL SOLE.');}
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
    showToast('LA REGISTRAZIONE NON È DIETRO I TUOI OCCHI.');
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
    showToast('MOUSE LIBERO — WASD ATTIVO, TRASCINA PER GUARDARE.');
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
  if (playerInputEnabled()) showToast('BLOCCO MOUSE NON DISPONIBILE — WASD ATTIVO, TRASCINA PER GUARDARE.');
});

const movementCodes = new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight']);
window.addEventListener('keydown', (e) => {
  if (playerInputEnabled() && movementCodes.has(e.code)) e.preventDefault();
  keys.add(e.code);
  if(e.code==='KeyZ'&&!e.repeat&&playerInputEnabled()&&activeTarget){
    e32.zoom=true;$('inspect-hint')?.classList.add('visible');
    e32Toast('OSSERVAZIONE RAVVICINATA. NON È UN’IMMAGINE FERMA.');
  }
  if(e.code==='KeyX'&&!e.repeat){
    e32.zoom=false;$('inspect-hint')?.classList.remove('visible');
  }
  if (e.code === 'KeyF' && !e.repeat && playerInputEnabled()) toggleFlashlight();
  if(e.code==='KeyQ' && playerInputEnabled() && !e.repeat){hiddenBreath=true;showToast('TRATTIENI IL FIATO. NON MUOVERTI.');}
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
function triggerDeath(reason='LA STANZA TI HA TROVATO') {
  if(gameEnded)return;gameEnded=true;controls.unlock();keys.clear();$('hud').classList.add('hidden-hud');$('death-title').textContent=reason;$('death-copy').textContent='La registrazione continua per undici secondi dopo la fine del corpo.';$('death-screen').classList.add('active');audio?.killSting();
}
function updateHorror(dt,t){
  if(!gameStarted||gameEnded||!zone||dialogueOpen||journalOpen)return;
  eventClock+=dt;const p=currentPosition();
  // Fear rises in darkness and falls slowly in lit, occupied rooms.
  const darkFactor=flashlightOn?0.0:.022;const zoneFactor=currentZone==='cellar'?.014:currentZone==='abattoir'?.018:currentZone==='ruin'?.009:0;
  fear=Math.min(1,Math.max(.04,fear+(darkFactor+zoneFactor-.002)*dt));
  // Brief, mischievous anomalies: the room seems to answer from the wrong side.
  if(fear>.52&&eventClock>26&&Math.random()<.00075){glitchPulse=Math.max(glitchPulse,.65);audio?.mechanicalEvent('clock');showToast('TREDICI RESPIRI. UNO È FUORI TEMPO.');}
  if(fear>.995&&currentZone==='abattoir'){triggerDeath('LA STANZA HA OCCUPATO IL TUO CORPO.');return;}
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
  if (!e32Quest.shovel) return '01 — CASA VUOTA: recupera la vanga sotto il tavolo da lavoro.';
  if (!e32Quest.grave) return '01 — CIMITERO: scava la tomba di Elena Bassi (1977).';
  if (!e32Quest.crank) return '02 — CHIESA: trova la manovella dell’organo.';
  if (!e32Quest.pump) return '02 — CANALE: monta la manovella sulla pompa e fermala.';
  if (!e32Quest.vent) return '03 — CHIESA: apri la condotta ostruita, usando ciò che hai trovato.';
  return 'LE TRE PROVE SONO RIUNITE. Torna alla casa: nessuna spiegazione è innocente.';
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
  const event={id:'e32_window_'+id,type:'event',object:marker,point:marker.position,radius:3.3,prompt:'[ E ] GUARDA ATTRAVERSO IL VETRO',run:()=>{
    if(id==='home')e32Quest.windowHome=true;else e32Quest.windowRuin=true;
    storyFlags.add('window-witnessed');e32.windowScene={group:apparition,frame,elapsed:0,id};
    apparition.visible=true;apparition.position.x=-.34;
    audio?.mechanicalEvent('glass');audio?.mechanicalTone(64,38,2.4,'sawtooth',.065);
    speakVoice(id==='home'?'Dall’altra parte della finestra, qualcuno apparecchia per tredici persone. Una sedia è rivolta verso il vetro.':'La donna dietro il vetro non si muove. Il suo riflesso, invece, si allontana.',id==='home'?'LA CASA':'LA VEDOVA');
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
    if(!e32Quest.shovel){e32Toast('TI SERVE UNA VANGA. IL TERRENO NON CEDE ALLE MANI.');return;}
    e32.digStep++;audio?.mechanicalEvent('scrape');audio?.mechanicalNoise(.5,420,1.3,.12,.12);fear=Math.min(1,fear+.045);glitchPulse=Math.max(glitchPulse,.24);
    if(e32.digStep===1){mound.scale.y=.31;showToast('LA TERRA È PIÙ MORBIDA SOTTO LA SUPERFICIE. (1/3)');}
    if(e32.digStep===2){mound.scale.set(1.55,.19,1.0);openedEarth.visible=true;showToast('IL LEGNO È ANCORA ASCIUTTO. (2/3)');}
    if(e32.digStep>=3){
      digEvent.repeatable=false;coffin.visible=true;lid.rotation.x=-.72;lid.position.y=.39;
      const hand=new THREE.Mesh(new THREE.CapsuleGeometry(.07,.55,5,8),mat(0x8a7968,1));hand.position.set(.34,.49,.45);hand.rotation.z=-.82;coffin.add(hand);
      storyFlags.add('grave-proof');e32Quest.grave=true;
      e32Journal('grave-elena','La cartella di Elena Bassi','La cartella riporta asfissia da monossido di carbonio. Il referto è stato piegato attorno a una forcella d’accordatura: A=415. Sul retro, a matita: «il coro non ha mai ascoltato niente».','referto');
      speakVoice('Elena Bassi. Nessuna lesione. Nessun suono registrato. La morte è stata certificata prima che il nastro iniziasse a girare.','ELENA / 1977');
      e32Toast('LA TOMBA NON CONTIENE UN CORPO. CONTIENE UNA SPIEGAZIONE.');
      zone.interactables.splice(zone.interactables.indexOf(digEvent),1);
      marker.visible=false;audio?.killSting();glitchPulse=1.25;
    }
    e32UpdateQuestHud();
  }};
  z.interactables.push(digEvent);
  e32AddPractical(z,-8,1.8,7.8,0xd08b4d,.95,9);e32AddPractical(z,8,1.8,7.8,0xd08b4d,.95,9);
  const gate=addDoor(z.group,0,9.45,'il campo','road',[47,0,16]);
  gate.prompt='[ E ] TORNA AL CAMPO';
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
e32GraveDoor.prompt='[ E ] ENTRA — IL CIMITERO SENZA DATA';
addManifesto(zones.road.group,[55,1.8,22],[0,Math.PI/2,0],'QUI RIPOSA\nIL GIORNO','NESSUNA DATA DI USCITA');
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
  if(e32.enemyDistance<2.0&&facing<.35)triggerDeath('IL QUATTORDICESIMO HA PRESO IL TUO POSTO.');
}
const e32BaseSetTension=audio.setTension.bind(audio);
audio.setTension=function(value){
  e32BaseSetTension(Math.min(1,value+e32.enemyApproach*.58));
  if(this.zoneGain&&this.ctx)this.zoneGain.gain.setTargetAtTime(.08+value*.15+e32.enemyApproach*.25,this.ctx.currentTime,.34);
  if(this.noiseGain&&this.ctx)this.noiseGain.gain.setTargetAtTime(.13+value*.07+e32.enemyApproach*.13,this.ctx.currentTime,.5);
};
const e32BaseSpeak=speakVoice;
speakVoice=function(text,npcName=''){
  if(!text)return;
  e32.speechToken++;const token=e32.speechToken;
  if(!('speechSynthesis'in window)){e32BaseSpeak(text,npcName);return;}
  try{
    window.speechSynthesis.cancel();
    const voice=new SpeechSynthesisUtterance(text);voice.lang='it-IT';
    const isPrimo=/primo|quattordicesimo|registrazione/i.test(npcName||'');
    voice.rate=isPrimo ? .53 : .67;voice.pitch=isPrimo ? .22 : .39;voice.volume=.68;
    const italian=window.speechSynthesis.getVoices().filter(v=>/^it([-_]|$)/i.test(v.lang));
    if(italian.length){const seed=(npcName||'').split('').reduce((a,c)=>a+c.charCodeAt(0),0);voice.voice=italian[Math.abs(seed)%italian.length];}
    voice.onstart=()=>{audio?.mechanicalNoise(.10,2100,6,.035,0);audio?.mechanicalTone(isPrimo?48:72,isPrimo?31:52,.85,'sawtooth',.022,0);};
    voice.onend=()=>{
      audio?.mechanicalNoise(.16,1250,4,.035,(Math.random()-.5)*.8);
      if(token!==e32.speechToken||!text.trim())return;
      const words=text.trim().split(/\s+/);if(words.length<5)return;
      const echoText=words.slice(-3).join(' ');
      setTimeout(()=>{
        if(token!==e32.speechToken||dialogueOpen===false&&gameEnded===false&&$('subtitle-wrap').classList.contains('visible')===false)return;
        const echo=new SpeechSynthesisUtterance(echoText);echo.lang='it-IT';echo.rate=.55;echo.pitch=.18;echo.volume=.16;
        if(italian.length)echo.voice=italian[0];window.speechSynthesis.speak(echo);
      },260);
    };
    window.speechSynthesis.speak(voice);
    audio?.mechanicalNoise(.13,1600,5,.032,0);
  }catch(err){console.warn('Degraded NPC voice unavailable',err);e32BaseSpeak(text,npcName);}
};
const e32BaseChooseDialogue=chooseDialogue;
chooseDialogue=function(npc,index){
  e32BaseChooseDialogue(npc,index);
  const name=(npc?.name||'').toLowerCase();
  storyFlags.add('spoke-'+name.replace(/[^a-z0-9]+/g,'-')+'-'+index);
  if(name==='ines'&&index===0){storyFlags.add('ines-trust');e32UpdateQuestHud();}
  if(name==='sergio'&&index===0){
    storyFlags.add('sergio-truth');
    e32Journal('sergio-confession','La confessione di Sergio','Sergio sostiene che il coro del 1977 morì per una condotta ostruita. Il disco arrivò dopo. «Non voglio essere assolto. Voglio che il referto esista».','testimonianza');
  }
  if(name==='dario'||name==='il primo'){
    if(index===0){storyFlags.add('challenged-leader');storyFlags.delete('accepted-leader');}
    else{storyFlags.add('accepted-leader');storyFlags.delete('challenged-leader');}
  }
  if(name==='ottavio'&&index===1){
    storyFlags.add('ottavio-audio');
    e32Toast('OTTAVIO TI HA INSEGNATO A RICONOSCERE IL RUMORE CHE PRECEDE IL PASSO.');
  }
  if(name==='anna'&&index===0)storyFlags.add('anna-mercy');
  if(name==='la donna al canale'&&index===0)storyFlags.add('canal-witness');
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
  if(name==='graveyard'){$('location').textContent='CIMITERO / ELENA BASSI · 1977';fear=Math.min(1,fear+.08);audio?.mechanicalEvent('latch');}
  if(name==='home'&&e32Quest.windowHome)showToast('IL VETRO RIFLETTE UNA STANZA CHE NON È PIÙ QUI.');
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
    showToast('QUALCUNO È ENTRATO NELL’INQUADRATURA.');
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
  const target=e32.zoom?27:72;
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
updateHud=function(dt){e32BaseHud(dt);if(currentZone==='graveyard')$('coords').textContent='45° 02′ N — 10° 41′ E / CIMITERO';e32UpdateQuestHud();};
const e32BaseFinish=finishListening;
finishListening=function(){
  e32BaseFinish();
  const secret=e32Quest.grave&&e32Quest.pump&&e32Quest.vent&&storyFlags.has('ines-trust')&&storyFlags.has('ottavio-audio')&&storyFlags.has('sergio-truth')&&storyFlags.has('challenged-leader');
  const button=$('ending-witness');
  if(button)button.hidden=!secret;
  if(secret)showToast('C’È UN QUARTO POSTO. NON È PER IL DISCO.');
};
const e32BaseEnding=resolveEnding;
resolveEnding=function(choice){
  if(choice==='witness'){
    storyFlags.add('ending-witness');
    $('ending-title').textContent='La voce che non riempie.';
    $('ending-copy').textContent='Hai scavato una tomba, fermato una pompa e aperto una condotta. Ines ti ha affidato il nome di Elena; Ottavio ha riconosciuto il rumore che precede il passo; Sergio ha lasciato esistere il referto. Non hai ascoltato Il Bianco. Hai impedito che il vuoto fosse scambiato per una promessa.';
    $('ending-small').textContent='FINALE IV / TESTIMONIANZA — IL NASTRO RESTA BIANCO';
    $('ending-choices').classList.remove('visible');$('ending-result').classList.add('visible');
    speakVoice('Non ci siamo svuotati per essere riempiti. Ci siamo svuotati perché nessuno aveva più ascoltato i nomi.','INES / REGISTRAZIONE');
    audio?.killSting();glitchPulse=1.2;return;
  }
  e32BaseEnding(choice);
  if(choice==='expose'){
    if(!(e32Quest.grave&&e32Quest.vent&&storyFlags.has('sergio-truth'))){
      $('ending-title').textContent='La finestra senza aria.';
      $('ending-copy').textContent='Hai aperto le finestre, ma non hai trovato il referto né liberato la condotta. La stanza si è riempita d’aria fredda. La spiegazione è rimasta fuori, dietro il vetro.';
      $('ending-small').textContent='FINALE II / ARIA INSUFFICIENTE';
    }else{
      $('ending-title').textContent='La stanza satura.';
      $('ending-copy').textContent='La tomba di Elena, la confessione di Sergio e la condotta ostruita coincidono. Il coro del 1977 morì per monossido di carbonio. Il disco venne dopo, per dare un nome a ciò che nessuno aveva saputo sopportare.';
      $('ending-small').textContent='FINALE II / PROVA E VENTILAZIONE';
    }
  }
  if(choice==='fill'&&storyFlags.has('accepted-leader')){
    $('ending-title').textContent='Il primo nome.';
    $('ending-copy').textContent='Hai accettato la versione del Primo. Ora sai che non esisteva un capo: esisteva un ordine di persone disposte a cedere il proprio nome. La quattordicesima sedia non è un trono. È un turno.';
  }
  if(choice==='preserve'&&storyFlags.has('window-witnessed')){
    $('ending-title').textContent='La stanza dietro il vetro.';
    $('ending-copy').textContent='Hai conservato la registrazione. Dietro la finestra, la figura continua ad apparecchiare. Quando il nastro si ferma, sul vetro compare il tuo riflesso seduto al tredicesimo posto.';
  }
};
$('ending-witness').addEventListener('click',()=>resolveEnding('witness'));
// The shovel is not inventory decoration: it opens a three-stage grave mission.
{
  const z=zones.ruin;
  const tool=new THREE.Group();tool.position.set(-4.65,0,-4.35);z.group.add(tool);
  const shaft=new THREE.Mesh(new THREE.CylinderGeometry(.035,.045,1.1,8),M.wood);shaft.position.y=.55;shaft.rotation.z=-.14;tool.add(shaft);
  const blade=new THREE.Mesh(new THREE.BoxGeometry(.22,.36,.045),M.rust);blade.position.set(.08,.1,0);blade.rotation.z=-.16;tool.add(blade);
  const pickup={id:'e32_spade',type:'event',object:tool,point:tool.position,radius:3.3,prompt:'[ E ] PRENDI LA VANGA',run:()=>{
    e32Quest.shovel=true;tool.visible=false;z.interactables.splice(z.interactables.indexOf(pickup),1);
    e32Journal('spade','La vanga','Il manico è stato levigato da una mano che scavava sempre nello stesso punto. Sulla lama: terra nera e una scheggia di vernice bianca.','oggetto');
    e32Toast('HAI PRESO LA VANGA. IL CIMITERO È OLTRE IL CAMPO DI MAIS.');e32UpdateQuestHud();
  }};
  z.interactables.push(pickup);
}
// The church organ has lost its crank. It is the only tool that fits the canal pump.
{
  const z=zones.church;const crank=new THREE.Group();crank.position.set(-7.2,.25,5.9);z.group.add(crank);
  const wheel=new THREE.Mesh(new THREE.TorusGeometry(.22,.035,7,24),M.rust);wheel.rotation.x=Math.PI/2;crank.add(wheel);
  const grip=new THREE.Mesh(new THREE.CylinderGeometry(.035,.035,.48,7),M.metal);grip.rotation.z=Math.PI/2;crank.add(grip);
  const pickup={id:'e32_crank',type:'event',object:crank,point:crank.position,radius:3.0,prompt:'[ E ] PRENDI LA MANOVELLA',run:()=>{
    e32Quest.crank=true;crank.visible=false;z.interactables.splice(z.interactables.indexOf(pickup),1);
    e32Journal('crank','La manovella','La manovella dell’organo ha la filettatura consumata. Sul mozzo è inciso: CONSORZIO IDRAULICO / 1977.','oggetto');
    audio?.mechanicalEvent('gear');e32Toast('LA MANOVELLA NON APPARTIENE ALL’ORGANO.');e32UpdateQuestHud();
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
  z.interactables.push({id:'e32_pump',type:'event',repeatable:true,object:marker,point:marker.position,radius:4.4,prompt:'[ E ] FERMA LA POMPA DEL CANALE',run:()=>{
    if(!e32Quest.crank){e32Toast('IL PERNO È SPEZZATO. SERVE UNA MANOVELLA.');return;}
    if(e32Quest.pump){e32Toast('LA POMPA È FERMA. SOTTO IL RUMORE RESTA UN RESPIRO.');return;}
    e32Quest.pump=true;storyFlags.add('pump-restored');wheel.rotation.z=Math.PI*2;casing.material=M.rust;
    audio?.powerSurge();audio?.mechanicalEvent('valve');fear=Math.min(1,fear+.11);
    e32Journal('pump-ledger','Pressione zero','La pompa non spingeva acqua verso i campi. La riportava alla condotta della chiesa. Il contatore segna tredici cicli e un quattordicesimo senza pressione.','registro');
    speakVoice('La pompa è ferma. Ma il rumore continua nella terra.','IL CANALE');
    e32Toast('IL CANALE HA SMESSO DI RESPIRARE.');e32UpdateQuestHud();
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
  z.interactables.push({id:'e32_vent',type:'event',repeatable:true,object:marker,point:marker.position,radius:3.4,prompt:'[ E ] APRI LA CONDOTTA',run:()=>{
    if(!e32Quest.grave||!e32Quest.pump){e32Toast('MANCA UNA PROVA. LA CONDOTTA NON SI APRE CON LA FORZA.');return;}
    if(e32Quest.vent){e32Toast('L’ARIA PASSA. L’ODORE NO.');return;}
    e32Quest.vent=true;storyFlags.add('vent-open');duct.rotation.z=.32;grille.rotation.y=.9;
    audio?.powerSurge();audio?.mechanicalEvent('valve');fear=Math.max(.2,fear-.16);
    e32Journal('vent-report','Condotta del coro','Il condotto era stato chiuso dall’interno e poi murato. Il deposito nero coincide con la stufa a gas fotografata nel 1977. Il referto di Elena non era un falso.','referto');
    speakVoice('La stanza non era maledetta. Era chiusa. Qualcuno ha scelto di chiamare il gas una voce.','LA CONDOTTA');
    e32Toast('LA CONDOTTA È APERTA. IL MITO HA UNA FESSURA.');e32UpdateQuestHud();
  }});
}
e32HomeWindow.event.prompt='[ E ] GUARDA LA STANZA DIETRO LA FINESTRA';
e32RuinWindow.event.prompt='[ E ] OSSERVA IL RIFLESSO';
e32UpdateQuestHud();
