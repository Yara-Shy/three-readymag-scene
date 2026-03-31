import * as THREE from 'three';
import { OrbitControls }   from 'three/addons/controls/OrbitControls.js';
import { EffectComposer }  from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }      from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

/**
 * FPS-нормалізований lerp.
 * alpha — "відчута" швидкість на 60fps.
 * На 120fps коефіцієнт перераховується автоматично,
 * щоб анімація виглядала однаково на будь-якому refresh rate.
 *
 * Формула: 1 - (1 - alpha)^(dt * 60)
 */
function lerpDt(current, target, alpha, dt) {
  const k = 1 - Math.pow(1 - Math.min(Math.max(alpha, 0), 1), dt * 60);
  return current + (target - current) * k;
}

/** Стандартний lerp без нормалізації — для разових обчислень */
const lerp = (a, b, t) => a + (b - a) * t;

/** smoothstep — те саме що у GLSL */
function smoothStep(min, max, value) {
  const x = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return x * x * (3 - 2 * x);
}

const easeInOut = x => x < .5 ? 4*x*x*x : 1 - Math.pow(-2*x + 2, 3) / 2;


/* ─────────────────────────────────────────────
   DOM RECT CACHE
   Замість виклику getBoundingClientRect() кожен кадр —
   кешуємо через scroll + resize і оновлюємо тільки тоді,
   коли DOM дійсно змінився.
   ───────────────────────────────────────────── */

const rectCache = new Map();

function cacheRect(el) {
  if (!el) return;
  rectCache.set(el, el.getBoundingClientRect());
}

function getCachedRect(el) {
  return rectCache.get(el) || el.getBoundingClientRect();
}

function refreshRects() {
  for (const el of rectCache.keys()) {
    rectCache.set(el, el.getBoundingClientRect());
  }
}

// Оновлюємо кеш при скролі і ресайзі — але не в RAF
window.addEventListener('scroll',  refreshRects, { passive: true });
window.addEventListener('resize',  refreshRects, { passive: true });


/* ─────────────────────────────────────────────
   CURSOR
   ───────────────────────────────────────────── */
const curEl  = document.getElementById('cur');
const ringEl = document.getElementById('cur-ring');

// Реальні координати миші — оновлюються одразу
const mouse = { x: 0, y: 0 };
// Плавні координати кільця — оновлюються в RAF
const ring  = { x: 0, y: 0 };

document.addEventListener('mousemove', e => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
}, { passive: true });

// Cursor рендеримо в головному RAF — не окремий loop


/* ─────────────────────────────────────────────
   LOADER
   ───────────────────────────────────────────── */
const lbar     = document.getElementById('lbar');
const lpct     = document.getElementById('lpct');
const loaderEl = document.getElementById('loader');
let lp = 0, introReady = false;

const loaderTick = setInterval(() => {
  lp = Math.min(lp + Math.random() * 9 + 2, 100);
  lbar.style.width = lp + '%';
  lpct.textContent = Math.floor(lp) + '%';
  if (lp >= 100) {
    clearInterval(loaderTick);
    setTimeout(() => {
      loaderEl.classList.add('hide');
      setTimeout(() => document.getElementById('scroll-cue').classList.add('show'), 600);
      introReady = true;
      // Кешуємо rect'и після того як loader зник
      cacheRect(document.getElementById('s-home-wrapper'));
      cacheRect(document.getElementById('spiral'));
    }, 400);
  }
}, 55);


/* ─────────────────────────────────────────────
   CONFIG
   ───────────────────────────────────────────── */
const IS_LOW_END = navigator.hardwareConcurrency <= 2;
const CFG = {
  sphere : { count: IS_LOW_END ? 10_000 : 18_000, radius: 5 },
  rings  : { count: IS_LOW_END ? 4 : 5, pointsPerRing: IS_LOW_END ? 1_200 : 2_000, radius: 7.5, thickness: 0.6 },
  stars  : { count: IS_LOW_END ? 3_000 : 6_000, spread: 50_000 },
  bloom  : { strength: IS_LOW_END ? 0.8 : 1.2, threshold: 0, radius: 0.5 },
  dpr    : Math.min(devicePixelRatio, 1),
  explode: { duration: 2_000 },
};
const CAM = { FAR_Z: 28, NEAR_Z: 15, SPIRAL_Z: 3.5, Y: 5, HERO_X: -10 };


/* ─────────────────────────────────────────────
   SHADERS
   ───────────────────────────────────────────── */
const GLSL_SIMPLEX = `vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;}vec4 mod289(vec4 x){return x-floor(x*(1./289.))*289.;}vec4 permute(vec4 x){return mod289(((x*34.)+1.)*x);}vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-.85373472095314*r;}float snoise(vec3 v){const vec2 C=vec2(1./6.,1./3.);const vec4 D=vec4(0.,.5,1.,2.);vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;i=mod289(i);vec4 p=permute(permute(permute(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));float n_=.142857142857;vec3 ns=n_*D.wyz-D.xzx;vec4 j=p-49.*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.*x_);vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.-abs(x)-abs(y);vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);vec4 s0=floor(b0)*2.+1.;vec4 s1=floor(b1)*2.+1.;vec4 sh=-step(h,vec4(0.));vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.);m=m*m;return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));}`;

