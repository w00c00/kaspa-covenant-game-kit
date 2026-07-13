import test from "node:test";
import assert from "node:assert/strict";
import { constrainCueBallToD, SnookerEngine, timedChargePower, touchPullPower } from "../src/game-engine.js";

function createEngine() {
  globalThis.ResizeObserver = class { observe() {} };
  globalThis.requestAnimationFrame = () => 0;
  globalThis.window = { devicePixelRatio: 1 };
  const context = { setTransform() {} };
  const canvas = {
    parentElement: {},
    getContext: () => context,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1056, height: 558 }),
    style: {}
  };
  return new SnookerEngine(canvas);
}

test("desktop hold duration maps from a 5% tap to 100% at 1.7 seconds", () => {
  assert.equal(timedChargePower(0), 5);
  assert.equal(timedChargePower(1700), 100);
  assert.equal(timedChargePower(2500), 100);
  assert.ok(Math.abs(timedChargePower(850) - 52.5) < 0.001);
});

test("touch pull distance maps safely to power and clamps at both ends", () => {
  assert.equal(touchPullPower(0, 100), 5);
  assert.equal(touchPullPower(50, 100), 50);
  assert.equal(touchPullPower(100, 100), 100);
  assert.equal(touchPullPower(180, 100), 100);
});

test("cue-ball placement is constrained to the playable half-circle of the D", () => {
  assert.deepEqual(constrainCueBallToD({ x: 220, y: 279 }), { x: 220, y: 279 });
  assert.deepEqual(constrainCueBallToD({ x: 500, y: 279 }), { x: 268, y: 279 });
  const farLeft = constrainCueBallToD({ x: 0, y: 279 });
  assert.equal(farLeft.x, 176);
  assert.equal(farLeft.y, 279);
  const outsideCorner = constrainCueBallToD({ x: 0, y: 0 });
  assert.ok(outsideCorner.x <= 268);
  assert.ok(Math.hypot(outsideCorner.x - 268, outsideCorner.y - 279) <= 92.0001);
});

test("the opening shot is blocked until cue-ball placement is confirmed", () => {
  const engine = createEngine();
  assert.equal(engine.shoot(), false);
  assert.equal(engine.startCuePlacement({ x: 205, y: 245 }), true);
  assert.equal(engine.finishCuePlacement(), true);
  assert.equal(engine.state.cuePlacementConfirmed, true);
  assert.equal(engine.shoot(), true);
});

test("a cue-ball scratch gives the opponent ball in hand inside the D", () => {
  const engine = createEngine();
  engine.startCuePlacement({ x: 210, y: 279 });
  engine.finishCuePlacement();
  engine.shoot();
  const cue = engine.balls.find((ball) => ball.type === "cue");
  cue.active = false;
  engine.shotData.cuePotted = true;
  engine.shotData.firstHit = "red";
  engine.finishShot();
  assert.equal(engine.state.currentPlayer, 1);
  assert.equal(engine.state.cueBallInHand, true);
  assert.equal(engine.state.cuePlacementConfirmed, false);
  assert.equal(cue.active, true);
});

test("a remote shot applies the transmitted spin without overwriting local UI spin", () => {
  const engine = new SnookerEngine(null, {}, { headless: true });
  engine.state.cueBallInHand = false;
  engine.state.cuePlacementConfirmed = true;
  engine.spin = { x: -0.2, y: 0.3 };
  assert.equal(engine.remoteShot(0.4, 68, { x: 0.75, y: -0.6 }), true);
  assert.deepEqual(engine.shotData.spin, { x: 0.75, y: -0.6 });
  assert.deepEqual(engine.spin, { x: -0.2, y: 0.3 });
});

test("a miss or foul during the colours phase keeps the same ball on", () => {
  for (const foul of [false, true]) {
    const engine = new SnookerEngine(null, {}, { headless: true });
    Object.assign(engine.state, { phase: "colors", target: "green", redsRemaining: 0 });
    engine.shotData = {
      target: "green",
      firstHit: foul ? "red" : "green",
      potted: [],
      cuePotted: false,
      power: 20,
      angle: 0,
      spin: { x: 0, y: 0 }
    };
    engine.finishShot();
    assert.equal(engine.state.target, "green");
    assert.equal(engine.state.currentPlayer, 1);
  }
});

test("a colour potted on a foul in the final-colours phase is re-spotted", () => {
  const engine = new SnookerEngine(null, {}, { headless: true });
  Object.assign(engine.state, { phase: "colors", target: "green", redsRemaining: 0 });
  const green = engine.balls.find((ball) => ball.type === "green");
  green.active = false;
  engine.shotData = {
    target: "green",
    firstHit: "red",
    potted: ["green"],
    cuePotted: false,
    power: 25,
    angle: 0,
    spin: { x: 0, y: 0 }
  };
  engine.finishShot();
  assert.equal(green.active, true);
  assert.equal(engine.state.target, "green");
});

