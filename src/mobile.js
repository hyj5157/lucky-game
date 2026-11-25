import {
  isSoundEnabled,
  playGrabStart,
  playLose,
  playMove,
  playTap,
  playWin,
  playYourTurn,
  setSoundEnabled,
  unlockAudio,
} from "./sound.js";

export function initMobileMode(wsClient, playerId) {
  const mobileView = document.getElementById("mobile-view");
  mobileView.classList.remove("hidden");

  const statusBadge = document.getElementById("mobile-status-badge");
  const btnSound = document.getElementById("btn-mobile-sound");

  const screens = {
    join: document.getElementById("m-screen-join"),
    queue: document.getElementById("m-screen-queue"),
    controller: document.getElementById("m-screen-controller"),
    grabbing: document.getElementById("m-screen-grabbing"),
    result: document.getElementById("m-screen-result"),
  };

  const inputNickname = document.getElementById("input-nickname");
  const btnJoinQueue = document.getElementById("btn-join-queue");
  const joinHint = document.getElementById("join-hint");

  const queueTitle = document.getElementById("queue-title");
  const queueDesc = document.getElementById("queue-desc");
  const queueNowPlaying = document.getElementById("queue-now-playing");

  const turnTimerEl = document.getElementById("turn-timer");
  const btnGrab = document.getElementById("btn-grab");

  const resultCard = document.getElementById("result-card");
  const resultEmoji = document.getElementById("result-emoji");
  const resultTitle = document.getElementById("result-title");
  const resultDesc = document.getElementById("result-desc");
  const resultTicket = document.getElementById("result-ticket");
  const resultTicketCode = document.getElementById("result-ticket-code");
  const btnPlayAgain = document.getElementById("btn-play-again");

  const savedNick = localStorage.getItem("hissam_nickname") || "";
  if (savedNick) inputNickname.value = savedNick;

  let currentScreen = "join";
  let clawX = 0.5;
  let clawY = 0.5;
  let expiresAt = 0;
  let countdownInterval = null;
  let holdInterval = null;
  let latestState = null;

  function showScreen(name) {
    currentScreen = name;
    for (const [k, el] of Object.entries(screens)) {
      el.classList.toggle("hidden", k !== name);
    }
    if (name !== "controller") {
      stopHold();
    }
  }

  function stopHold() {
    if (holdInterval) {
      clearInterval(holdInterval);
      holdInterval = null;
    }
  }

  function startCountdown() {
    if (countdownInterval) clearInterval(countdownInterval);
    countdownInterval = setInterval(() => {
      if (currentScreen !== "controller") {
        clearInterval(countdownInterval);
        return;
      }
      const left = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      turnTimerEl.textContent = `${left}초`;
    }, 250);
  }

  function moveClaw(dx, dy) {
    if (currentScreen !== "controller") return;
    clawX = Math.max(0.08, Math.min(0.92, clawX + dx));
    clawY = Math.max(0.1, Math.min(0.9, clawY + dy));
    playMove();
    wsClient.send({
      type: "claw_move",
      playerId,
      clawX,
      clawY,
    });
  }

  function bindDpadButton(id, dx, dy) {
    const btn = document.getElementById(id);
    const onDown = (e) => {
      e.preventDefault();
      unlockAudio();
      btn.classList.add("pressed");
      navigator.vibrate?.(12);
      moveClaw(dx, dy);
      stopHold();
      holdInterval = setInterval(() => moveClaw(dx, dy), 75);
    };
    const onUp = () => {
      btn.classList.remove("pressed");
      stopHold();
    };
    btn.addEventListener("pointerdown", onDown);
    btn.addEventListener("pointerup", onUp);
    btn.addEventListener("pointerleave", onUp);
    btn.addEventListener("pointercancel", onUp);
  }

  bindDpadButton("pad-left", -0.04, 0);
  bindDpadButton("pad-right", 0.04, 0);
  bindDpadButton("pad-up", 0, -0.05);
  bindDpadButton("pad-down", 0, 0.05);

  // Keyboard support for desktop testing
  window.addEventListener("keydown", (e) => {
    if (currentScreen !== "controller") return;
    if (e.key === "ArrowLeft") moveClaw(-0.04, 0);
    else if (e.key === "ArrowRight") moveClaw(0.04, 0);
    else if (e.key === "ArrowUp") moveClaw(0, -0.05);
    else if (e.key === "ArrowDown") moveClaw(0, 0.05);
    else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      triggerGrab();
    }
  });

  function triggerGrab() {
    if (currentScreen !== "controller") return;
    unlockAudio();
    playGrabStart();
    navigator.vibrate?.([25, 30, 25]);
    stopHold();
    wsClient.send({ type: "claw_grab", playerId });
    showScreen("grabbing");
  }

  btnGrab.addEventListener("click", triggerGrab);

  function joinQueue() {
    unlockAudio();
    playTap();
    const nickname = inputNickname.value.trim() || `참가자`;
    localStorage.setItem("hissam_nickname", nickname);
    wsClient.send({
      type: "player_join_queue",
      playerId,
      nickname,
    });
  }

  btnJoinQueue.addEventListener("click", joinQueue);
  btnPlayAgain.addEventListener("click", () => {
    showScreen("join");
    joinQueue();
  });

  btnSound.addEventListener("click", () => {
    unlockAudio();
    const next = !isSoundEnabled();
    setSoundEnabled(next);
    btnSound.textContent = next ? "🔊" : "🔇";
  });

  function showResult({ isWin, ticketCode }) {
    showScreen("result");
    resultCard.classList.toggle("win", isWin);
    if (isWin) {
      playWin();
      navigator.vibrate?.([60, 40, 80, 40, 120]);
      resultEmoji.textContent = "🎉";
      resultTitle.textContent = "축하합니다!";
      resultDesc.textContent = "hi-ssam 럭키 뽑기에 당첨되셨습니다!";
      resultTicket.classList.remove("hidden");
      resultTicketCode.textContent = ticketCode || "HS-WIN";
    } else {
      playLose();
      navigator.vibrate?.(40);
      resultEmoji.textContent = "💫";
      resultTitle.textContent = "아쉬워요!";
      resultDesc.textContent = "다음 기회에 다시 도전해보세요!";
      resultTicket.classList.add("hidden");
    }

    const canReplay = latestState && !latestState.config.onePerUser;
    btnPlayAgain.classList.toggle("hidden", !canReplay);
  }

  function handleStateUpdate(st) {
    if (!st) return;
    latestState = st;

    if (st.phase === "waiting") {
      statusBadge.textContent = "게임 준비 중";
      joinHint.textContent = "호스트가 게임을 시작하면 바로 참여할 수 있어요.";
      btnJoinQueue.disabled = false;
    } else {
      statusBadge.textContent = `남은 당첨 ${st.stats.remainingWinners}명`;
      joinHint.textContent = "지금 바로 뽑기에 도전할 수 있어요!";
      btnJoinQueue.disabled = false;
    }

    if (st.activePlayer?.playerId === playerId) {
      if (st.activePlayer.grabState === "aiming" && currentScreen !== "controller") {
        clawX = st.activePlayer.clawX;
        clawY = st.activePlayer.clawY;
        expiresAt = st.activePlayer.expiresAt;
        showScreen("controller");
        startCountdown();
      }
      return;
    }

    const qIdx = st.queue.findIndex((q) => q.playerId === playerId);
    if (qIdx >= 0) {
      showScreen("queue");
      queueTitle.textContent = qIdx === 0 ? "곧 내 차례입니다!" : `내 앞에 ${qIdx}명 대기 중`;
      queueDesc.textContent = "차례가 오면 자동으로 조정기가 열립니다.";
      queueNowPlaying.textContent = st.activePlayer
        ? `현재 조종 중: ${st.activePlayer.nickname}님`
        : "다음 차례 준비 중...";
    }
  }

  wsClient.onMessage((msg) => {
    if (msg.type === "init" || msg.type === "hello_ack" || msg.type === "state_update") {
      handleStateUpdate(msg.state);
      if (msg.type === "hello_ack" && msg.player?.hasWon && msg.state?.phase === "playing") {
        showResult({ isWin: true, ticketCode: msg.player.ticketCode });
      }
    } else if (msg.type === "round_started" || msg.type === "round_reset") {
      handleStateUpdate(msg.state);
      if (currentScreen !== "join") {
        showScreen("join");
      }
    } else if (msg.type === "your_turn") {
      unlockAudio();
      playYourTurn();
      navigator.vibrate?.([40, 30, 60]);
      clawX = 0.5;
      clawY = 0.5;
      expiresAt = msg.expiresAt || Date.now() + 30000;
      showScreen("controller");
      startCountdown();
    } else if (msg.type === "turn_timeout") {
      showScreen("join");
      joinHint.textContent = "⏰ 시간이 초과되어 다음 분에게 차례가 넘어갔어요. 다시 참여해주세요!";
    } else if (msg.type === "join_rejected") {
      if (msg.alreadyPlayed) {
        showResult({ isWin: Boolean(msg.hasWon), ticketCode: msg.ticketCode });
      } else {
        joinHint.textContent = msg.reason || "아직 참여할 수 없습니다.";
      }
    } else if (msg.type === "grab_finished") {
      handleStateUpdate(msg.state);
      if (msg.playerId === playerId) {
        showResult({ isWin: Boolean(msg.isWin), ticketCode: msg.ticketCode });
      }
    }
  });

  wsClient.send({
    type: "hello",
    role: "player",
    playerId,
    nickname: savedNick,
  });
}