const SHADERS = {
  sphere: {
    vert: GLSL_SIMPLEX + `attribute float size;varying vec3 vColor;varying float vME;uniform float time;uniform vec2 uMouse;void main(){vColor=color;vec4 pv2=projectionMatrix*modelViewMatrix*vec4(position,1.);vec2 sp=pv2.xy/pv2.w;float md=distance(sp,uMouse);float me=1.-smoothstep(0.,.25,md);vME=me;float nA=0.8+me*5.0;vec3 ni=position*.4+time*.8;vec3 d=vec3(snoise(ni),snoise(ni+vec3(10.)),snoise(ni+vec3(20.)));vec3 fp=position+d*nA;float pulse=sin(time+length(position))*.1+1.;vec4 mv=modelViewMatrix*vec4(fp,1.);gl_PointSize=size*(400./-mv.z)*pulse*(1.+vME*.5);gl_Position=projectionMatrix*mv;}`,
    frag: `varying vec3 vColor;varying float vME;uniform float time;float rand(vec2 c){return fract(sin(dot(c,vec2(12.9898,78.233)))*43758.5453);}void main(){vec2 cxy=2.*gl_PointCoord-1.;float r=dot(cxy,cxy);if(r>1.)discard;float glow=exp(-r*3.5)+vME*.5;float tw=rand(gl_PointCoord+time)*.5+.5;vec3 fc=vColor*(1.1+sin(time*.8)*.2+vME*.5)*glow*tw;gl_FragColor=vec4(fc,smoothstep(0.,1.,glow));}`,
  },
  rings: {
    vert: GLSL_SIMPLEX + `attribute float size;attribute vec3 randomDir;varying vec3 vColor;varying float vME;uniform float time;uniform vec2 uMouse;uniform float uExplode;void main(){vColor=color;float ea=uExplode*35.;float turb=snoise(position*.4+randomDir*2.+time*.8)*10.*uExplode;vec3 ep=position+randomDir*(ea+turb);vec3 mp=mix(position,ep,uExplode);vec4 pv2=projectionMatrix*modelViewMatrix*vec4(position,1.);vec2 sp=pv2.xy/pv2.w;float md=distance(sp,uMouse);float me=1.-smoothstep(0.,.25,md);vME=me;float nA=(0.8+me*2.0)*(1.-uExplode);vec3 ni=mp*.4+time*.5;vec3 d=vec3(snoise(ni),snoise(ni+vec3(10.)),snoise(ni+vec3(20.)));vec3 fp=mp+d*nA;float pulse=sin(time+length(position))*.1+1.;vec4 mv=modelViewMatrix*vec4(fp,1.);gl_PointSize=size*(400./-mv.z)*pulse*(1.+vME*.5);gl_Position=projectionMatrix*mv;}`,
    frag: `varying vec3 vColor;varying float vME;uniform float time;uniform float uExplode;float rand(vec2 c){return fract(sin(dot(c,vec2(12.9898,78.233)))*43758.5453);}void main(){vec2 cxy=2.*gl_PointCoord-1.;float r=dot(cxy,cxy);if(r>1.)discard;float glow=exp(-r*3.5)+vME*.5;float tw=rand(gl_PointCoord+time)*.5+.5;vec3 ec=vec3(2.,3.,3.5);vec3 mc=mix(vColor,ec,uExplode*.8);mc*=(1.+uExplode*6.);vec3 fc=mc*(1.1+sin(time*.8)*.2+vME*.5)*glow*tw;gl_FragColor=vec4(fc,smoothstep(0.,1.,glow));}`,
  },
  stars: {
    vert: `attribute float size;varying vec3 vColor;varying float vTw;uniform float time;void main(){vColor=color;vec3 pos=position;pos.z+=time*8.;if(pos.z>25000.)pos.z-=50000.;vec4 mv=modelViewMatrix*vec4(pos,1.);float tw=sin(time*2.+position.x*.1+position.y*.2)*.4+.9;vTw=tw;gl_PointSize=size*tw*(1200./-mv.z);gl_Position=projectionMatrix*mv;}`,
    frag: `varying vec3 vColor;void main(){vec2 c=2.*gl_PointCoord-1.;float r=dot(c,c);if(r>1.)discard;gl_FragColor=vec4(vColor,exp(-r*2.)*1.4);}`,
  },
};


/* ─────────────────────────────────────────────
   GEOMETRY
   ───────────────────────────────────────────── */
function makeSphere(radius, count) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), sz = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const phi = Math.acos(-1 + (2 * i) / count), theta = Math.sqrt(count * Math.PI) * phi;
    pos[i*3]   = radius * Math.cos(theta) * Math.sin(phi);
    pos[i*3+1] = radius * Math.sin(theta) * Math.sin(phi);
    pos[i*3+2] = radius * Math.cos(phi);
    sz[i] = Math.random() * 0.2 + 0.1;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color',    new THREE.BufferAttribute(col, 3));
  geo.setAttribute('size',     new THREE.BufferAttribute(sz,  1));
  return new THREE.Points(geo, new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, uMouse: { value: new THREE.Vector2(-10, -10) } },
    vertexShader: SHADERS.sphere.vert, fragmentShader: SHADERS.sphere.frag,
    vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
}

function makeRings({ count, pointsPerRing, radius, thickness }) {
  const group = new THREE.Group(), v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(pointsPerRing * 3), col = new Float32Array(pointsPerRing * 3);
    const sz  = new Float32Array(pointsPerRing), rd = new Float32Array(pointsPerRing * 3);
    for (let j = 0; j < pointsPerRing; j++) {
      const angle = (j / pointsPerRing) * Math.PI * 2;
      const r = radius + (Math.random() - 0.5) * thickness;
      pos[j*3]   = Math.cos(angle) * r;
      pos[j*3+1] = (Math.random() - 0.5) * (thickness * 0.5);
      pos[j*3+2] = Math.sin(angle) * r;
      sz[j] = Math.random() * 0.15 + 0.08;
      v.set(Math.random()*2-1, Math.random()*2-1, Math.random()*2-1).normalize();
      rd[j*3] = v.x; rd[j*3+1] = v.y; rd[j*3+2] = v.z;
    }
    geo.setAttribute('position',  new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color',     new THREE.BufferAttribute(col, 3));
    geo.setAttribute('size',      new THREE.BufferAttribute(sz,  1));
    geo.setAttribute('randomDir', new THREE.BufferAttribute(rd,  3));
    const ring = new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, uMouse: { value: new THREE.Vector2(-10, -10) }, uExplode: { value: 0 } },
      vertexShader: SHADERS.rings.vert, fragmentShader: SHADERS.rings.frag,
      vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    ring.rotation.x = Math.random() * Math.PI;
    ring.rotation.y = Math.random() * Math.PI;
    group.add(ring);
  }
  return group;
}

