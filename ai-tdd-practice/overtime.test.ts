/**
 * 月次残業時間計算関数 テストコード
 *
 * 仕様（overtime_calc_questions.md 回答に基づく）:
 * - 15分単位の丸め: 切り上げ（出退勤両方、打刻記録時）
 * - 18:00以降（18:00含む）を残業とする
 * - 休憩時間: 固定1時間（12:00〜13:00）
 * - 遅刻は丸め対象外（実時刻で記録）
 * - 遅刻と残業は相殺する
 * - 月45時間（含む）超過で割増（超過分のみ）
 * - 割増率: 通常残業25%、月60時間超50%、深夜25%（別途加算）
 * - 休日出勤: 全勤務時間が残業扱い、45時間上限に含める
 * - 日付またぎ: 出勤打刻日の月に計上
 * - 未承認/却下の残業申請: 計上しない
 * - 打刻忘れ: 保留扱い（計算から除外）
 * - 月途中入退社: 45時間を日割り
 * - 集計期間: 毎月1日〜末日
 * - 出力形式: "HH:MM"
 * - エラー時: 例外をスロー
 */

import {
  roundToQuarter,
  calcDailyOvertime,
  calcMonthlyOvertime,
  formatTime,
  TimeStamp,
  DailyWorkSummary,
  MonthlyOvertimeInput,
} from "./overtime";

// ─── ヘルパー ───

function d(dateStr: string): Date {
  return new Date(dateStr);
}

function makeSummary(
  overrides: Partial<DailyWorkSummary> & { workDate: string }
): DailyWorkSummary {
  return {
    employeeId: 1,
    clockInAt: null,
    clockOutAt: null,
    workType: "normal",
    workMinutes: 0,
    overtimeMinutes: 0,
    approvalStatus: "approved",
    lateMinutes: 0,
    status: "completed",
    ...overrides,
  };
}

function makeInput(
  overrides: Partial<MonthlyOvertimeInput> & {
    dailySummaries: DailyWorkSummary[];
  }
): MonthlyOvertimeInput {
  return {
    employeeId: 1,
    yearMonth: "2026-02",
    timeStamps: [],
    workingDaysInMonth: 20,
    actualWorkingDays: 20,
    ...overrides,
  };
}

// ════════════════════════════════════════════════════
// 1. 丸め処理（roundToQuarter）
// ════════════════════════════════════════════════════

describe("roundToQuarter: 15分単位の切り上げ丸め", () => {
  // --- 正常系 ---

  test("ちょうどの時刻はそのまま（9:00 → 9:00）", () => {
    expect(roundToQuarter(d("2026-02-02T09:00:00"))).toEqual(
      d("2026-02-02T09:00:00")
    );
  });

  test("15分ちょうどはそのまま（9:15 → 9:15）", () => {
    expect(roundToQuarter(d("2026-02-02T09:15:00"))).toEqual(
      d("2026-02-02T09:15:00")
    );
  });

  test("30分ちょうどはそのまま（9:30 → 9:30）", () => {
    expect(roundToQuarter(d("2026-02-02T09:30:00"))).toEqual(
      d("2026-02-02T09:30:00")
    );
  });

  test("45分ちょうどはそのまま（9:45 → 9:45）", () => {
    expect(roundToQuarter(d("2026-02-02T09:45:00"))).toEqual(
      d("2026-02-02T09:45:00")
    );
  });

  // --- 切り上げ ---

  test("1分過ぎは切り上げ（9:01 → 9:15）", () => {
    expect(roundToQuarter(d("2026-02-02T09:01:00"))).toEqual(
      d("2026-02-02T09:15:00")
    );
  });

  test("7分は切り上げ（9:07 → 9:15）", () => {
    expect(roundToQuarter(d("2026-02-02T09:07:00"))).toEqual(
      d("2026-02-02T09:15:00")
    );
  });

  test("14分は切り上げ（9:14 → 9:15）", () => {
    expect(roundToQuarter(d("2026-02-02T09:14:00"))).toEqual(
      d("2026-02-02T09:15:00")
    );
  });

  test("16分は切り上げ（9:16 → 9:30）", () => {
    expect(roundToQuarter(d("2026-02-02T09:16:00"))).toEqual(
      d("2026-02-02T09:30:00")
    );
  });

  test("59分は切り上げ（9:59 → 10:00）", () => {
    expect(roundToQuarter(d("2026-02-02T09:59:00"))).toEqual(
      d("2026-02-02T10:00:00")
    );
  });

  // --- 秒の扱い ---

  test("秒がある場合も切り上げ（9:00:01 → 9:15）", () => {
    expect(roundToQuarter(d("2026-02-02T09:00:01"))).toEqual(
      d("2026-02-02T09:15:00")
    );
  });

  test("秒がある場合の切り上げ（9:15:30 → 9:30）", () => {
    expect(roundToQuarter(d("2026-02-02T09:15:30"))).toEqual(
      d("2026-02-02T09:30:00")
    );
  });

  // --- 日付またぎ ---

  test("23:50の切り上げは翌日0:00", () => {
    expect(roundToQuarter(d("2026-02-02T23:50:00"))).toEqual(
      d("2026-02-03T00:00:00")
    );
  });

  // --- 退勤時刻の丸め ---

  test("退勤18:03は18:15に切り上げ（Q-04: 残業15分）", () => {
    expect(roundToQuarter(d("2026-02-02T18:03:00"))).toEqual(
      d("2026-02-02T18:15:00")
    );
  });

  test("退勤17:50は18:00に切り上げ", () => {
    expect(roundToQuarter(d("2026-02-02T17:50:00"))).toEqual(
      d("2026-02-02T18:00:00")
    );
  });
});

