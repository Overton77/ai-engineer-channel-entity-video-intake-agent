import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ModelMessage } from "ai";
import {
  researchStageFromMessages,
  synthesisStageFromMessages,
} from "../agent/lib/turn-capabilities";

describe("turn stage capability resolution", () => {
  it("uses the newest research stage marker in a shared session", () => {
    const messages = [
      { role: "user", content: "research_stage transcript_taxonomy" },
      { role: "assistant", content: "saved transcript_taxonomy" },
      { role: "user", content: "research_stage web_context" },
    ] as ModelMessage[];
    assert.equal(researchStageFromMessages(messages), "web_context");
  });

  it("uses the newest synthesis stage marker in a shared session", () => {
    const messages = [
      { role: "user", content: "synthesis_stage initial_summary" },
      { role: "assistant", content: "saved initial_summary" },
      { role: "user", content: "synthesis_stage organization_profile" },
    ] as ModelMessage[];
    assert.equal(synthesisStageFromMessages(messages), "organization_profile");
  });

  it("recognizes a research recovery prompt by missing artifact kind", () => {
    const messages = [
      { role: "user", content: "research_stage transcript_taxonomy" },
      { role: "assistant", content: "saved transcript_taxonomy" },
      {
        role: "user",
        content: "Save only the missing registered artifact kinds: web_context. Do not ask again.",
      },
    ] as ModelMessage[];
    assert.equal(researchStageFromMessages(messages), "web_context");
  });

  it("maps curriculum_signals recovery to the curriculum stage", () => {
    const messages = [
      { role: "user", content: "Missing registered artifact kinds: curriculum_signals" },
    ] as ModelMessage[];
    assert.equal(researchStageFromMessages(messages), "curriculum");
  });

  it("recognizes a synthesis recovery prompt by missing artifact kind", () => {
    const messages = [
      { role: "user", content: "synthesis_stage initial_summary" },
      { role: "assistant", content: "saved initial_summary" },
      { role: "user", content: "Save only the missing registered artifact kinds: organization_profile." },
    ] as ModelMessage[];
    assert.equal(synthesisStageFromMessages(messages), "organization_profile");
  });
});
