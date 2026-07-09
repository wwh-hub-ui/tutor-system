require('dotenv').config();

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3457;
const PLANS_FILE = path.join(__dirname, 'data', 'plans.json');
const SUBMISSIONS_FILE = path.join(__dirname, '..', '家教', 'data', 'submissions.json');

const openai = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY || 'sk-placeholder',
  baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
});

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

if (!fs.existsSync(PLANS_FILE)) fs.writeFileSync(PLANS_FILE, '[]', 'utf-8');

function readJSON(f) { return JSON.parse(fs.readFileSync(f, 'utf-8')); }
function writeJSON(f, d) { fs.writeFileSync(f, JSON.stringify(d, null, 2), 'utf-8'); }

// ── 能力雷达图评分引擎 ─────────────────────────
// 答案文本 → 分值 (越高越好，1-5)
function scoreByAnswer(answer, opts) {
  if (!answer || !opts || !opts.length) return 2.5;
  const idx = opts.indexOf(answer);
  if (idx < 0) return 2.5;
  if (opts.length === 1) return 3;
  return Math.round((1 + (idx / (opts.length - 1)) * 4) * 10) / 10;
}

function getRadarData(student) {
  const cn = { score: 0, total: 0 };
  const mt = { score: 0, total: 0 };
  const en = { score: 0, total: 0 };
  const hb = { score: 0, total: 0 };

  function scoreQA(qArr, prefix, target) {
    if (!qArr || !qArr.length) return;
    qArr.forEach(q => {
      const ans = student.answers[q.id];
      if (ans) { target.score += scoreByAnswer(ans, q.opts); target.total++; }
    });
  }

  // 习惯题 hb4（薄弱科目）和 hb5（性格）不算分
  const cq = (student._cq || []).filter(q => q.id !== 'hb4' && q.id !== 'hb5');
  scoreQA(student._cq, 'cn', cn);
  scoreQA(student._mq, 'mt', mt);
  scoreQA(student._eq, 'en', en);
  // 习惯用 hb1-hb3（专注力、自觉度、兴趣）
  const habitsQ = (student._hq || []).filter(q => ['hb1','hb2','hb3'].includes(q.id));
  scoreQA(habitsQ, 'hb', hb);

  return {
    chinese: cn.total ? Math.round(cn.score / cn.total * 20) : 0,   // 0-100
    math: mt.total ? Math.round(mt.score / mt.total * 20) : 0,
    english: en.total ? Math.round(en.score / en.total * 20) : 0,
    habits: hb.total ? Math.round(hb.score / hb.total * 20) : 0,
  };
}

// ── Students ──────────────────────────────────────

app.get('/api/students', (_req, res) => {
  try {
    if (!fs.existsSync(SUBMISSIONS_FILE)) return res.json([]);
    const subs = readJSON(SUBMISSIONS_FILE);
    const students = subs.map(s => ({
      id: s.id,
      childName: s.childName,
      childGrade: s.childGrade,
      school: s.school || '',
      parentGoal: s.parentGoal || '',
      timestamp: s.timestamp,
      answers: s.answers,
      _cq: s._cq, _mq: s._mq, _eq: s._eq, _hq: s._hq,
      radar: getRadarData(s),
    }));
    res.json(students);
  } catch (e) { res.status(500).json({ error: '读取学生数据失败: ' + e.message }); }
});

// ── Plans ────────────────────────────────────────

