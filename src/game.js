import {
  GRID_SIZE,
  createInitialState,
  restartGame,
  setDirection,
  tick,
  togglePause,
} from "./snake.js";

const TICK_MS = 120;

const board = document.getElementById("board");
const scoreEl = document.getElementById("score");
const statusEl = document.getElementById("status");
const restartButton = document.getElementById("restart");
const pauseButton = document.getElementById("pause");
const controlButtons = document.querySelectorAll("[data-dir]");

let state = createInitialState(GRID_SIZE);

function buildBoard(size) {
  board.innerHTML = "";
  for (let i = 0; i < size * size; i += 1) {
    const cell = document.createElement("div");
    cell.className = "cell";
    board.appendChild(cell);
  }
}

function render() {
  const cells = board.children;

  for (let i = 0; i < cells.length; i += 1) {
    cells[i].className = "cell";
  }

  if (state.food) {
    getCell(state.food.x, state.food.y).classList.add("food");
  }

  for (const segment of state.snake) {
    getCell(segment.x, segment.y).classList.add("snake");
  }

  scoreEl.textContent = String(state.score);

  if (state.gameOver) {
    statusEl.textContent = "Game over. Press Restart.";
  } else if (state.paused) {
    statusEl.textContent = "Paused.";
  } else {
    statusEl.textContent = "Playing.";
  }

  pauseButton.textContent = state.paused ? "Resume" : "Pause";
}

function getCell(x, y) {
  const index = y * state.size + x;
  return board.children[index];
}

function setInputDirection(direction) {
  state = setDirection(state, direction);
}

function onKeyDown(event) {
  const keyMap = {
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
    w: "up",
    a: "left",
    s: "down",
    d: "right",
    W: "up",
    A: "left",
    S: "down",
    D: "right",
  };

  const direction = keyMap[event.key];
  if (direction) {
    event.preventDefault();
    setInputDirection(direction);
  }

  if (event.key === " " || event.key === "Spacebar") {
    event.preventDefault();
    state = togglePause(state);
    render();
  }
}

function gameLoop() {
  state = tick(state);
  render();
}

restartButton.addEventListener("click", () => {
  state = restartGame(GRID_SIZE);
  render();
});

pauseButton.addEventListener("click", () => {
  state = togglePause(state);
  render();
});

for (const button of controlButtons) {
  button.addEventListener("click", () => {
    setInputDirection(button.dataset.dir);
  });
}

document.addEventListener("keydown", onKeyDown);

buildBoard(GRID_SIZE);
render();
setInterval(gameLoop, TICK_MS);
