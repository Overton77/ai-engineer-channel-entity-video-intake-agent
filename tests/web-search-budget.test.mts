import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  webSearchLedgerCap,
  webSearchLedgerLabelForStage,
} from "../agent/lib/web-search-budget";

describe("web-search stage budget", () => {
  it("derives the ledger label from the controller stage", () => {
    assert.equal(webSearchLedgerLabelForStage("web_context"), "web_context_scout");
    assert.equal(
      webSearchLedgerLabelForStage("organization_research"),
      "organization_researcher",
    );
    assert.equal(webSearchLedgerLabelForStage("source_verification"), "source_verifier");
    assert.equal(webSearchLedgerLabelForStage("transcript_taxonomy"), null);
    assert.equal(webSearchLedgerLabelForStage("curriculum"), null);
    assert.equal(webSearchLedgerLabelForStage(null), null);
  });

  it("enforces the 3/3/2 stage caps", () => {
    assert.equal(webSearchLedgerCap("web_context_scout"), 3);
    assert.equal(webSearchLedgerCap("organization_researcher"), 3);
    assert.equal(webSearchLedgerCap("source_verifier"), 2);
  });
});
