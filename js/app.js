// SAT Prep — app logic (vanilla JS, no build step)

const STATS_ID = 'stats';
const LEGACY_STORAGE_KEY = 'satPrepStats_v1';
const LETTERS = ['A', 'B', 'C', 'D'];

const state = {
  screen: 'home', // home | setup | session | result
  setup: { subject: 'mixed', difficulty: 'mixed', count: 10 },
  session: null, // { questions, index, correctCount, startTime, timerHandle, elapsed, sessionTopics }
};

// ---------- Stats persistence ----------

function defaultStats() {
  return {
    totals: { attempted: 0, correct: 0 },
    bySubject: {},
    byDifficulty: {},
    byTopic: {},
    sessions: [],
  };
}

let statsCache = null;

async function initStats() {
  let stored = await getRecord(STATS_ID);
  if (!stored) {
    try {
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy) {
        stored = JSON.parse(legacy);
        await putRecord(STATS_ID, stored);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      }
    } catch (e) { /* ignore corrupt legacy data */ }
  }
  statsCache = stored || defaultStats();
}

function loadStats() {
  return statsCache || defaultStats();
}

function saveStats(stats) {
  statsCache = stats;
  putRecord(STATS_ID, stats).catch(() => { /* best-effort persistence */ });
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

// Rough, original approximation for motivational tracking only — not derived from
// or claiming to match any official scoring table. Curves the top of the range
// slightly so accuracy gains near 100% still read as meaningful score gains.
function estimateScaledScore(accuracyFraction) {
  const clamped = Math.min(1, Math.max(0, accuracyFraction));
  const scaled = 200 + 600 * Math.pow(clamped, 0.8);
  return Math.round(scaled / 10) * 10;
}

function computeInsights(stats) {
  const insights = [];
  const mathAcc = pct(stats.bySubject.math);
  const engAcc = pct(stats.bySubject.english);
  const mathN = stats.bySubject.math ? stats.bySubject.math.attempted : 0;
  const engN = stats.bySubject.english ? stats.bySubject.english.attempted : 0;

  if (mathAcc !== null && engAcc !== null && mathN >= 5 && engN >= 5) {
    if (engAcc - mathAcc >= 10) {
      insights.push({ type: 'focus', text: `Math accuracy (${mathAcc}%) is trailing English (${engAcc}%) — weight your next few sessions toward Math.` });
    } else if (mathAcc - engAcc >= 10) {
      insights.push({ type: 'focus', text: `English accuracy (${engAcc}%) is trailing Math (${mathAcc}%) — weight your next few sessions toward English.` });
    }
  }

  const easy = stats.byDifficulty.easy, hard = stats.byDifficulty.hard;
  const easyAcc = pct(easy), hardAcc = pct(hard);
  if (easyAcc !== null && easy.attempted >= 5 && easyAcc < 80) {
    insights.push({ type: 'focus', text: `Easy-tier accuracy is ${easyAcc}% — shore up fundamentals before pushing further into Medium/Hard questions.` });
  } else if (easyAcc !== null && hardAcc !== null && hard.attempted >= 5 && easyAcc - hardAcc >= 25) {
    insights.push({ type: 'focus', text: `Hard-tier accuracy (${hardAcc}%) lags well behind Easy (${easyAcc}%) — expected, but multi-step problem practice will close that gap fastest.` });
  }

  const topicEntries = Object.entries(stats.byTopic)
    .filter(([, v]) => v.attempted >= 3)
    .map(([topic, v]) => ({ topic, pct: pct(v), attempted: v.attempted }));
  topicEntries.slice().sort((a, b) => a.pct - b.pct).slice(0, 2).forEach(t => {
    if (t.pct < 70) insights.push({ type: 'focus', text: `${t.topic}: ${t.pct}% correct over ${t.attempted} questions — a clear priority topic.` });
  });
  const best = topicEntries.slice().sort((a, b) => b.pct - a.pct)[0];
  if (best && best.pct === 100 && best.attempted >= 3) {
    insights.push({ type: 'strength', text: `${best.topic}: perfect record over ${best.attempted} questions — a real strength, no need to over-practice here.` });
  }

  const lastExam = stats.sessions.find(s => s.difficulty === 'exam');
  if (lastExam) {
    const unanswered = 58 - lastExam.attempted;
    if (unanswered >= 5) {
      insights.push({ type: 'pacing', text: `Your last timed test left ${unanswered} questions unanswered — pacing is the priority: practice moving on from stuck questions faster.` });
    }
  }

  if (insights.length === 0) {
    insights.push({ type: 'info', text: 'Keep practicing — insights appear here once you have at least 5 answered questions in an area.' });
  }
  return insights;
}

function examInsights(sectionsSummary) {
  const insights = [];
  const [noCalc, calc] = sectionsSummary;
  const noCalcUnanswered = noCalc.total - noCalc.attempted;
  const calcUnanswered = calc.total - calc.attempted;

  if (noCalcUnanswered >= 3) {
    insights.push({ type: 'pacing', text: `You left ${noCalcUnanswered} No-Calculator questions unanswered — at 75 seconds/question on average, practice recognizing when to guess and move on.` });
  }
  if (calcUnanswered >= 5) {
    insights.push({ type: 'pacing', text: `You left ${calcUnanswered} Calculator-section questions unanswered — that section allows more time per question (~87 sec), so pacing there should improve fastest with practice.` });
  }

  const noCalcAcc = noCalc.attempted ? Math.round((noCalc.correct / noCalc.attempted) * 100) : null;
  const calcAcc = calc.attempted ? Math.round((calc.correct / calc.attempted) * 100) : null;
  if (noCalcAcc !== null && calcAcc !== null) {
    if (calcAcc - noCalcAcc >= 15) {
      insights.push({ type: 'focus', text: `No-Calculator accuracy (${noCalcAcc}%) is noticeably behind Calculator accuracy (${calcAcc}%) — build more comfort doing algebra by hand.` });
    } else if (noCalcAcc - calcAcc >= 15) {
      insights.push({ type: 'focus', text: `Calculator-section accuracy (${calcAcc}%) is behind No-Calculator (${noCalcAcc}%) — this often means rushing; slow down and double-check entries.` });
    }
  }

  if (insights.length === 0) {
    insights.push({ type: 'info', text: 'Balanced performance across both sections — keep practicing at this pace and volume to build consistency.' });
  }
  return insights;
}

function renderInsights(insights) {
  return insights.map(i => `
    <div class="insight"><span class="ilabel ${i.type}">${i.type}</span>${i.text}</div>
  `).join('');
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
  const mathN = stats.bySubject.math ? stats.bySubject.math.attempted : 0;
  const engN = stats.bySubject.english ? stats.bySubject.english.attempted : 0;

  const mathScaled = (mathPct !== null && mathN >= 5) ? estimateScaledScore(mathPct / 100) : null;
  const engScaled = (engPct !== null && engN >= 5) ? estimateScaledScore(engPct / 100) : null;
  const composite = (mathScaled !== null && engScaled !== null) ? mathScaled + engScaled : null;

  const weakTopics = Object.entries(stats.byTopic)
    .filter(([, v]) => v.attempted >= 3)
    .map(([topic, v]) => ({ topic, pct: pct(v) }))
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 3);

  const insights = computeInsights(stats);

  root.innerHTML = `
    ${topbar('SAT Prep')}
    ${resumableExam ? `
    <div class="card">
      <div class="section-label">Resume Timed Test</div>
      <p style="margin:0 0 12px; font-size:14px; color:var(--muted);">
        Section ${resumableExam.sectionIndex + 1}: ${resumableExam.sections[resumableExam.sectionIndex].name} — Question ${resumableExam.index + 1} of ${resumableExam.sections[resumableExam.sectionIndex].questions.length}
      </p>
      <button class="btn" id="resume-exam-btn">Resume${resumableExam.sectionEndAt ? ` · ${formatTime(Math.max(0, Math.round((resumableExam.sectionEndAt - Date.now()) / 1000)))} left` : ''}</button>
    </div>` : ''}
    ${resumablePractice ? `
    <div class="card">
      <div class="section-label">Resume Practice</div>
      <p style="margin:0 0 12px; font-size:14px; color:var(--muted);">
        Question ${resumablePractice.index + 1} of ${resumablePractice.questions.length}
      </p>
      <button class="btn" id="resume-practice-btn">Resume Practice</button>
    </div>` : ''}
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
    <div class="card">
      <div class="section-label">Estimated SAT Score</div>
      <div class="big-score">${composite !== null ? composite : '—'} <span style="font-size:14px; color:var(--muted); font-weight:600;">/ 1600</span></div>
      <div class="stat-row">
        <span class="stat-label">Math</span>
        <span class="stat-value">${mathScaled !== null ? mathScaled : '—'} / 800</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">English</span>
        <span class="stat-value">${engScaled !== null ? engScaled : '—'} / 800</span>
      </div>
      <p class="score-disclaimer">Rough estimate from your practice accuracy, for motivation and tracking only — not an official score predictor. Needs at least 5 answered questions per subject.</p>
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
    <div class="card">
      <div class="section-label">Key Insights</div>
      ${renderInsights(insights)}
    </div>
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
  const resumeExamBtn = document.getElementById('resume-exam-btn');
  if (resumeExamBtn) resumeExamBtn.onclick = () => resumeExam();
  const resumePracticeBtn = document.getElementById('resume-practice-btn');
  if (resumePracticeBtn) resumePracticeBtn.onclick = () => resumePractice();
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
  resumablePractice = null;
  state.screen = 'session';
  render();
  startTimer();
  persistPracticeProgress();
}

function persistPracticeProgress() {
  if (!state.session) return;
  const snapshot = {
    questions: state.session.questions,
    index: state.session.index,
    correctCount: state.session.correctCount,
    answered: state.session.answered,
    selectedIndex: state.session.selectedIndex,
    topicTally: state.session.topicTally,
    startTime: state.session.startTime,
  };
  putRecord('practiceProgress', snapshot).catch(() => { /* best-effort */ });
}

function clearPracticeProgress() {
  resumablePractice = null;
  deleteRecord('practiceProgress').catch(() => { /* best-effort */ });
}

function resumePractice() {
  const saved = resumablePractice;
  resumablePractice = null;
  state.session = {
    questions: saved.questions,
    index: saved.index,
    correctCount: saved.correctCount,
    startTime: saved.startTime,
    elapsed: Math.floor((Date.now() - saved.startTime) / 1000),
    answered: saved.answered,
    selectedIndex: saved.selectedIndex,
    topicTally: saved.topicTally,
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
  persistPracticeProgress();
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
  persistPracticeProgress();
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
  clearPracticeProgress();

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
    sectionEndAt: null,
    timerHandle: null,
  };
  resumableExam = null;
  state.screen = 'examSection';
  render();
  startExamTimer();
}

function persistExamProgress() {
  if (!state.exam) return;
  const snapshot = {
    sections: state.exam.sections,
    sectionIndex: state.exam.sectionIndex,
    answers: state.exam.answers,
    index: state.exam.index,
    sectionEndAt: state.exam.sectionEndAt,
  };
  putRecord('examProgress', snapshot).catch(() => { /* best-effort */ });
}

function clearExamProgress() {
  resumableExam = null;
  deleteRecord('examProgress').catch(() => { /* best-effort */ });
}

function resumeExam() {
  const saved = resumableExam;
  resumableExam = null;
  const section = saved.sections[saved.sectionIndex];
  state.exam = {
    sections: saved.sections,
    sectionIndex: saved.sectionIndex,
    answers: saved.answers,
    index: saved.index,
    secondsLeft: saved.sectionEndAt ? Math.max(0, Math.round((saved.sectionEndAt - Date.now()) / 1000)) : section.timeLimit,
    sectionEndAt: saved.sectionEndAt || null,
    timerHandle: null,
  };
  if (!saved.sectionEndAt) {
    // Tab was closed on the between-sections break screen — resume there instead of mid-question.
    state.screen = 'examSectionBreak';
    render();
    return;
  }
  state.screen = 'examSection';
  render();
  if (state.exam.secondsLeft <= 0) {
    finishExamSection();
  } else {
    startExamTimer();
  }
}

function startExamTimer() {
  stopExamTimer();
  if (!state.exam.sectionEndAt) {
    state.exam.sectionEndAt = Date.now() + state.exam.secondsLeft * 1000;
  }
  persistExamProgress();
  state.exam.timerHandle = setInterval(() => {
    const secondsLeft = Math.max(0, Math.round((state.exam.sectionEndAt - Date.now()) / 1000));
    state.exam.secondsLeft = secondsLeft;
    const el = document.getElementById('exam-timer');
    if (el) {
      el.textContent = formatTime(secondsLeft);
      el.classList.toggle('timer-warn', secondsLeft <= 60);
    }
    if (secondsLeft <= 0) {
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
    persistExamProgress();
    render();
  };
  document.getElementById('exam-back-q').onclick = () => {
    if (exam.index > 0) { exam.index -= 1; persistExamProgress(); render(); }
  };
  document.getElementById('exam-next-q').onclick = () => {
    if (exam.index + 1 < total) { exam.index += 1; persistExamProgress(); render(); }
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
    exam.sectionEndAt = null;
    persistExamProgress();
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
  clearExamProgress();
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
  const scaledScore = estimateScaledScore(totalCorrect / totalQuestions);
  const takeaways = examInsights(sectionsSummary);

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
    <div class="card centered">
      <div class="section-label">Estimated Math Score</div>
      <div class="big-score">${scaledScore} <span style="font-size:14px; color:var(--muted); font-weight:600;">/ 800</span></div>
      <p class="score-disclaimer">Rough estimate from this test's raw score, for motivation and tracking only — not an official score predictor.</p>
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
    <div class="card">
      <div class="section-label">Key Takeaways</div>
      ${renderInsights(takeaways)}
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

let resumableExam = null;
let resumablePractice = null;

async function boot() {
  await initStats();
  resumableExam = await getRecord('examProgress');
  resumablePractice = await getRecord('practiceProgress');
  render();
}

boot();

function persistOnHide() {
  if (state.screen === 'examSection') persistExamProgress();
  if (state.screen === 'session') persistPracticeProgress();
}
window.addEventListener('beforeunload', persistOnHide);
document.addEventListener('visibilitychange', () => { if (document.hidden) persistOnHide(); });

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => { /* offline support best-effort */ });
  });
}
