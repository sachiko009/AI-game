'use strict';
const $ = id => document.getElementById(id);

// ===== 定数 =====
const R = 0.5;            // 球（当たり判定）の半径
const GRAVITY = 22;       // 重力
const JUMP_V = 9;         // ジャンプ初速
const SPEED = 5;          // 水平移動速度
const CAM_DIST = 12;      // カメラと球の距離

// 足場のテーマ（身近な家具・機器）: 本体の色と、上面に描く絵の種類
const ITEMS = [
  { name: 'phone',   body: 0xff8fb8 },                    // スマホ
  { name: 'laptop',  body: 0xb8c4d6 },                    // ノートPC
  { name: 'tv',      body: 0xffc46b },                    // レトロTV
  { name: 'game',    body: 0x7dd3fc },                    // ゲーム機
  { name: 'cushion', body: 0xc4a1ff, rough: 0.75 },       // クッション（布は少しマット）
  { name: 'radio',   body: 0x5eead4 }                     // ラジカセ
];

// ===== サウンド（Web Audioでピコピコ音を生成） =====
let audioCtx = null, soundOn = true;
function beep(f1, f2, dur, type = 'square', vol = 0.08) {
  if (!soundOn) return;
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  const t = audioCtx.currentTime, o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f1, t);
  o.frequency.exponentialRampToValueAtTime(f2, t + dur);   // 音程をスライドさせる
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);     // 音量を減衰
  o.connect(g).connect(audioCtx.destination);
  o.start(t); o.stop(t + dur);
}
const sfxJump = () => beep(300, 700, 0.15);
const sfxCoin = () => { beep(900, 1400, 0.1); setTimeout(() => beep(1400, 1900, 0.12), 80); };
const sfxOver = () => beep(500, 80, 0.6, 'sawtooth', 0.1);

// ===== Three.js 初期化（レンダラー・ライト・影）=====
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); // 背景はCSSのグラデを透過表示
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputEncoding = THREE.sRGBEncoding;               // 色を正しく・きれいに表示
renderer.toneMapping = THREE.ACESFilmicToneMapping;         // 映画のような自然な明暗
renderer.toneMappingExposure = 1.2;
renderer.shadowMap.enabled = true;                          // 影を有効化
renderer.shadowMap.type = THREE.PCFSoftShadowMap;           // ふちがやわらかい影
$('game').appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);

// 環境光: 全体をやわらかく照らして暗くなりすぎないようにする
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
// 太陽光: 斜め上からの強い光。ハイライトと影を作る
const sun = new THREE.DirectionalLight(0xffffff, 1.3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);                         // 重い端末では1024に下げる
const sc = sun.shadow.camera;
sc.left = -14; sc.right = 14; sc.top = 14; sc.bottom = -14; sc.near = 1; sc.far = 60;
sc.updateProjectionMatrix();
sun.shadow.bias = -0.0005;                                  // 影のシマシマ（アクネ）対策
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

// 画面サイズ変更に追従（レスポンシブ）
function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ===== 材質ヘルパー（すべてMeshStandardMaterial）=====
const std = (color, rough = 0.3, metal = 0.1, extra = {}) =>
  new THREE.MeshStandardMaterial(Object.assign({ color, roughness: rough, metalness: metal }, extra));

