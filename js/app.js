import {
  compute,
  validateTotal,
  validatePeopleCount,
  isMultipleOf100,
  isPositiveInt,
  convertBottleAmount,
  buildSameSplitFixedList,
} from "./calc.js";

// ---------------------------------------------------------------
// state
// ---------------------------------------------------------------

function makePeople(n, existing = []) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    const id = `p${i + 1}`;
    const prev = existing.find((p) => p.id === id);
    arr.push({ id, name: prev ? prev.name : `お客様${i + 1}` });
  }
  return arr;
}

function defaultAnswers() {
  return {
    total: null,
    peopleCount: 4,
    people: makePeople(4),
    method: null, // 'even' | 'fixed' | 'same'
    bottles: [], // {id, amount, isMenuPrice, multiplier, payerIds:[]}
    bottleDraft: null,
    topups: [], // {personId, amount}
    topupDraft: null,
    fixed: [], // {personId, amount}
    fixedDraft: null,
    bottleParticipation: {}, // personId -> 'join' | 'onlyBottle'
    sameSplit: { payerId: null, otherAmount: null },
    extraRecipients: null,
  };
}

let state = {
  answers: defaultAnswers(),
  screen: "start",
  stack: [],
  error: null,
  amountTarget: null,
  participationIndex: 0,
  showBreakdown: false,
  selectedForSwap: null,
};

let bottleUidCounter = 1;
function nextBottleId() {
  return `bottle${bottleUidCounter++}`;
}

const app = document.getElementById("app");

// ---------------------------------------------------------------
// navigation
// ---------------------------------------------------------------

function goTo(screen) {
  state.stack.push(state.screen);
  state.screen = screen;
  state.error = null;
  render();
  scrollToTop();
}

function goBack() {
  if (state.stack.length === 0) return;
  state.screen = state.stack.pop();
  state.error = null;
  render();
  scrollToTop();
}

function resetAll() {
  bottleUidCounter = 1;
  state = {
    answers: defaultAnswers(),
    screen: "start",
    stack: [],
    error: null,
    amountTarget: null,
    participationIndex: 0,
    showBreakdown: false,
    selectedForSwap: null,
  };
  render();
  scrollToTop();
}

function restartWizardKeepAnswers() {
  state.stack = [];
  state.screen = "q1-total";
  state.error = null;
  state.showBreakdown = false;
  state.selectedForSwap = null;
  render();
  scrollToTop();
}

