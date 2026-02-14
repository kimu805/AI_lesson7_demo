/**
 * 月次残業時間計算関数
 *
 * 仕様:
 * - 15分単位の丸め: 切り上げ（出退勤両方、打刻記録時）
 * - 18:00以降（18:00含む）を残業とする
 * - 休憩時間: 固定1時間（12:00〜13:00）
 * - 遅刻は丸め対象外（実時刻で記録）、遅刻と残業は相殺する
 * - 月45時間超過で割増（超過分のみ）
 * - 休日出勤: 全勤務時間が残業扱い、45時間上限に含める
 * - 日付またぎ: 出勤打刻日の月に計上
 * - 未承認/却下の残業申請: 計上しない
 * - 打刻忘れ: 保留扱い（計算から除外）
 * - 月途中入退社: 45時間を日割り
 */

// ─── 型定義 ───

export interface TimeStamp {
  employeeId: number;
  stampType: "clock_in" | "clock_out";
  stampedAt: Date;
  source: "normal" | "correction" | "bulk_correction";
}

export interface DailyWorkSummary {
  employeeId: number;
  workDate: string; // "YYYY-MM-DD"
  clockInAt: Date | null;
  clockOutAt: Date | null;
  workType: "normal" | "holiday" | "absence";
  workMinutes: number;
  overtimeMinutes: number;
  approvalStatus: "approved" | "pending" | "rejected" | "none";
  lateMinutes: number;
  status: "completed" | "in_progress" | "missing_clock_out" | "pending";
}

export interface MonthlyOvertimeInput {
  employeeId: number;
  yearMonth: string; // "YYYY-MM"
  dailySummaries: DailyWorkSummary[];
  timeStamps: TimeStamp[];
  workingDaysInMonth: number;
  actualWorkingDays: number;
}

export interface MonthlyOvertimeResult {
  totalOvertimeMinutes: number;
  regularOvertimeMinutes: number;
  excessOvertimeMinutes: number;
  holidayWorkMinutes: number;
  lateNightMinutes: number;
  totalOvertime: string;
  regularOvertime: string;
  excessOvertime: string;
  holidayWork: string;
  lateNight: string;
}

// ─── 定数 ───

const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const REGULAR_OVERTIME_LIMIT_MINUTES = 2700; // 45時間

// ─── ヘルパー ───

function parseWorkDate(workDate: string): [number, number, number] {
  const parts = workDate.split("-").map(Number);
  return [parts[0], parts[1], parts[2]];
}

function isCountable(summary: DailyWorkSummary): boolean {
  if (summary.status === "missing_clock_out" || summary.status === "pending") {
    return false;
  }
  if (
    summary.approvalStatus === "pending" ||
    summary.approvalStatus === "rejected"
  ) {
    return false;
  }
  return true;
}

function calcBreakOverlapMinutes(
  clockIn: Date,
  clockOut: Date,
  workDate: string
): number {
  const [year, month, day] = parseWorkDate(workDate);
  const breakStart = new Date(year, month - 1, day, 12, 0, 0, 0);
  const breakEnd = new Date(year, month - 1, day, 13, 0, 0, 0);

  const overlapStart = Math.max(clockIn.getTime(), breakStart.getTime());
  const overlapEnd = Math.min(clockOut.getTime(), breakEnd.getTime());

  if (overlapEnd <= overlapStart) return 0;
  return (overlapEnd - overlapStart) / (60 * 1000);
}

function calcLateNightOverlapMinutes(
  clockIn: Date,
  clockOut: Date,
  workDate: string
): number {
  const [year, month, day] = parseWorkDate(workDate);
  const lateStart = new Date(year, month - 1, day, 22, 0, 0, 0);
  const lateEnd = new Date(year, month - 1, day + 1, 5, 0, 0, 0);

  const overlapStart = Math.max(clockIn.getTime(), lateStart.getTime());
  const overlapEnd = Math.min(clockOut.getTime(), lateEnd.getTime());

  if (overlapEnd <= overlapStart) return 0;
  return Math.floor((overlapEnd - overlapStart) / (60 * 1000));
}

// ─── エクスポート関数 ───

/** 15分単位の切り上げ丸め */
export function roundToQuarter(time: Date): Date {
  if (time == null) {
    throw new Error("Invalid input: time is null or undefined");
  }
  if (isNaN(time.getTime())) {
    throw new Error("Invalid input: invalid date");
  }

  const ms = time.getTime();
  const remainder = ms % FIFTEEN_MIN_MS;

  if (remainder === 0) {
    return new Date(ms);
  }
  return new Date(ms + FIFTEEN_MIN_MS - remainder);
}

