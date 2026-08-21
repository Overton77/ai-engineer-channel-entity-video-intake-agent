import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(SCRIPT_DIR, "..");
const DEFAULT_OUTPUTS = join(PACKAGE_ROOT, "outputs", "pre-research");

const ARTIFACTS = {
  initial_summary: "initial-summary/60-initial-summary.json",
  technology_library_summary: "technology-library-summary/70-technology-library-summary.json",
  organization_profile: "organization-profile/80-organization-profile.json",
};

function printUsage() {
  console.error(`Usage:
  node scripts/readable-summaries.mjs <run-dir>
  node scripts/readable-summaries.mjs --video-id <id> [--run-id <uuid>]
  node scripts/readable-summaries.mjs --video-id=gEDl9C8s_-4

Reads 60-initial-summary, 70-technology-library-summary, and
80-organization-profile from a pre-research run and prints a readable
markdown brief with YAML front matter.

Options:
  --video-id, --video   YouTube video id (use --video-id=ID when it starts with -)
  --run-id              Specific run under outputs/pre-research/v*/<video-id>/
  --outputs             Override the outputs/pre-research root
  --write               Write readable-summaries.md into the run directory
  --out <path>          Write markdown to a specific file
  --json                Print the extracted payload instead of markdown
`);
}

function parseArgs(argv) {
  const options = {
    runDir: null,
    videoId: null,
    runId: null,
    outputsRoot: DEFAULT_OUTPUTS,
    write: false,
    out: null,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--write") {
      options.write = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--video-id" || arg === "--video") {
      options.videoId = argv[++i] ?? null;
      continue;
    }
    if (arg.startsWith("--video-id=")) {
      options.videoId = arg.slice("--video-id=".length);
      continue;
    }
    if (arg === "--run-id") {
      options.runId = argv[++i] ?? null;
      continue;
    }
    if (arg.startsWith("--run-id=")) {
      options.runId = arg.slice("--run-id=".length);
      continue;
    }
    if (arg === "--outputs") {
      options.outputsRoot = resolve(argv[++i] ?? DEFAULT_OUTPUTS);
      continue;
    }
    if (arg === "--out") {
      options.out = argv[++i] ?? null;
      continue;
    }
    if (arg.startsWith("--out=")) {
      options.out = arg.slice("--out=".length);
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (options.runDir) {
      throw new Error(`Unexpected extra argument: ${arg}`);
    }
    options.runDir = resolve(arg);
  }

  return options;
}

async function pathExists(path) {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if (error && error.code === "ENOENT") return false;
    if (error && error.code === "EISDIR") return true;
    throw error;
  }
}

async function isRunDir(dir) {
  const checks = await Promise.all(
    Object.values(ARTIFACTS).map((relative) => pathExists(join(dir, relative))),
  );
  return checks.some(Boolean);
}

async function findRunDir(options) {
  if (options.runDir) {
    if (!(await isRunDir(options.runDir))) {
      throw new Error(`No synthesis artifacts found under ${options.runDir}`);
    }
    return options.runDir;
  }

  if (!options.videoId) {
    printUsage();
    throw new Error("Pass a run directory or --video-id");
  }

  const majors = ["v2", "v1"];
  const candidates = [];
  for (const major of majors) {
    const videoDir = join(options.outputsRoot, major, options.videoId);
    let entries = [];
    try {
      entries = await readdir(videoDir, { withFileTypes: true });
    } catch (error) {
      if (error && error.code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (options.runId && entry.name !== options.runId) continue;
      const runDir = join(videoDir, entry.name);
      if (await isRunDir(runDir)) {
        candidates.push(runDir);
      }
    }
  }

  if (candidates.length === 0) {
    const hint = options.runId ? ` run ${options.runId}` : "";
    throw new Error(`No readable run found for video ${options.videoId}${hint}`);
  }

  if (options.runId || candidates.length === 1) {
    return candidates[0];
  }

  const ranked = await Promise.all(
    candidates.map(async (dir) => {
      const summaryPath = join(dir, ARTIFACTS.initial_summary);
      const stat = await readFile(summaryPath)
        .then((buf) => ({ dir, generatedAt: JSON.parse(buf.toString()).generated_at ?? "" }))
        .catch(() => ({ dir, generatedAt: "" }));
      return stat;
    }),
  );
  ranked.sort((a, b) => String(b.generatedAt).localeCompare(String(a.generatedAt)));
  return ranked[0].dir;
}

async function readJsonIfPresent(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw new Error(`Failed to read ${path}: ${error.message}`);
  }
}

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function pickConcept(item) {
  if (!item || typeof item !== "object") return null;
  return {
    name: item.name ?? null,
    explanation: item.explanation ?? null,
    importance: item.importance ?? null,
    evidence_grade: item.evidence_grade ?? null,
  };
}