function scrollToTop() {
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------
// helpers
// ---------------------------------------------------------------

function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

function fmt(n) {
  return Number(n || 0).toLocaleString("ja-JP");
}

function eligibleForFixed() {
  const fixedIds = new Set(state.answers.fixed.map((f) => f.personId));
  return state.answers.people.filter((p) => !fixedIds.has(p.id));
}

function eligibleForBottlePayer() {
  const fixedIds = new Set(state.answers.fixed.map((f) => f.personId));
  return state.answers.people.filter((p) => !fixedIds.has(p.id));
}

function bottleOnlyPersonIds() {
  const ids = new Set();
  for (const [pid, choice] of Object.entries(state.answers.bottleParticipation)) {
    if (choice === "onlyBottle") ids.add(pid);
  }
  return ids;
}

function eligibleForTopup() {
  const fixedIds = new Set(state.answers.fixed.map((f) => f.personId));
  const onlyBottle = bottleOnlyPersonIds();
  const already = new Set(state.answers.topups.map((t) => t.personId));
  return state.answers.people.filter(
    (p) => !fixedIds.has(p.id) && !onlyBottle.has(p.id) && !already.has(p.id)
  );
}

function uniqueBottlePayerIds() {
  const seen = new Set();
  const order = [];
  for (const b of state.answers.bottles) {
    for (const pid of b.payerIds) {
      if (!seen.has(pid)) {
        seen.add(pid);
        order.push(pid);
      }
    }
  }
  return order;
}

function personName(id) {
  const p = state.answers.people.find((p) => p.id === id);
  return p ? p.name : "";
}

function bottleExactTotalSum(bottles) {
  return bottles.reduce(
    (s, b) => s + convertBottleAmount(b.amount, b.isMenuPrice, b.multiplier),
    0
  );
}

function cleanupParticipationMap() {
  const remaining = new Set(uniqueBottlePayerIds());
  for (const pid of Object.keys(state.answers.bottleParticipation)) {
    if (!remaining.has(pid)) delete state.answers.bottleParticipation[pid];
  }
}

function regeneratePeople(newCount) {
  const a = state.answers;
  a.people = makePeople(newCount, a.people);
  const validIds = new Set(a.people.map((p) => p.id));
  a.fixed = a.fixed.filter((f) => validIds.has(f.personId));
  a.topups = a.topups.filter((t) => validIds.has(t.personId));
  a.bottles = a.bottles
    .map((b) => ({ ...b, payerIds: b.payerIds.filter((id) => validIds.has(id)) }))
    .filter((b) => b.payerIds.length > 0);
  cleanupParticipationMap();
  if (a.sameSplit.payerId && !validIds.has(a.sameSplit.payerId)) {
    a.sameSplit.payerId = null;
  }
}

function runCompute() {
  const a = state.answers;
  if (a.method === "same") {
    const built = buildSameSplitFixedList(a.people, a.sameSplit.payerId, a.sameSplit.otherAmount);
    if (!built.ok) return built;
    return compute({
      total: a.total,
      people: a.people,
      fixed: built.fixed,
      bottles: [],
      topups: [],
      bottleParticipation: {},
      extraRecipients: a.extraRecipients,
    });
  }
  return compute({
    total: a.total,
    people: a.people,
    fixed: a.fixed,
    bottles: a.bottles,
    topups: a.topups,
    bottleParticipation: a.bottleParticipation,
    extraRecipients: a.extraRecipients,
  });
}

function proceedToResults() {
  const r = runCompute();
  if (!r.ok) {
    state.error = r.message;
    render();
    return;
  }
  state.answers.extraRecipients = null;
  state.showBreakdown = false;
  state.selectedForSwap = null;
  goTo("results");
}

// ---------------------------------------------------------------
// amount field accessors (used by generic amount screens)
// ---------------------------------------------------------------

function getAmountValue() {
  const a = state.answers;
  switch (state.amountTarget) {
    case "total":
      return a.total;
    case "bottleDraftAmount":
      return a.bottleDraft ? a.bottleDraft.amount : null;
    case "fixedDraftAmount":
      return a.fixedDraft ? a.fixedDraft.amount : null;
    case "topupDraftAmount":
      return a.topupDraft ? a.topupDraft.amount : null;
    case "sameAmount":
      return a.sameSplit.otherAmount;
    default:
      return null;
  }
}

function setAmountValue(num) {
  const a = state.answers;
  switch (state.amountTarget) {
    case "total":
      a.total = num;
      break;
    case "bottleDraftAmount":
      if (a.bottleDraft) a.bottleDraft.amount = num;
      break;
    case "fixedDraftAmount":
      if (a.fixedDraft) a.fixedDraft.amount = num;
      break;
    case "topupDraftAmount":
      if (a.topupDraft) a.topupDraft.amount = num;
      break;
    case "sameAmount":
      a.sameSplit.otherAmount = num;
      break;
  }
}

// ---------------------------------------------------------------
// layout
// ---------------------------------------------------------------

function layout({ title, subtitle = "", body = "", footer = "", showBack = true, eyebrow = "" }) {
  return `
    <div class="screen">
      <div class="topbar">
        ${showBack ? `<button class="back-btn" data-action="back" type="button">‹ 戻る</button>` : ""}
      </div>
      ${eyebrow ? `<div class="hint">${esc(eyebrow)}</div>` : ""}
      <div class="question">${title}</div>
      ${subtitle ? `<div class="subtext">${subtitle}</div>` : ""}
      <div class="body">
        ${state.error ? `<div class="error-box">${esc(state.error)}</div>` : ""}
        ${body}
      </div>
      <div class="footer">${footer}</div>
    </div>
  `;
}

function amountEntryBody() {
  const val = getAmountValue();
  const display = val ? Number(val).toLocaleString("ja-JP") : "";
  return `
    <div class="amount-row">
      <input class="amount-display" id="amount-input" type="tel" inputmode="numeric" pattern="[0-9]*"
        placeholder="0" value="${display}" data-bind="amount" autocomplete="off" />
      <span class="yen">円</span>
    </div>
    <div class="hint">数字だけ入力してください。カンマは自動で付きます。</div>
  `;
}

function focusAmountInputSoon() {
  requestAnimationFrame(() => {
    const el = document.getElementById("amount-input");
    if (el) el.focus();
  });
}

function personCheckRow({ id, name }, { type, checked }) {
  return `
    <label class="person-row ${checked ? "selected" : ""}">
      <input type="${type}" name="person-pick" data-action="pick-person" data-id="${esc(id)}" ${checked ? "checked" : ""} />
      <input type="text" data-bind="rename" data-id="${esc(id)}" value="${esc(name)}" maxlength="20" />
    </label>
  `;
}

// ---------------------------------------------------------------
// screens
// ---------------------------------------------------------------

function renderStart() {
  return layout({
    showBack: false,
    eyebrow: "CLUB TERRA",
    title: "割り勘計算",
    subtitle: "質問に順番に答えるだけで、誰がいくら払うかが分かります。",
    body: `<div class="hint">お客様の情報や金額はこの端末の中だけで計算され、サーバーには保存されません。</div>`,
    footer: `<button class="btn btn-primary" data-action="start-begin" type="button">はじめる</button>`,
  });
}

function renderQ1Total() {
  state.amountTarget = "total";
  return layout({
    title: "お会計はいくら？",
    subtitle: "税・サービス料などを含めた、最終的な会計額を入力してください。",
    body: amountEntryBody(),
    footer: `<button class="btn btn-primary" data-action="q1-next" type="button">次へ</button>`,
  });
}

function renderQ2People() {
  const n = state.answers.peopleCount;
  return layout({
    title: "全部で何人？",
    subtitle: "支払う人の合計人数です。",
    body: `
      <div class="stepper">
        <button class="stepper-btn" data-action="people-dec" type="button" ${n <= 2 ? "disabled" : ""}>−</button>
        <div>
          <div class="stepper-value">${n}</div>
          <div class="stepper-unit">人</div>
        </div>
        <button class="stepper-btn" data-action="people-inc" type="button" ${n >= 30 ? "disabled" : ""}>＋</button>
      </div>
    `,
    footer: `<button class="btn btn-primary" data-action="q2-next" type="button">次へ</button>`,
  });
}

function renderQ3Method() {
  return layout({
    title: "どうやって払う？",
    body: `
      <button class="btn btn-choice" data-action="select-method" data-value="even" type="button">
        ① みんなで割り勘<span class="desc">全員でできるだけ均等に分けます</span>
      </button>
      <button class="btn btn-choice" data-action="select-method" data-value="fixed" type="button">
        ② 払う金額が決まっている人がいる<span class="desc">一部の人の金額を先に決めます</span>
      </button>
      <button class="btn btn-choice" data-action="select-method" data-value="same" type="button">
        ③ みんな同じ額を払い、残りを1人が払う<span class="desc">1人だけ金額が変わります</span>
      </button>
    `,
    footer: "",
  });
}

function renderCoreBottleAsk() {
  return layout({
    title: "ボトル代を別に払う人はいる？",
    body: `
      <button class="btn btn-choice" data-action="bottle-ask-choice" data-value="no" type="button">いない</button>
      <button class="btn btn-choice" data-action="bottle-ask-choice" data-value="yes" type="button">いる</button>
    `,
    footer: "",
  });
}

function renderBottleAmount() {
  state.amountTarget = "bottleDraftAmount";
  return layout({
    title: "ボトルはいくら？",
    subtitle: "メニューの金額でも、税・サービス料込みの金額でも、そのまま入力してください。",
    body: amountEntryBody(),
    footer: `<button class="btn btn-primary" data-action="bottle-amount-next" type="button">次へ</button>`,
  });
}

function renderBottleType() {
  const d = state.answers.bottleDraft;
  const isMenu = d.isMenuPrice;
  return layout({
    title: "メニューの金額？ 税・サービス料込み？",
    body: `
      <div class="toggle-row">
        <button class="btn ${isMenu ? "active" : ""}" data-action="bottle-type-choice" data-value="menu" type="button">メニューの金額</button>
        <button class="btn ${!isMenu ? "active" : ""}" data-action="bottle-type-choice" data-value="actual" type="button">税・サービス料込み</button>
      </div>
      ${
        isMenu
          ? `
      <details class="settings">
        <summary>倍率を変更する（適用中：${esc(d.multiplier)}倍）</summary>
        <div class="settings-body">
          <div class="multiplier-row">
            <input type="text" inputmode="decimal" data-change="multiplier" value="${esc(d.multiplier)}" />
            <span class="hint">倍</span>
          </div>
          <div class="hint">初期値は1.3倍です。税・サービス料の設定に合わせて変えられます。</div>
        </div>
      </details>`
          : `<div class="hint">この金額をそのまま使います。倍率はかけません。</div>`
      }
    `,
    footer: `<button class="btn btn-primary" data-action="bottle-type-next" type="button">次へ</button>`,
  });
}

function renderBottlePayers() {
  const d = state.answers.bottleDraft;
  const people = eligibleForBottlePayer();
  const rows = people
    .map((p) => personCheckRow(p, { type: "checkbox", checked: d.payerIds.includes(p.id) }))
    .join("");
  return layout({
    title: "誰が払う？",
    subtitle: "このボトルの代金を払う人を選んでください。複数人選べます。",
    body: `<div class="card-list">${rows}</div>`,
    footer: `<button class="btn btn-primary" data-action="bottle-payers-next" type="button">次へ</button>`,
  });
}

function bottleSummaryText(b) {
  const exact = convertBottleAmount(b.amount, b.isMenuPrice, b.multiplier);
  const typeText = b.isMenuPrice ? `メニュー価格 × ${b.multiplier}倍` : "税・サービス料込み";
  const names = b.payerIds.map(personName).join("、");
  return `
    <div class="item-card">
      <div class="info">
        <b>${fmt(b.amount)}円</b>（${esc(typeText)} → ${fmt(exact)}円）<br/>
        負担する人：${esc(names)}
      </div>
      <button class="del" data-action="bottle-delete" data-id="${esc(b.id)}" type="button">削除</button>
    </div>
  `;
}

function renderBottleAddMore() {
  const list = state.answers.bottles.map(bottleSummaryText).join("");
  return layout({
    title: "もう1本、ボトルを追加しますか？",
    body: `
      ${list ? `<div class="card-list">${list}</div>` : ""}
      <button class="btn btn-choice" data-action="bottle-add-more-choice" data-value="yes" type="button">もう1本追加する</button>
      <button class="btn btn-choice" data-action="bottle-add-more-choice" data-value="no" type="button">次へ</button>
    `,
    footer: "",
  });
}

function renderBottleParticipation() {
  const ids = uniqueBottlePayerIds();
  const pid = ids[state.participationIndex];
  if (!pid) {
    // 念のため：担当者がいなければ次に進む
    state.screen = "core-topup-ask";
    return renderCoreTopupAsk();
  }
  return layout({
    title: `${esc(personName(pid))}は、残りを割り勘する？`,
    subtitle: "ボトル代のほかに、残りの会計も一緒に割り勘するか選んでください。",
    body: `
      <button class="btn btn-choice" data-action="participation-choice" data-value="join" type="button">
        一緒に割り勘する
      </button>
      <button class="btn btn-choice" data-action="participation-choice" data-value="onlyBottle" type="button">
        ボトル代だけ払う
      </button>
    `,
    footer: "",
  });
}

function renderCoreTopupAsk() {
  return layout({
    title: "少し多めに払う人はいる？",
    body: `
      <button class="btn btn-choice" data-action="topup-ask-choice" data-value="no" type="button">いない</button>
      <button class="btn btn-choice" data-action="topup-ask-choice" data-value="yes" type="button">いる</button>
    `,
    footer: "",
  });
}

function renderTopupPerson() {
  const people = eligibleForTopup();
  const d = state.answers.topupDraft;
  const rows = people
    .map((p) => personCheckRow(p, { type: "radio", checked: d.personId === p.id }))
    .join("");
  return layout({
    title: "誰が？",
    subtitle: "割り勘分に上乗せして払う人を選んでください。",
    body: people.length
      ? `<div class="card-list">${rows}</div>`
      : `<div class="hint">選べる人がいません。</div>`,
    footer: `<button class="btn btn-primary" data-action="topup-person-next" type="button">次へ</button>`,
  });
}

function renderTopupAmount() {
  state.amountTarget = "topupDraftAmount";
  const name = personName(state.answers.topupDraft.personId);
  return layout({
    title: "割り勘分に、いくら上乗せする？",
    subtitle: `${esc(name)}さんが、均等割りの金額に追加で払う金額です。最終的な支払額ではありません。`,
    body: amountEntryBody(),
    footer: `<button class="btn btn-primary" data-action="topup-amount-next" type="button">次へ</button>`,
  });
}

function renderTopupAddMore() {
  const list = state.answers.topups
    .map(
      (t) => `
      <div class="item-card">
        <div class="info"><b>${esc(personName(t.personId))}</b>：割り勘分に ${fmt(t.amount)}円 上乗せ</div>
        <button class="del" data-action="topup-delete" data-id="${esc(t.personId)}" type="button">削除</button>
      </div>`
    )
    .join("");
  return layout({
    title: "もう1人、追加しますか？",
    body: `
      ${list ? `<div class="card-list">${list}</div>` : ""}
      <button class="btn btn-choice" data-action="topup-add-more-choice" data-value="yes" type="button">もう1人追加する</button>
      <button class="btn btn-choice" data-action="topup-add-more-choice" data-value="no" type="button">次へ</button>
    `,
    footer: "",
  });
}

function renderFixedPerson() {
  const people = eligibleForFixed();
  const d = state.answers.fixedDraft;
  const rows = people
    .map((p) => personCheckRow(p, { type: "radio", checked: d.personId === p.id }))
    .join("");
  return layout({
    title: "誰が払いますか？",
    subtitle: "合計の支払額が決まっている人を選んでください。",
    body: people.length
      ? `<div class="card-list">${rows}</div>`
      : `<div class="hint">選べる人がいません。</div>`,
    footer: `<button class="btn btn-primary" data-action="fixed-person-next" type="button">次へ</button>`,
  });
}

function renderFixedAmount() {
  state.amountTarget = "fixedDraftAmount";
  const name = personName(state.answers.fixedDraft.personId);
  return layout({
    title: "合計いくら払いますか？",
    subtitle: `${esc(name)}さんが最終的に払う金額です。ボトル代や上乗せ額はあとから足しません。`,
    body: amountEntryBody(),
    footer: `<button class="btn btn-primary" data-action="fixed-amount-next" type="button">次へ</button>`,
  });
}

function renderFixedAddMore() {
  const list = state.answers.fixed
    .map(
      (f) => `
      <div class="item-card">
        <div class="info"><b>${esc(personName(f.personId))}</b>：合計 ${fmt(f.amount)}円</div>
        <button class="del" data-action="fixed-delete" data-id="${esc(f.personId)}" type="button">削除</button>
      </div>`
    )
    .join("");
  return layout({
    title: "もう1人、追加しますか？",
    body: `
      ${list ? `<div class="card-list">${list}</div>` : ""}
      <button class="btn btn-choice" data-action="fixed-add-more-choice" data-value="yes" type="button">もう1人追加する</button>
      <button class="btn btn-choice" data-action="fixed-add-more-choice" data-value="no" type="button">次へ</button>
    `,
    footer: "",
  });
}

function renderSamePayer() {
  const people = state.answers.people;
  const sel = state.answers.sameSplit.payerId;
  const rows = people
    .map((p) => personCheckRow(p, { type: "radio", checked: sel === p.id }))
    .join("");
  return layout({
    title: "残りを払うのは誰？",
    subtitle: "ほかの人と違う金額を払う、1人を選んでください。",
    body: `<div class="card-list">${rows}</div>`,
    footer: `<button class="btn btn-primary" data-action="same-payer-next" type="button">次へ</button>`,
  });
}

function renderSameAmount() {
  state.amountTarget = "sameAmount";
  return layout({
    title: "ほかのみんなは、1人いくら払う？",
    subtitle: `${esc(personName(state.answers.sameSplit.payerId))}さん以外の全員が、この同じ金額を払います。`,
    body: amountEntryBody(),
    footer: `<button class="btn btn-primary" data-action="same-amount-next" type="button">次へ</button>`,
  });
}

function renderResults() {
  const r = runCompute();
  if (!r.ok) {
    return layout({
      title: "計算できませんでした",
      body: `<div class="error-box">${esc(r.message)}</div>`,
      footer: `<button class="btn btn-primary" data-action="fix-input" type="button">入力を修正</button>`,
    });
  }

  const swappable = r.extraCount > 0;
  const participantSet = new Set(r.participantIds);
  const extraSet = new Set(r.extraRecipients);

  const rows = r.perPerson
    .map((p) => {
      const isSwappable = swappable && participantSet.has(p.id);
      const isSelected = state.selectedForSwap === p.id;
      const hasExtra = extraSet.has(p.id);
      return `
        <div class="person-result ${isSwappable ? "swappable" : ""} ${isSelected ? "swap-selected" : ""}"
             ${isSwappable ? `data-action="swap-tap" data-id="${esc(p.id)}"` : ""}>
          <div class="names">${esc(p.name)}${hasExtra && swappable ? `<span class="badge">+100円</span>` : ""}</div>
          <div class="amount">${fmt(p.amount)}円</div>
        </div>
      `;
    })
    .join("");

  const breakdown = state.showBreakdown
    ? `
      <div class="breakdown">
        <div style="margin-bottom:8px;"><b>計算式</b><br/>
        会計総額 − 固定額 − ボトル代(切り捨て後) − 上乗せ額 = 残額<br/>
        残額を100円単位でできるだけ均等に分け、余った100円を1人ずつに配る</div>
        ${r.perPerson.map((p) => `<div>${esc(p.name)}：${breakdownLine(p)}</div>`).join("")}
      </div>
    `
    : "";

  const matchOk = r.sumTotal === r.total;

  return layout({
    showBack: false,
    title: "この金額をいただいてください",
    body: `
      <div class="card-list">${rows}</div>
      <div class="result-total">
        <div class="row"><span>会計総額</span><b>${fmt(r.total)}円</b></div>
        <div class="row"><span>支払合計</span><b>${fmt(r.sumTotal)}円</b></div>
        <div class="row"><span>状態</span><b class="${matchOk ? "match-ok" : "match-ng"}">${matchOk ? "合計一致 ✓" : "不一致"}</b></div>
      </div>
      ${swappable ? `<div class="hint">「+100円」の人をタップすると、もう1人と入れ替えられます（合計は変わりません）。</div>` : ""}
      <button class="btn btn-outline" data-action="toggle-breakdown" type="button">${state.showBreakdown ? "内訳を閉じる" : "内訳を見る"}</button>
      ${breakdown}
    `,
    footer: `
      <button class="btn btn-outline" data-action="fix-input" type="button">入力を修正</button>
      <button class="btn btn-danger-outline" data-action="new-calc" type="button">新しい会計</button>
    `,
  });
}

function breakdownLine(p) {
  const b = p.breakdown;
  const parts = [];
  if (b.fixed) {
    parts.push(`固定額 ${fmt(b.fixed)}円`);
  } else {
    if (b.evenBase || b.extra) parts.push(`均等割り ${fmt(b.evenBase + b.extra)}円`);
    if (b.topup) parts.push(`上乗せ ${fmt(b.topup)}円`);
    if (b.bottleTruncated || b.bottleExactBeforeCut) {
      const note =
        b.bottleExactBeforeCut !== b.bottleTruncated
          ? `（換算${fmt(b.bottleExactBeforeCut)}円→${fmt(b.bottleTruncated)}円）`
          : "";
      parts.push(`ボトル代 ${fmt(b.bottleTruncated)}円${note}`);
    }
  }
  if (parts.length === 0) parts.push("0円");
  return `${parts.join(" + ")} = ${fmt(p.amount)}円`;
}

// ---------------------------------------------------------------
// screen table + render
// ---------------------------------------------------------------

const screens = {
  start: renderStart,
  "q1-total": renderQ1Total,
  "q2-people": renderQ2People,
  "q3-method": renderQ3Method,
  "core-bottle-ask": renderCoreBottleAsk,
  "bottle-amount": renderBottleAmount,
  "bottle-type": renderBottleType,
  "bottle-payers": renderBottlePayers,
  "bottle-add-more": renderBottleAddMore,
  "bottle-participation": renderBottleParticipation,
  "core-topup-ask": renderCoreTopupAsk,
  "topup-person": renderTopupPerson,
  "topup-amount": renderTopupAmount,
  "topup-add-more": renderTopupAddMore,
  "fixed-person": renderFixedPerson,
  "fixed-amount": renderFixedAmount,
  "fixed-add-more": renderFixedAddMore,
  "same-payer": renderSamePayer,
  "same-amount": renderSameAmount,
  results: renderResults,
};

const AMOUNT_SCREENS = new Set([
  "q1-total",
  "bottle-amount",
  "topup-amount",
  "fixed-amount",
  "same-amount",
]);

function render() {
  const fn = screens[state.screen] || renderStart;
  app.innerHTML = fn();
  if (AMOUNT_SCREENS.has(state.screen)) focusAmountInputSoon();
}

// ---------------------------------------------------------------
// flow after bottle steps
// ---------------------------------------------------------------

function goToAfterBottleParticipation() {
  goTo("core-topup-ask");
}

function afterBottleLoopFinished() {
  if (bottleExactTotalSum(state.answers.bottles) > state.answers.total) {
    state.error = "ボトル代の換算合計（切り捨て前）が会計総額を超えています。ボトルの金額を確認してください。";
    render();
    return;
  }
  const payers = uniqueBottlePayerIds();
  if (payers.length > 0) {
    state.participationIndex = 0;
    goTo("bottle-participation");
  } else {
    goTo("core-topup-ask");
  }
}

// ---------------------------------------------------------------
// action handlers
// ---------------------------------------------------------------

function handleAction(action, el) {
  const a = state.answers;

  switch (action) {
    case "back":
      goBack();
      return;

    case "start-begin":
      goTo("q1-total");
      return;

    case "q1-next": {
      const check = validateTotal(a.total);
      if (!check.ok) {
        state.error = check.message;
        render();
        return;
      }
      goTo("q2-people");
      return;
    }

    case "people-dec":
      if (a.peopleCount > 2) {
        regeneratePeople(a.peopleCount - 1);
        a.peopleCount -= 1;
        render();
      }
      return;

    case "people-inc":
      if (a.peopleCount < 30) {
        regeneratePeople(a.peopleCount + 1);
        a.peopleCount += 1;
        render();
      }
      return;

    case "q2-next": {
      const check = validatePeopleCount(a.peopleCount);
      if (!check.ok) {
        state.error = check.message;
        render();
        return;
      }
      goTo("q3-method");
      return;
    }

    case "select-method": {
      const v = el.dataset.value;
      a.method = v;
      a.bottles = [];
      a.bottleDraft = null;
      a.topups = [];
      a.topupDraft = null;
      a.fixed = [];
      a.fixedDraft = null;
      a.bottleParticipation = {};
      a.sameSplit = { payerId: null, otherAmount: null };
      if (v === "even") {
        goTo("core-bottle-ask");
      } else if (v === "fixed") {
        a.fixedDraft = { personId: null, amount: null };
        goTo("fixed-person");
      } else if (v === "same") {
        goTo("same-payer");
      }
      return;
    }

    case "bottle-ask-choice": {
      const v = el.dataset.value;
      if (v === "no") {
        goTo("core-topup-ask");
      } else {
        a.bottleDraft = { amount: null, isMenuPrice: true, multiplier: 1.3, payerIds: [] };
        goTo("bottle-amount");
      }
      return;
    }

    case "bottle-amount-next": {
      if (!isPositiveInt(a.bottleDraft.amount)) {
        state.error = "ボトルの金額を入力してください。";
        render();
        return;
      }
      goTo("bottle-type");
      return;
    }

    case "bottle-type-choice": {
      a.bottleDraft.isMenuPrice = el.dataset.value === "menu";
      render();
      return;
    }

    case "bottle-type-next":
      goTo("bottle-payers");
      return;

    case "pick-person": {
      const id = el.dataset.id;
      if (state.screen === "bottle-payers") {
        const idx = a.bottleDraft.payerIds.indexOf(id);
        if (idx === -1) a.bottleDraft.payerIds.push(id);
        else a.bottleDraft.payerIds.splice(idx, 1);
        render();
      } else if (state.screen === "topup-person") {
        a.topupDraft.personId = id;
        render();
      } else if (state.screen === "fixed-person") {
        a.fixedDraft.personId = id;
        render();
      } else if (state.screen === "same-payer") {
        a.sameSplit.payerId = id;
        render();
      }
      return;
    }

    case "bottle-payers-next": {
      if (a.bottleDraft.payerIds.length === 0) {
        state.error = "ボトルの負担者を選んでください。";
        render();
        return;
      }
      const bottle = { id: nextBottleId(), ...a.bottleDraft };
      a.bottles.push(bottle);
      a.bottleDraft = null;
      goTo("bottle-add-more");
      return;
    }

    case "bottle-delete": {
      const id = el.dataset.id;
      a.bottles = a.bottles.filter((b) => b.id !== id);
      cleanupParticipationMap();
      render();
      return;
    }

    case "bottle-add-more-choice": {
      const v = el.dataset.value;
      if (v === "yes") {
        a.bottleDraft = { amount: null, isMenuPrice: true, multiplier: 1.3, payerIds: [] };
        goTo("bottle-amount");
      } else {
        afterBottleLoopFinished();
      }
      return;
    }

    case "participation-choice": {
      const ids = uniqueBottlePayerIds();
      const pid = ids[state.participationIndex];
      a.bottleParticipation[pid] = el.dataset.value;
      if (el.dataset.value === "onlyBottle") {
        a.topups = a.topups.filter((t) => t.personId !== pid);
      }
      state.participationIndex += 1;
      if (state.participationIndex >= ids.length) {
        goToAfterBottleParticipation();
      } else {
        render();
      }
      return;
    }

    case "topup-ask-choice": {
      const v = el.dataset.value;
      if (v === "no") {
        proceedToResults();
      } else {
        a.topupDraft = { personId: null, amount: null };
        goTo("topup-person");
      }
      return;
    }

    case "topup-person-next": {
      if (!a.topupDraft.personId) {
        state.error = "上乗せする人を選んでください。";
        render();
        return;
      }
      goTo("topup-amount");
      return;
    }

    case "topup-amount-next": {
      const amt = a.topupDraft.amount;
      if (!isMultipleOf100(amt) || amt <= 0) {
        state.error = "上乗せ額は100円単位で入力してください。";
        render();
        return;
      }
      a.topups.push({ personId: a.topupDraft.personId, amount: amt });
      a.topupDraft = null;
      goTo("topup-add-more");
      return;
    }

    case "topup-delete": {
      const id = el.dataset.id;
      a.topups = a.topups.filter((t) => t.personId !== id);
      render();
      return;
    }

    case "topup-add-more-choice": {
      const v = el.dataset.value;
      if (v === "yes") {
        a.topupDraft = { personId: null, amount: null };
        goTo("topup-person");
      } else {
        proceedToResults();
      }
      return;
    }

    case "fixed-person-next": {
      if (!a.fixedDraft.personId) {
        state.error = "払う人を選んでください。";
        render();
        return;
      }
      goTo("fixed-amount");
      return;
    }

    case "fixed-amount-next": {
      const amt = a.fixedDraft.amount;
      if (!isMultipleOf100(amt) || amt <= 0) {
        state.error = "固定額は100円単位で入力してください。";
        render();
        return;
      }
      a.fixed.push({ personId: a.fixedDraft.personId, amount: amt });
      a.fixedDraft = null;
      goTo("fixed-add-more");
      return;
    }

    case "fixed-delete": {
      const id = el.dataset.id;
      a.fixed = a.fixed.filter((f) => f.personId !== id);
      render();
      return;
    }

    case "fixed-add-more-choice": {
      const v = el.dataset.value;
      if (v === "yes") {
        a.fixedDraft = { personId: null, amount: null };
        goTo("fixed-person");
        return;
      }
      const fixedSum = a.fixed.reduce((s, f) => s + f.amount, 0);
      if (fixedSum > a.total) {
        state.error = "固定で払う金額の合計が会計総額を超えています。固定額を確認してください。";
        render();
        return;
      }
      const remaining = eligibleForFixed();
      if (remaining.length === 0) {
        proceedToResults();
      } else {
        goTo("core-bottle-ask");
      }
      return;
    }

    case "same-payer-next": {
      if (!a.sameSplit.payerId) {
        state.error = "残りを払う人を選んでください。";
        render();
        return;
      }
      goTo("same-amount");
      return;
    }

    case "same-amount-next": {
      const built = buildSameSplitFixedList(a.people, a.sameSplit.payerId, a.sameSplit.otherAmount);
      if (!built.ok) {
        state.error = built.message;
        render();
        return;
      }
      const othersTotal = (a.sameSplit.otherAmount || 0) * built.othersCount;
      if (othersTotal > a.total) {
        state.error = "1人あたりの金額が大きすぎます。会計総額を超えてしまいます。";
        render();
        return;
      }
      proceedToResults();
      return;
    }

    case "toggle-breakdown":
      state.showBreakdown = !state.showBreakdown;
      render();
      return;

    case "swap-tap": {
      const id = el.dataset.id;
      const r = runCompute();
      if (!r.ok || r.extraCount <= 0) return;
      const participantSet = new Set(r.participantIds);
      if (!participantSet.has(id)) return;

      if (state.selectedForSwap == null) {
        state.selectedForSwap = id;
        render();
        return;
      }
      if (state.selectedForSwap === id) {
        state.selectedForSwap = null;
        render();
        return;
      }
      const extraSet = new Set(r.extraRecipients);
      const aHas = extraSet.has(state.selectedForSwap);
      const bHas = extraSet.has(id);
      if (aHas === bHas) {
        state.selectedForSwap = id;
        render();
        return;
      }
      if (aHas) {
        extraSet.delete(state.selectedForSwap);
        extraSet.add(id);
      } else {
        extraSet.delete(id);
        extraSet.add(state.selectedForSwap);
      }
      a.extraRecipients = [...extraSet];
      state.selectedForSwap = null;
      render();
      return;
    }

    case "fix-input":
      restartWizardKeepAnswers();
      return;

    case "new-calc":
      if (window.confirm("入力をすべて消して、新しい会計を始めますか？")) {
        resetAll();
      }
      return;
  }
}

// ---------------------------------------------------------------
// input handlers (avoid full re-render so focus/cursor is kept)
// ---------------------------------------------------------------

function handleAmountInput(input) {
  const raw = input.value.replace(/[^0-9]/g, "").slice(0, 9);
  const num = raw === "" ? null : parseInt(raw, 10);
  input.value = raw === "" ? "" : Number(raw).toLocaleString("ja-JP");
  setAmountValue(num);
}

function handleRenameChange(input) {
  const id = input.dataset.id;
  const person = state.answers.people.find((p) => p.id === id);
  if (person) {
    const v = input.value.trim();
    person.name = v || person.name;
    input.value = person.name;
  }
}

function handleMultiplierChange(input) {
  const v = parseFloat(input.value);
  if (state.answers.bottleDraft) {
    state.answers.bottleDraft.multiplier = isPositiveNumber(v) ? v : 1.3;
  }
  // details/summary が閉じてしまわないよう、ここでは再描画しない。
  // 次にこの画面を表示し直したときに反映される。
}

function isPositiveNumber(v) {
  return typeof v === "number" && !Number.isNaN(v) && v > 0;
}

// ---------------------------------------------------------------
// wiring
// ---------------------------------------------------------------

app.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  handleAction(el.dataset.action, el);
});

app.addEventListener("input", (e) => {
  const t = e.target;
  if (t.dataset && t.dataset.bind === "amount") {
    handleAmountInput(t);
  }
});

app.addEventListener("change", (e) => {
  const t = e.target;
  if (t.dataset && t.dataset.bind === "rename") {
    handleRenameChange(t);
  } else if (t.dataset && t.dataset.change === "multiplier") {
    handleMultiplierChange(t);
  }
});

render();
