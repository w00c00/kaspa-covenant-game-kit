import "./styles.css";
import { COLORS, SnookerEngine, touchPullPower } from "./game-engine.js";
import { io } from "socket.io-client";
import { gameAudio } from "./audio.js";

const icon = (name) => {
  const paths = {
    logo: '<path d="M5 5.5 12 2l7 3.5v7L12 17l-7-4.5z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m5 5.5 7 4 7-4M12 9.5V17" fill="none" stroke="currentColor" stroke-width="1.8"/>',
    copy: '<rect x="7" y="7" width="10" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5 13H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1" fill="none" stroke="currentColor" stroke-width="1.6"/>',
    settings: '<circle cx="10" cy="10" r="2.4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M16.7 11.2a1.7 1.7 0 0 0 .34 1.88l.06.06-1.96 1.96-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56v.18H9.4v-.18a1.7 1.7 0 0 0-1.03-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06-1.96-1.96.06-.06a1.7 1.7 0 0 0 .34-1.88 1.7 1.7 0 0 0-1.56-1.03h-.18V7.4h.18a1.7 1.7 0 0 0 1.56-1.03 1.7 1.7 0 0 0-.34-1.88l-.06-.06 1.96-1.96.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 9.4 1.31v-.18h2.77v.18a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06 1.96 1.96-.06.06a1.7 1.7 0 0 0-.34 1.88 1.7 1.7 0 0 0 1.56 1.03h.18v2.77h-.18a1.7 1.7 0 0 0-1.56 1.03Z" transform="translate(-.8 .2)" fill="none" stroke="currentColor" stroke-width="1.25"/>',
    check: '<path d="m3 9 3 3 7-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
    lock: '<rect x="3" y="7" width="10" height="7" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" stroke-width="1.5"/>',
    close: '<path d="m4 4 12 12M16 4 4 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'
  };
  return `<svg viewBox="0 0 20 20" aria-hidden="true">${paths[name] || ""}</svg>`;
};

const roomParam = new URLSearchParams(location.search).get("room");
let roomId = /^KSP-[A-Z0-9]{4,12}$/.test(roomParam || "") ? roomParam : "";
let roundId = crypto.randomUUID();
const playerId = sessionStorage.getItem("kaspa-snooker-player-id") || crypto.randomUUID();
sessionStorage.setItem("kaspa-snooker-player-id", playerId);
const demoKeys = ["44".repeat(32), "55".repeat(32)];
const model = {
  stakeKas: 25,
  config: { network: { id: "tn10", label: "Kaspa Testnet 10", symbol: "TKAS", addressPrefix: "kaspatest", isTestnet: true }, chainMode: "preview" },
  wallet: null,
  opponent: { name: "W0C00", address: "kaspatest:qz8m...7n3r", publicKey: demoKeys[1] },
  chain: { intent: null, proof: null },
  muted: false,
  shotSeconds: 30,
  liveSeat: null,
  livePlayers: [],
  currentRoom: null,
  practiceMode: false,
  language: localStorage.getItem("kaspa-snooker-language") === "en" ? "en" : "zh",
  settlement: null,
  settlementPoll: null,
  winnerSeat: null,
  rematchRequested: false,
  view: "lobby"
};
const tr = (zh, en) => model.language === "en" ? en : zh;
const currencySymbol = () => model.config?.network?.symbol || "TKAS";
const networkShortName = () => String(model.config?.network?.id || "tn10").toUpperCase();
// Register every listener before opening the connection. With autoConnect on,
// a fast cached page could receive both `connect` and the initial lobby list
// before the handlers near the middle of this module had been installed.
const socket = io({ transports: ["websocket", "polling"], autoConnect: false });
const coarsePointer = matchMedia("(any-pointer: coarse)");

document.querySelector("#app").innerHTML = `
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark">${icon("logo")}</div>
        <div><div class="brand-name">KASPA SNOOKER</div><div class="brand-sub">ON-CHAIN ARENA</div></div>
      </div>
      <button class="room-chip" id="copy-room" aria-label="复制房间号" hidden>私人房 ${icon("copy")}</button>
      <div class="topbar-spacer"></div>
      <div class="network-pill"><i class="network-dot"></i><span id="network-name">TN10 · TESTNET</span></div>
      <button class="language-button" id="language-toggle" aria-label="中英文切换">EN</button>
      <button class="icon-button" id="settings" aria-label="游戏设置">${icon("settings")}</button>
      <button class="wallet-button" id="wallet">连接钱包</button>
    </header>

    <main class="lobby-screen" id="lobby-screen">
      <section class="lobby-hero">
        <div class="lobby-kicker"><i class="network-dot"></i> KASPA TN10 · AUTOMATIC SETTLEMENT</div>
        <h1>链上斯诺克<br/><span>每一杆，都算数。</span></h1>
        <p>创建房间、双方锁定测试币、自动执行规则，比赛结束后由 Covenant 将奖池释放给胜者。</p>
        <div class="lobby-actions">
          <div class="create-box"><select id="create-stake"><option value="5">5 TKAS / 人</option><option value="25" selected>25 TKAS / 人</option><option value="50">50 TKAS / 人</option><option value="100">100 TKAS / 人</option></select><button class="lobby-primary" id="create-room">创建对战房间</button></div>
          <div class="join-box"><input id="join-code" placeholder="输入房间号 KSP-XXXXX" maxlength="16"/><button id="join-room">加入</button></div>
        </div>
      </section>
      <section class="lobby-grid">
        <div class="lobby-panel rooms-panel">
          <div class="lobby-panel-head"><div><small>LIVE ROOMS</small><h2>公开房间</h2></div><button class="refresh-rooms" id="refresh-rooms">刷新</button></div>
          <div class="room-list" id="room-list"><div class="room-list-empty">目前没有等待中的房间，创建第一个吧。</div></div>
        </div>
        <div class="lobby-panel faucet-panel">
          <div class="faucet-icon">₭</div><small>TN10 FAUCET</small><h2>领取测试币</h2>
          <p>单次最多 200 TKAS，同一钱包每日最多 2000 TKAS。</p>
          <input id="faucet-address" placeholder="kaspatest: 钱包地址"/>
          <div class="faucet-row"><select id="faucet-amount"><option value="50">50 TKAS</option><option value="100">100 TKAS</option><option value="200" selected>200 TKAS</option></select><button id="claim-faucet">领取到钱包</button></div>
          <div class="faucet-status" id="faucet-status">正在读取水龙头状态…</div>
        </div>
      </section>
    </main>

    <main class="room-screen" id="room-screen" hidden>
      <section class="room-shell">
        <button class="back-lobby" id="back-lobby">← 返回大厅</button>
        <div class="room-heading"><div><small>PRIVATE MATCH</small><h1 id="waiting-room-title">房间</h1></div><div class="room-stake"><span>总奖池</span><strong id="waiting-pot">50 TKAS</strong></div></div>
        <div class="seat-grid">
          <div class="seat-card" id="waiting-seat-0"><div class="seat-number">01</div><div class="seat-avatar">P1</div><h3>等待玩家</h3><p>尚未加入</p><div class="seat-flags"><span>未锁定</span><span>未准备</span></div></div>
          <div class="versus">VS</div>
          <div class="seat-card" id="waiting-seat-1"><div class="seat-number">02</div><div class="seat-avatar">P2</div><h3>等待玩家</h3><p>尚未加入</p><div class="seat-flags"><span>未锁定</span><span>未准备</span></div></div>
        </div>
        <div class="room-actions"><button id="practice-match">单机练习</button><button id="lock-stake">连接钱包并锁定押金</button><button id="ready-match" disabled>准备比赛</button></div>
        <p class="room-notice" id="room-notice">双方各自签署自己的输入，锁仓交易上链后才可开球。</p>
      </section>
    </main>

    <main class="arena" id="game-screen" hidden>
      <section class="match-head">
        <div class="player active" id="player-0">
          <div class="avatar">YOU<i class="online"></i></div>
          <div><div class="player-role">当前击球</div><div class="player-name" id="player-name">访客球手</div><div class="player-address" id="player-address">钱包未连接</div></div>
        </div>
        <div class="scoreboard">
          <div class="frame-info">FRAME 01 · BEST OF 1</div>
          <div class="score-row"><span class="score active" id="score-0">0</span><span class="score-divider">:</span><span class="score" id="score-1">0</span></div>
          <div class="turn-label">单杆 <strong id="break-score">0</strong> · 剩余红球 <strong id="reds-left">15</strong></div>
        </div>
        <div class="player away" id="player-1">
          <div><div class="player-role">等待击球</div><div class="player-name" id="player-1-name">等待对手</div><div class="player-address" id="player-1-address">分享房间链接邀请好友</div></div>
          <div class="avatar">W0<i class="online"></i></div>
        </div>
      </section>

      <section class="post-match-bar" id="post-match-bar" hidden>
        <div><small id="post-match-kicker">FRAME COMPLETE</small><strong id="post-match-title">比赛已结束</strong><span id="post-match-status">正在确认链上结算</span></div>
        <div class="post-match-actions"><button class="outline-button" id="post-match-exit">退出房间</button><button class="primary-button" id="post-match-rematch">预约下一局</button></div>
      </section>

      <section class="content-grid">
        <div class="table-column">
          <div class="table-stage" id="table-stage">
            <div class="table-badge">TOURNAMENT TABLE · 12 FT</div>
            <canvas id="game-canvas" aria-label="斯诺克球桌"></canvas>
            <div class="cue-placement-banner" id="cue-placement-banner">手中球 · 请在 D 区拖动白球</div>
            <div class="charge-hud" id="charge-hud"><span>POWER</span><div><i id="charge-hud-fill"></i></div><strong id="charge-hud-value">5%</strong></div>
            <div class="touch-power" id="touch-power" aria-label="触屏力度杆">
              <span>POWER</span><div class="touch-power-groove" id="touch-power-groove"><i id="touch-power-fill"></i><b id="touch-power-thumb"></b></div><small>下拉 · 松开发杆</small>
            </div>
            <div class="aim-hint" id="aim-hint">移动鼠标瞄准 · 左键按住蓄力 · 松开发杆</div>
          </div>
          <div class="controls">
            <div class="control-card power-card">
              <div class="control-label"><span>实时力度</span><strong id="power-number">35%</strong></div>
              <div class="hold-power-track"><i id="hold-power-fill"></i></div>
              <div class="power-scale"><span>短按 · 轻推</span><span>按住 · 增强</span><span>1.7s · 满力</span></div>
            </div>
            <div class="control-card spin-card">
              <div class="control-label"><span>母球击点</span><strong id="spin-label">中杆</strong></div>
              <div class="spin-picker" id="spin-picker" role="slider" aria-label="母球击点" tabindex="0">
                <span class="spin-axis spin-axis-x"></span><span class="spin-axis spin-axis-y"></span><i class="spin-dot" id="spin-dot"></i>
              </div>
            </div>
            <div class="control-card target-card">
              <span class="target-ball" id="target-ball"></span>
              <div class="target-copy"><div class="target-title" id="target-title">目标球 · 红球</div><div class="target-sub" id="target-sub">合法进球得 1 分，随后击打任意彩球</div></div>
              <div class="nomination-picker" id="nomination-picker" hidden aria-label="指定本杆彩球">
                ${["yellow", "green", "brown", "blue", "pink", "black"].map((type) => `<button type="button" data-color="${type}" aria-label="指定${COLORS[type].label}" style="--ball-color:${COLORS[type].fill}"></button>`).join("")}
              </div>
            </div>
            <div class="shot-panel">
              <div class="shot-top"><span><b class="clock-value" id="shot-clock">30</b><small>秒</small></span><span class="aim-fine"><button id="aim-left" aria-label="向左微调">−</button><em>微调</em><button id="aim-right" aria-label="向右微调">＋</button></span></div>
              <div class="shot-instruction" id="shot-instruction"><strong>按住球桌</strong><span>松开发杆 · ESC 取消</span><button id="cue-reposition" hidden>重新摆白球</button></div>
            </div>
          </div>
        </div>

        <aside class="sidebar">
          <section class="panel">
            <div class="panel-head"><span class="panel-title">链上结算</span><span class="panel-tag" id="chain-mode">SDK PREVIEW</span></div>
            <div class="chain-steps">
              <div class="chain-step" id="step-wallet"><span class="step-icon">${icon("check")}</span><span><div class="step-title">钱包身份</div><div class="step-sub">双方公钥绑定</div></span><span class="step-state">待连接</span></div>
              <div class="chain-step pending" id="step-lock"><span class="step-icon">${icon("lock")}</span><span><div class="step-title">Covenant 托管</div><div class="step-sub">非托管 · 双方签名</div></span><span class="step-state">待锁定</span></div>
              <div class="chain-step pending" id="step-settle"><span class="step-icon">${icon("check")}</span><span><div class="step-title">胜者自动结算</div><div class="step-sub">对局记录哈希验证</div></span><span class="step-state">赛后</span></div>
            </div>
            <div class="pot"><div class="pot-label">本局奖池</div><div class="pot-value"><span id="pot-value">50</span> <small id="pot-symbol">TKAS</small></div><div class="pot-meta"><span>每人 ${model.stakeKas} TKAS</span><span>0% 平台抽成</span></div></div>
            <button class="outline-button" id="escrow-action">查看托管方案</button>
          </section>
          <section class="panel">
            <div class="panel-head"><span class="panel-title">击球记录</span><span class="panel-tag" id="shot-count">0 SHOTS</span></div>
            <div class="activity" id="activity"><div class="activity-empty">开球后，这里会生成可验证的<br/>压缩对局记录</div></div>
          </section>
        </aside>
      </section>
    </main>
    <div class="message-bubble" id="message"></div>
    <div class="modal-backdrop" id="modal"><div class="modal"><div class="modal-top"><div><div class="modal-eyebrow" id="modal-eyebrow">KASPA COVENANT</div><div class="modal-title" id="modal-title">链上托管方案</div></div><button class="text-button" id="modal-close" aria-label="关闭">${icon("close")}</button></div><div class="modal-body" id="modal-body"></div></div></div>
  </div>`;

