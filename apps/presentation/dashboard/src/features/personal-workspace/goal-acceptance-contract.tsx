import {useEffect, useRef, useState} from "react";
import {acceptanceRequest, type AcceptanceReadback} from "../../data/goal-acceptance-actions";
import {useWorkspaceI18n} from "./i18n";
import {GoalOracleEvidence} from "./goal-oracle-evidence";
import type { GoalAcceptanceContract } from "../../data/goal-acceptance-observation";
import type { GoalAcceptanceContractCopy } from "./delivery-review-copy";

/** Present owner-projected states without deriving acceptance or task readiness. */
export function GoalAcceptanceContractSection({ goalId, contract: retained, copy, current, canManage = current, management = false }: {
  goalId: string; contract?: GoalAcceptanceContract; copy: GoalAcceptanceContractCopy; current: boolean; canManage?: boolean; management?: boolean;
}) {
  const zh = useWorkspaceI18n().locale === "zh-CN";
  const [opened, setOpened] = useState(false);
  const [readback, setReadback] = useState<(AcceptanceReadback & {basisKey: string}) | null>(null);
  const [document, setDocument] = useState<Record<string, unknown> | null>(null);
  const [filename, setFilename] = useState("");
  const documentGoal = useRef<string | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const [notice, setNotice] = useState("");
  const generation = useRef(0), flight = useRef<number | null>(null);
  const retainedBasis = retained?.enabled ? `${retained.revision}:${retained.digest}:${retained.status}` : "disabled";
  const sourceKey = `${goalId}:${canManage}:${retainedBasis}`;
  const source = useRef(sourceKey); source.current = sourceKey;
  const readbackCurrent = readback?.goal_id === goalId && readback.basisKey === retainedBasis;
  useEffect(() => {generation.current++; setReadback(null); setDocument(null); setFilename(""); setError(false); setNotice(""); setBusy(false); documentGoal.current = null; flight.current = null; return () => {generation.current++;};}, [goalId, canManage]);
  async function operate(action?: "configure" | "verify" | "disable") {
    if (!canManage || flight.current !== null || busy || action && !readbackCurrent || action === "configure" && documentGoal.current !== goalId) return;
    const token = ++generation.current, observedSource = sourceKey; flight.current = token;
    setBusy(true); setError(false); setNotice("");
    try {
      const result = await acceptanceRequest(goalId, action ? {action, expected_provider_revision: readback!.provider_revision,
        ...(action !== "verify" ? {operation_id: `acceptance-ui:${crypto.randomUUID()}`} : {}),
        ...(action === "configure" ? {document} : {})} : undefined);
      if (token !== generation.current) return;
      if (source.current !== observedSource) {setReadback(null); setError(true); return;}
      setReadback({...result, basisKey: retainedBasis});
      if (action === "configure") {setDocument(null); setFilename("");}
      if (action) setNotice(result.checks_passed === false ? (zh ? "检查未通过，已保留失败记录。" : "Checks failed; the failure is recorded.")
        : action === "verify" ? (zh ? "检查已结束，请核对当前来源与版本。" : "Checks finished. Inspect the source and versions below.")
        : action === "disable" ? (zh ? "当前合同已停用。" : "The contract is disabled.") : (zh ? "当前 Goal 的合同已保存，尚未执行检查。" : "Contract saved for this Goal; checks have not run."));
    } catch {if (token === generation.current) {setReadback(null); setError(true);}}
    finally {if (flight.current === token) flight.current = null; if (token === generation.current) setBusy(false);}
  }
  useEffect(() => {if (opened && canManage) void operate();}, [opened, goalId, canManage, retainedBasis]);
  const contract = (readbackCurrent ? readback!.goal_acceptance_contract : undefined) ?? retained;
  const enabled = contract?.enabled === true;
  if (!management && !enabled) return null;

  const inspectCommand = `loopx --format json goal-acceptance inspect --goal-id '${goalId.replace(/'/g, "'\\''")}'`;
  return <details className="delivery-acceptance-contract" onToggle={event => setOpened(event.currentTarget.open)}>
    <summary>{copy.title}</summary>
    <div className="delivery-acceptance-content">
      <p>{copy.boundary}</p>
      <p>{zh ? "操作目标" : "Operation target"}: <strong>{goalId}</strong></p>
      {!canManage ? <p role="status">{zh ? "当前来源不可操作，请回到本机并刷新。" : "This source is read-only. Return to the local workspace and refresh."}</p> : <div className="delivery-acceptance-controls" aria-busy={busy}>
        <button type="button" disabled={busy} onClick={() => void operate()}>{zh ? "读回当前合同" : "Read current contract"}</button>
        <label>{zh ? "导入所有者批准的 JSON 合同" : "Import owner-approved JSON contract"}<input type="file" accept="application/json,.json" disabled={busy || !readbackCurrent}
          onChange={event => {const file = event.target.files?.[0]; const token = ++generation.current; documentGoal.current = null; setDocument(null); setFilename("");
            if (!file) return; if (file.size > 262144) {setError(true); return;}
            void file.text().then(text => {if (token !== generation.current) return; const parsed: unknown = JSON.parse(text);
              if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected document");
              documentGoal.current = goalId; setDocument(parsed as Record<string, unknown>); setFilename(file.name); setError(false);
            }).catch(() => {if (token === generation.current) setError(true);});
          }}/></label>
        {document ? <details open><summary>{zh ? "待保存合同" : "Contract to save"} · {filename}</summary><pre>{JSON.stringify(document, null, 2)}</pre>
          <p>{zh ? "保存会修改所列任务的验收关联；显式运行检查时会在本机执行其中的命令。请先核对范围和命令。" : "Saving changes acceptance associations for the listed work. Running checks executes its commands locally. Review the scope and commands first."}</p></details> : null}
        <button type="button" disabled={busy || !readbackCurrent || !document} onClick={() => void operate("configure")}>{zh ? "保存合同" : "Save contract"}</button>
        <button type="button" disabled={busy || !readbackCurrent || !enabled} onClick={() => void operate("verify")}>{zh ? "运行已配置的检查" : "Run configured checks"}</button>
        <button type="button" disabled={busy || !readbackCurrent || !enabled} onClick={() => void operate("disable")}>{zh ? "停用当前合同" : "Disable contract"}</button>
      </div>}
      {error ? <p role="alert">{zh ? "操作或读取未确认；请先读回当前合同和回执，再决定是否重试。导入文件须是有效的 JSON 对象。" : "The operation or read is unconfirmed. Read the current contract and receipt before retrying. Import a valid JSON object."}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {!enabled ? <p>{zh ? "当前未启用验收合同。可导入负责人批准的合同；读取不会自动执行检查。" : "No acceptance contract is enabled. Import an owner-approved contract; reading never runs checks."}</p> : null}
      {contract?.enabled === true ? <>

      {!current ? <p role="status" className="delivery-notice">{copy.retained}</p> : null}
      <dl className="delivery-acceptance-source">
        <div><dt>{copy.source}</dt><dd><code>{goalId}</code></dd></div>
        <div><dt>{copy.scope}</dt><dd>{contract.scope?.kind === "selected_work" ? copy.selectedWork : copy.allWork}</dd></div>
        <div><dt>{copy.revision}</dt><dd>{contract.revision}</dd></div>
        <div><dt>{copy.digest}</dt><dd><code>{contract.digest}</code></dd></div>
      </dl>
      <h3>{copy.objective}</h3><p>{contract.objective || copy.unknown}</p>
      {contract.non_goals.length ? <><h3>{copy.nonGoals}</h3><ul>{contract.non_goals.map((item, index) => <li key={index}>{item}</li>)}</ul></> : null}
      <h3>{copy.criteria}</h3>
      {contract.criteria.length ? <ul>{contract.criteria.map(criterion => <li key={criterion.id}><code>{criterion.id}</code> · {criterion.description}
        {criterion.oracle ? <p>{zh ? "负责人指定检查器" : "Owner-pinned checker"}: {criterion.oracle.source_id} · {({current: zh ? "当前版本已核对" : "Current versions checked", recorded: zh ? "仅历史记录，当前未核对" : "Recorded; current files not observed", stale: zh ? "来源或版本已变化" : "Source or versions changed", failed: zh ? "检查失败" : "Checks failed", unverified: zh ? "尚未检查" : "Not checked", unavailable: zh ? "证据不可用" : "Evidence unavailable"})[criterion.oracle.state]}</p> : null}</li>)}</ul> : <p>{copy.noCriteria}</p>}
      <h3>{copy.tasks}</h3>
      {contract.tasks.length ? <ul className="delivery-acceptance-tasks">{contract.tasks.map(task => <li key={task.todo_id}>
        <p><code>{task.todo_id}</code> · <strong>{copy.taskState[task.state]}</strong></p>
        <p>{copy.criteria}: {task.criterion_ids.length ? task.criterion_ids.join(", ") : copy.unknown}</p>
        {task.applicable === false ? <p>{copy.notApplicable}</p> : null}
        {task.reason ? <p>{task.reason}</p> : null}
      </li>)}</ul> : <p>{copy.noTasks}</p>}
      <h3>{copy.verification}</h3>
      <p>{copy.verificationState[contract.status]}</p>
      {contract.held_todo_ids.length ? <p>{copy.heldTasks}: {contract.held_todo_ids.join(", ")}</p> : null}
      <details><summary>{copy.receipt}</summary>
        {!contract.verification ? <p>{copy.unknown}</p> : <>
          <p>{copy.receiptNote}</p>
          <dl className="delivery-acceptance-source">
            <div><dt>{copy.operation}</dt><dd><code>{contract.verification.operation_id}</code></dd></div>
            <div><dt>{copy.revision}</dt><dd>{contract.verification.contract_revision}</dd></div>
            <div><dt>{copy.digest}</dt><dd><code>{contract.verification.contract_digest}</code></dd></div>
            <div><dt>{copy.verificationScope}</dt><dd>{contract.verification.todo_id ?? copy.allCriteria}</dd></div>
          </dl>
          <ul>{contract.verification.results.map(result => <li key={result.criterion_id}>
            <code>{result.criterion_id}</code> · {result.passed ? copy.passed : copy.failed} · {copy.exitCode}: {result.exit_code ?? copy.unknown}
            {result.oracle_evidence ? <GoalOracleEvidence evidence={result.oracle_evidence} zh={zh}/> : null}
          </li>)}</ul>
        </>}
      </details>
      <details><summary>{copy.help}</summary><p>{copy.guidance}</p>
        <p><code>{inspectCommand}</code></p><p><code>loopx goal-acceptance --help</code></p>
        <a href="https://github.com/huangruiteng/loopx/blob/main/docs/reference/goal-acceptance-observations.md#owner-authorized-contract-v0" target="_blank" rel="noreferrer">{copy.guide}</a>
      </details>
      </> : null}
    </div>
  </details>;
}
