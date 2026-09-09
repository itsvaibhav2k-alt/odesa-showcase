import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';

const source = process.env.NIGHT_GARDEN_SOURCE;
if (!source) {
  throw new Error(
    'Set NIGHT_GARDEN_SOURCE to the accepted homepage art direction directory before regenerating.',
  );
}
const concept = path.join(source, 'concepts/night-garden-site');
const repo = process.cwd();
const componentDir = path.join(repo, 'src/components/marketing/night-garden');
const publicDir = path.join(repo, 'public/night-garden');
fs.mkdirSync(componentDir, { recursive: true });
fs.mkdirSync(path.join(publicDir, 'art'), { recursive: true });
fs.mkdirSync(path.join(publicDir, 'product-screens'), { recursive: true });
fs.mkdirSync(path.join(publicDir, 'fonts'), { recursive: true });

const pageNames = ['index', 'work', 'method', 'demo', 'owners', 'pilot'];
const routeMap = {
  'index.html': '/',
  'work.html': '/work',
  'method.html': '/method',
  'demo.html': '/demo',
  'owners.html': '/owners',
  'pilot.html': '/pilot',
};

function productionize(html) {
  html = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/\s+onsubmit="[^"]*"/gi, '')
    .replaceAll('../../product-screens/', '/night-garden/product-screens/')
    .replaceAll('href="#">Sign in</a>', 'href="/login">Sign in</a>')
    .replaceAll('Concept form · no data is sent', 'Secure request · no card required')
    .replace(
      "Thanks. There's nothing to submit in this concept. In the live pilot this starts intake: we reply, connect your number and rent records, and Odesa begins in review mode with your rules first.",
      'Thanks. Your request was received. We will follow up to begin intake with your rules first.'
    )
    .replaceAll("Monet's water lilies appear as temporary, public domain art direction evidence.", 'A calmer way to run the night.')
    .replace(/<div class="hero__edge-note">[\s\S]*?<\/div>/, '')
    .replace('Watching now', 'Illustrative portfolio')
    .replace('28 units · 4 properties', '28 sample units · 4 sample properties')
    .replace('Here they are in the product, populated and running.', 'Here they are in the product, shown with a seeded sample portfolio.');

  for (const [file, route] of Object.entries(routeMap)) {
    html = html.replaceAll(`href="${file}#`, `href="${route}#`);
    html = html.replaceAll(`href="${file}"`, `href="${route}"`);
  }
  return html;
}

const records = [];
for (const name of pageNames) {
  const document = fs.readFileSync(path.join(concept, `${name}.html`), 'utf8');
  const body = document.match(/<body class="([^"]+)">([\s\S]*?)<\/body>/i);
  if (!body) throw new Error(`Could not extract ${name}.html`);
  const pageClass = body[1];
  let html = productionize(body[2].trim());
  html = html.replaceAll('`', '\\`').replaceAll('${', '\\${');
  records.push(`  ${name}: { pageClass: ${JSON.stringify(pageClass)}, html: \`${html}\` },`);
}

const content = `export type NightGardenPageKey = ${pageNames.map((name) => `'${name}'`).join(' | ')};\n\nexport const NIGHT_GARDEN_PAGES: Record<NightGardenPageKey, { pageClass: string; html: string }> = {\n${records.join('\n')}\n};\n`;
fs.writeFileSync(path.join(componentDir, 'content.ts'), content);

const cssSource = fs.readFileSync(path.join(concept, 'site.css'), 'utf8')
  .replaceAll("url('assets/fonts/instrument-serif-italic-latin.woff2')", "url('/night-garden/fonts/instrument-serif-italic-latin.woff2')")
  .replaceAll('url("assets/fonts/instrument-serif-italic-latin.woff2")', 'url("/night-garden/fonts/instrument-serif-italic-latin.woff2")')
  .replaceAll("url('../../art/", "url('/night-garden/art/");
const root = postcss.parse(cssSource);
root.walkRules((rule) => {
  let parent = rule.parent;
  while (parent) {
    if (parent.type === 'atrule' && /keyframes$/i.test(parent.name)) return;
    parent = parent.parent;
  }
  rule.selectors = rule.selectors.map((raw) => {
    const selector = raw.trim();
    if (selector.startsWith(':root')) return selector.replace(':root', '.ng-site');
    if (selector.startsWith('body')) return selector.replace(/^body/, '.ng-site');
    if (selector.startsWith('html')) return selector.replace(/^html/, '.ng-site');
    if (selector.startsWith('.motion-ready')) return selector.replace(/^\.motion-ready/, '.ng-site.motion-ready');
    if (/^\.(?:page-home|page-work|page-method|page-demo|page-owners|page-pilot)(?=[\s.:#>+~]|$)/.test(selector)) return `.ng-site${selector}`;
    return `.ng-site ${selector}`;
  });
});
root.prepend(postcss.parse('.ng-site { min-height: 100vh; overflow-x: clip; }'));
root.append(postcss.parse('.ng-site .access__sent.is-visible { display: block; } .ng-site .access__sent[data-state="error"] { border-color: var(--rose); background: #f5e5df; color: #713b35; }'));
fs.writeFileSync(path.join(componentDir, 'night-garden.css'), root.toString());

const assets = {
  art: [
    'monet-water-lilies-1915-26.jpg',
    'monet-seerosen.jpg',
    'monet-met-water-lilies.jpg',
    'monet-contact-sheet.jpg',
    'monet-detail-1914-17.jpg',
  ],
  'product-screens': ['calls-detail.png', 'owner-queue.png', 'rent.png', 'work-order.png'],
};
for (const [folder, files] of Object.entries(assets)) {
  for (const file of files) {
    fs.copyFileSync(path.join(source, folder, file), path.join(publicDir, folder, file));
  }
}
fs.copyFileSync(
  path.join(concept, 'assets/fonts/instrument-serif-italic-latin.woff2'),
  path.join(publicDir, 'fonts/instrument-serif-italic-latin.woff2')
);
console.log(`Generated ${records.length} production page records, scoped CSS, and assets.`);
