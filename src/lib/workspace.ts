import type { AppState, ChatMessage, ChatThread, GitHubRemote, Project, WorkspaceFile } from '../types';

const STORAGE_KEY = 'codepilot.workspace.v1';
const now = () => new Date().toISOString();
const makeId = () => globalThis.crypto?.randomUUID?.() ?? `cp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export const starterFiles = (): WorkspaceFile[] => [
  {
    path: 'index.html',
    updatedAt: now(),
    content: `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Northstar — Focused work, forward motion</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <main class="page-shell">
    <nav class="nav"><a class="wordmark" href="#top"><span class="wordmark-dot"></span>northstar</a><div class="nav-links"><a href="#approach">Approach</a><a href="#stories">Stories</a></div><button class="nav-cta" data-scroll="stories">Get the field notes <span>↗</span></button></nav>
    <section class="hero" id="top">
      <div class="eyebrow"><span class="eyebrow-line"></span> A quieter way to do ambitious work</div>
      <h1>Make room<br />for your <em>best work.</em></h1>
      <p class="hero-copy">A small set of thoughtful tools for people building something that matters. Clear your next step, protect your focus, and keep moving.</p>
      <div class="hero-actions"><button class="primary-cta" data-scroll="stories">Find your next step <span>↗</span></button><span class="hero-note">Designed for the long game.</span></div>
      <div class="hero-art" aria-hidden="true"><div class="art-orbit orbit-one"></div><div class="art-orbit orbit-two"></div><div class="art-core"><span>n</span></div><div class="art-spark spark-one">✳</div><div class="art-spark spark-two">·</div></div>
      <div class="hero-index"><span>01 — 03</span><span>FIELD NOTES FOR FORWARD MOTION</span></div>
    </section>
    <section class="approach" id="approach"><div class="section-label">A simple practice <span>↘</span></div><div class="approach-grid"><h2>Less noise.<br /><em>More signal.</em></h2><p>Northstar is built around a straightforward idea: your attention is worth protecting. Bring your plans, your pace, and your own definition of progress. We’ll help with the rest.</p></div><div class="principles"><article><span>01</span><h3>Choose with intent</h3><p>Make a little space between what is urgent and what is important.</p></article><article><span>02</span><h3>Build a steady rhythm</h3><p>Small, repeatable progress is a more generous way to get there.</p></article><article><span>03</span><h3>Keep the work yours</h3><p>Useful guidance should make your judgment stronger, not louder.</p></article></div></section>
    <section class="closing" id="stories"><div class="closing-mark">✳</div><p class="section-label">A note for the road</p><h2>Start where<br />you <em>are.</em></h2><p>One good next step is enough to change the shape of a day.</p><button class="primary-cta" data-scroll="top">Back to the beginning <span>↑</span></button></section>
    <footer><a class="wordmark" href="#top"><span class="wordmark-dot"></span>northstar</a><span>Thoughtful tools for forward motion.</span><span>© 2025 Northstar Studio</span></footer>
  </main>
  <script src="app.js"></script>
</body>
</html>`,
  },
  {
    path: 'styles.css',
    updatedAt: now(),
    content: `@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Playfair+Display:ital,wght@0,500;0,600;1,500;1,600&display=swap');
