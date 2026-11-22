// منطق اللعبة بدون أي واجهة. جهاز الحكم هو الوحيد اللي يشغله ويعرف الأجوبة.
const N = 6, MIN_QUESTIONS = 5, REPEAT_MIN = 50, MAX_PLAYERS = 60, ANSWER_MS = 5000, BAN_MS = 10000, MAX_BANS = 2;

function neighbors(i) {
  const r = Math.floor(i / N), c = i % N;
  const dirs = r % 2
    ? [[-1, 0], [-1, 1], [0, -1], [0, 1], [1, 0], [1, 1]]
    : [[-1, -1], [-1, 0], [0, -1], [0, 1], [1, -1], [1, 0]];
  return dirs.map(([dr, dc]) => [r + dr, c + dc])
    .filter(([y, x]) => y >= 0 && y < N && x >= 0 && x < N)
    .map(([y, x]) => y * N + x);
}

// الفريق 0 يوصل يمين بيسار، والفريق 1 يوصل فوق بتحت.
function findPath(owners, team) {
  const isStart = i => team === 0 ? i % N === 0 : i < N;
  const isEnd = i => team === 0 ? i % N === N - 1 : i >= N * (N - 1);
  const from = new Map(), queue = [];
  owners.forEach((o, i) => { if (o === team && isStart(i)) { from.set(i, -1); queue.push(i); } });
  while (queue.length) {
    const i = queue.shift();
    if (isEnd(i)) {
      const path = [];
      for (let p = i; p !== -1; p = from.get(p)) path.push(p);
      return path;
    }
    for (const n of neighbors(i)) if (owners[n] === team && !from.has(n)) { from.set(n, i); queue.push(n); }
  }
  return null;
}