// ===== 足場の上面に貼る絵（Canvasで描いてテクスチャにする）=====
function rr(c, x, y, w, h, r) {                            // 角丸四角のパスを作る
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);         c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
const DRAW = {
  // スマホ: 画面に時計とアプリアイコン
  phone(c) {
    c.fillStyle = '#232a4d'; rr(c, 8, 8, 240, 240, 30); c.fill();
    c.fillStyle = '#fff'; c.font = 'bold 34px sans-serif'; c.textAlign = 'center'; c.fillText('12:34', 128, 54);
    const cols = ['#ff6f91', '#ffd93d', '#5eead4', '#7dd3fc', '#c4a1ff', '#ff9f68'];
    for (let i = 0; i < 16; i++) {
      c.fillStyle = cols[i % 6];
      rr(c, 28 + (i % 4) * 52, 76 + Math.floor(i / 4) * 42, 40, 34, 10); c.fill();
    }
  },
  // ノートPC: キーボードとトラックパッド
  laptop(c) {
    c.fillStyle = '#eef1f7'; rr(c, 8, 8, 240, 240, 26); c.fill();
    c.fillStyle = '#6b7591';
    for (let r = 0; r < 5; r++) for (let k = 0; k < 8; k++) { rr(c, 24 + k * 25, 26 + r * 24, 20, 19, 5); c.fill(); }
    c.fillStyle = '#cfd6e6'; rr(c, 86, 158, 84, 64, 10); c.fill();
  },
  // レトロTV: カラーバーの画面
  tv(c) {
    c.fillStyle = '#3b2a5a'; rr(c, 8, 8, 240, 240, 34); c.fill();
    c.save(); rr(c, 24, 24, 208, 208, 22); c.clip();
    ['#fff', '#ffe14d', '#4de1ff', '#5be37d', '#ff6fd8', '#ff5a5a', '#5a7dff']
      .forEach((col, i) => { c.fillStyle = col; c.fillRect(24 + i * 30, 24, 30, 208); });
    c.restore();
  },
  // ゲーム機: 画面・十字キー・ボタン
  game(c) {
    c.fillStyle = '#26304f'; rr(c, 36, 16, 184, 116, 14); c.fill();
    c.fillStyle = '#9be7ff'; c.font = 'bold 46px sans-serif'; c.textAlign = 'center'; c.fillText('^_^', 128, 90);
    c.fillStyle = '#fff'; rr(c, 52, 170, 72, 22, 8); c.fill(); rr(c, 77, 145, 22, 72, 8); c.fill();
    c.fillStyle = '#ff5a7a'; c.beginPath(); c.arc(196, 196, 20, 0, 7); c.fill();
    c.fillStyle = '#ffe14d'; c.beginPath(); c.arc(166, 166, 20, 0, 7); c.fill();
  },
  // クッション: ステッチとボタン
  cushion(c) {
    c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = 5; c.setLineDash([10, 10]);
    rr(c, 20, 20, 216, 216, 30); c.stroke();
    c.beginPath(); c.moveTo(20, 20); c.lineTo(236, 236); c.moveTo(236, 20); c.lineTo(20, 236); c.stroke();
    c.setLineDash([]); c.fillStyle = '#8f6be0'; c.beginPath(); c.arc(128, 128, 16, 0, 7); c.fill();
  },
  // ラジカセ: 2つのスピーカーとチューナー
  radio(c) {
    [[62, 128], [194, 128]].forEach(([x, y]) => {
      c.fillStyle = '#2a3550'; c.beginPath(); c.arc(x, y, 46, 0, 7); c.fill();
      c.strokeStyle = '#6b7ba5'; c.lineWidth = 4;
      [32, 20, 8].forEach(r => { c.beginPath(); c.arc(x, y, r, 0, 7); c.stroke(); });
    });
    c.fillStyle = '#fff7d6'; rr(c, 112, 52, 32, 76, 8); c.fill();
    c.fillStyle = '#ff5a7a'; c.fillRect(126, 58, 4, 64);
    c.fillStyle = '#ffe14d'; c.beginPath(); c.arc(128, 176, 14, 0, 7); c.fill();
  }
};
const texCache = {};                                       // 同じ絵は使い回す
function topTex(name) {
  if (!texCache[name]) {
    const cn = document.createElement('canvas');
    cn.width = cn.height = 256;
    DRAW[name](cn.getContext('2d'));
    const t = new THREE.CanvasTexture(cn);
    t.encoding = THREE.sRGBEncoding; t.anisotropy = 4;
    texCache[name] = t;
  }
  return texCache[name];
}

