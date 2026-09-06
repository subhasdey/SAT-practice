// SAT Prep — app logic (vanilla JS, no build step)

const STORAGE_KEY = 'satPrepStats_v1';
const LETTERS = ['A', 'B', 'C', 'D'];

const state = {
  screen: 'home', // home | setup | session | result
  setup: { subject: 'mixed', difficulty: 'mixed', count: 10 },
  session: null, // { questions, index, correctCount, startTime, timerHandle, elapsed, sessionTopics }
};

// ---------- Stats persistence ----------

function loadStats() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* corrupted storage, fall through to defaults */ }
  return {
    totals: { attempted: 0, correct: 0 },
    bySubject: {},
    byDifficulty: {},
    byTopic: {},
    sessions: [],
  };
}

function saveStats(stats) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(stats)); } catch (e) { /* storage unavailable */ }
}

function bump(bucket, key, correct) {
  if (!bucket[key]) bucket[key] = { attempted: 0, correct: 0 };
  bucket[key].attempted += 1;
  if (correct) bucket[key].correct += 1;
}

function recordAnswer(stats, q, correct) {
  stats.totals.attempted += 1;
  if (correct) stats.totals.correct += 1;
  bump(stats.bySubject, q.subject, correct);
  bump(stats.byDifficulty, q.difficulty, correct);
  bump(stats.byTopic, q.topic, correct);
}

function pct(bucket) {
  if (!bucket || bucket.attempted === 0) return null;
  return Math.round((bucket.correct / bucket.attempted) * 100);
}

// ---------- Question selection ----------

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickQuestions(subject, difficulty, count) {
  const pool = QUESTIONS.filter(q =>
    (subject === 'mixed' || q.subject === subject) &&
    (difficulty === 'mixed' || q.difficulty === difficulty)
  );
  const shuffled = shuffle(pool);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

// ---------- Rendering ----------

const root = document.getElementById('app');

function render() {
  if (state.screen === 'home') return renderHome();
  if (state.screen === 'setup') return renderSetup();
  if (state.screen === 'session') return renderSession();
  if (state.screen === 'result') return renderResult();
  if (state.screen === 'examIntro') return renderExamIntro();
  if (state.screen === 'examSection') return renderExamSection();
  if (state.screen === 'examSectionBreak') return renderExamSectionBreak();
  if (state.screen === 'examResult') return renderExamResult();
}

function topbar(title) {
  return `<div class="topbar"><div class="brand">${title}</div></div>`;
}

function renderHome() {
  const stats = loadStats();
  const overall = pct(stats.totals);
  const mathPct = pct(stats.bySubject.math);
  const engPct = pct(stats.bySubject.english);

  const weakTopics = Object.entries(stats.byTopic)
    .filter(([, v]) => v.attempted >= 3)
    .map(([topic, v]) => ({ topic, pct: pct(v) }))
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 3);

  root.innerHTML = `
    ${topbar('SAT Prep')}
    <div class="card">
      <div class="section-label">Overall accuracy</div>
      <div class="big-score">${overall === null ? '—' : overall + '%'}</div>
      <div class="stat-row">
        <span class="stat-label">Questions practiced</span>
        <span class="stat-value">${stats.totals.attempted}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Math accuracy</span>
        <span class="stat-value">${mathPct === null ? '—' : mathPct + '%'}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">English accuracy</span>
        <span class="stat-value">${engPct === null ? '—' : engPct + '%'}</span>
      </div>
    </div>
    ${weakTopics.length ? `
    <div class="card">
      <div class="section-label">Focus areas</div>
      ${weakTopics.map(t => `
        <div class="weak-topic">
          <span>${t.topic}</span>
          <span>${t.pct}%</span>
        </div>
      `).join('')}
    </div>` : ''}
    <button class="btn" id="start-btn">Start Practice</button>
    <button class="btn secondary" id="exam-btn">Timed Math Test (Official Format)</button>
    <div class="footer-note">SAT Prep · practice anywhere, even offline</div>
  `;
  document.getElementById('start-btn').onclick = () => {
    state.screen = 'setup';
    render();
  };
  document.getElementById('exam-btn').onclick = () => {
    state.screen = 'examIntro';
    render();
  };
}

