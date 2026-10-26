// Mindi Kot Main Server (Express + Socket.io)
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { RoomManager } = require('./roomManager');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;
const roomManager = new RoomManager();

// Serve static frontend files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Network Info API for Wi-Fi / Hotspot LAN Discovery
app.get('/api/network-info', (req, res) => {
  const os = require('os');
  const nets = os.networkInterfaces();
  const ips = [];

  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254.')) {
        ips.push({ name, ip: net.address });
      }
    }
  }

  const primaryIp = ips.length > 0 ? ips[0].ip : 'localhost';
  res.json({
    primaryIp,
    port: PORT,
    hotspotUrl: `http://${primaryIp}:${PORT}`,
    allIps: ips
  });
});

// Fallback route for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Helper to broadcast game state to each player in room with their private hand
function broadcastGameState(room) {
  room.players.forEach((player) => {
    if (player.socketId) {
      const playerState = room.engine.getGameState(player.id);
      io.to(player.socketId).emit('game_state_update', {
        ...playerState,
        myPlayerId: player.id,
        mySeatIndex: player.seatIndex,
        myTeam: player.team,
        isDealingPhase: !!room.isDealingPhase,
        shuffleCount: room.shuffleCount || 0
      });
    }
  });

  // Check if current turn is a Bot (only when not in dealing phase)
  if (!room.isDealingPhase) {
    checkAndTriggerBotTurn(room);
  }
}

// Bot AI Turn Handler
function checkAndTriggerBotTurn(room) {
  if (room.status !== 'PLAYING' || room.isDealingPhase || room.engine.isRoundOver || room.isResolvingTrick) return;

  const currentTurnIndex = room.engine.currentTurnIndex;
  const activePlayer = room.players[currentTurnIndex];

  if (!activePlayer || !activePlayer.isBot) return;

  // Small delay for natural human-like card play
  setTimeout(() => {
    // Re-verify it is still bot's turn and trick is not resolving
    if (
      room.status !== 'PLAYING' ||
      room.isDealingPhase ||
      room.engine.isRoundOver ||
      room.isResolvingTrick ||
      room.engine.currentTurnIndex !== currentTurnIndex
    ) {
      return;
    }

    const botHand = room.engine.hands[activePlayer.id] || [];
    if (botHand.length === 0) return;

    // Filter legal cards
    const legalCards = botHand.filter((card) =>
      room.engine.isCardLegal(activePlayer.id, card.id)
    );
    if (legalCards.length === 0) return;

    // Simple heuristic for Bot:
    let chosenCard = legalCards[legalCards.length - 1]; // Lowest card by default

    const leadSuit = room.engine.currentLeadSuit;
    if (leadSuit && !botHand.some((c) => c.suit === leadSuit)) {
      // Cutting situation!
      if (!room.engine.hukum) {
        // First cut: Choose best suit to declare Hukum!
        chosenCard = legalCards[0];
      }
    }

    try {
      handleCardPlay(room, activePlayer.id, chosenCard.id);
    } catch (err) {
      console.error(`Bot play error: ${err.message}`);
    }
  }, 1000);
}

// Core Card Play Logic
function handleCardPlay(room, playerId, cardId) {
  if (room.isResolvingTrick) {
    throw new Error('Wait for current trick to finish.');
  }

  const result = room.engine.playCard(playerId, cardId);

  // Notify all players of the card played
  io.to(room.code).emit('card_thrown', {
    trickEntry: result.cardPlayed,
    hukumJustRevealed: result.hukumJustRevealed,
    hukum: room.engine.hukum,
    hukumName: room.engine.getGameState().hukumName
  });

  // Reset Turn Timer
  resetTurnTimer(room);

  if (result.trickCompleted) {
    room.isResolvingTrick = true;

    const isLastTrick = room.engine.isRoundOver;
    // On the final trick of the round, keep cards displayed for 3.5s (3s fully visible + 0.5s sweep)
    const trickDelay = isLastTrick ? 3500 : 2000;

    // Broadcast state immediately so all cards (including the final card) are visible on table for all players
    broadcastGameState(room);

    // Notify room of trick winner
    io.to(room.code).emit('trick_finished', {
      winner: result.trickWinner,
      mindisContained: room.engine.lastTrick.mindisContained,
      trickNum: room.engine.lastTrick.trickNum,
      tricksWon: room.engine.tricksWon,
      mindisWon: room.engine.mindisWon,
      isLastTrick: isLastTrick
    });

    // Delay before next trick / round modal so players can see the complete trick & winning card
    setTimeout(() => {
      room.isResolvingTrick = false;
      room.engine.clearCurrentTrick();

      if (room.engine.isRoundOver) {
        // Round Finished
        io.to(room.code).emit('round_finished', {
          roundSummary: room.engine.roundSummary,
          matchPoints: room.engine.matchPoints
        });
        broadcastGameState(room);
      } else {
        // Clear trick table and broadcast next turn
        io.to(room.code).emit('trick_cleared', {});
        broadcastGameState(room);
      }
    }, trickDelay);
  } else {
    broadcastGameState(room);
  }
}