app.get('/api/plans', (_req, res) => {
  try { res.json(readJSON(PLANS_FILE)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Reusable plan generator (used by both API and Agent) ──
async function generatePlanForStudent(studentId) {
  if (!fs.existsSync(SUBMISSIONS_FILE)) throw new Error('未找到学生数据源');
  const subs = readJSON(SUBMISSIONS_FILE);
  const student = subs.find(s => s.id === studentId);
  if (!student) throw new Error('学生不存在');

  const gradeMap = { '1': '一年级', '2': '二年级', '3': '三年级', '4': '四年级' };
  const grade = gradeMap[student.childGrade] || student.childGrade;

  function formatQAs(qArr) {
    if (!qArr || !qArr.length) return '（未填写）';
    return qArr.map(q => `  · ${q.q}\n    回答：${student.answers[q.id] || '未作答'}`).join('\n');
  }

  const cnText = formatQAs(student._cq);
  const mtText = formatQAs(student._mq);
  const enText = formatQAs(student._eq);
  const hbText = formatQAs(student._hq);

  const plans = readJSON(PLANS_FILE);
  const existingPlan = plans.find(p => p.studentId === studentId);
  let feedbackHistory = '';
  if (existingPlan && existingPlan.feedback && existingPlan.feedback.length) {
    feedbackHistory = '\n【历史教学反馈（请根据这些反馈优化本次教案，避免重复无效方法）】\n';
    existingPlan.feedback.forEach((fb, i) => {
      feedbackHistory += `${i + 1}. [${fb.date}] ${fb.content}\n`;
    });
  }

  const prompt = `你是一位资深的苏州小学家教老师，精通苏教版语文、苏教版数学和译林版英语（三年级起）。请根据以下学生的学情评估结果，生成一份个性化教学方案。

注意：该学生每周仅有1节课（约1.5~2小时），请据此合理安排重点，不要贪多。

【学生信息】
姓名：${student.childName}
年级：${grade}
学校：${student.school || '未填写'}
家长期望：${student.parentGoal || '未填写'}

【语文评估（苏教版）】
${cnText}

【数学评估（苏教版）】
${mtText}

【英语评估（译林版）】
${enText}

【学习习惯与个性】
${hbText}
${feedbackHistory}
请以 JSON 格式返回教学方案，不要包含 markdown 代码块标记，直接返回纯 JSON：

{
  "analysis": {
    "strengths": ["优势1", "优势2"],
    "weaknesses": ["薄弱点1", "薄弱点2"],
    "learningStyle": "学生的学习风格描述（30字以内）",
    "overallAssessment": "综合评估（80字以内）"
  },
  "goals": [
    { "title": "短期/中期目标", "priority": "high|medium|low", "status": "pending" }
  ],
  "modules": [
    {
      "subject": "语文|数学|英语",
      "title": "模块名称",
      "focus": "重点内容",
      "exercises": "推荐练习形式",
      "practiceProblems": ["具体题目1（含答案）", "具体题目2（含答案）"],
      "sessionFocus": "本节课重点分配的模块及时间（如：数学40分钟、语文30分钟等）",
      "tips": "教学注意事项"
    }
  ],
  "suggestedSchedule": "本节课教学流程安排建议（含导入、新授、练习、总结各环节，60字以内）",
  "parentAdvice": "给家长的家庭辅导建议（50字以内）",
  "parentTasks": ["家庭小任务1（具体可执行）", "家庭小任务2"]
}`;

  const completion = await openai.chat.completions.create({
    model: 'deepseek-chat',
    messages: [
      { role: 'system', content: '你是一位专业的苏州小学家教老师，擅长根据学情评估和历史反馈生成个性化教学方案。每个教学模块都要包含具体可执行的练习题（5题左右，含答案）。请严格按 JSON 格式返回结果。' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.7,
    max_tokens: 5000,
  });

  const raw = completion.choices[0].message.content.trim();
  const clean = raw.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?\s*```$/i, '');
  const aiResult = JSON.parse(clean);

  const existingIdx = plans.findIndex(p => p.studentId === studentId);
  const plan = {
    id: Date.now(),
    studentId: student.id,
    studentName: student.childName,
    studentGrade: student.childGrade,
    studentSchool: student.school || '',
    parentGoal: student.parentGoal || '',
    radar: getRadarData(student),
    ...aiResult,
    feedback: [],
    createdAt: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
    updatedAt: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
  };

  if (existingIdx >= 0) {
    plan.id = plans[existingIdx].id;
    plan.feedback = plans[existingIdx].feedback || [];
    plan.createdAt = plans[existingIdx].createdAt;
    plans[existingIdx] = plan;
  } else {
    plans.push(plan);
  }

  writeJSON(PLANS_FILE, plans);
  return plan;
}

// AI Generate (API)
app.post('/api/plans/generate', async (req, res) => {
  try {
    const { studentId } = req.body;
    if (!studentId) return res.status(400).json({ error: '缺少 studentId' });
    const plan = await generatePlanForStudent(studentId);
    res.status(201).json({ ok: true, plan });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '生成失败: ' + e.message });
  }
});

// Update plan
app.put('/api/plans/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const plans = readJSON(PLANS_FILE);
    const idx = plans.findIndex(p => p.id === id);
    if (idx < 0) return res.status(404).json({ error: '教案不存在' });

    const updates = req.body;
    const plan = plans[idx];

    if (updates.goals) plan.goals = updates.goals;
    if (updates.modules) plan.modules = updates.modules;
    if (updates.analysis) plan.analysis = updates.analysis;
    if (updates.suggestedSchedule) plan.suggestedSchedule = updates.suggestedSchedule;
    if (updates.parentAdvice) plan.parentAdvice = updates.parentAdvice;
    if (updates.parentTasks) plan.parentTasks = updates.parentTasks;
    if (updates.feedback) plan.feedback = updates.feedback;
    if (updates.goalStatuses) {
      Object.entries(updates.goalStatuses).forEach(([idxStr, status]) => {
        const gi = parseInt(idxStr);
        if (plan.goals[gi]) plan.goals[gi].status = status;
      });
    }

    plan.updatedAt = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    writeJSON(PLANS_FILE, plans);
    res.json({ ok: true, plan });
  } catch (e) {
    res.status(500).json({ error: '更新失败: ' + e.message });
  }
});

// Delete plan
app.delete('/api/plans/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    let plans = readJSON(PLANS_FILE);
    const before = plans.length;
    plans = plans.filter(p => p.id !== id);
    if (plans.length === before) return res.status(404).json({ error: '教案不存在' });
    writeJSON(PLANS_FILE, plans);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: '删除失败: ' + e.message }); }
});

// ── Share Token ────────────────────────────────
function generateToken() {
  return 'rpt_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

app.post('/api/plans/:id/share', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const plans = readJSON(PLANS_FILE);
    const idx = plans.findIndex(p => p.id === id);
    if (idx < 0) return res.status(404).json({ error: '教案不存在' });
    plans[idx].shareToken = generateToken();
    plans[idx].shareCreatedAt = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    writeJSON(PLANS_FILE, plans);
    const host = req.get('host') || 'localhost:' + PORT;
    res.json({ ok: true, token: plans[idx].shareToken, url: 'http://' + host + '/report/' + plans[idx].shareToken });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Parent Report (JSON API) ────────────────────
app.get('/api/report/:studentId', (req, res) => {
  try {
    const studentId = parseInt(req.params.studentId);
    if (!fs.existsSync(SUBMISSIONS_FILE)) return res.status(404).json({ error: '未找到学生数据' });
    const subs = readJSON(SUBMISSIONS_FILE);
    const student = subs.find(s => s.id === studentId);
    if (!student) return res.status(404).json({ error: '学生不存在' });

    const plans = readJSON(PLANS_FILE);
    const plan = plans.find(p => p.studentId === studentId);

    const gradeMap = { '1': '一年级', '2': '二年级', '3': '三年级', '4': '四年级' };

    // score helper
    function scoreByAnswer(answer, opts) {
      if (!answer || !opts || !opts.length) return 2.5;
      const idx = opts.indexOf(answer);
      if (idx < 0) return 2.5;
      if (opts.length === 1) return 3;
      return Math.round((1 + (idx / (opts.length - 1)) * 4) * 10) / 10;
    }
    function getRadar(s) {
      const cn = { score: 0, total: 0 }; const mt = { score: 0, total: 0 };
      const en = { score: 0, total: 0 }; const hb = { score: 0, total: 0 };
      (s._cq||[]).forEach(q => { const a = s.answers[q.id]; if (a) { cn.score += scoreByAnswer(a, q.opts); cn.total++; } });
      (s._mq||[]).forEach(q => { const a = s.answers[q.id]; if (a) { mt.score += scoreByAnswer(a, q.opts); mt.total++; } });
      (s._eq||[]).forEach(q => { const a = s.answers[q.id]; if (a) { en.score += scoreByAnswer(a, q.opts); en.total++; } });
      (s._hq||[]).filter(q => ['hb1','hb2','hb3'].includes(q.id)).forEach(q => { const a = s.answers[q.id]; if (a) { hb.score += scoreByAnswer(a, q.opts); hb.total++; } });
      return {
        chinese: cn.total ? Math.round(cn.score / cn.total * 20) : 0,
        math: mt.total ? Math.round(mt.score / mt.total * 20) : 0,
        english: en.total ? Math.round(en.score / en.total * 20) : 0,
        habits: hb.total ? Math.round(hb.score / hb.total * 20) : 0,
      };
    }

    res.json({
      student: {
        id: student.id,
        name: student.childName,
        grade: gradeMap[student.childGrade] || student.childGrade,
        school: student.school || '',
        parentGoal: student.parentGoal || '',
        radar: getRadar(student),
      },
      plan: plan ? {
        analysis: plan.analysis,
        goals: plan.goals,
        modules: plan.modules,
        suggestedSchedule: plan.suggestedSchedule,
        parentAdvice: plan.parentAdvice,
        parentTasks: plan.parentTasks,
        updatedAt: plan.updatedAt,
        createdAt: plan.createdAt,
      } : null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// Generate parent report
app.get('/api/plans/:id/report', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const plans = readJSON(PLANS_FILE);
    const plan = plans.find(p => p.id === id);
    if (!plan) return res.status(404).json({ error: '教案不存在' });

    const gradeMap = { '1': '一年级', '2': '二年级', '3': '三年级', '4': '四年级' };
    const grade = gradeMap[plan.studentGrade] || plan.studentGrade;

    // Build context for AI
    const goalsSummary = (plan.goals || []).map(g => {
      const statusIcon = g.status === 'completed' ? '✅' : g.status === 'in_progress' ? '🔄' : '⭕';
      return statusIcon + ' ' + g.title + ' [' + (g.priority === 'high' ? '重点' : g.priority === 'medium' ? '一般' : '次要') + ']';
    }).join('\n');

    const modulesSummary = (plan.modules || []).map(m =>
      (m.subject || '') + '：' + (m.title || '') + ' | 重点：' + (m.focus || '')
    ).join('\n');

    const lastFeedback = (plan.feedback && plan.feedback.length) ? plan.feedback[plan.feedback.length - 1] : null;
    const fbText = lastFeedback ? lastFeedback.date + '：' + lastFeedback.content : '暂无';

    const prompt = `你是一位苏州小学家教老师，需要给家长写一份简短的学习报告。要求：
- 语气亲切温暖，像朋友聊天
- 控制在200字以内，适合微信发送
- 用家长能理解的通俗语言，不要太多术语
- 结构：孩子表现亮点 → 需要加强的地方 → 本周家庭小建议 → 鼓励的话

【学生信息】
姓名：${plan.studentName}，${grade}
家长期望：${plan.parentGoal || '无'}

【教学目标进度】
${goalsSummary}

【教学模块】
${modulesSummary}

【最近反馈】
${fbText}

【家长任务】
${(plan.parentTasks || []).join('\n')}

请直接返回纯文本报告内容，不要JSON，不要markdown标记。`;

    const completion = await openai.chat.completions.create({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: '你是一位温暖亲切的苏州家教老师，擅长用通俗语言向家长汇报孩子学习情况。请直接返回纯文本，200字以内。' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.8,
      max_tokens: 600,
    });

    const report = completion.choices[0].message.content.trim();
    res.json({ ok: true, report });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '生成报告失败: ' + e.message });
  }
});

// ══════════════════════════════════════════════════
// 🤖 智能体引擎
// ══════════════════════════════════════════════════
const AGENT_FILE = path.join(__dirname, 'data', 'agent.json');
if (!fs.existsSync(AGENT_FILE)) writeJSON(AGENT_FILE, { autoMode: false, notifications: [], lastCheck: null });

function agentState() { return readJSON(AGENT_FILE); }
function updateAgent(s) { writeJSON(AGENT_FILE, s); }

function addNotification(type, studentName, studentId, message) {
  const state = agentState();
  state.notifications.unshift({
    id: Date.now(),
    type,       // "new_student" | "plan_ready" | "report_ready" | "warning"
    studentName,
    studentId,
    message,
    time: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
    read: false,
  });
  if (state.notifications.length > 50) state.notifications.length = 50;
  updateAgent(state);
}

// Agent API
app.get('/api/agent/status', (_req, res) => {
  const state = agentState();
  const plans = readJSON(PLANS_FILE);
  let subs = [];
  if (fs.existsSync(SUBMISSIONS_FILE)) subs = readJSON(SUBMISSIONS_FILE);

  const planIds = new Set(plans.map(p => p.studentId));
  const newStudents = subs.filter(s => !planIds.has(s.id));

  res.json({
    autoMode: state.autoMode,
    totalStudents: subs.length,
    studentsWithPlans: plans.length,
    newStudents: newStudents.map(s => ({ id: s.id, name: s.childName, grade: s.childGrade })),
    notifications: state.notifications.slice(0, 20),
    lastCheck: state.lastCheck,
  });
});

app.post('/api/agent/toggle', (req, res) => {
  const state = agentState();
  state.autoMode = !state.autoMode;
  updateAgent(state);
  console.log(`🤖 智能体: ${state.autoMode ? '🟢 已开启' : '🔴 已关闭'}`);
  res.json({ autoMode: state.autoMode });
});

app.post('/api/agent/read', (req, res) => {
  const state = agentState();
  const { ids } = req.body;
  if (ids && ids.length) {
    state.notifications.forEach(n => { if (ids.includes(n.id)) n.read = true; });
  } else {
    state.notifications.forEach(n => n.read = true);
  }
  updateAgent(state);
  res.json({ ok: true });
});

// ── 智能体主循环 ──
let agentInterval = null;
let isAgentBusy = false;

async function agentTick() {
  if (isAgentBusy) return;
  const state = agentState();
  if (!state.autoMode) return;

  try {
    isAgentBusy = true;
    if (!fs.existsSync(SUBMISSIONS_FILE)) return;

    const subs = readJSON(SUBMISSIONS_FILE);
    const plans = readJSON(PLANS_FILE);
    const planIds = new Set(plans.map(p => p.studentId));
    const newStudents = subs.filter(s => !planIds.has(s.id));

    if (newStudents.length > 0) {
      console.log(`🤖 智能体: 发现 ${newStudents.length} 个新学生，自动生成教案...`);
      for (const s of newStudents) {
        try {
          await generatePlanForStudent(s.id);
          addNotification('new_student', s.childName, s.id,
            `新学生 ${s.childName} 已完成评估，智能体已自动生成教案和雷达图。`);
          console.log(`  ✅ ${s.childName} 教案已自动生成`);
        } catch (e) {
          console.error(`  ❌ ${s.childName} 生成失败: ${e.message}`);
        }
      }
    }

    // Check students with recent feedback but no parent report sent
    for (const plan of plans) {
      if (plan.feedback && plan.feedback.length > 0) {
        const lastFb = plan.feedback[plan.feedback.length - 1];
        const lastFbTime = new Date(lastFb.date).getTime();
        const reportedKey = `reported_${plan.id}_${lastFbTime}`;
        const alreadyNotified = state.notifications.some(
          n => n.type === 'report_ready' && n.studentId === plan.studentId && n.message.includes(lastFb.date)
        );
        if (!alreadyNotified && plan.feedback.length > 0) {
          addNotification('report_ready', plan.studentName, plan.studentId,
            `${plan.studentName} 有新反馈（${lastFb.date}），别忘了生成家长报告哦。`);
        }
      }
    }

    state.lastCheck = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    updateAgent(state);
  } catch (e) {
    console.error('🤖 智能体异常:', e.message);
  } finally {
    isAgentBusy = false;
  }
}

function startAgent() {
  if (agentInterval) clearInterval(agentInterval);
  agentInterval = setInterval(agentTick, 30000); // 每30秒检查
  console.log('🤖 智能体引擎已启动（默认关闭，需手动开启）');
}


app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ 家教二 · AI教案生成系统已启动`);
  console.log(`   本机访问: http://localhost:${PORT}`);
  console.log(`   学生数据: ${SUBMISSIONS_FILE}`);
  console.log(`   教案数据: ${PLANS_FILE}`);
});