function renderSetup() {
  const { subject, difficulty, count } = state.setup;
  const available = QUESTIONS.filter(q =>
    (subject === 'mixed' || q.subject === subject) &&
    (difficulty === 'mixed' || q.difficulty === difficulty)
  ).length;

  root.innerHTML = `
    ${topbar('Set Up Practice')}
    <div class="section-label">Subject</div>
    <div class="pill-group" id="subject-pills">
      ${['mixed', 'math', 'english'].map(s => `
        <div class="pill ${subject === s ? 'active' : ''}" data-value="${s}">
          ${s === 'mixed' ? 'Mixed' : s === 'math' ? 'Math' : 'English'}
        </div>`).join('')}
    </div>
    <div class="section-label">Difficulty</div>
    <div class="pill-group" id="difficulty-pills">
      ${['mixed', 'easy', 'medium', 'hard'].map(d => `
        <div class="pill ${difficulty === d ? 'active' : ''}" data-value="${d}">
          ${d === 'mixed' ? 'Mixed' : d[0].toUpperCase() + d.slice(1)}
        </div>`).join('')}
    </div>
    <div class="section-label">Number of questions</div>
    <div class="pill-group" id="count-pills">
      ${[5, 10, 15, 20].map(c => `
        <div class="pill ${count === c ? 'active' : ''}" data-value="${c}">${c}</div>`).join('')}
    </div>
    <div class="card">
      <div class="stat-row">
        <span class="stat-label">Questions available</span>
        <span class="stat-value">${available}</span>
      </div>
    </div>
    <button class="btn" id="begin-btn" ${available === 0 ? 'disabled' : ''}>Begin</button>
    <button class="btn ghost" id="back-btn">Back</button>
  `;

  document.getElementById('subject-pills').onclick = e => {
    const el = e.target.closest('.pill');
    if (!el) return;
    state.setup.subject = el.dataset.value;
    render();
  };
  document.getElementById('difficulty-pills').onclick = e => {
    const el = e.target.closest('.pill');
    if (!el) return;
    state.setup.difficulty = el.dataset.value;
    render();
  };
  document.getElementById('count-pills').onclick = e => {
    const el = e.target.closest('.pill');
    if (!el) return;
    state.setup.count = Number(el.dataset.value);
    render();
  };
  document.getElementById('begin-btn').onclick = () => startSession();
  document.getElementById('back-btn').onclick = () => { state.screen = 'home'; render(); };
}

function startSession() {
  const { subject, difficulty, count } = state.setup;
  const questions = pickQuestions(subject, difficulty, count);
  state.session = {
    questions,
    index: 0,
    correctCount: 0,
    startTime: Date.now(),
    elapsed: 0,
    answered: false,
    selectedIndex: null,
    topicTally: {}, // per-session breakdown
  };
  state.screen = 'session';
  render();
  startTimer();
}

function startTimer() {
  stopTimer();
  state.session.timerHandle = setInterval(() => {
    const el = document.getElementById('session-timer');
    if (!el || !state.session) return;
    state.session.elapsed = Math.floor((Date.now() - state.session.startTime) / 1000);
    el.textContent = formatTime(state.session.elapsed);
  }, 1000);
}

function stopTimer() {
  if (state.session && state.session.timerHandle) {
    clearInterval(state.session.timerHandle);
    state.session.timerHandle = null;
  }
}

function formatTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function renderSession() {
  const s = state.session;
  const q = s.questions[s.index];
  const total = s.questions.length;

  root.innerHTML = `
    ${topbar('SAT Prep')}
    <div class="qmeta">
      <span>Question ${s.index + 1} of ${total}</span>
      <span id="session-timer">${formatTime(s.elapsed)}</span>
    </div>
    <div class="progress-bar"><div style="width:${((s.index) / total) * 100}%"></div></div>
    <div class="card" style="margin-top:16px;">
      <span class="qtopic">${q.topic}</span>
      <div class="qtext" style="margin-top:12px;">${q.question}</div>
      <div id="choices">
        ${q.choices.map((choice, i) => `
          <button class="choice" data-index="${i}">
            <span class="letter">${LETTERS[i]}</span>
            <span>${choice}</span>
          </button>
        `).join('')}
      </div>
      <div id="explanation-slot"></div>
    </div>
    <button class="btn" id="next-btn" style="display:none;">
      ${s.index + 1 === total ? 'See Results' : 'Next Question'}
    </button>
    <button class="btn ghost" id="quit-btn">End Session</button>
  `;

  document.getElementById('choices').onclick = e => {
    const btn = e.target.closest('.choice');
    if (!btn || s.answered) return;
    answerQuestion(Number(btn.dataset.index));
  };
  document.getElementById('next-btn').onclick = () => nextQuestion();
  document.getElementById('quit-btn').onclick = () => endSession();
}

