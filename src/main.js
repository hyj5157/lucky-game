import { initHostMode } from "./host.js";
import { initMobileMode } from "./mobile.js";

function getPlayerId() {
  const key = "hissam_gacha_player_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = `p_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
    localStorage.setItem(key, id);
  }
  return id;
}

function createWSClient() {
  const listeners = new Set();
  const pendingQueue = [];
  let ws = null;

  function connect() {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${window.location.host}/ws`;
    ws = new WebSocket(url);

    ws.addEventListener("open", () => {
      while (pendingQueue.length > 0 && ws.readyState === WebSocket.OPEN) {
        ws.send(pendingQueue.shift());
      }
    });

    ws.addEventListener("message", (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      for (const fn of listeners) fn(msg);
    });

    ws.addEventListener("close", () => {
      setTimeout(connect, 1500);
    });
  }

  connect();

  return {
    send(payload) {
      const raw = JSON.stringify(payload);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(raw);
      } else {
        pendingQueue.push(raw);
      }
    },
    onMessage(fn) {
      listeners.add(fn);
    },
  };
}

const params = new URLSearchParams(window.location.search);
const modeParam = params.get("mode");
const pathName = window.location.pathname.replace(/\/+$/, "");
const isHostPath = pathName === "/host" || modeParam === "host";
const isPlayPath = pathName === "/play" || modeParam === "play" || modeParam === "draw";
const isMobileDevice = window.innerWidth < 768 && !isHostPath;
const isPlayMode = isPlayPath || isMobileDevice;

const wsClient = createWSClient();
const playerId = getPlayerId();

if (isPlayMode) {
  initMobileMode(wsClient, playerId);
} else {
  initHostMode(wsClient);
}