/** "HH:MM" フォーマット */
export function formatTime(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new Error(
      "Invalid input: minutes must be a non-negative finite number"
    );
  }

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

/** 日次の残業時間を計算（分単位で返す） */
export function calcDailyOvertime(summary: DailyWorkSummary): number {
  if (!isCountable(summary)) return 0;
  if (!summary.clockInAt || !summary.clockOutAt) return 0;

  if (summary.workType === "holiday") {
    const totalMs = summary.clockOutAt.getTime() - summary.clockInAt.getTime();
    let totalMinutes = totalMs / (60 * 1000);
    totalMinutes -= calcBreakOverlapMinutes(
      summary.clockInAt,
      summary.clockOutAt,
      summary.workDate
    );
    return Math.max(0, totalMinutes);
  }

  // 通常勤務: 18:00以降が残業
  const [year, month, day] = parseWorkDate(summary.workDate);
  const endOfWork = new Date(year, month - 1, day, 18, 0, 0, 0);

  let overtimeMinutes: number;

  if (summary.clockInAt.getTime() >= endOfWork.getTime()) {
    // 全て18:00以降の勤務（深夜シフト等）
    overtimeMinutes =
      (summary.clockOutAt.getTime() - summary.clockInAt.getTime()) /
      (60 * 1000);
  } else if (summary.clockOutAt.getTime() <= endOfWork.getTime()) {
    // 18:00以前に退勤
    overtimeMinutes = 0;
  } else {
    // 18:00をまたぐ通常パターン
    overtimeMinutes =
      (summary.clockOutAt.getTime() - endOfWork.getTime()) / (60 * 1000);
  }

  // 遅刻と残業の相殺
  overtimeMinutes -= summary.lateMinutes;

  return Math.max(0, overtimeMinutes);
}

/** 月次残業時間を計算（メイン関数） */
export function calcMonthlyOvertime(
  input: MonthlyOvertimeInput
): MonthlyOvertimeResult {
  // ── バリデーション ──
  if (!input.dailySummaries) {
    throw new Error("dailySummaries is required");
  }
  if (!/^\d{4}-\d{2}$/.test(input.yearMonth)) {
    throw new Error(
      `Invalid yearMonth format: "${input.yearMonth}". Expected "YYYY-MM"`
    );
  }
  if (input.actualWorkingDays <= 0) {
    throw new Error("actualWorkingDays must be positive");
  }
  if (input.actualWorkingDays > input.workingDaysInMonth) {
    throw new Error("actualWorkingDays exceeds workingDaysInMonth");
  }

  for (const summary of input.dailySummaries) {
    if (summary.workDate.substring(0, 7) !== input.yearMonth) {
      throw new Error(
        `workDate ${summary.workDate} is outside yearMonth ${input.yearMonth}`
      );
    }
    if (
      summary.clockInAt &&
      summary.clockOutAt &&
      summary.clockInAt.getTime() > summary.clockOutAt.getTime()
    ) {
      throw new Error("clockInAt must be before clockOutAt");
    }
    if (summary.overtimeMinutes < 0) {
      throw new Error("overtimeMinutes must be non-negative");
    }
  }

  // ── 集計 ──
  let totalOvertimeMinutes = 0;
  let holidayWorkMinutes = 0;
  let lateNightMinutes = 0;

  for (const summary of input.dailySummaries) {
    if (!isCountable(summary)) continue;

    totalOvertimeMinutes += summary.overtimeMinutes;

    if (summary.workType === "holiday") {
      holidayWorkMinutes += summary.overtimeMinutes;
    }

    if (summary.clockInAt && summary.clockOutAt) {
      lateNightMinutes += calcLateNightOverlapMinutes(
        summary.clockInAt,
        summary.clockOutAt,
        summary.workDate
      );
    }
  }

  // ── 45時間の日割り上限 ──
  const limit = Math.floor(
    REGULAR_OVERTIME_LIMIT_MINUTES *
      (input.actualWorkingDays / input.workingDaysInMonth)
  );

  const regularOvertimeMinutes = Math.min(totalOvertimeMinutes, limit);
  const excessOvertimeMinutes = Math.max(0, totalOvertimeMinutes - limit);

  return {
    totalOvertimeMinutes,
    regularOvertimeMinutes,
    excessOvertimeMinutes,
    holidayWorkMinutes,
    lateNightMinutes,
    totalOvertime: formatTime(totalOvertimeMinutes),
    regularOvertime: formatTime(regularOvertimeMinutes),
    excessOvertime: formatTime(excessOvertimeMinutes),
    holidayWork: formatTime(holidayWorkMinutes),
    lateNight: formatTime(lateNightMinutes),
  };
}