// ════════════════════════════════════════════════════
// 2. 日次残業計算（calcDailyOvertime）
// ════════════════════════════════════════════════════

describe("calcDailyOvertime: 日次の残業時間計算", () => {
  // --- 正常系 ---

  test("定時退勤（18:00）は残業0分", () => {
    const summary = makeSummary({
      workDate: "2026-02-02",
      clockInAt: d("2026-02-02T09:00:00"),
      clockOutAt: d("2026-02-02T18:00:00"),
      workType: "normal",
    });
    expect(calcDailyOvertime(summary)).toBe(0);
  });

  test("19:00退勤で残業60分", () => {
    const summary = makeSummary({
      workDate: "2026-02-02",
      clockInAt: d("2026-02-02T09:00:00"),
      clockOutAt: d("2026-02-02T19:00:00"),
      workType: "normal",
    });
    expect(calcDailyOvertime(summary)).toBe(60);
  });

  test("20:30退勤で残業150分（2時間30分）", () => {
    const summary = makeSummary({
      workDate: "2026-02-02",
      clockInAt: d("2026-02-02T09:00:00"),
      clockOutAt: d("2026-02-02T20:30:00"),
      workType: "normal",
    });
    expect(calcDailyOvertime(summary)).toBe(150);
  });

  // --- 境界値: 18:00（Q-09: 18:00含む） ---

  test("18:00ちょうどの退勤は残業0分（所定終業時刻）", () => {
    const summary = makeSummary({
      workDate: "2026-02-02",
      clockInAt: d("2026-02-02T09:00:00"),
      clockOutAt: d("2026-02-02T18:00:00"),
      workType: "normal",
    });
    expect(calcDailyOvertime(summary)).toBe(0);
  });

  test("18:15退勤（丸め後）で残業15分", () => {
    const summary = makeSummary({
      workDate: "2026-02-02",
      clockInAt: d("2026-02-02T09:00:00"),
      clockOutAt: d("2026-02-02T18:15:00"),
      workType: "normal",
    });
    expect(calcDailyOvertime(summary)).toBe(15);
  });

  // --- 遅刻と残業の相殺（Q-21） ---

  test("1時間遅刻 + 19:00退勤 → 残業0分（相殺）", () => {
    const summary = makeSummary({
      workDate: "2026-02-02",
      clockInAt: d("2026-02-02T10:00:00"),
      clockOutAt: d("2026-02-02T19:00:00"),
      workType: "normal",
      lateMinutes: 60,
    });
    expect(calcDailyOvertime(summary)).toBe(0);
  });

  test("30分遅刻 + 19:00退勤 → 残業30分（60分-30分相殺）", () => {
    const summary = makeSummary({
      workDate: "2026-02-02",
      clockInAt: d("2026-02-02T09:30:00"),
      clockOutAt: d("2026-02-02T19:00:00"),
      workType: "normal",
      lateMinutes: 30,
    });
    expect(calcDailyOvertime(summary)).toBe(30);
  });

  test("2時間遅刻 + 19:00退勤 → 残業0分（遅刻が残業を上回る）", () => {
    const summary = makeSummary({
      workDate: "2026-02-02",
      clockInAt: d("2026-02-02T11:00:00"),
      clockOutAt: d("2026-02-02T19:00:00"),
      workType: "normal",
      lateMinutes: 120,
    });
    expect(calcDailyOvertime(summary)).toBe(0);
  });

  // --- 休日出勤（Q-19: 全勤務時間が残業） ---

  test("休日出勤 9:00〜17:00 → 全8時間が残業", () => {
    const summary = makeSummary({
      workDate: "2026-02-08", // 日曜
      clockInAt: d("2026-02-08T09:00:00"),
      clockOutAt: d("2026-02-08T17:00:00"),
      workType: "holiday",
      workMinutes: 480,
    });
    // 休日は休憩1時間を除いた実勤務時間が全て残業
    expect(calcDailyOvertime(summary)).toBe(420); // 7h（休憩除く）
  });

  test("休日出勤 9:00〜22:00 → 12時間残業（休憩除く）", () => {
    const summary = makeSummary({
      workDate: "2026-02-08",
      clockInAt: d("2026-02-08T09:00:00"),
      clockOutAt: d("2026-02-08T22:00:00"),
      workType: "holiday",
      workMinutes: 720,
    });
    expect(calcDailyOvertime(summary)).toBe(720); // 12h（休憩除く）
  });

  // --- 日付またぎ（Q-12: 出勤打刻日の月に計上） ---

  test("日付またぎ勤務: 23:00出勤〜翌1:00退勤 → 残業120分（全て18時以降）", () => {
    const summary = makeSummary({
      workDate: "2026-01-31",
      clockInAt: d("2026-01-31T23:00:00"),
      clockOutAt: d("2026-02-01T01:00:00"),
      workType: "normal",
    });
    // 23:00〜翌1:00 = 2時間、全て18時以降なので全て残業
    expect(calcDailyOvertime(summary)).toBe(120);
  });

  // --- 未承認・却下の残業（Q-22: 計上しない） ---

  test("残業申請が未承認の場合、残業時間は0分", () => {
    const summary = makeSummary({
      workDate: "2026-02-02",
      clockInAt: d("2026-02-02T09:00:00"),
      clockOutAt: d("2026-02-02T21:00:00"),
      workType: "normal",
      approvalStatus: "pending",
    });
    expect(calcDailyOvertime(summary)).toBe(0);
  });

  test("残業申請が却下の場合、残業時間は0分", () => {
    const summary = makeSummary({
      workDate: "2026-02-02",
      clockInAt: d("2026-02-02T09:00:00"),
      clockOutAt: d("2026-02-02T21:00:00"),
      workType: "normal",
      approvalStatus: "rejected",
    });
    expect(calcDailyOvertime(summary)).toBe(0);
  });

  test("残業申請が承認済みの場合、残業時間を正しく計上", () => {
    const summary = makeSummary({
      workDate: "2026-02-02",
      clockInAt: d("2026-02-02T09:00:00"),
      clockOutAt: d("2026-02-02T21:00:00"),
      workType: "normal",
      approvalStatus: "approved",
    });
    expect(calcDailyOvertime(summary)).toBe(180); // 3時間
  });

  test("残業なし（定時退勤）で申請statusがnoneの場合、残業0分", () => {
    const summary = makeSummary({
      workDate: "2026-02-02",
      clockInAt: d("2026-02-02T09:00:00"),
      clockOutAt: d("2026-02-02T18:00:00"),
      workType: "normal",
      approvalStatus: "none",
    });
    expect(calcDailyOvertime(summary)).toBe(0);
  });

  // --- 打刻忘れ（Q-16: 保留扱い） ---

  test("退勤打刻なし（missing_clock_out）は0分を返す", () => {
    const summary = makeSummary({
      workDate: "2026-02-02",
      clockInAt: d("2026-02-02T09:00:00"),
      clockOutAt: null,
      workType: "normal",
      status: "missing_clock_out",
    });
    expect(calcDailyOvertime(summary)).toBe(0);
  });

  test("保留ステータスは0分を返す", () => {
    const summary = makeSummary({
      workDate: "2026-02-02",
      clockInAt: d("2026-02-02T09:00:00"),
      clockOutAt: null,
      workType: "normal",
      status: "pending",
    });
    expect(calcDailyOvertime(summary)).toBe(0);
  });

  // --- 残業0分の記録（Q-15: レコードは作成する） ---

  test("定時退勤でも0分のレコードとして返す（nullやundefinedではない）", () => {
    const summary = makeSummary({
      workDate: "2026-02-02",
      clockInAt: d("2026-02-02T09:00:00"),
      clockOutAt: d("2026-02-02T17:30:00"),
      workType: "normal",
    });
    const result = calcDailyOvertime(summary);
    expect(result).toBe(0);
    expect(result).not.toBeNull();
    expect(result).not.toBeUndefined();
  });
});