// ===== 角丸ブロックのジオメトリ（角丸四角を押し出し、上下の縁も丸める）=====
function roundedPlatformGeo(w, h, r) {
  const bv = 0.15;                                   // 縁の丸み（ベベル幅）
  const s = w - bv * 2, x0 = -s / 2;
  const rr_ = Math.min(r, s / 2 - 0.01);             // 角の丸み半径
  const shape = new THREE.Shape();
  shape.moveTo(x0 + rr_, x0);
  shape.lineTo(-x0 - rr_, x0);  shape.quadraticCurveTo(-x0, x0, -x0, x0 + rr_);
  shape.lineTo(-x0, -x0 - rr_); shape.quadraticCurveTo(-x0, -x0, -x0 - rr_, -x0);
  shape.lineTo(x0 + rr_, -x0);  shape.quadraticCurveTo(x0, -x0, x0, -x0 - rr_);
  shape.lineTo(x0, x0 + rr_);   shape.quadraticCurveTo(x0, x0, x0 + rr_, x0);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: h - bv * 2, bevelEnabled: true, bevelThickness: bv, bevelSize: bv,
    bevelSegments: 4, curveSegments: 8
  });
  g.rotateX(-Math.PI / 2);                           // 押し出し方向を上向きにする
  g.translate(0, -(h - bv * 2) / 2, 0);              // 高さの中心を原点に合わせる
  return g;
}

// ===== かわいいキャラクター（すべてMeshStandardMaterial）=====
function createCharacter() {
  const BODY_R = 0.38;                 // 体の半径
  const BODY_Y = 0.08;                 // 体の持ち上げ量（足が見えるように）
  const k = BODY_R / R;                // 顔パーツを体の大きさに合わせる倍率
  const pos = (x, y, z) => [x * k, y * k + BODY_Y, z * k];

  const g = new THREE.Group();        // 位置・向きを動かす親
  const model = new THREE.Group();    // 伸び縮み用の子
  g.add(model);

  // ボディ（つやつやのプラスチック風）
  const body = new THREE.Mesh(new THREE.SphereGeometry(BODY_R, 32, 24), std(0xffa6d5, 0.25, 0.1));
  body.position.y = BODY_Y;
  model.add(body);

  // 目（つやのある黒目＋光るハイライト）。まばたき用にグループ化
  const eyes = [-1, 1].map(s => {
    const e = new THREE.Group();
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.085 * k, 16, 12), std(0x2a2140, 0.15, 0.1));
    pupil.scale.z = 0.6;
    const shine = new THREE.Mesh(new THREE.SphereGeometry(0.03 * k, 10, 8), std(0xffffff, 0.3, 0, { emissive: 0xffffff }));
    shine.position.set(0.03 * k, 0.035 * k, 0.05 * k);
    e.add(pupil, shine);
    e.position.set(...pos(s * 0.18, 0.1, 0.45));
    model.add(e);
    return e;
  });

  // ほっぺ
  [-1, 1].forEach(s => {
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.07 * k, 12, 8), std(0xff6f91, 0.7, 0));
    c.scale.set(1, 0.6, 0.4);
    c.position.set(...pos(s * 0.3, -0.06, 0.39));
    model.add(c);
  });

  // 口（にっこり）
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.05 * k, 0.014 * k, 8, 14, Math.PI), std(0x3b2a5a, 0.4, 0));
  mouth.rotation.z = Math.PI;
  mouth.position.set(...pos(0, -0.02, 0.49));
  model.add(mouth);

  // ネコ耳
  const ears = [-1, 1].map(s => {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.14 * k, 0.3 * k, 16), std(0xff8ec8, 0.3, 0.1));
    ear.position.set(...pos(s * 0.25, 0.5, 0));
    ear.rotation.z = -s * 0.35;
    ear.userData.baseZ = ear.rotation.z;
    model.add(ear);
    return ear;
  });

  // 足（歩くときに前後に動かす）
  const feet = [-1, 1].map(s => {
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), std(0xffb347, 0.3, 0.1));
    f.scale.set(1, 0.7, 1.3);
    f.position.set(s * 0.17, -0.4, 0.06);
    model.add(f);
    return f;
  });

  g.userData = { model, eyes, ears, feet };
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });   // キャラも影を落とす
  return g;
}
const ball = createCharacter();   // 名前はballのまま（位置・当たり判定は今までどおり）
scene.add(ball);

