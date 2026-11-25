import QRCode from "qrcode";
import {
  isSoundEnabled,
  playGrabBounce,
  playGrabStart,
  playLose,
  playStart,
  playTap,
  playWin,
  setSoundEnabled,
  unlockAudio,
} from "./sound.js";

const BALL_PALETTE = [
  { main: "#FF6B6B", light: "#FFA8A8", dark: "#C92A2A" }, // Coral Red
  { main: "#FFD93D", light: "#FFF3BF", dark: "#E67700" }, // Sunshine Yellow
  { main: "#38D9A9", light: "#96F2D7", dark: "#099268" }, // Mint
  { main: "#4DABF7", light: "#A5D8FF", dark: "#1864AB" }, // Sky Blue
  { main: "#9775FA", light: "#D0BFFF", dark: "#5F3DC4" }, // Lavender
  { main: "#FF922B", light: "#FFD8A8", dark: "#D9480F" }, // Tangerine
  { main: "#F06595", light: "#FCC2D7", dark: "#A61E4D" }, // Pink
];

export function initHostMode(wsClient) {
  const hostView = document.getElementById("host-view");
  hostView.classList.remove("hidden");

  const canvas = document.getElementById("gacha-canvas");
  const ctx = canvas.getContext("2d");

  const statusPill = document.getElementById("machine-status-pill");
  const screenBanner = document.getElementById("screen-banner");
  const statClients = document.getElementById("stat-clients");
  const statWinners = document.getElementById("stat-winners");
  const statPlays = document.getElementById("stat-plays");
  const statQueue = document.getElementById("stat-queue");

  const inputWinnerCount = document.getElementById("input-winner-count");
  const inputTotalSlots = document.getElementById("input-total-slots");
  const probBadge = document.getElementById("prob-badge");
  const chkOnePerUser = document.getElementById("chk-one-per-user");

  const btnStart = document.getElementById("btn-start-game");
  const btnReset = document.getElementById("btn-reset-game");
  const btnSkipTurn = document.getElementById("btn-skip-turn");
  const btnSound = document.getElementById("btn-sound");
  const btnFullscreen = document.getElementById("btn-fullscreen");
  const btnToggleKiosk = document.getElementById("btn-toggle-kiosk");
  const btnShowPanel = document.getElementById("btn-show-panel");
  const hostLayout = document.querySelector(".host-layout");
  const btnShowQr = document.getElementById("btn-show-qr");
  const btnCopyLink = document.getElementById("btn-copy-link");
  const btnOpenMobile = document.getElementById("btn-open-mobile");
  const winnersList = document.getElementById("winners-list");

  const qrModal = document.getElementById("qr-modal");
  const closeQrModal = document.getElementById("close-qr-modal");
  const machineQrCard = document.getElementById("machine-qr-card");
  const machineQrCanvas = document.getElementById("machine-qr-canvas");
  const largeQrCanvas = document.getElementById("large-qr-canvas");
  const qrLinkInput = document.getElementById("qr-link-input");
  const btnModalCopy = document.getElementById("btn-modal-copy");
  const hostShareLink = document.getElementById("host-share-link");
  const qrModalOpen = document.getElementById("qr-modal-open");

  let shareUrl = `${window.location.origin}/?mode=play`;
  let serverState = null;

  // Claw animation state
  const claw = {
    x: 0.5,
    targetX: 0.5,
    yDepth: 0.5,
    targetYDepth: 0.5,
    drop: 0, // 0 (top) to 1 (bottom)
    dropStart: 0,
    openAngle: 0.52, // radians
    phase: "idle", // "idle" | "dropping" | "closing" | "lifting" | "slipping" | "celebrating"
    phaseStart: 0,
    grabbedBall: null,
    isWin: false,
    nickname: "",
    ticketCode: "",
  };

  let balls = [];
  let confetti = [];
  let bannerTimer = null;
  let mixingUntil = 0;

  function showBanner(text, variant = "", duration = 3400) {
    if (bannerTimer) clearTimeout(bannerTimer);
    screenBanner.textContent = text;
    screenBanner.className = `screen-banner ${variant}`.trim();
    screenBanner.classList.remove("hidden");
    if (duration > 0) {
      bannerTimer = setTimeout(() => {
        screenBanner.classList.add("hidden");
      }, duration);
    }
  }

  function resizeCanvas() {
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(300, Math.floor(rect.width * dpr));
    canvas.height = Math.max(400, Math.floor(rect.height * dpr));
    initBallsIfNeeded();
  }

  function initBallsIfNeeded() {
    const w = canvas.width;
    const h = canvas.height;
    if (balls.length > 0) return;

    const rBase = Math.max(26, Math.min(54, w * 0.095));
    const count = 48;
    for (let i = 0; i < count; i++) {
      const palette = BALL_PALETTE[i % BALL_PALETTE.length];
      balls.push({
        id: i,
        x: rBase + Math.random() * Math.max(10, w - rBase * 2),
        y: h * 0.36 + Math.random() * (h * 0.56),
        vx: (Math.random() - 0.5) * 2.5,
        vy: 0,
        r: rBase * (0.94 + Math.random() * 0.12),
        palette,
        held: false,
      });
    }
  }

  function mixBalls(durationMs = 1700) {
    mixingUntil = performance.now() + durationMs;
    const w = canvas.width;
    for (const b of balls) {
      if (b.held) continue;
      const side = b.x < w * 0.5 ? 1 : -1;
      b.vx += side * (6 + Math.random() * 8) + (Math.random() - 0.5) * 6;
      b.vy -= 10 + Math.random() * 14;
    }
  }

  function spawnConfetti() {
    const w = canvas.width;
    const h = canvas.height;
    for (let i = 0; i < 85; i++) {
      const palette = BALL_PALETTE[i % BALL_PALETTE.length];
      confetti.push({
        x: w * 0.5 + (Math.random() - 0.5) * w * 0.4,
        y: h * 0.25 + (Math.random() - 0.5) * 40,
        vx: (Math.random() - 0.5) * 10,
        vy: -4 - Math.random() * 8,
        size: 6 + Math.random() * 7,
        color: palette.main,
        rot: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 0.25,
        life: 1,
      });
    }
  }

  function stepPhysics(now) {
    const w = canvas.width;
    const h = canvas.height;
    const floorY = h - 6;
    const isMixing = now < mixingUntil;

    for (const b of balls) {
      if (b.held) continue;
      if (isMixing) {
        // Upward air-blower swirl effect while mixing
        const cx = w * 0.5;
        const dx = b.x - cx;
        b.vy += b.y > h * 0.52 ? -0.95 : 0.42;
        b.vx += -dx * 0.004 + (Math.random() - 0.5) * 1.4;
      } else {
        b.vy += 0.48;
      }
      b.vx *= 0.965;
      b.vy *= 0.97;
      b.x += b.vx;
      b.y += b.vy;

      if (b.x - b.r < 4) {
        b.x = 4 + b.r;
        b.vx = Math.abs(b.vx) * 0.6;
      } else if (b.x + b.r > w - 4) {
        b.x = w - 4 - b.r;
        b.vx = -Math.abs(b.vx) * 0.6;
      }

      if (b.y - b.r < h * 0.16) {
        b.y = h * 0.16 + b.r;
        b.vy = Math.abs(b.vy) * 0.4;
      }

      if (b.y + b.r > floorY) {
        b.y = floorY - b.r;
        b.vy = -Math.abs(b.vy) * (isMixing ? 0.75 : 0.35);
        if (!isMixing && Math.abs(b.vy) < 0.4) b.vy = 0;
      }
    }

    // Circle-circle collision
    for (let i = 0; i < balls.length; i++) {
      const a = balls[i];
      if (a.held) continue;
      for (let j = i + 1; j < balls.length; j++) {
        const b = balls[j];
        if (b.held) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        const minDist = a.r + b.r;
        if (dist > 0.001 && dist < minDist) {
          const overlap = (minDist - dist) * 0.5;
          const nx = dx / dist;
          const ny = dy / dist;
          a.x -= nx * overlap;
          a.y -= ny * overlap;
          b.x += nx * overlap;
          b.y += ny * overlap;

          const relVx = b.vx - a.vx;
          const relVy = b.vy - a.vy;
          const sep = relVx * nx + relVy * ny;
          if (sep < 0) {
            const impulse = sep * 0.45;
            a.vx += nx * impulse;
            a.vy += ny * impulse;
            b.vx -= nx * impulse;
            b.vy -= ny * impulse;
          }
        }
      }
    }

    // Update confetti
    for (let i = confetti.length - 1; i >= 0; i--) {
      const c = confetti[i];
      c.vy += 0.25;
      c.x += c.vx;
      c.y += c.vy;
      c.rot += c.vRot;
      c.life -= 0.011;
      if (c.life <= 0 || c.y > h + 20) {
        confetti.splice(i, 1);
      }
    }
  }

  function updateClawAnimation(now) {
    claw.x += (claw.targetX - claw.x) * 0.16;
    claw.yDepth += (claw.targetYDepth - claw.yDepth) * 0.18;

    const w = canvas.width;
    const h = canvas.height;
    const railY = h * 0.07;
    const maxDropY = h * (0.44 + claw.yDepth * 0.22);
    const clawHeadX = claw.x * w;

    if (claw.phase === "idle") {
      const aimDrop = serverState?.activePlayer?.grabState === "aiming" ? claw.yDepth * 0.34 : 0;
      claw.drop += (aimDrop - claw.drop) * 0.18;
    } else if (claw.phase === "dropping") {
      const t = Math.min(1, (now - claw.phaseStart) / 900);
      claw.drop = claw.dropStart + (1 - claw.dropStart) * t;
      claw.openAngle = 0.58;
      if (t >= 1) {
        claw.phase = "closing";
        claw.phaseStart = now;
        playGrabBounce();

        // Find nearest ball to clawHeadX
        const grabY = railY + claw.drop * (maxDropY - railY) + 34;
        let best = null;
        let bestDist = Infinity;
        for (const b of balls) {
          const d = Math.hypot(b.x - clawHeadX, b.y - grabY);
          if (d < bestDist) {
            bestDist = d;
            best = b;
          }
          // Nudge nearby balls
          if (d < b.r * 3.2) {
            b.vx += (b.x - clawHeadX) * 0.09;
            b.vy -= 2.5;
          }
        }
        if (best) {
          best.held = true;
          claw.grabbedBall = best;
        }
      }
    } else if (claw.phase === "closing") {
      const t = Math.min(1, (now - claw.phaseStart) / 360);
      claw.openAngle = 0.58 - t * 0.4;
      if (t >= 1) {
        claw.phase = "lifting";
        claw.phaseStart = now;
      }
    } else if (claw.phase === "lifting") {
      const t = Math.min(1, (now - claw.phaseStart) / 1100);
      claw.drop = 1 - t;
      claw.openAngle = 0.18;

      if (t >= 1) {
        claw.phase = "celebrating";
        claw.phaseStart = now;
        if (claw.isWin) {
          playWin();
          spawnConfetti();
          showBanner(`🎉 축하합니다! ${claw.nickname}님 당첨! (${claw.ticketCode})`, "win", 4200);
        } else {
          playLose();
          showBanner(`💫 아쉬워요! ${claw.nickname}님 다음 기회에~`, "lose", 2600);
        }
      }
    } else if (claw.phase === "celebrating") {
      const holdDuration = claw.isWin ? 1100 : 750;
      const t = (now - claw.phaseStart) / holdDuration;
      if (t >= 1) {
        if (claw.grabbedBall) {
          claw.grabbedBall.held = false;
          claw.grabbedBall.y = h * 0.28;
          claw.grabbedBall.vy = 2;
          claw.grabbedBall = null;
        }
        claw.phase = "idle";
        claw.openAngle = 0.52;
      }
    }

    if (claw.grabbedBall && claw.grabbedBall.held) {
      const headY = railY + claw.drop * (maxDropY - railY);
      claw.grabbedBall.x = clawHeadX;
      claw.grabbedBall.y = headY + 42;
    }
  }

  function drawBall(b, isGolden = false) {
    const grad = ctx.createRadialGradient(
      b.x - b.r * 0.32,
      b.y - b.r * 0.32,
      b.r * 0.1,
      b.x,
      b.y,
      b.r
    );
    if (isGolden) {
      grad.addColorStop(0, "#FFF9DB");
      grad.addColorStop(0.5, "#FFD93D");
      grad.addColorStop(1, "#F08C00");
    } else {
      grad.addColorStop(0, b.palette.light);
      grad.addColorStop(0.55, b.palette.main);
      grad.addColorStop(1, b.palette.dark);
    }

    ctx.save();
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.shadowColor = isGolden ? "rgba(255, 217, 61, 0.8)" : "rgba(0, 15, 60, 0.28)";
    ctx.shadowBlur = isGolden ? 20 : 8;
    ctx.shadowOffsetY = 4;
    ctx.fill();

    // Specular highlight
    ctx.shadowColor = "transparent";
    ctx.beginPath();
    ctx.ellipse(b.x - b.r * 0.32, b.y - b.r * 0.32, b.r * 0.24, b.r * 0.14, -0.6, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 255, 255, 0.65)";
    ctx.fill();

    if (b.label) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
      ctx.font = `900 ${Math.max(8, Math.round(b.r * 0.34))}px Outfit, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(b.label, b.x, b.y + 1);
    }
    ctx.restore();
  }

  function drawClaw() {
    const w = canvas.width;
    const h = canvas.height;
    const railY = h * 0.07;
    const maxDropY = h * (0.44 + claw.yDepth * 0.22);
    const cx = claw.x * w;
    const cy = railY + claw.drop * (maxDropY - railY);

    ctx.save();

    // Top Rail
    ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
    ctx.fillRect(16, railY - 6, w - 32, 8);

    // Trolley
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.roundRect(cx - 26, railY - 14, 52, 22, 10);
    ctx.fill();

    // Cable
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx, railY + 8);
    ctx.lineTo(cx, cy);
    ctx.stroke();

    // Claw Hub
    ctx.fillStyle = "#FFD93D";
    ctx.beginPath();
    ctx.arc(cx, cy, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3;
    ctx.stroke();

    // Left & Right Prongs
    const armLen = 36;
    const tipLen = 24;
    [-1, 1].forEach((dir) => {
      const angle = dir * claw.openAngle;
      const elbowX = cx + Math.sin(angle) * armLen;
      const elbowY = cy + Math.cos(angle) * armLen;
      const tipX = elbowX - dir * 14;
      const tipY = elbowY + tipLen;

      ctx.strokeStyle = "#f8fafc";
      ctx.lineWidth = 7;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(cx, cy + 4);
      ctx.lineTo(elbowX, elbowY);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();
    });

    ctx.restore();
  }

  function renderFrame(now) {
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Subtle background glow circles
    const bgGrad = ctx.createRadialGradient(w * 0.5, h * 0.25, 20, w * 0.5, h * 0.35, w * 0.75);
    bgGrad.addColorStop(0, "rgba(255, 255, 255, 0.18)");
    bgGrad.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    stepPhysics(now);
    updateClawAnimation(now);

    for (const b of balls) {
      if (!b.held) drawBall(b, false);
    }
    if (claw.grabbedBall && claw.grabbedBall.held) {
      drawBall(claw.grabbedBall, claw.isWin);
    }

    drawClaw();

    // Draw confetti
    for (const c of confetti) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, c.life);
      ctx.translate(c.x, c.y);
      ctx.rotate(c.rot);
      ctx.fillStyle = c.color;
      ctx.fillRect(-c.size / 2, -c.size / 2, c.size, c.size * 0.6);
      ctx.restore();
    }

    requestAnimationFrame(renderFrame);
  }

  function updateProbabilityBadge() {
    const w = Math.max(1, Number(inputWinnerCount.value) || 1);
    const t = Math.max(w, Number(inputTotalSlots.value) || w);
    const pct = Math.round((w / t) * 100);
    probBadge.textContent = `${pct}% (${t}명 중 ${w}명)`;
  }

  function syncConfigToServer() {
    const w = Math.max(1, Math.min(100, Number(inputWinnerCount.value) || 1));
    const t = Math.max(w, Math.min(500, Number(inputTotalSlots.value) || w));
    inputWinnerCount.value = w;
    inputTotalSlots.value = t;
    updateProbabilityBadge();
    wsClient.send({
      type: "host_configure",
      winnerCount: w,
      totalSlots: t,
      onePerUser: chkOnePerUser.checked,
    });
  }

  function renderServerState(st) {
    if (!st) return;
    serverState = st;

    statClients.textContent = `${st.stats.connectedPlayers}명`;
    statWinners.textContent = `${st.stats.remainingWinners} / ${st.config.winnerCount}명`;
    statPlays.textContent = `${st.stats.totalPlays}회`;
    statQueue.textContent = `${st.queue.length}명`;

    if (st.phase === "waiting") {
      statusPill.textContent = "게임 준비 중";
      statusPill.className = "machine-status-pill waiting";
      btnStart.textContent = "🚀 게임 시작!";
      btnSkipTurn.classList.add("hidden");
    } else if (st.activePlayer) {
      statusPill.textContent = `🕹️ ${st.activePlayer.nickname}님 조종 중`;
      statusPill.className = "machine-status-pill active";
      btnStart.textContent = "🔄 새 라운드 시작";
      btnSkipTurn.classList.remove("hidden");
    } else if (st.stats.allWinnersFound) {
      statusPill.textContent = "🎉 모든 당첨자 탄생!";
      statusPill.className = "machine-status-pill playing";
      btnStart.textContent = "🔄 새 라운드 시작";
      btnSkipTurn.classList.add("hidden");
    } else {
      statusPill.textContent = "참여자 대기 중 (QR 스캔)";
      statusPill.className = "machine-status-pill playing";
      btnStart.textContent = "🔄 새 라운드 시작";
      btnSkipTurn.classList.add("hidden");
    }

    if (st.winners.length === 0) {
      winnersList.innerHTML = `<li class="empty-msg">아직 당첨자가 없습니다.</li>`;
    } else {
      winnersList.innerHTML = st.winners
        .map(
          (w, idx) =>
            `<li><span>${idx + 1}. ${escapeHtml(w.nickname)}</span><span class="winner-ticket">${escapeHtml(
              w.ticketCode
            )}</span></li>`
        )
        .join("");
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  async function renderQRCodes() {
    try {
      const res = await fetch("/api/share-info");
      if (res.ok) {
        const data = await res.json();
        if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
          if (data.primaryUrl) {
            shareUrl = `${data.primaryUrl}/?mode=play`;
          }
        } else {
          shareUrl = `${window.location.origin}/?mode=play`;
        }
      }
    } catch {
      shareUrl = `${window.location.origin}/?mode=play`;
    }

    qrLinkInput.value = shareUrl;
    hostShareLink.href = shareUrl;
    hostShareLink.textContent = shareUrl;
    btnOpenMobile.href = shareUrl;
    qrModalOpen.href = shareUrl;
    await QRCode.toCanvas(machineQrCanvas, shareUrl, {
      width: 108,
      margin: 1,
      color: { dark: "#0f172a", light: "#ffffff" },
    });
    await QRCode.toCanvas(largeQrCanvas, shareUrl, {
      width: 240,
      margin: 2,
      color: { dark: "#0f172a", light: "#ffffff" },
    });
  }

  // Event bindings
  document.getElementById("btn-winner-minus").addEventListener("click", () => {
    inputWinnerCount.value = Math.max(1, Number(inputWinnerCount.value) - 1);
    syncConfigToServer();
  });
  document.getElementById("btn-winner-plus").addEventListener("click", () => {
    inputWinnerCount.value = Math.min(100, Number(inputWinnerCount.value) + 1);
    if (Number(inputTotalSlots.value) < Number(inputWinnerCount.value)) {
      inputTotalSlots.value = inputWinnerCount.value;
    }
    syncConfigToServer();
  });
  document.getElementById("btn-slots-minus").addEventListener("click", () => {
    inputTotalSlots.value = Math.max(Number(inputWinnerCount.value), Number(inputTotalSlots.value) - 1);
    syncConfigToServer();
  });
  document.getElementById("btn-slots-plus").addEventListener("click", () => {
    inputTotalSlots.value = Math.min(500, Number(inputTotalSlots.value) + 1);
    syncConfigToServer();
  });
  inputWinnerCount.addEventListener("change", syncConfigToServer);
  inputTotalSlots.addEventListener("change", syncConfigToServer);
  chkOnePerUser.addEventListener("change", syncConfigToServer);

  btnStart.addEventListener("click", () => {
    unlockAudio();
    playStart();
    const w = Math.max(1, Math.min(100, Number(inputWinnerCount.value) || 1));
    const t = Math.max(w, Math.min(500, Number(inputTotalSlots.value) || w));
    wsClient.send({
      type: "host_start",
      winnerCount: w,
      totalSlots: t,
      onePerUser: chkOnePerUser.checked,
    });
    showBanner(`🎮 게임 시작! (당첨 ${w}명 / 랜덤 뽑기)`, "", 2600);
  });

  btnReset.addEventListener("click", () => {
    playTap();
    wsClient.send({ type: "host_reset" });
    showBanner("🔄 라운드가 초기화되었습니다.", "", 2000);
  });

  btnSkipTurn.addEventListener("click", () => {
    playTap();
    wsClient.send({ type: "host_skip_turn" });
  });

  btnSound.addEventListener("click", () => {
    unlockAudio();
    const next = !isSoundEnabled();
    setSoundEnabled(next);
    btnSound.textContent = next ? "🔊" : "🔇";
  });

  btnFullscreen.addEventListener("click", () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  });

  const setKioskOnly = (kioskOnly) => {
    hostLayout.classList.toggle("kiosk-only", kioskOnly);
    btnShowPanel.classList.toggle("hidden", !kioskOnly);
    requestAnimationFrame(resizeCanvas);
  };
  btnToggleKiosk.addEventListener("click", () => {
    playTap();
    setKioskOnly(true);
  });
  btnShowPanel.addEventListener("click", () => {
    playTap();
    setKioskOnly(false);
  });

  const openQr = () => {
    playTap();
    qrModal.classList.remove("hidden");
  };
  btnShowQr.addEventListener("click", openQr);
  machineQrCard.addEventListener("click", openQr);
  closeQrModal.addEventListener("click", () => qrModal.classList.add("hidden"));
  qrModal.addEventListener("click", (e) => {
    if (e.target === qrModal) qrModal.classList.add("hidden");
  });

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      playTap();
      showBanner("🔗 참여 링크가 복사되었습니다!", "", 2000);
    } catch {
      qrLinkInput.select();
      document.execCommand("copy");
    }
  };
  btnCopyLink.addEventListener("click", copyLink);
  btnModalCopy.addEventListener("click", copyLink);

  wsClient.onMessage((msg) => {
    if (msg.type === "init" || msg.type === "hello_ack" || msg.type === "state_update" || msg.type === "round_started" || msg.type === "round_reset") {
      renderServerState(msg.state);
      if (msg.type === "round_started") {
        mixBalls(1800);
      }
      if (msg.state?.activePlayer && claw.phase === "idle") {
        claw.targetX = msg.state.activePlayer.clawX;
        claw.targetYDepth = msg.state.activePlayer.clawY;
      }
    } else if (msg.type === "claw_moved") {
      claw.targetX = msg.clawX;
      claw.targetYDepth = msg.clawY;
    } else if (msg.type === "grab_started") {
      unlockAudio();
      playGrabStart();
      mixingUntil = 0;
      for (const b of balls) {
        if (!b.held) {
          b.vx = 0;
          b.vy = 0;
        }
      }
      claw.targetX = msg.clawX;
      claw.x = msg.clawX;
      claw.targetYDepth = msg.clawY;
      claw.yDepth = msg.clawY;
      claw.dropStart = claw.drop;
      claw.isWin = Boolean(msg.isWin);
      claw.nickname = msg.nickname || "참가자";
      claw.ticketCode = msg.ticketCode || "";
      claw.phase = "dropping";
      claw.phaseStart = performance.now();
    } else if (msg.type === "grab_finished") {
      renderServerState(msg.state);
    }
  });

  wsClient.send({ type: "hello", role: "host" });
  updateProbabilityBadge();
  renderQRCodes();
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => resizeCanvas()).observe(canvas.parentElement);
  }
  requestAnimationFrame(renderFrame);
}
