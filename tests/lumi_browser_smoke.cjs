// Usage: node tests/lumi_browser_smoke.cjs <runtime> <tooling directory> <core> <h5p directory>
// Requires a current build, @playwright/test from the tooling directory and locally installed Chrome.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { createRequire } = require('node:module');
const [runtime, upstream, core, packages] = process.argv.slice(2).map(p => path.resolve(p));
const load = createRequire(path.join(runtime, 'package.json'));
const { H5PPlayer, H5PConfig, fsImplementations: stores } = load('@lumieducation/h5p-server');
const PackageImporter = load('@lumieducation/h5p-server/build/src/PackageImporter').default;
const { chromium } = createRequire(path.join(upstream, 'package.json'))('@playwright/test');
const mime = load('mime-types');
const { containsLatex } = require('../dist/core/h5p/math.js');
// Optional math mode checks rendering on every question, including feedback.
const mathMode = process.env.H5P_MCP_MATH_SMOKE === '1';
const user = { id: 'smoke', name: 'Smoke', email: '', type: 'local' };

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lumi-browser-'));
  const pages = new Map();
  const contentParams = [];
  let browser;
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      // This smoke host has no persistent learner state or gradebook.
      if (url.pathname.startsWith('/contentUserData/') || url.pathname === '/finishedData') {
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ success: true }));
      }
      if (pages.has(url.pathname)) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.end(pages.get(url.pathname));
      }
      if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
      const isCore = url.pathname.startsWith('/core/');
      const base = isCore ? core : root;
      const relative = decodeURIComponent(isCore ? url.pathname.slice(6) : url.pathname.slice(1));
      const filename = path.resolve(base, relative);
      if (!filename.startsWith(base + path.sep)) throw new Error('Outside test root');
      const bytes = await fs.readFile(filename);
      res.setHeader('Content-Type', mime.lookup(filename) || 'application/octet-stream');
      res.end(bytes);
    } catch { res.writeHead(404); res.end(); }
  });
  try {
    const names = (await fs.readdir(packages)).filter(n => n.endsWith('.h5p'));
    if (!names.length) throw new Error('No H5P packages to test');
    for (const [index, name] of names.entries()) {
      const folder = path.join(root, `activity-${index}`);
      await fs.mkdir(folder);
      await PackageImporter.extractPackage(path.join(packages, name), folder,
        { includeLibraries: true, includeContent: true, includeMetadata: true });
      const metadata = JSON.parse(await fs.readFile(path.join(folder, 'h5p.json')));
      const params = JSON.parse(await fs.readFile(path.join(folder, 'content/content.json')));
      contentParams.push(params);
      const config = new H5PConfig(undefined, { baseUrl: '', coreUrl: '/core',
        librariesUrl: `/activity-${index}`, contentUserStateSaveInterval: false });
      // H5PConfig's constructor ignores defaults whose initial value is undefined.
      config.contentFilesUrlPlayerOverride = `/activity-${index}/content`;
      const player = new H5PPlayer(new stores.FileLibraryStorage(folder),
        new stores.FileContentStorage(path.join(root, `store-${index}`)), config,
        { urlLibraries: `/activity-${index}` });
      const html = await player.render('1', user, 'en', { metadataOverride: metadata, parametersOverride: params });
      pages.set(`/play-${index}`, html);
    }
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const channel=process.env.H5P_MCP_BROWSER_CHANNEL || 'chrome';
    browser = await chromium.launch({ ...(channel==='chromium'?{}:{channel}), headless: true });
    for (const [index, name] of names.entries()) {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
      page.on('response', response => { if (response.status() >= 400) { errors.push(`${response.status()} ${response.url()}`); console.error(errors.at(-1)); } });
      await page.goto(`http://127.0.0.1:${server.address().port}/play-${index}`);
      await page.waitForFunction(() => window.H5P?.instances?.length > 0);
      const frame = page.frames().find(f => f !== page.mainFrame()) || page.mainFrame();
      await frame.locator('.h5p-content').waitFor({ state: 'visible' });
      const mediaCount=await frame.evaluate(async()=>{
          // H5P.Audio's minimal player keeps its audio element outside the DOM.
          const elements=new Set([...document.querySelectorAll('audio,video'),
            ...(window.H5P?.instances || []).map(instance=>instance.audio).filter(value=>value instanceof HTMLMediaElement)]);
          for(const media of elements) {
            media.muted=true;
            await Promise.race([media.play(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Media decode/play timeout')),5000))]);
            if(media.error || !Number.isFinite(media.duration) || media.duration<=0) throw new Error('Invalid decoded media');
            media.pause();
          }
          return elements.size;
        });
      if(JSON.stringify(contentParams[index]).match(/"mime":"(?:audio|video)\//) && !mediaCount)
        throw new Error(`${name}: expected media was not decoded`);
      const start = frame.getByRole('button', { name: /^(Start|Comenzar)/ });
      if (contentParams[index].introPage?.showIntroPage) await start.first().click();
      if (mathMode) {
        const questions = contentParams[index].questions;
        if (!questions?.length) throw new Error('Math smoke expects a QuestionSet');
        let renderedQuestions = 0;
        for (let i = 0; i < questions.length; i++) {
          const parameters = questions[i].params;
          const check = frame.getByRole('button').filter({ hasText: /^(Comprobar|Check)$/ });
          await check.waitFor({ state: 'visible' });
          const prompt = parameters.question || parameters.taskDescription || parameters.text;
          if (containsLatex(prompt)) await frame.locator('mjx-container:visible, .MathJax:visible').first().waitFor();
          const inputs = frame.locator('input[type="text"]:visible');
          for (let j = 0; j < await inputs.count(); j++) await inputs.nth(j).fill('999');
          const choice = frame.locator('[role="radio"]:visible, [role="option"]:visible').first();
          if (await choice.count()) await choice.click();
          await check.click();
          if (containsLatex(parameters)) {
            await frame.locator('mjx-container:visible, .MathJax:visible').first().waitFor();
            // Wait for newly revealed feedback, not just an already rendered prompt.
            const feedback = frame.locator('.h5p-question-feedback:visible');
            if (containsLatex(parameters.overallFeedback || parameters.behaviour?.feedbackOnWrong)) {
              await feedback.locator('mjx-container, .MathJax').first().waitFor({ state: 'visible' });
            }
            renderedQuestions++;
          }
          if (await frame.locator('mjx-merror:visible, [data-mjx-error]:visible, .MathJax_Error:visible').count()) throw new Error(`Math syntax error in question ${i + 1}`);
          console.log(JSON.stringify({ question: i + 1, math: containsLatex(parameters) }));
          if (i === 11 && process.env.H5P_MCP_MATH_SCREENSHOT) await page.screenshot({ path: process.env.H5P_MCP_MATH_SCREENSHOT, fullPage: true });
          await page.evaluate(() => H5P.instances[0].moveQuestion(1));
        }
        if (!renderedQuestions) throw new Error('No math questions tested');
        if (errors.length) throw new Error(errors.join('; '));
        console.log(JSON.stringify({ name, renderedQuestions, errors }));
        await page.close();
        continue;
      }
      if (process.env.H5P_MCP_GRADING_SMOKE === '1') {
        // Fixture contract: True is correct; exercise both feedback branches.
        const choose = async label => {
          await frame.locator('.h5p-true-false-answer').filter({hasText:new RegExp('^'+label)}).click();
          await frame.getByRole('button').filter({hasText:/^Check$/}).click();
        };
        const score = () => page.evaluate(()=>({score:H5P.instances[0].getScore(),max:H5P.instances[0].getMaxScore(),answered:H5P.instances[0].getAnswerGiven()}));
        await choose('False');
        let result = await score();
        if(result.score !== 0 || result.max !== 1 || !result.answered) throw new Error('Incorrect-answer grading failed');
        if(containsLatex(contentParams[index])) await frame.locator('.h5p-question-feedback mjx-container').waitFor();
        await frame.getByRole('button').filter({hasText:/^Retry$/}).click();
        await choose('True');
        result = await score();
        if(result.score !== 1 || result.max !== 1 || !result.answered) throw new Error('Retry/correct-answer grading failed');
        if(containsLatex(contentParams[index])) await frame.locator('.h5p-question-feedback mjx-container').waitFor();
        if(errors.length) throw new Error(errors.join('; '));
        console.log(JSON.stringify({name,wrong:0,correct:1,maximum:1,retry:true,answered:true,errors}));
        await page.close();
        continue;
      }
      const panel = frame.locator('.h5p-panel-button').first();
      if (await panel.count()) {
        await panel.click();
        if (await panel.getAttribute('aria-expanded') !== 'true') throw new Error(`${name}: panel did not expand`);
        await frame.locator('.h5p-panel-content p').first().waitFor({ state: 'visible' });
      }
      const controls = await frame.locator('button, input, [role="button"], [role="radio"], [role="checkbox"]').count();
      if (!controls) throw new Error(`${name}: no interactive controls`);
      const answer = frame.locator('input[type="text"]:visible').first();
      if (await answer.count()) await answer.fill('test');
      const option = frame.locator('[role="radio"]:visible, [role="checkbox"]:visible').first();
      if (await option.count()) await option.click();
      const check = frame.locator('.h5p-question-check-answer:visible').first();
      if (await check.count()) await check.click();
      const score = await page.evaluate(() => {
        const activity = H5P.instances[0];
        if (typeof activity.getScore !== 'function') return { graded: false };
        return { graded: true, score: activity.getScore(), maximum: activity.getMaxScore() };
      });
      if (score.graded && (!Number.isFinite(score.score) || !(score.maximum > 0))) throw new Error(`${name}: invalid score`);
      if (errors.length) throw new Error(`${name}: ${errors.join('; ')}`);
      console.log(JSON.stringify({ name, controls, decodedMedia:mediaCount, ...score, errors }));
      await page.close();
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    // Only our own unique temporary directory is removed.
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