function makeStars({ count, spread }) {
  const geo = new THREE.BufferGeometry(), pos = [], col = [], sz = [];
  for (let i = 0; i < count; i++) {
    pos.push((Math.random()-.5)*spread, (Math.random()-.5)*spread, (Math.random()-.5)*spread);
    const c = new THREE.Color().setHSL(Math.random()*.1-.05, .2, .5+Math.random()*.5);
    col.push(c.r, c.g, c.b);
    sz.push(0.5 + Math.random());
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color',    new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('size',     new THREE.Float32BufferAttribute(sz,  1));
  return new THREE.Points(geo, new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    vertexShader: SHADERS.stars.vert, fragmentShader: SHADERS.stars.frag,
    vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
}


/* ─────────────────────────────────────────────
   THEMES
   ───────────────────────────────────────────── */
const THEMES = {
  nebula: { sphere: [0x00ffff,0xff1493,0x4169e1,0xff69b4,0x00bfff].map(h=>new THREE.Color(h)), rings:(i,tc,j,pc)=>new THREE.Color().setHSL((i/tc)*.6+(j/pc)*.2+.5,.8,.6) },
  sunset: { sphere: [0xff4500,0xff8c00,0xffd700,0xff0080,0xda70d6].map(h=>new THREE.Color(h)), rings:(i,tc,j,pc)=>new THREE.Color().setHSL((i/tc)*.1+(j/pc)*.1,.9,.7) },
  forest: { sphere: [0x228b22,0x00ff7f,0x3cb371,0x1e90ff,0x87cefa].map(h=>new THREE.Color(h)), rings:(i,tc,j,pc)=>new THREE.Color().setHSL((i/tc)*.2+(j/pc)*.1+.25,.8,.55) },
  aurora: { sphere: [0x00ff7f,0x40e0d0,0x483d8b,0x9932cc,0x00fa9a].map(h=>new THREE.Color(h)), rings:(i,tc,j,pc)=>new THREE.Color().setHSL((i/tc)*.3+(j/pc)*.1+.45,.9,.65) },
};

function applyTheme(name) {
  const t = THEMES[name]; if (!t) return;
  const sAttr = sphere.geometry.attributes.color;
  for (let i = 0; i < sAttr.count; i++) {
    const p = (i/sAttr.count)*(t.sphere.length-1);
    const c = new THREE.Color()
      .copy(t.sphere[Math.floor(p)])
      .lerp(t.sphere[Math.min(Math.ceil(p), t.sphere.length-1)], p%1);
    sAttr.setXYZ(i, c.r, c.g, c.b);
  }
  sAttr.needsUpdate = true;
  rings.children.forEach((ring, i) => {
    const rAttr = ring.geometry.attributes.color;
    for (let j = 0; j < rAttr.count; j++) {
      const c = t.rings(i, rings.children.length, j, rAttr.count);
      rAttr.setXYZ(j, c.r, c.g, c.b);
    }
    rAttr.needsUpdate = true;
  });
}


/* ─────────────────────────────────────────────
   SCENE
   ───────────────────────────────────────────── */
const mouse3D = new THREE.Vector2(-10, -10);
let isExploding = false, explodeStart = 0, tabHidden = false;

document.addEventListener('visibilitychange', () => { tabHidden = document.hidden; });

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x000000, 0.008);

const camera = new THREE.PerspectiveCamera(75, innerWidth/innerHeight, 0.1, 50_000);
camera.position.set(0, CAM.Y, CAM.FAR_Z);

const renderer = new THREE.WebGLRenderer({
  canvas: document.getElementById('bg-canvas'),
  antialias: !IS_LOW_END,
  powerPreference: 'high-performance',
});
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x000000);
renderer.setPixelRatio(CFG.dpr);

const controls = new OrbitControls(camera, renderer.domElement);
Object.assign(controls, {
  enableDamping: true, dampingFactor: .04, rotateSpeed: .6,
  minDistance: 2, maxDistance: 60, enableZoom: false,
});

const bloomRes = IS_LOW_END
  ? new THREE.Vector2(innerWidth*.5, innerHeight*.5)
  : new THREE.Vector2(innerWidth, innerHeight);
const composer  = new EffectComposer(renderer);
const bloomPass = new UnrealBloomPass(bloomRes, CFG.bloom.strength, CFG.bloom.radius);
bloomPass.threshold = CFG.bloom.threshold;
composer.addPass(new RenderPass(scene, camera));
composer.addPass(bloomPass);

const sphere    = makeSphere(CFG.sphere.radius, CFG.sphere.count);
const rings     = makeRings(CFG.rings);
const stars     = makeStars(CFG.stars);
const mainGroup = new THREE.Group();
mainGroup.add(sphere);
scene.add(mainGroup, rings, stars, new THREE.PointLight(0xffffff, 2, 0));
applyTheme('nebula');

window.addEventListener('resize', () => {
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
}, { passive: true });

window.addEventListener('mousemove', e => {
  mouse3D.x =  (e.clientX / innerWidth)  * 2 - 1;
  mouse3D.y = -((e.clientY / innerHeight) * 2 - 1);
}, { passive: true });


/* ─────────────────────────────────────────────
   SCROLL STATE  —  читається один раз у scroll-listener,
   а не в кожному кадрі RAF
   ───────────────────────────────────────────── */
