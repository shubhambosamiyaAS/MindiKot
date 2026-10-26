// Mindi Kot Game Engine
// Supports 2v2 (4 players, 52 cards) and 3v3 (6 players, 102 cards - ♣2 removed)
// Rules: Katte Hukum, Later Duplicate Card Wins, Face-up Mindi Trays, Hath Pile

const SUITS = ['S', 'H', 'D', 'C']; // Spades (Hukum), Hearts (Paan), Diamonds (Charkat), Clubs (Falli)
const SUIT_NAMES = {
  S: 'Spades (Hukum ♠)',
  H: 'Hearts (Paan ♥)',
  D: 'Diamonds (Charkat ♦)',
  C: 'Clubs (Falli ♣)'
};

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RANK_VALUES = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
  '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14
};

class GameEngine {
  constructor(mode = '2v2', teamAName = 'Team A', teamBName = 'Team B') {
    this.mode = mode; // '2v2' or '3v3'
    this.maxPlayers = mode === '3v3' ? 6 : 4;
    this.teamAName = teamAName;
    this.teamBName = teamBName;
    this.totalCards = mode === '3v3' ? 102 : 52;
    this.cardsPerPlayer = mode === '3v3' ? 17 : 13;
    this.totalMindis = mode === '3v3' ? 8 : 4;
    this.totalTricks = mode === '3v3' ? 17 : 13;

    this.matchPoints = { teamA: 0, teamB: 0 };
    this.targetMatchPoints = 5;

    this.roundNumber = 0;
    this.dealerIndex = 0;
    this.resetRoundState();
  }

  resetRoundState() {
    this.roundNumber++;
    this.hukum = null; // Katte Hukum: revealed on first cut
    this.hukumCutInfo = null; // { playerId, playerName, suit, card }
    this.currentLeadSuit = null;
    this.currentTrick = []; // [{ playerId, playerName, playerIndex, team, card }]
    this.tricksCompleted = 0;

    this.tricksWon = { teamA: 0, teamB: 0 };
    this.mindisWon = { teamA: [], teamB: [] }; // Face-up 10s collected
    this.lastTrick = null; // Stored for display

    this.hands = {}; // playerId -> Card[]
    this.players = []; // [{ id, name, team, seatIndex }]
    this.currentTurnIndex = null;
    this.isRoundOver = false;
    this.roundSummary = null;
  }

  // Create & shuffle deck based on game mode
  createDeck() {
    let deck = [];
    const deckCount = this.mode === '3v3' ? 2 : 1;

    for (let d = 1; d <= deckCount; d++) {
      for (const suit of SUITS) {
        for (const rank of RANKS) {
          // In 3v3 (6 players), remove both 2 of Clubs (♣2 / Falli ki Dudi)
          if (this.mode === '3v3' && suit === 'C' && rank === '2') {
            continue;
          }

          deck.push({
            id: `${suit}_${rank}_${d}`,
            suit,
            rank,
            value: RANK_VALUES[rank],
            isMindi: rank === '10',
            deckNum: d
          });
        }
      }
    }

    // Fisher-Yates Shuffle
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    return deck;
  }

  // Initialize round & deal cards to seated players
  startNewRound(playersList, forcedDealerIndex = null) {
    if (playersList.length !== this.maxPlayers) {
      throw new Error(`Exactly ${this.maxPlayers} players required.`);
    }

    // If match was already completed, reset match points for a fresh match
    if (
      this.matchPoints.teamA >= this.targetMatchPoints ||
      this.matchPoints.teamB >= this.targetMatchPoints
    ) {
      this.matchPoints = { teamA: 0, teamB: 0 };
      this.roundNumber = 0;
    }

    this.resetRoundState();
    this.players = [...playersList];

    if (forcedDealerIndex !== null) {
      this.dealerIndex = forcedDealerIndex % this.maxPlayers;
    }

    // First player to play is next to dealer
    this.currentTurnIndex = (this.dealerIndex + 1) % this.maxPlayers;

    const deck = this.createDeck();

    // Deal cards sequentially
    this.players.forEach((p) => {
      this.hands[p.id] = [];
    });

    for (let i = 0; i < deck.length; i++) {
      const playerIndex = (this.dealerIndex + 1 + i) % this.maxPlayers;
      const player = this.players[playerIndex];
      this.hands[player.id].push(deck[i]);
    }

    // Sort cards in hand by suit & rank for better UX
    this.players.forEach((p) => {
      this.sortHand(this.hands[p.id]);
    });

    return this.getGameState();
  }