function answerQuestion(selectedIndex) {
  const s = state.session;
  const q = s.questions[s.index];
  const correct = selectedIndex === q.answer;
  s.answered = true;
  s.selectedIndex = selectedIndex;
  if (correct) s.correctCount += 1;

  bump(s.topicTally, q.topic, correct);

  const stats = loadStats();
  recordAnswer(stats, q, correct);
  saveStats(stats);

  const buttons = document.querySelectorAll('#choices .choice');
  buttons.forEach((btn, i) => {
    btn.setAttribute('disabled', 'true');
    if (i === q.answer) btn.classList.add('correct');
    else if (i === selectedIndex) btn.classList.add('wrong');
  });

  document.getElementById('explanation-slot').innerHTML = `
    <div class="explanation">
      <span class="label">${correct ? 'Correct!' : 'Explanation'}</span>
      ${q.explanation}
    </div>
  `;
  document.getElementById('next-btn').style.display = 'block';
}

function nextQuestion() {
  const s = state.session;
  if (s.index + 1 >= s.questions.length) {
    endSession();
    return;
  }
  s.index += 1;
  s.answered = false;
  s.selectedIndex = null;
  render();
}

function endSession() {
  stopTimer();
  const s = state.session;
  const stats = loadStats();
  stats.sessions.unshift({
    date: new Date().toISOString(),
    subject: state.setup.subject,
    difficulty: state.setup.difficulty,
    attempted: s.index + (s.answered ? 1 : 0),
    correct: s.correctCount,
    seconds: s.elapsed,
  });
  stats.sessions = stats.sessions.slice(0, 20);
  saveStats(stats);

  state.screen = 'result';
  render();
}

function renderResult() {
  const s = state.session;
  const total = s.index + (s.answered ? 1 : 0);
  const accuracy = total === 0 ? 0 : Math.round((s.correctCount / total) * 100);

  const topicRows = Object.entries(s.topicTally)
    .map(([topic, v]) => `<tr><td>${topic}</td><td>${v.correct}/${v.attempted}</td></tr>`)
    .join('');

  root.innerHTML = `
    ${topbar('Session Complete')}
    <div class="card centered">
      <div class="section-label">Score</div>
      <div class="big-score">${s.correctCount} / ${total}</div>
      <div class="stat-row" style="justify-content:center; gap:24px;">
        <span class="stat-label">Accuracy: <b>${accuracy}%</b></span>
        <span class="stat-label">Time: <b>${formatTime(s.elapsed)}</b></span>
      </div>
    </div>
    ${topicRows ? `
    <div class="card">
      <div class="section-label">Breakdown by topic</div>
      <table class="breakdown">
        <thead><tr><th>Topic</th><th>Score</th></tr></thead>
        <tbody>${topicRows}</tbody>
      </table>
    </div>` : ''}
    <button class="btn" id="again-btn">Practice Again</button>
    <button class="btn secondary" id="home-btn">Back to Home</button>
  `;

  document.getElementById('again-btn').onclick = () => startSession();
  document.getElementById('home-btn').onclick = () => { state.screen = 'home'; render(); };
}

// ---------- Timed exam mode (official SAT Math format) ----------

const EXAM_FORMAT = [
  { name: 'No Calculator', calcAllowed: false, count: 20, timeLimit: 25 * 60 },
  { name: 'Calculator', calcAllowed: true, count: 38, timeLimit: 55 * 60 },
];

function pickForExam(pool, count) {
  if (pool.length === 0) return [];
  let result = [];
  while (result.length < count) {
    result = result.concat(shuffle(pool));
  }
  return result.slice(0, count);
}

function examPools() {
  const noCalc = QUESTIONS.filter(q => q.subject === 'math' && q.noCalcEligible);
  const calc = QUESTIONS.filter(q => q.subject === 'math');
  return { noCalc, calc };
}

function renderExamIntro() {
  const { noCalc, calc } = examPools();
  root.innerHTML = `
    ${topbar('Timed Math Test')}
    <div class="card">
      <div class="section-label">Official SAT Math format</div>
      <p style="margin:0 0 14px; color:var(--muted); font-size:14px; line-height:1.5;">
        Two timed sections, back to back, no answer reveal until you finish — just like the real test.
      </p>
      <div class="stat-row">
        <span class="stat-label">Section 1 · No Calculator</span>
        <span class="stat-value">20 Q · 25 min</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Section 2 · Calculator</span>
        <span class="stat-value">38 Q · 55 min</span>
      </div>
    </div>
    ${(noCalc.length < 20 || calc.length < 38) ? `
    <div class="card">
      <div class="section-label">Note</div>
      <p style="margin:0; color:var(--muted); font-size:13px; line-height:1.5;">
        The question bank currently has ${noCalc.length} unique No-Calculator questions and ${calc.length} unique Calculator-section questions.
        Since the official section lengths are longer than that, some questions will repeat within a section to fill the full 20 / 38 count.
      </p>
    </div>` : ''}
    <button class="btn" id="exam-begin-btn">Begin Section 1</button>
    <button class="btn ghost" id="exam-back-btn">Back</button>
  `;
  document.getElementById('exam-begin-btn').onclick = () => startExam();
  document.getElementById('exam-back-btn').onclick = () => { state.screen = 'home'; render(); };
}