const scrollState = {
  wrapP:      0,  // progress всередині s-home-wrapper
  spiralP:    0,  // progress всередині spiral section
  spiralIn:   false,
  spiralDone: false,
  scrollY:    0,
};

function updateScrollState() {
  const vh = window.innerHeight;
  scrollState.scrollY = window.scrollY;

  const wrapRect   = getCachedRect(document.getElementById('s-home-wrapper'));
  const wrapScroll = wrapRect.height - vh;
  scrollState.wrapP = wrapScroll > 0
    ? Math.max(0, Math.min(1, -wrapRect.top / wrapScroll))
    : 0;

  const spiralRect   = getCachedRect(document.getElementById('spiral'));
  const spiralScroll = spiralRect.height - vh;
  scrollState.spiralP = spiralScroll > 0
    ? Math.max(0, Math.min(1, -spiralRect.top / spiralScroll))
    : 0;


  scrollState.spiralIn = spiralRect.top < vh
  && spiralRect.bottom > 0
  && scrollState.spiralP > .01
  && scrollState.spiralP < .99;
  scrollState.spiralDone = spiralRect.bottom <= 0 || scrollState.spiralP >= .99;
}

window.addEventListener('scroll', updateScrollState, { passive: true });


/* ─────────────────────────────────────────────
   CAMERA TARGET  —  обчислюється зі scrollState
   ───────────────────────────────────────────── */
let camTargetZ  = CAM.FAR_Z;
let camCurrentZ = CAM.FAR_Z;
let camTargetX  = 0;
let camCurrentX = 0;
let scrollCueGone = false, heroRevealed = false, explosionFired = false;
let sphereAlphaSmooth = 1;

function computeCameraTarget() {
  if (!introReady) return;
  const { wrapP, spiralP, spiralIn, spiralDone, scrollY } = scrollState;

  if (scrollY > 10 && !scrollCueGone) {
    scrollCueGone = true;
    document.getElementById('scroll-cue').classList.add('gone');
  }

  if (spiralDone) {
    camTargetZ = CAM.FAR_Z;
    camTargetX = 0;
    return;
  }

  if (spiralIn) {
    camTargetZ = CAM.SPIRAL_Z;
    const centerP = Math.min(spiralP / 0.25, 1);
    const centerE = centerP < .5 ? 2*centerP*centerP : 1 - Math.pow(-2*centerP+2, 2)/2;
    camTargetX = -6 * (1 - centerE);
    return;
  }

  // ФАЗА 1
  const p = Math.min(wrapP / 0.35, 1);
  const e = p < .5 ? 2*p*p : 1 - Math.pow(-2*p+2, 2)/2;
  camTargetZ = CAM.FAR_Z + (CAM.NEAR_Z - CAM.FAR_Z) * e;
  camTargetX = -6 * e;

  if (wrapP >= 0.58 && !heroRevealed) {
    heroRevealed = true;
    document.getElementById('main-nav').classList.add('show');
    document.getElementById('pg-counter').classList.add('show');
    document.getElementById('theme-dots').classList.add('show');
    document.querySelectorAll('.hero-reveal').forEach(el => el.classList.add('show'));
    if (!explosionFired) {
      explosionFired = true;
      isExploding    = true;
      explodeStart   = clock.getElapsedTime();
    }
  }

  // preZoom — між hero і spiral
  if (wrapP > 0.75) {
    const preZoomP = Math.min((wrapP - 0.75) / 0.25, 1);
    const preZoomE = preZoomP < .5 ? 2*preZoomP*preZoomP : 1 - Math.pow(-2*preZoomP+2,2)/2;
    camTargetZ = lerp(CAM.NEAR_Z, CAM.SPIRAL_Z, preZoomE);
  }
}

window.addEventListener('scroll', computeCameraTarget, { passive: true });



/* ─────────────────────────────────────────────
   ЄДИНИЙ RAF LOOP
   Курсор + Three.js + Spiral — все в одному місці.
   Кожна секція отримує dt для FPS-нормалізованого lerp.
   ───────────────────────────────────────────── */
const clock = new THREE.Clock();
let lastTime = 0;