  sortHand(hand) {
    const suitOrder = { S: 0, H: 1, C: 2, D: 3 };
    hand.sort((a, b) => {
      if (a.suit !== b.suit) {
        return suitOrder[a.suit] - suitOrder[b.suit];
      }
      return b.value - a.value; // High to low
    });
  }

  // Card legality checker
  isCardLegal(playerId, cardId) {
    const hand = this.hands[playerId];
    if (!hand) return false;

    const card = hand.find((c) => c.id === cardId);
    if (!card) return false;

    // Check if it's player's turn
    const activePlayer = this.players[this.currentTurnIndex];
    if (!activePlayer || activePlayer.id !== playerId) return false;

    // If first card in trick: any card is legal
    if (this.currentTrick.length === 0) return true;

    // Must follow lead suit if held in hand
    const hasLeadSuit = hand.some((c) => c.suit === this.currentLeadSuit);
    if (hasLeadSuit) {
      return card.suit === this.currentLeadSuit;
    }

    // If player does not have lead suit, they can play ANY card (Kaat / Hukum or discard)
    return true;
  }

  // Play a card
  playCard(playerId, cardId) {
    if (!this.isCardLegal(playerId, cardId)) {
      throw new Error('Illegal card or not your turn.');
    }

    // Defensive check: If previous trick was full, clear it before starting new trick
    if (this.currentTrick.length >= this.maxPlayers) {
      this.clearCurrentTrick();
    }

    const player = this.players[this.currentTurnIndex];
    const hand = this.hands[playerId];
    const cardIndex = hand.findIndex((c) => c.id === cardId);
    const [card] = hand.splice(cardIndex, 1);

    // If this is lead card
    if (this.currentTrick.length === 0) {
      this.currentLeadSuit = card.suit;
    }

    // Katte Hukum Check:
    // If Hukum is not yet revealed, and player cuts (plays card of different suit than lead suit)
    let hukumJustRevealed = false;
    if (!this.hukum && card.suit !== this.currentLeadSuit) {
      this.hukum = card.suit;
      this.hukumCutInfo = {
        playerId: player.id,
        playerName: player.name,
        suit: card.suit,
        card
      };
      hukumJustRevealed = true;
    }

    // Add card to current trick
    const trickEntry = {
      playerId: player.id,
      playerName: player.name,
      playerIndex: this.currentTurnIndex,
      team: player.team,
      card
    };
    this.currentTrick.push(trickEntry);

    // Check if trick is complete
    if (this.currentTrick.length === this.maxPlayers) {
      const winner = this.evaluateTrickWinner();
      this.finishTrick(winner);
      return {
        cardPlayed: trickEntry,
        trickCompleted: true,
        trickWinner: winner,
        hukumJustRevealed,
        gameState: this.getGameState()
      };
    }

    // Pass turn to next player
    this.currentTurnIndex = (this.currentTurnIndex + 1) % this.maxPlayers;

    return {
      cardPlayed: trickEntry,
      trickCompleted: false,
      hukumJustRevealed,
      gameState: this.getGameState()
    };
  }

  // Trick Winner Evaluation with "Later duplicate card wins" rule
  evaluateTrickWinner() {
    let winningEntry = null;

    for (const entry of this.currentTrick) {
      const card = entry.card;

      if (!winningEntry) {
        winningEntry = entry;
        continue;
      }

      const winCard = winningEntry.card;

      // 1. If incoming card is Trump (Hukum)
      if (this.hukum && card.suit === this.hukum) {
        if (winCard.suit !== this.hukum) {
          // Trump beats non-trump immediately
          winningEntry = entry;
        } else {
          // Both are Trumps. Compare values.
          // TIE-BREAKER: Later played card of same rank wins (>=)
          if (card.value >= winCard.value) {
            winningEntry = entry;
          }
        }
      }
      // 2. If incoming card is NOT Trump
      else {
        // If current winner is already Trump, non-trump cannot beat it
        if (this.hukum && winCard.suit === this.hukum) {
          continue;
        }

        // Must match lead suit to be eligible to win
        if (card.suit === this.currentLeadSuit) {
          if (winCard.suit !== this.currentLeadSuit) {
            winningEntry = entry;
          } else {
            // TIE-BREAKER: Later played card of same rank wins (>=)
            if (card.value >= winCard.value) {
              winningEntry = entry;
            }
          }
        }
      }
    }

    return winningEntry;
  }