// Start Card Distribution Sequence & Assign First Turn
function triggerStartDeal(room, firstTurnIndex, triggeredByName) {
  if (!room.isDealingPhase) return;
  room.isDealingPhase = false;
  if (room.autoDealTimer) {
    clearTimeout(room.autoDealTimer);
    room.autoDealTimer = null;
  }

  // The player who cut/tapped Ket gets the 1st turn!
  room.engine.currentTurnIndex = firstTurnIndex;

  io.to(room.code).emit('dealing_started', {
    firstTurnIndex: room.engine.currentTurnIndex,
    firstPlayerName: room.players[room.engine.currentTurnIndex]?.name || triggeredByName,
    maxPlayers: room.maxPlayers
  });

  // Wait 2200ms for client dealing animations, then start normal gameplay
  setTimeout(() => {
    if (room.status !== 'PLAYING') return;
    broadcastGameState(room);
    resetTurnTimer(room);
  }, 2200);
}

// Turn Timer Management (30 seconds per turn)
function resetTurnTimer(room) {
  if (room.turnTimer) {
    clearInterval(room.turnTimer);
    room.turnTimer = null;
  }

  if (room.status !== 'PLAYING' || room.isDealingPhase || room.engine.isRoundOver) return;

  room.turnTimeRemaining = 30;
  io.to(room.code).emit('turn_timer_tick', { seconds: room.turnTimeRemaining });

  room.turnTimer = setInterval(() => {
    room.turnTimeRemaining--;
    io.to(room.code).emit('turn_timer_tick', { seconds: room.turnTimeRemaining });

    if (room.turnTimeRemaining <= 0) {
      clearInterval(room.turnTimer);
      room.turnTimer = null;

      // Auto-play for timed-out player
      const activePlayer = room.players[room.engine.currentTurnIndex];
      if (activePlayer && !activePlayer.isBot) {
        const hand = room.engine.hands[activePlayer.id] || [];
        const legalCards = hand.filter((c) => room.engine.isCardLegal(activePlayer.id, c.id));
        if (legalCards.length > 0) {
          // Play lowest legal card
          const autoCard = legalCards[legalCards.length - 1];
          try {
            handleCardPlay(room, activePlayer.id, autoCard.id);
          } catch (e) {
            console.error('Auto-play error:', e.message);
          }
        }
      }
    }
  }, 1000);
}