// Spiral state — живе тут, оновлюється в RAF
const spiral = (() => {
  const section = document.getElementById('spiral');
  const cards   = Array.from(section.querySelectorAll('.card'));
  const photos  = Array.from(section.querySelectorAll('.card-photo'));
  const N = cards.length;
  const isMob = window.innerWidth <= 768;
  const S = {
    R: isMob ? 280 : 640, pitch: isMob ? 250 : 320, zOffset: isMob ? -160 : -260, faceStrength: isMob ? 32 : 48, tiltX: 0,
    backBlurMax: 12, backOpacityMin: 0.22, frontOpacityMin: 0.98,
    backThreshold: 0, cameraLerp: 0.1, focusSharpness: 12.0, scrollLerp: 0.08,
  };
  window.addEventListener('resize', () => {
    const m = window.innerWidth <= 768;
    S.R          = m ? 320 : 640;
    S.pitch      = m ? 200 : 320;
    S.zOffset    = m ? -160 : -260;
    S.faceStrength = m ? 32 : 48;
  }, { passive: true });

  // СТАЛО
let camX = 0, camY = 0, scrollT = 0, prevFrontIdx = -1;
const hoverScale = new Array(N).fill(1);
const smoothHover = new Array(N).fill(1);
cards.forEach((card, i) => {
  card.addEventListener('mouseenter', () => { hoverScale[i] = 1.06; });
  card.addEventListener('mouseleave', () => { hoverScale[i] = 1; });
});

  function getRawProgress() {
    const rect     = section.getBoundingClientRect();
    const scrollable = rect.height - window.innerHeight;
    return scrollable <= 0 ? 0 : Math.max(0, Math.min(1, -rect.top / scrollable));
  }

  // Ініціалізуємо кеш для spiral section
  cacheRect(section);
  let rawT = getRawProgress();
  window.addEventListener('scroll', () => { rawT = getRawProgress(); }, { passive: true });
  window.addEventListener('resize', () => { rawT = getRawProgress(); }, { passive: true });

  function computePoses(progress) {
    const step = (Math.PI*2) / N;
    const phase = Math.PI/2 + progress * (N-1) * step;
    return cards.map((_, i) => {
      const a = phase - i * step;
      return { a, x: Math.cos(a)*S.R, y: -a*S.pitch, z: Math.sin(a)*S.R + S.zOffset, facing: (Math.sin(a)+1)/2 };
    });
  }

  // Повертаємо функцію tick — викликається з головного RAF
  return {
    tick(dt) {
      // FPS-нормалізований lerp для плавного scroll
      scrollT = lerpDt(scrollT, rawT, S.scrollLerp, dt);
      const poses = computePoses(scrollT);

      let sumW = 0, tX = 0, tY = 0;
      poses.forEach(p => {
        const w = Math.pow(Math.max(0, p.facing), S.focusSharpness);
        sumW += w; tX += p.x * w; tY += p.y * w;
      });
      if (sumW > 0) { tX /= sumW; tY /= sumW; }

      // FPS-нормалізований lerp для камери spiral
      camX = lerpDt(camX, -tX, S.cameraLerp, dt);
      camY = lerpDt(camY, -tY, S.cameraLerp, dt);

      let frontIdx = 0, maxF = 0;
      poses.forEach((p, i) => { if (p.facing > maxF) { maxF = p.facing; frontIdx = i; } });
      if (frontIdx !== prevFrontIdx) {
        if (prevFrontIdx >= 0) cards[prevFrontIdx].classList.remove('is-front');
        cards[frontIdx].classList.add('is-front');
        prevFrontIdx = frontIdx;
      }

      poses.forEach(({ a, x, y, z, facing }, i) => {
        const x2   = x + camX, y2 = y + camY;
        const yaw  = Math.cos(a) * -S.faceStrength;
        const isBack = facing < S.backThreshold;
        const blur = isBack
          ? lerp(2, S.backBlurMax, (S.backThreshold - facing) / S.backThreshold)
          : 0;
        const opacity = isBack
          ? lerp(S.backOpacityMin, .55, facing / S.backThreshold)
          : lerp(S.frontOpacityMin, 1, (facing - S.backThreshold) / (1 - S.backThreshold));
        
        // СТАЛО
const baseScale = lerp(.84, 1.03, Math.pow(facing, 1.9));
smoothHover[i] = lerpDt(smoothHover[i], hoverScale[i], 0.12, dt);
const scale = baseScale * smoothHover[i];
        const zIdx  = Math.round((z - S.zOffset + S.R) * 10);
        const tf    = `translate3d(-50%,-50%,0) translate3d(${x2.toFixed(1)}px,${y2.toFixed(1)}px,${z.toFixed(1)}px) rotateY(${yaw.toFixed(2)}deg) rotateX(${S.tiltX}deg) scale(${scale.toFixed(3)})`;
        const filt  = blur > .1 ? `blur(${blur.toFixed(2)}px)` : '';

        cards[i].style.transform    = tf;
        cards[i].style.filter       = filt;
        cards[i].style.opacity      = opacity.toFixed(3);
        cards[i].style.zIndex       = zIdx;
        cards[i].style.pointerEvents = facing > .4 ? 'auto' : 'none';

        if (photos[i]) {
          photos[i].style.transform = tf;
          photos[i].style.filter    = filt;
          photos[i].style.opacity   = (opacity * .97).toFixed(3);
          photos[i].style.zIndex    = zIdx - 1;
        }
      });
    }
  };
})();


