// Mindi Kot Client Application
// Redesigned: Dedicated Seat Drop Zones, SVG Turn Rings, Winning Star & Live HUD

// Determine socket connection target:
const urlParams = new URLSearchParams(window.location.search);
const queryServer = urlParams.get('server') || urlParams.get('host');
if (queryServer) {
  localStorage.setItem('mindi_server_url', queryServer);
}
const customServerUrl = queryServer || localStorage.getItem('mindi_server_url');

let socket;
if (customServerUrl && window.location.hostname.includes('netlify.app')) {
  socket = io(customServerUrl, { transports: ['websocket', 'polling'] });
} else {
  socket = io();
}

socket.on('connect', () => {
  console.log('Connected to Mindi Kot server:', socket.id);
});
socket.on('connect_error', (err) => {
  console.warn('Socket connection error:', err.message);
});

// State
let myPlayerId = null;
let mySeatIndex = null;
let myTeam = null;
let currentRoomCode = null;
let currentMaxPlayers = 6;
let selectedSuitFilter = 'ALL';
let selectedCardId = null;
let currentHandCards = [];
let isMyActiveTurn = false;
let previousTurnId = null;
let currentRemainingSeconds = 30;
let currentHukum = null;

// Unlock Audio on first user interaction anywhere
window.addEventListener('click', () => sounds.init(), { once: true });
window.addEventListener('touchstart', () => sounds.init(), { once: true });

let sessionToken = localStorage.getItem('mindi_session_token');
if (!sessionToken) {
  sessionToken = 'sess_' + Math.random().toString(36).substring(2, 12);
  localStorage.setItem('mindi_session_token', sessionToken);
}

// Suit symbols & colors
const SUIT_ICONS = {
  S: '♠',
  H: '♥',
  D: '♦',
  C: '♣'
};
const SUIT_CLASSES = {
  S: 'black',
  H: 'red',
  D: 'red',
  C: 'black'
};
const RANK_VALUES = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
  '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14
};

// --- WI-FI / HOTSPOT DISCOVERY & QR CODE ---
let currentHotspotUrl = window.location.origin;

function initHotspotInfo() {
  const urlDisplay = document.getElementById('hotspot-url-display');
  const btnCopy = document.getElementById('btn-copy-hotspot-url');
  const btnShowQr = document.getElementById('btn-show-qr');
  const qrModal = document.getElementById('qr-modal');
  const btnCloseQr = document.getElementById('btn-close-qr');
  const qrModalUrl = document.getElementById('qr-modal-url');
  const btnCopyModal = document.getElementById('btn-copy-modal-url');
  const qrContainer = document.getElementById('qrcode-container');

  // Fetch host IP from backend API
  fetch('/api/network-info')
    .then((r) => r.json())
    .then((data) => {
      if (data && data.hotspotUrl) {
        currentHotspotUrl = data.hotspotUrl;
        if (urlDisplay) urlDisplay.textContent = currentHotspotUrl;
        if (qrModalUrl) qrModalUrl.textContent = currentHotspotUrl;
      }
    })
    .catch(() => {
      if (urlDisplay) urlDisplay.textContent = window.location.origin;
      if (qrModalUrl) qrModalUrl.textContent = window.location.origin;
    });

  if (btnCopy) {
    btnCopy.onclick = () => {
      navigator.clipboard.writeText(currentHotspotUrl).then(() => {
        showToast('📋 Hotspot Link Copied!');
      }).catch(() => fallbackCopyText(currentHotspotUrl));
    };
  }

  if (btnShowQr) {
    btnShowQr.onclick = () => {
      if (!qrModal) return;
      qrModal.classList.remove('hidden');
      if (qrModalUrl) qrModalUrl.textContent = currentHotspotUrl;

      if (qrContainer && typeof QRCode !== 'undefined') {
        qrContainer.innerHTML = '';
        new QRCode(qrContainer, {
          text: currentHotspotUrl,
          width: 170,
          height: 170,
          colorDark: '#04101e',
          colorLight: '#ffffff',
          correctLevel: QRCode.CorrectLevel.M
        });
      }
    };
  }

  if (btnCloseQr) {
    btnCloseQr.onclick = () => {
      if (qrModal) qrModal.classList.add('hidden');
    };
  }

  if (btnCopyModal) {
    btnCopyModal.onclick = () => {
      navigator.clipboard.writeText(currentHotspotUrl).then(() => {
        showToast('📋 Link Copied!');
      }).catch(() => fallbackCopyText(currentHotspotUrl));
    };
  }
}

// Initialize Hotspot URL detection immediately
initHotspotInfo();

// DOM Elements
const lobbyScreen = document.getElementById('lobby-screen');
const gameScreen = document.getElementById('game-screen');
const roundModal = document.getElementById('round-modal');
const btnThrowSelected = document.getElementById('btn-throw-selected');

// --- FULLSCREEN & ORIENTATION CONTROLS ---
function triggerFullscreen() {
  sounds.init();
  const doc = document.documentElement;
  if (doc.requestFullscreen) {
    doc.requestFullscreen().catch(() => {});
  } else if (doc.webkitRequestFullscreen) {
    doc.webkitRequestFullscreen();
  }

  // Lock to landscape if supported
  if (screen.orientation && screen.orientation.lock) {
    screen.orientation.lock('landscape').catch(() => {});
  }
}

document.getElementById('btn-force-landscape').addEventListener('click', () => {
  triggerFullscreen();
});

document.getElementById('btn-bypass-rotate')?.addEventListener('click', () => {
  document.body.classList.add('bypass-rotate');
  sounds.init();
});

document.getElementById('btn-toggle-fullscreen').addEventListener('click', () => {
  if (!document.fullscreenElement) {
    triggerFullscreen();
  } else {
    document.exitFullscreen().catch(() => {});
  }
});