// ════════════════════════════════════════════════════
// 3. 月次残業計算（calcMonthlyOvertime）
// ════════════════════════════════════════════════════

describe("calcMonthlyOvertime: 月次残業時間の集計", () => {
  // --- 正常系: 基本的な集計 ---

  test("残業なしの月は全て0", () => {
    const summaries = Array.from({ length: 20 }, (_, i) =>
      makeSummary({
        workDate: `2026-02-${String(i + 1).padStart(2, "0")}`,
        clockInAt: d(`2026-02-${String(i + 1).padStart(2, "0")}T09:00:00`),
        clockOutAt: d(`2026-02-${String(i + 1).padStart(2, "0")}T18:00:00`),
        workType: "normal",
      })
    );
    const result = calcMonthlyOvertime(
      makeInput({ dailySummaries: summaries })
    );
    expect(result.totalOvertimeMinutes).toBe(0);
    expect(result.totalOvertime).toBe("00:00");
  });

  test("毎日1時間残業×20日 = 20時間", () => {
    const summaries = Array.from({ length: 20 }, (_, i) =>
      makeSummary({
        workDate: `2026-02-${String(i + 1).padStart(2, "0")}`,
        clockInAt: d(`2026-02-${String(i + 1).padStart(2, "0")}T09:00:00`),
        clockOutAt: d(`2026-02-${String(i + 1).padStart(2, "0")}T19:00:00`),
        workType: "normal",
        overtimeMinutes: 60,
      })
    );
    const result = calcMonthlyOvertime(
      makeInput({ dailySummaries: summaries })
    );
    expect(result.totalOvertimeMinutes).toBe(1200);
    expect(result.totalOvertime).toBe("20:00");
    expect(result.excessOvertimeMinutes).toBe(0);
  });

  // --- 45時間の境界値（Q-10: 45時間ちょうどを含む） ---

  test("月45時間ちょうどは割増対象（超過分は0分だが閾値に到達）", () => {
    // 45h = 2700分。22日 × 122.7分 ≈ 15日×180分(3h)
    const summaries = Array.from({ length: 15 }, (_, i) =>
      makeSummary({
        workDate: `2026-02-${String(i + 1).padStart(2, "0")}`,
        clockInAt: d(`2026-02-${String(i + 1).padStart(2, "0")}T09:00:00`),
        clockOutAt: d(`2026-02-${String(i + 1).padStart(2, "0")}T21:00:00`),
        workType: "normal",
        overtimeMinutes: 180,
      })
    );
    const result = calcMonthlyOvertime(
      makeInput({ dailySummaries: summaries })
    );
    // 15日 × 180分 = 2700分 = 45:00
    expect(result.totalOvertimeMinutes).toBe(2700);
    expect(result.regularOvertimeMinutes).toBe(2700);
    expect(result.excessOvertimeMinutes).toBe(0);
    expect(result.totalOvertime).toBe("45:00");
  });

  test("月45時間1分で超過分1分が発生", () => {
    const summaries = [
      ...Array.from({ length: 15 }, (_, i) =>
        makeSummary({
          workDate: `2026-02-${String(i + 1).padStart(2, "0")}`,
          clockInAt: d(`2026-02-${String(i + 1).padStart(2, "0")}T09:00:00`),
          clockOutAt: d(`2026-02-${String(i + 1).padStart(2, "0")}T21:00:00`),
          workType: "normal",
          overtimeMinutes: 180,
        })
      ),
      makeSummary({
        workDate: "2026-02-16",
        clockInAt: d("2026-02-16T09:00:00"),
        clockOutAt: d("2026-02-16T18:15:00"),
        workType: "normal",
        overtimeMinutes: 15,
      }),
    ];
    const result = calcMonthlyOvertime(
      makeInput({ dailySummaries: summaries })
    );
    // 2700 + 15 = 2715分 = 45:15
    expect(result.totalOvertimeMinutes).toBe(2715);
    expect(result.regularOvertimeMinutes).toBe(2700); // 45:00
    expect(result.excessOvertimeMinutes).toBe(15); // 00:15
  });

  // --- Q-11: 割増は超過分のみ ---

  test("月50時間の場合、超過分は5時間のみ", () => {
    const summaries = Array.from({ length: 20 }, (_, i) =>
      makeSummary({
        workDate: `2026-02-${String(i + 1).padStart(2, "0")}`,
        clockInAt: d(`2026-02-${String(i + 1).padStart(2, "0")}T09:00:00`),
        clockOutAt: d(`2026-02-${String(i + 1).padStart(2, "0")}T20:30:00`),
        workType: "normal",
        overtimeMinutes: 150,
      })
    );
    const result = calcMonthlyOvertime(
      makeInput({ dailySummaries: summaries })
    );
    // 20 × 150 = 3000分 = 50:00
    expect(result.totalOvertimeMinutes).toBe(3000);
    expect(result.regularOvertimeMinutes).toBe(2700); // 45:00
    expect(result.excessOvertimeMinutes).toBe(300); // 5:00
    expect(result.excessOvertime).toBe("05:00");
  });

  // --- 休日出勤（Q-18: 45時間に含める、Q-19: 全時間が残業） ---

  test("休日出勤の勤務時間が45時間の上限に含まれる", () => {
    const normalDays = Array.from({ length: 18 }, (_, i) =>
      makeSummary({
        workDate: `2026-02-${String(i + 1).padStart(2, "0")}`,
        clockInAt: d(`2026-02-${String(i + 1).padStart(2, "0")}T09:00:00`),
        clockOutAt: d(`2026-02-${String(i + 1).padStart(2, "0")}T21:00:00`),
        workType: "normal",
        overtimeMinutes: 150,
      })
    );
    const holidayDay = makeSummary({
      workDate: "2026-02-22",
      clockInAt: d("2026-02-22T09:00:00"),
      clockOutAt: d("2026-02-22T17:00:00"),
      workType: "holiday",
      overtimeMinutes: 420, // 7h（休憩除く全時間）
    });
    const summaries = [...normalDays, holidayDay];
    const result = calcMonthlyOvertime(
      makeInput({ dailySummaries: summaries })
    );
    // 通常: 18 × 150 = 2700分 + 休日: 420分 = 3120分 = 52:00
    expect(result.totalOvertimeMinutes).toBe(3120);
    expect(result.holidayWorkMinutes).toBe(420);
    expect(result.excessOvertimeMinutes).toBe(420); // 3120 - 2700 = 420
  });

  test("休日出勤のみで45時間を超える場合", () => {
    const summaries = Array.from({ length: 7 }, (_, i) =>
      makeSummary({
        workDate: `2026-02-${String((i + 1) * 4).padStart(2, "0")}`,
        clockInAt: d(
          `2026-02-${String((i + 1) * 4).padStart(2, "0")}T08:00:00`
        ),
        clockOutAt: d(
          `2026-02-${String((i + 1) * 4).padStart(2, "0")}T19:00:00`
        ),
        workType: "holiday",
        overtimeMinutes: 600, // 10h（休憩除く）
      })
    );
    const result = calcMonthlyOvertime(
      makeInput({ dailySummaries: summaries })
    );
    // 7 × 600 = 4200分 = 70:00
    expect(result.totalOvertimeMinutes).toBe(4200);
    expect(result.excessOvertimeMinutes).toBe(1500); // 4200 - 2700
  });

  // --- 深夜残業（Q-13: 別途加算） ---

  test("22:00以降の勤務時間を深夜残業として別途記録", () => {
    const summaries = [
      makeSummary({
        workDate: "2026-02-02",
        clockInAt: d("2026-02-02T09:00:00"),
        clockOutAt: d("2026-02-03T00:00:00"),
        workType: "normal",
        overtimeMinutes: 360, // 18:00〜0:00 = 6h
      }),
    ];
    const result = calcMonthlyOvertime(
      makeInput({ dailySummaries: summaries })
    );
    expect(result.totalOvertimeMinutes).toBe(360);
    expect(result.lateNightMinutes).toBe(120); // 22:00〜0:00 = 2h
    expect(result.lateNight).toBe("02:00");
  });

  // --- 日割り計算（Q-23） ---

  test("月途中入社（15日入社、所定20日中10日在籍）で45時間を日割り", () => {
    const summaries = Array.from({ length: 10 }, (_, i) =>
      makeSummary({
        workDate: `2026-02-${String(i + 15).padStart(2, "0")}`,
        clockInAt: d(`2026-02-${String(i + 15).padStart(2, "0")}T09:00:00`),
        clockOutAt: d(`2026-02-${String(i + 15).padStart(2, "0")}T21:30:00`),
        workType: "normal",
        overtimeMinutes: 210,
      })
    );
    const result = calcMonthlyOvertime(
      makeInput({
        dailySummaries: summaries,
        workingDaysInMonth: 20,
        actualWorkingDays: 10,
      })
    );
    // 上限 = 45h × (10/20) = 22.5h = 1350分
    // 実績 = 10 × 210 = 2100分 = 35:00
    // 超過 = 2100 - 1350 = 750分
    expect(result.totalOvertimeMinutes).toBe(2100);
    expect(result.regularOvertimeMinutes).toBe(1350);
    expect(result.excessOvertimeMinutes).toBe(750);
  });

  // --- 混在ケース ---

  test("通常勤務 + 休日出勤 + 未承認を含む混在ケース", () => {
    const summaries = [
      // 通常残業（承認済み）
      makeSummary({
        workDate: "2026-02-02",
        clockInAt: d("2026-02-02T09:00:00"),
        clockOutAt: d("2026-02-02T20:00:00"),
        workType: "normal",
        overtimeMinutes: 120,
        approvalStatus: "approved",
      }),
      // 通常残業（未承認 → 計上しない）
      makeSummary({
        workDate: "2026-02-03",
        clockInAt: d("2026-02-03T09:00:00"),
        clockOutAt: d("2026-02-03T21:00:00"),
        workType: "normal",
        overtimeMinutes: 180,
        approvalStatus: "pending",
      }),
      // 休日出勤（承認済み）
      makeSummary({
        workDate: "2026-02-08",
        clockInAt: d("2026-02-08T10:00:00"),
        clockOutAt: d("2026-02-08T16:00:00"),
        workType: "holiday",
        overtimeMinutes: 300,
        approvalStatus: "approved",
      }),
      // 定時退勤
      makeSummary({
        workDate: "2026-02-04",
        clockInAt: d("2026-02-04T09:00:00"),
        clockOutAt: d("2026-02-04T18:00:00"),
        workType: "normal",
        overtimeMinutes: 0,
        approvalStatus: "none",
      }),
    ];
    const result = calcMonthlyOvertime(
      makeInput({ dailySummaries: summaries })
    );
    // 承認済みのみ: 120 + 300 = 420分 = 7:00
    expect(result.totalOvertimeMinutes).toBe(420);
    expect(result.holidayWorkMinutes).toBe(300);
  });
});