// ===== ゲーム状態 =====
let state = 'start';                 // start / play / over
let plats = [], coinsArr = [], parts = [];
let last, count, vx, vy, vz, grounded, maxH, bestPlat, coinScore, coinCount;
let squash = 0, walkT = 0, blinkT = 2, blinkOn = 0;   // 着地の潰れ・歩き・まばたき用タイマー
let best = 0;
try { best = +localStorage.getItem('popclimbBest') || 0; } catch (e) {}
// 入力状態（camYaw / camPitch は画面ボタンによる視点操作: -1,0,1）
const input = { dx: 0, dz: 0, keys: {}, camYaw: 0, camPitch: 0 };
// カメラ設定: 横回転角・見下ろし角
let camYaw = 0, camPitch = 0.72;

// 足場を1つ追加（家具・機器の角丸ブロック）
function addPlatform(x, y, z, w) {
  const item = ITEMS[count % ITEMS.length];
  const p = new THREE.Mesh(roundedPlatformGeo(w, 1, 0.6), std(item.body, item.rough || 0.3, 0.1));
  // 上面に絵（スマホの画面など）を貼る薄い板。ボディより0.003だけ上
  const top = new THREE.Mesh(
    new THREE.PlaneGeometry(w - 0.55, w - 0.55),
    new THREE.MeshStandardMaterial({ map: topTex(item.name), transparent: true, roughness: 0.35, metalness: 0.05,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  top.rotation.x = -Math.PI / 2;
  top.position.y = 0.503;
  top.receiveShadow = true;
  p.add(top);
  p.castShadow = true; p.receiveShadow = true;       // 影を落とし、影を受ける
  p.position.set(x, y - 0.5, z);                     // 上面がyになるよう配置
  scene.add(p);
  const pl = { mesh: p, x, y, z, w, landed: false };
  plats.push(pl);
  return pl;
}

// 足場を捨てる（メモリ解放つき）
function removePlatform(p) { scene.remove(p.mesh); p.mesh.geometry.dispose(); }

// 次の足場とコインを生成（上に行くほど小さく・高低差と隙間が大きくなる）
function spawn() {
  const d = Math.min(count / 40, 1);                    // 難易度 0〜1
  const w = 4 - d * 1.6 + Math.random() * 0.4;          // 幅は4→約2.4へ
  const gap = 1.0 + d * 0.9 + Math.random() * 0.3;      // 足場の「端どうし」の隙間
  const dy = 0.4 + d * 0.5 + Math.random() * 0.3;       // 高低差（ジャンプ可能範囲内）
  const MIN_GAP = 0.9;                                  // どの足場とも最低これだけ離す

  let nx, nz;
  for (let tries = 0; tries < 30; tries++) {
    let ang = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;          // 基本は奥方向
    if (last.x > 7) ang = Math.PI * (0.6 + Math.random() * 0.3);   // 右に寄りすぎたら左へ
    if (last.x < -7) ang = -Math.PI * (0.1 + Math.random() * 0.3); // 左に寄りすぎたら右へ
    const c = Math.cos(ang), s = Math.sin(ang);
    const dist = ((w + last.w) / 2 + gap) / Math.max(Math.abs(c), Math.abs(s));
    nx = last.x + c * dist;
    nz = last.z + s * dist;
    const ok = plats.every(p =>                                     // 既存の足場と重ならないか確認
      Math.abs(p.y - (last.y + dy)) > 4 ||
      Math.max(Math.abs(nx - p.x), Math.abs(nz - p.z)) - (w + p.w) / 2 >= MIN_GAP);
    if (ok) break;
  }

  count++;
  last = addPlatform(nx, last.y + dy, nz, w);
  if (Math.random() < 0.35) {                           // 一定確率でコイン配置（金色のつやつや）
    const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.4),
      std(0xffd23f, 0.25, 0.5, { emissive: 0xffa600, emissiveIntensity: 0.35 }));
    c.castShadow = true;
    c.position.set(last.x, last.y + 1.3, last.z);
    scene.add(c);
    coinsArr.push(c);
  }
}

// キラキラのパーティクルを放出（光って見えるようBasicMaterial）
const pGeo = new THREE.BoxGeometry(0.15, 0.15, 0.15);
function burst(pos, color, n) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(pGeo, new THREE.MeshBasicMaterial({ color, transparent: true }));
    m.position.copy(pos);
    scene.add(m);
    parts.push({ m, life: 1, v: new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 6, (Math.random() - 0.5) * 6) });
  }
}