const $ = (selector) => document.querySelector(selector);
const canvas = $("#game-canvas");
let clockTimer = null;
let messageTimer = null;
let lobbyRefreshTimer = null;

function setNodeText(selector, zh, en) {
  const node = $(selector);
  if (node) node.textContent = tr(zh, en);
}

function applyLanguage() {
  document.documentElement.lang = model.language === "en" ? "en" : "zh-CN";
  $("#language-toggle").textContent = model.language === "en" ? "中文" : "EN";
  $("#language-toggle").setAttribute("aria-label", tr("Switch to English", "切换到中文"));
  $(".lobby-hero h1").innerHTML = tr("链上斯诺克<br/><span>每一杆，都算数。</span>", "ON-CHAIN SNOOKER<br/><span>EVERY SHOT COUNTS.</span>");
  setNodeText(".lobby-hero > p", "创建房间、双方锁定测试币、自动执行规则，比赛结束后由 Covenant 将奖池释放给胜者。", "Create a room, lock testnet funds, play under automatic rules, and let the Covenant release the prize to the winner.");
  setNodeText("#create-room", "创建对战房间", "Create match");
  for (const option of $("#create-stake").options) option.textContent = `${option.value} ${currencySymbol()} / ${tr("人", "player")}`;
  $("#join-code").placeholder = tr("输入房间号 KSP-XXXXX", "Enter room code KSP-XXXXX");
  setNodeText("#join-room", "加入", "Join");
  setNodeText(".rooms-panel h2", "公开房间", "Public rooms");
  setNodeText("#refresh-rooms", "刷新", "Refresh");
  setNodeText(".faucet-panel h2", "领取测试币", "Get testnet funds");
  setNodeText(".faucet-panel p", "单次最多 200 TKAS，同一钱包每日最多 2000 TKAS。", "Up to 200 TKAS per claim and 2,000 TKAS per wallet each day.");
  $("#faucet-address").placeholder = tr("kaspatest: 钱包地址", "kaspatest: wallet address");
  if (!$("#claim-faucet").disabled) setNodeText("#claim-faucet", "领取到钱包", "Claim to wallet");
  setNodeText("#back-lobby", "← 返回大厅", "← Back to lobby");
  setNodeText(".room-stake span", "总奖池", "Total prize");
  if (!$("#practice-match").disabled) setNodeText("#practice-match", "单机练习", "Solo practice");
  setNodeText(".frame-info", "FRAME 01 · 一局定胜负", "FRAME 01 · BEST OF 1");
  if (!model.wallet) setNodeText("#player-name", "访客球手", "Guest player");
  if (!model.livePlayers.length) {
    setNodeText("#player-address", "钱包未连接", "Wallet not connected");
    setNodeText("#player-1-name", "等待对手", "Waiting for opponent");
    setNodeText("#player-1-address", "分享房间链接邀请好友", "Share the room link to invite a friend");
  }
  $(".turn-label").innerHTML = `${tr("单杆", "BREAK")} <strong id="break-score">${engine?.state?.breakScore || 0}</strong> · ${tr("剩余红球", "REDS LEFT")} <strong id="reds-left">${engine?.state?.redsRemaining ?? 15}</strong>`;
  setNodeText(".power-card .control-label span", "实时力度", "Live power");
  const scales = document.querySelectorAll(".power-scale span");
  if (scales.length === 3) [tr("短按 · 轻推", "Tap · Soft"), tr("按住 · 增强", "Hold · Power"), tr("1.7s · 满力", "1.7s · Full")].forEach((text, index) => { scales[index].textContent = text; });
  setNodeText(".spin-card .control-label span", "母球击点", "Cue impact");
  setNodeText(".aim-fine em", "微调", "Fine aim");
  setNodeText("#cue-reposition", "重新摆白球", "Reposition cue ball");
  setNodeText("#cue-placement-banner", "手中球 · 请在 D 区拖动白球", "BALL IN HAND · Drag the cue ball inside the D");
  setNodeText(".touch-power small", "下拉 · 松开发杆", "Pull · Release");
  setNodeText("#aim-hint", coarsePointer.matches ? "滑动球桌瞄准 · 设置母球击点 · 右侧力度杆下拉并松开发杆" : "移动鼠标瞄准 · 左键按住蓄力 · 松开发杆", coarsePointer.matches ? "Swipe to aim · Set cue impact · Pull and release the power bar" : "Move to aim · Hold left mouse to charge · Release to shoot");
  setNodeText(".shot-top > span:first-child small", "秒", "sec");
  setNodeText(".sidebar .panel:first-child .panel-title", "链上结算", "On-chain settlement");
  setNodeText("#step-wallet .step-title", "钱包身份", "Wallet identity");
  setNodeText("#step-wallet .step-sub", "双方公钥绑定", "Both public keys bound");
  setNodeText("#step-lock .step-title", "Covenant 托管", "Covenant escrow");
  setNodeText("#step-lock .step-sub", "非托管 · 双方签名", "Non-custodial · Two signatures");
  setNodeText("#step-settle .step-title", "胜者自动结算", "Automatic winner settlement");
  setNodeText("#step-settle .step-sub", "对局记录哈希验证", "Transcript hash verification");
  setNodeText(".pot-label", model.practiceMode ? "单机练习" : "本局奖池", model.practiceMode ? "Solo practice" : "Prize pool");
  setNodeText(".pot-meta span:last-child", "0% 平台抽成", "0% platform fee");
  setNodeText("#escrow-action", "查看托管方案", "View escrow plan");
  setNodeText(".sidebar .panel:nth-child(2) .panel-title", "击球记录", "Shot history");
  if (!(model.lastState?.visits?.length)) $("#activity").innerHTML = tr("<div class=\"activity-empty\">开球后，这里会生成可验证的<br/>压缩对局记录</div>", "<div class=\"activity-empty\">A verifiable compressed transcript<br/>will appear after the opening shot.</div>");
  $("#settings").setAttribute("aria-label", tr("游戏设置", "Game settings"));
  $("#modal-close").setAttribute("aria-label", tr("关闭", "Close"));
  if (!model.wallet) setNodeText("#wallet", "连接钱包", "Connect wallet");
  engine?.setLocale(model.language);
  if (model.lastState) updateState(model.lastState);
  if (model.currentRoom?.status === "waiting") updateWaitingRoom(model.currentRoom);
  if (model.rooms) renderLobbyRooms(model.rooms);
  if (model.winnerSeat !== null) renderPostMatchBar();
  if (model.settlement && $("#modal").classList.contains("open") && $("#modal").dataset.kind === "settlement") renderSettlementModal();
}

function short(value, head = 11, tail = 6) {
  if (!value || value.length < head + tail + 3) return value || "—";
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function showMessage(text, type = "neutral") {
  const node = $("#message");
  node.textContent = text;
  node.className = `message-bubble show ${type}`;
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => node.className = "message-bubble", 1700);
  if (type === "foul") gameAudio.foul();
}

function updatePower(power) {
  const value = Math.round(power);
  $("#power-number").textContent = `${value}%`;
  $("#hold-power-fill").style.width = `${value}%`;
  $("#charge-hud-fill").style.width = `${value}%`;
  $("#charge-hud-value").textContent = `${value}%`;
  $("#touch-power-fill").style.height = `${value}%`;
  $("#touch-power-thumb").style.top = `${Math.min(92, value)}%`;
}