// Sound Toggle
let isMuted = false;
document.getElementById('btn-toggle-sound').addEventListener('click', (e) => {
  isMuted = !isMuted;
  sounds.isMuted = isMuted;
  e.currentTarget.innerHTML = isMuted
    ? '<i class="fa-solid fa-volume-xmark"></i>'
    : '<i class="fa-solid fa-volume-high"></i>';
});

// --- LOBBY TABS ---
const tabBtnCreate = document.getElementById('tab-btn-create');
const tabBtnJoin = document.getElementById('tab-btn-join');
const createPanel = document.getElementById('create-room-panel');
const joinPanel = document.getElementById('join-room-panel');

tabBtnCreate.addEventListener('click', () => {
  tabBtnCreate.classList.add('active');
  tabBtnJoin.classList.remove('active');
  createPanel.classList.add('active');
  joinPanel.classList.remove('active');
});

tabBtnJoin.addEventListener('click', () => {
  tabBtnJoin.classList.add('active');
  tabBtnCreate.classList.remove('active');
  joinPanel.classList.add('active');
  createPanel.classList.remove('active');
});

// --- CREATE ROOM ---
document.getElementById('btn-create-room').addEventListener('click', () => {
  triggerFullscreen();
  const playerName = document.getElementById('host-player-name').value.trim() || 'Captain';
  const mode = document.getElementById('game-mode-select').value;
  const teamAName = document.getElementById('team-a-name').value.trim() || 'Lions';
  const teamBName = document.getElementById('team-b-name').value.trim() || 'Tigers';

  socket.emit(
    'create_room',
    { playerName, mode, teamAName, teamBName, sessionToken },
    (res) => {
      if (res.success) {
        currentRoomCode = res.roomCode;
        myPlayerId = res.lobby.players[0].id;
        showLobbyWaiting(res.lobby);
      } else {
        alert(res.error || 'Failed to create room.');
      }
    }
  );
});

// --- JOIN ROOM ---
document.getElementById('btn-join-room').addEventListener('click', () => {
  triggerFullscreen();
  const playerName = document.getElementById('join-player-name').value.trim() || 'Player';
  const roomCode = document.getElementById('join-room-code').value.trim().toUpperCase();

  if (!roomCode || roomCode.length < 4) {
    alert('Please enter a valid 4-digit Room Code.');
    return;
  }

  socket.emit(
    'join_room',
    { roomCode, playerName, sessionToken },
    (res) => {
      if (res.success) {
        currentRoomCode = res.roomCode;
        myPlayerId = res.playerId;
        showLobbyWaiting(res.lobby);
      } else {
        alert(res.error || 'Failed to join room.');
      }
    }
  );
});

// --- COPY ROOM CODE ---
document.getElementById('btn-copy-code').addEventListener('click', () => {
  if (currentRoomCode) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(currentRoomCode).then(() => {
        showToast(`Room Code ${currentRoomCode} copied!`);
      }).catch(() => {
        fallbackCopyText(currentRoomCode);
      });
    } else {
      fallbackCopyText(currentRoomCode);
    }
  }
});

function fallbackCopyText(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand('copy');
    showToast(`Room Code ${text} copied!`);
  } catch (e) {
    showToast(`Room Code: ${text}`);
  }
  document.body.removeChild(textarea);
}

// --- FILL BOTS ---
document.getElementById('btn-fill-bots').addEventListener('click', () => {
  if (currentRoomCode) {
    socket.emit('fill_bots', { roomCode: currentRoomCode });
  }
});

// --- START GAME ---
document.getElementById('btn-start-game').addEventListener('click', () => {
  if (currentRoomCode) {
    socket.emit('start_game', { roomCode: currentRoomCode }, (res) => {
      if (!res.success) alert(res.error);
    });
  }
});

// --- SHOW LOBBY WAITING SCREEN ---
function showLobbyWaiting(lobby) {
  document.getElementById('lobby-auth-section').classList.add('hidden');
  document.getElementById('lobby-waiting-section').classList.remove('hidden');

  document.getElementById('display-room-code').textContent = lobby.code;
  document.getElementById('player-count').textContent = lobby.players.length;
  document.getElementById('max-player-count').textContent = lobby.maxPlayers;

  renderSeatsGrid(lobby);

  const startBtn = document.getElementById('btn-start-game');
  startBtn.disabled = !lobby.isReadyToStart;
}

function renderSeatsGrid(lobby) {
  const seatsGrid = document.getElementById('seats-grid');
  seatsGrid.innerHTML = '';
  seatsGrid.className = `seats-grid seats-${lobby.maxPlayers}`;

  for (let s = 0; s < lobby.maxPlayers; s++) {
    const player = lobby.players.find((p) => p.seatIndex === s);
    const teamClass = s % 2 === 0 ? 'team-a' : 'team-b';
    const teamLabel = s % 2 === 0 ? lobby.teamAName : lobby.teamBName;

    const badge = document.createElement('div');
    badge.className = `seat-badge ${teamClass}`;

    if (player) {
      badge.innerHTML = `
        <div class="seat-num">Seat ${s + 1} (${teamLabel})</div>
        <div class="player-name">${player.name}</div>
      `;
    } else {
      badge.innerHTML = `
        <div class="seat-num">Seat ${s + 1} (${teamLabel})</div>
        <div class="player-name" style="color: #7f8c8d; font-style: italic;">Empty</div>
      `;
    }
    seatsGrid.appendChild(badge);
  }
}

// --- SUIT FILTER TABS ---
document.querySelectorAll('.suit-filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.suit-filter-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    selectedSuitFilter = btn.dataset.suit;
    renderFilteredHand();
  });
});

// --- THROW SELECTED CARD BUTTON ---
btnThrowSelected.addEventListener('click', () => {
  if (selectedCardId) {
    playSelectedCard(selectedCardId);
  }
});

// --- SOCKET EVENTS ---
socket.on('lobby_update', (lobby) => {
  showLobbyWaiting(lobby);
});

let currentActivePlayerName = 'Waiting...';

