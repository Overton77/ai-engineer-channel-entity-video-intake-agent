import { defineTool } from "eve/tools";
import { z } from "zod";
import { query } from "../lib/postgres";
import { TAXONOMY_VERSION } from "../../contracts/enums";
import type { TaxonomyBundle } from "../../contracts/taxonomy";

type VersionRow = {
  taxonomy_version_id: string;
  version: string;
  status: "draft" | "active" | "retired";
  definition_sha256: string;
};

type CategoryRow = {
  category_code: TaxonomyBundle["categories"][number]["category_code"];
  label: string;
  description: string;
  inclusion_criteria: string[];
  exclusion_criteria: string[];
  example_topics: string[];
  sort_order: number;
};

type DomainRow = {
  domain_code: string;
  label: string;
  description: string;
  parent_domain_code: string | null;
  active: boolean;
};

export default defineTool({
  description:
    "Load the official AI engineering taxonomy: active version, category definitions with inclusion/exclusion criteria, and application domains. Call this before taxonomy_classifier.",
  inputSchema: z.object({
    version: z.string().min(1).default(TAXONOMY_VERSION),
  }),
  async execute({ version }) {
    const versions = await query<VersionRow>(
      `select taxonomy_version_id, version, status, definition_sha256
       from public.research_taxonomy_version
       where version = $1`,
      [version],
    );
    const taxonomy = versions[0];
    if (!taxonomy) return { found: false as const, taxonomy: null };

    const [categories, domains] = await Promise.all([
      query<CategoryRow>(
        `select category_code, label, description, inclusion_criteria, exclusion_criteria, example_topics, sort_order
         from public.research_category_definition
         where taxonomy_version_id = $1
         order by sort_order`,
        [taxonomy.taxonomy_version_id],
      ),
      query<DomainRow>(
        `select domain_code, label, description, parent_domain_code, active
         from public.research_application_domain
         where active = true
         order by sort_order, domain_code`,
      ),
    ]);

    return {
      found: true as const,
      taxonomy: {
        version: taxonomy.version,
        status: taxonomy.status,
        definition_sha256: taxonomy.definition_sha256,
        categories,
        domains,
      } satisfies TaxonomyBundle,
    };
  },
});
