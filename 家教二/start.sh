#!/bin/bash
export PATH="/usr/local/bin:$PATH"
echo "🚀 启动家教系统..."

cd ~/Desktop/家教 && nohup node server.js > /tmp/jiajiao.log 2>&1 &
echo "  ✅ 家教 (http://localhost:3456)"

cd ~/Desktop/家教二 && nohup node server.js > /tmp/jiajiao2.log 2>&1 &
echo "  ✅ 家教二 (http://localhost:3457)"

cd ~/Desktop/家教三 && nohup node server.js > /tmp/jiajiao3.log 2>&1 &
echo "  ✅ 家教三 (http://localhost:3458)"

echo "✅ 全部启动！关闭终端也不会断。"
