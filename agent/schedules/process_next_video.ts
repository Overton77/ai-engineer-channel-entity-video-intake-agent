import { defineSchedule } from "eve/schedules";

export default defineSchedule({
  cron: "*/30 * * * *",
  markdown: `The dispatcher / Vercel Workflow owns phases. Do not ask this model session to run the whole pipeline. Process at most one qualified video: start or resume the controller workflow so it claims, runs the research session (00-50), and stops. A later synthesis session writes 60-90. If no controller is bound, say so and stop. Never generate 60, 70, 80, or 90 in this scheduled turn. Cron is UTC.`,
});
