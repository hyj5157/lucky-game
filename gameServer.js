import os from "os";
import { WebSocketServer } from "ws";

export function getLocalIPv4s() {
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const info of list || []) {
      if (info.family === "IPv4" && !info.internal) {
        ips.push(info.address);
      }
    }
  }
  return ips;
}

export function attachShareEndpoint(middlewares, defaultPort = "5173") {
  if (!middlewares) return;
  middlewares.use("/api/share-info", (req, res) => {
    const hostHeader = req.headers.host || `localhost:${defaultPort}`;
    const port = hostHeader.includes(":") ? hostHeader.split(":")[1] : defaultPort;
    const ips = getLocalIPv4s();
    const urls = ips.map((ip) => `http://${ip}:${port}`);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ urls, primaryUrl: urls[0] || `http://${hostHeader}` }));
  });
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function generateTicketCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "HS-";
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function attachLuckyGrabWS(httpServer) {
  if (!httpServer || httpServer.__luckyGrabWssAttached) return;
  httpServer.__luckyGrabWssAttached = true;

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 1024 * 1024,
  });

  const clients = new Set();
  const wsMeta = new Map(); // ws -> { role, playerId, nickname }

  const state = {
    phase: "waiting", // "waiting" | "playing"
    config: {
      winnerCount: 3,
      totalSlots: 15,
      onePerUser: true,
    },
    deck: [],
    totalPlays: 0,
    winnersFound: 0,
    winners: [], // { playerId, nickname, ticketCode, timestamp }
    players: new Map(), // playerId -> { playerId, nickname, playsUsed, hasWon, ticketCode }
    queue: [], // { playerId, nickname }
    activePlayer: null, // { playerId, nickname, clawX, clawY, grabState, expiresAt }
  };

  let turnTimer = null;
  let grabTimer = null;
  const TURN_TIMEOUT_MS = 30000;
  const GRAB_ANIM_MS = 3800;

  function clearTurnTimer() {
    if (turnTimer) {
      clearTimeout(turnTimer);
      turnTimer = null;
    }
  }

  function clearGrabTimer() {
    if (grabTimer) {
      clearTimeout(grabTimer);
      grabTimer = null;
    }
  }

  function getConnectedPlayerCount() {
    let count = 0;
    for (const meta of wsMeta.values()) {
      if (meta.role === "player") count++;
    }
    return count;
  }

  function getPublicState() {
    const remainingWinners = Math.max(0, state.config.winnerCount - state.winnersFound);
    return {
      phase: state.phase,
      config: { ...state.config },
      stats: {
        connectedClients: clients.size,
        connectedPlayers: getConnectedPlayerCount(),
        totalPlays: state.totalPlays,
        winnersFound: state.winnersFound,
        remainingWinners,
        remainingSlots: state.deck.length,
        allWinnersFound: state.phase === "playing" && remainingWinners === 0,
      },
      winners: state.winners,
      queue: state.queue.map((q) => ({ playerId: q.playerId, nickname: q.nickname })),
      activePlayer: state.activePlayer
        ? {
            playerId: state.activePlayer.playerId,
            nickname: state.activePlayer.nickname,
            clawX: state.activePlayer.clawX,
            clawY: state.activePlayer.clawY,
            grabState: state.activePlayer.grabState,
            expiresAt: state.activePlayer.expiresAt,
          }
        : null,
    };
  }

  function broadcast(payload) {
    const raw = JSON.stringify(payload);
    for (const client of clients) {
      if (client.readyState === 1) {
        client.send(raw);
      }
    }
  }

  function sendToPlayer(playerId, payload) {
    const raw = JSON.stringify(payload);
    for (const [ws, meta] of wsMeta.entries()) {
      if (meta.playerId === playerId && ws.readyState === 1) {
        ws.send(raw);
      }
    }
  }

  function promoteNextInQueue() {
    clearTurnTimer();
    if (state.phase !== "playing" || state.activePlayer) return;

    while (state.queue.length > 0) {
      const next = state.queue.shift();
      // Check if player still has valid plays
      const p = state.players.get(next.playerId);
      if (state.config.onePerUser && p && p.playsUsed >= 1) {
        continue;
      }
      state.activePlayer = {
        playerId: next.playerId,
        nickname: next.nickname,
        clawX: 0.5,
        clawY: 0.5,
        grabState: "aiming",
        expiresAt: Date.now() + TURN_TIMEOUT_MS,
      };

      turnTimer = setTimeout(() => {
        if (state.activePlayer && state.activePlayer.grabState === "aiming") {
          const timedOutId = state.activePlayer.playerId;
          state.activePlayer = null;
          sendToPlayer(timedOutId, { type: "turn_timeout" });
          broadcast({ type: "state_update", state: getPublicState() });
          promoteNextInQueue();
        }
      }, TURN_TIMEOUT_MS);

      broadcast({ type: "state_update", state: getPublicState() });
      sendToPlayer(next.playerId, { type: "your_turn", expiresAt: state.activePlayer.expiresAt });
      return;
    }

    broadcast({ type: "state_update", state: getPublicState() });
  }

  function buildDeck(winnerCount, totalSlots) {
    const w = Math.max(1, Math.min(100, Math.floor(Number(winnerCount) || 1)));
    const t = Math.max(w, Math.min(500, Math.floor(Number(totalSlots) || w * 4)));
    const deck = [];
    for (let i = 0; i < w; i++) deck.push(true);
    for (let i = w; i < t; i++) deck.push(false);
    return shuffleArray(deck);
  }

  httpServer.on("upgrade", (req, socket, head) => {
    if (!req.url || !req.url.startsWith("/ws")) return;
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws) => {
    clients.add(ws);
    wsMeta.set(ws, { role: "unknown", playerId: null, nickname: "" });

    ws.send(JSON.stringify({ type: "init", state: getPublicState() }));

    ws.on("message", (buf) => {
      let msg;
      try {
        msg = JSON.parse(buf.toString());
      } catch {
        return;
      }

      if (msg.type === "hello") {
        const role = msg.role === "host" ? "host" : "player";
        const playerId = msg.playerId ? String(msg.playerId).slice(0, 64) : null;
        const nickname = String(msg.nickname || "").trim().slice(0, 16);
        wsMeta.set(ws, { role, playerId, nickname });

        let playerInfo = null;
        if (playerId) {
          if (!state.players.has(playerId)) {
            state.players.set(playerId, {
              playerId,
              nickname: nickname || `참가자`,
              playsUsed: 0,
              hasWon: false,
              ticketCode: null,
            });
          } else if (nickname) {
            state.players.get(playerId).nickname = nickname;
          }
          playerInfo = state.players.get(playerId);
        }

        ws.send(JSON.stringify({ type: "hello_ack", state: getPublicState(), player: playerInfo }));
        broadcast({ type: "state_update", state: getPublicState() });
      } else if (msg.type === "host_configure") {
        const w = Math.max(1, Math.min(100, Math.floor(Number(msg.winnerCount) || 1)));
        const t = Math.max(w, Math.min(500, Math.floor(Number(msg.totalSlots) || w)));
        const onePerUser = typeof msg.onePerUser === "boolean" ? msg.onePerUser : state.config.onePerUser;
        state.config = { winnerCount: w, totalSlots: t, onePerUser };
        broadcast({ type: "state_update", state: getPublicState() });
      } else if (msg.type === "host_start") {
        clearTurnTimer();
        clearGrabTimer();
        const w = Math.max(1, Math.min(100, Math.floor(Number(msg.winnerCount ?? state.config.winnerCount) || 1)));
        const t = Math.max(w, Math.min(500, Math.floor(Number(msg.totalSlots ?? state.config.totalSlots) || w)));
        const onePerUser = typeof msg.onePerUser === "boolean" ? msg.onePerUser : state.config.onePerUser;

        state.config = { winnerCount: w, totalSlots: t, onePerUser };
        state.deck = buildDeck(w, t);
        state.totalPlays = 0;
        state.winnersFound = 0;
        state.winners = [];
        state.queue = [];
        state.activePlayer = null;
        for (const p of state.players.values()) {
          p.playsUsed = 0;
          p.hasWon = false;
          p.ticketCode = null;
        }
        state.phase = "playing";
        broadcast({ type: "round_started", state: getPublicState() });
      } else if (msg.type === "host_reset") {
        clearTurnTimer();
        clearGrabTimer();
        state.phase = "waiting";
        state.deck = [];
        state.totalPlays = 0;
        state.winnersFound = 0;
        state.winners = [];
        state.queue = [];
        state.activePlayer = null;
        for (const p of state.players.values()) {
          p.playsUsed = 0;
          p.hasWon = false;
          p.ticketCode = null;
        }
        broadcast({ type: "round_reset", state: getPublicState() });
      } else if (msg.type === "host_skip_turn") {
        if (state.activePlayer && state.activePlayer.grabState === "aiming") {
          const skippedId = state.activePlayer.playerId;
          state.activePlayer = null;
          clearTurnTimer();
          sendToPlayer(skippedId, { type: "turn_timeout" });
          promoteNextInQueue();
        }
      } else if (msg.type === "player_join_queue") {
        const playerId = String(msg.playerId || "").slice(0, 64);
        const nickname = String(msg.nickname || "").trim().slice(0, 16) || "참가자";
        if (!playerId) return;

        if (state.phase !== "playing") {
          ws.send(JSON.stringify({ type: "join_rejected", reason: "호스트가 게임을 시작할 때까지 기다려주세요!" }));
          return;
        }

        let p = state.players.get(playerId);
        if (!p) {
          p = { playerId, nickname, playsUsed: 0, hasWon: false, ticketCode: null };
          state.players.set(playerId, p);
        } else {
          p.nickname = nickname;
        }

        if (state.config.onePerUser && p.playsUsed >= 1) {
          ws.send(
            JSON.stringify({
              type: "join_rejected",
              reason: "이미 이번 라운드에 참여하셨습니다!",
              alreadyPlayed: true,
              hasWon: p.hasWon,
              ticketCode: p.ticketCode,
            })
          );
          return;
        }

        if (state.activePlayer?.playerId === playerId) {
          ws.send(JSON.stringify({ type: "your_turn", expiresAt: state.activePlayer.expiresAt }));
          return;
        }

        if (!state.queue.some((q) => q.playerId === playerId)) {
          state.queue.push({ playerId, nickname });
        }

        if (!state.activePlayer) {
          promoteNextInQueue();
        } else {
          broadcast({ type: "state_update", state: getPublicState() });
        }
      } else if (msg.type === "claw_move") {
        const playerId = String(msg.playerId || "").slice(0, 64);
        if (!state.activePlayer || state.activePlayer.playerId !== playerId) return;
        if (state.activePlayer.grabState !== "aiming") return;

        const nextX = Math.max(0.08, Math.min(0.92, Number(msg.clawX ?? state.activePlayer.clawX)));
        const nextY = Math.max(0.1, Math.min(0.9, Number(msg.clawY ?? state.activePlayer.clawY)));
        state.activePlayer.clawX = nextX;
        state.activePlayer.clawY = nextY;

        broadcast({
          type: "claw_moved",
          playerId,
          clawX: nextX,
          clawY: nextY,
        });
      } else if (msg.type === "claw_grab") {
        const playerId = String(msg.playerId || "").slice(0, 64);
        if (!state.activePlayer || state.activePlayer.playerId !== playerId) return;
        if (state.activePlayer.grabState !== "aiming") return;

        clearTurnTimer();
        state.activePlayer.grabState = "grabbing";

        // Determine random result from shuffled deck
        const remainingWinners = Math.max(0, state.config.winnerCount - state.winnersFound);
        let isWin = false;
        if (remainingWinners > 0) {
          if (state.deck.length > 0) {
            isWin = Boolean(state.deck.pop());
          } else {
            // If more people play than expected totalSlots and winners remain, award remaining
            isWin = true;
          }
        }

        state.totalPlays += 1;
        let ticketCode = null;
        const p = state.players.get(playerId);
        if (p) {
          p.playsUsed += 1;
          if (isWin) {
            p.hasWon = true;
            ticketCode = generateTicketCode();
            p.ticketCode = ticketCode;
          }
        } else if (isWin) {
          ticketCode = generateTicketCode();
        }

        if (isWin) {
          state.winnersFound += 1;
          state.winners.push({
            playerId,
            nickname: state.activePlayer.nickname,
            ticketCode,
            timestamp: Date.now(),
          });
        }

        const grabPayload = {
          type: "grab_started",
          playerId,
          nickname: state.activePlayer.nickname,
          clawX: state.activePlayer.clawX,
          clawY: state.activePlayer.clawY,
          isWin,
          ticketCode,
        };
        broadcast(grabPayload);

        const finishedPlayerId = playerId;
        const finishedNickname = state.activePlayer.nickname;
        clearGrabTimer();
        grabTimer = setTimeout(() => {
          state.activePlayer = null;
          broadcast({
            type: "grab_finished",
            playerId: finishedPlayerId,
            nickname: finishedNickname,
            isWin,
            ticketCode,
            state: getPublicState(),
          });
          promoteNextInQueue();
        }, GRAB_ANIM_MS);
      }
    });

    ws.on("close", () => {
      const meta = wsMeta.get(ws);
      clients.delete(ws);
      wsMeta.delete(ws);
      if (meta?.playerId) {
        state.queue = state.queue.filter((q) => q.playerId !== meta.playerId);
      }
      broadcast({ type: "state_update", state: getPublicState() });
    });
  });
}