  // Finish trick, store Mindis & Hath
  finishTrick(winningEntry) {
    this.tricksCompleted++;
    const winningTeam = winningEntry.team; // 'teamA' or 'teamB'

    // Extract Mindis (10s) from the trick to show face-up
    const mindis = this.currentTrick
      .filter((t) => t.card.isMindi)
      .map((t) => ({
        ...t.card,
        wonByPlayer: winningEntry.playerName,
        trickNum: this.tricksCompleted
      }));

    if (mindis.length > 0) {
      this.mindisWon[winningTeam].push(...mindis);
    }

    this.tricksWon[winningTeam]++;

    this.lastTrick = {
      cards: [...this.currentTrick],
      winner: winningEntry,
      trickNum: this.tricksCompleted,
      mindisContained: mindis
    };

    // Note: currentTrick is retained so all players see the complete trick
    // until clearCurrentTrick() is explicitly called by the server after the display delay.

    // Next trick lead is the winner of this trick
    this.currentTurnIndex = winningEntry.playerIndex;

    // Check if Round is Over
    if (this.tricksCompleted === this.totalTricks) {
      this.endRound();
    }
  }

  // Explicitly clear trick from table when starting next trick
  clearCurrentTrick() {
    this.currentTrick = [];
    this.currentLeadSuit = null;
  }

