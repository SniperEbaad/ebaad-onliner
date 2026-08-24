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

app.use(express.json());
app.use(cookieParser());
app.use(cors());

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
  if (message.author.bot) return;
  if (!message.content.startsWith('.allow')) return;

  const args = message.content.split(' ');
  if (args.length < 2) return message.reply('Usage: .allow @username');

  const targetUser = message.mentions.users.first();
  if (!targetUser) return message.reply('Mention a valid user.');

  // Only admin can use this
  if (message.author.id !== process.env.ADMIN_DISCORD_ID) {
    return message.reply('❌ You are not authorized.');
  }

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

  message.reply(`✅ ${targetUser.username} now has access.`);
});

bot.login(process.env.DISCORD_BOT_TOKEN);

// ===== DISCORD OAUTH =====
app.get('/api/auth/login', (req, res) => {
  const url = `https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&redirect_uri=${process.env.RENDER_EXTERNAL_URL}/api/auth/callback&response_type=code&scope=identify`;
  res.redirect(url);
});

app.get('/api/auth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('No code provided');

  try {
    const tokenRes = await axios.post('https://discord.com/api/oauth2/token', 
      new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${process.env.RENDER_EXTERNAL_URL}/api/auth/callback`
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const userRes = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenRes.data.access_token}` }
    });

    const user = userRes.data;

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
    console.error('Auth error:', error);
    res.status(500).send('Authentication failed');
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

// ===== HEALTH CHECK =====
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ===== SERVE STATIC FILES =====
app.use(express.static('public'));

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