(function rafLoop() {
  requestAnimationFrame(rafLoop);
  if (tabHidden) return;

  const t  = clock.getElapsedTime();
  const dt = Math.min(t - lastTime, 0.1); // cap dt щоб не було стрибка після blur вкладки
  lastTime = t;

  /* ── Cursor  ── */
  ring.x = lerpDt(ring.x, mouse.x, 0.14, dt);
  ring.y = lerpDt(ring.y, mouse.y, 0.14, dt);
  curEl.style.left   = mouse.x + 'px';
  curEl.style.top    = mouse.y + 'px';
  ringEl.style.left  = ring.x  + 'px';
  ringEl.style.top   = ring.y  + 'px';

  /* ── Camera Z  ── */
  // FPS-нормалізований lerp — камера однаково плавна на 60 і 120fps
  camCurrentZ = lerpDt(camCurrentZ, camTargetZ, 0.05, dt);
  camCurrentX = lerpDt(camCurrentX, camTargetX, 0.05, dt);
  camera.position.z = camCurrentZ;
  camera.position.y = CAM.Y;
  controls.target.x = lerpDt(controls.target.x, camCurrentX, 0.05, dt);

  /* ── Explode  ── */
  if (isExploding) {
    const p = Math.min((t - explodeStart) * 1_000 / CFG.explode.duration, 1);
    const e = easeInOut(Math.sin(p * Math.PI));
    rings.children.forEach(r => r.material.uniforms.uExplode.value = e);
    if (p >= 1) isExploding = false;
  } else {
    rings.children.forEach(r => {
      const cur = r.material.uniforms.uExplode.value;
      r.material.uniforms.uExplode.value = cur > .002 ? cur * .94 : 0;
    });
  }

  /* ── Sphere scale + alpha  ── */
  const { spiralP, spiralIn, spiralDone } = scrollState;
  const breathe = 1 + Math.sin(t * 1.5) * 0.05;
  let sphereTargetScale = breathe;
  let sphereTargetAlpha = 1;

  if (spiralIn) {
    const adjustedP = Math.max(0, spiralP - 0.05);
    sphereTargetScale = breathe * (1 + adjustedP * 25);
    sphereTargetAlpha = Math.max(0, 1 - adjustedP * 5);
  } else if (spiralDone) {
    sphereTargetAlpha = 0;
    sphereTargetScale = breathe * 15;
  }

  const currentScale = sphere.scale.x;
  // FPS-нормалізований lerp для scale і alpha
  sphere.scale.setScalar(lerpDt(currentScale, sphereTargetScale, 0.05, dt));
  sphereAlphaSmooth   = lerpDt(sphereAlphaSmooth, sphereTargetAlpha, 0.05, dt);
  sphere.material.opacity = sphereAlphaSmooth;

  /* ── Uniforms  ── */
  sphere.material.uniforms.time.value   = t;
  sphere.material.uniforms.uMouse.value.copy(mouse3D);
  rings.children.forEach(r => {
    r.material.uniforms.time.value   = t;
    r.material.uniforms.uMouse.value.copy(mouse3D);
  });
  stars.material.uniforms.time.value = t;
  stars.rotation.y += 0.0003;

  /* ── Rings rotation  ── */
  rings.children.forEach((r, i) => {
    const s = 0.0005 * (i + 1);
    r.rotation.z += s;
    r.rotation.x += s * .3;
    r.rotation.y += s * .2;

    if (spiralDone) {
      const targetScale = 14.0;
      r.scale.x = lerpDt(r.scale.x, targetScale, 0.02, dt);
      r.scale.y = lerpDt(r.scale.y, targetScale, 0.02, dt);
      r.scale.z = lerpDt(r.scale.z, targetScale, 0.02, dt);
    } else {
      r.scale.x = lerpDt(r.scale.x, 1, 0.04, dt);
      r.scale.y = lerpDt(r.scale.y, 1 + Math.sin(t * 3 + i * .5) * .2, 0.04, dt);
      r.scale.z = lerpDt(r.scale.z, 1, 0.04, dt);
    }
    r.material.opacity = 1;
  });

  mainGroup.rotation.y += 0.0005;
  rings.rotation.y     += 0.0005;

  /* ── Spiral CSS  ── */
  spiral.tick(dt);

  controls.update();
  composer.render();
})();


/* ─────────────────────────────────────────────
    Start EVENTS  —  Zoom, themes, page counter 
   ───────────────────────────────────────────── */

   /* ─────────────────────────────────────────────
    start zoom contect 
   ───────────────────────────────────────────── */