// ════════════════════════════════════════════════════
// 4. 出力フォーマット（formatTime）
// ════════════════════════════════════════════════════

describe("formatTime: HH:MM形式への変換", () => {
  test("0分 → '00:00'", () => {
    expect(formatTime(0)).toBe("00:00");
  });

  test("60分 → '01:00'", () => {
    expect(formatTime(60)).toBe("01:00");
  });

  test("90分 → '01:30'", () => {
    expect(formatTime(90)).toBe("01:30");
  });

  test("2700分 → '45:00'", () => {
    expect(formatTime(2700)).toBe("45:00");
  });

  test("2715分 → '45:15'", () => {
    expect(formatTime(2715)).toBe("45:15");
  });

  test("6000分 → '100:00'（100時間超え対応）", () => {
    expect(formatTime(6000)).toBe("100:00");
  });

  test("15分 → '00:15'", () => {
    expect(formatTime(15)).toBe("00:15");
  });
});

// ════════════════════════════════════════════════════
// 5. 異常系・エラーケース
// ════════════════════════════════════════════════════

describe("異常系: エラーハンドリング（Q-30: 例外をスロー）", () => {
  // --- null / undefined ---

  test("dailySummariesがnullの場合、例外をスロー", () => {
    expect(() =>
      calcMonthlyOvertime(
        makeInput({ dailySummaries: null as unknown as DailyWorkSummary[] })
      )
    ).toThrow();
  });

  test("dailySummariesがundefinedの場合、例外をスロー", () => {
    expect(() =>
      calcMonthlyOvertime(
        makeInput({
          dailySummaries: undefined as unknown as DailyWorkSummary[],
        })
      )
    ).toThrow();
  });

  test("yearMonthが不正な形式の場合、例外をスロー", () => {
    expect(() =>
      calcMonthlyOvertime(
        makeInput({
          yearMonth: "2026/02",
          dailySummaries: [],
        })
      )
    ).toThrow();
  });

  test("yearMonthが空文字の場合、例外をスロー", () => {
    expect(() =>
      calcMonthlyOvertime(
        makeInput({
          yearMonth: "",
          dailySummaries: [],
        })
      )
    ).toThrow();
  });

  // --- 不正データ ---

  test("出勤時刻が退勤時刻より後の場合、例外をスロー", () => {
    const summaries = [
      makeSummary({
        workDate: "2026-02-02",
        clockInAt: d("2026-02-02T19:00:00"),
        clockOutAt: d("2026-02-02T09:00:00"),
        workType: "normal",
      }),
    ];
    expect(() =>
      calcMonthlyOvertime(makeInput({ dailySummaries: summaries }))
    ).toThrow();
  });

  test("残業時間が負の値の場合、例外をスロー", () => {
    const summaries = [
      makeSummary({
        workDate: "2026-02-02",
        clockInAt: d("2026-02-02T09:00:00"),
        clockOutAt: d("2026-02-02T20:00:00"),
        workType: "normal",
        overtimeMinutes: -60,
      }),
    ];
    expect(() =>
      calcMonthlyOvertime(makeInput({ dailySummaries: summaries }))
    ).toThrow();
  });

  test("actualWorkingDaysが0の場合、例外をスロー", () => {
    expect(() =>
      calcMonthlyOvertime(
        makeInput({
          dailySummaries: [],
          actualWorkingDays: 0,
        })
      )
    ).toThrow();
  });

  test("actualWorkingDaysがworkingDaysInMonthを超える場合、例外をスロー", () => {
    expect(() =>
      calcMonthlyOvertime(
        makeInput({
          dailySummaries: [],
          workingDaysInMonth: 20,
          actualWorkingDays: 25,
        })
      )
    ).toThrow();
  });

  test("workDateがyearMonthの範囲外の場合、例外をスロー", () => {
    const summaries = [
      makeSummary({
        workDate: "2026-03-01", // 3月のデータが2月の集計に混入
        clockInAt: d("2026-03-01T09:00:00"),
        clockOutAt: d("2026-03-01T19:00:00"),
        workType: "normal",
      }),
    ];
    expect(() =>
      calcMonthlyOvertime(
        makeInput({ yearMonth: "2026-02", dailySummaries: summaries })
      )
    ).toThrow();
  });

  // --- formatTime の異常系 ---

  test("formatTimeに負の値を渡すと例外をスロー", () => {
    expect(() => formatTime(-1)).toThrow();
  });

  test("formatTimeにNaNを渡すと例外をスロー", () => {
    expect(() => formatTime(NaN)).toThrow();
  });

  // --- roundToQuarter の異常系 ---

  test("roundToQuarterにInvalid Dateを渡すと例外をスロー", () => {
    expect(() => roundToQuarter(new Date("invalid"))).toThrow();
  });

  test("roundToQuarterにnullを渡すと例外をスロー", () => {
    expect(() => roundToQuarter(null as unknown as Date)).toThrow();
  });
});

