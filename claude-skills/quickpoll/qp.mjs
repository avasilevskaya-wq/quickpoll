#!/usr/bin/env node
/* QuickPoll helper for Claude Code.
 *
 *   node qp.mjs build <draft.md>     → client link + builder (edit) link
 *   node qp.mjs check <draft.md>     → what the poll will look like + problems, no upload, no links
 *   node qp.mjs new <draft.md> "Title"  → start an empty draft
 *
 * The draft is the same text format as the builder's "Text" tab. Extras:
 *   - lines starting with // are notes for you and the team, they never reach the client;
 *   - image options may point to local files:  - Option A | ./designs/a.png
 *     they are uploaded to the "QuickPoll images" folder on Google Drive (needs the upload key).
 *
 * The poll format code is loaded from the live QuickPoll site (assets/shared.js), so this
 * script always speaks the same format as the builder. Set QUICKPOLL_DIR to a local copy
 * of the repo to use local files instead (handy when testing changes).
 *
 * Settings (optional) — environment variables or ~/.quickpoll.json:
 *   QUICKPOLL_SITE        { "site": ... }       default https://avasilevskaya-wq.github.io/quickpoll/
 *   QUICKPOLL_UPLOAD_KEY  { "uploadKey": ... }  the key from the Apps Script log (same as in the builder's Settings)
 *   QUICKPOLL_ENDPOINT    { "endpoint": ... }   only if different from the site's config.js
 * No dependencies: Node 18+.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import crypto from 'node:crypto';

const HOME_CFG = path.join(os.homedir(), '.quickpoll.json');
const fileCfg = (() => { try { return JSON.parse(fs.readFileSync(HOME_CFG, 'utf8')); } catch { return {}; } })();
const SITE = (process.env.QUICKPOLL_SITE || fileCfg.site || 'https://avasilevskaya-wq.github.io/quickpoll/').replace(/\/?$/, '/');
const LOCAL = process.env.QUICKPOLL_DIR || fileCfg.dir || '';
const UPLOAD_KEY = process.env.QUICKPOLL_UPLOAD_KEY || fileCfg.uploadKey || '';

const IMG_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const MAX_IMG = 8 * 1024 * 1024;

function die(msg) { console.error('ERROR: ' + msg); process.exit(1); }

async function getText(rel) {
  if (LOCAL) return fs.readFileSync(path.join(LOCAL, rel), 'utf8');
  let r;
  try { r = await fetch(SITE + rel + '?t=' + Date.now()); }
  catch { throw new Error('Could not reach ' + SITE + ' — check the internet connection, or set "dir" in ' + HOME_CFG + ' to your local quickpoll folder.'); }
  if (!r.ok) throw new Error('Could not load ' + SITE + rel + ' (HTTP ' + r.status + ')');
  return r.text();
}

async function loadQP() {
  const code = await getText('assets/shared.js');
  const win = {
    crypto: crypto.webcrypto, URL, TextEncoder, TextDecoder, Blob, Response, btoa, atob,
    CompressionStream: globalThis.CompressionStream, DecompressionStream: globalThis.DecompressionStream,
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    location: new URL(SITE)
  };
  win.window = win;
  const ctx = vm.createContext(Object.assign({}, win));
  ctx.window = ctx;
  vm.runInContext(code, ctx, { filename: 'shared.js' });
  if (!ctx.QP || !ctx.QP.fromText) throw new Error('shared.js did not define QP');
  return ctx.QP;
}

async function getEndpoint() {
  if (process.env.QUICKPOLL_ENDPOINT || fileCfg.endpoint) return process.env.QUICKPOLL_ENDPOINT || fileCfg.endpoint;
  try {
    const m = (await getText('config.js')).match(/endpoint\s*:\s*['"]([^'"]+)['"]/);
    return m ? m[1] : '';
  } catch { return ''; }
}

/* Stable poll id from the draft's file name: rebuilding updates the same poll (and the same sheet tab). */
function stableId(file) {
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
  const h = crypto.createHash('sha1').update(path.basename(file).toLowerCase()).digest();
  let out = '';
  for (let i = 0; i < 8; i++) out += abc[h[i] % abc.length];
  return out;
}

