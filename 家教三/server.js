require('dotenv').config();

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3458;
const FINANCE_FILE = path.join(__dirname, 'data', 'finance.json');
const GOALS_FILE = path.join(__dirname, 'data', 'goals.json');
const WEEKS_FILE = path.join(__dirname, 'data', 'weeks.json');
const SETTINGS_FILE = path.join(__dirname, 'data', 'settings.json');
const PLANS_FILE = process.env.PLANS_PATH || path.join(__dirname, '..', '家教二', 'data', 'plans.json');

const openai = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY || 'sk-placeholder',
  baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
});

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

[FINANCE_FILE, GOALS_FILE].forEach(f => {
  if (!fs.existsSync(f)) fs.writeFileSync(f, '[]', 'utf-8');
});
if (!fs.existsSync(WEEKS_FILE)) fs.writeFileSync(WEEKS_FILE, '{}', 'utf-8');
if (!fs.existsSync(SETTINGS_FILE)) fs.writeFileSync(SETTINGS_FILE, JSON.stringify({tutoringRate:200, starbucksRate:20}, null, 2), 'utf-8');

function readJSON(f) { return JSON.parse(fs.readFileSync(f, 'utf-8')); }
function writeJSON(f, d) { fs.writeFileSync(f, JSON.stringify(d, null, 2), 'utf-8'); }

// ── Finance ──────────────────────────────────────

app.get('/api/finance', (_req, res) => {
  try { res.json(readJSON(FINANCE_FILE)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/finance', (req, res) => {
  try {
    const record = req.body;
    if (record.amount === undefined || !record.type) {
      return res.status(400).json({ error: '缺少必填项' });
    }
    record.id = Date.now();
    record.time = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const data = readJSON(FINANCE_FILE);
    data.unshift(record);
    writeJSON(FINANCE_FILE, data);
    res.status(201).json({ ok: true, record });
  } catch (e) { res.status(500).json({ error: '保存失败' }); }
});

app.delete('/api/finance/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    let data = readJSON(FINANCE_FILE);
    const before = data.length;
    data = data.filter(r => r.id !== id);
    if (data.length === before) return res.status(404).json({ error: '记录不存在' });
    writeJSON(FINANCE_FILE, data);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: '删除失败' }); }
});

// ── Goals ────────────────────────────────────────

app.get('/api/goals', (_req, res) => {
  try { res.json(readJSON(GOALS_FILE)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/goals', (req, res) => {
  try {
    const goal = req.body;
    goal.id = Date.now();
    const data = readJSON(GOALS_FILE);
    data.push(goal);
    writeJSON(GOALS_FILE, data);
    res.status(201).json({ ok: true, goal });
  } catch (e) { res.status(500).json({ error: '保存失败' }); }
});

app.put('/api/goals/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const data = readJSON(GOALS_FILE);
    const idx = data.findIndex(g => g.id === id);
    if (idx < 0) return res.status(404).json({ error: '目标不存在' });
    data[idx] = { ...data[idx], ...req.body };
    writeJSON(GOALS_FILE, data);
    res.json({ ok: true, goal: data[idx] });
  } catch (e) { res.status(500).json({ error: '更新失败' }); }
});

app.delete('/api/goals/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    let data = readJSON(GOALS_FILE);
    const before = data.length;
    data = data.filter(g => g.id !== id);
    if (data.length === before) return res.status(404).json({ error: '不存在' });
    writeJSON(GOALS_FILE, data);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: '删除失败' }); }
});

// ── Settings ─────────────────────────────────────

