const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3456;
const DATA_FILE = path.join(__dirname, 'data', 'submissions.json');

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Ensure data file exists
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, '[]', 'utf-8');
}

function readData() {
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// GET /api/submissions - list all
app.get('/api/submissions', (req, res) => {
  try {
    res.json(readData());
  } catch (e) {
    res.status(500).json({ error: '读取数据失败' });
  }
});

// POST /api/submissions - add one
app.post('/api/submissions', (req, res) => {
  try {
    const sub = req.body;
    if (!sub.childName || !sub.childGrade) {
      return res.status(400).json({ error: '孩子姓名和年级为必填项' });
    }
    sub.id = Date.now();
    sub.timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const data = readData();
    data.push(sub);
    writeData(data);
    res.status(201).json({ ok: true, id: sub.id });
  } catch (e) {
    res.status(500).json({ error: '保存失败' });
  }
});

// DELETE /api/submissions/:id
app.delete('/api/submissions/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    let data = readData();
    const before = data.length;
    data = data.filter(s => s.id !== id);
    if (data.length === before) {
      return res.status(404).json({ error: '记录不存在' });
    }
    writeData(data);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: '删除失败' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ 家教预评估服务器已启动`);
  console.log(`   本机访问: http://localhost:${PORT}`);
  console.log(`   局域网访问: http://<本机IP>:${PORT}`);
  console.log(`   数据文件: ${DATA_FILE}`);
});
