let mySymbol = "";
let gameType = ""; // 'tictactoe', 'memory', 'mathwars'
let username = "";
let currentPin = "";
let board = []; // TTT Board
let memoryRevealed = []; // Memory Board State (Booleans)
let memoryMatched = []; // Indices

let isHost = false; // Track host status locally

const socket = io();

// UI Elements
const boardDiv = document.getElementById("board");
const memoryBoardDiv = document.getElementById("memory-board");
const statusTTT = document.getElementById("status-tictactoe");
const statusMemory = document.getElementById("status-memory");
const chatMessages = document.getElementById("messages");
const leaderboardList = document.getElementById("leaderboard-list");

// Math Wars Elements
const statusMath = document.getElementById("math-status");
const mathQuestion = document.getElementById("math-question");
const mathInput = document.getElementById("mathInput");
const mathScores = document.getElementById("math-scores");

// ================================
// LOBBY & LOGIN
// ================================
function enterLobby() {
  const nameInput = document.getElementById("username").value;
  if (!nameInput) {
    alert("Please enter a nickname!");
    return;
  }
  username = nameInput;
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("lobby").classList.remove("hidden");
  document.getElementById("welcome-msg").innerText = `Welcome, ${username}!`;
}

function createGame(type) {
  gameType = type;
  socket.emit("createGame", { gameType: type, username });
}

function joinGame() {
  const pin = document.getElementById("pinInput").value;
  socket.emit("joinGame", { pin, username });
}

function leaveGame() {
  socket.emit("leaveGame", currentPin);
  document.getElementById("game-container").classList.add("hidden");
  document.getElementById("lobby").classList.remove("hidden");
  currentPin = "";
  gameType = "";
  chatMessages.innerHTML = ""; // Clear chat
}

// ================================
// GAME UI HANDLING
// ================================
function showGameUI(type) {
  document.getElementById("lobby").classList.add("hidden");
  document.getElementById("game-container").classList.remove("hidden");

  // Hide all games first
  document.getElementById("game-tictactoe").classList.add("hidden");
  document.getElementById("game-memory").classList.add("hidden");
  document.getElementById("game-mathwars").classList.add("hidden");

  // Show selected
  if (type === "tictactoe") document.getElementById("game-tictactoe").classList.remove("hidden");
  else if (type === "memory") document.getElementById("game-memory").classList.remove("hidden");
  else if (type === "mathwars") document.getElementById("game-mathwars").classList.remove("hidden");
}

function resetGame() {
  socket.emit("resetGame", currentPin);
}

// ================================
// TIC-TAC-TOE LOGIC
// ================================
function renderBoard() {
  boardDiv.innerHTML = "";
  board.forEach((cell, index) => {
    const div = document.createElement("div");
    div.className = "cell";
    div.innerText = cell;
    if (cell === "") div.onclick = () => makeMove(index);
    boardDiv.appendChild(div);
  });
}

function makeMove(index) {
  socket.emit("makeMove", { pin: currentPin, index });
}

// ================================
// MEMORY MATCH LOGIC
// ================================
function renderMemoryBoard(revealed, matched) {
  memoryBoardDiv.innerHTML = "";
  // 4x4 Grid = 16 cards
  for (let i = 0; i < 16; i++) {
    const card = document.createElement("div");
    card.className = "card";

    // Check state from server (we don't know values until flipped)
    if (revealed[i] || matched.includes(i)) {
      card.classList.add("flipped");
      // Set value if we know it (handled by specific events or checking local cache if complex)
      // For simplicity, we rely on DOM update via 'memoryFlip' event to set content, 
      // but if re-rendering whole board, we might need value. 
      // Simplified: We don't re-render whole board often, just update classes/content.
    }

    if (matched.includes(i)) {
      card.classList.add("matched");
    }

    card.onclick = () => {
      socket.emit("makeMoveMemory", { pin: currentPin, index: i });
    };

    // Store index for easy access
    card.dataset.index = i;
    memoryBoardDiv.appendChild(card);
  }
}

