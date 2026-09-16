import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compute,
  validateTotal,
  splitEvenly100,
  buildSameSplitFixedList,
} from "../js/calc.js";

function people(n) {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `お客様${i + 1}` }));
}

function amountsById(result) {
  const m = {};
  for (const p of result.perPerson) m[p.id] = p.amount;
  return m;
}

test("会計額が100円単位でなければ止まる", () => {
  const r = validateTotal(133450);
  assert.equal(r.ok, false);
  assert.match(r.message, /100円単位/);
});

test("例1: 均等な割り勘 133,400円 / 4人", () => {
  const r = compute({ total: 133400, people: people(4), fixed: [], bottles: [], topups: [] });
  assert.equal(r.ok, true);
  const amounts = r.perPerson.map((p) => p.amount).sort((a, b) => b - a);
  assert.deepEqual(amounts, [33400, 33400, 33300, 33300]);
  assert.equal(r.sumTotal, 133400);
});

test("例2: ボトル担当者も割り勘 224,400円 / 5人", () => {
  const ppl = people(5);
  const bottles = [
    { id: "b1", amount: 70000, isMenuPrice: true, multiplier: 1.3, payerIds: ["p1"] },
  ];
  const r = compute({
    total: 224400,
    people: ppl,
    fixed: [],
    bottles,
    topups: [],
    bottleParticipation: { p1: "join" },
  });
  assert.equal(r.ok, true);
  const amounts = amountsById(r);
  // p1 は割り勘分(26,700 か 26,600) + 91,000
  assert.ok(amounts.p1 === 117700 || amounts.p1 === 117600);
  const others = r.perPerson.filter((p) => p.id !== "p1").map((p) => p.amount).sort((a, b) => b - a);
  const evenAmounts = r.perPerson.map((p) => p.amount - (p.id === "p1" ? 91000 : 0)).sort((a, b) => b - a);
  assert.deepEqual(evenAmounts, [26700, 26700, 26700, 26700, 26600]);
  assert.equal(r.sumTotal, 224400);
});

test("例3: ボトル担当者はボトル代だけ 224,400円 / 5人", () => {
  const ppl = people(5);
  const bottles = [
    { id: "b1", amount: 70000, isMenuPrice: true, multiplier: 1.3, payerIds: ["p1"] },
  ];
  const r = compute({
    total: 224400,
    people: ppl,
    fixed: [],
    bottles,
    topups: [],
    bottleParticipation: { p1: "onlyBottle" },
  });
  assert.equal(r.ok, true);
  const amounts = amountsById(r);
  assert.equal(amounts.p1, 91000);
  const others = [amounts.p2, amounts.p3, amounts.p4, amounts.p5].sort((a, b) => b - a);
  assert.deepEqual(others, [33400, 33400, 33300, 33300]);
  assert.equal(r.sumTotal, 224400);
});

test("例4: ボトルの100円未満を残額に含める 100,000円 / 4人", () => {
  const ppl = people(4);
  const bottles = [
    { id: "b1", amount: 12350, isMenuPrice: true, multiplier: 1.3, payerIds: ["p1"] },
  ];
  const r = compute({
    total: 100000,
    people: ppl,
    fixed: [],
    bottles,
    topups: [],
    bottleParticipation: { p1: "onlyBottle" },
  });
  assert.equal(r.ok, true);
  const amounts = amountsById(r);
  assert.equal(amounts.p1, 16000);
  assert.equal(amounts.p2, 28000);
  assert.equal(amounts.p3, 28000);
  assert.equal(amounts.p4, 28000);
  assert.equal(r.sumTotal, 100000);
});

test("例5: 複数人が多めに払う 100,000円 / 4人", () => {
  const ppl = people(4);
  const topups = [
    { personId: "p1", amount: 10000 },
    { personId: "p2", amount: 5000 },
  ];
  const r = compute({ total: 100000, people: ppl, fixed: [], bottles: [], topups });
  assert.equal(r.ok, true);
  const amounts = amountsById(r);
  // 残額 85,000 を4人で割る -> 21,200 x2, 21,300 x2 (どちらが+100かは自動割当)
  const evenParts = r.perPerson.map((p) => p.breakdown.evenBase + p.breakdown.extra).sort((a, b) => b - a);
  assert.deepEqual(evenParts, [21300, 21300, 21200, 21200]);
  assert.equal(amounts.p1, amounts.p1); // sanity
  assert.equal(amounts.p1 - 10000 === 21300 || amounts.p1 - 10000 === 21200, true);
  assert.equal(r.sumTotal, 100000);
});

test("例6: みんな2万円、残りを1人 224,400円 / 5人", () => {
  const ppl = people(5);
  const built = buildSameSplitFixedList(ppl, "p5", 20000);
  assert.equal(built.ok, true);
  const r = compute({ total: 224400, people: ppl, fixed: built.fixed, bottles: [], topups: [] });
  assert.equal(r.ok, true);
  const amounts = amountsById(r);
  assert.equal(amounts.p1, 20000);
  assert.equal(amounts.p2, 20000);
  assert.equal(amounts.p3, 20000);
  assert.equal(amounts.p4, 20000);
  assert.equal(amounts.p5, 144400);
  assert.equal(r.sumTotal, 224400);
});

