'use strict';
const $ = id => document.getElementById(id);

// ===== 定数 =====
const R = 0.5;            // 球の半径
const GRAVITY = 22;       // 重力
const JUMP_V = 9;         // ジャンプ初速
const SPEED = 5;          // 水平移動速度
const CAM_DIST = 12;      // カメラと球の距離
const COLORS = [0xff6fb5, 0x5eead4, 0xffd93d, 0x7dd3fc, 0xc4a1ff, 0xff9f68]; // ポップな配色

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

// ===== Three.js 初期化 =====
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); // 背景はCSSのグラデを透過表示
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
$('game').appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
scene.add(new THREE.AmbientLight(0xffffff, 0.75));
const sun = new THREE.DirectionalLight(0xffffff, 0.8);
sun.position.set(5, 10, 7);
scene.add(sun);

// 画面サイズ変更に追従（レスポンシブ）
function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// 縁取り付きのメッシュを作る（レトロなイラスト風）
function outlined(geo, mat) {
  const m = new THREE.Mesh(geo, mat);
  m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x3b2a5a })));
  return m;
}

// 角丸ブロックのジオメトリを作る（角丸の四角形を押し出し、上下の縁も丸める）
function roundedPlatformGeo(w, h, r) {
  const bv = 0.15;                                   // 縁の丸み（ベベル幅）
  const s = w - bv * 2, x0 = -s / 2;                 // ベベル分を引いた四角形のサイズ
  const rr = Math.min(r, s / 2 - 0.01);              // 角の丸み半径
  const shape = new THREE.Shape();                   // 角丸の四角形を描く
  shape.moveTo(x0 + rr, x0);
  shape.lineTo(-x0 - rr, x0);  shape.quadraticCurveTo(-x0, x0, -x0, x0 + rr);
  shape.lineTo(-x0, -x0 - rr); shape.quadraticCurveTo(-x0, -x0, -x0 - rr, -x0);
  shape.lineTo(x0 + rr, -x0);  shape.quadraticCurveTo(x0, -x0, x0, -x0 - rr);
  shape.lineTo(x0, x0 + rr);   shape.quadraticCurveTo(x0, x0, x0 + rr, x0);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: h - bv * 2, bevelEnabled: true, bevelThickness: bv, bevelSize: bv,
    bevelSegments: 3, curveSegments: 6
  });
  g.rotateX(-Math.PI / 2);                           // 押し出し方向を上向きにする
  g.translate(0, -(h - bv * 2) / 2, 0);              // 高さの中心を原点に合わせる
  return g;
}

// 角丸メッシュに黒い輪郭を付ける（少し大きい黒い裏面メッシュを重ねる）
function roundOutlined(geo, mat, w, h) {
  const m = new THREE.Mesh(geo, mat);
  const o = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x3b2a5a, side: THREE.BackSide }));
  o.scale.set((w + 0.14) / w, (h + 0.14) / h, (w + 0.14) / w);
  m.add(o);
  return m;
}

// 黒い輪郭を付ける（少し大きい黒い裏面メッシュを重ねる）
function addHull(mesh, k) {
  const o = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({ color: 0x3b2a5a, side: THREE.BackSide }));
  o.scale.setScalar(k);
  mesh.add(o);
  return mesh;
}
const charMat = (c, s = 20) => new THREE.MeshPhongMaterial({ color: c, shininess: s });

// かわいいキャラクターを作る（原点 = 球の中心。+z方向が顔の向き）
function createCharacter() {
  const BODY_R = 0.38;                 // 体の半径（小さくすると足が目立つ。元は0.5）
  const BODY_Y = 0.08;                 // 体の持ち上げ量（足の分だけ上げる）
  const k = BODY_R / R;                // 顔パーツを体の大きさに合わせる倍率
  const pos = (x, y, z) => [x * k, y * k + BODY_Y, z * k];   // 体の縮小に合わせた位置に変換

  const g = new THREE.Group();        // 位置・向きを動かす親
  const model = new THREE.Group();    // 伸び縮み用の子
  g.add(model);

  // ボディ（まんまる）
  const body = addHull(new THREE.Mesh(new THREE.SphereGeometry(BODY_R, 32, 24), charMat(0xffa6d5, 40)), 1.07);
  body.position.y = BODY_Y;
  model.add(body);

  // 目（黒目＋白いハイライト）。まばたき用にグループ化
  const eyes = [-1, 1].map(s => {
    const e = new THREE.Group();
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.085 * k, 12, 10), new THREE.MeshBasicMaterial({ color: 0x3b2a5a }));
    pupil.scale.z = 0.6;
    const shine = new THREE.Mesh(new THREE.SphereGeometry(0.03 * k, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    shine.position.set(0.03 * k, 0.035 * k, 0.05 * k);
    e.add(pupil, shine);
    e.position.set(...pos(s * 0.18, 0.1, 0.45));
    model.add(e);
    return e;
  });

  // ほっぺ
  [-1, 1].forEach(s => {
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.07 * k, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff6f91 }));
    c.scale.set(1, 0.6, 0.4);
    c.position.set(...pos(s * 0.3, -0.06, 0.39));
    model.add(c);
  });

  // 口（にっこり）
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.05 * k, 0.014 * k, 6, 12, Math.PI), new THREE.MeshBasicMaterial({ color: 0x3b2a5a }));
  mouth.rotation.z = Math.PI;
  mouth.position.set(...pos(0, -0.02, 0.49));
  model.add(mouth);

  // ネコ耳
  const ears = [-1, 1].map(s => {
    const ear = addHull(new THREE.Mesh(new THREE.ConeGeometry(0.14 * k, 0.3 * k, 12), charMat(0xff8ec8)), 1.15);
    ear.position.set(...pos(s * 0.25, 0.5, 0));
    ear.rotation.z = -s * 0.35;
    ear.userData.baseZ = ear.rotation.z;
    model.add(ear);
    return ear;
  });

  // 足（体より少し大きめにして、歩くときに前後に動かす）
  const feet = [-1, 1].map(s => {
    const f = addHull(new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), charMat(0xffb347)), 1.18);
    f.scale.set(1, 0.7, 1.3);
    f.position.set(s * 0.17, -0.4, 0.06);
    model.add(f);
    return f;
  });

  g.userData = { model, eyes, ears, feet };
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