// ワールドを初期状態に戻す
function resetWorld() {
  plats.forEach(removePlatform);
  [...coinsArr, ...parts.map(p => p.m)].forEach(o => scene.remove(o));
  plats = []; coinsArr = []; parts = [];
  count = 0;
  last = addPlatform(0, 0, 0, 6);          // スタート足場
  ball.position.set(0, R, 0);
  ball.rotation.set(0, 0, 0); squash = 0;   // キャラの向きと潰れをリセット
  vx = vy = vz = 0; grounded = true;
  maxH = 0; bestPlat = 0; coinScore = 0; coinCount = 0;
  camera.position.set(0, 8, 9);
  camera.lookAt(0, 0, 0);
  while (last.y < 25) spawn();
}

// ===== 操作 =====
function jump() {
  if (state !== 'play' || !grounded) return;
  vy = JUMP_V; grounded = false; sfxJump();
}
window.addEventListener('keydown', e => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  input.keys[e.code] = true;
  if (e.code === 'Space') { if (state === 'play') jump(); else startGame(); }  // スペースで開始/再開
});
window.addEventListener('keyup', e => { input.keys[e.code] = false; });

// ドラッグで移動方向を指定。移動中に別の指で画面をタップ、またはJUMPボタンでジャンプ
let touch = null;
const canvasEl = renderer.domElement;
canvasEl.addEventListener('pointerdown', e => {
  if (touch) { jump(); return; }              // すでに1本の指で移動中 → 2本目の指のタップはジャンプ
  canvasEl.setPointerCapture(e.pointerId);    // 指がボタン上に出ても移動操作を続ける
  touch = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
});
canvasEl.addEventListener('pointermove', e => {
  if (!touch || e.pointerId !== touch.id) return;   // 移動用の指だけを見る
  const ox = e.clientX - touch.x, oy = e.clientY - touch.y;
  if (Math.hypot(ox, oy) > 12) touch.moved = true;
  input.dx = Math.max(-1, Math.min(1, ox / 50));    // 開始点からのずれ = 傾き
  input.dz = Math.max(-1, Math.min(1, oy / 50));
});
const endTouch = e => {
  if (!touch || e.pointerId !== touch.id) return;
  if (!touch.moved && performance.now() - touch.t < 300) jump();   // 動かさず短く触れた = タップでジャンプ
  touch = null; input.dx = input.dz = 0;
};
canvasEl.addEventListener('pointerup', endTouch);
canvasEl.addEventListener('pointercancel', endTouch);

// JUMPボタン: 押した瞬間にジャンプ（ボタンが無くてもエラーで止まらないようにする）
const jumpBtn = $('jumpBtn');
if (jumpBtn) jumpBtn.addEventListener('pointerdown', e => { e.preventDefault(); jump(); });
// 視点ボタン: 押している間だけ値を入れ、離したら0に戻す
document.querySelectorAll('#camBtns button').forEach(b => {
  const key = b.dataset.cam, v = +b.dataset.v;
  b.addEventListener('pointerdown', e => { e.preventDefault(); input[key] = v; });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => b.addEventListener(t, () => { input[key] = 0; }));
});