socket.on('game_started', (data) => {
  lobbyScreen.classList.remove('active');
  gameScreen.classList.add('active');
  roundModal.classList.add('hidden');
  isDealingInProgress = false;

  currentMaxPlayers = data.maxPlayers || 6;
  document.getElementById('hdr-team-a-name').textContent = data.teamAName;
  document.getElementById('hdr-team-b-name').textContent = data.teamBName;

  initCenterDeckStage();
  sounds.playCardSnap();
});

socket.on('deck_shuffled', (data) => {
  sounds.playShuffle();
  const deckClickable = document.getElementById('deck-3d-clickable');
  if (deckClickable) {
    deckClickable.classList.add('is-shuffling');
    setTimeout(() => {
      deckClickable.classList.remove('is-shuffling');
    }, 750);
  }
  const countVal = document.getElementById('shuffle-count-val');
  if (countVal) countVal.textContent = data.shuffleCount;
  showToast(`🔀 Ket Shuffled (${data.shuffleCount}x)!`);
});

socket.on('dealing_started', (data) => {
  startDealingSequence(data);
});

socket.on('game_state_update', (state) => {
  myPlayerId = state.myPlayerId || myPlayerId;
  mySeatIndex = state.mySeatIndex !== undefined ? state.mySeatIndex : mySeatIndex;
  myTeam = state.myTeam || myTeam;
  currentMaxPlayers = state.maxPlayers || currentMaxPlayers;
  currentActivePlayerName = state.activePlayerName || 'Waiting...';

  // Auto-switch to game screen if reconnecting to an active game
  if (!gameScreen.classList.contains('active')) {
    lobbyScreen.classList.remove('active');
    gameScreen.classList.add('active');
  }

  // Turn Notification Sound (Ding!) when turn switches to you
  if (state.activePlayerId === myPlayerId && previousTurnId !== myPlayerId) {
    sounds.playTurnAlert();
  }
  previousTurnId = state.activePlayerId;

  updateGameUI(state);
});

socket.on('card_thrown', (data) => {
  sounds.playCardSnap();
  if (data.hukumJustRevealed) {
    sounds.playHukumReveal();
    showHukumSplash(data.hukum, data.hukumName);
  }
});

socket.on('trick_finished', (data) => {
  const winner = data.winner;
  const isLast = data.isLastTrick;

  if (isLast) {
    showToast(`⭐ ${winner.playerName} took the Final Hath!`);
  } else {
    showToast(`⭐ ${winner.playerName} took the Hath!`);
  }

  if (data.mindisContained && data.mindisContained.length > 0) {
    sounds.playMindiChime();
    showToast(`✨ ${data.mindisContained.length} MINDI CAPTURED! ✨`);
  }

  // Keep cards visible on the table!
  // In the last trick (last baari), keep cards visible for 3 full seconds as requested!
  const sweepDelay = isLast ? 3000 : 1400;

  setTimeout(() => {
    animateTrickSweepToWinner(winner.playerIndex);
  }, sweepDelay);
});

socket.on('trick_cleared', () => {
  const arena = document.getElementById('radial-trick-arena');
  if (arena) arena.innerHTML = '';
  const leadIndicator = document.getElementById('lead-suit-indicator');
  if (leadIndicator) leadIndicator.classList.add('hidden');
});

socket.on('round_finished', (data) => {
  sounds.playVictory();
  showRoundModal(data.roundSummary);
});

socket.on('turn_timer_tick', (data) => {
  currentRemainingSeconds = data.seconds;
  updateSvgTimerRing(data.seconds);
  updateTurnStatusText();
});

// Update Circular SVG Timer Ring on Active Seat (Both Table and Player Dock)
function updateSvgTimerRing(seconds) {
  const rings = document.querySelectorAll('.active-turn .timer-progress');
  if (!rings.length) return;

  const circumference = 132;
  const offset = circumference - (seconds / 30) * circumference;
  rings.forEach((ring) => {
    ring.style.strokeDashoffset = offset;

    if (seconds > 15) {
      ring.style.stroke = '#00e5ff'; // Cyan
    } else if (seconds > 6) {
      ring.style.stroke = '#f1c40f'; // Yellow
    } else {
      ring.style.stroke = '#e74c3c'; // Red
    }
  });
}

// Live Countdown & Status Text in Player Dock
function updateTurnStatusText() {
  const turnStatus = document.getElementById('turn-status-text');
  if (!turnStatus) return;

  if (isMyActiveTurn) {
    turnStatus.textContent = selectedCardId
      ? '👉 Card Selected! Tap card again or THROW to play'
      : `👉 YOUR TURN (${currentRemainingSeconds}s)! Tap a legal card`;
    turnStatus.style.color = '#00e5ff';
  } else {
    turnStatus.textContent = `Turn: ${currentActivePlayerName || 'Waiting...'}`;
    turnStatus.style.color = '#bdc3c7';
    btnThrowSelected.classList.add('hidden');
    selectedCardId = null;
  }
}

// Dramatic Hukum Reveal Banner
function showHukumSplash(hukumSuit, hukumName) {
  const splash = document.getElementById('hukum-splash');
  const suitEl = document.getElementById('hukum-splash-suit');
  const descEl = document.getElementById('hukum-splash-desc');
  if (!splash || !suitEl) return;

  suitEl.textContent = `${SUIT_ICONS[hukumSuit] || ''} ${hukumName || ''}`;
  suitEl.style.color = SUIT_CLASSES[hukumSuit] === 'red' ? '#e74c3c' : '#f5b041';
  if (descEl) descEl.textContent = `Trump Cut Declared!`;

  splash.classList.remove('hidden');
  setTimeout(() => {
    splash.classList.add('hidden');
  }, 2200);
}

// Smooth Trick Sweep to Winner
function animateTrickSweepToWinner(winnerSeatIndex) {
  let relPos = winnerSeatIndex;
  if (mySeatIndex !== null && currentMaxPlayers) {
    relPos = (winnerSeatIndex - mySeatIndex + currentMaxPlayers) % currentMaxPlayers;
  }

  const cards = document.querySelectorAll('#radial-trick-arena .radial-card-slot');
  cards.forEach((slot) => {
    slot.className = `radial-card-slot sweeping-to-seat-${relPos}`;
  });
}

