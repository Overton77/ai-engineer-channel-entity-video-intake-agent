import { defineSchedule } from "eve/schedules";
import { runScheduledPreResearchOnce } from "../../controller/scheduled-pre-research";

export default defineSchedule({
  // UTC: frequent recovery/dispatch opportunities, still globally serial.
  cron: "*/5 * * * *",
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