function startExam() {
  const { noCalc, calc } = examPools();
  const sections = [
    { ...EXAM_FORMAT[0], questions: pickForExam(noCalc, EXAM_FORMAT[0].count) },
    { ...EXAM_FORMAT[1], questions: pickForExam(calc, EXAM_FORMAT[1].count) },
  ];
  state.exam = {
    sections,
    sectionIndex: 0,
    answers: sections.map(sec => new Array(sec.questions.length).fill(null)),
    index: 0,
    secondsLeft: sections[0].timeLimit,
    timerHandle: null,
  };
  state.screen = 'examSection';
  render();
  startExamTimer();
}

function startExamTimer() {
  stopExamTimer();
  state.exam.timerHandle = setInterval(() => {
    state.exam.secondsLeft -= 1;
    const el = document.getElementById('exam-timer');
    if (el) {
      el.textContent = formatTime(Math.max(0, state.exam.secondsLeft));
      el.classList.toggle('timer-warn', state.exam.secondsLeft <= 60);
    }
    if (state.exam.secondsLeft <= 0) {
      finishExamSection();
    }
  }, 1000);
}

function stopExamTimer() {
  if (state.exam && state.exam.timerHandle) {
    clearInterval(state.exam.timerHandle);
    state.exam.timerHandle = null;
  }
}

function renderExamSection() {
  const exam = state.exam;
  const section = exam.sections[exam.sectionIndex];
  const q = section.questions[exam.index];
  const selected = exam.answers[exam.sectionIndex][exam.index];
  const total = section.questions.length;

  root.innerHTML = `
    ${topbar('Timed Math Test')}
    <div class="exam-header">
      <span class="section-name">Section ${exam.sectionIndex + 1}: ${section.name}</span>
      <span class="timer" id="exam-timer">${formatTime(exam.secondsLeft)}</span>
    </div>
    <div class="qmeta">
      <span>Question ${exam.index + 1} of ${total}</span>
      <span>${section.calcAllowed ? 'Calculator allowed' : 'No calculator'}</span>
    </div>
    <div class="progress-bar"><div style="width:${(exam.index / total) * 100}%"></div></div>
    <div class="card" style="margin-top:16px;">
      <span class="qtopic">${q.topic}</span>
      <div class="qtext" style="margin-top:12px;">${q.question}</div>
      <div id="choices">
        ${q.choices.map((choice, i) => `
          <button class="choice ${selected === i ? 'selected' : ''}" data-index="${i}">
            <span class="letter">${LETTERS[i]}</span>
            <span>${choice}</span>
          </button>
        `).join('')}
      </div>
    </div>
    <div class="nav-row">
      <button class="btn ghost" id="exam-back-q" ${exam.index === 0 ? 'disabled' : ''} style="flex:1;">Back</button>
      <button class="btn" id="exam-next-q" style="flex:2;">
        ${exam.index + 1 === total ? (exam.sectionIndex + 1 === exam.sections.length ? 'Finish Test' : 'Finish Section') : 'Next Question'}
      </button>
    </div>
    <button class="btn ghost" id="exam-end-btn">End Test Now</button>
  `;

  document.getElementById('choices').onclick = e => {
    const btn = e.target.closest('.choice');
    if (!btn) return;
    exam.answers[exam.sectionIndex][exam.index] = Number(btn.dataset.index);
    render();
  };
  document.getElementById('exam-back-q').onclick = () => {
    if (exam.index > 0) { exam.index -= 1; render(); }
  };
  document.getElementById('exam-next-q').onclick = () => {
    if (exam.index + 1 < total) { exam.index += 1; render(); }
    else { finishExamSection(); }
  };
  document.getElementById('exam-end-btn').onclick = () => finishExam();
}

function finishExamSection() {
  stopExamTimer();
  const exam = state.exam;
  if (exam.sectionIndex + 1 < exam.sections.length) {
    exam.sectionIndex += 1;
    exam.index = 0;
    exam.secondsLeft = exam.sections[exam.sectionIndex].timeLimit;
    state.screen = 'examSectionBreak';
    render();
  } else {
    finishExam();
  }
}