// Socket.io Connection Events
io.on('connection', (socket) => {
  // 1. Create Room
  socket.on('create_room', (data, callback) => {
    try {
      const room = roomManager.createRoom({
        mode: data.mode || '2v2',
        teamAName: data.teamAName || 'Team A',
        teamBName: data.teamBName || 'Team B',
        hostName: data.playerName || 'Host',
        hostSocketId: socket.id,
        sessionToken: data.sessionToken || socket.id
      });

      socket.join(room.code);
      callback({ success: true, roomCode: room.code, lobby: roomManager.getLobbyState(room) });
    } catch (err) {
      callback({ success: false, error: err.message });
    }
  });

  // 2. Join Room
  socket.on('join_room', (data, callback) => {
    try {
      const { room, player, isReconnection } = roomManager.joinRoom(data.roomCode, {
        playerName: data.playerName,
        socketId: socket.id,
        sessionToken: data.sessionToken || socket.id,
        requestedTeam: data.requestedTeam
      });

      socket.join(room.code);

      callback({
        success: true,
        roomCode: room.code,
        playerId: player.id,
        player,
        isReconnection,
        lobby: roomManager.getLobbyState(room)
      });

      // Notify others in room
      io.to(room.code).emit('lobby_update', roomManager.getLobbyState(room));

      // If reconnecting to an ongoing game, sync game state immediately
      if (room.status === 'PLAYING') {
        broadcastGameState(room);
      }
    } catch (err) {
      callback({ success: false, error: err.message });
    }
  });

  // 3. Fill Bots (Host only)
  socket.on('fill_bots', (data, callback) => {
    try {
      const room = roomManager.fillWithBots(data.roomCode, socket.id);
      io.to(room.code).emit('lobby_update', roomManager.getLobbyState(room));
      if (callback) callback({ success: true, lobby: roomManager.getLobbyState(room) });
    } catch (err) {
      if (callback) callback({ success: false, error: err.message });
    }
  });

  // 4. Start Game (With 3D Ket & Shuffle Stage in Center)
  socket.on('start_game', (data, callback) => {
    try {
      const room = roomManager.getRoom(data.roomCode);
      if (!room) throw new Error('Room not found');
      if (room.players.length !== room.maxPlayers) {
        throw new Error(`Need all ${room.maxPlayers} players to start!`);
      }

      room.status = 'PLAYING';
      room.isDealingPhase = true;
      room.shuffleCount = 0;
      room.engine.startNewRound(room.players);

      io.to(room.code).emit('game_started', {
        mode: room.mode,
        maxPlayers: room.maxPlayers,
        teamAName: room.teamAName,
        teamBName: room.teamBName
      });

      broadcastGameState(room);

      // Auto-deal fallback after 20s if no one taps Ket
      if (room.autoDealTimer) clearTimeout(room.autoDealTimer);
      room.autoDealTimer = setTimeout(() => {
        triggerStartDeal(room, (room.engine.dealerIndex + 1) % room.maxPlayers, 'Auto');
      }, 20000);

      if (callback) callback({ success: true });
    } catch (err) {
      if (callback) callback({ success: false, error: err.message });
    }
  });

  // 5. Start Next Round (With 3D Ket & Shuffle Stage in Center)
  socket.on('start_next_round', (data, callback) => {
    try {
      const room = roomManager.getRoom(data.roomCode);
      if (!room) throw new Error('Room not found');

      room.isDealingPhase = true;
      room.shuffleCount = 0;
      room.engine.startNewRound(room.players, room.engine.dealerIndex);
      io.to(room.code).emit('round_started', { roundNumber: room.engine.roundNumber });

      broadcastGameState(room);

      if (room.autoDealTimer) clearTimeout(room.autoDealTimer);
      room.autoDealTimer = setTimeout(() => {
        triggerStartDeal(room, (room.engine.dealerIndex + 1) % room.maxPlayers, 'Auto');
      }, 20000);

      if (callback) callback({ success: true });
    } catch (err) {
      if (callback) callback({ success: false, error: err.message });
    }
  });

  // 5a. Shuffle Ket (Deck) in Center
  socket.on('shuffle_deck', (data) => {
    try {
      const room = roomManager.getRoom(data.roomCode);
      if (!room || !room.isDealingPhase) return;
      room.shuffleCount = (room.shuffleCount || 0) + 1;
      io.to(room.code).emit('deck_shuffled', {
        shuffleCount: room.shuffleCount
      });
    } catch (e) {
      console.error('Shuffle error:', e.message);
    }
  });

  // 5b. Cut Ket & Start Dealing (First turn awarded to player who clicked)
  socket.on('cut_and_deal', (data) => {
    try {
      const room = roomManager.getRoom(data.roomCode);
      if (!room || !room.isDealingPhase) return;

      const playerIdx = room.players.findIndex(
        (p) => p.id === data.playerId || p.socketId === socket.id
      );
      const firstTurnIndex = playerIdx !== -1 ? playerIdx : (room.engine.dealerIndex + 1) % room.maxPlayers;
      const playerName = room.players[firstTurnIndex]?.name || 'Player';

      triggerStartDeal(room, firstTurnIndex, playerName);
    } catch (e) {
      console.error('Cut & deal error:', e.message);
    }
  });

  // 6. Play Card
  socket.on('play_card', (data, callback) => {
    try {
      const room = roomManager.getRoom(data.roomCode);
      if (!room) throw new Error('Room not found');
      if (room.status !== 'PLAYING') throw new Error('Game not currently active');

      handleCardPlay(room, data.playerId, data.cardId);
      if (callback) callback({ success: true });
    } catch (err) {
      if (callback) callback({ success: false, error: err.message });
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    const result = roomManager.handleDisconnect(socket.id);
    if (result) {
      io.to(result.room.code).emit('player_disconnected', {
        playerId: result.player.id,
        playerName: result.player.name
      });
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`===============================================`);
  console.log(`🎴 MINDI KOT SERVER RUNNING on http://0.0.0.0:${PORT}`);
  console.log(`📶 Connect via Local Wi-Fi / Hotspot IP on port ${PORT}`);
  console.log(`===============================================`);
});
