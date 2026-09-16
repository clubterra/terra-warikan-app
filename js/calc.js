// 割り勘計算のロジック（DOM に依存しない純粋関数のみ）。
// 金額はすべて「円」の整数で扱い、浮動小数点誤差を避ける。

export const UNIT = 100;

export function isPositiveInt(n) {
  return Number.isInteger(n) && n > 0;
}

export function isNonNegativeInt(n) {
  return Number.isInteger(n) && n >= 0;
}

export function isMultipleOf100(n) {
  return Number.isInteger(n) && n >= 0 && n % UNIT === 0;
}

// 会計総額のチェック。100円単位でない場合は自動で丸めず、計算を止める。
export function validateTotal(total) {
  if (!isPositiveInt(total)) {
    return { ok: false, message: "お会計の金額を入力してください。" };
  }
  if (!isMultipleOf100(total)) {
    return { ok: false, message: "会計額を100円単位で確認してください。" };
  }
  return { ok: true };
}

export function validatePeopleCount(n) {
  if (!Number.isInteger(n) || n < 2) {
    return { ok: false, message: "人数は2人以上で入力してください。" };
  }
  return { ok: true };
}

// amount 円を n 人で「できるだけ均等に」1円単位で分ける。
// 余りは payerIds の先頭から順に 1 円ずつ配る（内部計算専用、表示には使わない）。
export function splitIntegerEvenly(amount, n) {
  if (n <= 0) return [];
  const base = Math.floor(amount / n);
  const remainder = amount - base * n;
  const result = new Array(n).fill(base);
  for (let i = 0; i < remainder; i++) {
    result[i] += 1;
  }
  return result;
}

// residual 円（100円単位）を count 人で均等に割る。
// 100円単位でまず均等に割り、余った100円を先頭から1つずつ配る。
// 差が最大100円になる。
export function splitEvenly100(residual, count) {
  if (count <= 0) {
    return { baseAmount: 0, extraCount: 0, amounts: [] };
  }
  const units = residual / UNIT;
  const baseUnits = Math.floor(units / count);
  const extraCount = units - baseUnits * count;
  const amounts = new Array(count).fill(baseUnits * UNIT);
  for (let i = 0; i < extraCount; i++) {
    amounts[i] += UNIT;
  }
  return { baseAmount: baseUnits * UNIT, extraCount, amounts };
}

// メニュー価格 → 税・サービス料込み換算（丸めて整数円にする）
export function convertBottleAmount(amount, isMenuPrice, multiplier) {
  if (!isMenuPrice) return Math.round(amount);
  return Math.round(amount * multiplier);
}

/**
 * 割り勘の全計算を行うコア関数。
 *
 * @param {object} input
 * @param {number} input.total 会計総額（円）
 * @param {Array<{id:string,name:string}>} input.people
 * @param {Array<{personId:string, amount:number}>} input.fixed 支払額が決まっている人
 * @param {Array<{id:string, amount:number, isMenuPrice:boolean, multiplier:number, payerIds:string[]}>} input.bottles
 * @param {Array<{personId:string, amount:number}>} input.topups 割り勘分への上乗せ額
 * @param {Object<string,'join'|'onlyBottle'>} input.bottleParticipation ボトル負担者ごとの残り割り勘参加意思
 * @param {Object<string,'join'|'onlyTopup'>} [input.topupParticipation] 上乗せする人ごとの残り割り勘参加意思（省略時は'join'扱い）
 * @param {string[]} [input.extraRecipients] 均等割りの端数(+100円)を受け取る人のID（省略時は先頭から自動割当）
 */