test("複数のボトル・複数負担者・複数の固定額の組み合わせ", () => {
  const ppl = people(6);
  const bottles = [
    { id: "b1", amount: 30000, isMenuPrice: false, multiplier: 1.3, payerIds: ["p1", "p2"] },
    { id: "b2", amount: 10000, isMenuPrice: true, multiplier: 1.3, payerIds: ["p3"] },
  ];
  const fixed = [{ personId: "p6", amount: 15000 }];
  const topups = [{ personId: "p4", amount: 1000 }];
  const r = compute({
    total: 200000,
    people: ppl,
    fixed,
    bottles,
    topups,
    bottleParticipation: { p1: "join", p2: "onlyBottle", p3: "join" },
  });
  assert.equal(r.ok, true);
  assert.equal(r.sumTotal, 200000);
  const amounts = amountsById(r);
  assert.equal(amounts.p6, 15000);
  // p2 はボトル代だけ(b1の半分 = 15,000)
  assert.equal(amounts.p2, 15000);
});

test("固定額の合計が会計総額を超えるとエラー", () => {
  const ppl = people(3);
  const r = compute({
    total: 10000,
    people: ppl,
    fixed: [{ personId: "p1", amount: 8000 }, { personId: "p2", amount: 5000 }],
  });
  assert.equal(r.ok, false);
  assert.match(r.message, /固定/);
});

test("ボトル換算合計（切り捨て前）が総額を超えるとエラー", () => {
  const ppl = people(2);
  const bottles = [{ id: "b1", amount: 20000, isMenuPrice: true, multiplier: 1.3, payerIds: ["p1"] }];
  const r = compute({ total: 20000, people: ppl, bottles, bottleParticipation: { p1: "onlyBottle" } });
  assert.equal(r.ok, false);
  assert.match(r.message, /ボトル/);
});

test("残額があるのに割り勘参加者が0人だとエラー", () => {
  const ppl = people(2);
  const bottles = [{ id: "b1", amount: 5000, isMenuPrice: false, multiplier: 1, payerIds: ["p1", "p2"] }];
  const r = compute({
    total: 10000,
    people: ppl,
    bottles,
    bottleParticipation: { p1: "onlyBottle", p2: "onlyBottle" },
  });
  assert.equal(r.ok, false);
  assert.match(r.message, /残りを払う人/);
});

test("端数の受取人を入れ替えても合計は変わらない", () => {
  const ppl = people(4);
  const r1 = compute({ total: 133400, people: ppl });
  const swappedRecipients = ["p3", "p4"]; // 元は p1,p2 だったはず
  const r2 = compute({ total: 133400, people: ppl, extraRecipients: swappedRecipients });
  assert.equal(r1.sumTotal, 133400);
  assert.equal(r2.sumTotal, 133400);
  assert.notDeepEqual(
    r1.perPerson.map((p) => p.amount),
    r2.perPerson.map((p) => p.amount)
  );
});

test("splitEvenly100: 差は最大100円", () => {
  const { amounts } = splitEvenly100(1000, 3);
  const max = Math.max(...amounts);
  const min = Math.min(...amounts);
  assert.ok(max - min <= 100);
  assert.equal(amounts.reduce((a, b) => a + b, 0), 1000);
});

test("負の金額・未入力は無効", () => {
  const r = compute({ total: -100, people: people(2) });
  assert.equal(r.ok, false);
});

test("上乗せする人が「残りの割り勘に入らない」を選ぶと、上乗せ額だけの支払いになる", () => {
  const ppl = people(4);
  const topups = [{ personId: "p1", amount: 5000 }];
  const r = compute({
    total: 100000,
    people: ppl,
    topups,
    topupParticipation: { p1: "onlyTopup" },
  });
  assert.equal(r.ok, true);
  const amounts = amountsById(r);
  assert.equal(amounts.p1, 5000);
  const others = [amounts.p2, amounts.p3, amounts.p4];
  // 残額 95,000 を3人で均等割り（100円単位）
  assert.ok(others.every((a) => a === 31700 || a === 31600));
  assert.equal(r.sumTotal, 100000);
});

test("topupParticipation を省略しても既定は「入る」で従来どおり計算される", () => {
  const ppl = people(4);
  const topups = [{ personId: "p1", amount: 10000 }];
  const withDefault = compute({ total: 100000, people: ppl, topups });
  const withExplicitJoin = compute({
    total: 100000,
    people: ppl,
    topups,
    topupParticipation: { p1: "join" },
  });
  assert.deepEqual(amountsById(withDefault), amountsById(withExplicitJoin));
});

test("固定額の人にボトルを重複設定できない", () => {
  const ppl = people(3);
  const bottles = [{ id: "b1", amount: 3000, isMenuPrice: false, multiplier: 1, payerIds: ["p1"] }];
  const r = compute({
    total: 30000,
    people: ppl,
    fixed: [{ personId: "p1", amount: 10000 }],
    bottles,
  });
  assert.equal(r.ok, false);
});