function pickNote(item) {
  if (!item || typeof item !== "object") return null;
  return {
    note: item.note ?? null,
    evidence_grade: item.evidence_grade ?? null,
  };
}

function pickImplementation(item) {
  if (!item || typeof item !== "object") return null;
  return {
    name: item.name ?? null,
    implementation_type: item.implementation_type ?? null,
    official_url: item.official_url ?? null,
    current_status: item.current_status ?? null,
    relationship_to_technology: item.relationship_to_technology ?? null,
    role_in_video: item.role_in_video ?? null,
    confidence: item.confidence ?? null,
  };
}

function pickRelatedTechnology(item) {
  if (!item || typeof item !== "object") return null;
  return {
    name: item.name ?? null,
    kind: item.kind ?? null,
    relationship_to_primary: item.relationship_to_primary ?? null,
  };
}

function pickFamily(item) {
  if (!item || typeof item !== "object") return null;
  return {
    family_rank: item.family_rank ?? null,
    family_label: item.family_label ?? null,
    primary_technology: item.primary_technology ?? null,
    primary_technology_kind: item.primary_technology_kind ?? null,
    summary: item.summary ?? null,
    relationship_rationale: item.relationship_rationale ?? null,
    role_in_video: item.role_in_video ?? null,
    current_status: item.current_status ?? null,
    temporal_status: item.temporal_status ?? null,
    official_urls: asList(item.official_urls),
    implementations: asList(item.implementations).map(pickImplementation).filter(Boolean),
    related_technologies: asList(item.related_technologies).map(pickRelatedTechnology).filter(Boolean),
    confidence: item.confidence ?? null,
  };
}

function pickOrganization(item) {
  if (!item || typeof item !== "object") return null;
  return {
    canonical_name: item.canonical_name ?? null,
    official_url: item.official_url ?? null,
    authoritative_summary: item.authoritative_summary ?? null,
    current_status: item.current_status ?? null,
    status_as_of: item.status_as_of ?? null,
    organization_scope: item.organization_scope ?? null,
    primary_domain_code: item.primary_domain_code ?? null,
    secondary_domain_codes: asList(item.secondary_domain_codes),
    relationship_roles: asList(item.relationship_roles),
    relationship_to_implementation: item.relationship_to_implementation ?? null,
    parent_name: item.parent_name ?? null,
    parent_canonical_url: item.parent_canonical_url ?? null,
    video_time_name: item.video_time_name ?? null,
    video_time_parent_name: item.video_time_parent_name ?? null,
    ownership_changed_since_video: item.ownership_changed_since_video ?? null,
    featured_rank: item.featured_rank ?? null,
    is_primary_featured: item.is_primary_featured ?? null,
    confidence: item.confidence ?? null,
  };
}

function pickInitialSummary(doc) {
  if (!doc) return null;
  return {
    video_id: doc.video_id ?? null,
    run_id: doc.run_id ?? null,
    schema_version: doc.schema_version ?? null,
    generated_at: doc.generated_at ?? null,
    research_as_of: doc.research_as_of ?? null,
    video_published_at: doc.video_published_at ?? null,
    transcript_summary: doc.transcript_summary ?? null,
    why_concepts_matter_together: doc.why_concepts_matter_together ?? null,
    temporal_context: doc.temporal_context ?? null,
    transcript_web_disagreement_note: doc.transcript_web_disagreement_note ?? null,
    ai_concepts: asList(doc.ai_concepts).map(pickConcept).filter(Boolean),
    software_engineering_concepts: asList(doc.software_engineering_concepts).map(pickConcept).filter(Boolean),
    external_context_notes: asList(doc.external_context_notes).map(pickNote).filter(Boolean),
  };
}

