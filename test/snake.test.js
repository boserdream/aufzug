import test from "node:test";
import assert from "node:assert/strict";

import {
  createInitialState,
  setDirection,
  spawnFood,
  tick,
  togglePause,
} from "../src/snake.js";

test("tick moves snake one cell in current direction", () => {
  const state = createInitialState(10, () => 0);
  const next = tick(state, () => 0);

  assert.deepEqual(next.snake[0], { x: 6, y: 5 });
  assert.equal(next.snake.length, 1);
  assert.equal(next.score, 0);
  assert.equal(next.gameOver, false);
});

test("cannot reverse direction directly", () => {
  const state = createInitialState(10, () => 0);
  const updated = setDirection(state, "left");
  const next = tick(updated, () => 0);

  assert.equal(next.direction, "right");
  assert.deepEqual(next.snake[0], { x: 6, y: 5 });
});

test("eating food grows snake and increases score", () => {
  const state = {
    ...createInitialState(10, () => 0),
    snake: [{ x: 5, y: 5 }],
    direction: "right",
    nextDirection: "right",
    food: { x: 6, y: 5 },
  };

  const next = tick(state, () => 0);

  assert.equal(next.snake.length, 2);
  assert.equal(next.score, 1);
  assert.deepEqual(next.snake[0], { x: 6, y: 5 });
  assert.notDeepEqual(next.food, { x: 6, y: 5 });
});

test("wall collision sets game over", () => {
  const state = {
    ...createInitialState(5, () => 0),
    snake: [{ x: 4, y: 2 }],
    direction: "right",
    nextDirection: "right",
  };

  const next = tick(state, () => 0);
  assert.equal(next.gameOver, true);
});

test("self collision sets game over", () => {
  const state = {
    ...createInitialState(10, () => 0),
    snake: [
      { x: 4, y: 4 },
      { x: 4, y: 5 },
      { x: 3, y: 5 },
      { x: 3, y: 4 },
    ],
    direction: "down",
    nextDirection: "left",
    food: { x: 8, y: 8 },
  };

  const next = tick(state, () => 0);
  assert.equal(next.gameOver, true);
});

test("spawnFood never uses occupied cell", () => {
  const snake = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 2, y: 0 },
  ];

  const food = spawnFood(snake, 3, () => 0);
  assert.deepEqual(food, { x: 0, y: 1 });
});

test("tick does not advance while paused", () => {
  const state = togglePause(createInitialState(10, () => 0));
  const next = tick(state, () => 0);
  assert.deepEqual(next, state);
});

test("moving into vacated tail cell does not collide", () => {
  const state = {
    ...createInitialState(10, () => 0),
    snake: [
      { x: 2, y: 2 },
      { x: 2, y: 3 },
      { x: 1, y: 3 },
    ],
    direction: "up",
    nextDirection: "left",
    food: { x: 9, y: 9 },
  };

  const next = tick(state, () => 0);

  assert.equal(next.gameOver, false);
  assert.deepEqual(next.snake, [
    { x: 1, y: 2 },
    { x: 2, y: 2 },
    { x: 2, y: 3 },
  ]);
});

test("spawnFood returns null when board is full", () => {
  const fullSnake = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
  ];

  const food = spawnFood(fullSnake, 2, () => 0);
  assert.equal(food, null);
});
