export const GRID_SIZE = 20;
export const INITIAL_DIRECTION = "right";
export const DIRECTIONS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const OPPOSITE = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};

function randomInt(max) {
  return Math.floor(Math.random() * max);
}

export function createInitialState(size = GRID_SIZE, randomFn = randomInt) {
  const center = Math.floor(size / 2);
  const snake = [{ x: center, y: center }];
  const food = spawnFood(snake, size, randomFn);

  return {
    size,
    snake,
    direction: INITIAL_DIRECTION,
    nextDirection: INITIAL_DIRECTION,
    food,
    score: 0,
    gameOver: false,
    paused: false,
  };
}

export function setDirection(state, direction) {
  if (!DIRECTIONS[direction]) return state;
  if (state.gameOver) return state;
  if (direction === OPPOSITE[state.direction]) return state;

  return {
    ...state,
    nextDirection: direction,
  };
}

export function togglePause(state) {
  if (state.gameOver) return state;
  return {
    ...state,
    paused: !state.paused,
  };
}

export function restartGame(size = GRID_SIZE, randomFn = randomInt) {
  return createInitialState(size, randomFn);
}

export function tick(state, randomFn = randomInt) {
  if (state.gameOver || state.paused) return state;

  const direction = state.nextDirection;
  const head = state.snake[0];
  const delta = DIRECTIONS[direction];
  const nextHead = { x: head.x + delta.x, y: head.y + delta.y };

  if (isOutOfBounds(nextHead, state.size)) {
    return {
      ...state,
      direction,
      gameOver: true,
    };
  }

  const willEat = isSameCell(nextHead, state.food);
  const bodyToCheck = willEat ? state.snake : state.snake.slice(0, -1);
  if (hasCollision(nextHead, bodyToCheck)) {
    return {
      ...state,
      direction,
      gameOver: true,
    };
  }

  const nextSnake = [nextHead, ...state.snake];
  if (!willEat) {
    nextSnake.pop();
  }

  const nextFood = willEat ? spawnFood(nextSnake, state.size, randomFn) : state.food;

  return {
    ...state,
    snake: nextSnake,
    direction,
    food: nextFood,
    score: willEat ? state.score + 1 : state.score,
  };
}

export function spawnFood(snake, size, randomFn = randomInt) {
  const occupied = new Set(snake.map((segment) => `${segment.x},${segment.y}`));
  const available = [];

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const key = `${x},${y}`;
      if (!occupied.has(key)) {
        available.push({ x, y });
      }
    }
  }

  if (available.length === 0) {
    return null;
  }

  const index = randomFn(available.length);
  return available[index];
}

function isOutOfBounds(cell, size) {
  return cell.x < 0 || cell.y < 0 || cell.x >= size || cell.y >= size;
}

function hasCollision(head, snake) {
  return snake.some((segment) => isSameCell(segment, head));
}

function isSameCell(a, b) {
  return a && b && a.x === b.x && a.y === b.y;
}
