export const APPLICATION_DOMAIN_CODES = [
  "general_purpose",
  "developer_platforms",
  "coding_assistants",
  "enterprise_operations",
  "customer_support",
  "search_and_knowledge",
  "data_and_analytics",
  "scientific_research",
  "healthcare_life_sciences",
  "finance_trading",
  "education_learning",
  "robotics_embodied",
  "media_creative",
  "security_defense",
  "legal_compliance",
  "personal_productivity",
] as const;

const known = new Set<string>(APPLICATION_DOMAIN_CODES);

export function normalizeApplicationDomainCode(code: string, rationale = ""): string {
  if (known.has(code)) return code;
  const text = `${code} ${rationale}`.toLowerCase().replace(/[_-]+/g, " ");
  if (/\b(coding|software development|developer assistant)\b/.test(text)) return "coding_assistants";
  if (/\b(cloud|platform|infrastructure|sdk|api|developer tooling)\b/.test(text)) return "developer_platforms";
  if (/\b(enterprise|business|operations|workflow)\b/.test(text)) return "enterprise_operations";
  if (/\b(customer|support|contact center)\b/.test(text)) return "customer_support";
  if (/\b(search|retrieval|knowledge|rag)\b/.test(text)) return "search_and_knowledge";
  if (/\b(data|analytics|database|vector|cost optimization)\b/.test(text)) return "data_and_analytics";
  if (/\b(science|research|biology|chemistry)\b/.test(text)) return "scientific_research";
  if (/\b(health|medical|clinical|life science)\b/.test(text)) return "healthcare_life_sciences";
  if (/\b(finance|financial|trading|banking|fintech)\b/.test(text)) return "finance_trading";
  if (/\b(education|learning|teaching)\b/.test(text)) return "education_learning";
  if (/\b(robot|embodied|autonomous vehicle)\b/.test(text)) return "robotics_embodied";
  if (/\b(media|creative|video|audio|image)\b/.test(text)) return "media_creative";
  if (/\b(security|defense|vulnerability|cyber)\b/.test(text)) return "security_defense";
  if (/\b(legal|compliance|regulatory)\b/.test(text)) return "legal_compliance";
  if (/\b(personal|productivity)\b/.test(text)) return "personal_productivity";
  return "general_purpose";
}

export function normalizeApplicationDomainAssignments<
  T extends { domain_code: string; confidence: number; rationale?: string },
>(rows: readonly T[]): Array<Omit<T, "domain_code"> & { domain_code: string }> {
  const byCode = new Map<string, Omit<T, "domain_code"> & { domain_code: string }>();
  for (const row of rows) {
    const normalized = {
      ...row,
      domain_code: normalizeApplicationDomainCode(row.domain_code, row.rationale),
    };
    const existing = byCode.get(normalized.domain_code);
    if (!existing || normalized.confidence > existing.confidence) {
      byCode.set(normalized.domain_code, normalized);
    }
  }
  return [...byCode.values()];
}
