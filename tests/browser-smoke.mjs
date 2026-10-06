import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import next from "next";

// Run explicitly after npm run build; uses the installed Chrome, with no screenshots.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = resolve(tmpdir());
const temporary = mkdtempSync(join(temporaryRoot, "tender-browser-"));
const app = next({ dev: false, dir: root });
let browser;
let socket;
let server;
let sequence = 0;
const pending = new Map();
const exceptions = [];
const requests = [];

async function waitFor(callback, description, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try { if (await callback()) return; } catch { /* Wait for navigation or state to finish. */ }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`Timed out: ${description}`);
}

function command(method, params = {}) {
  return new Promise((done, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(id, { done, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

async function upload(selector, paths) {
  const document = await command("DOM.getDocument");
  const input = await command("DOM.querySelector", { nodeId: document.root.nodeId, selector });
  await command("DOM.setFileInputFiles", { nodeId: input.nodeId, files: paths });
}

async function choose(selector, filename) {
  await evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    const option = [...input.options].find(item => item.textContent === ${JSON.stringify(filename)});
    if (!option || option.disabled) throw new Error('Document option unavailable');
    input.value = option.value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
}

async function date(value) {
  await evaluate(`(() => {
    const input = document.querySelector('input[type="date"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
}

async function contains(text) {
  return evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`);
}

try {
  await app.prepare();
  server = createServer(app.getRequestHandler());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  const profile = join(temporary, "profile");
  const browserPath = process.env.TENDER_TEST_BROWSER ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  browser = spawn(browserPath, ["--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--disable-background-networking", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
  browser.on("error", (error) => exceptions.push(error.message));
  let debuggingPort;
  await waitFor(() => { debuggingPort = readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]; return Boolean(debuggingPort); }, "Chrome startup");
  const targets = await (await fetch(`http://127.0.0.1:${debuggingPort}/json/list`)).json();
  const page = targets.find((target) => target.type === "page");
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await once(socket, "open");
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const task = pending.get(message.id);
      if (!task) return;
      clearTimeout(task.timer);
      pending.delete(message.id);
      if (message.error) task.reject(new Error(JSON.stringify(message.error)));
      else task.done(message.result);
    }
    if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails);
    if (message.method === "Network.requestWillBeSent") requests.push(message.params.request.url);
  });
  await command("Runtime.enable");
  await command("Page.enable");
  await command("Network.enable");
  await command("Page.navigate", { url: origin });
  await waitFor(() => contains("Your checklist starts here"), "initial empty state");
  await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent === 'বাংলা').click()");
  await waitFor(() => contains("নথির কর্মক্ষেত্র"), "React hydration and Bangla toggle");
  await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent === 'EN').click()");

  const invalidJson = join(temporary, "invalid.json");
  writeFileSync(invalidJson, "{invalid");
  await upload("#json-upload", [invalidJson]);
  await waitFor(() => contains("malformed JSON"), "malformed JSON error");

  const json = join(temporary, "unseen.json");
  writeFileSync(json, JSON.stringify({
    tender: { tender_id: "UNSEEN-TEST", title: "Browser check", procuring_entity: "Test entity", bidder: "Test bidder", submission_deadline: "2026-10-20" },
    requirements: [
      { id: "optional", order: 3, title_en: "Optional document", title_bn: "ঐচ্ছিক নথি", mandatory: false, has_expiry: false },
      { id: "required", order: 2, title_en: "Required document", title_bn: "আবশ্যক নথি", mandatory: true, has_expiry: false },
      { id: "expiry", order: 1, title_en: "Expiring document", title_bn: "মেয়াদের নথি", mandatory: true, has_expiry: true },
    ],
  }));
  await upload("#json-upload", [json]);
  await waitFor(() => contains("UNSEEN-TEST"), "valid unseen JSON");
  assert.deepEqual(await evaluate("[...document.querySelectorAll('ol > li h3')].map(item => item.textContent)"), ["Expiring document", "Required document", "Optional document"]);
  assert.equal(await contains("Not provided"), true);

  const corrupt = join(temporary, "damaged.pdf");
  writeFileSync(corrupt, "%PDF-1.7\ncorrupt");
  await upload("#pdf-upload", ["experience_cert.pdf", "experience_cert (1).pdf", "03_tin_certificate.pdf", "trade_license_2026.pdf", "company_logo.png"].map((filename) => join(root, "documents", filename)).concat(corrupt));
  await waitFor(() => contains("Some files could not be added"), "mixed PDF batch");
  assert.equal(await evaluate("[...document.querySelectorAll('span')].filter(item => item.textContent === 'Duplicate').length"), 2);
  assert.equal(await contains("Only PDF files are accepted"), true);
  assert.equal(await contains("damaged or unreadable"), true);

  await choose("#requirement-0", "trade_license_2026.pdf");
  await waitFor(() => contains("Expiry needed"), "expiry needed state");
  await date("2026-10-19");
  await waitFor(() => contains("Expired"), "expiry before deadline");
  await date("2026-10-20");
  await choose("#requirement-1", "experience_cert.pdf");
  await waitFor(() => contains("Requirements complete"), "expiry exactly on deadline and optional unmatched readiness");
  assert.equal(await evaluate("[...document.querySelector('#requirement-2').options].find(item => item.textContent.includes('experience_cert (1).pdf')).disabled"), true);

  await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  assert.equal(await evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true, "mobile layout overflow");
  await evaluate("document.querySelector('[aria-label=\"Remove: trade_license_2026.pdf\"]').click()");
  await waitFor(async () => !(await evaluate("Boolean(document.querySelector('input[type=date]'))")), "removal clears assignment and expiry input");
  assert.equal(await contains("Missing"), true);
  await evaluate("document.querySelector('[aria-label=\"Remove: experience_cert (1).pdf\"]').click()");
  await waitFor(async () => (await evaluate("[...document.querySelectorAll('span')].filter(item => item.textContent === 'Duplicate').length")) === 0, "duplicate indicator clears");
  assert.deepEqual(exceptions, [], "browser runtime errors");
  assert.equal(requests.every((url) => url.startsWith(origin) || url.startsWith("data:")), true, "document workflow sent an external request");
  console.log("Browser smoke passed: JSON, PDFs, duplicates, matching, expiry boundaries, removal, Bangla, mobile layout, and local-only processing.");
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    try { await command("Browser.close"); } catch { /* Browser may close before responding. */ }
    socket.close();
  }
  if (browser && browser.exitCode === null) {
    const exit = once(browser, "exit");
    browser.kill();
    await Promise.race([exit, new Promise((done) => setTimeout(done, 2000))]);
  }
  if (server) { server.closeAllConnections(); await new Promise((done) => server.close(done)); }
  await app.close();
  if (!resolve(temporary).startsWith(temporaryRoot + sep)) throw new Error("Unsafe temporary cleanup path");
  rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