// --- 3D DECK (KET) SHUFFLE & DEAL ANIMATION STAGE ---
let isDealingInProgress = false;
let pendingGameState = null;
let centerDeckInitialized = false;

function initCenterDeckStage() {
  if (centerDeckInitialized) return;
  centerDeckInitialized = true;

  const btnShuffle = document.getElementById('btn-shuffle-deck');
  const btnDeal = document.getElementById('btn-deal-deck');
  const deckClickable = document.getElementById('deck-3d-clickable');

  if (btnShuffle) {
    btnShuffle.onclick = (e) => {
      e.stopPropagation();
      sounds.playShuffle();
      if (deckClickable) {
        deckClickable.classList.add('is-shuffling');
        setTimeout(() => deckClickable.classList.remove('is-shuffling'), 750);
      }
      if (currentRoomCode) {
        socket.emit('shuffle_deck', { roomCode: currentRoomCode });
      }
    };
  }

  const handleCutKet = (e) => {
    e.stopPropagation();
    sounds.playCardSnap();
    if (currentRoomCode) {
      socket.emit('cut_and_deal', { roomCode: currentRoomCode, playerId: myPlayerId });
    }
  };

  if (deckClickable) deckClickable.onclick = handleCutKet;
  if (btnDeal) btnDeal.onclick = handleCutKet;
}

function showCenterDeckStage(state) {
  pendingGameState = state;
  initCenterDeckStage();

  const deckStage = document.getElementById('center-deck-stage');
  const trickArena = document.getElementById('radial-trick-arena');
  const countVal = document.getElementById('shuffle-count-val');
  const instructionText = document.getElementById('deck-instruction-text');
  const sideControls = deckStage ? deckStage.querySelector('.deck-side-controls') : null;

  if (!deckStage) return;
  deckStage.classList.remove('hidden');
  if (sideControls) sideControls.style.display = 'flex';

  if (trickArena) trickArena.classList.add('hidden');
  if (countVal) countVal.textContent = state.shuffleCount || 0;
  if (instructionText) {
    instructionText.innerHTML = '<i class="fa-solid fa-hand-pointer"></i> Ket par click karein baari lene ke liye!';
  }

  // Clear dock cards while Ket is active on table
  const dockCards = document.getElementById('dock-hand-cards');
  if (dockCards) dockCards.innerHTML = '';
}

function startDealingSequence(data) {
  if (isDealingInProgress) return;
  isDealingInProgress = true;

  const deckStage = document.getElementById('center-deck-stage');
  const instructionText = document.getElementById('deck-instruction-text');
  const sideControls = deckStage ? deckStage.querySelector('.deck-side-controls') : null;

  if (sideControls) sideControls.style.display = 'none';
  if (instructionText) {
    instructionText.innerHTML = `✨ <strong>${data.firstPlayerName || 'Player'}</strong> ne Ket Cut ki! First Turn mila! ✨`;
  }

  showToast(`🎯 ${data.firstPlayerName || 'Player'} got the 1st turn!`);

  const maxPlayers = data.maxPlayers || currentMaxPlayers || 6;
  const firstTurnIndex = data.firstTurnIndex !== undefined ? data.firstTurnIndex : 0;

  // Animate dealing cards one by one in circular order
  animateDealingCards(maxPlayers, firstTurnIndex, () => {
    if (deckStage) deckStage.classList.add('hidden');
    if (sideControls) sideControls.style.display = 'flex';
    const trickArena = document.getElementById('radial-trick-arena');
    if (trickArena) trickArena.classList.remove('hidden');

    isDealingInProgress = false;

    // Render player hand now that deal is complete!
    if (pendingGameState) {
      renderFilteredHand();
      updateTurnStatusText();

      if (pendingGameState.activePlayerId === myPlayerId) {
        sounds.playTurnAlert();
      }
    }
  });
}

function animateDealingCards(maxPlayers, firstTurnIndex, onComplete) {
  const layer = document.getElementById('dealing-cards-layer');
  if (!layer) {
    if (onComplete) onComplete();
    return;
  }
  layer.innerHTML = '';

  const coords6 = [
    { x: 0, y: 160 },    // Seat 0 (Me - Dock)
    { x: -160, y: 70 },  // Seat 1
    { x: -130, y: -80 }, // Seat 2
    { x: 0, y: -110 },   // Seat 3
    { x: 130, y: -80 },  // Seat 4
    { x: 160, y: 70 }    // Seat 5
  ];

  const coords4 = [
    { x: 0, y: 160 },    // Seat 0 (Me)
    { x: -160, y: 0 },   // Seat 1
    { x: -70, y: -100 }, // Seat 2
    { x: 160, y: 0 }     // Seat 3
  ];

  const coords = maxPlayers === 4 ? coords4 : coords6;

  // Sequential circular card deal starting with firstTurnIndex
  // Wave 1: First batch
  for (let step = 0; step < maxPlayers; step++) {
    const seatIdx = (firstTurnIndex + step) % maxPlayers;
    const targetCoord = coords[seatIdx] || coords[0];

    setTimeout(() => {
      spawnFlyingDealCard(targetCoord.x, targetCoord.y);
      sounds.playCardDeal();
    }, step * 70);
  }

  // Wave 2: Second batch
  const wave2Delay = maxPlayers * 70 + 150;
  setTimeout(() => {
    for (let step = 0; step < maxPlayers; step++) {
      const seatIdx = (firstTurnIndex + step) % maxPlayers;
      const targetCoord = coords[seatIdx] || coords[0];

      setTimeout(() => {
        spawnFlyingDealCard(targetCoord.x, targetCoord.y);
        sounds.playCardDeal();
      }, step * 70);
    }
  }, wave2Delay);

  // Complete after animations settle
  const totalDuration = wave2Delay + (maxPlayers * 70) + 400;
  setTimeout(() => {
    layer.innerHTML = '';
    if (onComplete) onComplete();
  }, totalDuration);
}

