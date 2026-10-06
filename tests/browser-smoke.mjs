import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import next from "next";
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";

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

function pageText(page) {
  const contents = page.node.Contents();
  const streams = contents instanceof PDFArray ? Array.from({ length: contents.size() }, (_, index) => contents.lookup(index, PDFRawStream)) : contents ? [contents] : [];
  const decoded = streams.map((stream) => new TextDecoder().decode(decodePDFRawStream(stream).decode())).join("\n");
  return [...decoded.matchAll(/<([0-9a-f]+)>\s*Tj/gi)].map((match) => Buffer.from(match[1], "hex").toString("latin1")).join("\n");
}

async function runSmoke() {
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
  const downloads = join(temporary, "downloads");
  mkdirSync(downloads);
  await command("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });
  await command("Page.navigate", { url: origin });
  await waitFor(() => contains("Your checklist starts here"), "initial empty state");
  assert.equal(await evaluate("document.querySelector('#generate-package').disabled"), true);
  await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent === 'বাংলা').click()");
  await waitFor(() => contains("নথির কর্মক্ষেত্র"), "React hydration and Bangla toggle");
  await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent === 'EN').click()");

  const invalidJson = join(temporary, "invalid.json");
  writeFileSync(invalidJson, "{invalid");
  await upload("#json-upload", [invalidJson]);
  await waitFor(() => contains("malformed JSON"), "malformed JSON error");
  await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent === 'বাংলা').click()");
  await waitFor(() => contains("এই ফাইলের JSON বিন্যাস সঠিক নয়"), "validation error follows language switch");
  await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent === 'EN').click()");

  const json = join(temporary, "unseen.json");
  writeFileSync(json, JSON.stringify({
    tender: { tender_id: "UNSEEN-TEST", title: "Browser check", procuring_entity: "Test entity", bidder: "Test bidder", submission_deadline: "2026-10-20" },
    requirements: [
      { id: "optional", order: 3, title_en: "Optional document", title_bn: "ঐচ্ছিক নথি", mandatory: false, has_expiry: false },
      { id: "required", order: 2, title_en: "Required document", title_bn: "আবশ্যক নথি", mandatory: true, has_expiry: false },
      { id: "expiry", order: 1, title_en: "Expiring document", title_bn: "মেয়াদের নথি", mandatory: true, has_expiry: true },
      { id: "optional-expiry", order: 4, title_en: "Optional expiring document", title_bn: "মেয়াদযুক্ত ঐচ্ছিক নথি", mandatory: false, has_expiry: true },
    ],
  }));
  await upload("#json-upload", [json]);
  await waitFor(() => contains("UNSEEN-TEST"), "valid unseen JSON");
  assert.deepEqual(await evaluate("[...document.querySelectorAll('ol > li h3')].map(item => item.textContent)"), ["Expiring document", "Required document", "Optional document", "Optional expiring document"]);
  assert.equal(await contains("Not provided"), true);
  assert.deepEqual(await evaluate("['total', 'ok', 'blocking', 'not-provided'].map(key => document.querySelector('#readiness-' + key).textContent)"), ["4", "0", "2", "2"]);
  assert.equal(await contains("Resolve 2 blocking issues"), true);
  assert.equal(await evaluate("document.querySelector('#generate-package').disabled"), true);

  const corrupt = join(temporary, "damaged.pdf");
  writeFileSync(corrupt, "%PDF-1.7\ncorrupt");
  await upload("#pdf-upload", ["experience_cert.pdf", "experience_cert (1).pdf", "03_tin_certificate.pdf", "trade_license_2026.pdf", "company_logo.png"].map((filename) => join(root, "documents", filename)).concat(corrupt));
  await waitFor(() => contains("Some files could not be added"), "mixed PDF batch");
  assert.equal(await evaluate("[...document.querySelectorAll('span')].filter(item => item.textContent === 'Duplicate').length"), 2);
  assert.equal(await contains("Only PDF files are accepted"), true);
  assert.equal(await contains("damaged or unreadable"), true);

  await choose("#requirement-0", "trade_license_2026.pdf");
  await waitFor(() => contains("Expiry date needed"), "expiry needed state");
  assert.equal(await evaluate("document.querySelector('#generate-package').disabled"), true);
  await date("2026-10-19");
  await waitFor(() => contains("Expired"), "expiry before deadline");
  await date("2026-10-20");
  assert.equal(await evaluate("document.querySelector('#generate-package').disabled"), true, "unmatched mandatory document still blocks");
  await choose("#requirement-1", "experience_cert.pdf");
  await waitFor(() => contains("Requirements complete"), "expiry exactly on deadline and optional unmatched readiness");
  assert.equal(await evaluate("document.querySelector('#generate-package').disabled"), false);
  assert.deepEqual(await evaluate("['total', 'ok', 'blocking', 'not-provided'].map(key => document.querySelector('#readiness-' + key).textContent)"), ["4", "2", "0", "2"]);
  await date("2026-10-21");
  await waitFor(() => contains("All required documents are ready"), "expiry after deadline remains ready");
  assert.equal(await evaluate("[...document.querySelector('#requirement-2').options].find(item => item.textContent.includes('experience_cert (1).pdf')).disabled"), true);
  assert.equal(await evaluate("[...document.querySelector('#requirement-2').options].find(item => item.textContent.startsWith('experience_cert.pdf')).disabled"), true, "same file disabled in another row");
  assert.equal(await contains("Only one copy can be assigned"), true);

  await evaluate("document.querySelector('[aria-label=\"Remove match: Required document\"]').click()");
  await waitFor(() => evaluate("document.querySelector('#generate-package').disabled"), "unmatching immediately blocks generation");
  assert.equal(await evaluate("[...document.querySelector('#requirement-2').options].find(item => item.textContent === 'experience_cert (1).pdf').disabled"), false);
  await choose("#requirement-2", "experience_cert (1).pdf");
  await evaluate("document.querySelector('[aria-label=\"Remove match: Optional document\"]').click()");
  await waitFor(() => evaluate("document.querySelector('#requirement-2').value === ''"), "explicit optional unmatch");
  await choose("#requirement-1", "experience_cert.pdf");
  await waitFor(() => evaluate("!document.querySelector('#generate-package').disabled"), "freed hash can be reassigned");

  await choose("#requirement-0", "03_tin_certificate.pdf");
  await waitFor(() => contains("Expiry date needed"), "changing the match resets expiry");
  assert.equal(await evaluate("document.querySelector('input[type=date]').value"), "");
  assert.equal(await evaluate("document.querySelector('#generate-package').disabled"), true);
  await date("2026-10-20");
  await choose("#requirement-0", "trade_license_2026.pdf");
  await waitFor(() => evaluate("document.querySelector('input[type=date]').value === ''"), "second replacement also resets expiry");
  await date("2026-10-20");
  await waitFor(() => evaluate("!document.querySelector('#generate-package').disabled"), "mandatory issues resolved again");

  await choose("#requirement-3", "03_tin_certificate.pdf");
  await waitFor(() => evaluate("document.querySelector('#generate-package').disabled"), "matched optional document with missing expiry blocks");
  assert.equal(await contains("Resolve 1 blocking issue"), true);
  await evaluate("document.querySelector('[aria-label=\"Remove match: Optional expiring document\"]').click()");
  await waitFor(() => evaluate("!document.querySelector('#generate-package').disabled"), "unmatched optional expiry document is non-blocking");
  assert.equal(await evaluate("document.querySelectorAll('input[type=date]').length"), 1);

  for (const language of ["en", "bn"]) {
    await evaluate(`document.querySelector('button[lang="${language}"]').click()`);
    await waitFor(() => evaluate(`document.querySelector('div[lang="${language}"]') !== null`), "language update");
    if (language === "bn") {
      assert.equal(await contains("মেয়াদের নথি"), true);
      assert.equal(await contains("সব আবশ্যক নথি প্রস্তুত"), true);
      assert.equal(await evaluate("document.querySelector('#readiness-ok').textContent"), "২");
      assert.equal(await contains("Test bidder"), true, "tender-provided names remain unchanged");
      await evaluate(`(() => {
        window.__tenderObjectUrls = { created: [], revoked: [] };
        const create = URL.createObjectURL.bind(URL);
        const revoke = URL.revokeObjectURL.bind(URL);
        URL.createObjectURL = blob => { const url = create(blob); window.__tenderObjectUrls.created.push(url); return url; };
        URL.revokeObjectURL = url => { window.__tenderObjectUrls.revoked.push(url); revoke(url); };
      })()`);
      const loadingVisible = await evaluate(`(async () => {
        const button = document.querySelector('#generate-package');
        button.click();
        await new Promise(done => setTimeout(done, 0));
        return button.disabled && button.getAttribute('aria-busy') === 'true';
      })()`);
      assert.equal(loadingVisible, true, "generation loading state disables repeat clicks");
      const downloaded = join(downloads, "UNSEEN-TEST_Package.pdf");
      await waitFor(() => existsSync(downloaded), "PDF downloaded with the exact filename");
      await waitFor(() => contains("ডাউনলোড শুরু হয়েছে"), "translated generation success");
      const output = await PDFDocument.load(readFileSync(downloaded));
      const trade = await PDFDocument.load(readFileSync(join(root, "documents", "trade_license_2026.pdf")));
      const experience = await PDFDocument.load(readFileSync(join(root, "documents", "experience_cert.pdf")));
      const total = 1 + trade.getPageCount() + experience.getPageCount();
      assert.equal(output.getPageCount(), total);
      const cover = pageText(output.getPage(0));
      assert.ok(cover.includes("Tender Document Package"), "cover remains English in Bangla UI");
      assert.ok(cover.includes("1. Expiring document"));
      assert.ok(cover.includes("2. Required document"));
      assert.ok(!cover.includes("3. Optional document"));
      assert.ok(cover.includes("Test bidder"));
      for (const [index, page] of output.getPages().entries()) assert.ok(pageText(page).includes(`UNSEEN-TEST | Page ${index + 1} of ${total}`));
      await waitFor(() => evaluate("window.__tenderObjectUrls.created.length === 1 && window.__tenderObjectUrls.revoked.length === 1"), "download object URL released");
      assert.equal(await evaluate("document.querySelector('#generate-package').disabled"), false, "generation can be repeated after success");
    }
    for (const width of [320, 375, 1280]) {
      await command("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: false });
      assert.equal(await evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true, `${language} layout overflow at ${width}px`);
      assert.equal(await evaluate("[...document.querySelectorAll('select, input[type=date]')].every(input => input.getBoundingClientRect().width > 120 && input.getBoundingClientRect().height >= 40)"), true, `${language} controls unusable at ${width}px`);
    }
  }
  await evaluate("document.querySelector('button[lang=en]').click()");
  await waitFor(() => contains("All required documents are ready"), "English restored");

  const badCover = JSON.parse(readFileSync(json, "utf8"));
  badCover.tender.tender_id = "UNSUPPORTED-COVER";
  badCover.tender.title = "বাংলা শিরোনাম";
  const badCoverPath = join(temporary, "unsupported-cover.json");
  writeFileSync(badCoverPath, JSON.stringify(badCover));
  await upload("#json-upload", [badCoverPath]);
  await waitFor(() => contains("UNSUPPORTED-COVER"), "new tender for generation failure");
  await choose("#requirement-0", "trade_license_2026.pdf");
  await date("2026-10-20");
  await choose("#requirement-1", "experience_cert.pdf");
  await waitFor(() => evaluate("!document.querySelector('#generate-package').disabled"), "failure fixture ready");
  await evaluate("document.querySelector('#generate-package').click()");
  await waitFor(() => contains("Could not create or download the package"), "friendly generation error");
  assert.equal(await evaluate("document.querySelector('#generate-package').disabled"), false, "generation failure releases loading state");
  await evaluate("document.querySelector('button[lang=bn]').click()");
  await waitFor(() => contains("প্রচ্ছদের জন্য"), "generation failure translated");
  await evaluate("document.querySelector('button[lang=en]').click()");
  await upload("#json-upload", [json]);
  await waitFor(() => contains("UNSEEN-TEST"), "restore valid tender after generation error");
  await choose("#requirement-0", "trade_license_2026.pdf");
  await date("2026-10-20");
  await choose("#requirement-1", "experience_cert.pdf");
  await waitFor(() => contains("All required documents are ready"), "workflow recovers after generation error");

  await evaluate("document.querySelector('[aria-label=\"Remove: trade_license_2026.pdf\"]').click()");
  await waitFor(async () => !(await evaluate("Boolean(document.querySelector('input[type=date]'))")), "removal clears assignment and expiry input");
  assert.equal(await contains("Missing"), true);
  assert.equal(await evaluate("document.querySelector('#generate-package').disabled"), true);
  await evaluate("document.querySelector('[aria-label=\"Remove: experience_cert (1).pdf\"]').click()");
  await waitFor(async () => (await evaluate("[...document.querySelectorAll('span')].filter(item => item.textContent === 'Duplicate').length")) === 0, "duplicate indicator clears");
  assert.deepEqual(exceptions, [], "browser runtime errors");
  assert.equal(requests.every((url) => url.startsWith(origin) || url.startsWith("data:") || url.startsWith(`blob:${origin}/`)), true, "document workflow sent an external request");
} finally {
  const browserExited = browser && browser.exitCode === null ? once(browser, "exit").then(() => true) : Promise.resolve(true);
  if (socket?.readyState === WebSocket.OPEN) {
    try { await command("Browser.close"); } catch { /* Browser may close before responding. */ }
    socket.close();
  }
  if (browser && browser.exitCode === null) {
    // Let Chrome release its profile before terminating the owned process.
    const exited = await Promise.race([browserExited, new Promise((done) => setTimeout(() => done(false), 5000).unref())]);
    if (!exited) {
      browser.kill();
      await Promise.race([browserExited, new Promise((done) => setTimeout(done, 2000).unref())]);
    }
  }
  if (server) { server.closeAllConnections(); await new Promise((done) => server.close(done)); }
  await app.close();
  if (!resolve(temporary).startsWith(temporaryRoot + sep)) throw new Error("Unsafe temporary cleanup path");
  rmSync(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
}
}

await runSmoke().then(() => {
  console.log("Browser smoke passed: existing document workflow, English PDF download from Bangla UI, ordered pages and footers, loading/error recovery, object URL cleanup, responsive layouts, and local-only processing.");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