function setChargeUI(active, source = "mouse") {
  $("#table-stage").classList.toggle("charging", active);
  $("#charge-hud").classList.toggle("active", active);
  $("#charge-hud").classList.toggle("touch-charge", source === "touch");
}

function spinName(spin) {
  const horizontal = spin.x < -0.22 ? tr("左塞", "Left english") : (spin.x > 0.22 ? tr("右塞", "Right english") : "");
  const vertical = spin.y > 0.22 ? tr("高杆", "Top spin") : (spin.y < -0.22 ? tr("低杆", "Back spin") : "");
  return [horizontal, vertical].filter(Boolean).join(" · ") || tr("中杆", "Centre ball");
}

function updateSpin(spin) {
  const dot = $("#spin-dot");
  dot.style.left = `${50 + spin.x * 35}%`;
  dot.style.top = `${50 - spin.y * 35}%`;
  $("#spin-label").textContent = spinName(spin);
  $("#spin-picker").setAttribute("aria-valuetext", spinName(spin));
}

function targetContent(target) {
  if (target === "red") return { color: COLORS.red.fill, title: tr("目标球 · 红球", "BALL ON · RED"), sub: tr("合法进球得 1 分，随后击打任意彩球", "A legal pot scores 1, followed by a nominated colour") };
  if (target === "color") return { color: "linear-gradient(135deg,#f2c94c,#229966,#3182ce,#ef8faf,#111)", title: tr("目标球 · 任意彩球", "BALL ON · NOMINATED COLOUR"), sub: tr("彩球进球后复位，继续击打红球", "The colour is re-spotted; continue on a red") };
  const info = COLORS[target];
  const label = model.language === "en" ? info?.labelEn : info?.label;
  return { color: info?.fill || COLORS.red.fill, title: tr(`目标球 · ${label || target}`, `BALL ON · ${(label || target).toUpperCase()}`), sub: tr(`清彩阶段 · 该球价值 ${info?.value || 0} 分`, `Colours clearance · Worth ${info?.value || 0} points`) };
}

function updateNomination(type) {
  const picker = $("#nomination-picker");
  picker.hidden = engine?.state.target !== "color";
  for (const button of picker.querySelectorAll("button")) {
    button.classList.toggle("selected", button.dataset.color === type);
  }
}

function updateState(state) {
  model.lastState = state;
  $("#score-0").textContent = state.scores[0];
  $("#score-1").textContent = state.scores[1];
  $("#break-score").textContent = state.breakScore;
  $("#reds-left").textContent = state.redsRemaining;
  [0, 1].forEach((seat) => {
    $(`#player-${seat}`).classList.toggle("active", state.currentPlayer === seat);
    $(`#score-${seat}`).classList.toggle("active", state.currentPlayer === seat);
    $(`#player-${seat} .player-role`).textContent = state.currentPlayer === seat ? tr("当前击球", "AT TABLE") : tr("等待击球", "WAITING");
  });
  const content = targetContent(state.target);
  $("#target-ball").style.background = content.color;
  $("#target-title").textContent = content.title;
  $("#target-sub").textContent = content.sub;
  updateNomination(state.nominatedColor);
  renderActivity(state.visits);
  updateCuePlacementUI(state);
}

function updateCuePlacementUI(state) {
  const inHand = Boolean(state.cueBallInHand);
  const confirmed = Boolean(state.cuePlacementConfirmed);
  const needsPlacement = inHand && !confirmed;
  $("#table-stage").classList.toggle("ball-in-hand", inHand);
  $("#table-stage").classList.toggle("needs-cue-placement", needsPlacement);
  $("#cue-placement-banner").classList.toggle("active", needsPlacement);
  $("#cue-reposition").hidden = !(inHand && confirmed);
  if (needsPlacement) {
    $("#shot-instruction").querySelector("strong").textContent = tr("先摆白球", "Place cue ball");
    $("#shot-instruction").querySelector("span").textContent = tr("在 D 区拖动 · 松手确认", "Drag inside the D · Release to confirm");
  } else if (inHand && confirmed) {
    $("#shot-instruction").querySelector("strong").textContent = tr("位置已确认", "Position confirmed");
    $("#shot-instruction").querySelector("span").textContent = coarsePointer.matches ? tr("右侧下拉力度杆发杆", "Pull the power bar to shoot") : tr("按住球桌蓄力发杆", "Hold on the table to charge");
  } else {
    $("#shot-instruction").querySelector("strong").textContent = coarsePointer.matches ? tr("右侧下拉", "Pull power bar") : tr("按住球桌", "Hold on table");
    $("#shot-instruction").querySelector("span").textContent = coarsePointer.matches ? tr("松手发杆 · 球桌只瞄准", "Release to shoot · Table aims only") : tr("松开发杆 · ESC 取消", "Release to shoot · ESC cancels");
  }
}

function renderActivity(visits) {
  $("#shot-count").textContent = `${visits.length} SHOTS`;
  if (!visits.length) return;
  $("#activity").innerHTML = visits.slice().reverse().map((visit) => {
    const potted = visit.potted.length ? visit.potted.map((type) => model.language === "en" ? (COLORS[type]?.labelEn || type) : (COLORS[type]?.label || type)).join(model.language === "en" ? ", " : "、") : tr("无进球", "No pot");
    const playerName = model.practiceMode ? `${tr("练习回合", "Practice turn")} ${visit.player + 1}` : (visit.player === 0 ? tr("访客球手", "Guest player") : "W0C00");
    const target = targetContent(visit.target).title.replace(/^.*? · /, "");
    return `<div class="activity-item"><span class="activity-num">${String(visit.number).padStart(2, "0")}</span><span><div class="activity-title">${playerName} · ${potted}</div><div class="activity-sub">${visit.foul ? tr("犯规击球", "Foul stroke") : `${tr("目标", "Ball on")} ${target}`} · ${visit.power || 0}% · ${spinName(visit.spin || { x: 0, y: 0 })}</div></span><span class="activity-score ${visit.foul ? "foul" : ""}">${visit.foul ? "FOUL" : `+${visit.points}`}</span></div>`;
  }).join("");
}

function resetClock(deadline = Date.now() + 30_000) {
  clearInterval(clockTimer);
  model.turnDeadline = Number(deadline) || Date.now() + 30_000;
  const update = () => {
    model.shotSeconds = Math.max(0, Math.ceil((model.turnDeadline - Date.now()) / 1000));
    $("#shot-clock").textContent = String(model.shotSeconds).padStart(2, "0");
    if (model.shotSeconds <= 0) clearInterval(clockTimer);
  };
  update();
  clockTimer = setInterval(() => {
    if (!document.hidden) update();
  }, 250);
}

const engine = new SnookerEngine(canvas, {
  onPower: updatePower,
  onCharge: (active) => setChargeUI(active, "mouse"),
  onSpin: updateSpin,
  onNomination: updateNomination,
  onCuePlacement: () => updateCuePlacementUI(engine.snapshot()),
  onCuePlaced: (placement) => socket.emit("game:cue-placement", { roomId, placement }),
  onMessage: showMessage,
  onState: updateState,
  onShot: (shot) => {
    clearInterval(clockTimer);
    gameAudio.strike(shot.power);
    socket.emit("game:shot", { roomId, angle: shot.angle, power: shot.power, spin: shot.spin, nominatedColor: shot.nominatedColor, shot: shot.player });
  },
  onPocket: () => gameAudio.pocket(),
  onCollision: (impulse) => gameAudio.collision(impulse),
  onFrameEnd: () => {},
  onResolved: () => {
    if (model.pendingSnapshot) {
      const snapshot = model.pendingSnapshot;
      model.pendingSnapshot = null;
      engine.importSnapshot(snapshot);
    }
  }
}, { locale: model.language });
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && model.pendingSnapshot) {
    const snapshot = model.pendingSnapshot;
    model.pendingSnapshot = null;
    engine.importSnapshot(snapshot);
  }
});
updateState(engine.snapshot());
updatePower(engine.power);
updateSpin(engine.spin);
applyLanguage();

function identity() {
  return {
    playerId,
    name: model.wallet ? "YOU" : tr("访客球手", "Guest player"),
    address: model.wallet?.address || "",
    publicKey: model.wallet?.publicKey || ""
  };
}

function showView(view) {
  model.view = view;
  $("#lobby-screen").hidden = view !== "lobby";
  $("#room-screen").hidden = view !== "room";
  $("#game-screen").hidden = view !== "game";
  $("#copy-room").hidden = view === "lobby" || !roomId;
  clearInterval(lobbyRefreshTimer);
  lobbyRefreshTimer = null;
  if (view === "lobby") {
    const refresh = () => {
      if (socket.connected) socket.emit("lobby:list", {}, (result) => renderLobbyRooms(result?.rooms || []));
    };
    refresh();
    lobbyRefreshTimer = setInterval(refresh, 5_000);
  }
}

function renderLobbyRooms(rooms = []) {
  model.rooms = rooms;
  const list = $("#room-list");
  if (!rooms.length) {
    list.innerHTML = `<div class="room-list-empty">${tr("目前没有等待中的房间，创建第一个吧。", "No rooms are waiting. Create the first one.")}</div>`;
    return;
  }
  list.innerHTML = rooms.map((room) => `<button class="lobby-room" data-room="${room.roomId}"><span><b>${room.roomId}</b><small>${room.players.length}/2 ${tr("玩家", "players")}</small></span><span><strong>${room.stakeKas * 2}</strong><small>${currencySymbol()} ${tr("奖池", "prize")}</small></span><em>${tr("加入", "Join")} →</em></button>`).join("");
  list.querySelectorAll("[data-room]").forEach((button) => button.addEventListener("click", () => joinRoom(button.dataset.room)));
}