// ===== 画面遷移 =====
function startGame() {
  if (state === 'play') return;
  resetWorld();
  state = 'play';
  $('startScreen').classList.add('hidden');
  $('resultScreen').classList.add('hidden');
}
function gameOver() {
  state = 'over'; sfxOver();
  const score = Math.floor(maxH * 10) + coinScore;
  if (score > best) { best = score; try { localStorage.setItem('popclimbBest', best); } catch (e) {} }
  $('rScore').textContent = score;
  $('rBest').textContent = best;
  $('resultScreen').classList.remove('hidden');
}
$('startBtn').onclick = startGame;
$('retryBtn').onclick = () => { state = 'over'; startGame(); };
$('soundBtn').onclick = e => { soundOn = !soundOn; e.target.textContent = 'SOUND: ' + (soundOn ? 'ON' : 'OFF'); e.target.blur(); };

// ===== ゲーム更新（プレイ中のみ毎フレーム呼ばれる）=====
function update(dt) {
  // --- 入力から目標速度を決める（キーボード or ドラッグ）---
  const k = input.keys;
  const shift = k.ShiftLeft || k.ShiftRight;             // Shift中は視点操作なので球は動かさない
  const ax = shift ? 0 : (k.ArrowRight ? 1 : 0) - (k.ArrowLeft ? 1 : 0) || input.dx;   // 右が+
  const az = shift ? 0 : (k.ArrowDown ? 1 : 0) - (k.ArrowUp ? 1 : 0) || input.dz;      // 手前が+
  // 入力方向をカメラの向きに合わせて回す（↑ = 常に画面の奥へ）
  const cs = Math.cos(camYaw), sn = Math.sin(camYaw);
  const tx = ax * cs + az * sn, tz = -ax * sn + az * cs;
  const acc = Math.min(1, dt * (grounded ? 10 : 4));     // 空中は少し慣性を残す
  vx += (tx * SPEED - vx) * acc;
  vz += (tz * SPEED - vz) * acc;

  // --- 重力と位置更新 ---
  const prevY = ball.position.y;
  vy -= GRAVITY * dt;
  ball.position.x += vx * dt;
  ball.position.z += vz * dt;
  ball.position.y += vy * dt;

  // --- 足場への着地判定（落下中のみ）---
  const was = grounded;                       // 前フレームで接地していたか
  grounded = false;
  if (vy <= 0) {
    for (const p of plats) {
      const h = p.w / 2 + 0.15;
      if (Math.abs(ball.position.x - p.x) < h && Math.abs(ball.position.z - p.z) < h &&
          prevY - R >= p.y - 0.05 && ball.position.y - R <= p.y) {
        ball.position.y = p.y + R; vy = 0; grounded = true;
        if (!was) squash = 1;                 // 着地した瞬間にぺしゃっと潰す
        if (!p.landed) { p.landed = true; bestPlat = Math.max(bestPlat, p.y); burst(ball.position, 0xffffff, 8); }
        break;
      }
    }
  }

  // --- コイン取得 ---
  for (let i = coinsArr.length - 1; i >= 0; i--) {
    if (coinsArr[i].position.distanceTo(ball.position) < 1) {
      burst(coinsArr[i].position, 0xffe14d, 20); sfxCoin();
      scene.remove(coinsArr[i]); coinsArr.splice(i, 1);
      coinScore += 50; coinCount++;
    }
  }

  // --- スコア更新・足場の追加と削除 ---
  maxH = Math.max(maxH, ball.position.y - R);
  while (last.y < ball.position.y + 25) spawn();
  plats = plats.filter(p => { if (p.y < ball.position.y - 30) { removePlatform(p); return false; } return true; });

  // --- 直前に乗った高さより大きく落ちたらゲームオーバー ---
  if (ball.position.y < bestPlat - 9) gameOver();

  $('score').textContent = Math.floor(maxH * 10) + coinScore;
  $('best').textContent = best;
  $('coins').textContent = coinCount;
}