function pickTechnologyLibrary(doc) {
  if (!doc) return null;
  return {
    video_id: doc.video_id ?? null,
    run_id: doc.run_id ?? null,
    schema_version: doc.schema_version ?? null,
    generated_at: doc.generated_at ?? null,
    research_as_of: doc.research_as_of ?? null,
    video_published_at: doc.video_published_at ?? null,
    no_main_technology_reason: doc.no_main_technology_reason ?? null,
    families: asList(doc.families)
      .map(pickFamily)
      .filter(Boolean)
      .sort((a, b) => (a.family_rank ?? 99) - (b.family_rank ?? 99)),
  };
}

function pickOrganizationProfile(doc) {
  if (!doc) return null;
  return {
    video_id: doc.video_id ?? null,
    run_id: doc.run_id ?? null,
    schema_version: doc.schema_version ?? null,
    generated_at: doc.generated_at ?? null,
    research_as_of: doc.research_as_of ?? null,
    video_published_at: doc.video_published_at ?? null,
    review_required: doc.review_required ?? null,
    review_reasons: asList(doc.review_reasons),
    unresolved_conflicts: asList(doc.unresolved_conflicts),
    no_organization_reason: doc.no_organization_reason ?? null,
    featured_implementation: doc.featured_implementation
      ? {
          name: doc.featured_implementation.name ?? null,
          relationship_to_organization: doc.featured_implementation.relationship_to_organization ?? null,
        }
      : null,
    speaker_employer: doc.speaker_employer
      ? {
          canonical_name: doc.speaker_employer.canonical_name ?? null,
          official_url: doc.speaker_employer.official_url ?? null,
        }
      : null,
    parent_organization: doc.parent_organization
      ? {
          canonical_name: doc.parent_organization.canonical_name ?? null,
          official_url: doc.parent_organization.official_url ?? null,
          relationship_summary: doc.parent_organization.relationship_summary ?? null,
        }
      : null,
    primary_featured_organization: pickOrganization(doc.primary_featured_organization),
    other_organizations: asList(doc.other_organizations).map(pickOrganization).filter(Boolean),
  };
}

function firstPresent(...values) {
  return values.find((value) => value !== null && value !== undefined && value !== "") ?? null;
}

function extractReadable(docs) {
  const initial = pickInitialSummary(docs.initial_summary);
  const tech = pickTechnologyLibrary(docs.technology_library_summary);
  const org = pickOrganizationProfile(docs.organization_profile);

  return {
    front_matter: {
      video_id: firstPresent(initial?.video_id, tech?.video_id, org?.video_id),
      run_id: firstPresent(initial?.run_id, tech?.run_id, org?.run_id),
      schema_version: firstPresent(initial?.schema_version, tech?.schema_version, org?.schema_version),
      generated_at: firstPresent(initial?.generated_at, tech?.generated_at, org?.generated_at),
      research_as_of: firstPresent(initial?.research_as_of, tech?.research_as_of, org?.research_as_of),
      video_published_at: firstPresent(initial?.video_published_at, tech?.video_published_at, org?.video_published_at),
      primary_organization: org?.primary_featured_organization?.canonical_name ?? null,
      parent_organization: org?.parent_organization?.canonical_name ?? null,
      featured_implementation: org?.featured_implementation?.name ?? null,
      speaker_employer: org?.speaker_employer?.canonical_name ?? null,
      review_required: org?.review_required ?? null,
      ai_concept_count: initial?.ai_concepts.length ?? 0,
      software_engineering_concept_count: initial?.software_engineering_concepts.length ?? 0,
      technology_family_count: tech?.families.length ?? 0,
    },
    initial_summary: initial,
    technology_library_summary: tech,
    organization_profile: org,
  };
}

function yamlScalar(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  const text = String(value);
  if (/[:#\[\]{},&*?|>!%@`'"]/.test(text) || /^\s|\s$/.test(text) || text.includes("\n")) {
    return JSON.stringify(text);
  }
  return text;
}

function renderFrontMatter(front) {
  const lines = ["---"];
  for (const [key, value] of Object.entries(front)) {
    lines.push(`${key}: ${yamlScalar(value)}`);
  }
  lines.push("---", "");
  return lines.join("\n");
}

function heading(level, text) {
  return `${"#".repeat(level)} ${text}`;
}

function paragraph(text) {
  return text && String(text).trim() ? String(text).trim() : "_None._";
}

function fieldLine(label, value) {
  if (value === null || value === undefined || value === "") return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return `- **${label}:** ${value.join(", ")}`;
  }
  return `- **${label}:** ${value}`;
}

function renderFields(pairs) {
  return pairs.map(([label, value]) => fieldLine(label, value)).filter(Boolean).join("\n");
}

