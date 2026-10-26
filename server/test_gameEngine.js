// Comprehensive Test Suite for Mindi Kot Game Engine
// Run with: node --test server/test_gameEngine.js

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { GameEngine } = require('./gameEngine');

describe('Mindi Kot Game Engine Tests', () => {

  test('Deck Math 2v2: exactly 52 cards, 13 per player, 4 Mindis', () => {
    const engine = new GameEngine('2v2', 'Lions', 'Tigers');
    const deck = engine.createDeck();
    assert.equal(deck.length, 52, '2v2 deck must have 52 cards');

    const mindis = deck.filter(c => c.isMindi);
    assert.equal(mindis.length, 4, '2v2 deck must have 4 Mindis');

    const players = [
      { id: 'p0', name: 'P0', team: 'teamA', seatIndex: 0 },
      { id: 'p1', name: 'P1', team: 'teamB', seatIndex: 1 },
      { id: 'p2', name: 'P2', team: 'teamA', seatIndex: 2 },
      { id: 'p3', name: 'P3', team: 'teamB', seatIndex: 3 }
    ];

    engine.startNewRound(players);
    players.forEach(p => {
      assert.equal(engine.hands[p.id].length, 13, `${p.name} must have 13 cards`);
    });
  });

  test('Deck Math 3v3: exactly 102 cards (Falli ki Dudi ♣2 removed), 17 per player, 8 Mindis', () => {
    const engine = new GameEngine('3v3', 'Lions', 'Tigers');
    const deck = engine.createDeck();
    assert.equal(deck.length, 102, '3v3 deck must have 102 cards');

    // Verify both 2 of Clubs (♣2) are completely removed
    const clubs2 = deck.filter(c => c.suit === 'C' && c.rank === '2');
    assert.equal(clubs2.length, 0, 'Both 2 of Clubs must be removed from 3v3 double deck');

    const mindis = deck.filter(c => c.isMindi);
    assert.equal(mindis.length, 8, '3v3 deck must have 8 Mindis (two of each suit)');

    const players = [
      { id: 'p0', name: 'P0', team: 'teamA', seatIndex: 0 },
      { id: 'p1', name: 'P1', team: 'teamB', seatIndex: 1 },
      { id: 'p2', name: 'P2', team: 'teamA', seatIndex: 2 },
      { id: 'p3', name: 'P3', team: 'teamB', seatIndex: 3 },
      { id: 'p4', name: 'P4', team: 'teamA', seatIndex: 4 },
      { id: 'p5', name: 'P5', team: 'teamB', seatIndex: 5 }
    ];

    engine.startNewRound(players);
    players.forEach(p => {
      assert.equal(engine.hands[p.id].length, 17, `${p.name} must have 17 cards`);
    });
  });

  test('Duplicate Card Tie-Breaker Rule: Later played identical card MUST win', () => {
    const engine = new GameEngine('3v3', 'Lions', 'Tigers');
    engine.currentLeadSuit = 'S';
    engine.hukum = null; // No trump

    // Player 0 plays Ace of Spades (First)
    // Player 3 plays Ace of Spades (Second / Later)
    engine.currentTrick = [
      { playerId: 'p0', playerIndex: 0, team: 'teamA', card: { suit: 'S', rank: 'A', value: 14 } },
      { playerId: 'p1', playerIndex: 1, team: 'teamB', card: { suit: 'S', rank: 'K', value: 13 } },
      { playerId: 'p2', playerIndex: 2, team: 'teamA', card: { suit: 'S', rank: 'Q', value: 12 } },
      { playerId: 'p3', playerIndex: 3, team: 'teamB', card: { suit: 'S', rank: 'A', value: 14 } }, // Duplicate A♠ later
      { playerId: 'p4', playerIndex: 4, team: 'teamA', card: { suit: 'S', rank: '5', value: 5 } },
      { playerId: 'p5', playerIndex: 5, team: 'teamB', card: { suit: 'S', rank: '3', value: 3 } }
    ];

    const winner = engine.evaluateTrickWinner();
    assert.equal(winner.playerId, 'p3', 'Later played Ace of Spades (p3) MUST win over earlier Ace of Spades (p0)');
    assert.equal(winner.team, 'teamB');
  });

  test('Katte Hukum: First cut triggers Hukum, and Trump beats lead suit Ace', () => {
    const engine = new GameEngine('2v2', 'Lions', 'Tigers');
    engine.currentLeadSuit = 'D'; // Diamonds lead
    engine.hukum = null; // Hukum not yet opened

    // Player 1 has no diamonds and cuts with 3 of Hearts (Hukum becomes H!)
    engine.currentTrick = [
      { playerId: 'p0', playerIndex: 0, team: 'teamA', card: { suit: 'D', rank: 'A', value: 14 } },
      { playerId: 'p1', playerIndex: 1, team: 'teamB', card: { suit: 'H', rank: '3', value: 3 } } // First cut!
    ];
    engine.hukum = 'H'; // Hukum declared

    // Player 2 also follows diamonds with K of Diamonds
    engine.currentTrick.push({ playerId: 'p2', playerIndex: 2, team: 'teamA', card: { suit: 'D', rank: 'K', value: 13 } });
    // Player 3 plays another Trump: 4 of Hearts
    engine.currentTrick.push({ playerId: 'p3', playerIndex: 3, team: 'teamB', card: { suit: 'H', rank: '4', value: 4 } });

    const winner = engine.evaluateTrickWinner();
    assert.equal(winner.playerId, 'p3', 'Higher Trump (4♥) must win trick even over Lead Ace (A♦)');
  });

  test('Suit Following Legality: Player cannot play other suits if they have lead suit', () => {
    const engine = new GameEngine('2v2', 'Lions', 'Tigers');
    const players = [
      { id: 'p0', name: 'P0', team: 'teamA', seatIndex: 0 },
      { id: 'p1', name: 'P1', team: 'teamB', seatIndex: 1 },
      { id: 'p2', name: 'P2', team: 'teamA', seatIndex: 2 },
      { id: 'p3', name: 'P3', team: 'teamB', seatIndex: 3 }
    ];
    engine.startNewRound(players);

    // Give player 1 a specific hand
    engine.hands['p1'] = [
      { id: 'S_A_1', suit: 'S', rank: 'A', value: 14 },
      { id: 'H_10_1', suit: 'H', rank: '10', value: 10, isMindi: true }
    ];

    engine.currentTurnIndex = 1;
    engine.currentLeadSuit = 'S';
    engine.currentTrick = [
      { playerId: 'p0', playerIndex: 0, team: 'teamA', card: { suit: 'S', rank: 'K', value: 13 } }
    ];

    // Player 1 has Spades ('S_A_1'), so they MUST NOT be allowed to cut with Hearts ('H_10_1')
    assert.equal(engine.isCardLegal('p1', 'S_A_1'), true, 'Spades must be legal because lead suit is Spades');
    assert.equal(engine.isCardLegal('p1', 'H_10_1'), false, 'Cannot cut with Hearts when player holds Spades');
  });

  test('Simulate Complete 3v3 Match: 17 Tricks, Mindi collection, scoring, and winner declaration', () => {
    const engine = new GameEngine('3v3', 'Team Lions', 'Team Tigers');
    const players = [
      { id: 'p0', name: 'A1', team: 'teamA', seatIndex: 0 },
      { id: 'p1', name: 'B1', team: 'teamB', seatIndex: 1 },
      { id: 'p2', name: 'A2', team: 'teamA', seatIndex: 2 },
      { id: 'p3', name: 'B2', team: 'teamB', seatIndex: 3 },
      { id: 'p4', name: 'A3', team: 'teamA', seatIndex: 4 },
      { id: 'p5', name: 'B3', team: 'teamB', seatIndex: 5 }
    ];

    engine.startNewRound(players);

    // Play all 17 tricks using legal cards
    for (let trick = 0; trick < 17; trick++) {
      for (let p = 0; p < 6; p++) {
        const activePlayer = engine.players[engine.currentTurnIndex];
        const hand = engine.hands[activePlayer.id];
        const legalCards = hand.filter(c => engine.isCardLegal(activePlayer.id, c.id));
        assert.ok(legalCards.length > 0, `Player ${activePlayer.name} must have at least one legal card`);

        // Play first legal card
        const cardToPlay = legalCards[0];
        engine.playCard(activePlayer.id, cardToPlay.id);
      }
    }

    assert.equal(engine.tricksCompleted, 17, 'All 17 tricks must be completed');
    assert.equal(engine.isRoundOver, true, 'Round must be marked as over');

    const totalMindisCollected = engine.mindisWon.teamA.length + engine.mindisWon.teamB.length;
    assert.equal(totalMindisCollected, 8, 'All 8 Mindis must be accounted for across Team A and Team B');

    const totalTricksCollected = engine.tricksWon.teamA + engine.tricksWon.teamB;
    assert.equal(totalTricksCollected, 17, 'Total tricks won must equal 17');

    assert.ok(engine.roundSummary, 'Round summary must be generated');
    assert.ok(engine.roundSummary.winner, 'Round must have a winner');
    assert.ok(engine.roundSummary.pointsAwarded >= 1, 'Winner must receive at least 1 point');
  });

});