const PROJECTS = [
  {
    title: 'Do you',
    subtitle: 'Immersive Art Space · Zurich 2025',
    tags: ['Projection Mapping', '3D Environments', 'Camera Tracking'],
    desc: 'Real-time Unreal Engine setup with virtual camera tracking and projection mapping. Developed for an immersive art installation in Zurich featuring live performance and generative visuals.',
    meta: '<strong>Role:</strong> Virtual Production Operator, Intern<br><strong>Tools:</strong> Unreal Engine 5, disguise<br><strong>Year:</strong> 2025',
    images: [
      { type: 'video', src: 'https://res.cloudinary.com/dtzuydpci/video/upload/v1774359760/Doyou_kd0xsh.mp4' },
    ]
  },
  {
    title: 'Teddy',
    subtitle: 'Official Music Video · Zurich 2024',
    tags: ['Generative patterns', 'Projection Mapping', 'Production'],
    desc: 'Visual concept development, motion graphics, and on-set visual direction for a music video.',
    meta: '<strong>Role:</strong> Creative Developer<br><strong>Tools:</strong>Touchdesigner, After Effects,  Madmapper<br><strong>Year:</strong> 2024',
    images: [
      { type: 'img', src: 'https://res.cloudinary.com/dtzuydpci/image/upload/v1774629013/teddy_5_cdzyyr.png' },
      { type: 'img', src: 'https://res.cloudinary.com/dtzuydpci/image/upload/v1774629011/teddy_3_hhhayj.png' },
      { type: 'img', src: 'https://res.cloudinary.com/dtzuydpci/image/upload/v1774629011/teddy_1_yn5if9.png' },
      { type: 'img', src: 'https://res.cloudinary.com/dtzuydpci/image/upload/v1774629010/teddy_2_xcx74i.png' },
    ]
  },
  {
    title: 'rock your kidney',
    subtitle: 'Immersive Art Space · Zurich 2025',
    tags: ['Projection Mapping', '3D Environments', 'Camera Tracking'],
    desc: 'Real-time Unreal Engine setup with virtual camera tracking and projection mapping. Developed for an immersive art installation in Zurich featuring live performance and generative visuals.',
    meta: '<strong>Role:</strong> Virtual Production Operator, Intern<br><strong>Tools:</strong> Unreal Engine 5, disguise<br><strong>Year:</strong> 2025',
    images: [
      { type: 'img', src: 'https://res.cloudinary.com/dtzuydpci/image/upload/v1774629039/rock_1_cplsbj.png' },
      { type: 'img', src: 'https://res.cloudinary.com/dtzuydpci/image/upload/v1774629040/rock_4_ctrrqu.png' },
      { type: 'img', src: 'https://res.cloudinary.com/dtzuydpci/image/upload/v1774629041/rock_2_sag9tx.png' },
      { type: 'img', src: 'https://res.cloudinary.com/dtzuydpci/image/upload/v1774629039/rock_3_fd4wae.png' },
    ]
  },
  {
    title: 'cyber passage',
    subtitle: 'Virtual Production · 2024',
    tags: ['Unreal Engine', 'Color Grading', 'Lighting'],
    desc: 'Clinical LED wall environment with depth of field and colour grading pipeline for virtual production.',
    meta: '<strong>Role:</strong> Environment & Lighting Artist<br><strong>Tools:</strong> Unreal Engine 5, DaVinci<br><strong>Year:</strong> 2024',
    images: [
      { type: 'video', src: 'https://res.cloudinary.com/dtzuydpci/video/upload/v1774356903/Cyber_Passage-05_gi9ujg.mp4' },
      { type: 'img', src: 'https://res.cloudinary.com/dtzuydpci/image/upload/v1774356768/Cyber_Passage-10_oldama.jpg' },
      { type: 'img', src: 'https://res.cloudinary.com/dtzuydpci/image/upload/v1774356779/Cyber_Passage-02_zqjat6.png' },
      { type: 'img', src: 'https://i-p.rmcdn.net/619d2b5322f258001999020d/4640512/image-d46d9c9c-559e-4425-9f7e-e46af6dc142e.jpg?w=1200&e=webp' },
    ]
  },
  {
    title: 'Dream of war',
    subtitle: 'Web Design · 2024',
    tags: ['Web Design', 'Motion', 'Readymag'],
    desc: 'Interactive portfolio with glassmorphism effects and WebGL particle backgrounds.',
    meta: '<strong>Role:</strong> Designer & Developer<br><strong>Tools:</strong> Readymag, Three.js<br><strong>Year:</strong> 2024',
    images: [
      { type: 'img', src: 'https://res.cloudinary.com/dtzuydpci/image/upload/v1774363379/Dream_of_war_02_zvxbsg.png' },
      { type: 'img', src: 'https://res.cloudinary.com/dtzuydpci/image/upload/v1774363378/Dream_of_war_04_i845o0.png' },
      { type: 'img', src: 'https://res.cloudinary.com/dtzuydpci/image/upload/v1774363384/Dream_of_war_05_avh3sp.png' },
      { type: 'video', src: 'https://res.cloudinary.com/dtzuydpci/video/upload/v1774363500/Dream_of_war_03_r2mexb.mp4' },
    ]
  },
  {
    title: 'Ego',
    subtitle: 'Project · 2025',
    tags: ['Coming Soon'],
    desc: 'Details coming soon.',
    meta: '<strong>Year:</strong> 2025',
    images: [
      { type: 'img', src: 'https://res.cloudinary.com/dtzuydpci/image/upload/v1774362551/Ego-Interactive_exhibitions_01_xkxwj3.png' },
      { type: 'img', src: 'https://res.cloudinary.com/dtzuydpci/image/upload/v1774362552/Ego-Interactive_exhibitions_02_xi8owc.jpg' },
      { type: 'img', src: 'https://res.cloudinary.com/dtzuydpci/image/upload/v1774362556/Ego-Interactive_exhibitions_05_z0edv2.png' },
      { type: 'img', src: 'https://res.cloudinary.com/dtzuydpci/image/upload/v1774362554/Ego-Interactive_exhibitions_03_ypxvcl.jpg' },
    ]
  },
];
/* ─────────────────────────────────────────────
    end zoom contect 
   ───────────────────────────────────────────── */

let zoomCurrentProject = null;
let zoomCurrentImg = 0;
const zoomOverlay = document.getElementById('zoom-overlay');

const isMobile = () => window.innerWidth <= 768;

function openZoom(projIdx, sourceArr) {
  const arr = sourceArr || PROJECTS;
  const p = arr[projIdx];
  if (!p) return;
  zoomCurrentProject = p;
  zoomCurrentImg = 0;
  document.getElementById('zoom-title').textContent    = p.title;
  document.getElementById('zoom-subtitle').textContent = p.subtitle;
  document.getElementById('zoom-desc').textContent     = p.desc;
  document.getElementById('zoom-meta').innerHTML       = p.meta;
  document.getElementById('zoom-tags').innerHTML = p.tags.map(t => `<span class="meta-tag">${t}</span>`).join('');
  const allEls = p.images.map(item => item.type === 'video'
    ? `<video src="${item.src}" autoplay muted loop playsinline></video>`
    : `<img src="${item.src}" alt="${p.title}"/>`
  ).join('');
  document.getElementById('zoom-grid').innerHTML = allEls;
  zoomOverlay.classList.add('open');
  zoomOverlay.scrollTop = 0;
  document.body.style.overflow = 'hidden';
}

function closeZoom() {
  zoomOverlay.classList.remove('open');
  document.body.style.overflow = '';
  zoomOverlay.scrollTop = 0;
}


document.getElementById('zoom-close').addEventListener('click', closeZoom);
zoomOverlay.addEventListener('click', e => { if (e.target === zoomOverlay) closeZoom(); });
document.addEventListener('keydown', e => {
  if (!zoomOverlay.classList.contains('open')) return;
  if (e.key === 'Escape') closeZoom();
});
document.addEventListener('touchend', e => {
  const card = e.target.closest('.card');
  if (!card) return;
  e.preventDefault();
  openZoom(parseInt(card.dataset.idx));
}, { passive: false });

document.querySelectorAll('.tdot').forEach(dot => dot.addEventListener('click', () => applyTheme(dot.dataset.t)));

const sections  = ['s-home','s-work','s-about','s-contact'].map(id => document.getElementById(id));
const pgCurEl   = document.getElementById('pg-cur');
sections.forEach(s => new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting)
      pgCurEl.textContent = String(sections.indexOf(e.target)+1).padStart(2,'0');
  });
}, { threshold: .3 }).observe(s));

/* ─────────────────────────────────────────────
    MORE WORK CAROUSEL  
   ───────────────────────────────────────────── */

    /* ─────────────────────────────────────────────
    start CAROUSEL contect 
   ───────────────────────────────────────────── */