// ================================
// MATH WARS LOGIC
// ================================
function handleMathSubmit(event) {
  if (event.key === "Enter") submitMath();
}

function submitMath() {
  const info = mathInput.value;
  if (info) {
    socket.emit("submitMathAnswer", { pin: currentPin, answer: info });
    mathInput.value = "";
    mathInput.focus();
  }
}

function updateMathScores(scores) {
  mathScores.innerText = `P1: ${scores.p1} | P2: ${scores.p2}`;
}

// ================================
// CHAT
// ================================
function handleChat(event) {
  if (event.key === "Enter") {
    const input = document.getElementById("chatInput");
    const message = input.value;
    if (message.trim()) {
      socket.emit("sendMessage", { pin: currentPin, message, username });
      input.value = "";
    }
  }
}

// ================================
// SOCKET EVENTS
// ================================
socket.on("gameCreated", (pin) => {
  currentPin = pin;
  if (gameType === "tictactoe") {
    statusTTT.innerText = `Game PIN: ${pin} (Waiting...)`;
    showGameUI("tictactoe");
  } else if (gameType === "memory") {
    statusMemory.innerText = `Game PIN: ${pin} (Waiting...)`;
    showGameUI("memory");
    renderMemoryBoard([], []); // Init empty
  } else if (gameType === "mathwars") {
    statusMath.innerText = `Game PIN: ${pin} (Waiting...)`;
    showGameUI("mathwars");
    mathQuestion.innerText = "Waiting for Player 2...";
  }
});

socket.on("assignSymbol", (symbol) => {
  mySymbol = symbol;
  isHost = (symbol === "X" || symbol === "p1"); // Set flag

  if (gameType === "tictactoe") {
    statusTTT.innerText = `You are ${symbol}`;
  } else if (gameType === "memory") {
    statusMemory.innerText = `You are Player ${symbol === 'p1' ? '1' : '2'}`;
  } else if (gameType === "mathwars") {
    statusMath.innerText = `Race to 10! You are P${symbol === 'p1' ? '1' : '2'}`;
  }
});

socket.on("startGame", (game) => {
  currentPin = game.pin;
  gameType = game.type;
  showGameUI(gameType);

  const p1 = game.players.p1?.name || game.players.X?.name || "P1";
  const p2 = game.players.p2?.name || game.players.O?.name || "P2";

  if (gameType === "tictactoe") {
    board = game.board;
    renderBoard();
    statusTTT.innerText = `Started! (${p1} vs ${p2})`;
  } else if (gameType === "memory") {
    // Memory
    memoryRevealed = game.revealed;
    memoryMatched = game.matched;
    renderMemoryBoard(memoryRevealed, memoryMatched);
    statusMemory.innerText = `Started! (${p1} vs ${p2})`;
    updateMemoryScores(game.scores);
  } else if (gameType === "mathwars") {
    mathQuestion.innerText = game.question;
    updateMathScores(game.scores);
    statusMath.innerText = "GO! Solve the math!";
  }
});

socket.on("updateGame", (game) => {
  board = game.board;
  renderBoard();
  statusTTT.innerText = game.turn === mySymbol ? "Your Turn!" : "Opponent's Turn";
});

// MEMORY EVENTS
socket.on("memoryFlip", ({ index, value }) => {
  const card = memoryBoardDiv.children[index];
  card.classList.add("flipped");
  card.innerText = value;
});

socket.on("memoryMatch", ({ matches, scores, turn }) => {
  matches.forEach(idx => {
    const card = memoryBoardDiv.children[idx];
    card.classList.add("matched");
  });
  updateMemoryScores(scores);

  // Turn might stay same
  const isMyTurn = (turn === "p1" && mySymbol === "p1") || (turn === "p2" && mySymbol === "p2");
  statusMemory.innerText = isMyTurn ? "Match! Go again!" : "Opponent Matched!";
});

