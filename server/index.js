const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const ANSWER_TIME = 10;           // secondes par question
const REVEAL_TIME = 6;            // secondes sur l'écran révélation
const SPEED_BONUS = [30, 15, 10]; // bonus pour 1er, 2ème, 3ème correct

// ─── IN-MEMORY STATE ──────────────────────────────────────────────────────────
const rooms = {};

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function broadcastAll(roomCode, payload) {
  const room = rooms[roomCode];
  if (!room) return;
  const msg = JSON.stringify(payload);
  for (const [ws] of room.connections) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

function getPublicRoom(room) {
  const players = {};
  for (const [, p] of room.connections) {
    players[p.id] = { name: p.name, score: p.score, answers: p.answers, speedRank: p.speedRank || {}, lastPts: p.lastPts || 0 };
  }
  return { code: room.code, host: room.host, phase: room.phase, currentQ: room.currentQ, revealQ: room.revealQ,
    questions: (room.phase === 'lobby' || room.phase === 'generating') ? [] : room.questions, players };
}

// ─── WEBSOCKET ────────────────────────────────────────────────────────────────
wss.on('connection', (ws) => {
  let playerRoom = null;
  let playerId = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const { type, payload } = msg;

    if (type === 'CREATE_ROOM') {
      const code = genCode();
      const room = { code, host: payload.playerId, phase: 'lobby', currentQ: 0, questions: [],
        connections: new Map(), revealTimeout: null, correctOrder: {} };
      rooms[code] = room;
      playerRoom = code; playerId = payload.playerId;
      room.connections.set(ws, { id: payload.playerId, name: payload.name, score: 0, answers: {}, speedRank: {}, lastPts: 0 });
      ws.send(JSON.stringify({ type: 'ROOM_CREATED', payload: { code, room: getPublicRoom(room) } }));
    }

    else if (type === 'JOIN_ROOM') {
      const room = rooms[payload.code];
      if (!room) { ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Partie introuvable !' } })); return; }
      if (room.phase === 'final') { ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Partie déjà terminée.' } })); return; }
      playerRoom = payload.code; playerId = payload.playerId;
      room.connections.set(ws, { id: payload.playerId, name: payload.name, score: 0, answers: {}, speedRank: {}, lastPts: 0 });
      ws.send(JSON.stringify({ type: 'ROOM_JOINED', payload: { room: getPublicRoom(room) } }));
      broadcastAll(payload.code, { type: 'ROOM_UPDATE', payload: { room: getPublicRoom(room) } });
    }

    else if (type === 'START_GAME') {
      const room = rooms[playerRoom];
      if (!room || room.host !== playerId) return;
      room.phase = 'generating';
      broadcastAll(playerRoom, { type: 'ROOM_UPDATE', payload: { room: getPublicRoom(room) } });
    }

    else if (type === 'QUESTIONS_READY') {
      const room = rooms[playerRoom];
      if (!room || room.host !== playerId) return;
      room.questions = payload.questions;
      room.phase = 'countdown';
      broadcastAll(playerRoom, { type: 'ROOM_UPDATE', payload: { room: getPublicRoom(room) } });
      let n = 3;
      const iv = setInterval(() => {
        n--;
        if (n <= 0) {
          clearInterval(iv);
          room.phase = 'question'; room.currentQ = 0; room.correctOrder = {};
          broadcastAll(playerRoom, { type: 'ROOM_UPDATE', payload: { room: getPublicRoom(room) } });
          broadcastAll(playerRoom, { type: 'QUESTIONS_SYNC', payload: { questions: room.questions } });
          startQuestionTimer(room);
        }
      }, 1000);
    }

    else if (type === 'SUBMIT_ANSWER') {
      const room = rooms[playerRoom];
      if (!room || room.phase !== 'question') return;
      const player = room.connections.get(ws);
      if (!player) return;
      const qIdx = payload.qIdx;
      if (player.answers[qIdx] !== undefined) return;

      player.answers[qIdx] = payload.ansIdx;
      const q = room.questions[qIdx];
      const correct = payload.ansIdx === q.correct;

      let pts = 0;
      if (correct) {
        pts = 100; // base
        if (!room.correctOrder[qIdx]) room.correctOrder[qIdx] = 0;
        const rank = room.correctOrder[qIdx];
        if (rank < SPEED_BONUS.length) {
          pts += SPEED_BONUS[rank];
          player.speedRank[qIdx] = rank + 1; // 1 = premier, 2 = deuxième...
        }
        room.correctOrder[qIdx]++;
      }
      player.score += pts;
      player.lastPts = pts;

      broadcastAll(playerRoom, { type: 'ROOM_UPDATE', payload: { room: getPublicRoom(room) } });
      checkAllAnswered(room);
    }

    else if (type === 'LEAVE_ROOM') {
      handleLeave(ws, playerRoom, playerId); playerRoom = null; playerId = null;
    }

    else if (type === 'RESTART_GAME') {
      const room = rooms[playerRoom];
      if (!room || room.host !== playerId) return;
      for (const [, p] of room.connections) { p.score = 0; p.answers = {}; p.speedRank = {}; p.lastPts = 0; }
      room.phase = 'lobby'; room.questions = []; room.currentQ = 0; room.correctOrder = {};
      broadcastAll(playerRoom, { type: 'ROOM_UPDATE', payload: { room: getPublicRoom(room) } });
    }
  });

  ws.on('close', () => { handleLeave(ws, playerRoom, playerId); });
});

function startQuestionTimer(room) {
  if (room.revealTimeout) clearTimeout(room.revealTimeout);
  room.revealTimeout = setTimeout(() => {
    if (room.phase === 'question') triggerReveal(room);
  }, (ANSWER_TIME + 2) * 1000);
}

function checkAllAnswered(room) {
  const players = [...room.connections.values()];
  const allDone = players.every(p => p.answers[room.currentQ] !== undefined);
  if (allDone) triggerReveal(room);
}

function triggerReveal(room) {
  if (room.revealTimeout) { clearTimeout(room.revealTimeout); room.revealTimeout = null; }
  if (room.phase !== 'question') return;
  room.phase = 'reveal'; room.revealQ = room.currentQ;
  broadcastAll(room.code, { type: 'ROOM_UPDATE', payload: { room: getPublicRoom(room) } });
  setTimeout(() => {
    if (room.phase !== 'reveal') return;
    const nextQ = room.revealQ + 1;
    if (nextQ >= room.questions.length) {
      room.phase = 'final';
      broadcastAll(room.code, { type: 'ROOM_UPDATE', payload: { room: getPublicRoom(room) } });
      setTimeout(() => { delete rooms[room.code]; }, 30 * 60 * 1000);
    } else {
      room.phase = 'question'; room.currentQ = nextQ;
      broadcastAll(room.code, { type: 'ROOM_UPDATE', payload: { room: getPublicRoom(room) } });
      startQuestionTimer(room);
    }
  }, REVEAL_TIME * 1000);
}

function handleLeave(ws, roomCode) {
  if (!roomCode || !rooms[roomCode]) return;
  const room = rooms[roomCode];
  room.connections.delete(ws);
  if (room.connections.size === 0) { if (room.revealTimeout) clearTimeout(room.revealTimeout); delete rooms[roomCode]; }
  else broadcastAll(roomCode, { type: 'ROOM_UPDATE', payload: { room: getPublicRoom(room) } });
}

// ─── PROXY CLAUDE API ─────────────────────────────────────────────────────────
app.post('/api/claude', async (req, res) => {
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY non configurée' });
  const { prompt } = req.body;
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 3000, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!response.ok) throw new Error('Anthropic error ' + response.status);
    const data = await response.json();
    const text = data.content.map(b => b.text || '').join('');
    res.json(JSON.parse(text.replace(/```json|```/g, '').trim()));
  } catch (err) {
    console.error('Claude proxy error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (_, res) => res.json({ ok: true, rooms: Object.keys(rooms).length }));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ QuizArena démarré sur le port ${PORT}`));
