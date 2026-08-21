import { loadEnv } from "./load-env.mjs";

loadEnv();
const { query } = await import("../executor/postgres.ts");
console.log(JSON.stringify(await query(`select domain_code from public.research_application_domain order by sort_order, domain_code`), null, 2));
