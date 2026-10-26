// Room Manager for Mindi Kot
// Handles room creation, player seating, alternate team assignment,
// re-connection tokens, and AI bot substitutes.

const { GameEngine } = require('./gameEngine');

class RoomManager {
  constructor() {
    this.rooms = new Map(); // roomCode -> Room
  }

  generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    do {
      code = '';
      for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
    } while (this.rooms.has(code));
    return code;
  }

  createRoom({ mode = '2v2', teamAName = 'Team Lions', teamBName = 'Team Tigers', hostName, hostSocketId, sessionToken }) {
    const roomCode = this.generateRoomCode();
    const maxPlayers = mode === '3v3' ? 6 : 4;

    const room = {
      code: roomCode,
      mode,
      maxPlayers,
      teamAName: teamAName || 'Team A',
      teamBName: teamBName || 'Team B',
      hostSocketId,
      hostSessionToken: sessionToken,
      createdAt: Date.now(),
      status: 'LOBBY', // 'LOBBY' | 'PLAYING' | 'GAME_OVER'
      engine: new GameEngine(mode, teamAName, teamBName),
      players: [], // [{ id, socketId, sessionToken, name, team, seatIndex, isBot, isConnected }]
      turnTimer: null,
      turnTimeRemaining: 30
    };

    // Add host as Player 0 (Team A)
    const hostPlayer = {
      id: `p_host_${Date.now()}`,
      socketId: hostSocketId,
      sessionToken,
      name: hostName || 'Host Player',
      team: 'teamA',
      seatIndex: 0,
      isBot: false,
      isConnected: true
    };
    room.players.push(hostPlayer);

    this.rooms.set(roomCode, room);
    return room;
  }

  getRoom(roomCode) {
    if (!roomCode) return null;
    return this.rooms.get(roomCode.toUpperCase().trim()) || null;
  }

  joinRoom(roomCode, { playerName, socketId, sessionToken, requestedTeam = null }) {
    const room = this.getRoom(roomCode);
    if (!room) {
      throw new Error('Room not found. Check the room code.');
    }

    // Check if player is reconnecting with existing sessionToken
    const existingPlayer = room.players.find((p) => p.sessionToken === sessionToken);
    if (existingPlayer) {
      existingPlayer.socketId = socketId;
      existingPlayer.isConnected = true;
      if (playerName) existingPlayer.name = playerName;
      return { room, player: existingPlayer, isReconnection: true };
    }

    if (room.status !== 'LOBBY') {
      throw new Error('Game is already in progress in this room.');
    }

    if (room.players.length >= room.maxPlayers) {
      throw new Error('Room is already full.');
    }

    // Determine available seat
    const takenSeats = room.players.map((p) => p.seatIndex);
    let assignedSeat = -1;

    // Seating pattern is alternate:
    // Even seats (0, 2, 4) -> Team A
    // Odd seats (1, 3, 5) -> Team B
    for (let s = 0; s < room.maxPlayers; s++) {
      if (!takenSeats.includes(s)) {
        const teamForSeat = s % 2 === 0 ? 'teamA' : 'teamB';
        if (!requestedTeam || requestedTeam === teamForSeat) {
          assignedSeat = s;
          break;
        }
      }
    }

    // If preferred team was full, take first available seat
    if (assignedSeat === -1) {
      for (let s = 0; s < room.maxPlayers; s++) {
        if (!takenSeats.includes(s)) {
          assignedSeat = s;
          break;
        }
      }
    }

    const assignedTeam = assignedSeat % 2 === 0 ? 'teamA' : 'teamB';

    const newPlayer = {
      id: `p_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      socketId,
      sessionToken,
      name: playerName || `Player ${room.players.length + 1}`,
      team: assignedTeam,
      seatIndex: assignedSeat,
      isBot: false,
      isConnected: true
    };

    room.players.push(newPlayer);
    // Keep players sorted by seat index
    room.players.sort((a, b) => a.seatIndex - b.seatIndex);

    return { room, player: newPlayer, isReconnection: false };
  }

  // Fill remaining empty slots with Smart Bots for testing or missing players
  fillWithBots(roomCode, hostSocketId) {
    const room = this.getRoom(roomCode);
    if (!room) throw new Error('Room not found');
    if (room.hostSocketId !== hostSocketId) throw new Error('Only host can add bots');

    const botNames = ['Kabir', 'Aarav', 'Riya', 'Vikram', 'Pooja', 'Rohan'];
    let nameIdx = 0;

    while (room.players.length < room.maxPlayers) {
      const takenSeats = room.players.map((p) => p.seatIndex);
      let freeSeat = -1;
      for (let s = 0; s < room.maxPlayers; s++) {
        if (!takenSeats.includes(s)) {
          freeSeat = s;
          break;
        }
      }

      const assignedTeam = freeSeat % 2 === 0 ? 'teamA' : 'teamB';
      const botPlayer = {
        id: `bot_${Date.now()}_${freeSeat}`,
        socketId: null,
        sessionToken: `bot_tok_${freeSeat}`,
        name: `🤖 ${botNames[nameIdx++ % botNames.length]}`,
        team: assignedTeam,
        seatIndex: freeSeat,
        isBot: true,
        isConnected: true
      };

      room.players.push(botPlayer);
    }

    room.players.sort((a, b) => a.seatIndex - b.seatIndex);
    return room;
  }

  handleDisconnect(socketId) {
    for (const room of this.rooms.values()) {
      const player = room.players.find((p) => p.socketId === socketId);
      if (player) {
        player.isConnected = false;
        return { room, player };
      }
    }
    return null;
  }

  getLobbyState(room) {
    return {
      code: room.code,
      mode: room.mode,
      maxPlayers: room.maxPlayers,
      teamAName: room.teamAName,
      teamBName: room.teamBName,
      status: room.status,
      players: room.players.map((p) => ({
        id: p.id,
        name: p.name,
        team: p.team,
        seatIndex: p.seatIndex,
        isBot: p.isBot,
        isConnected: p.isConnected
      })),
      isReadyToStart: room.players.length === room.maxPlayers
    };
  }
}

module.exports = { RoomManager };
