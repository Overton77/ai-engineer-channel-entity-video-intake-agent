import { defineSchedule } from "eve/schedules";
import { runScheduledPreResearchOnce } from "../../controller/scheduled-pre-research";

export default defineSchedule({
  // UTC: one-minute wakeups minimize idle gaps. The Postgres advisory lock
  // keeps execution globally serial when a prior serverless invocation lives
  // longer than the interval.
  cron: "* * * * *",
  run({ waitUntil }) {
    waitUntil(
      runScheduledPreResearchOnce()
        .then((outcome) => {
          console.info("[pre-research-schedule] outcome", outcome);
        })
        .catch((error) => {
          console.error("[pre-research-schedule] failed", {
            message: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }),
    );
  },
});