test("the colour after the final red is re-spotted before ordered colours begin", () => {
  const engine = new SnookerEngine(null, {}, { headless: true });
  Object.assign(engine.state, { phase: "reds", target: "color", redsRemaining: 0 });
  const blue = engine.balls.find((ball) => ball.type === "blue");
  blue.active = false;
  engine.shotData = {
    target: "color",
    firstHit: "blue",
    potted: ["blue"],
    cuePotted: false,
    power: 30,
    angle: 0,
    spin: { x: 0, y: 0 }
  };
  engine.finishShot();
  assert.equal(blue.active, true);
  assert.equal(engine.state.phase, "colors");
  assert.equal(engine.state.target, "yellow");
});

test("a timeout foul starts the opponent on a red, but preserves ordered colours", () => {
  const reds = new SnookerEngine(null, {}, { headless: true });
  Object.assign(reds.state, { phase: "reds", target: "color", redsRemaining: 8 });
  reds.timeoutFoul();
  assert.equal(reds.state.currentPlayer, 1);
  assert.equal(reds.state.target, "red");
  assert.equal(reds.state.scores[1], 4);

  const colours = new SnookerEngine(null, {}, { headless: true });
  Object.assign(colours.state, { phase: "colors", target: "brown", redsRemaining: 0 });
  colours.timeoutFoul();
  assert.equal(colours.state.target, "brown");
});

test("a concession records the authenticated loser and awards the frame to the opponent", () => {
  const engine = new SnookerEngine(null, {}, { headless: true });
  assert.equal(engine.concede(1), true);
  assert.equal(engine.state.winner, 0);
  assert.equal(engine.state.visits.at(-1).player, 1);
  assert.equal(engine.state.visits.at(-1).reason, "concession");
  assert.equal(engine.concede(0), false);

  const moving = new SnookerEngine(null, {}, { headless: true });
  moving.inMotion = true;
  assert.equal(moving.concede(0), false);
  assert.equal(moving.state.winner, null);
});

test("fixed physics ticks produce identical results across render refresh rates", () => {
  const makeShot = () => {
    const engine = new SnookerEngine(null, {}, { headless: true });
    engine.applyRemoteCuePlacement({ x: 220, y: 279 });
    engine.remoteShot(0.03, 82, { x: 0.7, y: -0.6 });
    return engine;
  };
  const server = makeShot();
  server.runUntilSettled();
  const client = makeShot();
  let render = 0;
  while (client.inMotion && render < 2_000) {
    client.advancePhysics(render % 2 ? 1.25 : 0.5);
    render += 1;
  }
  assert.equal(client.inMotion, false);
  assert.deepEqual(client.state, server.state);
  for (const expected of server.balls) {
    const actual = client.balls.find((item) => item.id === expected.id);
    assert.equal(actual.active, expected.active, expected.id);
    assert.ok(Math.abs(actual.x - expected.x) < 1e-9, `${expected.id} x drifted`);
    assert.ok(Math.abs(actual.y - expected.y) < 1e-9, `${expected.id} y drifted`);
  }
});

test("fractional cue placement stays bit-identical across the client/server round trip", () => {
  const client = new SnookerEngine(null, {}, { headless: true });
  client.startCuePlacement({ x: 250.34782, y: 295.43654 });
  client.finishCuePlacement();
  const transmitted = client.state.cuePlacements.at(-1);

  const server = new SnookerEngine(null, {}, { headless: true });
  server.applyRemoteCuePlacement(JSON.parse(JSON.stringify(transmitted)));
  assert.equal(server.balls.find((item) => item.type === "cue").x, client.balls.find((item) => item.type === "cue").x);
  assert.equal(server.balls.find((item) => item.type === "cue").y, client.balls.find((item) => item.type === "cue").y);

  const shot = { angle: -0.11, power: 96, spin: { x: 0.65, y: -0.4 } };
  client.remoteShot(shot.angle, shot.power, shot.spin);
  server.remoteShot(shot.angle, shot.power, shot.spin);
  client.runUntilSettled();
  server.runUntilSettled();
  assert.deepEqual(client.state, server.state);
  for (const expected of client.balls) {
    const actual = server.balls.find((item) => item.id === expected.id);
    assert.equal(actual.x, expected.x, `${expected.id} x diverged`);
    assert.equal(actual.y, expected.y, `${expected.id} y diverged`);
    assert.equal(actual.active, expected.active, `${expected.id} active state diverged`);
  }
});