function updateWaitingRoom(room) {
  model.currentRoom = room;
  model.livePlayers = room.players || [];
  $("#waiting-room-title").textContent = `${tr("房间", "Room")} ${room.roomId}`;
  $("#waiting-pot").textContent = `${Number(room.stakeKas || 0) * 2} ${currencySymbol()}`;
  for (const seat of [0, 1]) {
    const node = $(`#waiting-seat-${seat}`);
    const player = room.players.find((item) => item.seat === seat);
    node.classList.toggle("occupied", Boolean(player));
    node.querySelector("h3").textContent = player?.name || tr("等待玩家", "Waiting for player");
    node.querySelector("p").textContent = player?.address ? short(player.address) : (player ? tr("演示身份", "Demo identity") : tr("尚未加入", "Not joined"));
    const flags = node.querySelectorAll(".seat-flags span");
    const lockLabels = {
      unsigned: tr("未签名", "Unsigned"),
      signing: tr("钱包签名中", "Wallet signing"),
      submitting: tr("正在验证签名", "Verifying signature"),
      signed: tr("已签名 · 等待对手", "Signed · Waiting for opponent"),
      locked: tr("押金已上链", "Funds locked on-chain")
    };
    flags[0].textContent = player?.locked
      ? tr("押金已上链", "Funds locked on-chain")
      : room.escrow?.status === "confirming-lock-on-chain" && player?.lockStatus === "signed"
        ? tr("已签名 · 等待上链确认", "Signed · Waiting for confirmation")
        : (player ? (lockLabels[player.lockStatus] || tr("未签名", "Unsigned")) : tr("未锁定", "Not locked"));
    flags[0].classList.toggle("ok", Boolean(player?.locked));
    flags[1].textContent = player?.ready ? tr("已准备", "Ready") : tr("未准备", "Not ready");
    flags[1].classList.toggle("ok", Boolean(player?.ready));
  }
  const local = room.players.find((item) => item.seat === model.liveSeat);
  $("#practice-match").hidden = !local || room.players.length !== 1;
  $("#practice-match").disabled = !local || room.players.length !== 1 || local.lockStatus !== "unsigned";
  const escrowUnavailable = model.config.escrowReady === false;
  $("#lock-stake").disabled = escrowUnavailable || !local || local.locked || local.lockStatus === "signed" || local.lockStatus === "submitting";
  $("#lock-stake").textContent = escrowUnavailable
    ? tr("链上安全配置未就绪", "On-chain safety configuration incomplete")
    : local?.locked
    ? tr("锁仓交易已上链", "Escrow confirmed on-chain")
    : local?.lockStatus === "signed"
      ? (room.escrow?.status === "confirming-lock-on-chain" ? tr("交易已广播 · 等待确认", "Broadcast · Waiting for confirmation") : tr("已签名 · 等待对手", "Signed · Waiting for opponent"))
      : local?.lockStatus === "submitting"
        ? tr("正在广播锁仓交易…", "Broadcasting escrow transaction…")
        : `${tr("签名并锁定", "Sign and lock")} ${room.stakeKas} ${currencySymbol()}`;
  $("#ready-match").disabled = !local?.locked || local?.ready;
  $("#ready-match").textContent = local?.ready ? tr("已准备 · 等待对手", "Ready · Waiting for opponent") : tr("准备比赛", "Ready to play");
  if (room.players.length < 2) $("#room-notice").textContent = tr("分享房间链接，等待第二位玩家加入。", "Share the room link and wait for a second player.");
  else if (room.escrow?.status === "locked-on-chain") $("#room-notice").textContent = `${tr("锁仓已确认", "Escrow confirmed")}${room.escrow.lockTxid ? ` · TX ${short(room.escrow.lockTxid)}` : ""}${tr("，双方准备后自动开球。", ". The frame starts when both players are ready.")}`;
  else if (room.escrow?.error) $("#room-notice").textContent = `${tr("锁仓失败：", "Escrow failed: ")}${room.escrow.error}`;
  else $("#room-notice").textContent = tr("请双方依次用钱包签名；两份签名合并并广播成功后，押金才算真正锁定。", "Both players sign their own input. Funds are locked only after the merged transaction is broadcast and confirmed.");
}

function enterRoom(result) {
  if (!result?.ok) return showMessage(result?.error || tr("无法加入房间", "Unable to join room"), "foul");
  const room = result.room;
  roomId = room.roomId;
  model.currentRoom = room;
  model.livePlayers = room.players || [];
  model.practiceMode = Boolean(room.practiceMode);
  model.stakeKas = Number(room.stakeKas || 0);
  $("#chain-mode").textContent = model.config.chainMode === "live" ? `${model.config.network.id.toUpperCase()} LIVE` : "SETTLEMENT OFFLINE";
  $("#pot-value").textContent = String(model.stakeKas * 2);
  $(".pot-label").textContent = tr("本局奖池", "Prize pool");
  $(".pot-meta span:first-child").textContent = `${tr("每人", "Each")} ${model.stakeKas} ${currencySymbol()}`;
  $("#step-wallet .step-state").textContent = model.wallet ? tr("已绑定", "Bound") : tr("待连接", "Connect");
  $("#step-lock .step-state").textContent = tr("待锁定", "Pending");
  $("#step-settle .step-state").textContent = tr("赛后", "Post-game");
  $("#escrow-action").hidden = false;
  model.liveSeat = result.seat;
  history.replaceState({}, "", `?room=${roomId}`);
  $("#copy-room").innerHTML = `${tr("私人房", "PRIVATE ROOM")} · ${roomId} ${icon("copy")}`;
  if (room.gameSnapshot) engine.importSnapshot(room.gameSnapshot);
  if (room.status === "playing" || room.status === "practice") {
    model.winnerSeat = null;
    model.rematchRequested = false;
    hidePostMatchBar();
    showView("game");
    if (room.status === "playing") resetClock(room.turnDeadline);
    else $("#shot-clock").textContent = "∞";
    showMessage(tr("已恢复当前对局", "Current frame restored"), "score");
    return;
  }
  if (room.status === "finished" || room.status === "practice-finished") {
    model.winnerSeat = Number(room.gameState?.winner ?? room.gameSnapshot?.state?.winner ?? 0);
    model.settlement = room.settlement;
    model.rematchRequested = Boolean(room.rematchSeats?.includes(model.liveSeat));
    showView("game");
    renderPostMatchBar();
    if (!model.practiceMode) {
      renderSettlementModal();
      if (!settlementDetails().done) startSettlementPolling();
    }
    return;
  }
  showView("room");
  updateWaitingRoom(room);
}

function joinRoom(id) {
  socket.emit("room:join", { roomId: String(id || "").trim().toUpperCase(), ...identity() }, enterRoom);
}

socket.on("connect", () => {
  socket.emit("lobby:list", {}, (result) => renderLobbyRooms(result?.rooms || []));
  if (roomId) joinRoom(roomId);
});
socket.on("lobby:rooms", renderLobbyRooms);
socket.on("room:player-joined", ({ player }) => {
  showMessage(tr(`${player?.name || `Player ${Number(player?.seat) + 1}`} 已进入房间`, `${player?.name || `Player ${Number(player?.seat) + 1}`} joined the room`), "score");
});
socket.on("room:player-signed", ({ seat }) => {
  showMessage(tr(`Player ${Number(seat) + 1} 已提交锁仓签名 · 等待另一方`, `Player ${Number(seat) + 1} signed the escrow · Waiting for the other player`), "score");
});
socket.on("room:escrow-locked", ({ lockTxid }) => {
  showMessage(tr(`双方资金已锁仓并确认${lockTxid ? ` · TX ${short(lockTxid)}` : ""}`, `Both stakes are locked and confirmed${lockTxid ? ` · TX ${short(lockTxid)}` : ""}`), "score");
});
socket.on("room:state", (room) => {
  if (roomId && room.roomId === roomId && room.status === "waiting") updateWaitingRoom(room);
  model.livePlayers = room.players || [];
  for (const seat of [0, 1]) {
    const live = model.livePlayers.find((player) => player.seat === seat);
    const isLocal = live?.playerId === playerId;
    const name = isLocal ? (model.wallet ? "YOU" : tr("访客球手", "Guest player")) : (live?.name || (seat === 0 ? tr("访客球手", "Guest player") : tr("等待对手", "Waiting for opponent")));
    $(`#player-${seat === 0 ? "name" : "1-name"}`).textContent = name;
    const addressNode = seat === 0 ? $("#player-address") : $("#player-1-address");
    addressNode.textContent = live?.address ? short(live.address) : (live ? tr("已加入私人房", "Joined private room") : tr("分享房间链接邀请好友", "Share the room link to invite a friend"));
    $(`#player-${seat} .online`).style.opacity = live ? "1" : ".2";
  }
  if (model.livePlayers.length === 2) showMessage(tr("对手已加入 · 实时对战已就绪", "Opponent joined · Live match ready"), "score");
});
socket.on("room:game-start", ({ room, snapshot, turnDeadline, practiceMode }) => {
  model.currentRoom = room;
  model.practiceMode = Boolean(practiceMode || room?.practiceMode);
  model.winnerSeat = null;
  model.rematchRequested = false;
  hidePostMatchBar();
  roundId = snapshot?.state?.roundId || roundId;
  if (snapshot) engine.importSnapshot(snapshot);
  if (model.practiceMode) {
    clearInterval(clockTimer);
    $("#shot-clock").textContent = "∞";
    $("#player-1-name").textContent = tr("练习回合", "Practice turn");
    $("#player-1-address").textContent = tr("你可以连续操作双方回合", "You control both turns");
    $("#chain-mode").textContent = "PRACTICE";
    $("#pot-value").textContent = "0";
    $(".pot-label").textContent = tr("单机练习", "Solo practice");
    $(".pot-meta span:first-child").textContent = tr("无需钱包 · 无押注", "No wallet · No stake");
    $("#step-wallet .step-state").textContent = tr("无需", "Not needed");
    $("#step-lock .step-state").textContent = tr("无押注", "No stake");
    $("#step-settle .step-state").textContent = tr("不结算", "No settlement");
    $("#escrow-action").hidden = true;
  } else {
    resetClock(turnDeadline || room?.turnDeadline);
  }
  showView("game");
  gameAudio.ready();
  showMessage(model.practiceMode ? tr("单机练习开始 · 你可以操作每个回合", "Solo practice started · You control every turn") : tr("双方已锁仓 · 比赛开始", "Both stakes locked · Match started"), "score");
});
socket.on("game:shot", ({ angle, power, spin, nominatedColor }) => {
  if (engine.remoteShot(angle, power, spin, nominatedColor)) showMessage(`${tr("对手发杆", "Opponent shot")} · ${power}% · ${spinName(spin || { x: 0, y: 0 })}`);
});
socket.on("game:state", ({ snapshot, turnDeadline }) => {
  if (!snapshot) return;
  if (engine.inMotion) model.pendingSnapshot = snapshot;
  else engine.importSnapshot(snapshot);
  if (turnDeadline) resetClock(turnDeadline);
});
socket.on("game:timeout", ({ seat, snapshot }) => {
  if (snapshot) engine.importSnapshot(snapshot);
  showMessage(tr(`Player ${Number(seat) + 1} 超时犯规 · 对手 +4`, `Player ${Number(seat) + 1} timed out · Opponent +4`), "foul");
});
socket.on("game:rejected", ({ reason, snapshot }) => {
  if (snapshot) engine.importSnapshot(snapshot);
  showMessage(reason || tr("服务器拒绝了这次操作", "Server rejected this action"), "foul");
});