// 足場を1つ追加（角丸ブロック）
function addPlatform(x, y, z, w) {
  const p = roundOutlined(
    roundedPlatformGeo(w, 1, 0.6),                   // 幅w・高さ1・角の丸み0.6
    new THREE.MeshPhongMaterial({ color: COLORS[count % COLORS.length], shininess: 25 }),
    w, 1);
  p.position.set(x, y - 0.5, z);                     // 上面がyになるよう配置
  scene.add(p);
  const pl = { mesh: p, x, y, z, w, landed: false };
  plats.push(pl);
  return pl;
}

// 次の足場とコインを生成（上に行くほど小さく・高低差と隙間が大きくなる）
function spawn() {
  const d = Math.min(count / 40, 1);                    // 難易度 0〜1
  const w = 4 - d * 1.6 + Math.random() * 0.4;          // 幅は4→約2.4へ
  const gap = 1.0 + d * 0.9 + Math.random() * 0.3;      // 足場の「端どうし」の隙間（最小1.0で必ず離れる）
  const dy = 0.4 + d * 0.5 + Math.random() * 0.3;       // 高低差（最大約1.2。ジャンプ可能範囲内）
  const MIN_GAP = 0.9;                                  // どの足場とも最低これだけ離す

  let nx, nz;
  for (let tries = 0; tries < 30; tries++) {
    // 進行方向をランダムに決める（基本は奥方向）
    let ang = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
    if (last.x > 7) ang = Math.PI * (0.6 + Math.random() * 0.3);   // 右に寄りすぎたら左へ
    if (last.x < -7) ang = -Math.PI * (0.1 + Math.random() * 0.3); // 左に寄りすぎたら右へ
    const c = Math.cos(ang), s = Math.sin(ang);
    // 四角い足場の端どうしの隙間が gap になるように、中心間の距離を逆算する
    const dist = ((w + last.w) / 2 + gap) / Math.max(Math.abs(c), Math.abs(s));
    nx = last.x + c * dist;
    nz = last.z + s * dist;

    // 近くの高さにある既存の足場と重ならないか確認
    const ok = plats.every(p =>
      Math.abs(p.y - (last.y + dy)) > 4 ||
      Math.max(Math.abs(nx - p.x), Math.abs(nz - p.z)) - (w + p.w) / 2 >= MIN_GAP);
    if (ok) break;   // 重ならない位置が見つかったら採用
  }

  count++;
  last = addPlatform(nx, last.y + dy, nz, w);
  if (Math.random() < 0.35) {                           // 一定確率でコイン配置
    const c = outlined(new THREE.OctahedronGeometry(0.4), new THREE.MeshBasicMaterial({ color: 0xffe14d }));
    c.position.set(last.x, last.y + 1.3, last.z);
    scene.add(c);
    coinsArr.push(c);
  }
}

// キラキラのパーティクルを放出
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
  [...plats.map(p => p.mesh), ...coinsArr, ...parts.map(p => p.m)].forEach(o => scene.remove(o));
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
const cv = renderer.domElement;
cv.addEventListener('pointerdown', e => {
  if (touch) { jump(); return; }              // すでに1本の指で移動中 → 2本目の指のタップはジャンプ
  cv.setPointerCapture(e.pointerId);          // 指がボタン上に出ても移動操作を続ける
  touch = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
});
cv.addEventListener('pointermove', e => {
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
cv.addEventListener('pointerup', endTouch);
cv.addEventListener('pointercancel', endTouch);

// JUMPボタン: 押した瞬間にジャンプ
$('jumpBtn').addEventListener('pointerdown', e => { e.preventDefault(); jump(); });


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
  plats = plats.filter(p => { if (p.y < ball.position.y - 30) { scene.remove(p.mesh); return false; } return true; });

  // --- 直前に乗った高さより大きく落ちたらゲームオーバー ---
  if (ball.position.y < bestPlat - 9) gameOver();

  $('score').textContent = Math.floor(maxH * 10) + coinScore;
  $('best').textContent = best;
  $('coins').textContent = coinCount;
}

// ===== メインループ（毎フレーム）=====
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

  renderer.render(scene, camera);
}

resetWorld();   // スタート画面の背景用に初期ワールドを作る
loop();