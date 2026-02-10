// ================================
// ARCADE SERVER SETUP
// ================================
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

// ================================
// DATABASE & PERSISTENCE
// ================================
const DB_FILE = path.join(__dirname, "database.json");
let db = { users: {}, leaderboard: [] };

// Load DB
if (fs.existsSync(DB_FILE)) {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE));
  } catch (e) {
    console.error("Error loading DB", e);
  }
}

// Save DB
function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// Update Leaderboard
function updateLeaderboard(username, gameArg) {
  if (!username) return;
  if (!db.users[username]) {
    db.users[username] = { wins: 0, games: {} };
  }
  db.users[username].wins++;

  // Update game specific stats if needed
  if (!db.users[username].games[gameArg]) db.users[username].games[gameArg] = 0;
  db.users[username].games[gameArg]++;

  // Rebuild Leaderboard Array (Top 10)
  const sortedUsers = Object.entries(db.users)
    .sort(([, a], [, b]) => b.wins - a.wins)
    .slice(0, 10)
    .map(([name, stats]) => ({ name, wins: stats.wins }));

  db.leaderboard = sortedUsers;
  saveDB();
  io.emit("updateLeaderboard", db.leaderboard);
}

// ================================
// GAME UTILS
// ================================
const games = {};

// Tic-Tac-Toe Patterns
const tttWinPatterns = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6]
];