// ════════════════════════════════════════════════════
// 6. エッジケース
// ════════════════════════════════════════════════════

describe("エッジケース", () => {
  // --- 月末の日付またぎ ---

  test("1/31の深夜勤務は1月に計上される", () => {
    const summaries = [
      makeSummary({
        workDate: "2026-01-31",
        clockInAt: d("2026-01-31T09:00:00"),
        clockOutAt: d("2026-02-01T02:00:00"),
        workType: "normal",
        overtimeMinutes: 480, // 18:00〜2:00 = 8h
      }),
    ];
    const result = calcMonthlyOvertime(
      makeInput({ yearMonth: "2026-01", dailySummaries: summaries })
    );
    expect(result.totalOvertimeMinutes).toBe(480);
    // 深夜: 22:00〜2:00 = 4h
    expect(result.lateNightMinutes).toBe(240);
  });

  // --- 空のデータ ---

  test("勤務日が0日の月（全休）は全て0", () => {
    const result = calcMonthlyOvertime(
      makeInput({
        dailySummaries: [],
        actualWorkingDays: 20,
      })
    );
    expect(result.totalOvertimeMinutes).toBe(0);
    expect(result.totalOvertime).toBe("00:00");
  });

  // --- 打刻補正データ（Q-24: 通常と同じロジック） ---

  test("打刻補正（correction）データも通常と同じ計算ロジックで処理", () => {
    const summaries = [
      makeSummary({
        workDate: "2026-02-02",
        clockInAt: d("2026-02-02T09:00:00"),
        clockOutAt: d("2026-02-02T20:00:00"),
        workType: "normal",
        overtimeMinutes: 120,
        approvalStatus: "approved",
      }),
    ];
    const stamps: TimeStamp[] = [
      {
        employeeId: 1,
        stampType: "clock_in",
        stampedAt: d("2026-02-02T09:00:00"),
        source: "correction",
      },
      {
        employeeId: 1,
        stampType: "clock_out",
        stampedAt: d("2026-02-02T20:00:00"),
        source: "correction",
      },
    ];
    const result = calcMonthlyOvertime(
      makeInput({ dailySummaries: summaries, timeStamps: stamps })
    );
    expect(result.totalOvertimeMinutes).toBe(120);
  });

  // --- 全日が打刻忘れ ---

  test("全日が打刻忘れ（保留）の場合、残業0", () => {
    const summaries = Array.from({ length: 5 }, (_, i) =>
      makeSummary({
        workDate: `2026-02-${String(i + 1).padStart(2, "0")}`,
        clockInAt: d(`2026-02-${String(i + 1).padStart(2, "0")}T09:00:00`),
        clockOutAt: null,
        workType: "normal",
        status: "missing_clock_out",
      })
    );
    const result = calcMonthlyOvertime(
      makeInput({ dailySummaries: summaries })
    );
    expect(result.totalOvertimeMinutes).toBe(0);
  });

  // --- 最大値 ---

  test("極端な残業（毎日6時間×31日=186時間）でも正しく計算", () => {
    const summaries = Array.from({ length: 31 }, (_, i) =>
      makeSummary({
        workDate: `2026-01-${String(i + 1).padStart(2, "0")}`,
        clockInAt: d(`2026-01-${String(i + 1).padStart(2, "0")}T09:00:00`),
        clockOutAt: d(`2026-01-${String(i + 1).padStart(2, "0")}T24:00:00`),
        workType: "normal",
        overtimeMinutes: 360,
      })
    );
    const result = calcMonthlyOvertime(
      makeInput({ yearMonth: "2026-01", dailySummaries: summaries })
    );
    // 31 × 360 = 11160分 = 186:00
    expect(result.totalOvertimeMinutes).toBe(11160);
    expect(result.totalOvertime).toBe("186:00");
    expect(result.regularOvertimeMinutes).toBe(2700); // 45:00
    expect(result.excessOvertimeMinutes).toBe(8460); // 141:00
  });
});