function settlementDetails(value = model.settlement) {
  const record = value?.settlement || {};
  const escrow = value?.escrow || {};
  const visible = value?.visible || {};
  const status = record.status || escrow.status || value?.status || "pending-chain-covenant-settlement";
  const covenantId = visible.covenantId || record.chainCovenantId || escrow.deploy?.covenantId || "";
  const txid = visible.txid || record.chainSettlementTxid || escrow.settle?.txid || "";
  const kascovUrl = visible.covenantStoryUrl || escrow.settle?.covenantExplorerUrl ||
    (covenantId && model.config.network.explorer ? `${model.config.network.explorer.replace(/\/$/, "")}/c/${covenantId}` : "");
  return {
    status,
    done: status === "settled-on-chain",
    failed: /failed|error/.test(status),
    covenantId,
    txid,
    txUrl: visible.txExplorerUrl || escrow.settle?.txExplorerUrl || "",
    kascovUrl,
    releasedKas: Number(visible.releasedKas || record.releasedKas || escrow.settle?.releasedKas || 0),
    error: record.chainSettlementError || escrow.error || value?.error || ""
  };
}

function settlementStatusLabel(status) {
  const labels = {
    "pending-chain-covenant-settlement": ["等待广播结算交易", "Waiting to broadcast settlement"],
    settling: ["正在构建并广播", "Building and broadcasting"],
    "settlement-retrying": ["网络重试中", "Retrying network submission"],
    "settlement-pending": ["等待自动重试", "Waiting for automatic retry"],
    "chain-settle-failed": ["广播失败，自动重试中", "Broadcast failed, retrying"],
    "settle-failed": ["广播失败，自动重试中", "Broadcast failed, retrying"],
    "settled-on-chain": ["链上结算完成", "Settled on-chain"],
    "settlement-needs-chain-escrow": ["未找到链上锁仓", "On-chain escrow not found"]
  };
  const label = labels[status];
  return label ? tr(label[0], label[1]) : status;
}

function safeLink(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : "";
  } catch { return ""; }
}

function clearSettlementPolling() {
  clearInterval(model.settlementPoll);
  model.settlementPoll = null;
}

function hidePostMatchBar() {
  $("#post-match-bar").hidden = true;
}

function renderPostMatchBar() {
  const bar = $("#post-match-bar");
  bar.hidden = false;
  const button = $("#post-match-rematch");
  if (model.practiceMode) {
    $("#post-match-kicker").textContent = "PRACTICE COMPLETE";
    $("#post-match-title").textContent = tr("练习局已结束", "Practice frame complete");
    $("#post-match-status").textContent = tr("可以立即重新摆球，或退出返回大厅", "Rack again now or return to the lobby");
    button.disabled = false;
    button.textContent = tr("重新摆球", "Rack again");
    return;
  }
  const details = settlementDetails();
  const winnerSeat = Number(model.winnerSeat ?? 0);
  const winner = model.livePlayers.find((player) => player.seat === winnerSeat);
  const winnerName = winner?.playerId === playerId ? tr("你", "YOU") : (winner?.name || `Player ${winnerSeat + 1}`);
  $("#post-match-kicker").textContent = "FRAME COMPLETE · AUTOMATIC SETTLEMENT";
  $("#post-match-title").textContent = tr(`${winnerName} 获胜`, `${winnerName} wins`);
  $("#post-match-status").textContent = details.done
    ? tr("链上结算已完成，可以开始下一局", "Settlement complete. The next frame can begin")
    : tr("链上结算进行中，可先预约下一局", "Settlement in progress. You can reserve the next frame now");
  button.disabled = model.rematchRequested;
  button.textContent = model.rematchRequested
    ? tr("已确认 · 等待对手", "Confirmed · Waiting")
    : (details.done ? tr("再来一局", "Play again") : tr("预约下一局", "Reserve rematch"));
}

function requestRematch() {
  if (!roomId || model.rematchRequested) return;
  const buttons = [$("#result-rematch"), $("#post-match-rematch")].filter(Boolean);
  buttons.forEach((button) => { button.disabled = true; button.textContent = tr("正在确认…", "Confirming…"); });
  socket.emit("game:rematch", { roomId }, (result) => {
    if (!result?.ok) {
      model.rematchRequested = false;
      renderPostMatchBar();
      if ($("#modal").classList.contains("open") && $("#modal").dataset.kind === "settlement") renderSettlementModal();
      showMessage(result?.error || tr("无法发起重赛", "Unable to request rematch"), "foul");
      return;
    }
    if (result.started) return;
    model.rematchRequested = true;
    renderPostMatchBar();
    if ($("#modal").classList.contains("open") && $("#modal").dataset.kind === "settlement") renderSettlementModal();
    showMessage(result.waitingForSettlement
      ? tr("已预约下一局 · 结算完成后自动进入", "Rematch reserved · It will open after settlement")
      : tr("重赛已确认 · 等待对手", "Rematch confirmed · Waiting for opponent"), "score");
  });
}

function resetPracticeFrame() {
  socket.emit("practice:reset", { roomId }, (result) => {
    if (!result?.ok) showMessage(result?.error || tr("无法重新摆球", "Unable to rack again"), "foul");
    else closeModal();
  });
}

function renderSettlementModal() {
  const details = settlementDetails();
  const winnerSeat = Number(model.winnerSeat ?? 0);
  const scores = engine.state.scores || [0, 0];
  const winner = model.livePlayers.find((player) => player.seat === winnerSeat);
  const winnerName = winner?.playerId === playerId ? tr("你", "YOU") : (winner?.name || `Player ${winnerSeat + 1}`);
  const kascovUrl = safeLink(details.kascovUrl);
  const txUrl = safeLink(details.txUrl);
  const stepClass = (complete, active = false) => complete ? "done" : (active ? "active" : "");
  openModal({
    kind: "settlement",
    eyebrow: "AUTOMATIC SETTLEMENT · 自动结算",
    title: details.done ? tr("奖池已完成链上结算", "Prize pool settled on-chain") : tr("比赛结束 · 正在自动结算", "Frame complete · Settling automatically"),
    body: `
      <div class="result-hero"><small>${tr("本局胜者", "FRAME WINNER")}</small><strong>${winnerName}</strong><span>${scores[0]} : ${scores[1]}</span></div>
      <div class="settlement-progress">
        <div class="settlement-progress-item done"><i>1</i><span><b>${tr("规则确认胜负", "Result verified")}</b><small>${tr("服务端权威对局记录已锁定", "Authoritative transcript locked")}</small></span></div>
        <div class="settlement-progress-item ${stepClass(Boolean(details.txid), !details.txid && !details.failed)}"><i>2</i><span><b>${tr("广播释放交易", "Broadcast release transaction")}</b><small>${details.txid ? `${tr("交易", "TX")} ${short(details.txid)}` : settlementStatusLabel(details.status)}</small></span></div>
        <div class="settlement-progress-item ${stepClass(details.done, Boolean(details.txid) && !details.done)}"><i>3</i><span><b>${tr(`${networkShortName()} 链上确认`, `${networkShortName()} confirmation`)}</b><small>${details.done ? tr("奖池已释放至胜者钱包", "Prize released to winner wallet") : tr("自动刷新，无需手动操作", "Auto-refreshing; no action required")}</small></span></div>
      </div>
      <div class="data-grid settlement-data">
        <div class="data-cell"><div class="data-label">${tr("结算状态", "STATUS")}</div><div class="data-value ${details.done ? "good" : ""}" id="live-settlement-status">${settlementStatusLabel(details.status)}</div></div>
        <div class="data-cell"><div class="data-label">${tr("释放金额", "RELEASED")}</div><div class="data-value good">${details.releasedKas || model.stakeKas * 2} ${currencySymbol()}</div></div>
        ${details.covenantId ? `<div class="data-cell" style="grid-column:1/-1"><div class="data-label">Covenant ID</div><div class="data-value">${details.covenantId}</div></div>` : ""}
        ${details.txid ? `<div class="data-cell" style="grid-column:1/-1"><div class="data-label">Settlement TXID</div><div class="data-value">${details.txid}</div></div>` : ""}
      </div>
      ${details.error && !details.done ? `<div class="modal-note settlement-error">${tr("网络提交暂时失败，服务会自动重试：", "Network submission failed temporarily; the service will retry: ")}${details.error}</div>` : `<div class="modal-note">${tr("此页面每 3 秒自动刷新结算状态。即使关闭页面，服务端也会继续重试直至结算完成。", "Settlement status refreshes every 3 seconds. Server-side retries continue even if this page is closed.")}</div>`}
      <div class="settlement-links">
        ${kascovUrl ? `<a class="outline-button" href="${kascovUrl}" target="_blank" rel="noopener">${tr("在 Kascov 查看", "View on Kascov")} ↗</a>` : ""}
        ${txUrl ? `<a class="outline-button" href="${txUrl}" target="_blank" rel="noopener">${tr("查看结算交易", "View settlement transaction")} ↗</a>` : ""}
      </div>
      <div class="modal-actions"><button class="outline-button" id="result-exit">${tr("退出房间", "Exit room")}</button><button class="primary-button" id="result-rematch" ${model.rematchRequested ? "disabled" : ""}>${model.rematchRequested ? tr("已确认 · 等待对手", "Confirmed · Waiting") : (details.done ? tr("再来一局", "Play again") : tr("预约下一局", "Reserve rematch"))}</button></div>
      <div class="rematch-hint" id="rematch-hint">${details.done ? tr("双方确认后进入新一局，并重新锁仓。", "The next frame opens after both players confirm, then funds are locked again.") : tr("可以先确认重赛；结算完成且双方同意后，会自动进入新一局。", "You can confirm now. The next frame opens after settlement and both players agree.")}</div>`
  });
  $("#result-exit")?.addEventListener("click", () => { clearSettlementPolling(); closeModal(); leaveCurrentRoom(); });
  $("#result-rematch")?.addEventListener("click", requestRematch);
}

function updateSettlement(settlement) {
  if (settlement) model.settlement = settlement;
  if ($("#modal").classList.contains("open") && $("#modal").dataset.kind === "settlement") renderSettlementModal();
  renderPostMatchBar();
  const details = settlementDetails();
  const step = $("#step-settle");
  step.classList.toggle("pending", !details.done);
  step.querySelector(".step-state").textContent = details.done ? tr("已结算", "Settled") : tr("结算中", "Settling");
  if (details.done) {
    clearSettlementPolling();
    showMessage(tr("链上结算完成 · 奖池已发给胜者", "On-chain settlement complete · Prize sent to winner"), "score");
  }
}