function renderConcepts(title, concepts) {
  if (!concepts.length) return `${heading(2, title)}\n\n_None._\n`;
  const blocks = concepts.map((concept) => {
    const bits = [
      heading(3, concept.name ?? "Untitled"),
      renderFields([
        ["Grade", concept.evidence_grade],
        ["Why it matters", concept.importance],
      ]),
      "",
      paragraph(concept.explanation),
    ];
    return bits.join("\n");
  });
  return `${heading(2, title)}\n\n${blocks.join("\n\n")}\n`;
}

function renderNotes(title, notes) {
  if (!notes.length) return `${heading(2, title)}\n\n_None._\n`;
  const items = notes.map((note) => {
    const grade = note.evidence_grade ? ` _(grade: ${note.evidence_grade})_` : "";
    return `- ${paragraph(note.note)}${grade}`;
  });
  return `${heading(2, title)}\n\n${items.join("\n")}\n`;
}

function renderInitial(initial) {
  if (!initial) return `${heading(1, "Initial summary")}\n\n_Missing 60-initial-summary.json._\n`;
  return [
    heading(1, "Initial summary"),
    "",
    heading(2, "Transcript summary"),
    "",
    paragraph(initial.transcript_summary),
    "",
    heading(2, "Why these concepts matter together"),
    "",
    paragraph(initial.why_concepts_matter_together),
    "",
    renderConcepts("AI concepts", initial.ai_concepts),
    renderConcepts("Software engineering concepts", initial.software_engineering_concepts),
    heading(2, "Temporal context"),
    "",
    paragraph(initial.temporal_context),
    "",
    heading(2, "Transcript vs web disagreement"),
    "",
    paragraph(initial.transcript_web_disagreement_note),
    "",
    renderNotes("External context notes", initial.external_context_notes),
  ].join("\n");
}

function renderFamily(family) {
  const impls = family.implementations.length
    ? family.implementations
        .map((impl) => {
          const url = impl.official_url ? ` — ${impl.official_url}` : "";
          const type = impl.implementation_type ? ` (${impl.implementation_type})` : "";
          const status = impl.current_status ? `\n  - Status: ${impl.current_status}` : "";
          const role = impl.role_in_video ? `\n  - Role: ${impl.role_in_video}` : "";
          const rel = impl.relationship_to_technology
            ? `\n  - Relationship: ${impl.relationship_to_technology}`
            : "";
          return `- **${impl.name ?? "Untitled"}**${type}${url}${status}${role}${rel}`;
        })
        .join("\n")
    : "_None._";

  const related = family.related_technologies.length
    ? family.related_technologies
        .map((tech) => {
          const kind = tech.kind ? ` (${tech.kind})` : "";
          const rel = tech.relationship_to_primary ? ` — ${tech.relationship_to_primary}` : "";
          return `- **${tech.name ?? "Untitled"}**${kind}${rel}`;
        })
        .join("\n")
    : "_None._";

  return [
    heading(2, `${family.family_rank ?? "?"}. ${family.family_label ?? family.primary_technology ?? "Untitled family"}`),
    "",
    renderFields([
      ["Primary", family.primary_technology],
      ["Kind", family.primary_technology_kind],
      ["Role in video", family.role_in_video],
      ["Status", family.current_status],
      ["Temporal status", family.temporal_status],
      ["Confidence", family.confidence],
      ["Official URLs", family.official_urls],
    ]),
    "",
    heading(3, "Summary"),
    "",
    paragraph(family.summary),
    "",
    heading(3, "Why this family is in the talk"),
    "",
    paragraph(family.relationship_rationale),
    "",
    heading(3, "Implementations"),
    "",
    impls,
    "",
    heading(3, "Related technologies"),
    "",
    related,
  ].join("\n");
}

function renderTechnology(tech) {
  if (!tech) return `${heading(1, "Technology library")}\n\n_Missing 70-technology-library-summary.json._\n`;
  if (!tech.families.length) {
    return [
      heading(1, "Technology library"),
      "",
      heading(2, "No main technology"),
      "",
      paragraph(tech.no_main_technology_reason),
      "",
    ].join("\n");
  }
  return [
    heading(1, "Technology library"),
    "",
    tech.families.map(renderFamily).join("\n\n"),
    "",
  ].join("\n");
}