test("randomized shots stop naturally without escaping, overlapping or becoming non-finite", () => {
  for (let sample = 0; sample < 48; sample += 1) {
    const engine = new SnookerEngine(null, {}, { headless: true });
    engine.applyRemoteCuePlacement({ x: 205 + sample % 5 * 10, y: 235 + sample % 7 * 13 });
    const angle = -Math.PI + (sample * 2.399) % (Math.PI * 2);
    const power = 5 + sample * 37 % 96;
    engine.remoteShot(angle, power, { x: Math.sin(sample) * 0.9, y: Math.cos(sample * 1.7) * 0.9 });
    let frames = 0;
    while (engine.inMotion && frames < 500) {
      engine.updatePhysics(1);
      frames += 1;
      for (const item of engine.balls.filter((ball) => ball.active)) {
        assert.ok(Number.isFinite(item.x + item.y + item.vx + item.vy), `non-finite ball in sample ${sample}`);
        assert.ok(item.x >= 46 && item.x <= 1010 && item.y >= 24 && item.y <= 534, `escaped table in sample ${sample}`);
      }
    }
    assert.equal(engine.inMotion, false, `sample ${sample} hit the forced-stop limit`);
    assert.ok(frames < 481, `sample ${sample} did not stop naturally`);
    const active = engine.balls.filter((ball) => ball.active);
    for (let i = 0; i < active.length; i += 1) {
      for (let j = i + 1; j < active.length; j += 1) {
        assert.ok(Math.hypot(active[i].x - active[j].x, active[i].y - active[j].y) >= 19, `${active[i].id}/${active[j].id} overlap`);
      }
    }
  }
});

test("spin redirects impacts without creating runaway translational energy", () => {
  const rail = new SnookerEngine(null, {}, { headless: true });
  const railCue = rail.balls.find((item) => item.type === "cue");
  Object.assign(railCue, { x: 400, y: 35, vx: 20, vy: -20, spinSide: 1 });
  const railBefore = Math.hypot(railCue.vx, railCue.vy);
  rail.resolveCushion(railCue);
  assert.ok(Math.hypot(railCue.vx, railCue.vy) <= railBefore);

  const collision = new SnookerEngine(null, {}, { headless: true });
  const cue = collision.balls.find((item) => item.type === "cue");
  const blue = collision.balls.find((item) => item.type === "blue");
  Object.assign(cue, { x: 500, y: 279, vx: 40, vy: 0 });
  Object.assign(blue, { x: 519, y: 279, vx: 0, vy: 0 });
  collision.shotData = { angle: 0, power: 100, spin: { x: 1, y: 1 }, spinApplied: false, firstHit: null };
  const before = cue.vx ** 2 + cue.vy ** 2 + blue.vx ** 2 + blue.vy ** 2;
  collision.resolveCollision(cue, blue);
  const after = cue.vx ** 2 + cue.vy ** 2 + blue.vx ** 2 + blue.vy ** 2;
  assert.ok(after <= before * 1.04 + 1e-9);
});

test("swept pockets catch fast balls while a missed mouth rebounds without teleporting", () => {
  const engine = new SnookerEngine(null, {}, { headless: true });
  const cue = engine.balls.find((item) => item.type === "cue");
  engine.shotData = { potted: [], cuePotted: false };
  Object.assign(cue, { x: 528, y: 0, vx: 0, vy: -200, active: true });
  engine.resolvePocket(cue, 528, 70);
  assert.equal(cue.active, false, "fast ball tunnelled through middle pocket");

  Object.assign(cue, { x: 560, y: 30, vx: 3, vy: -10, active: true, potted: false, spinSide: 0 });
  engine.resolvePocket(cue, 560, 50);
  assert.equal(cue.active, true, "near miss was incorrectly potted");
  engine.resolveCushion(cue);
  assert.equal(cue.y, 44);
  assert.ok(cue.vy > 0, "near miss did not rebound into the table");
});

test("only the colour nominated before the stroke may be potted after a red", () => {
  const foul = new SnookerEngine(null, {}, { headless: true });
  Object.assign(foul.state, { phase: "reds", target: "color", redsRemaining: 8 });
  const pink = foul.balls.find((item) => item.type === "pink");
  pink.active = false;
  foul.shotData = {
    target: "color", nominatedColor: "blue", firstHit: "blue", potted: ["pink"], cuePotted: false,
    power: 30, angle: 0, spin: { x: 0, y: 0 }
  };
  foul.finishShot();
  assert.equal(foul.state.visits.at(-1).foul, true);
  assert.equal(foul.state.scores[1], 6);
  assert.equal(pink.active, true);

  const legal = new SnookerEngine(null, {}, { headless: true });
  Object.assign(legal.state, { phase: "reds", target: "color", redsRemaining: 8 });
  const blue = legal.balls.find((item) => item.type === "blue");
  blue.active = false;
  legal.shotData = {
    target: "color", nominatedColor: "blue", firstHit: "blue", potted: ["blue"], cuePotted: false,
    power: 30, angle: 0, spin: { x: 0, y: 0 }
  };
  legal.finishShot();
  assert.equal(legal.state.visits.at(-1).foul, false);
  assert.equal(legal.state.scores[0], 5);
});