  // End of Round & Point Calculation
  endRound() {
    this.isRoundOver = true;
    const aMindis = this.mindisWon.teamA.length;
    const bMindis = this.mindisWon.teamB.length;
    const aTricks = this.tricksWon.teamA;
    const bTricks = this.tricksWon.teamB;

    let roundWinner = null;
    let pointsAwarded = 0;
    let winReason = '';
    let isKot = false;

    if (this.mode === '2v2') {
      // 4 Mindis total
      if (aMindis === 4) {
        roundWinner = 'teamA';
        pointsAwarded = 2; // Kot Bonus
        isKot = true;
        winReason = `${this.teamAName} got all 4 Mindis (KOT / COAT)!`;
      } else if (bMindis === 4) {
        roundWinner = 'teamB';
        pointsAwarded = 2; // Kot Bonus
        isKot = true;
        winReason = `${this.teamBName} got all 4 Mindis (KOT / COAT)!`;
      } else if (aMindis > bMindis) {
        roundWinner = 'teamA';
        pointsAwarded = 1;
        winReason = `${this.teamAName} won with ${aMindis} Mindis vs ${bMindis}.`;
      } else if (bMindis > aMindis) {
        roundWinner = 'teamB';
        pointsAwarded = 1;
        winReason = `${this.teamBName} won with ${bMindis} Mindis vs ${aMindis}.`;
      } else {
        // 2 - 2 Tie: Decided by Hath (Tricks)
        if (aTricks > bTricks) {
          roundWinner = 'teamA';
          pointsAwarded = 1;
          winReason = `Mindis tied (2-2). ${this.teamAName} won by Hath (${aTricks} vs ${bTricks})!`;
        } else {
          roundWinner = 'teamB';
          pointsAwarded = 1;
          winReason = `Mindis tied (2-2). ${this.teamBName} won by Hath (${bTricks} vs ${aTricks})!`;
        }
      }
    } else {
      // 3v3 Mode (8 Mindis total, 17 Hath total)
      if (aMindis === 8) {
        roundWinner = 'teamA';
        pointsAwarded = 2; // Kot
        isKot = true;
        winReason = `${this.teamAName} got all 8 Mindis (SUPER KOT)!`;
      } else if (bMindis === 8) {
        roundWinner = 'teamB';
        pointsAwarded = 2; // Kot
        isKot = true;
        winReason = `${this.teamBName} got all 8 Mindis (SUPER KOT)!`;
      } else if (aMindis >= 5) {
        roundWinner = 'teamA';
        pointsAwarded = 1;
        winReason = `${this.teamAName} won with ${aMindis} Mindis vs ${bMindis}.`;
      } else if (bMindis >= 5) {
        roundWinner = 'teamB';
        pointsAwarded = 1;
        winReason = `${this.teamBName} won with ${bMindis} Mindis vs ${aMindis}.`;
      } else {
        // 4 - 4 Tie: Decided by Hath (17 tricks is odd, so strictly 9+ vs 8-)
        if (aTricks > bTricks) {
          roundWinner = 'teamA';
          pointsAwarded = 1;
          winReason = `Mindis tied (4-4). ${this.teamAName} won by Hath (${aTricks} vs ${bTricks})!`;
        } else {
          roundWinner = 'teamB';
          pointsAwarded = 1;
          winReason = `Mindis tied (4-4). ${this.teamBName} won by Hath (${bTricks} vs ${aTricks})!`;
        }
      }
    }

    this.matchPoints[roundWinner] += pointsAwarded;

    // Check Match Winner
    const matchWinner =
      this.matchPoints.teamA >= this.targetMatchPoints
        ? 'teamA'
        : this.matchPoints.teamB >= this.targetMatchPoints
        ? 'teamB'
        : null;

    // Next round dealer is from losing team
    const losingTeam = roundWinner === 'teamA' ? 'teamB' : 'teamA';
    const nextDealerPlayer = this.players.find(
      (p, idx) => p.team === losingTeam && idx !== this.dealerIndex
    );
    if (nextDealerPlayer) {
      this.dealerIndex = nextDealerPlayer.seatIndex;
    } else {
      this.dealerIndex = (this.dealerIndex + 1) % this.maxPlayers;
    }

    this.roundSummary = {
      roundNumber: this.roundNumber,
      winner: roundWinner,
      winnerName: roundWinner === 'teamA' ? this.teamAName : this.teamBName,
      pointsAwarded,
      isKot,
      winReason,
      teamAMindis: aMindis,
      teamBMindis: bMindis,
      teamATricks: aTricks,
      teamBTricks: bTricks,
      matchPoints: { ...this.matchPoints },
      matchWinner: matchWinner
        ? matchWinner === 'teamA'
          ? this.teamAName
          : this.teamBName
        : null
    };
  }

  // Get sanitized game state for broadcast
  getGameState(forPlayerId = null) {
    const activePlayer = this.players[this.currentTurnIndex] || null;

    return {
      mode: this.mode,
      maxPlayers: this.maxPlayers,
      teamAName: this.teamAName,
      teamBName: this.teamBName,
      roundNumber: this.roundNumber,
      dealerIndex: this.dealerIndex,
      dealerId: this.players[this.dealerIndex]?.id || null,
      currentTurnIndex: this.currentTurnIndex,
      activePlayerId: activePlayer?.id || null,
      activePlayerName: activePlayer?.name || null,
      hukum: this.hukum,
      hukumName: this.hukum ? SUIT_NAMES[this.hukum] : 'Not Revealed (Katte Hukum)',
      hukumCutInfo: this.hukumCutInfo,
      currentLeadSuit: this.currentLeadSuit,
      currentTrick: this.currentTrick,
      lastTrick: this.lastTrick,
      tricksWon: this.tricksWon,
      mindisWon: this.mindisWon,
      matchPoints: this.matchPoints,
      isRoundOver: this.isRoundOver,
      roundSummary: this.roundSummary,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        team: p.team,
        seatIndex: p.seatIndex,
        cardsCount: this.hands[p.id]?.length || 0
      })),
      // If requested for specific player, include their hand & legal cards
      myHand: forPlayerId
        ? (this.hands[forPlayerId] || []).map((card) => ({
            ...card,
            isLegal: this.isCardLegal(forPlayerId, card.id)
          }))
        : null
    };
  }
}

module.exports = { GameEngine, SUITS, SUIT_NAMES, RANKS };
