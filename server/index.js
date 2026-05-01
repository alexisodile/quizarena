const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ─── IN-MEMORY STATE ──────────────────────────────────────────────────────────
const rooms = {}; // roomCode -> room object

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function broadcast(roomCode, payload, excludeWs = null) {
  const room = rooms[roomCode];
  if (!room) return;
  const msg = JSON.stringify(payload);
  for (const [ws, player] of room.connections) {
    if (ws !== excludeWs && ws.readyState === 1) {
      ws.send(msg);
    }
  }
}

function broadcastAll(roomCode, payload) {
  broadcast(roomCode, payload, null);
}

function getPublicRoom(room) {
  const players = {};
  for (const [, p] of room.connections) {
    players[p.id] = { name: p.name, score: p.score, answers: p.answers };
  }
  return {
    code: room.code,
    host: room.host,
    phase: room.phase,
    currentQ: room.currentQ,
    questions: room.phase === 'lobby' || room.phase === 'generating' ? [] : room.questions,
    players,
  };
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
      const room = {
        code,
        host: payload.playerId,
        phase: 'lobby',
        currentQ: 0,
        questions: [],
        connections: new Map(),
        revealTimeout: null,
      };
      rooms[code] = room;
      playerRoom = code;
      playerId = payload.playerId;
      room.connections.set(ws, {
        id: payload.playerId,
        name: payload.name,
        score: 0,
        answers: {},
      });
      ws.send(JSON.stringify({ type: 'ROOM_CREATED', payload: { code, room: getPublicRoom(room) } }));
    }

    else if (type === 'JOIN_ROOM') {
      const room = rooms[payload.code];
      if (!room) { ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Partie introuvable !' } })); return; }
      if (room.phase === 'final') { ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Cette partie est déjà terminée.' } })); return; }
      playerRoom = payload.code;
      playerId = payload.playerId;
      room.connections.set(ws, {
        id: payload.playerId,
        name: payload.name,
        score: 0,
        answers: {},
      });
      ws.send(JSON.stringify({ type: 'ROOM_JOINED', payload: { room: getPublicRoom(room) } }));
      broadcastAll(payload.code, { type: 'ROOM_UPDATE', payload: { room: getPublicRoom(room) } });
    }

    else if (type === 'START_GAME') {
      const room = rooms[playerRoom];
      if (!room || room.host !== playerId) return;
      room.phase = 'generating';
      broadcastAll(playerRoom, { type: 'ROOM_UPDATE', payload: { room: getPublicRoom(room) } });

      // Questions arrive from client (host calls Claude API)
      // Host sends QUESTIONS_READY when done
    }

    else if (type === 'QUESTIONS_READY') {
      const room = rooms[playerRoom];
      if (!room || room.host !== playerId) return;
      room.questions = payload.questions;
      room.phase = 'countdown';
      broadcastAll(playerRoom, { type: 'ROOM_UPDATE', payload: { room: getPublicRoom(room) } });

      // Start countdown, then question
      let n = 3;
      const iv = setInterval(() => {
        n--;
        if (n <= 0) {
          clearInterval(iv);
          room.phase = 'question';
          room.currentQ = 0;
          // Send questions now
          broadcastAll(playerRoom, { type: 'ROOM_UPDATE', payload: { room: getPublicRoom(room) } });
          // Also send full questions to all
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
      if (player.answers[qIdx] !== undefined) return; // already answered

      player.answers[qIdx] = payload.ansIdx;
      const q = room.questions[qIdx];
      const correct = payload.ansIdx === q.correct;
      const timeLeft = payload.timeLeft || 0;
      const pts = correct ? Math.max(100, Math.round(100 + timeLeft * 20)) : 0;
      player.score += pts;

      broadcastAll(playerRoom, { type: 'ROOM_UPDATE', payload: { room: getPublicRoom(room) } });
      checkAllAnswered(room);
    }

    else if (type === 'LEAVE_ROOM') {
      handleLeave(ws, playerRoom, playerId);
      playerRoom = null;
      playerId = null;
    }

    else if (type === 'RESTART_GAME') {
      const room = rooms[playerRoom];
      if (!room || room.host !== playerId) return;
      for (const [, p] of room.connections) {
        p.score = 0;
        p.answers = {};
      }
      room.phase = 'lobby';
      room.questions = [];
      room.currentQ = 0;
      broadcastAll(playerRoom, { type: 'ROOM_UPDATE', payload: { room: getPublicRoom(room) } });
    }
  });

  ws.on('close', () => {
    handleLeave(ws, playerRoom, playerId);
  });
});

function startQuestionTimer(room) {
  // Server-side timer — after 22s force reveal if not all answered
  if (room.revealTimeout) clearTimeout(room.revealTimeout);
  room.revealTimeout = setTimeout(() => {
    if (room.phase === 'question') {
      triggerReveal(room);
    }
  }, 22000);
}

function checkAllAnswered(room) {
  const players = [...room.connections.values()];
  const qIdx = room.currentQ;
  const allDone = players.every(p => p.answers[qIdx] !== undefined);
  if (allDone) triggerReveal(room);
}

function triggerReveal(room) {
  if (room.revealTimeout) { clearTimeout(room.revealTimeout); room.revealTimeout = null; }
  if (room.phase !== 'question') return;
  room.phase = 'reveal';
  room.revealQ = room.currentQ;
  broadcastAll(room.code, { type: 'ROOM_UPDATE', payload: { room: getPublicRoom(room) } });

  // Auto-advance after REVEAL_TIME
  setTimeout(() => {
    if (room.phase !== 'reveal') return;
    const nextQ = room.revealQ + 1;
    if (nextQ >= room.questions.length) {
      room.phase = 'final';
      broadcastAll(room.code, { type: 'ROOM_UPDATE', payload: { room: getPublicRoom(room) } });
      // Auto-cleanup room after 30 min
      setTimeout(() => { delete rooms[room.code]; }, 30 * 60 * 1000);
    } else {
      room.phase = 'question';
      room.currentQ = nextQ;
      broadcastAll(room.code, { type: 'ROOM_UPDATE', payload: { room: getPublicRoom(room) } });
      startQuestionTimer(room);
    }
  }, 6000);
}

function handleLeave(ws, roomCode, pid) {
  if (!roomCode || !rooms[roomCode]) return;
  const room = rooms[roomCode];
  room.connections.delete(ws);
  if (room.connections.size === 0) {
    if (room.revealTimeout) clearTimeout(room.revealTimeout);
    delete rooms[roomCode];
  } else {
    broadcastAll(roomCode, { type: 'ROOM_UPDATE', payload: { room: getPublicRoom(room) } });
  }
}

// ─── PROXY CLAUDE API ─────────────────────────────────────────────────────────
app.post('/api/claude', async (req, res) => {
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY non configurée dans .env' });
  }
  const { prompt } = req.body;
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 3000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!response.ok) throw new Error('Anthropic error ' + response.status);
    const data = await response.json();
    const text = data.content.map(b => b.text || '').join('');
    const clean = text.replace(/```json|```/g, '').trim();
    res.json(JSON.parse(clean));
  } catch (err) {
    console.error('Claude proxy error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── REST (health check) ──────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ ok: true, rooms: Object.keys(rooms).length }));

// ─── START ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ QuizArena server running on port ${PORT}`));