app.get('/api/settings', (_req, res) => {
  try { res.json(readJSON(SETTINGS_FILE)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/settings', (req, res) => {
  try {
    const current = readJSON(SETTINGS_FILE);
    const updated = { ...current, ...req.body };
    writeJSON(SETTINGS_FILE, updated);
    res.json({ ok: true, settings: updated });
  } catch (e) { res.status(500).json({ error: '保存失败' }); }
});

// ── Weeks ────────────────────────────────────────

app.get('/api/weeks', (_req, res) => {
  try { res.json(readJSON(WEEKS_FILE)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/weeks', (req, res) => {
  try {
    const data = readJSON(WEEKS_FILE);
    const { weekKey, days } = req.body;
    if (!weekKey || !days) return res.status(400).json({ error: '缺少参数' });
    data[weekKey] = days;
    writeJSON(WEEKS_FILE, data);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: '保存失败' }); }
});

// ── Plans check (from 家教二) ────────────────────

app.get('/api/pending', (_req, res) => {
  try {
    if (!fs.existsSync(PLANS_FILE)) return res.json([]);
    const plans = readJSON(PLANS_FILE);
    const finance = readJSON(FINANCE_FILE);
    const recordedIds = new Set(finance.filter(f => f.type === 'income' && f.source === 'tutoring').map(f => f.studentId));
    const pending = plans.filter(p => {
      if (!p.feedback || !p.feedback.length) return false;
      const lastFbId = p.studentId + '_' + p.feedback[p.feedback.length - 1].date;
      return !recordedIds.has(p.studentId);
    }).map(p => ({
      studentId: p.studentId,
      studentName: p.studentName,
      studentGrade: p.studentGrade,
      lastFeedback: p.feedback[p.feedback.length - 1],
    }));
    res.json(pending);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── AI Weekly Summary ────────────────────────────

app.get('/api/summary', async (req, res) => {
  try {
    const finance = readJSON(FINANCE_FILE);
    const weeks = readJSON(WEEKS_FILE);
    const settings = readJSON(SETTINGS_FILE);

    const now = new Date();
    const ws = new Date(now); ws.setDate(now.getDate() - (now.getDay()+6)%7); ws.setHours(0,0,0,0);
    const wsKey = ws.toISOString().slice(0,10);
    const weekStartStr = ws.toLocaleDateString('zh-CN');

    let tutoringIncome=0, starbucksIncome=0, lessonCount=0;
    const thisWeek = weeks[wsKey]||{};
    Object.values(thisWeek).forEach(day=>{
      if(!day)return;
      if(day.type==='tutoring'){tutoringIncome+= +day.amount||settings.tutoringRate;lessonCount++;}
      if(day.type==='starbucks'){starbucksIncome+= (+day.hours||0)*settings.starbucksRate;}
    });

    const expenses = finance.filter(f => {
      const t = new Date(f.time); return f.type==='expense' && t >= ws;
    }).reduce((s, r) => s + (Number(r.amount) || 0), 0);

const prompt = `你是用户的个人财务助理。请用温暖鼓励的语气，总结本周的财务状况。控制在100字以内。每周日期: ${weekStartStr}

本周家教收入: ¥${tutoringIncome}（${lessonCount}节课）
本周星巴克收入: ¥${starbucksIncome}
本周支出: ¥${expenses}
净收入: ¥${tutoringIncome + starbucksIncome - expenses}

请直接返回纯文本，不要JSON。`;

    const completion = await openai.chat.completions.create({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: '你是一个温暖可爱的财务助手，用简短鼓励的语气帮用户总结每周收入和支出。' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.8,
      max_tokens: 300,
    });

    res.json({ summary: completion.choices[0].message.content.trim() });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '生成失败: ' + e.message });
  }
});

// ── AI Wealth Diary ────────────────────────────

app.get('/api/diary', async (req, res) => {
  try {
    const finance = readJSON(FINANCE_FILE);
    const weeks = readJSON(WEEKS_FILE);
    const goals = readJSON(GOALS_FILE);
    const settings = readJSON(SETTINGS_FILE);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthLabel = now.getFullYear()+'年'+(now.getMonth()+1)+'月';

    // Calculate from weekData
    let tutoringIncome=0, starbucksIncome=0, studentSet=new Set();
    Object.values(weeks).forEach(days=>{
      Object.values(days||{}).forEach(day=>{
        if(!day)return;
        if(day.type==='tutoring'){
          tutoringIncome+= +day.amount||settings.tutoringRate;
          if(day.detail) studentSet.add(day.detail);
        }
        if(day.type==='starbucks'){
          starbucksIncome+= (+day.hours||0)*settings.starbucksRate;
        }
      });
    });

    const monthExpenses = finance.filter(f=>{
      const d=new Date(f.time);return f.type==='expense'&&d>=monthStart;
    }).reduce((s,r)=>s+(+r.amount||0),0);

    const totalIncome = tutoringIncome+starbucksIncome;
    const lessonCount = studentSet.size;
    const activeGoal = goals.find(g=>g.status!=='done');
    const goalText = activeGoal ? `正在为「${activeGoal.name}」攒钱中，目标 ¥${activeGoal.target}` : '暂无储蓄目标';

    const prompt = `你是用户最亲密的财务成长伙伴，像一位懂她的闺蜜/兄弟。用户是一名大学生家教老师+星巴克兼职。

【${monthLabel} 财务数据】
家教收入：¥${tutoringIncome}（教了${lessonCount}个学生）
星巴克收入：¥${starbucksIncome}
总支出：¥${monthExpenses}
净收入：¥${totalIncome-monthExpenses}
储蓄目标：${goalText}

请用温暖、有画面感的语气，写一段150字以内的"财富成长日记"。像在写日记，不要像报告。要有：
1. 对数据的感受（骄傲/鼓励/调侃都可以）
2. 一个小亮点或小提醒
3. 给用户一点力量

直接返回纯文本，不要JSON，不要标题。`;

    const completion = await openai.chat.completions.create({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: '你是一个温暖、有共情力的财务成长伙伴。请用亲密、有画面感、有温度的语气写日记。像闺蜜在耳边说话。150字以内。' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.9,
      max_tokens: 400,
    });

    res.json({ diary: completion.choices[0].message.content.trim(), month: monthLabel });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ 家教三 · 财务中心已启动`);
  console.log(`   本机访问: http://localhost:${PORT}`);
});
