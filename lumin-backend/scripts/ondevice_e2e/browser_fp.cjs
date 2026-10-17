// Fingerprints recordings with the app's real TypeScript code inside headless Chromium. Called by check_in_browser.py.
// usage: node browser_fp.cjs <workdir> file1.webm file2.webm ...  -> workdir/fps.json   ("MR:name.webm" re-records it
// with the browser's own MediaRecorder first). Needs esbuild + playwright (NODE_PATH) and CHROME_BIN or Playwright's Chromium.
const path = require('path'), fs = require('fs'), http = require('http');
const esbuild = require('esbuild');
const { chromium } = require('playwright');
(async () => {
  const [work, ...files] = process.argv.slice(2);
  const out = await esbuild.build({ entryPoints: [path.resolve(__dirname, '../../../lumin-app/lib/fingerprint/index.ts')], bundle: true, format: 'iife', globalName: 'fp', write: false });
  const bundle = out.outputFiles[0].text;
  const server = http.createServer((req, res) => {
    if (req.url === '/blank.html') { res.setHeader('content-type', 'text/html'); return res.end('<html><body></body></html>'); }
    const f = path.join(work, decodeURIComponent(req.url.slice(1)));
    if (!fs.existsSync(f)) { res.statusCode = 404; return res.end(); }
    res.setHeader('content-type', 'video/webm'); fs.createReadStream(f).pipe(res);
  }).listen(0);
  const port = server.address().port;
  const exe = process.env.CHROME_BIN;
  const browser = await chromium.launch({ headless: true, executablePath: exe || undefined, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  page.on('console', (m) => console.log('[page]', m.text()));
  await page.goto(`http://localhost:${port}/blank.html`);
  await page.addScriptTag({ content: bundle });
  const result = {};
  for (const f of files) {
    const t0 = Date.now();
    try {
      result[f] = await page.evaluate(async (name) => {
        let b;
        if (name.startsWith('MR:')) { // a browser-made recording (MediaRecorder): no duration in the header, like a live scan window
          const v = document.createElement('video'); v.src = '/' + name.slice(3); v.playsInline = true; document.body.appendChild(v);
          await new Promise((r) => v.addEventListener('loadedmetadata', r, { once: true }));
          const rec = new MediaRecorder(v.captureStream(), { mimeType: 'video/webm;codecs=vp8,opus' });
          const chunks = []; rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
          const stopped = new Promise((r) => (rec.onstop = r));
          await v.play(); rec.start(); await new Promise((r) => setTimeout(r, 3800)); rec.stop(); await stopped; v.pause();
          b = new Blob(chunks, { type: 'video/webm' });
        } else b = await (await fetch('/' + name)).blob();
        return await window.fp.fingerprintClip(b);
      }, f);
      console.log(f, 'ok', Date.now() - t0, 'ms');
    } catch (e) { result[f] = { error: String(e) }; console.log(f, 'ERROR', String(e)); }
  }
  fs.writeFileSync(path.join(work, 'fps.json'), JSON.stringify(result));
  await browser.close(); server.close();
})();
