// Packaged settings and evidence with a real disposable SQLite/HTTP/CLI owner.
import assert from "node:assert/strict";
import {spawn, execFileSync} from "node:child_process";
import {createInterface} from "node:readline";
import {mkdtemp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {resolve} from "node:path";
import {resolveTestPython} from "../../scripts/test-python.mjs";
import {launchBrowser, loadPlaywright, waitForHttp} from "../dashboard-browser-smoke-support.mjs";
import {fetchWorkspaceBackend, openWorkspacePage} from "./scenario-context.mjs";
import {outputDir, packaged, port, repoRoot, startServer} from "./fixture.mjs";

const root = await mkdtemp(resolve(tmpdir(), "loopx-oracle-browser-"));
const child = spawn(resolveTestPython(), ["-u", "examples/personal-workspace-browser/goal-acceptance-oracle-backend.py", root], {cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"]});
let diagnostic = "";
child.stderr.on("data", chunk => diagnostic = (diagnostic + chunk).slice(-4000));
const lines = createInterface({input: child.stdout});
let browser, server, context;
try {
  const authority = await new Promise((accept, reject) => {
    const timer = setTimeout(() => reject(Error(`Oracle fixture did not start: ${diagnostic}`)), 20000);
    child.once("exit", () => {clearTimeout(timer); reject(Error(`Oracle fixture exited: ${diagnostic}`));});
    lines.once("line", line => {clearTimeout(timer); accept(JSON.parse(line));});
  });
  const backend = `http://127.0.0.1:${authority.port}`;
  server = await startServer();
  const url = `http://127.0.0.1:${port}/${packaged ? "chat/" : ""}?statusUrl=/status.json`;
  await waitForHttp(url);
  browser = await launchBrowser(loadPlaywright().chromium);
  context = await openWorkspacePage(browser, url, {beforeGoto: async (_api, page) => {
    await page.addInitScript(() => localStorage.setItem("loopx-pw-locale", "zh-CN"));
    await page.route("**/api/chat/goal-acceptance**", async route => route.fulfill({response: await fetchWorkspaceBackend(route, backend)}));
  }});
  const {page} = context;
  await page.locator(".personal-goal-link", {hasText: "Multi Agent Projection"}).click();
  await page.getByRole("button", {name: "Goal 设置", exact: true}).click();
  await page.getByRole("button", {name: "任务所有权", exact: true}).click();
  const panel = page.locator(".delivery-acceptance-contract");
  await panel.locator(":scope > summary").click();
  await panel.getByText("当前未启用验收合同。", {exact: false}).waitFor();
  await mkdir(outputDir, {recursive: true});
  await page.screenshot({path: resolve(outputDir, "oracle-before.png"), animations: "disabled"});
  // setInputFiles bypasses the native disabled control. Wait for the actual
  // owner readback, as a user must, before importing a declaration.
  await page.waitForFunction(() => {
    const field = document.querySelector('.delivery-acceptance-contract input[type="file"]');
    return field instanceof HTMLInputElement && !field.disabled;
  });
  const read = () => JSON.parse(execFileSync(resolveTestPython(), ["-m", "loopx.cli", "--format", "json", "--registry", authority.registry, "--runtime-root", authority.runtime,
    "goal-acceptance", "inspect", "--goal-id", "multi-agent-projection"], {cwd: repoRoot, encoding: "utf8"}));
  const initial = read();
  const invalid = JSON.parse(await readFile(resolve(root, "owner-contract.json"), "utf8"));
  invalid.criteria[0].validation_argv = ["/usr/bin/true", "check.py"];
  await writeFile(resolve(root, "invalid-contract.json"), JSON.stringify(invalid));
  await panel.locator('input[type="file"]').setInputFiles(resolve(root, "invalid-contract.json"));
  const rejectedSave = page.waitForResponse(response => response.url().includes("/api/chat/goal-acceptance") && response.request().method() === "POST");
  await panel.getByRole("button", {name: "保存合同", exact: true}).click();
  assert.equal((await rejectedSave).status(), 409);
  await panel.getByRole("alert").waitFor();
  assert.deepEqual(read(), initial, "rejected invocation must not configure a contract or create evidence");
  await panel.getByRole("button", {name: "读回当前合同", exact: true}).click();
  await page.waitForFunction(() => {
    const field = document.querySelector('.delivery-acceptance-contract input[type="file"]');
    return field instanceof HTMLInputElement && !field.disabled;
  });
  const expectedError = context.errors.findIndex(value => value === "Failed to load resource: the server responded with a status of 409 (Conflict)");
  if (expectedError >= 0) context.errors.splice(expectedError, 1);
  await panel.locator('input[type="file"]').setInputFiles(resolve(root, "owner-contract.json"));
  await panel.getByRole("button", {name: "保存合同", exact: true}).click();
  await panel.getByText("当前 Goal 的合同已保存，尚未执行检查。", {exact: true}).waitFor();
  assert.equal(read().goal_acceptance_contract.criteria[0].oracle.state, "unverified");
  const run = panel.getByRole("button", {name: "运行已配置的检查", exact: true});
  await run.click();
  await panel.getByText("当前版本已核对", {exact: false}).waitFor();
  assert.equal(read().goal_acceptance_contract.criteria[0].oracle.state, "current");
  await panel.locator(".delivery-acceptance-controls").scrollIntoViewIfNeeded();
  await page.screenshot({path: resolve(outputDir, "oracle-controls-desktop.png"), animations: "disabled"});
  await panel.getByText("已记录的产物检查", {exact: true}).click();
  await panel.getByText("查看来源与实际检查版本", {exact: true}).click();
  await page.screenshot({path: resolve(outputDir, "oracle-current-desktop.png"), animations: "disabled"});
  await page.setViewportSize({width: 390, height: 844});
  await page.emulateMedia({reducedMotion: "reduce"});
  await page.screenshot({path: resolve(outputDir, "oracle-current-mobile.png"), animations: "disabled"});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await panel.locator(".delivery-acceptance-controls").scrollIntoViewIfNeeded();
  await page.screenshot({path: resolve(outputDir, "oracle-controls-mobile.png"), animations: "disabled"});
  await writeFile(resolve(root, "project/result.txt"), "new version without verification");
  const refresh = panel.getByRole("button", {name: "读回当前合同", exact: true});
  await refresh.focus(); await page.keyboard.press("Enter");
  await panel.getByText("来源或版本已变化", {exact: false}).waitFor();
  assert.equal(read().goal_acceptance_contract.criteria[0].oracle.state, "stale");
  await run.click();
  await panel.getByText("检查未通过，已保留失败记录。", {exact: true}).waitFor();
  await writeFile(resolve(root, "project/result.txt"), "usable export");
  await run.click(); await panel.getByText("当前版本已核对", {exact: false}).waitFor();
  await panel.getByRole("button", {name: "停用当前合同", exact: true}).click();
  await panel.getByText("当前合同已停用。", {exact: true}).waitFor();
  assert.equal(read().goal_acceptance_contract.enabled, false);
  assert.deepEqual(context.errors.filter(value => !value.includes("404")), []);
  console.log(JSON.stringify({status: "PASS", boundary: "Packaged UI; synthetic workspace directory with actual SQLite/HTTP/CLI source; no installed App or live model claim", checks: ["discover", "invalid invocation refusal/readback/recovery", "import/save", "explicit checks", "exact readback", "changed output", "failure/recovery", "disable", "390px", "keyboard/reduced-motion"]}));
} finally {
  await context?.close(); await browser?.close(); server?.kill("SIGTERM");
  lines.close(); child.kill("SIGTERM");
  await rm(root, {recursive: true, force: true});
}