function shuffled(list, rnd = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function newGame(names) {
  return { teams: names, rounds: [0, 0], players: {}, seen: [], phase: 'lobby', cells: [], cur: null, q: null, buzz: null, win: null, path: null, answerEnd: 0, banUntil: [0, 0], strikes: 0, fx: { n: 0, k: '' } };
}

// العداد يخلي كل شاشة تشغل الصوت مرة وحدة حتى لو وصلتها الحالة أكثر من مرة.
function fx(s, k) { s.fx = { n: s.fx.n + 1, k }; }

// التوقيف يخص السؤال الحالي، فأي سؤال جديد يبدأ والفريقين أحرار.
function clearBans(s) { s.answerEnd = 0; s.banUntil = [0, 0]; s.strikes = 0; }

function clearTurn(s) { s.cur = null; s.q = null; s.buzz = null; clearBans(s); }

// أول محاولتين فاشلتين في السؤال توقفان فريق اللي حاول، وبعدها الجرس حر للكل.
// وأي فريق يخلص محاولته ينفك التوقيف عن الفريق الثاني.
function failAttempt(s, now, sound) {
  const team = s.buzz.team;
  s.banUntil[1 - team] = 0;
  if (++s.strikes <= MAX_BANS) s.banUntil[team] = now + BAN_MS;
  s.buzz = null;
  s.answerEnd = 0;
  s.phase = 'open';
  fx(s, sound);
  return true;
}

function newRound(s, bank, rnd) {
  const letters = Object.keys(bank).filter(l => bank[l].length >= MIN_QUESTIONS);
  // الحروف 28 واللوحة 36 خانة، فالباقي يتكرر من الحروف اللي أسئلتها كثيرة
  const repeats = shuffled(letters.filter(l => bank[l].length >= REPEAT_MIN), rnd).slice(0, N * N - letters.length);
  s.cells = shuffled([...letters, ...repeats], rnd).map(l => ({ l, o: null }));
  clearTurn(s);
  s.win = null; s.path = null; s.phase = 'board';
}

function drawQuestion(s, bank, rnd = Math.random) {
  const all = bank[s.cells[s.cur].l];
  const fresh = all.filter(q => !s.seen.includes(q[0]));
  const pool = fresh.length ? fresh : all;
  const q = pool[Math.floor(rnd() * pool.length)];
  s.seen.push(q[0]);
  s.q = { q: q[0], a: q[1] };
}

function pick(s, i, bank, rnd) {
  if (s.phase !== 'board' || !s.cells[i] || s.cells[i].o !== null) return false;
  s.cur = i; s.buzz = null; s.phase = 'open';
  drawQuestion(s, bank, rnd);
  return true;
}

function swapQuestion(s, bank, rnd) {
  if (s.cur === null) return false;
  s.buzz = null; s.phase = 'open';
  clearBans(s);
  drawQuestion(s, bank, rnd);
  return true;
}

// ترتيب وصول الرسائل من الوسيط هو ترتيب الضغط، فأول رسالة تقفل الجرس.
function buzz(s, id, now = Date.now()) {
  if (s.phase !== 'open' || !Object.hasOwn(s.players, id)) return false;
  const p = s.players[id];
  if (now < s.banUntil[p.team]) return false;
  s.buzz = { id, name: p.name, team: p.team };
  s.answerEnd = now + ANSWER_MS;
  s.phase = 'buzzed';
  fx(s, 'buzz');
  return true;
}

function expire(s, now = Date.now()) {
  if (s.phase !== 'buzzed' || now < s.answerEnd) return false;
  return failAttempt(s, now, 'time');
}

function award(s, team) {
  if (s.cur === null || (team !== 0 && team !== 1)) return false;
  s.cells[s.cur].o = team;
  clearTurn(s);
  const path = findPath(s.cells.map(c => c.o), team);
  if (path) { s.win = team; s.path = path; s.rounds[team]++; s.phase = 'won'; fx(s, 'win'); }
  else { s.phase = 'board'; fx(s, 'ok'); }
  return true;
}

function judge(s, correct, now = Date.now()) {
  if (s.phase !== 'buzzed') return false;
  if (correct) return award(s, s.buzz.team);
  return failAttempt(s, now, 'no');
}

function backToBoard(s) {
  if (s.cur === null) return false;
  clearTurn(s);
  s.phase = 'board';
  return true;
}

function clearCell(s, i) {
  if (s.phase !== 'board' || !s.cells[i] || s.cells[i].o === null) return false;
  s.cells[i].o = null;
  return true;
}

// رسائل الانضمام تجي من وسيط عام، فكل حقل يتفحص هنا.
function join(s, m) {
  if (typeof m.id !== 'string' || !/^[a-z0-9]{8,32}$/.test(m.id) || typeof m.name !== 'string' || (m.team !== 0 && m.team !== 1)) return false;
  const name = m.name.trim().slice(0, 18);
  if (!name) return false;
  const old = Object.hasOwn(s.players, m.id) ? s.players[m.id] : null;
  if (old && old.name === name && old.team === m.team) return false;
  if (!old && Object.keys(s.players).length >= MAX_PLAYERS) return false;
  s.players[m.id] = { name, team: m.team };
  return true;
}

// اللي ينرسل للجوالات والتلفزيون. السؤال والجواب ما يطلعون من جهاز الحكم أبداً.
function publicView(s, now = Date.now()) {
  return {
    teams: s.teams, rounds: s.rounds, cells: s.cells, cur: s.cur, phase: s.phase,
    buzz: s.buzz, win: s.win, path: s.path,
    // المتبقي مو وقت النهاية، لأن ساعات الأجهزة تختلف عن بعض
    answerLeft: s.phase === 'buzzed' ? Math.max(0, s.answerEnd - now) : 0,
    banLeft: s.banUntil.map(t => Math.max(0, t - now)),
    fx: s.fx,
    // shortcut: ids are visible so a player could spoof a buzz, add per-player secrets if strangers ever play
    players: Object.entries(s.players).map(([id, p]) => ({ id, name: p.name, team: p.team })),
  };
}

if (typeof module !== 'undefined') module.exports = { N, neighbors, findPath, shuffled, newGame, newRound, pick, swapQuestion, buzz, expire, award, judge, backToBoard, clearCell, join, publicView };