export function compute(input) {
  const {
    total,
    people,
    fixed = [],
    bottles = [],
    topups = [],
    bottleParticipation = {},
    topupParticipation = {},
    extraRecipients = null,
  } = input;

  const totalCheck = validateTotal(total);
  if (!totalCheck.ok) return { ok: false, message: totalCheck.message };

  if (!Array.isArray(people) || people.length === 0) {
    return { ok: false, message: "支払う人がいません。人数を確認してください。" };
  }
  const peopleIds = new Set(people.map((p) => p.id));

  // 固定額チェック
  for (const f of fixed) {
    if (!peopleIds.has(f.personId)) {
      return { ok: false, message: "固定額を設定した人が見つかりません。人数を確認してください。" };
    }
    if (!isNonNegativeInt(f.amount) || !isMultipleOf100(f.amount)) {
      return { ok: false, message: "固定額は100円単位の0円以上で入力してください。" };
    }
  }
  const fixedMap = new Map(fixed.map((f) => [f.personId, f.amount]));
  const fixedSum = fixed.reduce((s, f) => s + f.amount, 0);
  if (fixedSum > total) {
    return { ok: false, message: "固定で払う金額の合計が会計総額を超えています。固定額を確認してください。" };
  }
  const pool = total - fixedSum;

  // ボトルチェック
  let bottleExactTotalSum = 0;
  const personBottleExact = new Map(); // personId -> 円（切り捨て前）
  for (const b of bottles) {
    if (!Array.isArray(b.payerIds) || b.payerIds.length === 0) {
      return { ok: false, message: "ボトルの負担者を選んでください。" };
    }
    for (const pid of b.payerIds) {
      if (!peopleIds.has(pid)) {
        return { ok: false, message: "ボトルの負担者が見つかりません。人数を確認してください。" };
      }
      if (fixedMap.has(pid)) {
        return { ok: false, message: "固定額の人にはボトル代を設定できません。どちらか一方を選んでください。" };
      }
    }
    if (!isPositiveInt(Math.round(b.amount))) {
      return { ok: false, message: "ボトルの金額を入力してください。" };
    }
    const exact = convertBottleAmount(b.amount, b.isMenuPrice, b.multiplier);
    bottleExactTotalSum += exact;
    const shares = splitIntegerEvenly(exact, b.payerIds.length);
    b.payerIds.forEach((pid, i) => {
      personBottleExact.set(pid, (personBottleExact.get(pid) || 0) + shares[i]);
    });
  }
  if (bottleExactTotalSum > total) {
    return { ok: false, message: "ボトル代の換算合計（切り捨て前）が会計総額を超えています。ボトルの金額を確認してください。" };
  }

  // ボトル負担者ごとに100円未満を切り捨て
  const bottleTruncatedMap = new Map(); // personId -> 100円単位に切り捨てた額
  const bottleLeftoverMap = new Map(); // personId -> 切り捨てられた端数(表示用)
  let bottleTruncatedSum = 0;
  for (const [pid, exact] of personBottleExact.entries()) {
    const truncated = Math.floor(exact / UNIT) * UNIT;
    bottleTruncatedMap.set(pid, truncated);
    bottleLeftoverMap.set(pid, exact - truncated);
    bottleTruncatedSum += truncated;
  }

  // ボトル負担者は、残りの割り勘に参加するか回答が必要
  const bottlePayerIds = [...personBottleExact.keys()];
  const bottleOnlySet = new Set();
  for (const pid of bottlePayerIds) {
    const choice = bottleParticipation[pid];
    if (choice !== "join" && choice !== "onlyBottle") {
      return { ok: false, message: "ボトル代を払う人が、残りを割り勘するか選んでください。" };
    }
    if (choice === "onlyBottle") bottleOnlySet.add(pid);
  }

  // 上乗せ額チェック
  for (const t of topups) {
    if (!peopleIds.has(t.personId)) {
      return { ok: false, message: "上乗せする人が見つかりません。人数を確認してください。" };
    }
    if (fixedMap.has(t.personId)) {
      return { ok: false, message: "固定額の人には上乗せ額を設定できません。どちらか一方を選んでください。" };
    }
    if (bottleOnlySet.has(t.personId)) {
      return { ok: false, message: "「ボトル代だけ払う」人には上乗せ額を設定できません。" };
    }
    if (!isNonNegativeInt(t.amount) || !isMultipleOf100(t.amount)) {
      return { ok: false, message: "上乗せ額は100円単位の0円以上で入力してください。" };
    }
  }
  const topupMap = new Map();
  let topupSum = 0;
  for (const t of topups) {
    topupMap.set(t.personId, (topupMap.get(t.personId) || 0) + t.amount);
    topupSum += t.amount;
  }

  // 上乗せする人ごとに、残りの割り勘に入るか（未指定は'join'扱い、後方互換のため）
  const topupOnlySet = new Set();
  for (const personId of topupMap.keys()) {
    if (topupParticipation[personId] === "onlyTopup") topupOnlySet.add(personId);
  }

  if (bottleTruncatedSum + topupSum > pool) {
    return { ok: false, message: "ボトル代や上乗せ額の合計が残りの会計を超えています。金額を確認してください。" };
  }

  const residual = pool - bottleTruncatedSum - topupSum;

  // 割り勘の残額に参加する人 = 固定額の人・「ボトル代だけ払う」人・「上乗せ額だけ払う」人 以外の全員
  const participants = people.filter(
    (p) => !fixedMap.has(p.id) && !bottleOnlySet.has(p.id) && !topupOnlySet.has(p.id)
  );

  if (residual > 0 && participants.length === 0) {
    return { ok: false, message: "残りを払う人を選んでください。" };
  }

  const { baseAmount, extraCount, amounts: defaultAmounts } = splitEvenly100(
    residual,
    participants.length
  );

  // 端数(+100円)の対象者を決める。指定がなければ先頭から自動割当。
  let extraSet;
  const participantIdSet = new Set(participants.map((p) => p.id));
  if (
    Array.isArray(extraRecipients) &&
    extraRecipients.length === extraCount &&
    extraRecipients.every((id) => participantIdSet.has(id)) &&
    new Set(extraRecipients).size === extraRecipients.length
  ) {
    extraSet = new Set(extraRecipients);
  } else {
    extraSet = new Set(participants.slice(0, extraCount).map((p) => p.id));
  }

  const perPerson = people.map((p) => {
    const breakdown = {
      fixed: 0,
      bottleTruncated: 0,
      bottleExactBeforeCut: 0,
      evenBase: 0,
      extra: 0,
      topup: 0,
    };
    let amount = 0;
    if (fixedMap.has(p.id)) {
      breakdown.fixed = fixedMap.get(p.id);
      amount = breakdown.fixed;
    } else {
      // 「ボトル代だけ払う」「上乗せ額だけ払う」を選んだ人は、残りの均等割りには入らない。
      const isParticipant = !bottleOnlySet.has(p.id) && !topupOnlySet.has(p.id);
      breakdown.evenBase = isParticipant ? baseAmount : 0;
      breakdown.extra = isParticipant && extraSet.has(p.id) ? UNIT : 0;
      breakdown.topup = topupMap.get(p.id) || 0;
      breakdown.bottleTruncated = bottleTruncatedMap.get(p.id) || 0;
      breakdown.bottleExactBeforeCut = personBottleExact.get(p.id) || 0;
      amount = breakdown.evenBase + breakdown.extra + breakdown.topup + breakdown.bottleTruncated;
    }
    return { id: p.id, name: p.name, amount, breakdown };
  });

  const sumTotal = perPerson.reduce((s, p) => s + p.amount, 0);

  for (const p of perPerson) {
    if (!isNonNegativeInt(p.amount) || !isMultipleOf100(p.amount)) {
      return { ok: false, message: "計算結果が100円単位になりませんでした。入力を確認してください。" };
    }
  }
  if (sumTotal !== total) {
    return { ok: false, message: "支払合計が会計総額と一致しませんでした。入力を確認してください。" };
  }

  return {
    ok: true,
    total,
    sumTotal,
    perPerson,
    participantIds: participants.map((p) => p.id),
    extraCount,
    extraRecipients: [...extraSet],
    bottleLeftoverMap: Object.fromEntries(bottleLeftoverMap),
  };
}

// ③「みんな同じ額、残りを1人」専用のヘルパー。
// 内部的には fixed 方式（全員固定額）として compute() に渡せる形を作る。
export function buildSameSplitFixedList(people, remainderPayerId, otherAmount) {
  if (!isNonNegativeInt(otherAmount) || !isMultipleOf100(otherAmount)) {
    return { ok: false, message: "1人あたりの金額は100円単位で入力してください。" };
  }
  const others = people.filter((p) => p.id !== remainderPayerId);
  const fixed = others.map((p) => ({ personId: p.id, amount: otherAmount }));
  return { ok: true, fixed, othersCount: others.length };
}