:root{font-family:'DM Sans',sans-serif;color:#e9e8e1;background:#111713;font-synthesis:none;text-rendering:optimizeLegibility}*{box-sizing:border-box}body{margin:0;background:#111713}.page-shell{max-width:1440px;margin:0 auto;padding:0 7.5%;overflow:hidden}.nav{height:84px;display:flex;align-items:center;border-bottom:1px solid #ffffff16;gap:32px}.wordmark{display:inline-flex;align-items:center;gap:10px;color:#eff0e9;text-decoration:none;font-size:15px;font-weight:600;letter-spacing:-.04em}.wordmark-dot{width:9px;height:9px;background:#b6d69a;border-radius:50%;box-shadow:0 0 18px #b6d69a70}.nav-links{display:flex;gap:30px;margin-left:auto}.nav-links a{color:#9ba39a;text-decoration:none;font-size:12px}.nav-links a:hover{color:#fff}.nav-cta,.primary-cta{border:1px solid #55634f;background:transparent;color:#e8ece3;border-radius:3px;padding:12px 16px;font:500 11px 'DM Sans',sans-serif;cursor:pointer}.nav-cta span,.primary-cta span{margin-left:18px;color:#b6d69a}.hero{position:relative;min-height:620px;padding:124px 0 70px}.eyebrow,.section-label{font-size:10px;letter-spacing:.15em;text-transform:uppercase;color:#a1aa9c}.eyebrow-line{display:inline-block;width:23px;height:1px;background:#b6d69a;vertical-align:middle;margin-right:10px}.hero h1,.approach h2,.closing h2{position:relative;z-index:2;margin:28px 0 20px;font-size:clamp(58px,8.5vw,112px);font-weight:500;line-height:.98;letter-spacing:-.075em;color:#f1f0e8}.hero h1 em,.approach h2 em,.closing h2 em{font-family:'Playfair Display',serif;font-weight:500;color:#b6d69a;letter-spacing:-.065em}.hero-copy{position:relative;z-index:2;max-width:390px;font-size:14px;line-height:1.8;color:#9ca59a}.hero-actions{position:relative;z-index:2;display:flex;align-items:center;gap:22px;margin-top:29px}.primary-cta{background:#b6d69a;border-color:#b6d69a;color:#162116;padding:14px 17px}.primary-cta span{color:#20321b}.hero-note{color:#747e75;font-size:10px}.hero-art{position:absolute;right:4%;top:105px;width:355px;height:355px;opacity:.82}.art-orbit{position:absolute;border:1px solid #d9e7d21d;border-radius:50%;inset:0;transform:rotate(-28deg) scaleY(.62)}.orbit-two{inset:31px;transform:rotate(36deg) scaleY(.78);border-color:#d9e7d230}.art-core{position:absolute;left:50%;top:50%;width:118px;height:118px;margin:-59px;border:1px solid #b6d69a50;border-radius:50%;display:grid;place-items:center;background:radial-gradient(circle,#526b4966,#111713 70%);box-shadow:0 0 70px #b6d69a18}.art-core span{font:italic 66px 'Playfair Display',serif;color:#c6dfa9}.art-spark{position:absolute;color:#b6d69a;font-size:27px}.spark-one{top:44px;right:61px}.spark-two{left:31px;bottom:87px;font-size:48px}.hero-index{position:absolute;bottom:35px;left:0;right:0;display:flex;justify-content:space-between;border-top:1px solid #ffffff1a;padding-top:16px;color:#737d73;font-size:9px;letter-spacing:.13em}.approach{padding:91px 0 105px;border-top:1px solid #ffffff13}.section-label span{margin-left:7px;color:#b6d69a}.approach-grid{display:grid;grid-template-columns:1.1fr .9fr;align-items:end;gap:60px;margin-top:38px}.approach h2,.closing h2{font-size:clamp(50px,6vw,78px);margin:0}.approach-grid>p{max-width:400px;margin:0 0 9px;color:#9ca59a;font-size:13px;line-height:1.9}.principles{display:grid;grid-template-columns:repeat(3,1fr);gap:34px;margin-top:72px;border-top:1px solid #ffffff20;padding-top:21px}.principles article>span{color:#b6d69a;font-size:10px}.principles h3{font-size:15px;font-weight:500;margin:26px 0 8px}.principles p{max-width:225px;font-size:12px;color:#8e988d;line-height:1.7;margin:0}.closing{padding:100px 0 112px;text-align:center;border-top:1px solid #ffffff13}.closing-mark{color:#b6d69a;font-size:22px}.closing .section-label{margin-top:20px}.closing h2{margin:28px 0 18px}.closing>p:not(.section-label){color:#9ca59a;font-size:13px}.closing .primary-cta{margin-top:16px}footer{display:flex;align-items:center;justify-content:space-between;min-height:77px;border-top:1px solid #ffffff17;color:#778176;font-size:10px}footer .wordmark{font-size:12px}footer .wordmark-dot{width:7px;height:7px}@media(max-width:800px){.page-shell{padding:0 6%}.hero{min-height:650px;padding-top:100px}.hero-art{width:250px;height:250px;right:-10%;top:315px;opacity:.52}.hero h1{font-size:clamp(60px,13vw,92px)}.hero-copy{max-width:350px}.approach-grid{grid-template-columns:1fr;gap:20px}.principles{gap:19px}.principles h3{font-size:13px}footer{gap:15px;flex-wrap:wrap;padding:18px 0}}@media(max-width:520px){.nav{height:68px}.nav-links{display:none}.nav-cta{font-size:10px;padding:10px 11px}.hero{min-height:670px;padding-top:90px}.hero-art{top:385px;right:-12%;width:220px;height:220px}.hero-index{font-size:7px}.principles{grid-template-columns:1fr;gap:21px}.principles article{display:grid;grid-template-columns:28px 1fr;column-gap:6px}.principles article>span{grid-row:span 2}.principles h3{margin:0 0 5px}.principles p{max-width:300px}.closing{padding:78px 0}.closing h2{font-size:60px}footer{display:grid;grid-template-columns:1fr auto}footer>span:nth-child(2){grid-column:1 / -1;grid-row:2}}
`,
  },
  {
    path: 'app.js',
    updatedAt: now(),
    content: `document.querySelectorAll('[data-scroll]').forEach((button) => {
  button.addEventListener('click', () => {
    const section = document.getElementById(button.dataset.scroll);
    section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});
`,
  },
];

function createWelcomeThread(): ChatThread {
  const createdAt = now();
  const messages: ChatMessage[] = [
    {
      id: makeId(),
      role: 'assistant',
      createdAt,
      content: "I’m **Codepilot**. Tell me what you’d like to build, change, or understand. I can work from the files in this browser workspace and help across programming languages.\n\nYour files and chat history are stored in this browser. When you send a prompt, workspace text and any readable text attachments are sent to Manus AI to answer. Use **Preview** for the HTML/CSS/JavaScript this workspace can run, or export the project whenever you like.",
    },
  ];
  return { id: makeId(), title: 'New conversation', updatedAt: createdAt, messages };
}

export function createProject(name = 'Untitled workspace', files = starterFiles(), source?: string, githubRemote?: GitHubRemote): Project {
  const thread = createWelcomeThread();
  return {
    id: makeId(),
    name: name.trim() || 'Untitled workspace',
    updatedAt: now(),
    source,
    githubRemote,
    files,
    threads: [thread],
    activeThreadId: thread.id,
  };
}

export function createThread(): ChatThread {
  const timestamp = now();
  return {
    id: makeId(),
    title: 'New conversation',
    updatedAt: timestamp,
    messages: [{ id: makeId(), role: 'assistant', createdAt: timestamp, content: 'What would you like to work on? I can explain, review, or help build from the files in your current workspace.' }],
  };
}

export function initialState(): AppState {
  const project = createProject('Northstar landing page');
  return {
    projects: [project],
    activeProjectId: project.id,
    settings: { agentMode: 'build', responseStyle: 'balanced', githubAppClientId: '' },
  };
}

export function loadState(): AppState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return initialState();
    const parsed = JSON.parse(saved) as AppState;
    if (!Array.isArray(parsed.projects) || !parsed.projects.length) return initialState();
    const projectExists = parsed.projects.some((project) => project.id === parsed.activeProjectId);
    return {
      projects: parsed.projects,
      activeProjectId: projectExists ? parsed.activeProjectId : parsed.projects[0].id,
      settings: {
        agentMode: parsed.settings?.agentMode ?? 'build',
        responseStyle: parsed.settings?.responseStyle ?? 'balanced',
        githubAppClientId: parsed.settings?.githubAppClientId ?? '',
      },
    };
  } catch {
    return initialState();
  }
}

export function saveState(state: AppState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function newId() {
  return makeId();
}