function spawnFlyingDealCard(destX, destY) {
  const layer = document.getElementById('dealing-cards-layer');
  if (!layer) return;

  const card = document.createElement('div');
  card.className = 'flying-deal-card';
  card.style.transform = 'translate(0, 0) scale(0.6) rotate(0deg)';
  card.style.opacity = '1';
  layer.appendChild(card);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const rot = (Math.random() - 0.5) * 40;
      card.style.transform = `translate(${destX}px, ${destY}px) scale(0.9) rotate(${rot}deg)`;
      card.style.opacity = '0';
    });
  });

  setTimeout(() => {
    card.remove();
  }, 480);
}

// --- UPDATE GAME UI ---
function updateGameUI(state) {
  currentHukum = state.hukum || null;
  pendingGameState = state;

  const deckStage = document.getElementById('center-deck-stage');
  const trickArena = document.getElementById('radial-trick-arena');

  if (state.isDealingPhase) {
    showCenterDeckStage(state);
  } else if (!isDealingInProgress) {
    if (deckStage && !deckStage.classList.contains('hidden')) {
      deckStage.classList.add('hidden');
    }
    if (trickArena && trickArena.classList.contains('hidden')) {
      trickArena.classList.remove('hidden');
    }
  }

  // 1. Team Scores, Hath & Mindis in Top Glass Capsule
  const teamANameEl = document.getElementById('hdr-team-a-name');
  if (teamANameEl) teamANameEl.textContent = state.teamAName || 'Cyan';
  const teamBNameEl = document.getElementById('hdr-team-b-name');
  if (teamBNameEl) teamBNameEl.textContent = state.teamBName || 'Amber';

  document.getElementById('hdr-team-a-pts').textContent = `${state.matchPoints.teamA}/5`;
  document.getElementById('hdr-team-b-pts').textContent = `${state.matchPoints.teamB}/5`;
  document.getElementById('hdr-team-a-hath').textContent = state.tricksWon.teamA;
  document.getElementById('hdr-team-b-hath').textContent = state.tricksWon.teamB;

  document.getElementById('hdr-team-a-mindis-count').textContent = state.mindisWon.teamA.length;
  document.getElementById('hdr-team-b-mindis-count').textContent = state.mindisWon.teamB.length;

  const roomCodeTag = document.getElementById('hud-room-code-tag');
  if (roomCodeTag) roomCodeTag.textContent = currentRoomCode || '----';

  const roundNumPill = document.getElementById('round-num-pill');
  if (roundNumPill) roundNumPill.textContent = `R${state.roundNumber}`;

  const currentTrickNum = document.getElementById('current-trick-num');
  if (currentTrickNum) currentTrickNum.textContent = state.tricksWon.teamA + state.tricksWon.teamB + 1;

  const totalTricksNum = document.getElementById('total-tricks-num');
  if (totalTricksNum) totalTricksNum.textContent = state.maxPlayers === 6 ? 17 : 13;

  // 2. Hukum Badge
  const hukumBadge = document.getElementById('hukum-badge');
  const hukumText = document.getElementById('hukum-text');
  const cleanSuitNames = { S: 'SPADES', H: 'HEARTS', D: 'DIAMONDS', C: 'CLUBS' };
  if (state.hukum) {
    hukumBadge.className = 'hukum-badge revealed';
    const suitName = cleanSuitNames[state.hukum] || state.hukum;
    const suitColor = SUIT_CLASSES[state.hukum] === 'red' ? '#ff4d4d' : '#00e5ff';
    hukumText.innerHTML = `HUKUM: <strong style="color: ${suitColor};">${SUIT_ICONS[state.hukum]} ${suitName}</strong>`;
  } else {
    hukumBadge.className = 'hukum-badge unrevealed';
    hukumText.textContent = 'HUKUM: CLOSED';
  }

  // 3. Render Top HUD Mindis
  renderHudMindis('team-a-mindi-cards', state.mindisWon.teamA);
  renderHudMindis('team-b-mindi-cards', state.mindisWon.teamB);

  // 4. Render Table Rim Seats with Alternating Team Colors & Turn Timers
  renderTableSeats(state);

  // 5. Render Center Radial Trick Arena (Cards in Circular Ring with Player Name Pills)
  renderRadialTrickArena(state.currentTrick, state.currentLeadSuit, state.hukum, state.maxPlayers);

  // 6. Update Hand & Counts
  isMyActiveTurn = state.activePlayerId === myPlayerId;
  currentActivePlayerName = state.activePlayerName || 'Waiting...';
  currentHandCards = state.myHand || [];
  updateSuitCounts(currentHandCards);

  // Render hand cards only if dealing phase has completed
  if (!state.isDealingPhase && !isDealingInProgress) {
    renderFilteredHand();
    updateTurnStatusText();
  }
}

// Render Top HUD Mindis
function renderHudMindis(containerId, mindisList) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';

  mindisList.forEach((card) => {
    const badge = document.createElement('span');
    const colorClass = SUIT_CLASSES[card.suit];
    badge.className = `mindi-mini-pill ${colorClass}`;
    badge.textContent = `10${SUIT_ICONS[card.suit]}`;
    badge.title = `Won by ${card.wonByPlayer || 'Team'}`;
    container.appendChild(badge);
  });
}