const MORE_PROJECTS = [
  {
  title: 'Portfolio Site',
  subtitle: 'Web Design · 2025',
  tags: ['Web Design', 'Motion', 'Readymag'],
  desc: 'Опис проєкту.',
  meta: '<strong>Role:</strong> ...<br><strong>Tools:</strong> ...<br><strong>Year:</strong> 2024',
  images: [
    { type: 'img', src: 'https://res.cloudinary.com/dtzuydpci/image/upload/v1774537350/forever_trashed4_1_vpay3y.jpg' },
  ],
},
  {
  title: 'Portfolio Site',
  subtitle: 'Web Design · 2025',
  tags: ['Web Design', 'Motion', 'Readymag'],
  desc: 'Опис проєкту.',
  meta: '<strong>Role:</strong> ...<br><strong>Tools:</strong> ...<br><strong>Year:</strong> 2024',
  images: [
    { type: 'img', src: 'https://res.cloudinary.com/dtzuydpci/image/upload/v1774363008/Cyber_Passage-12_pvnw3o.jpg' },
  ],
},
  {
  title: 'Portfolio Site',
  subtitle: 'Web Design · 2025',
  tags: ['Web Design', 'Motion', 'Readymag'],
  desc: 'Опис проєкту.',
  meta: '<strong>Role:</strong> ...<br><strong>Tools:</strong> ...<br><strong>Year:</strong> 2024',
  images: [
    { type: 'video', src: 'https://res.cloudinary.com/dtzuydpci/video/upload/v1774623951/new_food_-_Trim_aisx11.mp4' },
    { type: 'img', src: 'https://res.cloudinary.com/dtzuydpci/image/upload/v1774623115/copy_of_kalei_1_ntog2e_8f915b.png' },
  ],
},
  {
  title: 'Portfolio Site',
  subtitle: 'Web Design · 2025',
  tags: ['Web Design', 'Motion', 'Readymag'],
  desc: 'Опис проєкту.',
  meta: '<strong>Role:</strong> ...<br><strong>Tools:</strong> ...<br><strong>Year:</strong> 2024',
  images: [
    { type: 'img', src: 'https://res.cloudinary.com/dtzuydpci/image/upload/v1774624286/Kaleidoscope1_mwmfei.jpg' },
  ],
},
  {
  title: 'Portfolio Site',
  subtitle: 'Web Design · 2025',
  tags: ['Web Design', 'Motion', 'Readymag'],
  desc: 'Опис проєкту.',
  meta: '<strong>Role:</strong> ...<br><strong>Tools:</strong> ...<br><strong>Year:</strong> 2024',
  images: [
    { type: 'img', src: 'https://res.cloudinary.com/dtzuydpci/image/upload/v1774622526/plug_in_3_gibrbh.jpg' },
  ],
},
];

   /* ─────────────────────────────────────────────
    end CAROUSEL contect 
   ───────────────────────────────────────────── */

/* ─────────────────────────────────────────────
    star CAROUSEL functionality — рендер карток, навігація, кліки, ресайз
   ───────────────────────────────────────────── */
const mCarousel = document.querySelector('.more-carousel');
if (mCarousel) {

mCarousel.innerHTML = MORE_PROJECTS.map((p, i) => {
    const first = p.images[0];
    const thumb = first.type === 'video'
      ? `<video src="${first.src}" autoplay muted loop playsinline></video>`
      : `<img src="${first.src}" alt="${p.title}"/>`;
    return `
    <div class="embla__slide" data-idx="${i}">
      <div class="mc-card">
        <div class="mc-img">${thumb}</div>
        <div class="mc-meta">
          <div class="meta-tags">${p.tags.map(t => `<span class="meta-tag">${t}</span>`).join('')}</div>
          <div class="subtitle">${p.subtitle}</div>
          <h3>${p.title}</h3>
          <span class="cta-link">View Project →</span>
        </div>
      </div>
    </div>
  `;}).join('');

  const embla = window.EmblaCarousel(
    document.querySelector('.embla__viewport'),
    { loop: true, align: 'center', skipSnaps: false, containScroll: 'trimSnaps' }
  );

  const dotsWrap = document.querySelector('.embla__dots');

  function buildDots() {
    if (!dotsWrap) return;
    dotsWrap.innerHTML = '';
    embla.scrollSnapList().forEach((_, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'embla__dot';
      b.addEventListener('click', () => embla.scrollTo(i));
      dotsWrap.appendChild(b);
    });
  }

  function updateDots() {
    if (!dotsWrap) return;
    const idx = embla.selectedScrollSnap();
    dotsWrap.querySelectorAll('.embla__dot').forEach((d, i) => {
      d.setAttribute('aria-selected', i === idx ? 'true' : 'false');
    });
  }

  function setSelected() {
    document.querySelectorAll('.embla__slide').forEach(s => s.classList.remove('is-selected'));
    const idx = embla.selectedScrollSnap();
    const slides = embla.slideNodes();
    if (slides && slides[idx]) slides[idx].classList.add('is-selected');
    updateDots();
  }

  buildDots();
  setSelected();
  embla.on('select', setSelected);
  embla.on('reInit', () => { buildDots(); setSelected(); });

  setTimeout(() => embla.reInit(), 0);

  window.addEventListener('resize', (() => {
    let t = null;
    return () => { clearTimeout(t); t = setTimeout(() => embla.reInit(), 120); };
  })());

  document.querySelector('.mc-prev').addEventListener('click', () => embla.scrollPrev());
  document.querySelector('.mc-next').addEventListener('click', () => embla.scrollNext());

  mCarousel.addEventListener('click', e => {
    const slide = e.target.closest('.embla__slide');
    if (!slide) return;
    openZoom(parseInt(slide.dataset.idx), MORE_PROJECTS);
  });
}