function startSettlementPolling() {
  clearSettlementPolling();
  const poll = () => socket.emit("game:settlement:status", { roomId }, (result) => {
    if (result?.ok && result.settlement) updateSettlement(result.settlement);
  });
  model.settlementPoll = setInterval(poll, 3_000);
}

socket.on("game:finished", ({ winnerSeat, settlement, practiceMode, room }) => {
  if (practiceMode || model.practiceMode) {
    model.winnerSeat = winnerSeat;
    if (room) model.currentRoom = room;
    renderPostMatchBar();
    showMessage(tr("练习局完成", "Practice frame complete"), "score");
    openModal({ eyebrow: "PRACTICE COMPLETE · 练习结束", title: tr("练习局完成", "Practice frame complete"), body: `<div class="modal-note">${tr("本局为无押注单机练习，不产生任何链上交易。", "This was a free solo practice frame. No on-chain transaction was created.")}</div><div class="modal-actions"><button class="outline-button" id="practice-exit">${tr("返回大厅", "Return to lobby")}</button><button class="primary-button" id="practice-again">${tr("重新摆球", "Rack again")}</button></div>` });
    $("#practice-again").addEventListener("click", resetPracticeFrame);
    $("#practice-exit").addEventListener("click", () => { closeModal(); leaveCurrentRoom(); });
    return;
  }
  model.winnerSeat = winnerSeat;
  model.rematchRequested = Boolean(room?.rematchSeats?.includes(model.liveSeat));
  model.settlement = settlement;
  if (room) model.currentRoom = room;
  showMessage(tr(`比赛结束 · Player ${winnerSeat + 1} 获胜`, `Frame complete · Player ${winnerSeat + 1} wins`), "score");
  renderPostMatchBar();
  renderSettlementModal();
  if (!settlementDetails().done) startSettlementPolling();
});
socket.on("game:settlement", ({ settlement }) => {
  updateSettlement(settlement);
});
socket.on("game:rematch-status", ({ seats, required }) => {
  model.rematchRequested = seats.includes(model.liveSeat);
  if (model.currentRoom) model.currentRoom.rematchSeats = seats;
  renderPostMatchBar();
  const hint = $("#rematch-hint");
  if (hint) hint.textContent = tr(`已确认 ${seats.length}/${required} · 等待双方同意`, `${seats.length}/${required} confirmed · Waiting for both players`);
});
socket.on("game:rematch-start", ({ room }) => {
  clearSettlementPolling();
  closeModal();
  model.settlement = null;
  model.winnerSeat = null;
  model.rematchRequested = false;
  hidePostMatchBar();
  model.currentRoom = room;
  model.stakeKas = Number(room?.stakeKas || model.stakeKas);
  engine.reset();
  showView("room");
  updateWaitingRoom(room);
  showMessage(tr("双方已同意重赛 · 请重新锁仓", "Rematch accepted · Please lock funds again"), "score");
});
socket.on("game:cue-placement", ({ placement }) => {
  if (engine.applyRemoteCuePlacement(placement)) showMessage(tr("对手已确认白球位置", "Opponent confirmed the cue-ball position"));
});
socket.on("game:reset", ({ snapshot, practiceMode }) => {
  if (snapshot) engine.importSnapshot(snapshot);
  model.winnerSeat = null;
  model.rematchRequested = false;
  hidePostMatchBar();
  if (practiceMode) {
    model.practiceMode = true;
    $("#shot-clock").textContent = "∞";
  }
  showMessage(tr("球台已重新布置", "Table re-racked"), "score");
});

function canShoot() {
  if (model.livePlayers.length < 2 || !Number.isInteger(model.liveSeat)) return true;
  if (engine.state.currentPlayer === model.liveSeat) return true;
  showMessage(tr("请等待对手完成击球", "Wait for your opponent to finish"), "foul");
  return false;
}

let cueBallDragging = false;
canvas.addEventListener("pointermove", (event) => {
  if (cueBallDragging) engine.moveCueBall(engine.localPoint(event));
  else engine.setAim(engine.localPoint(event));
});
canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  if (engine.needsCuePlacement()) {
    if (!canShoot()) return;
    event.preventDefault();
    canvas.setPointerCapture?.(event.pointerId);
    cueBallDragging = engine.startCuePlacement(engine.localPoint(event));
    return;
  }
  engine.setAim(engine.localPoint(event));
  if (event.pointerType === "mouse") {
    if (!canShoot()) return;
    canvas.setPointerCapture?.(event.pointerId);
    engine.beginTimedCharge();
  }
});
canvas.addEventListener("contextmenu", (event) => { event.preventDefault(); engine.cancelCharge(); });

function performShot() {
  if (!canShoot()) return;
  if (engine.needsCuePlacement()) {
    showMessage(tr("请先在 D 区摆放白球", "Place the cue ball inside the D first"), "foul");
    return;
  }
  if (!engine.shoot()) showMessage(engine.inMotion ? tr("请等待台面静止", "Wait until all balls stop") : tr("当前无法击球", "Unable to shoot now"), "foul");
}

let touchPulling = false;
let touchPullStartY = 0;
let touchPullDistance = 0;

function updateTouchPull(event) {
  if (!touchPulling) return;
  const groove = $("#touch-power-groove");
  const maxDistance = Math.max(42, groove.getBoundingClientRect().height * 0.82);
  touchPullDistance = Math.max(0, Math.min(maxDistance, event.clientY - touchPullStartY));
  engine.setPower(touchPullPower(touchPullDistance, maxDistance));
}

$("#touch-power-groove").addEventListener("pointerdown", (event) => {
  if (engine.needsCuePlacement()) {
    showMessage(tr("请先在 D 区摆放白球", "Place the cue ball inside the D first"), "foul");
    return;
  }
  if (!canShoot() || engine.inMotion) return;
  event.preventDefault();
  touchPulling = true;
  touchPullStartY = event.clientY;
  touchPullDistance = 0;
  $("#touch-power-groove").setPointerCapture?.(event.pointerId);
  engine.setPower(5);
  setChargeUI(true, "touch");
});
$("#touch-power-groove").addEventListener("pointermove", updateTouchPull);
$("#touch-power-groove").addEventListener("pointerup", (event) => {
  if (!touchPulling) return;
  updateTouchPull(event);
  touchPulling = false;
  setChargeUI(false, "touch");
  if (touchPullDistance < 5) {
    showMessage(tr("下拉力度杆后松开发杆", "Pull the power bar, then release to shoot"));
    return;
  }
  performShot();
});
$("#touch-power-groove").addEventListener("pointercancel", () => {
  touchPulling = false;
  setChargeUI(false, "touch");
});

function setSpinFromPointer(event) {
  const picker = $("#spin-picker");
  const rect = picker.getBoundingClientRect();
  const radius = Math.min(rect.width, rect.height) * 0.38;
  const x = (event.clientX - (rect.left + rect.width / 2)) / radius;
  const y = -((event.clientY - (rect.top + rect.height / 2)) / radius);
  engine.setSpin(x, y);
}

$("#spin-picker").addEventListener("pointerdown", (event) => {
  $("#spin-picker").setPointerCapture?.(event.pointerId);
  setSpinFromPointer(event);
});
$("#spin-picker").addEventListener("pointermove", (event) => {
  if (event.buttons) setSpinFromPointer(event);
});
$("#spin-picker").addEventListener("dblclick", () => engine.setSpin(0, 0));
$("#spin-picker").addEventListener("keydown", (event) => {
  const step = event.shiftKey ? 0.25 : 0.1;
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home"].includes(event.key)) return;
  event.preventDefault();
  if (event.key === "Home") engine.setSpin(0, 0);
  if (event.key === "ArrowLeft") engine.setSpin(engine.spin.x - step, engine.spin.y);
  if (event.key === "ArrowRight") engine.setSpin(engine.spin.x + step, engine.spin.y);
  if (event.key === "ArrowUp") engine.setSpin(engine.spin.x, engine.spin.y + step);
  if (event.key === "ArrowDown") engine.setSpin(engine.spin.x, engine.spin.y - step);
});

$("#aim-left").addEventListener("click", () => engine.nudgeAim(-0.35));
$("#aim-right").addEventListener("click", () => engine.nudgeAim(0.35));
$("#nomination-picker").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-color]");
  if (button) engine.setNominatedColor(button.dataset.color);
});
$("#cue-reposition").addEventListener("click", () => engine.enableCuePlacement());
window.addEventListener("keydown", (event) => {
  if (event.code === "Space" && !event.repeat && !$("#modal").classList.contains("open")) {
    event.preventDefault();
    if (engine.needsCuePlacement()) showMessage(tr("请先在 D 区摆放白球", "Place the cue ball inside the D first"), "foul");
    else if (canShoot()) engine.beginTimedCharge();
  }
  if (event.key === "Escape" && engine.cancelCharge()) event.preventDefault();
  if (["ArrowLeft", "ArrowRight"].includes(event.key) && event.target === document.body) {
    event.preventDefault();
    engine.nudgeAim(event.key === "ArrowLeft" ? -0.35 : 0.35);
  }
});
window.addEventListener("keyup", (event) => {
  if (event.code === "Space" && engine.charging) {
    event.preventDefault();
    engine.releaseTimedShot();
  }
});
window.addEventListener("pointerup", (event) => {
  if (cueBallDragging) {
    cueBallDragging = false;
    engine.finishCuePlacement();
    return;
  }
  if (event.pointerType === "mouse" && engine.charging) engine.releaseTimedShot();
});
window.addEventListener("pointercancel", (event) => {
  if (cueBallDragging) {
    cueBallDragging = false;
    engine.finishCuePlacement();
    return;
  }
  if (event.pointerType === "mouse") engine.cancelCharge();
});

if (coarsePointer.matches) {
  $("#aim-hint").textContent = tr("滑动球桌瞄准 · 设置母球击点 · 右侧力度杆下拉并松开发杆", "Swipe to aim · Set cue impact · Pull and release the power bar");
  $("#shot-instruction strong").textContent = tr("右侧下拉", "Pull power bar");
  $("#shot-instruction span").textContent = tr("松手发杆 · 球桌只瞄准", "Release to shoot · Table aims only");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.error || `HTTP ${response.status}`), { payload });
  return payload;
}

function socketRequest(event, payload, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(tr("服务响应超时，请重试", "Server response timed out. Please retry."))), timeoutMs);
    socket.emit(event, payload, (result) => {
      clearTimeout(timer);
      resolve(result || { ok: false, error: tr("服务未返回结果", "Server returned no result") });
    });
  });
}