// キャラのアニメーション（向き・伸び縮み・歩き・まばたき・耳）
function animateChar(dt) {
  const u = ball.userData;
  const sp = Math.hypot(vx, vz);

  // 進む方向へ滑らかに顔を向ける
  if (sp > 0.5) {
    let d = Math.atan2(vx, vz) - ball.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));           // -π〜πに丸める
    ball.rotation.y += d * Math.min(1, dt * 12);
  }

  // 空中は縦に伸び、着地でつぶれ、立っているときはゆらゆら呼吸
  squash = Math.max(0, squash - dt * 6);
  const sy = grounded ? 1 - squash * 0.3 + Math.sin(performance.now() / 300) * 0.02
                      : 1 + Math.min(Math.abs(vy) / 40, 0.22);
  const sxz = 1 / Math.sqrt(sy);                        // 体積が変わらないように横は逆に縮める
  u.model.scale.set(sxz, sy, sxz);

  // ぴょこぴょこ歩き（足を前後に交互に動かす。空中では足をたたむ）
  walkT += dt * sp * 2.2;
  const sw = grounded ? Math.sin(walkT) * Math.min(sp / SPEED, 1) * 0.15 : 0;
  u.feet[0].position.z = 0.06 + sw;
  u.feet[1].position.z = 0.06 - sw;
  u.feet.forEach(f => { f.position.y = grounded ? -0.4 : -0.36; });

  // まばたき（2〜5秒おきに0.12秒だけ目を閉じる）
  blinkT -= dt;
  if (blinkT < 0) { blinkT = 2 + Math.random() * 3; blinkOn = 0.12; }
  blinkOn = Math.max(0, blinkOn - dt);
  u.eyes.forEach(e => { e.scale.y = blinkOn > 0 ? 0.1 : 1; });

  // 耳: 落下中は上に、上昇中は後ろにたなびく
  const tilt = Math.max(-0.3, Math.min(0.3, -vy * 0.03));
  u.ears.forEach((e, i) => { e.rotation.z = e.userData.baseZ + (i ? -tilt : tilt); });
}

// ===== メインループ（毎フレーム）=====
const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);   // 経過時間（タブ復帰時の暴走を防ぐ上限付き）
  if (state === 'play') update(dt);
  animateChar(dt);

  // コインを回転
  coinsArr.forEach(c => { c.rotation.y += dt * 3; });

  // パーティクル更新（重力で落ちながらフェードアウト）
  parts = parts.filter(p => {
    p.life -= dt * 1.8;
    p.v.y -= 10 * dt;
    p.m.position.addScaledVector(p.v, dt);
    p.m.material.opacity = Math.max(p.life, 0);
    if (p.life <= 0) { scene.remove(p.m); return false; }
    return true;
  });

  // 視点回転: Shift+矢印キー、または画面ボタンでカメラの角度を変える
  const k = input.keys, shift = k.ShiftLeft || k.ShiftRight;
  camYaw += ((shift ? (k.ArrowRight ? 1 : 0) - (k.ArrowLeft ? 1 : 0) : 0) + input.camYaw) * dt * 2;
  camPitch += ((shift ? (k.ArrowUp ? 1 : 0) - (k.ArrowDown ? 1 : 0) : 0) + input.camPitch) * dt * 1.2;
  camPitch = Math.max(0.25, Math.min(1.35, camPitch));   // 真横〜真上付近までに制限

  // カメラは球の周りを回る位置へ滑らかに追従（lerp）
  const cp = Math.cos(camPitch);
  const target = new THREE.Vector3(
    ball.position.x + Math.sin(camYaw) * cp * CAM_DIST,
    ball.position.y + Math.sin(camPitch) * CAM_DIST,
    ball.position.z + Math.cos(camYaw) * cp * CAM_DIST);
  camera.position.lerp(target, Math.min(1, dt * 6));
  camera.lookAt(ball.position.x, ball.position.y, ball.position.z);

  // 太陽光（と影の範囲）を球に追従させる
  sun.target.position.copy(ball.position);
  sun.position.set(ball.position.x + 6, ball.position.y + 14, ball.position.z + 8);

  renderer.render(scene, camera);
}

resetWorld();   // スタート画面の背景用に初期ワールドを作る
loop();