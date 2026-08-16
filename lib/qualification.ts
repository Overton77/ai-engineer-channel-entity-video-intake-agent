export const MAX_DURATION_SECONDS_EXCLUSIVE = 5400;

const PRIMARY_REASON_GROUPS: ReadonlyArray<{
  reasons: readonly string[];
  primary: string;
}> = [
  {
    reasons: ["transcript_status_not_stored", "transcript_text_empty"],
    primary: "TRANSCRIPT_NOT_STORED",
  },
  {
    reasons: [
      "transcript_object_missing",
      "transcript_path_missing",
      "path_missing",
      "transcript_bucket_invalid",
      "bucket_invalid",
    ],
    primary: "TRANSCRIPT_OBJECT_MISSING",
  },
  {
    reasons: ["duration_missing"],
    primary: "DURATION_MISSING",
  },
  {
    reasons: ["duration_non_positive"],
    primary: "DURATION_INVALID",
  },
  {
    reasons: ["duration_at_or_over_5400_seconds"],
    primary: "VIDEO_TOO_LONG",
  },
  {
    reasons: [
      "already_live",
      "already_finished",
      "already_live_for_current_transcript",
      "already_finished_for_current_transcript",
    ],
    primary: "VIDEO_ALREADY_CLAIMED_OR_FINISHED",
  },
];

export function mapIneligibilityReasons(reasons: string[]): string {
  if (reasons.length === 0) {
    return "";
  }
  const reasonSet = new Set(reasons);
  for (const group of PRIMARY_REASON_GROUPS) {
    if (group.reasons.some((reason) => reasonSet.has(reason))) {
      return group.primary;
    }
  }
  return "VIDEO_INELIGIBLE";
}

export function isDurationEligible(seconds: number | null): { ok: boolean; reason?: string } {
  if (seconds == null) {
    return { ok: false, reason: "DURATION_MISSING" };
  }
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return { ok: false, reason: "DURATION_INVALID" };
  }
  if (seconds >= MAX_DURATION_SECONDS_EXCLUSIVE) {
    return { ok: false, reason: "VIDEO_TOO_LONG" };
  }
  return { ok: true };
}