async function loadConfig() {
  try {
    model.config = await api("/api/config");
    const network = model.config.network;
    $("#network-name").textContent = `${network.id.toUpperCase()} · ${network.isTestnet ? "TESTNET" : "MAINNET"}`;
    $(".lobby-kicker").innerHTML = `<i class="network-dot"></i> KASPA ${network.id.toUpperCase()} · AUTOMATIC SETTLEMENT`;
    $("#pot-symbol").textContent = network.symbol;
    $("#chain-mode").textContent = model.config.chainMode === "live" ? `${network.id.toUpperCase()} LIVE` : "SETTLEMENT OFFLINE";
    const options = (model.config.stakeOptions || []).filter((value, index, values) => Number(value) > 0 && values.indexOf(value) === index);
    if (options.length) {
      $("#create-stake").innerHTML = options.map((value, index) => `<option value="${value}" ${index === Math.min(2, options.length - 1) ? "selected" : ""}>${value} ${network.symbol} / ${tr("人", "player")}</option>`).join("");
      model.stakeKas = Number($("#create-stake").value);
    }
    $(".faucet-panel").hidden = !model.config.faucetAvailable;
    if (model.config.faucetAvailable) await loadFaucet();
    if (!network.isTestnet && !model.config.escrowReady) {
      showMessage(tr("主网安全配置未通过，已禁止锁仓", "Mainnet safety checks failed; escrow is disabled"), "foul");
    }
  } catch {
    showMessage(tr("结算服务暂未连接，游戏仍可离线试玩", "Settlement service is offline; local practice remains available"), "foul");
  }
}
loadConfig();

function playersPayload() {
  if (model.livePlayers.length === 2) {
    return model.livePlayers.slice().sort((a, b) => a.seat - b.seat).map((player) => ({
      address: player.address || "",
      publicKey: player.publicKey || ""
    }));
  }
  return [
    {
      address: model.wallet?.address || "kaspatest:demo-player-one",
      publicKey: model.wallet?.publicKey || demoKeys[0]
    },
    { address: model.opponent.address, publicKey: model.opponent.publicKey }
  ];
}

function gamePayload(extra = {}) {
  const state = engine.snapshot();
  return {
    roomId,
    roundId,
    stakeKas: model.stakeKas,
    players: playersPayload(),
    state: {
      roundId,
      scores: state.scores,
      currentPlayer: state.currentPlayer,
      redsRemaining: state.redsRemaining,
      phase: state.phase,
      target: state.target,
      nominatedColor: state.nominatedColor,
      breakScore: state.breakScore,
      respottedBlack: Boolean(state.respottedBlack),
      cueBallInHand: state.cueBallInHand,
      cuePlacementConfirmed: state.cuePlacementConfirmed,
      cuePlacements: state.cuePlacements,
      moves: state.visits
    },
    ...extra
  };
}

async function connectWallet() {
  const button = $("#wallet");
  if (model.wallet) {
    showWalletModal();
    return;
  }
  button.disabled = true;
  button.textContent = tr("连接中…", "Connecting…");
  try {
    const wallet = window.kasware;
    if (wallet?.requestAccounts) {
      const accounts = await wallet.requestAccounts();
      const address = accounts?.[0];
      if (!address || !address.toLowerCase().startsWith(`${model.config.network.addressPrefix}:`)) {
        throw new Error(tr(`钱包网络不匹配，请切换到 ${networkShortName()}`, `Wallet network mismatch. Switch to ${networkShortName()}.`));
      }
      let publicKey = "";
      try { publicKey = await wallet.getPublicKey(); } catch { /* surfaced in escrow readiness */ }
      model.wallet = { address, publicKey, provider: "Kasware" };
    } else {
      throw new Error(tr(`未检测到 KasWare 钱包，请安装扩展并切换到 Kaspa ${networkShortName()}`, `KasWare was not detected. Install the extension and switch to Kaspa ${networkShortName()}.`));
    }
    button.classList.add("connected");
    button.textContent = short(model.wallet.address, 6, 4);
    $("#player-name").textContent = model.wallet.provider === "Kasware" ? "YOU" : tr("访客球手", "Guest player");
    $("#player-address").textContent = short(model.wallet.address);
    $("#faucet-address").value = model.wallet.address;
    if (model.currentRoom?.status === "waiting") joinRoom(roomId);
    const step = $("#step-wallet");
    step.querySelector(".step-state").textContent = tr("已绑定", "Bound");
    step.querySelector(".step-sub").textContent = `${model.wallet.provider} · ${tr("公钥", "Public key ")}${model.wallet.publicKey ? tr("已读取", "read") : tr("待授权", "permission needed")}`;
  } catch (error) {
    showMessage(error.message || tr("钱包连接已取消", "Wallet connection cancelled"), "foul");
    button.textContent = tr("连接钱包", "Connect wallet");
  } finally {
    button.disabled = false;
  }
}

function openModal({ kind = "", eyebrow = "KASPA SNOOKER", title, body }) {
  $("#modal").dataset.kind = kind;
  $("#modal-eyebrow").textContent = eyebrow;
  $("#modal-title").textContent = title;
  $("#modal-body").innerHTML = body;
  $("#modal").classList.add("open");
}

function closeModal() { $("#modal").classList.remove("open"); }
$("#modal-close").addEventListener("click", closeModal);
$("#modal").addEventListener("click", (event) => { if (event.target === $("#modal")) closeModal(); });
window.addEventListener("keydown", (event) => { if (event.key === "Escape") closeModal(); });

function showWalletModal() {
  openModal({
    eyebrow: "PLAYER IDENTITY",
    title: tr("已连接钱包", "Wallet connected"),
    body: `<div class="data-grid"><div class="data-cell"><div class="data-label">Provider</div><div class="data-value good">${model.wallet.provider}</div></div><div class="data-cell"><div class="data-label">Network</div><div class="data-value">${model.config.network.label}</div></div><div class="data-cell" style="grid-column:1/-1"><div class="data-label">Address</div><div class="data-value">${model.wallet.address}</div></div></div><div class="modal-note">${tr("钱包只用于签署 Covenant 托管交易。游戏不会接触助记词或私钥。", "The wallet only signs Covenant escrow transactions. The game never accesses seed phrases or private keys.")}</div>`
  });
}

async function showEscrow() {
  openModal({ title: tr("正在生成托管方案…", "Generating escrow plan…"), body: `<div class="modal-note">${tr(`SDK 正在把房间、双方公钥和押注金额转换为 ${networkShortName()} Covenant intent。`, `The SDK is converting the room, both public keys and stakes into a ${networkShortName()} Covenant intent.`)}</div>` });
  try {
    const payload = await api("/api/escrow/intent", { method: "POST", body: JSON.stringify(gamePayload()) });
    model.chain.intent = payload.intent;
    const intent = payload.intent;
    const statusMap = {
      "ready-for-pskt-builder": [tr("签名草案已就绪", "Signing draft ready"), "good"],
      "needs-server-arbiter-key": [tr("等待结算验证密钥", "Waiting for settlement verifier key"), ""],
      "needs-player-public-keys": [tr("等待玩家公钥", "Waiting for player public keys"), ""],
      "waiting-for-two-players": [tr("等待对手加入", "Waiting for opponent"), ""]
    };
    const [statusText, statusClass] = statusMap[intent.status] || [intent.status, ""];
    $("#modal-title").textContent = tr("链上托管方案", "On-chain escrow plan");
    $("#modal-body").innerHTML = `
      <div class="data-grid">
        <div class="data-cell"><div class="data-label">Network</div><div class="data-value good">${intent.network}</div></div>
        <div class="data-cell"><div class="data-label">Status</div><div class="data-value ${statusClass}">${statusText}</div></div>
        <div class="data-cell"><div class="data-label">${tr("每人押注", "STAKE EACH")}</div><div class="data-value">${intent.stakeKas} ${model.config.network.symbol}</div></div>
        <div class="data-cell"><div class="data-label">${tr("锁定总额", "TOTAL LOCKED")}</div><div class="data-value good">${intent.totalLockedKas} ${model.config.network.symbol}</div></div>
        <div class="data-cell" style="grid-column:1/-1"><div class="data-label">Escrow ID</div><div class="data-value">${intent.id}</div></div>
        <div class="data-cell" style="grid-column:1/-1"><div class="data-label">Program Hash</div><div class="data-value">${intent.programHash || tr("将在结算验证服务配置后生成", "Generated after verifier setup")}</div></div>
      </div>
      <div class="modal-note">${tr("资金由双方直接锁入 Covenant。权威规则引擎自动判定结果，结算服务只能按照最终记录选择胜者释放路径。", "Both players lock funds directly into the Covenant. The authoritative engine determines the result, and settlement can only select the winner's release path.")}</div>
      <div class="modal-actions"><button class="outline-button" data-close>${tr("稍后处理", "Later")}</button><button class="primary-button" id="draft-action" ${intent.status !== "ready-for-pskt-builder" ? "disabled" : ""}>${intent.status === "ready-for-pskt-builder" ? tr("构建钱包签名草案", "Build wallet signing draft") : tr("配置尚未就绪", "Not ready")}</button></div>`;
    $("#modal-body [data-close]").addEventListener("click", closeModal);
    $("#draft-action")?.addEventListener("click", buildDraft);
    if (intent.status === "ready-for-pskt-builder") {
      const step = $("#step-lock");
      step.classList.remove("pending");
      step.querySelector(".step-state").textContent = tr("可签名", "Ready to sign");
    }
  } catch (error) {
    $("#modal-title").textContent = tr("托管方案生成失败", "Failed to generate escrow plan");
    $("#modal-body").innerHTML = `<div class="modal-note">${error.message}</div>`;
  }
}

async function buildDraft() {
  const action = $("#draft-action");
  action.disabled = true;
  action.textContent = tr(`查询 ${networkShortName()} UTXO…`, `Querying ${networkShortName()} UTXOs…`);
  try {
    const payload = await api("/api/escrow/draft", { method: "POST", body: JSON.stringify(gamePayload()) });
    const draft = payload.draft;
    $("#modal-body").innerHTML = `<div class="data-grid"><div class="data-cell"><div class="data-label">Covenant ID</div><div class="data-value good">${draft.covenantId}</div></div><div class="data-cell"><div class="data-label">Draft Status</div><div class="data-value">${draft.status}</div></div></div><div class="modal-note">${tr("签名草案已构建。下一步由双方钱包分别签署各自输入，再广播锁定交易。", "Signing draft built. Each wallet now signs its own input before the lock transaction is broadcast.")}</div>`;
  } catch (error) {
    action.disabled = false;
    action.textContent = tr("重试构建签名草案", "Retry signing draft");
    showMessage(error.message, "foul");
  }
}

