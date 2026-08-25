import { z } from "zod";

export const PROMPT_BUNDLE_VERSION = "pre-research-v3-stateless-slim-62";
export const PACKET_SCHEMA_VERSION = "2.0.0";
export const INTENT_SCHEMA_VERSION = "2.0.0";
export const V1_INTENT_SCHEMA_VERSION = "1.0.0";
export const V1_PACKET_SCHEMA_VERSION = "1.0.0";
export const TAXONOMY_VERSION = "1.0.0";
export const INTENT_BUCKET = "research-ingestion-intents";

export const engineeringCategoryCodes = [
  "model_foundations_behavior",
  "inference_model_systems",
  "ai_data_engineering",
  "post_training_continual_learning",
  "prompting_llm_programming",
  "context_engineering_memory",
  "retrieval_search_knowledge",
  "agent_architecture_harnesses",
  "tools_protocols_integrations",
  "orchestration_durable_execution",
  "coding_agents_software_engineering",
  "evaluation_testing_benchmarking",
  "observability_reliability_llmops",
  "security_safety_identity_governance",
  "multimodal_realtime_systems",
  "ai_product_ux_human_factors",
  "ai_platforms_developer_tooling",
] as const;

export const engineeringCategoryCodeSchema = z.enum(engineeringCategoryCodes);

export const difficultySchema = z.enum(["introductory", "intermediate", "advanced", "expert"]);
export const contentFormSchema = z.enum([
  "talk",
  "tutorial",
  "demo",
  "panel",
  "interview",
  "workshop",
  "keynote",
]);
export const evidenceLevelSchema = z.enum([
  "anecdotal",
  "case_study",
  "benchmarked",
  "production_system",
  "research_paper",
]);
export const lifecycleStageSchema = z.enum([
  "research",
  "design",
  "implementation",
  "evaluation",
  "deployment",
  "operations",
  "governance",
]);
export const verificationStatusSchema = z.enum(["verified", "likely", "uncertain", "rejected"]);
export const evidenceSourceKindSchema = z.enum(["transcript", "description", "web"]);
export const resourceTypeSchema = z.enum([
  "repository",
  "code_example",
  "documentation",
  "paper",
  "article",
  "slides",
  "dataset",
  "benchmark",
  "model",
  "demo",
  "course",
  "other",
]);
export const entityKindSchema = z.enum([
  "person",
  "organization",
  "product",
  "model",
  "protocol",
  "dataset",
  "benchmark",
  "paper",
  "repository",
  "other",
]);
export const evidenceGradeSchema = z.enum([
  "said_in_transcript",
  "inferred_from_transcript",
  "verified_external",
  "unverified_external",
]);

export const temporalStatuses = [
  "current",
  "changed_since_publication",
  "historical",
  "uncertain",
] as const;
export const temporalStatusSchema = z.enum(temporalStatuses);

export const researchOrganizationDomainCodes = [
  "frontier_model_lab",
  "applied_ai_research_lab",
  "cloud_ai_platform",
  "ai_compute_hardware_systems",
  "model_training_inference_platform",
  "ai_data_curation_training_platform",
  "database_data_ai_platform",
  "retrieval_knowledge_platform",
  "agent_framework_orchestration",
  "ai_developer_platform_sdk",
  "coding_agents_developer_tools",
  "evaluation_observability_llmops",
  "ai_security_identity_governance",
  "multimodal_voice_media_ai",
  "robotics_embodied_edge_ai",
  "enterprise_ai_automation",
  "horizontal_ai_application",
  "vertical_ai_application",
  "open_source_ai_ecosystem",
  "ai_protocol_standards_body",
  "academic_nonprofit_research",
  "ai_services_consulting",
  "ai_community_education_media",
  "ai_adopting_product_company",
  "general_technology_ai_unit",
  "diversified_technology_company",
  "other_unknown",
] as const;
export const researchOrganizationDomainCodeSchema = z.enum(researchOrganizationDomainCodes);

export const organizationScopes = [
  "independent_company",
  "parent_company",
  "subsidiary",
  "division",
  "research_lab",
  "product_organization",
  "standards_body",
  "academic_institution",
  "nonprofit",
  "community_education_media",
  "other",
] as const;
export const organizationScopeSchema = z.enum(organizationScopes);

export const videoOrganizationRoles = [
  "primary_featured_organization",
  "implementation_owner",
  "speaker_employer",
  "parent_organization",
  "subsidiary_or_division",
  "acquisition_party",
  "partner",
  "customer_or_internal_user",
  "standards_steward",
  "mentioned_only",
] as const;
export const videoOrganizationRoleSchema = z.enum(videoOrganizationRoles);

export const organizationSourceRoles = [
  "official_homepage",
  "official_about",
  "official_product",
  "official_documentation",
  "official_research",
  "official_model_or_system_card",
  "official_repository",
  "official_engineering_blog",
  "official_changelog",
  "official_press_release",
  "regulatory_or_company_registry",
  "standards_specification",
  "conference_primary_material",
  "reputable_secondary_context",
] as const;
export const organizationSourceRoleSchema = z.enum(organizationSourceRoles);

export const authorityTiers = [
  "first_party",
  "official_registry",
  "standards_body",
  "reputable_secondary",
] as const;
export const authorityTierSchema = z.enum(authorityTiers);

export const packetArtifactKinds = [
  "run_manifest",
  "transcript_analysis",
  "taxonomy_classification",
  "web_context",
  "organization_research",
  "source_verification",
  "curriculum_signals",
  "initial_summary",
  "technology_library_summary",
  "organization_profile",
  "ingestion_intent",
  "execution_receipt",
] as const;
export const packetArtifactKindSchema = z.enum(packetArtifactKinds);

export const primaryTechnologyKinds = [
  "architecture",
  "technique",
  "protocol",
  "model_family",
  "platform_capability",
  "product",
  "other",
] as const;
export const primaryTechnologyKindSchema = z.enum(primaryTechnologyKinds);

export const implementationTypes = [
  "library",
  "framework",
  "sdk",
  "tool",
  "service",
  "platform",
  "product",
  "protocol",
  "model",
  "repository",
  "other",
] as const;
export const implementationTypeSchema = z.enum(implementationTypes);

export const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
export const confidenceSchema = z.number().min(0).max(1);
