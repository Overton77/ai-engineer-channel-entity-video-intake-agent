import { z } from "zod";
import { engineeringCategoryCodeSchema } from "./enums";

export const categoryDefinitionSchema = z.object({
  category_code: engineeringCategoryCodeSchema,
  label: z.string().min(1),
  description: z.string().min(1),
  inclusion_criteria: z.array(z.string().min(1)),
  exclusion_criteria: z.array(z.string().min(1)),
  example_topics: z.array(z.string().min(1)),
  sort_order: z.number().int(),
});

export const applicationDomainSchema = z.object({
  domain_code: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  parent_domain_code: z.string().min(1).nullable(),
  active: z.boolean(),
});

export const taxonomyBundleSchema = z.object({
  version: z.string().min(1),
  status: z.enum(["draft", "active", "retired"]),
  definition_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  categories: z.array(categoryDefinitionSchema),
  domains: z.array(applicationDomainSchema),
});

export type TaxonomyBundle = z.infer<typeof taxonomyBundleSchema>;
