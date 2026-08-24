const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

app.use(express.json());
app.use(cookieParser());
app.use(cors());

console.log('🚀 Starting Discord Onliner...');
console.log(`🔗 Base URL: ${BASE_URL}`);

// ===== HOMEPAGE =====
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Discord Onliner</title>
      <style>
        body { background: #0a0a0a; color: #fff; font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
        .card { background: #121212; border: 1px solid #1a1a1a; border-radius: 12px; padding: 40px; text-align: center; max-width: 400px; }
        h1 { font-weight: 300; letter-spacing: 2px; }
        .btn { display: inline-block; padding: 12px 30px; border: 1px solid #fff; color: #fff; text-decoration: none; border-radius: 8px; margin-top: 20px; transition: all 0.3s; }
        .btn:hover { background: #fff; color: #0a0a0a; }
        .sub { color: #666; font-size: 14px; margin-top: 10px; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>◈ onliner</h1>
        <p style="color: #888; font-size: 14px;">Discord Session Manager</p>
        <a href="/api/auth/login" class="btn">Login with Discord</a>
        <p class="sub">Secure • Private • Self-Hosted</p>
      </div>
    </body>
    </html>
  `);
});

// ===== DISCORD BOT =====
const bot = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ]
});

bot.on('ready', () => {
  console.log(`✅ Bot logged in as ${bot.user.tag}`);
});

bot.on('messageCreate', async (message) => {
  // DEBUG: Log every message the bot receives
  console.log('📩 Received message:', message.content);
  console.log('👤 From:', message.author.tag);
  console.log('🤖 Is bot?', message.author.bot);

  if (message.author.bot) return;

  if (!message.content.startsWith('.allow')) {
    console.log('⏭️ Not a .allow command, ignoring');
    return;
  }

  console.log('🔍 Processing .allow command...');

  const args = message.content.split(' ');
  if (args.length < 2) {
    console.log('❌ No username provided');
    return message.reply('Usage: .allow @username');
  }

  const targetUser = message.mentions.users.first();
  if (!targetUser) {
    console.log('❌ No valid mention found');
    return message.reply('Mention a valid user.');
  }

  console.log(`👤 Target user: ${targetUser.username} (${targetUser.id})`);
  console.log(`🔑 Admin ID: ${process.env.ADMIN_DISCORD_ID}`);
  console.log(`👤 Message author ID: ${message.author.id}`);

  if (message.author.id !== process.env.ADMIN_DISCORD_ID) {
    console.log('❌ Not authorized (wrong admin ID)');
    return message.reply('❌ You are not authorized.');
  }

  try {
    await prisma.user.upsert({
      where: { discordId: targetUser.id },
      update: { isAllowed: true },
      create: {
        discordId: targetUser.id,
        username: targetUser.username,
        avatar: targetUser.avatar,
        isAllowed: true
      }
    });
    console.log(`✅ ${targetUser.username} now has access.`);
    message.reply(`✅ ${targetUser.username} now has access.`);
  } catch (err) {
    console.error('❌ DB error:', err);
    message.reply('❌ Database error occurred.');
  }
});

bot.login(process.env.DISCORD_BOT_TOKEN).catch(err => {
  console.error('❌ Bot failed to login:', err.message);
});

// ===== DISCORD OAUTH ROUTES =====
app.get('/api/auth/login', (req, res) => {
  const url = `https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&redirect_uri=${BASE_URL}/api/auth/callback&response_type=code&scope=identify`;
  res.redirect(url);
});

app.get('/api/auth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('No code provided');

  try {
    console.log('🔑 Exchanging code for token...');
    console.log('📦 Client ID:', process.env.DISCORD_CLIENT_ID);
    console.log('🔒 Client Secret exists?', !!process.env.DISCORD_CLIENT_SECRET);
    console.log('🌐 Redirect URI:', `${BASE_URL}/api/auth/callback`);

    const tokenRes = await axios.post('https://discord.com/api/oauth2/token', 
      new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${BASE_URL}/api/auth/callback`
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const userRes = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenRes.data.access_token}` }
    });

    const user = userRes.data;
    console.log(`👤 User: ${user.username} (${user.id})`);

    const dbUser = await prisma.user.upsert({
      where: { discordId: user.id },
      update: { username: user.username, avatar: user.avatar },
      create: {
        discordId: user.id,
        username: user.username,
        avatar: user.avatar,
        isAllowed: false
      }
    });

    if (!dbUser.isAllowed) {
      return res.redirect('/access-denied');
    }

    const jwtToken = jwt.sign({ userId: dbUser.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.cookie('session_token', jwtToken, { httpOnly: true, secure: true, sameSite: 'strict' });
    res.redirect('/dashboard');

  } catch (error) {
    console.error('❌ Auth error DETAILS:', error.response?.data || error.message);
    res.status(500).send('Authentication failed: ' + (error.response?.data?.error || error.message));
  }
});

app.get('/api/auth/me', async (req, res) => {
  const token = req.cookies.session_token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { username: true, discordId: true, isAllowed: true }
    });
    res.json(user);
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

app.get('/api/auth/logout', (req, res) => {
  res.clearCookie('session_token');
  res.redirect('/');
});

// ===== SESSION API =====
app.post('/api/session/start', async (req, res) => {
  const token = req.cookies.session_token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { isAllowed: true }
    });

    if (!user || !user.isAllowed) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const { token: discordToken, duration } = req.body;
    if (!discordToken) return res.status(400).json({ error: 'Token required' });

    res.json({ success: true, sessionId: 'session_' + Date.now() });

  } catch {
    res.status(401).json({ error: 'Invalid session' });
  }
});

app.get('/api/session/logs', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.write('data: ["✅ Connected to log stream"]\n\n');

  const interval = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 30000);

  req.on('close', () => {
    clearInterval(interval);
    res.end();
  });
});

// ===== HEALTH CHECK =====
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ===== ACCESS DENIED PAGE =====
app.get('/access-denied', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Access Denied</title>
    <style>
      body { background: #0a0a0a; color: #fff; font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
      .card { background: #121212; border: 1px solid #1a1a1a; border-radius: 12px; padding: 40px; text-align: center; max-width: 400px; }
      h1 { font-weight: 300; }
      .lock { font-size: 48px; margin-bottom: 20px; }
      .sub { color: #666; font-size: 14px; }
      .highlight { color: #fff; font-weight: bold; }
    </style>
    </head>
    <body>
      <div class="card">
        <div class="lock">🔒</div>
        <h1>Access Denied</h1>
        <p style="color: #888;">You don't have permission to access this dashboard.</p>
        <p class="sub">Contact <span class="highlight">Ebaad</span> on Discord to request access.</p>
        <a href="/api/auth/logout" style="color: #666; text-decoration: none; font-size: 14px; display: inline-block; margin-top: 20px;">Sign out →</a>
      </div>
    </body>
    </html>
  `);
});

// ===== DASHBOARD PAGE =====
app.get('/dashboard', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Dashboard</title>
    <style>
      body { background: #0a0a0a; color: #fff; font-family: Arial, sans-serif; margin: 0; padding: 20px; }
      .container { max-width: 600px; margin: 0 auto; }
      .card { background: #121212; border: 1px solid #1a1a1a; border-radius: 12px; padding: 24px; margin-bottom: 20px; }
      input, select { background: #0d0d0d; border: 1px solid #1a1a1a; color: #fff; padding: 12px; border-radius: 8px; width: 100%; box-sizing: border-box; margin: 5px 0 15px 0; }
      input:focus, select:focus { outline: none; border-color: #333; }
      .btn { background: transparent; border: 1px solid #fff; color: #fff; padding: 12px 24px; border-radius: 8px; cursor: pointer; transition: all 0.3s; }
      .btn:hover { background: #fff; color: #0a0a0a; }
      .btn:disabled { opacity: 0.4; cursor: not-allowed; }
      .console { background: #070707; border: 1px solid #1a1a1a; border-radius: 8px; padding: 16px; font-family: monospace; font-size: 13px; color: #888; height: 200px; overflow-y: auto; white-space: pre-wrap; }
      .success { color: #66ff99; }
      .error { color: #ff6666; }
      .info { color: #88ccff; }
      .warn { color: #ffcc66; }
      .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
      .logout { color: #666; text-decoration: none; font-size: 14px; }
      .logout:hover { color: #fff; }
    </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1 style="font-weight: 300; letter-spacing: 2px;">◈ onliner</h1>
          <a href="/api/auth/logout" class="logout">logout</a>
        </div>

        <div class="card">
          <label style="color: #888; font-size: 14px;">Discord Token</label>
          <input type="password" id="token" placeholder="MDY2..." />

          <label style="color: #888; font-size: 14px;">Duration (hours)</label>
          <input type="number" id="duration" value="4" min="1" max="24" />

          <button class="btn" id="startBtn" onclick="startSession()">▶ Start Session</button>
        </div>

        <div class="card">
          <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
            <span style="color: #888; font-size: 14px;">◈ console</span>
            <span style="color: #444; font-size: 12px;" id="logCount">0 lines</span>
          </div>
          <div class="console" id="console">Waiting for session to start...</div>
        </div>
      </div>

      <script>
        let logs = [];
        let eventSource = null;
        let sessionId = null;

        function addLog(msg, type = 'info') {
          const time = new Date().toLocaleTimeString();
          const colors = { info: 'info', success: 'success', error: 'error', warn: 'warn' };
          logs.push(\`[\${time}] <span class="\${colors[type] || 'info'}">\${msg}</span>\`);
          document.getElementById('console').innerHTML = logs.join('\\n');
          document.getElementById('logCount').textContent = logs.length + ' lines';
          document.getElementById('console').scrollTop = document.getElementById('console').scrollHeight;
        }

        async function startSession() {
          const token = document.getElementById('token').value;
          const duration = parseInt(document.getElementById('duration').value);

          if (!token) {
            addLog('Please enter a Discord token', 'error');
            return;
          }

          const btn = document.getElementById('startBtn');
          btn.disabled = true;
          btn.textContent = '⏳ Connecting...';

          addLog('🔑 Validating token...', 'info');

          try {
            const res = await fetch('/api/session/start', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token, duration })
            });

            const data = await res.json();

            if (!res.ok) {
              addLog('❌ ' + (data.error || 'Failed to start session'), 'error');
              btn.disabled = false;
              btn.textContent = '▶ Start Session';
              return;
            }

            sessionId = data.sessionId;
            addLog('✅ Session started!', 'success');
            addLog('🌐 Connecting to Discord...', 'info');

            if (eventSource) eventSource.close();
            eventSource = new EventSource(\`/api/session/logs?sessionId=\${sessionId}\`);

            eventSource.onmessage = (event) => {
              try {
                const msgs = JSON.parse(event.data);
                if (Array.isArray(msgs)) {
                  msgs.forEach(m => {
                    if (m.includes('✅') || m.includes('success')) addLog(m, 'success');
                    else if (m.includes('❌') || m.includes('error') || m.includes('failed')) addLog(m, 'error');
                    else if (m.includes('⚠️') || m.includes('warn')) addLog(m, 'warn');
                    else addLog(m, 'info');
                  });
                } else {
                  addLog(event.data, 'info');
                }
              } catch {
                addLog(event.data, 'info');
              }
            };

            eventSource.onerror = () => {
              addLog('⚠️ Log stream disconnected', 'warn');
              eventSource.close();
            };

            btn.disabled = false;
            btn.textContent = '⏹ Stop';
            btn.onclick = stopSession;

          } catch (error) {
            addLog('❌ Error: ' + error.message, 'error');
            btn.disabled = false;
            btn.textContent = '▶ Start Session';
          }
        }

        function stopSession() {
          if (eventSource) {
            eventSource.close();
            eventSource = null;
          }
          addLog('⏹️ Session stopped', 'warn');
          const btn = document.getElementById('startBtn');
          btn.textContent = '▶ Start Session';
          btn.onclick = startSession;
        }
      </script>
    </body>
    </html>
  `);
});

// ===== START SERVER =====
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🌐 Open: ${BASE_URL}`);
});