test("a nominated colour is locked before the stroke and cannot follow the accidental first hit", () => {
  const engine = new SnookerEngine(null, {}, { headless: true });
  Object.assign(engine.state, { phase: "reds", target: "color", nominatedColor: "blue", redsRemaining: 8 });
  engine.shotData = {
    target: "color", nominatedColor: "blue", firstHit: "pink", potted: ["pink"], cuePotted: false,
    power: 30, angle: 0, spin: { x: 0, y: 0 }
  };
  engine.finishShot();
  assert.equal(engine.state.visits.at(-1).foul, true);
  assert.equal(engine.state.visits.at(-1).nominatedColor, "blue");
  assert.equal(engine.state.scores[1], 6);
});

test("a foul that removes the final red advances the next player to ordered yellow", () => {
  const engine = new SnookerEngine(null, {}, { headless: true });
  Object.assign(engine.state, { phase: "reds", target: "red", redsRemaining: 1 });
  const red = engine.balls.find((item) => item.type === "red");
  red.active = false;
  engine.shotData = {
    target: "red", firstHit: "blue", potted: ["red"], cuePotted: false,
    power: 30, angle: 0, spin: { x: 0, y: 0 }
  };
  engine.finishShot();
  assert.equal(engine.state.visits.at(-1).foul, true);
  assert.equal(engine.state.redsRemaining, 0);
  assert.equal(engine.state.phase, "colors");
  assert.equal(engine.state.target, "yellow");
});

test("a tied final black is re-spotted and the next black score decides the frame", () => {
  const engine = new SnookerEngine(null, {}, { headless: true });
  Object.assign(engine.state, {
    phase: "colors", target: "black", redsRemaining: 0,
    scores: [50, 43], currentPlayer: 1
  });
  for (const item of engine.balls) {
    if (!["cue", "black"].includes(item.type)) item.active = false;
  }
  const black = engine.balls.find((item) => item.type === "black");
  black.active = false;
  engine.shotData = {
    target: "black", firstHit: "black", potted: ["black"], cuePotted: false,
    power: 25, angle: 0, spin: { x: 0, y: 0 }
  };
  engine.finishShot();
  assert.deepEqual(engine.state.scores, [50, 50]);
  assert.equal(engine.state.winner, null);
  assert.equal(engine.state.respottedBlack, true);
  assert.equal(engine.state.target, "black");
  assert.equal(engine.state.currentPlayer, 0);
  assert.equal(engine.state.cueBallInHand, true);
  assert.equal(black.active, true);

  engine.timeoutFoul();
  assert.deepEqual(engine.state.scores, [50, 57]);
  assert.equal(engine.state.winner, 1);
  assert.equal(engine.state.visits.at(-1).target, "black");
});

test("a foul on the final black awards seven and ends or re-spots the frame correctly", () => {
  const winner = new SnookerEngine(null, {}, { headless: true });
  Object.assign(winner.state, { phase: "colors", target: "black", redsRemaining: 0, scores: [60, 40], currentPlayer: 0 });
  winner.shotData = {
    target: "black", firstHit: null, potted: [], cuePotted: false,
    power: 20, angle: 0, spin: { x: 0, y: 0 }
  };
  winner.finishShot();
  assert.deepEqual(winner.state.scores, [60, 47]);
  assert.equal(winner.state.winner, 0);

  const tied = new SnookerEngine(null, {}, { headless: true });
  Object.assign(tied.state, { phase: "colors", target: "black", redsRemaining: 0, scores: [50, 43], currentPlayer: 0 });
  tied.shotData = {
    target: "black", firstHit: null, potted: [], cuePotted: false,
    power: 20, angle: 0, spin: { x: 0, y: 0 }
  };
  tied.finishShot();
  assert.deepEqual(tied.state.scores, [50, 50]);
  assert.equal(tied.state.winner, null);
  assert.equal(tied.state.respottedBlack, true);
  assert.equal(tied.state.currentPlayer, 1);
});

test("a blocked colour spot never re-spots a ball outside the table or on another ball", () => {
  const engine = new SnookerEngine(null, {}, { headless: true });
  const black = engine.balls.find((item) => item.type === "black");
  black.active = false;
  let index = 0;
  for (const blocker of engine.balls.filter((item) => item !== black).slice(0, 8)) {
    Object.assign(blocker, { x: 910 + index * 22, y: 279, active: true });
    index += 1;
  }
  engine.placeBall(black, 910, 279);
  assert.ok(black.x >= 66 && black.x <= 990 && black.y >= 44 && black.y <= 514);
  assert.equal(engine.balls.some((item) =>
    item !== black && item.active && Math.hypot(item.x - black.x, item.y - black.y) < 20
  ), false);
});