function showSettings() {
  const practiceRows = model.practiceMode ? `
      <div class="settings-row"><div><div class="settings-name">${tr("练习模式", "Practice mode")}</div><div class="settings-help">${tr("无钱包、无押注、无链上结算", "No wallet, stake or settlement")}</div></div><strong>FREE PLAY</strong></div>
      <div class="settings-row"><div><div class="settings-name">${tr("重新摆球", "Rack again")}</div><div class="settings-help">${tr("清空当前比分并重新开始练习", "Clear scores and restart practice")}</div></div><button class="outline-button" id="practice-reset" style="width:auto;margin:0;padding:0 12px">${tr("重新摆球", "Rack again")}</button></div>
      <div class="settings-row"><div><div class="settings-name">${tr("退出练习", "Exit practice")}</div><div class="settings-help">${tr("关闭练习房间并返回游戏大厅", "Close the practice room and return to the lobby")}</div></div><button class="outline-button" id="practice-leave" style="width:auto;margin:0;padding:0 12px">${tr("返回大厅", "Return to lobby")}</button></div>` : `
      <div class="settings-row"><div><div class="settings-name">${tr("本局押注", "Frame stake")}</div><div class="settings-help">${tr("创建房间后不可修改，避免与链上锁仓金额不一致", "Cannot be changed after room creation")}</div></div><strong>${model.currentRoom?.stakeKas || model.stakeKas} ${currencySymbol()} / ${tr("人", "player")}</strong></div>`;
  openModal({
    eyebrow: "GAME SETTINGS · 游戏设置",
    title: tr("对局设置", "Game settings"),
    body: `
      <div class="settings-row"><div><div class="settings-name">${tr("声音", "Sound")}</div><div class="settings-help">${tr("击球、碰球、落袋和犯规提示音", "Shots, collisions, pots and foul cues")}</div></div><button class="outline-button" id="toggle-sound" style="width:auto;margin:0;padding:0 12px">${model.muted ? tr("开启", "Enable") : tr("关闭", "Disable")}</button></div>
      ${practiceRows}
      <div class="modal-note">${model.practiceMode ? tr("练习模式仍使用完整斯诺克规则，但你可以操作每一个回合。", "Practice uses the full rules, but you control every turn.") : tr("比赛开始后不能单方面重置、改分或手动指定赢家。超时、犯规、胜负和结算全部由服务端权威规则状态机处理。", "After the match starts, scores and winners cannot be changed manually. The authoritative server handles timeouts, fouls, results and settlement.")}</div>`
  });
  $("#toggle-sound").addEventListener("click", () => {
    model.muted = !model.muted;
    gameAudio.setMuted?.(model.muted);
    $("#toggle-sound").textContent = model.muted ? tr("开启", "Enable") : tr("关闭", "Disable");
  });
  $("#practice-reset")?.addEventListener("click", () => socket.emit("practice:reset", { roomId }, (result) => {
    if (!result?.ok) showMessage(result?.error || tr("无法重新摆球", "Unable to rack again"), "foul");
    else closeModal();
  }));
  $("#practice-leave")?.addEventListener("click", () => { closeModal(); leaveCurrentRoom(); });
}

function leaveCurrentRoom() {
  clearInterval(clockTimer);
  clearSettlementPolling();
  socket.emit("room:leave", { roomId }, () => {
    roomId = "";
    model.currentRoom = null;
    model.liveSeat = null;
    model.livePlayers = [];
    model.practiceMode = false;
    model.settlement = null;
    model.winnerSeat = null;
    model.rematchRequested = false;
    hidePostMatchBar();
    history.replaceState({}, "", location.pathname);
    showView("lobby");
  });
}

$("#language-toggle").addEventListener("click", () => {
  model.language = model.language === "zh" ? "en" : "zh";
  localStorage.setItem("kaspa-snooker-language", model.language);
  applyLanguage();
});
$("#wallet").addEventListener("click", connectWallet);
$("#create-room").addEventListener("click", () => {
  gameAudio.unlock();
  socket.emit("room:create", { ...identity(), stakeKas: Number($("#create-stake").value) }, enterRoom);
});
$("#join-room").addEventListener("click", () => joinRoom($("#join-code").value));
$("#join-code").addEventListener("keydown", (event) => { if (event.key === "Enter") joinRoom(event.target.value); });
$("#refresh-rooms").addEventListener("click", () => socket.emit("lobby:list", {}, (result) => renderLobbyRooms(result?.rooms || [])));
$("#practice-match").addEventListener("click", () => {
  gameAudio.unlock();
  const button = $("#practice-match");
  button.disabled = true;
  button.textContent = tr("正在布置练习球台…", "Racking practice table…");
  socket.emit("room:practice", { roomId }, (result) => {
    if (!result?.ok) {
      button.disabled = false;
      button.textContent = tr("单机练习", "Solo practice");
      showMessage(result?.error || tr("无法进入练习模式", "Unable to start practice"), "foul");
    }
  });
});
$("#lock-stake").addEventListener("click", async () => {
  gameAudio.unlock();
  if (!model.wallet) {
    await connectWallet();
    if (!model.wallet) return;
  }
  const button = $("#lock-stake");
  button.disabled = true;
  button.textContent = tr("正在构建双方锁仓交易…", "Building two-party escrow…");
  try {
    const prepared = await socketRequest("room:lock", { roomId });
    if (!prepared.ok) throw new Error(prepared.error || tr("锁仓草案创建失败", "Failed to create escrow draft"));
    if (prepared.status === "locked-on-chain") {
      showMessage(tr("锁仓交易已经上链", "Escrow transaction is on-chain"), "score");
      return;
    }
    if (prepared.status === "waiting-for-opponent-signature") {
      showMessage(tr("你的签名已提交，正在等待对手", "Your signature was submitted; waiting for opponent"), "score");
      return;
    }
    if (prepared.status === "confirming-lock-on-chain") {
      showMessage(tr(`锁仓交易已广播，正在等待 ${networkShortName()} 确认`, `Escrow broadcast; waiting for ${networkShortName()} confirmation`), "score");
      return;
    }
    if (prepared.status !== "signature-required" || !prepared.signing) throw new Error(tr("服务没有返回钱包签名草案", "Server did not return a wallet signing draft"));
    if (!window.kasware?.signPskt) throw new Error(tr("当前 KasWare 版本不支持 signPskt", "This KasWare version does not support signPskt"));
    button.textContent = tr("请在钱包中确认签名…", "Confirm signature in wallet…");
    const signedResult = await window.kasware.signPskt({
      txJsonString: prepared.signing.txJsonString,
      options: {
        signInputs: [{ index: prepared.signing.inputIndex, sighashType: prepared.signing.sighashType || 1 }]
      }
    });
    const signedTransactionSafeJson = typeof signedResult === "string"
      ? signedResult
      : signedResult?.signedTransactionSafeJson || signedResult?.txJsonString || "";
    button.textContent = tr("正在合并签名并广播…", "Merging signatures and broadcasting…");
    const submitted = await socketRequest("room:lock:submit", { roomId, signedTransactionSafeJson });
    if (!submitted.ok) throw new Error(submitted.error || tr("签名提交失败", "Signature submission failed"));
    if (submitted.status === "locked-on-chain") showMessage(tr(`双方押金已在 ${networkShortName()} 上锁定`, `Both stakes are locked on ${networkShortName()}`), "score");
    else if (submitted.status === "confirming-lock-on-chain") showMessage(tr("锁仓交易已广播，等待链上确认", "Escrow broadcast; waiting for confirmation"), "score");
    else showMessage(tr("签名已提交，等待对手签名后自动广播", "Signature submitted; broadcast starts after opponent signs"), "score");
  } catch (error) {
    socket.emit("room:lock:cancel", { roomId });
    showMessage(error.message || tr("锁仓失败", "Escrow failed"), "foul");
  } finally {
    const local = model.currentRoom?.players?.find((item) => item.seat === model.liveSeat);
    if (!local?.locked && local?.lockStatus !== "signed") {
      button.disabled = false;
      button.textContent = `${tr("签名并锁定", "Sign and lock")} ${model.currentRoom?.stakeKas || model.stakeKas} ${currencySymbol()}`;
    }
  }
});
$("#ready-match").addEventListener("click", () => socket.emit("room:ready", { roomId }, (result) => {
  if (!result?.ok) showMessage(result?.error || tr("无法准备", "Unable to ready up"), "foul");
}));
$("#back-lobby").addEventListener("click", leaveCurrentRoom);
$("#post-match-exit").addEventListener("click", () => { closeModal(); leaveCurrentRoom(); });
$("#post-match-rematch").addEventListener("click", () => {
  if (model.practiceMode) resetPracticeFrame();
  else requestRematch();
});

async function loadFaucet() {
  try {
    const info = await api("/api/faucet");
    model.faucet = info;
    $("#faucet-status").textContent = info.balanceKas === null ? `${tr("资金地址：", "Funding address: ")}${short(info.address)}` : `${tr("余额", "Balance")} ${Number(info.balanceKas).toFixed(2)} TKAS · ${short(info.address)}`;
  } catch (error) {
    $("#faucet-status").textContent = error.message || tr("水龙头暂不可用", "Faucet unavailable");
  }
}

$("#claim-faucet").addEventListener("click", async () => {
  const button = $("#claim-faucet");
  button.disabled = true;
  button.textContent = tr("发送中…", "Sending…");
  try {
    const result = await api("/api/faucet/claim", {
      method: "POST",
      body: JSON.stringify({ address: $("#faucet-address").value.trim(), amountKas: Number($("#faucet-amount").value) })
    });
    $("#faucet-status").textContent = `${tr("已发送", "Sent")} ${result.claim.amountKas} TKAS · ${short(result.claim.txids.at(-1) || "")}`;
    showMessage(tr("测试币已发送到钱包", "Testnet funds sent to wallet"), "score");
  } catch (error) {
    $("#faucet-status").textContent = error.message || tr("领取失败", "Claim failed");
    showMessage(error.message || tr("领取失败", "Claim failed"), "foul");
  } finally {
    button.disabled = false;
    button.textContent = tr("领取到钱包", "Claim to wallet");
  }
});

showView("lobby");
$("#escrow-action").addEventListener("click", showEscrow);
$("#settings").addEventListener("click", showSettings);
$("#copy-room").addEventListener("click", async () => {
  const shareUrl = `${location.origin}${location.pathname}?room=${roomId}`;
  await navigator.clipboard?.writeText(shareUrl);
  showMessage(tr(`房间链接 ${roomId} 已复制`, `Room link ${roomId} copied`), "score");
});
socket.connect();