function renderOrgCard(title, org) {
  if (!org) return `${heading(2, title)}\n\n_None._\n`;
  return [
    heading(2, title),
    "",
    renderFields([
      ["Name", org.canonical_name],
      ["URL", org.official_url],
      ["Status", org.current_status],
      ["Status as of", org.status_as_of],
      ["Scope", org.organization_scope],
      ["Domain", org.primary_domain_code],
      ["Secondary domains", org.secondary_domain_codes],
      ["Roles", org.relationship_roles],
      ["Parent", org.parent_name],
      ["Parent URL", org.parent_canonical_url],
      ["Name at video time", org.video_time_name],
      ["Parent at video time", org.video_time_parent_name],
      ["Ownership changed since video", org.ownership_changed_since_video],
      ["Confidence", org.confidence],
    ]),
    "",
    heading(3, "Authoritative summary"),
    "",
    paragraph(org.authoritative_summary),
    "",
    heading(3, "Relationship to the implementation"),
    "",
    paragraph(org.relationship_to_implementation),
    "",
  ].join("\n");
}

function renderOrganization(org) {
  if (!org) return `${heading(1, "Organization profile")}\n\n_Missing 80-organization-profile.json._\n`;
  if (org.no_organization_reason) {
    return [
      heading(1, "Organization profile"),
      "",
      heading(2, "No organization"),
      "",
      paragraph(org.no_organization_reason),
      "",
    ].join("\n");
  }

  const others = org.other_organizations.length
    ? org.other_organizations
        .map((other, index) =>
          renderOrgCard(
            `Other organization ${other.featured_rank ?? index + 1}: ${other.canonical_name ?? "Untitled"}`,
            other,
          ),
        )
        .join("\n")
    : `${heading(2, "Other organizations")}\n\n_None._\n`;

  const review = org.review_reasons.length
    ? org.review_reasons.map((reason) => `- ${reason}`).join("\n")
    : "_None._";
  const conflicts = org.unresolved_conflicts.length
    ? org.unresolved_conflicts.map((item) => `- ${item}`).join("\n")
    : "_None._";

  return [
    heading(1, "Organization profile"),
    "",
    heading(2, "Featured implementation"),
    "",
    renderFields([
      ["Name", org.featured_implementation?.name],
    ]),
    "",
    paragraph(org.featured_implementation?.relationship_to_organization),
    "",
    heading(2, "Speaker employer"),
    "",
    renderFields([
      ["Name", org.speaker_employer?.canonical_name],
      ["URL", org.speaker_employer?.official_url],
    ]) || "_None._",
    "",
    heading(2, "Parent organization"),
    "",
    renderFields([
      ["Name", org.parent_organization?.canonical_name],
      ["URL", org.parent_organization?.official_url],
    ]),
    "",
    paragraph(org.parent_organization?.relationship_summary),
    "",
    renderOrgCard(
      `Primary organization: ${org.primary_featured_organization?.canonical_name ?? "Untitled"}`,
      org.primary_featured_organization,
    ),
    others,
    heading(2, "Review reasons"),
    "",
    review,
    "",
    heading(2, "Unresolved conflicts"),
    "",
    conflicts,
    "",
  ].join("\n");
}

function renderMarkdown(extracted) {
  return [
    renderFrontMatter(extracted.front_matter),
    renderInitial(extracted.initial_summary),
    renderTechnology(extracted.technology_library_summary),
    renderOrganization(extracted.organization_profile),
  ].join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runDir = await findRunDir(options);
  const docs = {
    initial_summary: await readJsonIfPresent(join(runDir, ARTIFACTS.initial_summary)),
    technology_library_summary: await readJsonIfPresent(join(runDir, ARTIFACTS.technology_library_summary)),
    organization_profile: await readJsonIfPresent(join(runDir, ARTIFACTS.organization_profile)),
  };

  if (!docs.initial_summary && !docs.technology_library_summary && !docs.organization_profile) {
    throw new Error(`No synthesis artifacts found under ${runDir}`);
  }

  const extracted = extractReadable(docs);
  const output = options.json
    ? `${JSON.stringify(extracted, null, 2)}\n`
    : renderMarkdown(extracted);

  const dest = options.out ? resolve(options.out) : options.write ? join(runDir, "readable-summaries.md") : null;
  if (dest) {
    await writeFile(dest, output, "utf8");
    console.error(`Wrote ${dest}`);
  }
  if (!dest || process.stdout.isTTY) {
    process.stdout.write(output.endsWith("\n") ? output : `${output}\n`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