// Render Table Rim Seats (Other Players Outside Rim, Local Player in Bottom Dock Left of Cards)
function renderTableSeats(state) {
  const seatsContainer = document.getElementById('table-seats');
  const myDockSeat = document.getElementById('my-player-dock-seat');

  if (seatsContainer) {
    seatsContainer.innerHTML = '';
    seatsContainer.className = `table-seats seats-${state.maxPlayers}`;
  }
  if (myDockSeat) {
    myDockSeat.innerHTML = '';
  }

  state.players.forEach((player) => {
    let relativeSeat = player.seatIndex;
    if (mySeatIndex !== null) {
      relativeSeat = (player.seatIndex - mySeatIndex + state.maxPlayers) % state.maxPlayers;
    }

    const isTurn = state.currentTurnIndex === player.seatIndex;
    const teamClass = (player.team === 'teamB' || player.seatIndex % 2 === 1) ? 'team-b' : 'team-a';
    const isMe = (mySeatIndex !== null && player.seatIndex === mySeatIndex) || (player.id === myPlayerId);
    const isDealer = state.dealerIndex === player.seatIndex;
    const teamLabel = teamClass === 'team-a' ? (state.teamAName || 'Cyan') : (state.teamBName || 'Amber');

    // Clean name without broken emoji surrogate pair
    const cleanName = player.name.replace(/^[🤖\s]+/, '').trim() || 'Player';
    const avatarInitial = cleanName.charAt(0).toUpperCase();
    const botIcon = player.isBot ? '<i class="fa-solid fa-robot" style="font-size: 0.58rem; opacity: 0.75; margin-right: 3px;"></i>' : '';

    if (isMe) {
      // Local User: Rendered exclusively in player dock on the left of cards
      if (myDockSeat) {
        myDockSeat.style.display = 'flex';
        myDockSeat.className = `my-dock-seat ${teamClass} ${isTurn ? 'active-turn' : ''}`;
        myDockSeat.innerHTML = `
          <div class="my-dock-avatar-wrap">
            <svg class="timer-ring-svg" viewBox="0 0 48 48">
              <circle class="timer-track" cx="24" cy="24" r="21" />
              <circle class="timer-progress" id="timer-ring-me" cx="24" cy="24" r="21" />
            </svg>
            <div class="seat-avatar">
              ${avatarInitial}
            </div>
            ${isDealer ? '<span class="dealer-tag" title="Dealer">D</span>' : ''}
          </div>
          <div class="my-dock-info">
            <div class="my-dock-name" title="${player.name}">${cleanName} <span class="you-tag-inline">(YOU)</span></div>
            <div class="my-dock-meta">
              <span class="my-dock-team ${teamClass}">${teamLabel}</span>
              <span class="seat-chips-pill"><i class="fa-solid fa-coins"></i> ${player.cardsCount * 100}</span>
            </div>
          </div>
        `;
      }
    } else {
      // Other Players: Positioned outside the table perimeter
      if (seatsContainer) {
        const seatEl = document.createElement('div');
        seatEl.className = `player-seat seat-pos-${relativeSeat} ${teamClass} ${isTurn ? 'active-turn' : ''}`;
        seatEl.innerHTML = `
          <div class="seat-avatar-wrap">
            <svg class="timer-ring-svg" viewBox="0 0 48 48">
              <circle class="timer-track" cx="24" cy="24" r="21" />
              <circle class="timer-progress" id="timer-ring-${player.seatIndex}" cx="24" cy="24" r="21" />
            </svg>
            <div class="seat-avatar">
              ${avatarInitial}
            </div>
            ${isTurn ? '<span class="active-pulse-badge">ACTIVE</span>' : ''}
            ${isDealer ? '<span class="dealer-tag" title="Dealer">D</span>' : ''}
          </div>
          <div class="seat-name-label">${botIcon}${cleanName}</div>
          <div class="seat-chips-pill"><i class="fa-solid fa-coins"></i> ${player.cardsCount * 100}</div>
        `;
        seatsContainer.appendChild(seatEl);
      }
    }
  });
}

// Helper: Render Rich Casino Playing Card Inner HTML (Real Pips, Royal Court Art, Grand Ace, Star Mindi, Trump Crown)
function renderCardInnerHtml(card, isHukum = false) {
  const isMindi = card.isMindi || card.rank === '10';
  const isAce = card.rank === 'A';
  const rank = card.rank;
  const suitIcon = SUIT_ICONS[card.suit];
  const num = parseInt(rank, 10);

  let centerArtContent = '';
  if (rank === 'K') {
    centerArtContent = `
      <div class="card-court-art king" title="King">
        <div class="court-icon-box"><i class="fa-solid fa-crown"></i></div>
        <span class="court-suit-tag">${suitIcon}</span>
      </div>`;
  } else if (rank === 'Q') {
    centerArtContent = `
      <div class="card-court-art queen" title="Queen">
        <div class="court-icon-box"><i class="fa-solid fa-chess-queen"></i></div>
        <span class="court-suit-tag">${suitIcon}</span>
      </div>`;
  } else if (rank === 'J') {
    centerArtContent = `
      <div class="card-court-art jack" title="Jack">
        <div class="court-icon-box"><i class="fa-solid fa-shield-halved"></i></div>
        <span class="court-suit-tag">${suitIcon}</span>
      </div>`;
  } else if (isAce) {
    centerArtContent = `
      <div class="card-ace-art" title="Ace">
        ${card.suit === 'S' ? '<i class="fa-solid fa-crown ace-spade-crown"></i>' : ''}
        <span class="ace-main-suit">${suitIcon}</span>
      </div>`;
  } else if (!isNaN(num) && num >= 2 && num <= 6) {
    // Generate authentic playing card pips layout for 2-6
    const pipsHtml = Array.from({ length: num }, () => `<span class="pip">${suitIcon}</span>`).join('');
    centerArtContent = `<div class="card-pips-pattern pips-${num}">${pipsHtml}</div>`;
  } else if (!isNaN(num) && num >= 7 && num <= 10) {
    // Clean, crisp centered emblem for 7-10 (never cramped or overflowing)
    centerArtContent = `
      <div class="card-number-art">
        <span class="number-suit-main">${suitIcon}</span>
      </div>`;
  } else {
    centerArtContent = `<div class="card-center-suit">${suitIcon}</div>`;
  }

  const mindiBadge = isMindi
    ? `<div class="card-mindi-badge"><i class="fa-solid fa-star"></i> MINDI</div>`
    : '';

  const hukumCrown = isHukum
    ? `<div class="card-hukum-crown" title="Hukum (Trump)"><i class="fa-solid fa-crown"></i></div>`
    : '';

  return `
    <div class="card-inner-frame"></div>
    <div class="card-corner top-corner">
      <span class="card-rank">${rank}</span>
      <span class="card-suit">${suitIcon}</span>
    </div>
    ${hukumCrown}
    <div class="card-center-art">
      ${centerArtContent}
    </div>
    ${mindiBadge}
    <div class="card-corner bottom-corner">
      <span class="card-rank">${rank}</span>
      <span class="card-suit">${suitIcon}</span>
    </div>
  `;
}