function checkWinnerTTT(board) {
  for (let pattern of tttWinPatterns) {
    const [a, b, c] = pattern;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  return board.includes("") ? null : "Draw";
}

// Memory Match Icons
const memoryIcons = ["🍎", "🍌", "🍇", "🍉", "🍒", "🍓", "🥝", "🍍"];
function createMemoryBoard() {
  let cards = [...memoryIcons, ...memoryIcons];
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

// Math Wars Generator
function generateMathQuestion() {
  const ops = ["+", "-", "*"];
  const op = ops[Math.floor(Math.random() * ops.length)];
  let a = Math.floor(Math.random() * 20) + 1;
  let b = Math.floor(Math.random() * 20) + 1;

  // Simplify for speed
  if (op === "*") { a = Math.floor(Math.random() * 10) + 1; b = Math.floor(Math.random() * 10) + 1; }

  let q = `${a} ${op} ${b}`;
  let ans = eval(q); // Safe here as we control input
  return { q, ans };
}

// ================================
// SOCKET CONNECTION
// ================================
io.on("connection", (socket) => {
  console.log("Player connected:", socket.id);

  // Send initial leaderboard
  socket.emit("updateLeaderboard", db.leaderboard);

  // CREATE GAME
  socket.on("createGame", ({ gameType, username }) => {
    const pin = Math.floor(1000 + Math.random() * 9000).toString();

    if (username && !db.users[username]) {
      db.users[username] = { wins: 0, games: {} };
      saveDB();
    }

    let initialState = {};

    const basePlayers = {
      p1: { id: socket.id, name: username },
      p2: null
    };

    if (gameType === "tictactoe") {
      initialState = {
        type: "tictactoe",
        board: Array(9).fill(""),
        turn: "p1", // Using p1/p2 consistently for logic, mapping to X/O for UI if needed
        players: basePlayers
      };
      // For TTT legacy compatibility in UI, we might still map p1->X
      socket.emit("assignSymbol", "X"); // Client expects X/O
    }
    else if (gameType === "memory") {
      initialState = {
        type: "memory",
        board: createMemoryBoard(),
        revealed: Array(16).fill(false),
        matched: [],
        flipped: [],
        turn: "p1",
        scores: { p1: 0, p2: 0 },
        players: basePlayers
      };
      socket.emit("assignSymbol", "p1");
    }
    else if (gameType === "mathwars") {
      initialState = {
        type: "mathwars",
        question: generateMathQuestion(),
        scores: { p1: 0, p2: 0 },
        players: basePlayers
      };
      socket.emit("assignSymbol", "p1");
    }

    games[pin] = initialState;
    socket.join(pin);
    socket.emit("gameCreated", pin);
  });

  // JOIN GAME
  socket.on("joinGame", ({ pin, username }) => {
    const game = games[pin];
    if (!game) { socket.emit("errorMsg", "Invalid PIN"); return; }

    if (username && !db.users[username]) {
      db.users[username] = { wins: 0, games: {} };
      saveDB();
    }

    if (game.players.p2) { socket.emit("errorMsg", "Full"); return; }

    game.players.p2 = { id: socket.id, name: username };

    // Assign Symbol/Role
    if (game.type === "tictactoe") socket.emit("assignSymbol", "O");
    else socket.emit("assignSymbol", "p2");

    socket.join(pin);

    // Start Payload
    let payload = {
      pin,
      type: game.type,
      players: game.players,
      turn: game.turn
    };

    if (game.type === "tictactoe") payload.board = game.board;
    if (game.type === "memory") {
      payload.scores = game.scores;
      payload.matched = game.matched;
      payload.revealed = game.revealed;
    }
    if (game.type === "mathwars") {
      payload.question = game.question.q;
      payload.scores = game.scores;
    }

    io.to(pin).emit("startGame", payload);
  });

  // TIC-TAC-TOE MOVE
  socket.on("makeMove", ({ pin, index }) => {
    const game = games[pin];
    if (!game || game.type !== "tictactoe") return;
    if (game.board[index] !== "") return;

    // Turn mapping: p1 -> X, p2 -> O
    const isP1Turn = game.turn === "p1";
    const expectedId = isP1Turn ? game.players.p1.id : game.players.p2.id;
    const symbol = isP1Turn ? "X" : "O";

    if (socket.id !== expectedId) return;

    game.board[index] = symbol;

    io.to(pin).emit("updateGame", {
      board: game.board,
      turn: isP1Turn ? "O" : "X"
    });

    const winnerSym = checkWinnerTTT(game.board);
    if (winnerSym) {
      // Map symbol back to player for stats
      if (winnerSym !== "Draw") {
        const winnerRole = winnerSym === "X" ? "p1" : "p2";
        updateLeaderboard(game.players[winnerRole].name, "tictactoe");
      }
      io.to(pin).emit("gameOver", winnerSym); // Send X or O or Draw
    } else {
      game.turn = isP1Turn ? "p2" : "p1";
    }
  });

  // MEMORY MOVE
  socket.on("makeMoveMemory", ({ pin, index }) => {
    const game = games[pin];
    if (!game || game.type !== "memory") return;

    const currentPlayer = game.players[game.turn];
    if (!currentPlayer || currentPlayer.id !== socket.id) return;
    if (game.matched.includes(index) || game.flipped.includes(index)) return;
    if (game.flipped.length >= 2) return;

    game.flipped.push(index);
    io.to(pin).emit("memoryFlip", { index, value: game.board[index] });

    if (game.flipped.length === 2) {
      const [idx1, idx2] = game.flipped;
      if (game.board[idx1] === game.board[idx2]) {
        game.matched.push(idx1, idx2);
        game.scores[game.turn]++;
        game.flipped = [];

        io.to(pin).emit("memoryMatch", { matches: [idx1, idx2], scores: game.scores, turn: game.turn });

        if (game.matched.length === 16) {
          let winner = "Draw";
          if (game.scores.p1 > game.scores.p2) winner = "p1";
          else if (game.scores.p2 > game.scores.p1) winner = "p2";

          if (winner !== "Draw") updateLeaderboard(game.players[winner].name, "memory");
          io.to(pin).emit("gameOver", winner);
        }
      } else {
        setTimeout(() => {
          game.flipped = [];
          game.turn = game.turn === "p1" ? "p2" : "p1";
          io.to(pin).emit("memoryMismatch", { indices: [idx1, idx2], turn: game.turn });
        }, 1000);
      }
    }
  });

  // MATH WARS ANSWER
  socket.on("submitMathAnswer", ({ pin, answer }) => {
    const game = games[pin];
    if (!game || game.type !== "mathwars") return;

    const role = game.players.p1.id === socket.id ? "p1" : (game.players.p2?.id === socket.id ? "p2" : null);
    if (!role) return;

    const numAns = parseInt(answer);
    if (numAns === game.question.ans) {
      // Correct! +1 Point
      game.scores[role]++;

      // Check Win
      if (game.scores[role] >= 10) {
        updateLeaderboard(game.players[role].name, "mathwars");
        io.to(pin).emit("gameOverMath", { winner: role, scores: game.scores });
      } else {
        // Next Question
        game.question = generateMathQuestion();
        io.to(pin).emit("nextMathQuestion", {
          q: game.question.q,
          scores: game.scores,
          scorer: role // Who got it right
        });
      }
    } else {
      // Wrong! -1 Point (Optional penalty, or just ignore)
      // giving feedback might be good
      // For now, simple: Do nothing or decrement? Let's just create new question or keep same?
      // "Race" style: Keep same question until someone gets it? Or new one?
      // Let's Keep same question.
    }
  });

  // CHAT
  socket.on("sendMessage", ({ pin, message, username }) => {
    io.to(pin).emit("receiveMessage", { username, message });
  });

  // LEAVE GAME / HOME
  socket.on("leaveGame", (pin) => {
    const game = games[pin];
    if (game) {
      // Notify other player?
      socket.to(pin).emit("opponentLeft");
      socket.leave(pin);

      // If host leaves or standard cleanup
      // Simplified: If p1 or p2 leaves, handle removal
      if (game.players.p1?.id === socket.id) game.players.p1 = null;
      if (game.players.p2?.id === socket.id) game.players.p2 = null;

      if (!game.players.p1 && !game.players.p2) delete games[pin];
    }
  });

  // RESET GAME
  socket.on("resetGame", (pin) => {
    const game = games[pin];
    if (!game) return;
    if (game.players.p1.id !== socket.id) return; // Only P1/Host

    if (game.type === "tictactoe") {
      game.board = Array(9).fill("");
      game.turn = "p1";
      io.to(pin).emit("restartGame", { type: "tictactoe", board: game.board });
    } else if (game.type === "memory") {
      game.board = createMemoryBoard();
      game.revealed = Array(16).fill(false);
      game.matched = [];
      game.flipped = [];
      game.scores = { p1: 0, p2: 0 };
      game.turn = "p1";
      io.to(pin).emit("restartGame", { type: "memory", scores: game.scores });
    } else if (game.type === "mathwars") {
      game.scores = { p1: 0, p2: 0 };
      game.question = generateMathQuestion();
      io.to(pin).emit("restartGame", { type: "mathwars", scores: game.scores, q: game.question.q });
    }
  });

  socket.on("disconnect", () => {
    // Basic cleanup handled by leaveGame logic usually,
    // but here we just ensure memory leaks aren't huge.
    // Real prod app needs better disconnect handling.
  });
});

server.listen(3000, () => {
  console.log("✅ Arcade Server running on http://localhost:3000");
});