socket.on("memoryMismatch", ({ indices, turn }) => {
  // Flip back
  indices.forEach(idx => {
    const card = memoryBoardDiv.children[idx];
    card.classList.remove("flipped");
    card.innerText = "";
  });

  const isMyTurn = (turn === "p1" && mySymbol === "p1") || (turn === "p2" && mySymbol === "p2");
  statusMemory.innerText = isMyTurn ? "Your Turn" : "Opponent's Turn";
});

function updateMemoryScores(scores) {
  document.getElementById("memory-scores").innerText = `P1: ${scores.p1} | P2: ${scores.p2}`;
}

// MATH WARS EVENTS
socket.on("nextMathQuestion", ({ q, scores, scorer }) => {
  mathQuestion.innerText = q;
  updateMathScores(scores);

  // Visual feedback
  const amIScorer = (scorer === mySymbol || (scorer === "p1" && mySymbol === "p1") || (scorer === "p2" && mySymbol === "p2"));
  statusMath.innerText = amIScorer ? "Correct! +1 Point" : "Opponent scored!";
  statusMath.style.color = amIScorer ? "#00ff00" : "#ff0000";
  setTimeout(() => statusMath.style.color = "white", 1000);
});

socket.on("gameOverMath", ({ winner, scores }) => {
  updateMathScores(scores);
  const amIWinner = (winner === mySymbol || (winner === "p1" && mySymbol === "p1") || (winner === "p2" && mySymbol === "p2"));
  statusMath.innerText = amIWinner ? "VICTORY! You reached 10 points!" : "DEFEAT! Opponent won!";
  mathQuestion.innerText = "GAME OVER";
  if (isHost) document.getElementById("resetBtn-mathwars").classList.remove("hidden");
});

// GENERIC GAME OVER
socket.on("gameOver", (winner) => {
  let msg = "";
  if (winner === "Draw") msg = "It's a Draw!";
  else msg = (winner === mySymbol || (winner === "p1" && mySymbol === "p1") || (winner === "p2" && mySymbol === "p2")) ? "You Win!" : "You Lose!";

  if (gameType === "tictactoe") {
    statusTTT.innerText = msg;
    if (isHost) document.getElementById("resetBtn-tictactoe").classList.remove("hidden");
  }
  else if (gameType === "memory") {
    statusMemory.innerText = msg;
    if (isHost) document.getElementById("resetBtn-memory").classList.remove("hidden");
  }
  else if (gameType === "mathwars") {
    statusMath.innerText = msg;
    if (isHost) document.getElementById("resetBtn-mathwars").classList.remove("hidden");
  }
});

socket.on("restartGame", (game) => {
  // Hide all reset buttons
  document.getElementById("resetBtn-tictactoe").classList.add("hidden");
  document.getElementById("resetBtn-memory").classList.add("hidden");
  document.getElementById("resetBtn-mathwars").classList.add("hidden");

  if (game.type === "tictactoe") {
    board = game.board;
    renderBoard();
    statusTTT.innerText = "Game Restarted!";
  } else if (game.type === "memory") {
    renderMemoryBoard([], []);
    updateMemoryScores(game.scores);
    statusMemory.innerText = "Game Restarted!";
  } else if (game.type === "mathwars") {
    mathQuestion.innerText = game.q;
    updateMathScores(game.scores);
    statusMath.innerText = "Game Restarted!";
  }
});

socket.on("receiveMessage", ({ username, message }) => {
  const msgDiv = document.createElement("div");
  msgDiv.className = "message";
  msgDiv.innerHTML = `<b>${username}:</b> ${message}`;
  chatMessages.appendChild(msgDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
});

socket.on("updateLeaderboard", (list) => {
  leaderboardList.innerHTML = "";
  list.forEach((user, index) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>#${index + 1} ${user.name}</span> <span>${user.wins} Wins</span>`;
    leaderboardList.appendChild(li);
  });
});

socket.on("opponentLeft", () => {
  alert("Opponent left the game!");
  // Maybe reset UI or leave?
  // leaveGame(); // Optional: Auto-leave
});

socket.on("errorMsg", (msg) => { alert(msg); });