// Render Center Radial Trick Arena (Cards in Circular Ring with Player Name Pills)
function renderRadialTrickArena(trickCards, leadSuit, hukum, maxPlayers) {
  const arena = document.getElementById('radial-trick-arena');
  if (!arena) return;
  arena.innerHTML = '';
  arena.className = `radial-trick-arena seats-${maxPlayers}`;

  const leadIndicator = document.getElementById('lead-suit-indicator');
  const leadChar = document.getElementById('lead-suit-char');
  if (leadSuit) {
    leadIndicator.classList.remove('hidden');
    leadChar.textContent = SUIT_ICONS[leadSuit];
    leadChar.style.color = SUIT_CLASSES[leadSuit] === 'red' ? '#e74c3c' : '#00e5ff';
  } else {
    leadIndicator.classList.add('hidden');
  }

  if (!trickCards || trickCards.length === 0) {
    return;
  }

  // Find currently highest card in the trick (later played duplicate wins)
  let winningEntry = null;
  for (const entry of trickCards) {
    if (!winningEntry) {
      winningEntry = entry;
      continue;
    }

    const card = entry.card;
    const winCard = winningEntry.card;

    if (hukum && card.suit === hukum) {
      if (winCard.suit !== hukum) {
        winningEntry = entry;
      } else if (RANK_VALUES[card.rank] >= RANK_VALUES[winCard.rank]) {
        winningEntry = entry;
      }
    } else if (hukum && winCard.suit === hukum) {
      continue;
    } else if (card.suit === leadSuit) {
      if (winCard.suit !== leadSuit) {
        winningEntry = entry;
      } else if (RANK_VALUES[card.rank] >= RANK_VALUES[winCard.rank]) {
        winningEntry = entry;
      }
    }
  }

  // Render cards into radial slots with individual player pills
  trickCards.forEach((entry) => {
    let relPos = entry.playerIndex;
    if (mySeatIndex !== null) {
      relPos = (entry.playerIndex - mySeatIndex + maxPlayers) % maxPlayers;
    }

    const card = entry.card;
    const isWinning = winningEntry && winningEntry.playerIndex === entry.playerIndex;
    const isHukumCard = Boolean(hukum && card.suit === hukum);
    const colorClass = SUIT_CLASSES[card.suit];
    const teamClass = (entry.team === 'teamB' || entry.playerIndex % 2 === 1) ? 'team-b' : 'team-a';

    const cleanPlayerName = (entry.playerName || 'Player').replace(/^[🤖\s]+/, '').trim();
    const isBotEntry = (entry.playerName || '').includes('🤖');
    const botPillIcon = isBotEntry ? '<i class="fa-solid fa-robot" style="font-size: 0.52rem; opacity: 0.75; margin-right: 2px;"></i>' : '';

    const slotEl = document.createElement('div');
    slotEl.className = `radial-card-slot slot-pos-${relPos}`;

    slotEl.innerHTML = `
      <div class="card-player-pill ${teamClass} ${isWinning ? 'is-winning-pill' : ''}">
        ${isWinning ? '<span class="pill-crown"><i class="fa-solid fa-crown"></i></span> ' : ''}${botPillIcon}${cleanPlayerName}${entry.playerIndex === mySeatIndex ? ' (You)' : ''}
      </div>
      <div class="played-mini-card ${colorClass} ${card.isMindi ? 'is-mindi' : ''} ${isHukumCard ? 'is-hukum' : ''} ${isWinning ? 'is-winning' : ''}">
        ${renderCardInnerHtml(card, isHukumCard)}
      </div>
      ${isWinning ? '<span class="winning-card-indicator"><i class="fa-solid fa-crown"></i> HIGH</span>' : ''}
    `;

    arena.appendChild(slotEl);
  });
}

// Update Suit Filter Counts
function updateSuitCounts(cards) {
  const counts = { ALL: cards.length, S: 0, H: 0, D: 0, C: 0 };
  cards.forEach((c) => {
    if (counts[c.suit] !== undefined) counts[c.suit]++;
  });

  document.getElementById('count-all').textContent = counts.ALL;
  document.getElementById('count-S').textContent = counts.S;
  document.getElementById('count-H').textContent = counts.H;
  document.getElementById('count-D').textContent = counts.D;
  document.getElementById('count-C').textContent = counts.C;
}

