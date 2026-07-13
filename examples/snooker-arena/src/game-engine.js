const W = 1056;
const H = 558;
const CUSHION = { left: 56, right: 1000, top: 34, bottom: 524 };
const BALL_R = 10;
const POCKET_R = 23;
const POCKETS = [
  [CUSHION.left, CUSHION.top], [W / 2, CUSHION.top - 2], [CUSHION.right, CUSHION.top],
  [CUSHION.left, CUSHION.bottom], [W / 2, CUSHION.bottom + 2], [CUSHION.right, CUSHION.bottom]
];
const PHYSICS_SUBSTEPS = 5;
// Every power level must decelerate naturally before the safety limit. The
// previous 0.99 left even a 5% shot visibly moving after eight seconds.
const FRICTION = 0.982;
// Below this speed the ball is "still rolling" and counts as in motion,
// so it gets the slide-damping pass instead of being frozen instantly.
const STOP_SPEED = 0.025;
// Below this we hard-zero the velocity so we don't waste frames on
// pixel-level crawl that the player cannot see.
const HARD_STOP = 0.006;
// Extra per-frame damping applied while sliding (between HARD_STOP and
// STOP_SPEED). 0.86 means the ball loses another 14% per frame, so it
// visibly glides for a handful of frames instead of freezing on the spot.
const SLIDE_DAMP = 0.86;
// Cushion restitution — real snooker cushions return ~93-95% of the
// incoming normal velocity.
const CUSHION_RESTITUTION = 0.94;
// Side-spin cushion throw (the deflection you get when a spinning cue
// ball rebounds off a rail). Higher = more visible english on a kick.
const CUSHION_THROW = 0.12;
// Safety: force-resolve a stuck shot after ~8s @ 60fps.
const MAX_SHOT_FRAMES = 480;
const D_CENTER = { x: 268, y: H / 2 };
const D_RADIUS = 102;

const COLORS = {
  cue: { fill: "#f5f0dd", value: 0, label: "母球", labelEn: "Cue ball" },
  red: { fill: "#cb243d", value: 1, label: "红球", labelEn: "Red" },
  yellow: { fill: "#f2c94c", value: 2, label: "黄球", labelEn: "Yellow" },
  green: { fill: "#229966", value: 3, label: "绿球", labelEn: "Green" },
  brown: { fill: "#8c5537", value: 4, label: "棕球", labelEn: "Brown" },
  blue: { fill: "#3182ce", value: 5, label: "蓝球", labelEn: "Blue" },
  pink: { fill: "#ef8faf", value: 6, label: "粉球", labelEn: "Pink" },
  black: { fill: "#101516", value: 7, label: "黑球", labelEn: "Black" }
};

const COLOR_ORDER = ["yellow", "green", "brown", "blue", "pink", "black"];
const SPOTS = {
  cue: [220, H / 2],
  yellow: [268, H / 2 + 102],
  green: [268, H / 2 - 102],
  brown: [268, H / 2],
  blue: [W / 2, H / 2],
  pink: [766, H / 2],
  black: [910, H / 2]
};

function ball(type, x, y, id = type) {
  return { id, type, x, y, vx: 0, vy: 0, spinSide: 0, spinVertical: 0, r: BALL_R, active: true, potted: false };
}

function rackBalls() {
  const balls = [ball("cue", ...SPOTS.cue), ...COLOR_ORDER.map((type) => ball(type, ...SPOTS[type]))];
  let id = 0;
  const startX = 794;
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col <= row; col += 1) {
      balls.push(ball("red", startX + row * 18.2, H / 2 + (col - row / 2) * 20.6, `red-${++id}`));
    }
  }
  return balls;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function timedChargePower(elapsedMs) {
  const progress = clamp(Number(elapsedMs) / 1700, 0, 1);
  return 5 + progress * 95;
}

export function touchPullPower(distance, maxDistance) {
  const maximum = Math.max(1, Number(maxDistance) || 1);
  return Math.max(5, clamp(Number(distance) || 0, 0, maximum) / maximum * 100);
}

export function constrainCueBallToD(point, ballRadius = BALL_R) {
  const limit = D_RADIUS - ballRadius;
  let dx = Math.min(0, Number(point?.x) - D_CENTER.x || 0);
  let dy = Number(point?.y) - D_CENTER.y || 0;
  const length = Math.hypot(dx, dy);
  if (length > limit) {
    dx = dx / length * limit;
    dy = dy / length * limit;
  }
  return { x: D_CENTER.x + dx, y: D_CENTER.y + dy };
}

function speed(ballItem) {
  return Math.hypot(ballItem.vx, ballItem.vy);
}

function capVelocity(item, maximum) {
  const current = speed(item);
  if (!Number.isFinite(current) || current === 0 || current <= maximum) return;
  const scale = maximum / current;
  item.vx *= scale;
  item.vy *= scale;
}

function segmentDistanceSquared(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared > 0 ? clamp(((px - ax) * dx + (py - ay) * dy) / lengthSquared, 0, 1) : 0;
  const x = ax + dx * t;
  const y = ay + dy * t;
  return (px - x) ** 2 + (py - y) ** 2;
}

export class SnookerEngine {
  constructor(canvas, callbacks = {}, options = {}) {
    this.headless = Boolean(options.headless);
    this.canvas = canvas;
    this.ctx = this.headless ? null : canvas.getContext("2d");
    this.callbacks = callbacks;
    this.locale = options.locale === "en" ? "en" : "zh";
    this.balls = rackBalls();
    this.state = {
      scores: [0, 0],
      currentPlayer: 0,
      breakScore: 0,
      target: "red",
      nominatedColor: null,
      phase: "reds",
      redsRemaining: 15,
      respottedBlack: false,
      winner: null,
      shot: 0,
      cueBallInHand: true,
      cuePlacementConfirmed: false,
      cuePlacements: [],
      visits: []
    };
    this.aim = { x: 1, y: 0, angle: 0 };
    this.power = 35;
    this.spin = { x: 0, y: 0 };
    this.charging = false;
    this.chargeStartedAt = 0;
    this.inMotion = false;
    this.placingCueBall = false;
    this.shotData = null;
    this.lastFrame = performance.now();
    this.physicsAccumulator = 0;
    if (!this.headless) {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(canvas.parentElement);
      this.resize();
      this.loop = this.loop.bind(this);
      requestAnimationFrame(this.loop);
    }
  }

  resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(rect.width * ratio));
    this.canvas.height = Math.max(1, Math.round(rect.width * (H / W) * ratio));
    this.canvas.style.height = `${rect.width * (H / W)}px`;
    this.ctx.setTransform((rect.width / W) * ratio, 0, 0, (rect.width / W) * ratio, 0, 0);
  }

  setLocale(locale) {
    this.locale = locale === "en" ? "en" : "zh";
    return this.locale;
  }

  notify(zh, en, type = "neutral") {
    this.callbacks.onMessage?.(this.locale === "en" ? en : zh, type);
  }

  localPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * W / rect.width, y: (event.clientY - rect.top) * H / rect.height };
  }

  setAim(point) {
    if (this.inMotion || this.charging || this.needsCuePlacement() || this.state.winner !== null) return;
    const cue = this.balls.find((item) => item.type === "cue");
    if (!cue?.active) return;
    const dx = point.x - cue.x;
    const dy = point.y - cue.y;
    const length = Math.hypot(dx, dy) || 1;
    this.aim = { x: dx / length, y: dy / length, angle: Math.atan2(dy, dx) };
    if (this.state.target === "color") {
      const aimedColor = this.aimedColor();
      if (aimedColor && aimedColor !== this.state.nominatedColor) this.setNominatedColor(aimedColor);
    }
  }

  aimedColor() {
    const cue = this.balls.find((item) => item.type === "cue" && item.active);
    if (!cue) return null;
    let nearest = null;
    let nearestDistance = Infinity;
    for (const item of this.balls) {
      if (!item.active || item === cue || !COLOR_ORDER.includes(item.type)) continue;
      const dx = item.x - cue.x;
      const dy = item.y - cue.y;
      const forward = dx * this.aim.x + dy * this.aim.y;
      if (forward <= 0 || forward >= nearestDistance) continue;
      const perpendicular = Math.abs(dx * this.aim.y - dy * this.aim.x);
      if (perpendicular <= cue.r + item.r) {
        nearest = item.type;
        nearestDistance = forward;
      }
    }
    return nearest;
  }

  setNominatedColor(type) {
    if (this.inMotion || this.state.target !== "color" || !COLOR_ORDER.includes(type)) return false;
    const available = this.balls.some((item) => item.type === type && item.active);
    if (!available) return false;
    this.state.nominatedColor = type;
    this.callbacks.onNomination?.(type);
    return true;
  }

  setPower(power) {
    if (this.inMotion) return false;
    this.power = clamp(Number(power) || 5, 5, 100);
    this.callbacks.onPower?.(this.power);
    return true;
  }

  beginTimedCharge() {
    if (this.inMotion || this.charging || this.needsCuePlacement() || this.state.winner !== null) return false;
    this.charging = true;
    this.chargeStartedAt = performance.now();
    this.power = 5;
    this.callbacks.onPower?.(this.power);
    this.callbacks.onCharge?.(true);
    return true;
  }

  updateTimedCharge(now) {
    if (!this.charging) return;
    // The cue must stay still while the user is winding up. A remote
    // shot, a stuck-physics force-resolve, or any other code path that
    // left a ball with residual velocity would otherwise cause the
    // table to "drift" under the player's finger. Detect it and
    // cancel the charge so the next click starts clean.
    if (this.inMotion || this.residualBallSpeed() > 0.0008) {
      this.charging = false;
      this.power = 5;
      for (const b of this.balls) {
        if (b.active) { b.vx = 0; b.vy = 0; b.spinSide = 0; b.spinVertical = 0; }
      }
      this.callbacks.onPower?.(this.power);
      this.callbacks.onCharge?.(false);
      return;
    }
    this.power = timedChargePower(now - this.chargeStartedAt);
    this.callbacks.onPower?.(this.power);
  }

  residualBallSpeed() {
    let max = 0;
    for (const b of this.balls) {
      if (!b.active) continue;
      const s = Math.abs(b.vx) + Math.abs(b.vy);
      if (s > max) max = s;
    }
    return max;
  }

  releaseTimedShot() {
    if (!this.charging) return false;
    this.charging = false;
    this.callbacks.onCharge?.(false);
    return this.shoot();
  }

  cancelCharge() {
    if (!this.charging) return false;
    this.charging = false;
    this.callbacks.onCharge?.(false);
    this.notify("已取消击球", "Shot cancelled");
    return true;
  }

  setSpin(x, y) {
    if (this.inMotion) return false;
    const length = Math.hypot(x, y);
    const scale = length > 1 ? 1 / length : 1;
    this.spin = { x: clamp(x * scale, -1, 1), y: clamp(y * scale, -1, 1) };
    this.callbacks.onSpin?.({ ...this.spin });
    return true;
  }

  nudgeAim(degrees) {
    if (this.inMotion || this.needsCuePlacement()) return false;
    const angle = this.aim.angle + Number(degrees) * Math.PI / 180;
    this.aim = { x: Math.cos(angle), y: Math.sin(angle), angle };
    return true;
  }

  shoot(options = {}) {
    if (this.inMotion || this.needsCuePlacement() || this.state.winner !== null) return false;
    const cue = this.balls.find((item) => item.type === "cue");
    if (!cue?.active) return false;
    if (this.state.target === "color" && !COLOR_ORDER.includes(this.state.nominatedColor)) {
      const aimedColor = this.aimedColor();
      if (!aimedColor) {
        this.notify("请先指定本杆彩球", "Nominate a colour before shooting", "foul");
        return false;
      }
      this.setNominatedColor(aimedColor);
    }
    const shotPower = Math.round(this.power);
    const shotAngle = Number(this.aim.angle.toFixed(4));
    const shotSpin = { x: Number(this.spin.x.toFixed(3)), y: Number(this.spin.y.toFixed(3)) };
    const strength = 4 + shotPower * 0.36;
    cue.vx = Math.cos(shotAngle) * strength;
    cue.vy = Math.sin(shotAngle) * strength;
    cue.spinSide = shotSpin.x;
    cue.spinVertical = shotSpin.y;
    this.state.cueBallInHand = false;
    this.state.cuePlacementConfirmed = true;
    this.inMotion = true;
    this.physicsAccumulator = 0;
    this.shotFrames = 0;
    this.state.shot += 1;
    this.shotData = {
      target: this.state.target,
      nominatedColor: this.state.target === "color" ? this.state.nominatedColor : null,
      firstHit: null,
      potted: [],
      cuePotted: false,
      power: shotPower,
      angle: shotAngle,
      spin: shotSpin,
      spinApplied: false
    };
    // After a local shot the cue-ball spin indicator should snap back to
    // centre. A remote shot must not overwrite the local player's UI
    // preference, so we only do this for our own strike.
    if (!options.remote) {
      this.spin = { x: 0, y: 0 };
      this.callbacks.onSpin?.({ ...this.spin });
    }
    if (!options.remote) this.callbacks.onShot?.({ ...this.shotData, player: this.state.currentPlayer });
    return true;
  }

  remoteShot(angle, power, spin = { x: 0, y: 0 }, nominatedColor = null) {
    if (this.inMotion || this.state.winner !== null) return false;
    this.aim = { x: Math.cos(angle), y: Math.sin(angle), angle };
    this.power = clamp(Number(power) || 35, 5, 100);
    const localSpin = this.spin;
    this.spin = {
      x: clamp(Number(spin?.x) || 0, -1, 1),
      y: clamp(Number(spin?.y) || 0, -1, 1)
    };
    if (this.state.target === "color") this.setNominatedColor(nominatedColor);
    const accepted = this.shoot({ remote: true });
    this.spin = localSpin;
    return accepted;
  }

  needsCuePlacement() {
    return Boolean(this.state.cueBallInHand && !this.state.cuePlacementConfirmed);
  }

  // Shot clock expired. Treat as a foul: opponent gets the standard minimum
  // 4 points, break is reset, current player switches, and the visit is
  // recorded so the on-chain transcript does not skip this turn.
  timeoutFoul() {
    if (this.state.winner !== null) return false;
    const player = this.state.currentPlayer;
    const opponent = player === 0 ? 1 : 0;
    const targetAtTimeout = this.state.target;
    const nominatedColor = targetAtTimeout === "color" ? this.state.nominatedColor : null;
    const penalty = Math.max(4, COLORS[targetAtTimeout]?.value || 0, COLORS[nominatedColor]?.value || 0);
    this.state.scores[opponent] += penalty;
    this.state.breakScore = 0;
    this.state.currentPlayer = opponent;
    if (this.state.phase === "colors") {
      // The same ordered colour remains on after a timeout foul.
    } else if (this.state.redsRemaining > 0) {
      // A new visit during the reds phase always starts on a red.
      this.state.target = "red";
    } else {
      this.state.phase = "colors";
      this.state.target = "yellow";
    }
    this.state.shot += 1;
    this.state.visits.push({
      number: this.state.shot,
      player,
      target: targetAtTimeout,
      nominatedColor,
      firstHit: null,
      potted: [],
      power: 0,
      angle: 0,
      spin: { x: 0, y: 0 },
      points: 0,
      foul: true,
      turnEnded: true,
      reason: "timeout"
    });
    this.checkFrameEnd({ foul: true, targetAtStrike: targetAtTimeout, player });
    this.state.nominatedColor = null;
    this.notify(`击球超时 · 对手获得 ${penalty} 分`, `Shot clock expired · Opponent +${penalty}`, "foul");
    this.callbacks.onState?.(this.snapshot());
    return true;
  }

  concede(player) {
    if (![0, 1].includes(player) || this.state.winner !== null || this.inMotion) return false;
    const winner = player === 0 ? 1 : 0;
    this.cancelCharge();
    this.state.shot += 1;
    this.state.breakScore = 0;
    this.state.winner = winner;
    this.state.visits.push({
      number: this.state.shot,
      player,
      target: this.state.target,
      nominatedColor: this.state.nominatedColor,
      firstHit: null,
      potted: [],
      power: 0,
      angle: 0,
      spin: { x: 0, y: 0 },
      points: 0,
      foul: false,
      turnEnded: true,
      reason: "concession"
    });
    this.state.nominatedColor = null;
    this.notify(`Player ${player + 1} 认输`, `Player ${player + 1} conceded`, "foul");
    this.callbacks.onState?.(this.snapshot());
    this.callbacks.onFrameEnd?.(this.snapshot());
    return true;
  }

  enableCuePlacement() {
    if (!this.state.cueBallInHand || this.inMotion) return false;
    this.state.cuePlacementConfirmed = false;
    this.placingCueBall = false;
    this.callbacks.onCuePlacement?.({ active: true, confirmed: false });
    return true;
  }

  cuePlacementPosition(point) {
    const cue = this.balls.find((item) => item.type === "cue");
    let position = constrainCueBallToD(point, cue?.r || BALL_R);
    // Up to 8 nudges, with a deterministic angle so a perfectly-overlapped
    // blocker (dx === dy === 0) is no longer silently treated as "left".
    const directions = [
      [1, 0], [0, 1], [-1, 0], [0, -1],
      [0.71, 0.71], [-0.71, 0.71], [0.71, -0.71], [-0.71, -0.71]
    ];
    for (let attempt = 0; attempt < directions.length; attempt += 1) {
      const blocker = this.balls.find(
        (item) => item !== cue && item.active && Math.hypot(item.x - position.x, item.y - position.y) < BALL_R * 2.15
      );
      if (!blocker) break;
      let dx = position.x - blocker.x;
      let dy = position.y - blocker.y;
      const length = Math.hypot(dx, dy);
      if (length < 0.01) {
        dx = directions[attempt][0];
        dy = directions[attempt][1];
      } else {
        dx /= length;
        dy /= length;
      }
      position = constrainCueBallToD({
        x: position.x + dx * BALL_R * 1.2,
        y: position.y + dy * BALL_R * 1.2
      });
    }
    return position;
  }

  startCuePlacement(point) {
    if (!this.needsCuePlacement() || this.inMotion) return false;
    this.placingCueBall = true;
    this.moveCueBall(point);
    return true;
  }

  moveCueBall(point) {
    if (!this.placingCueBall || !this.state.cueBallInHand) return false;
    const cue = this.balls.find((item) => item.type === "cue");
    const position = this.cuePlacementPosition(point);
    Object.assign(cue, { ...position, vx: 0, vy: 0, active: true, potted: false });
    return true;
  }

  finishCuePlacement(options = {}) {
    if (!this.placingCueBall) return false;
    this.placingCueBall = false;
    this.state.cuePlacementConfirmed = true;
    const cue = this.balls.find((item) => item.type === "cue");
    // Preserve the exact IEEE-754 coordinates used by the local simulation.
    // Rounding these before sending them to the authoritative server looks
    // harmless, but a 0.002px change at the cue ball can choose a different
    // contact order inside the tightly packed reds and completely change the
    // settled rack. JSON round-trips finite doubles losslessly, so use the
    // same values end-to-end.
    const placement = {
      x: cue.x,
      y: cue.y,
      player: this.state.currentPlayer,
      beforeShot: this.state.shot + 1,
      reason: this.state.shot === 0 ? "break" : "cue-ball-in-hand"
    };
    this.state.cuePlacements.push(placement);
    this.callbacks.onCuePlacement?.({ active: false, confirmed: true, placement });
    if (!options.remote) this.callbacks.onCuePlaced?.(placement);
    return true;
  }

  applyRemoteCuePlacement(placement = {}) {
    if (!this.state.cueBallInHand || this.inMotion) return false;
    this.state.cuePlacementConfirmed = false;
    this.placingCueBall = true;
    this.moveCueBall(placement);
    return this.finishCuePlacement({ remote: true });
  }

  loop(now) {
    const elapsedFrames = clamp((now - this.lastFrame) / 16.667, 0, 4);
    this.lastFrame = now;
    this.updateTimedCharge(now);
    this.advancePhysics(elapsedFrames);
    this.render();
    requestAnimationFrame(this.loop);
  }

  advancePhysics(elapsedFrames) {
    if (!this.inMotion) return 0;
    // Fixed 1/60 s physics ticks keep 30/60/120 Hz browsers identical to the
    // authoritative server. Rendering frequency never changes collision order.
    this.physicsAccumulator += clamp(Number(elapsedFrames) || 0, 0, 4);
    let iterations = 0;
    while (this.inMotion && this.physicsAccumulator >= 1 && iterations < 4) {
      this.updatePhysics(1);
      this.physicsAccumulator -= 1;
      iterations += 1;
    }
    if (iterations === 4 && this.physicsAccumulator > 1) this.physicsAccumulator = 1;
    return iterations;
  }

  updatePhysics(dt) {
    for (let step = 0; step < PHYSICS_SUBSTEPS; step += 1) {
      const subDt = dt / PHYSICS_SUBSTEPS;
      const active = this.balls.filter((item) => item.active);
      for (const item of active) {
        if (item.type === "cue" && Math.abs(item.spinSide || 0) > 0.01 && speed(item) > 1) {
          const curve = item.spinSide * 0.00014 * subDt;
          const cos = Math.cos(curve);
          const sin = Math.sin(curve);
          const vx = item.vx * cos - item.vy * sin;
          item.vy = item.vx * sin + item.vy * cos;
          item.vx = vx;
        }
        const previousX = item.x;
        const previousY = item.y;
        item.x += item.vx * subDt;
        item.y += item.vy * subDt;
        this.resolvePocket(item, previousX, previousY);
        if (item.active) this.resolveCushion(item);
      }
      for (let i = 0; i < active.length; i += 1) {
        if (!active[i].active) continue;
        for (let j = i + 1; j < active.length; j += 1) {
          if (active[j].active) this.resolveCollision(active[i], active[j]);
        }
      }
    }
    let moving = false;
    this.shotFrames = (this.shotFrames || 0) + 1;
    for (const item of this.balls) {
      if (!item.active) continue;
      const factor = Math.pow(FRICTION, dt);
      item.vx *= factor;
      item.vy *= factor;
      item.spinSide *= Math.pow(0.996, dt);
      item.spinVertical *= Math.pow(0.994, dt);
      const spd = speed(item);
      if (spd < HARD_STOP) {
        // Truly negligible — hard-stop to keep state clean.
        item.vx = 0;
        item.vy = 0;
      } else if (spd < STOP_SPEED) {
        // Below the moving threshold but still visible to the eye.
        // Apply extra damping so the ball *glides* to a stop rather
        // than freezing the moment it crosses the line.
        item.vx *= SLIDE_DAMP;
        item.vy *= SLIDE_DAMP;
        moving = true;
      } else {
        moving = true;
      }
    }
    if (this.shotFrames > MAX_SHOT_FRAMES) {
      // Force-resolve path: zero out any remaining motion so the next
      // shot (or the next charge) starts from a fully settled table.
      for (const item of this.balls) {
        if (item.active) { item.vx = 0; item.vy = 0; item.spinSide = 0; item.spinVertical = 0; }
      }
    }
    if (!moving || this.shotFrames > MAX_SHOT_FRAMES) {
      this.shotFrames = 0;
      this.finishShot();
    }
  }

  runUntilSettled(maxFrames = MAX_SHOT_FRAMES + 2) {
    let frames = 0;
    while (this.inMotion && frames < maxFrames) {
      this.updatePhysics(1);
      frames += 1;
    }
    return this.exportSnapshot();
  }

  resolveCushion(item) {
    const incomingSpeed = speed(item);
    const beforeVx = item.vx;
    const beforeVy = item.vy;
    let hitTop = false;
    let hitBottom = false;
    let hitLeft = false;
    let hitRight = false;
    if (item.y - item.r < CUSHION.top) {
      item.y = CUSHION.top + item.r;
      item.vy = Math.abs(item.vy) * CUSHION_RESTITUTION;
      hitTop = true;
    }
    if (item.y + item.r > CUSHION.bottom) {
      item.y = CUSHION.bottom - item.r;
      item.vy = -Math.abs(item.vy) * CUSHION_RESTITUTION;
      hitBottom = true;
    }
    if (item.x - item.r < CUSHION.left) {
      item.x = CUSHION.left + item.r;
      item.vx = Math.abs(item.vx) * CUSHION_RESTITUTION;
      hitLeft = true;
    }
    if (item.x + item.r > CUSHION.right) {
      item.x = CUSHION.right - item.r;
      item.vx = -Math.abs(item.vx) * CUSHION_RESTITUTION;
      hitRight = true;
    }
    if (item.type === "cue" && (hitTop || hitBottom || hitLeft || hitRight)) {
      const side = item.spinSide || 0;
      if (hitTop) item.vx += side * Math.abs(beforeVy) * CUSHION_THROW;
      if (hitBottom) item.vx -= side * Math.abs(beforeVy) * CUSHION_THROW;
      if (hitLeft) item.vy -= side * Math.abs(beforeVx) * CUSHION_THROW;
      if (hitRight) item.vy += side * Math.abs(beforeVx) * CUSHION_THROW;
    }
    // Spin redirects a rebound, but may not manufacture translational energy.
    if (hitTop || hitBottom || hitLeft || hitRight) capVelocity(item, incomingSpeed * CUSHION_RESTITUTION);
  }

  resolvePocket(item, previousX = item.x, previousY = item.y) {
    // Test the whole path travelled during this substep, preventing a fast
    // ball from tunnelling through a pocket. Misses bounce on a real boundary;
    // no later "snap back inside" branch is needed.
    const captured = POCKETS.some(([x, y]) =>
      segmentDistanceSquared(x, y, previousX, previousY, item.x, item.y) < POCKET_R * POCKET_R
    );
    if (!captured) return;
    item.active = false;
    item.potted = true;
    item.vx = 0;
    item.vy = 0;
    if (item.type === "cue") this.shotData.cuePotted = true;
    else this.shotData.potted.push(item.type);
    this.callbacks.onPocket?.(item.type);
  }

  resolveCollision(a, b) {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    const measuredDistance = Math.hypot(dx, dy);
    let distance = measuredDistance;
    const minDistance = a.r + b.r;
    if (distance >= minDistance) return;
    if (distance < 1e-8) {
      dx = String(a.id) < String(b.id) ? 1 : -1;
      dy = 0;
      distance = 1;
    }
    const nx = dx / distance;
    const ny = dy / distance;
    const overlap = minDistance - measuredDistance;
    a.x -= nx * overlap / 2;
    a.y -= ny * overlap / 2;
    b.x += nx * overlap / 2;
    b.y += ny * overlap / 2;
    const relative = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
    if (relative <= 0) return;
    const energyBefore = a.vx ** 2 + a.vy ** 2 + b.vx ** 2 + b.vy ** 2;
    const impulse = relative * 0.97;
    a.vx -= impulse * nx;
    a.vy -= impulse * ny;
    b.vx += impulse * nx;
    b.vy += impulse * ny;
    this.callbacks.onCollision?.(Math.abs(impulse));
    const cue = a.type === "cue" ? a : (b.type === "cue" ? b : null);
    const object = cue === a ? b : (cue === b ? a : null);
    if (cue && object && this.shotData && !this.shotData.spinApplied) {
      const shotAngle = this.shotData.angle;
      const shotStrength = 4 + this.shotData.power * 0.36;
      const topBack = this.shotData.spin?.y || 0;
      const side = this.shotData.spin?.x || 0;
      cue.vx += Math.cos(shotAngle) * topBack * shotStrength * 0.18;
      cue.vy += Math.sin(shotAngle) * topBack * shotStrength * 0.18;
      const tx = -ny;
      const ty = nx;
      const throwAmount = side * shotStrength * 0.045;
      object.vx += tx * throwAmount;
      object.vy += ty * throwAmount;
      cue.vx -= tx * throwAmount * 0.55;
      cue.vy -= ty * throwAmount * 0.55;
      this.shotData.spinApplied = true;
    }
    const energyAfter = a.vx ** 2 + a.vy ** 2 + b.vx ** 2 + b.vy ** 2;
    const spinMagnitude = Math.min(1, Math.hypot(this.shotData?.spin?.x || 0, this.shotData?.spin?.y || 0));
    const maximumEnergy = energyBefore * (1 + spinMagnitude * 0.04);
    if (energyAfter > maximumEnergy && energyAfter > 0) {
      const scale = Math.sqrt(maximumEnergy / energyAfter);
      a.vx *= scale;
      a.vy *= scale;
      b.vx *= scale;
      b.vy *= scale;
    }
    if (!this.shotData?.firstHit) {
      if (a.type === "cue") this.shotData.firstHit = b.type;
      else if (b.type === "cue") this.shotData.firstHit = a.type;
    }
  }

  targetMatches(type, target) {
    if (target === "red") return type === "red";
    if (target === "color") return type !== "red" && type !== "cue";
    return type === target;
  }

  finishShot() {
    this.inMotion = false;
    // If the table was still settling while the user was mid-charge,
    // drop the charge so the power indicator does not keep climbing
    // from a stale start time.
    if (this.charging) {
      this.charging = false;
      this.power = 5;
      this.callbacks.onPower?.(this.power);
      this.callbacks.onCharge?.(false);
    }
    const shot = this.shotData || { target: this.state.target, potted: [] };
    // Capture the target that was valid at the moment the cue was struck so a
    // foul does not silently reset the order back to "red" or "yellow".
    const targetAtStrike = shot.target || this.state.target;
    const nominatedColor = targetAtStrike === "color" && COLOR_ORDER.includes(shot.nominatedColor)
      ? shot.nominatedColor
      : null;
    // Nomination is locked before the stroke. It cannot be retroactively
    // changed to whichever colour happened to be contacted first.
    const wrongFirst = targetAtStrike === "color"
      ? !nominatedColor || shot.firstHit !== nominatedColor
      : !shot.firstHit || !this.targetMatches(shot.firstHit, targetAtStrike);
    const wrongPotted = targetAtStrike === "color"
      ? shot.potted.some((type) => type !== nominatedColor)
      : shot.potted.some((type) => !this.targetMatches(type, targetAtStrike));
    const foul = shot.cuePotted || wrongFirst || wrongPotted;
    const player = this.state.currentPlayer;
    const opponent = player === 0 ? 1 : 0;
    let points = 0;
    let turnEnded = false;

    if (foul) {
      const highest = Math.max(
        4,
        COLORS[targetAtStrike]?.value || 0,
        COLORS[nominatedColor]?.value || 0,
        ...shot.potted.map((type) => COLORS[type]?.value || 0),
        COLORS[shot.firstHit]?.value || 0
      );
      this.state.scores[opponent] += highest;
      // Standard snooker rule: a foul always costs at least 4 points.
      this.state.breakScore = 0;
      this.state.currentPlayer = opponent;
      if (this.state.phase === "colors") {
        this.state.target = targetAtStrike;
      } else if (this.state.redsRemaining > 0) {
        this.state.target = "red";
      } else {
        this.state.phase = "colors";
        this.state.target = "yellow";
      }
      // Track that a ball was actually potted on a foul (e.g. red on a
      // colour shot) so redsRemaining stays correct and the colour ball
      // is not re-spotted if it was the right ball to play.
      const pottedReds = shot.potted.filter((type) => type === "red").length;
      this.state.redsRemaining = Math.max(0, this.state.redsRemaining - pottedReds);
      if (this.state.phase !== "colors" && this.state.redsRemaining === 0) {
        this.state.phase = "colors";
        this.state.target = "yellow";
      }
      turnEnded = true;
      this.notify(`犯规 · 对手获得 ${highest} 分`, `Foul · Opponent +${highest}`, "foul");
    } else if (shot.potted.length) {
      if (targetAtStrike === "red") {
        points = shot.potted.filter((type) => type === "red").length;
        this.state.redsRemaining = Math.max(0, this.state.redsRemaining - points);
        this.state.target = "color";
      } else if (targetAtStrike === "color") {
        points = COLORS[shot.potted[0]]?.value || 0;
        this.state.target = this.state.redsRemaining > 0 ? "red" : "yellow";
        // Defer the phase change to AFTER respotBalls runs — otherwise
        // the just-potted colour would be treated as a "colours-phase"
        // pot and would not be re-spotted. The colour after the final
        // red is legally still part of the reds-phase rhythm and MUST
        // come back to the table.
        if (this.state.redsRemaining === 0) this.pendingPhaseChange = "colors";
      } else {
        points = COLORS[targetAtStrike]?.value || 0;
        this.state.target = this.nextColorTarget(targetAtStrike);
      }
      this.state.scores[player] += points;
      this.state.breakScore += points;
      this.notify(`漂亮！+${points} 分`, `Great shot! +${points}`, "score");
    } else {
      this.state.breakScore = 0;
      this.state.currentPlayer = opponent;
      if (this.state.phase === "colors") {
        this.state.target = targetAtStrike;
      } else if (this.state.redsRemaining > 0) {
        this.state.target = "red";
      } else {
        this.state.phase = "colors";
        this.state.target = "yellow";
      }
      turnEnded = true;
      this.notify("回合交换", "Turn changed");
    }

    const pottedSnapshot = [...shot.potted];
    this.respotBalls(shot, foul);
    // Apply any deferred phase change (e.g. reds → colours) AFTER
    // respot, so the colour that was just potted alongside the final
    // red comes back to the table first.
    if (this.pendingPhaseChange) {
      this.state.phase = this.pendingPhaseChange;
      this.pendingPhaseChange = null;
    }
    if (shot.cuePotted) {
      this.state.cueBallInHand = true;
      this.state.cuePlacementConfirmed = false;
      this.notify("母球摔袋 · 对手获得 D 区手中球", "Cue ball potted · Opponent has ball in hand in the D", "foul");
    }
    this.state.visits.push({
      number: this.state.shot,
      player,
      target: shot.target,
      firstHit: shot.firstHit,
      nominatedColor,
      potted: pottedSnapshot,
      power: shot.power,
      angle: shot.angle,
      spin: shot.spin || { x: 0, y: 0 },
      points,
      foul,
      turnEnded
    });
    this.checkFrameEnd({ foul, targetAtStrike, player });
    this.state.nominatedColor = null;
    this.shotData = null;
    this.callbacks.onState?.(this.snapshot());
    this.callbacks.onResolved?.(this.exportSnapshot());
  }

  nextColorTarget(current = "") {
    if (!current || current === "color") return "yellow";
    const index = COLOR_ORDER.indexOf(current);
    return COLOR_ORDER[index + 1] || "black";
  }

  respotBalls(shot, foul) {
    const cue = this.balls.find((item) => item.type === "cue");
    if (!cue.active) this.placeBall(cue, ...SPOTS.cue);
    for (const type of shot.potted) {
      if (type === "red") continue;
      const item = this.balls.find((entry) => entry.type === type);
      if (!item) continue;
      let shouldRespot;
      if (this.state.phase === "colors") {
        // Standard snooker: in the colours phase every colour that
        // goes in stays out. The whole point of the phase is to pot
        // them one at a time in order — re-spotting them would defeat
        // the purpose. Exception: if the pot was the result of a foul
        // (i.e. an "innocent" colour bumped in while the player was
        // aiming at the wrong ball), re-spot it so the table doesn't
        // silently shrink mid-frame.
        shouldRespot = foul;
      } else {
        // Reds phase: every colour comes back to its spot so the
        // "red, colour, red, colour" rhythm can keep going.
        shouldRespot = true;
      }
      if (shouldRespot) this.placeBall(item, ...SPOTS[type]);
    }
  }

  placeBall(item, x, y) {
    const positionFree = (candidateX, candidateY) =>
      candidateX >= CUSHION.left + item.r && candidateX <= CUSHION.right - item.r &&
      candidateY >= CUSHION.top + item.r && candidateY <= CUSHION.bottom - item.r &&
      !this.balls.some((other) =>
        other !== item && other.active && Math.hypot(other.x - candidateX, other.y - candidateY) < BALL_R * 2.1
      );
    const candidates = [[x, y]];
    if (COLOR_ORDER.includes(item.type)) {
      for (const type of ["black", "pink", "blue", "brown", "green", "yellow"]) {
        candidates.push(SPOTS[type]);
      }
    }
    const spacing = BALL_R * 2.2;
    for (let radius = spacing; radius < W; radius += spacing) {
      candidates.push([x + radius, y], [x - radius, y]);
      for (const vertical of [-1, 1]) {
        candidates.push([x, y + vertical * radius], [x + radius * 0.7, y + vertical * radius * 0.7], [x - radius * 0.7, y + vertical * radius * 0.7]);
      }
    }
    const selected = candidates.find(([candidateX, candidateY]) => positionFree(candidateX, candidateY));
    if (!selected) throw new Error(`No legal table position is available for ${item.id}`);
    Object.assign(item, {
      x: selected[0], y: selected[1], vx: 0, vy: 0,
      spinSide: 0, spinVertical: 0, active: true, potted: false
    });
  }

  prepareRespottedBlack(player = this.state.currentPlayer) {
    const black = this.balls.find((item) => item.type === "black");
    if (black && !black.active) this.placeBall(black, ...SPOTS.black);
    this.state.respottedBlack = true;
    this.state.target = "black";
    this.state.nominatedColor = null;
    this.state.breakScore = 0;
    this.state.currentPlayer = player === 0 ? 1 : 0;
    this.state.cueBallInHand = true;
    this.state.cuePlacementConfirmed = false;
    this.notify("比分相同 · 自动重置黑球决胜", "Scores tied · Black re-spotted for the decider");
  }

  setFrameWinner() {
    const [a, b] = this.state.scores;
    this.state.winner = a > b ? 0 : 1;
    this.callbacks.onFrameEnd?.(this.snapshot());
  }

  checkFrameEnd({ foul = false, targetAtStrike = this.state.target, player = this.state.currentPlayer } = {}) {
    if (this.state.phase !== "colors") return;
    const [a, b] = this.state.scores;
    // Once black is the only ball on, its first pot or foul ends the frame.
    // A tie after that score is the sole reason to re-spot black.
    if (targetAtStrike === "black" && foul) {
      if (a === b) this.prepareRespottedBlack(player);
      else this.setFrameWinner();
      return;
    }
    const coloredActive = COLOR_ORDER.filter((type) => this.balls.some((item) => item.type === type && item.active));
    if (coloredActive.length > 0) return;
    if (a === b) {
      this.prepareRespottedBlack(player);
      return;
    }
    this.setFrameWinner();
  }

  snapshot() {
    return JSON.parse(JSON.stringify(this.state));
  }

  exportSnapshot() {
    return {
      state: this.snapshot(),
      balls: this.balls.map((item) => ({ ...item })),
      aim: { ...this.aim },
      power: this.power,
      spin: { ...this.spin },
      inMotion: this.inMotion
    };
  }

  importSnapshot(snapshot = {}) {
    if (snapshot.state) this.state = JSON.parse(JSON.stringify(snapshot.state));
    if (Array.isArray(snapshot.balls)) this.balls = snapshot.balls.map((item) => ({ ...item }));
    if (snapshot.aim) this.aim = { ...snapshot.aim };
    if (Number.isFinite(snapshot.power)) this.power = snapshot.power;
    if (snapshot.spin) this.spin = { ...snapshot.spin };
    this.inMotion = Boolean(snapshot.inMotion);
    this.physicsAccumulator = 0;
    this.shotData = null;
    this.callbacks.onState?.(this.snapshot());
    return this;
  }

  reset() {
    this.balls = rackBalls();
    Object.assign(this.state, {
      scores: [0, 0], currentPlayer: 0, breakScore: 0, target: "red", phase: "reds",
      nominatedColor: null, redsRemaining: 15, respottedBlack: false, winner: null, shot: 0, cueBallInHand: true,
      cuePlacementConfirmed: false, cuePlacements: [], visits: []
    });
    this.charging = false;
    this.inMotion = false;
    this.physicsAccumulator = 0;
    this.placingCueBall = false;
    this.callbacks.onState?.(this.snapshot());
    this.callbacks.onCuePlacement?.({ active: true, confirmed: false });
  }

  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);
    this.drawTable(ctx);
    this.drawPlacementOverlay(ctx);
    this.drawGuide(ctx);
    for (const item of this.balls) if (item.active) this.drawBall(ctx, item);
    this.drawCue(ctx);
  }

  drawTable(ctx) {
    const wood = ctx.createLinearGradient(0, 0, 0, H);
    wood.addColorStop(0, "#7a4f28");
    wood.addColorStop(0.2, "#2d1a10");
    wood.addColorStop(0.8, "#17100c");
    wood.addColorStop(1, "#6e4524");
    ctx.fillStyle = wood;
    this.roundRect(ctx, 4, 4, W - 8, H - 8, 35);
    ctx.fill();

    ctx.fillStyle = "#09120f";
    this.roundRect(ctx, 24, 18, W - 48, H - 36, 25);
    ctx.fill();

    const cloth = ctx.createRadialGradient(W * 0.45, H * 0.42, 20, W / 2, H / 2, 620);
    cloth.addColorStop(0, "#16785e");
    cloth.addColorStop(0.58, "#0d5c49");
    cloth.addColorStop(1, "#073b30");
    ctx.fillStyle = cloth;
    ctx.fillRect(CUSHION.left, CUSHION.top, CUSHION.right - CUSHION.left, CUSHION.bottom - CUSHION.top);

    // Soft inner rail shadow — thin, low-contrast band that hints at the
    // cushion edge without producing a hard visual seam that the eye
    // mistakes for the ball-stop line.
    const railBand = 9;
    const railDark = "rgba(6, 28, 22, 0.55)";
    ctx.fillStyle = railDark;
    ctx.fillRect(CUSHION.left, CUSHION.top, CUSHION.right - CUSHION.left, railBand);
    ctx.fillRect(CUSHION.left, CUSHION.bottom - railBand, CUSHION.right - CUSHION.left, railBand);
    ctx.fillRect(CUSHION.left, CUSHION.top, railBand, CUSHION.bottom - CUSHION.top);
    ctx.fillRect(CUSHION.right - railBand, CUSHION.top, railBand, CUSHION.bottom - CUSHION.top);
    // 1px highlight just inside the band so the rail reads as a bevel
    // instead of a thick painted stripe.
    ctx.strokeStyle = "rgba(120, 220, 180, 0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(CUSHION.left + railBand + 0.5, CUSHION.top);
    ctx.lineTo(CUSHION.right - railBand - 0.5, CUSHION.top);
    ctx.moveTo(CUSHION.left + railBand + 0.5, CUSHION.bottom);
    ctx.lineTo(CUSHION.right - railBand - 0.5, CUSHION.bottom);
    ctx.moveTo(CUSHION.left, CUSHION.top + railBand + 0.5);
    ctx.lineTo(CUSHION.left, CUSHION.bottom - railBand - 0.5);
    ctx.moveTo(CUSHION.right, CUSHION.top + railBand + 0.5);
    ctx.lineTo(CUSHION.right, CUSHION.bottom - railBand - 0.5);
    ctx.stroke();

    ctx.save();
    ctx.globalAlpha = 0.42;
    ctx.strokeStyle = "#d5e6d8";
    ctx.lineWidth = 1.4;
    const baulkInset = railBand + 1;
    ctx.beginPath();
    ctx.moveTo(268, CUSHION.top + baulkInset);
    ctx.lineTo(268, CUSHION.bottom - baulkInset);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(268, H / 2, 102, Math.PI / 2, -Math.PI / 2);
    ctx.stroke();
    ctx.restore();

    for (const [x, y] of POCKETS) {
      const pocket = ctx.createRadialGradient(x - 3, y - 4, 3, x, y, POCKET_R);
      pocket.addColorStop(0, "#020403");
      pocket.addColorStop(0.72, "#050806");
      pocket.addColorStop(1, "#2a1b12");
      ctx.beginPath();
      ctx.fillStyle = pocket;
      ctx.arc(x, y, POCKET_R, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.save();
    ctx.globalAlpha = 0.04;
    ctx.strokeStyle = "#ffffff";
    for (let y = 70; y < H - 50; y += 7) {
      ctx.beginPath();
      ctx.moveTo(70, y);
      ctx.quadraticCurveTo(W / 2, y + Math.sin(y) * 3, W - 70, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawBall(ctx, item) {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.55)";
    ctx.shadowBlur = 7;
    ctx.shadowOffsetX = 3;
    ctx.shadowOffsetY = 4;
    const gradient = ctx.createRadialGradient(item.x - 3.8, item.y - 4.5, 1, item.x, item.y, item.r + 2);
    gradient.addColorStop(0, "#ffffff");
    gradient.addColorStop(0.14, COLORS[item.type].fill);
    gradient.addColorStop(0.72, COLORS[item.type].fill);
    gradient.addColorStop(1, "#050807");
    ctx.beginPath();
    ctx.fillStyle = gradient;
    ctx.arc(item.x, item.y, item.r, 0, Math.PI * 2);
    ctx.fill();
    if (item.type === "cue" && !this.inMotion) {
      ctx.shadowColor = "transparent";
      ctx.beginPath();
      ctx.fillStyle = "#33d6a4";
      ctx.arc(item.x + this.spin.x * 5.4, item.y - this.spin.y * 5.4, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    if (item.type === "cue" && this.state.cueBallInHand) {
      ctx.save();
      ctx.strokeStyle = this.state.cuePlacementConfirmed ? "rgba(94,231,189,.62)" : "rgba(255,255,255,.75)";
      ctx.lineWidth = 1.3;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(item.x, item.y, item.r + 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawPlacementOverlay(ctx) {
    if (!this.needsCuePlacement()) return;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(D_CENTER.x, D_CENTER.y - D_RADIUS);
    ctx.arc(D_CENTER.x, D_CENTER.y, D_RADIUS, -Math.PI / 2, Math.PI / 2, true);
    ctx.closePath();
    ctx.fillStyle = "rgba(94,231,189,.105)";
    ctx.fill();
    ctx.strokeStyle = "rgba(146,244,212,.8)";
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 6]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(224,250,241,.82)";
    ctx.font = "700 11px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(this.locale === "en" ? "BALL IN HAND · PLACE IN THE D" : "BALL IN HAND · D 区摆白球", D_CENTER.x - 48, D_CENTER.y - 118);
    ctx.restore();
  }

  aimCollision(cue) {
    const distances = [];
    if (this.aim.x > 0) distances.push((CUSHION.right - cue.r - cue.x) / this.aim.x);
    if (this.aim.x < 0) distances.push((CUSHION.left + cue.r - cue.x) / this.aim.x);
    if (this.aim.y > 0) distances.push((CUSHION.bottom - cue.r - cue.y) / this.aim.y);
    if (this.aim.y < 0) distances.push((CUSHION.top + cue.r - cue.y) / this.aim.y);
    const filtered = distances.filter((value) => Number.isFinite(value) && value > 0);
    let distance = filtered.length ? Math.min(...filtered) : 2000;
    let target = null;
    for (const item of this.balls) {
      if (!item.active || item === cue) continue;
      const rx = item.x - cue.x;
      const ry = item.y - cue.y;
      const projection = rx * this.aim.x + ry * this.aim.y;
      if (projection <= 0) continue;
      const perpendicularSq = rx * rx + ry * ry - projection * projection;
      const radius = cue.r + item.r;
      if (perpendicularSq >= radius * radius) continue;
      const contactDistance = projection - Math.sqrt(radius * radius - perpendicularSq);
      if (contactDistance > 0 && contactDistance < distance) {
        distance = contactDistance;
        target = item;
      }
    }
    // No ball sits on the aim line: pick the nearest ball ahead of the
    // cue by perpendicular distance (so the guide still points at a
    // useful target on long shots). Keep the cushion distance so the
    // guide line reaches the table edge, not just the ball.
    if (!target) {
      let bestPerpSq = Infinity;
      let bestBall = null;
      for (const item of this.balls) {
        if (!item.active || item === cue) continue;
        const rx = item.x - cue.x;
        const ry = item.y - cue.y;
        const projection = rx * this.aim.x + ry * this.aim.y;
        if (projection <= 0) continue;
        const perpSq = rx * rx + ry * ry - projection * projection;
        if (perpSq < bestPerpSq) {
          bestPerpSq = perpSq;
          bestBall = item;
        }
      }
      if (bestBall) target = bestBall;
    }
    return { distance: Math.min(distance, 2000), target };
  }

  drawGuide(ctx) {
    if (this.inMotion || this.needsCuePlacement() || this.state.winner !== null) return;
    const cue = this.balls.find((item) => item.type === "cue" && item.active);
    if (!cue) return;
    ctx.save();
    const collision = this.aimCollision(cue);
    const endX = cue.x + this.aim.x * collision.distance;
    const endY = cue.y + this.aim.y * collision.distance;
    ctx.setLineDash([8, 7]);
    ctx.strokeStyle = "rgba(255,255,255,.67)";
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(cue.x + this.aim.x * 15, cue.y + this.aim.y * 15);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    ctx.setLineDash([]);
    if (collision.target) {
      ctx.strokeStyle = "rgba(255,255,255,.45)";
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(endX, endY, cue.r, 0, Math.PI * 2);
      ctx.stroke();
      const nx = (collision.target.x - endX) / (cue.r + collision.target.r);
      const ny = (collision.target.y - endY) / (cue.r + collision.target.r);
      ctx.strokeStyle = "rgba(94,231,189,.7)";
      ctx.beginPath();
      ctx.moveTo(collision.target.x, collision.target.y);
      ctx.lineTo(collision.target.x + nx * 100, collision.target.y + ny * 100);
      ctx.stroke();
      ctx.fillStyle = "rgba(94,231,189,.9)";
      ctx.beginPath();
      ctx.arc(collision.target.x + nx * 100, collision.target.y + ny * 100, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawCue(ctx) {
    if (this.inMotion || this.needsCuePlacement() || this.state.winner !== null) return;
    const cueBall = this.balls.find((item) => item.type === "cue" && item.active);
    if (!cueBall) return;
    const pull = 18 + this.power * (this.charging ? 0.5 : 0.22);
    const tipX = cueBall.x - this.aim.x * (BALL_R + pull);
    const tipY = cueBall.y - this.aim.y * (BALL_R + pull);
    const endX = tipX - this.aim.x * 285;
    const endY = tipY - this.aim.y * 285;
    const cueGradient = ctx.createLinearGradient(tipX, tipY, endX, endY);
    cueGradient.addColorStop(0, "#d9c3a0");
    cueGradient.addColorStop(0.12, "#f1d5a1");
    cueGradient.addColorStop(0.72, "#a8703d");
    cueGradient.addColorStop(1, "#33231a");
    ctx.save();
    ctx.lineCap = "round";
    ctx.shadowColor = "rgba(0,0,0,.5)";
    ctx.shadowBlur = 5;
    ctx.strokeStyle = cueGradient;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    ctx.strokeStyle = "#4c7480";
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - this.aim.x * 5, tipY - this.aim.y * 5);
    ctx.stroke();
    ctx.restore();
  }

  roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
  }
}

export { COLORS, COLOR_ORDER };