function renderExamSectionBreak() {
  const exam = state.exam;
  const next = exam.sections[exam.sectionIndex];
  root.innerHTML = `
    ${topbar('Section Complete')}
    <div class="card centered">
      <div class="section-label">Up next</div>
      <h2>Section ${exam.sectionIndex + 1}: ${next.name}</h2>
      <p style="color:var(--muted); font-size:14px;">${next.questions.length} questions · ${Math.round(next.timeLimit / 60)} minutes</p>
    </div>
    <button class="btn" id="exam-continue-btn">Begin Section ${exam.sectionIndex + 1}</button>
  `;
  document.getElementById('exam-continue-btn').onclick = () => {
    state.screen = 'examSection';
    render();
    startExamTimer();
  };
}

function finishExam() {
  stopExamTimer();
  const exam = state.exam;

  const stats = loadStats();
  let totalCorrect = 0, totalAttempted = 0;
  const sectionsSummary = exam.sections.map((sec, si) => {
    let correct = 0, attempted = 0;
    sec.questions.forEach((q, qi) => {
      const sel = exam.answers[si][qi];
      if (sel !== null) {
        attempted += 1;
        const isCorrect = sel === q.answer;
        if (isCorrect) correct += 1;
        recordAnswer(stats, q, isCorrect);
      }
    });
    totalCorrect += correct;
    totalAttempted += attempted;
    return { name: sec.name, correct, attempted, total: sec.questions.length };
  });

  stats.sessions.unshift({
    date: new Date().toISOString(),
    subject: 'math',
    difficulty: 'exam',
    attempted: totalAttempted,
    correct: totalCorrect,
    seconds: null,
  });
  stats.sessions = stats.sessions.slice(0, 20);
  saveStats(stats);

  exam.summary = { sectionsSummary, totalCorrect, totalQuestions: exam.sections.reduce((a, s) => a + s.questions.length, 0) };
  state.screen = 'examResult';
  render();
}

function renderExamResult() {
  const exam = state.exam;
  const { sectionsSummary, totalCorrect, totalQuestions } = exam.summary;

  const reviewHtml = exam.sections.map((sec, si) => `
    <div class="section-label" style="margin-top:16px;">Section ${si + 1}: ${sec.name}</div>
    ${sec.questions.map((q, qi) => {
      const sel = exam.answers[si][qi];
      const answered = sel !== null;
      const correct = answered && sel === q.answer;
      return `
        <div class="review-item">
          <div class="rmeta">
            <span class="${answered ? (correct ? 'ok' : 'no') : 'no'}">
              ${answered ? (correct ? 'Correct' : 'Incorrect') : 'Not answered'}
            </span>
            <span class="qtopic">${q.topic}</span>
          </div>
          <div class="rq">${q.question}</div>
          <div style="font-size:14px; margin-bottom:6px;">
            ${answered ? `Your answer: <b>${LETTERS[sel]}. ${q.choices[sel]}</b><br/>` : ''}
            Correct answer: <b>${LETTERS[q.answer]}. ${q.choices[q.answer]}</b>
          </div>
          <div class="explanation">${q.explanation}</div>
        </div>
      `;
    }).join('')}
  `).join('');

  root.innerHTML = `
    ${topbar('Test Complete')}
    <div class="card centered">
      <div class="section-label">Overall Score</div>
      <div class="big-score">${totalCorrect} / ${totalQuestions}</div>
    </div>
    <div class="card">
      <div class="section-label">By section</div>
      <table class="breakdown">
        <thead><tr><th>Section</th><th>Score</th></tr></thead>
        <tbody>
          ${sectionsSummary.map(s => `<tr><td>${s.name}</td><td>${s.correct}/${s.total} (${s.attempted}/${s.total} answered)</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
    <button class="btn" id="exam-review-toggle">Show Full Answer Review</button>
    <div id="exam-review" style="display:none;"></div>
    <button class="btn secondary" id="exam-home-btn">Back to Home</button>
  `;

  document.getElementById('exam-review-toggle').onclick = e => {
    const box = document.getElementById('exam-review');
    const show = box.style.display === 'none';
    box.style.display = show ? 'block' : 'none';
    box.innerHTML = show ? reviewHtml : '';
    e.target.textContent = show ? 'Hide Full Answer Review' : 'Show Full Answer Review';
  };
  document.getElementById('exam-home-btn').onclick = () => { state.screen = 'home'; render(); };
}

// ---------- Boot ----------

render();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => { /* offline support best-effort */ });
  });
}
