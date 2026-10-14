import assert from "node:assert/strict";
import test from "node:test";
import {normalizeGoalAcceptanceDocument, normalizeAcceptanceResults} from "../../loopx/control_plane/goals/acceptance_contract.ts";
import {acceptanceOracleBasis, validateOracleResults, observeAcceptanceOracles} from "../../loopx/control_plane/goals/acceptance_oracle.ts";
const document = () => normalizeGoalAcceptanceDocument({scope: {kind: "selected_work", todo_ids: ["todo_work"]}, objective: "Compare exact output with its expected input", non_goals: [], bindings: [{todo_id: "todo_work", criterion_ids: ["check"]}], criteria: [{id: "check", description: "Owner supplied checker", validation_argv: ["python3", "check.py"], validation_timeout_seconds: 5, validation_files: [{path: "check.py", sha256: "a".repeat(64)}], oracle: {kind: "owner_pinned_oracle", source_id: "owner-checker", input_refs: ["input.txt"], output_refs: ["output.txt"]}}]});
test("oracle requires a pinned invoked source and distinct explicit artifact roles", () => {
  for (const change of [
    {validation_files: []}, {validation_argv: ["python3", "-c", "pass"]},
    {validation_argv: ["check.py"]},
    {validation_argv: ["python3", "-c", "pass"], validation_files: [{path: "-c", sha256: "a".repeat(64)}]},
    {oracle: {kind: "owner_pinned_oracle", source_id: "owner-checker", input_refs: ["output.txt"], output_refs: ["output.txt"]}},
    {oracle: {kind: "owner_pinned_oracle", source_id: "owner-checker", input_refs: [], output_refs: ["../output.txt"]}},
  ]) {
    const doc = document();
    assert.throws(() => normalizeGoalAcceptanceDocument({...doc, criteria: [{...doc.criteria[0], ...change}]}));
  }
});
test("success cannot be supplied without the exact configured oracle and checked refs", () => {
  const criterion = document().criteria[0];
  const evidence = {source_id: "owner-checker", source_digest: acceptanceOracleBasis(criterion), checked_at: "2026-01-01T00:00:00Z",
    input_versions: [{ref: "input.txt", sha256: "b".repeat(64)}], output_versions: [{ref: "output.txt", sha256: "c".repeat(64)}]};
  const result = {criterion_id: "check", passed: true, exit_code: 0};
  assert.throws(() => validateOracleResults([criterion], [result]));
  for (const patch of [{source_id: "self-asserted-worker"}, {source_digest: "d".repeat(64)}, {output_versions: []}]) {
    assert.throws(() => validateOracleResults([criterion], [{...result, oracle_evidence: {...evidence, ...patch}}]));
  }
  const results = normalizeAcceptanceResults([{...result, oracle_evidence: evidence}]);
  assert.doesNotThrow(() => validateOracleResults([criterion], results));
  assert.throws(() => validateOracleResults([{...criterion, oracle: undefined}], results));
  const contract = {enabled: true, criteria: [{id: "check", oracle: {state: "recorded"}}], verification: {results}};
  assert.equal((observeAcceptanceOracles({contract, observations: []}).criteria as any[])[0].oracle.state, "unavailable");
  for (const facts of [
    {source_current: false, ...evidence},
    {source_current: true, ...evidence, output_versions: [{ref: "output.txt", sha256: "d".repeat(64)}]},
  ]) assert.equal((observeAcceptanceOracles({contract, observations: [{criterion_id: "check", available: true, ...facts}]}).criteria as any[])[0].oracle.state, "stale");
  assert.equal((observeAcceptanceOracles({contract, observations: [{criterion_id: "check", available: true, source_current: true, ...evidence}]}).criteria as any[])[0].oracle.state, "current");
});