// Render Filtered Hand Cards
function renderFilteredHand() {
  const handContainer = document.getElementById('player-hand-cards');
  if (!handContainer) return;
  const prevScrollLeft = handContainer.scrollLeft;
  handContainer.innerHTML = '';

  if (!currentHandCards || currentHandCards.length === 0) {
    btnThrowSelected.classList.add('hidden');
    selectedCardId = null;
    return;
  }

  // Auto-revert to ALL if currently filtered suit has 0 cards
  if (selectedSuitFilter !== 'ALL') {
    const hasSuitCards = currentHandCards.some((c) => c.suit === selectedSuitFilter);
    if (!hasSuitCards) {
      selectedSuitFilter = 'ALL';
      document.querySelectorAll('.suit-filter-btn').forEach((b) => {
        b.classList.toggle('active', b.dataset.suit === 'ALL');
      });
    }
  }

  const filteredCards =
    selectedSuitFilter === 'ALL'
      ? currentHandCards
      : currentHandCards.filter((c) => c.suit === selectedSuitFilter);

  if (filteredCards.length > 10) {
    handContainer.classList.add('dense-hand');
  } else {
    handContainer.classList.remove('dense-hand');
  }

  filteredCards.forEach((card) => {
    const colorClass = SUIT_CLASSES[card.suit];
    // If it's NOT my turn: keep full color and readability ('waiting-turn')
    // If it IS my turn: mark 'legal' or 'illegal'
    let stateClass = 'waiting-turn';
    if (isMyActiveTurn) {
      stateClass = card.isLegal ? 'legal' : 'illegal';
    }

    const isSelected = card.id === selectedCardId;
    const isHukumCard = Boolean(currentHukum && card.suit === currentHukum);

    const cardEl = document.createElement('div');
    cardEl.className = `play-card ${colorClass} ${stateClass} ${card.isMindi ? 'is-mindi' : ''} ${isHukumCard ? 'is-hukum' : ''} ${isSelected ? 'selected' : ''}`;
    cardEl.dataset.cardId = card.id;

    cardEl.innerHTML = renderCardInnerHtml(card, isHukumCard);

    if (isMyActiveTurn && card.isLegal) {
      cardEl.addEventListener('click', (e) => {
        e.stopPropagation();
        if (selectedCardId === card.id) {
          // Second tap on the already-selected card plays/throws it immediately!
          playSelectedCard(card.id);
        } else {
          // Select and elevate card
          selectedCardId = card.id;
          btnThrowSelected.classList.remove('hidden');
          sounds.playCardSnap();
          updateCardSelectionVisuals();
          updateTurnStatusText();
        }
      });

      // Double-click/double-tap to immediately play card (backup)
      cardEl.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        playSelectedCard(card.id);
      });
    } else if (isMyActiveTurn && !card.isLegal) {
      cardEl.addEventListener('click', (e) => {
        e.stopPropagation();
        if (sounds && sounds.playIllegalBuzz) sounds.playIllegalBuzz();
        cardEl.classList.remove('card-shake');
        void cardEl.offsetWidth; // re-trigger animation
        cardEl.classList.add('card-shake');
        const turnTextEl = document.getElementById('turn-status-text');
        if (turnTextEl) {
          turnTextEl.innerHTML = `<span style="color:#ff6b6b;"><i class="fa-solid fa-triangle-exclamation"></i> Follow lead suit!</span>`;
          setTimeout(() => { updateTurnStatusText(); }, 1200);
        }
      });
    }

    handContainer.appendChild(cardEl);
  });

  handContainer.scrollLeft = prevScrollLeft;
}

// Update card selection without wiping DOM (prevents horizontal scroll jumping!)
function updateCardSelectionVisuals() {
  const cards = document.querySelectorAll('#player-hand-cards .play-card');
  cards.forEach((el) => {
    if (el.dataset.cardId === selectedCardId) {
      el.classList.add('selected');
    } else {
      el.classList.remove('selected');
    }
  });
}

// Tap on felt surface deselects card
document.addEventListener('click', (e) => {
  if (selectedCardId && !e.target.closest('#player-hand-cards') && !e.target.closest('#btn-throw-selected')) {
    selectedCardId = null;
    btnThrowSelected.classList.add('hidden');
    updateCardSelectionVisuals();
    updateTurnStatusText();
  }
});

// Play Card Emit
function playSelectedCard(cardId) {
  sounds.playCardSnap();
  btnThrowSelected.classList.add('hidden');
  selectedCardId = null;

  socket.emit('play_card', { roomCode: currentRoomCode, playerId: myPlayerId, cardId }, (res) => {
    if (!res.success) {
      alert(res.error);
    }
  });
}

// --- ROUND SUMMARY MODAL ---
function showRoundModal(summary) {
  roundModal.classList.remove('hidden');

  const kotBanner = document.getElementById('modal-kot-banner');
  if (summary.isKot) {
    kotBanner.classList.remove('hidden');
  } else {
    kotBanner.classList.add('hidden');
  }

  document.getElementById('modal-winner-title').textContent = `${summary.winnerName} Won Round ${summary.roundNumber}!`;
  document.getElementById('modal-win-reason').textContent = summary.winReason;

  const teamAName = document.getElementById('hdr-team-a-name').textContent || 'Team A';
  const teamBName = document.getElementById('hdr-team-b-name').textContent || 'Team B';

  document.getElementById('modal-team-a-name').textContent = teamAName;
  document.getElementById('modal-team-a-mindis').textContent = summary.teamAMindis;
  document.getElementById('modal-team-a-hath').textContent = summary.teamATricks;
  document.getElementById('modal-team-a-pts').textContent = `${summary.matchPoints.teamA}/5`;

  document.getElementById('modal-team-b-name').textContent = teamBName;
  document.getElementById('modal-team-b-mindis').textContent = summary.teamBMindis;
  document.getElementById('modal-team-b-hath').textContent = summary.teamBTricks;
  document.getElementById('modal-team-b-pts').textContent = `${summary.matchPoints.teamB}/5`;

  const matchWinnerBanner = document.getElementById('match-winner-banner');
  if (summary.matchWinner) {
    matchWinnerBanner.classList.remove('hidden');
    matchWinnerBanner.innerHTML = `🏆 <strong>${summary.matchWinner.toUpperCase()} WON THE MATCH!</strong> 🏆`;
    document.getElementById('btn-next-round').textContent = 'Play New Game';
  } else {
    matchWinnerBanner.classList.add('hidden');
    document.getElementById('btn-next-round').textContent = 'Start Next Round ➔';
  }
}

document.getElementById('btn-next-round').addEventListener('click', () => {
  roundModal.classList.add('hidden');
  lastDealtRoundNum = null;
  socket.emit('start_next_round', { roomCode: currentRoomCode });
});

// Toast Banner
function showToast(message) {
  const toast = document.getElementById('announcement-toast');
  toast.textContent = message;
  toast.classList.remove('hidden');

  setTimeout(() => {
    toast.classList.add('hidden');
  }, 2500);
}