function readDraft(file) {
  if (!fs.existsSync(file)) die('No such draft: ' + file);
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(l => !/^\s*\/\//.test(l)).join('\n');
}

/* Local image paths in "- Label | path" lines → uploaded URLs (cached next to the draft). */
async function uploadLocalImages(text, file, opts) {
  const dir = path.dirname(path.resolve(file));
  const cacheFile = path.join(dir, '.quickpoll-cache.json');
  let cache = {}; try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch {}
  const lines = text.split('\n');
  const notes = [];
  let endpoint = null, changed = false;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*[-*•]\s*.*\|\s*)(.+?)\s*$/);
    if (!m || /^https?:\/\//i.test(m[2])) continue;
    const p = path.resolve(dir, m[2].replace(/^["']|["']$/g, ''));
    if (!fs.existsSync(p)) { notes.push('Image not found: ' + m[2]); continue; }
    const ext = path.extname(p).toLowerCase();
    if (!IMG_TYPES[ext]) { notes.push('Not an image (png/jpg/gif/webp): ' + m[2]); continue; }
    const st = fs.statSync(p);
    if (st.size > MAX_IMG) { notes.push('Image is larger than 8 MB, make it smaller: ' + m[2]); continue; }
    const key = p + '|' + st.size + '|' + Math.round(st.mtimeMs);
    if (!cache[key]) {
      if (opts.dry) { notes.push('Will upload: ' + m[2]); lines[i] = m[1] + 'https://pending.upload/' + encodeURIComponent(path.basename(p)); continue; }
      if (!UPLOAD_KEY) die('Local images need the upload key. Put it in ' + HOME_CFG + ' as {"uploadKey": "..."} or set QUICKPOLL_UPLOAD_KEY.');
      endpoint = endpoint || await getEndpoint();
      if (!endpoint) die('No Apps Script endpoint found (config.js on the site, or "endpoint" in ' + HOME_CFG + ').');
      const data = 'data:' + IMG_TYPES[ext] + ';base64,' + fs.readFileSync(p).toString('base64');
      const r = await fetch(endpoint, { method: 'POST', redirect: 'follow', body: JSON.stringify({ action: 'upload', key: UPLOAD_KEY, name: path.basename(p), data }) });
      const t = await r.text();
      let j = null; try { j = JSON.parse(t); } catch {}
      if (!j || !j.ok) die('Upload failed for ' + m[2] + ': ' + ((j && j.error) || 'the script did not answer'));
      cache[key] = j.url;
      changed = true;
      notes.push('Uploaded: ' + m[2]);
    }
    lines[i] = m[1] + cache[key];
  }
  if (changed) fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
  return { text: lines.join('\n'), notes };
}

function summary(QP, s) {
  const names = { s: 'single choice', m: 'multiple choice', y: 'yes/no', r: 'scale', i: 'images', x: 'text' };
  const out = ['Poll: ' + (s.t || '(no title)') + '  [id ' + s.id + ']'];
  if (s.d) out.push('Intro: ' + s.d.replace(/\n/g, ' '));
  if (s.n) out.push('Asks for the respondent’s name');
  s.q.forEach((q, i) => {
    const flags = [names[q.k], q.r ? 'required' : 'optional', q.c ? 'comment' : ''].filter(Boolean).join(', ');
    out.push(`${i + 1}. ${q.t}  (${flags})`);
    if (q.o) q.o.forEach((o, n) => out.push('   - ' + o + (q.k === 'i' ? '  ' + (!(q.i || [])[n] ? '[NO IMAGE]' : /^https:\/\/pending\.upload\//.test(q.i[n]) ? '[image, will upload]' : '[image]') : '')));
    if (q.k === 'r') out.push('   1–' + q.s + (q.l && (q.l[0] || q.l[1]) ? ': ' + q.l[0] + ' … ' + q.l[1] : ''));
  });
  return out.join('\n');
}

async function main() {
  const [cmd, file, ...rest] = process.argv.slice(2);
  if (!cmd || !file || ['build', 'check', 'new'].indexOf(cmd) < 0) {
    console.log('Usage: node qp.mjs build|check <draft.md>   |   node qp.mjs new <draft.md> "Poll title"');
    process.exit(cmd ? 1 : 0);
  }
  if (cmd === 'new') {
    if (fs.existsSync(file)) die('Draft already exists: ' + file);
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    fs.writeFileSync(file, '# ' + (rest.join(' ') || 'Untitled poll') + '\n> \n\n// Questions go below. See the quickpoll skill for the format.\n');
    console.log('Created ' + file);
    return;
  }
  const QP = await loadQP();
  const up = await uploadLocalImages(readDraft(file), file, { dry: cmd === 'check' });
  const s = QP.fromText(up.text);
  s.id = stableId(file);
  up.notes.forEach(n => console.log(n));
  console.log(summary(QP, s));
  const errs = QP.validate(s).map(e => e.msg);
  if (errs.length) { console.log('\nPROBLEMS:\n- ' + errs.join('\n- ')); }
  if (cmd === 'check') return;
  if (errs.length) { console.log('\nFix the problems above, then build again.'); process.exit(2); }
  const code = await QP.encode(s);
  console.log('\nCLIENT LINK (send this):\n' + SITE + 's/#' + code);
  console.log('\nEDIT IN BUILDER:\n' + SITE + '#edit=' + code);
  if (code.length > 6000) console.log('\nNote: the link is long (' + code.length + ' chars). Some chat apps may cut it; prefer email or shorten the texts.');
}

main().catch(e => die(e.message || String(e)));
