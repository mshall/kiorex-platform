import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/** GRW-GC-4: the static SAST grep of the growth folders runs as a test too (and as part of `npm run lint`). The scanner itself is proven on injected samples so a silent regex break cannot pass. */
const script = join(__dirname, '..', '..', '..', 'scripts', 'sast-growth.mjs');
describe('growth SAST grep', () => {
  it('the growth folders (API growth, assistant, channels, widget, public site, ops growth pages, web lib and pages) have no unreviewed sink', () => {
    expect(JSON.parse(execFileSync('node', [script, '--json'], { encoding: 'utf8' }))).toEqual([]);
  });
  it('the scanner flags every sink class, ignores method calls named eval, comments and a reviewed line', async () => {
    const { scanText } = (await import(/* @vite-ignore */ script)) as { scanText: (t: string) => { sink: string }[] };
    const bad = ['<div dangerouslySetInnerHTML={{ __html: x }} />', 'el.innerHTML = x;', 'el.insertAdjacentHTML("beforeend", x)', 'document.write(x)', 'eval(code)', 'new Function("return 1")', "setTimeout('x()', 1)",
      'await prisma.$queryRawUnsafe(`select ${x}`)', 'await prisma.$executeRawUnsafe(q)', "import { exec } from 'child_process'", 'execSync(cmd)', 'res.redirect(req.query.next)'];
    for (const b of bad) expect(scanText(b).length > 0 ? b : `MISSED ${b}`).toBe(b);
    for (const ok of ['const s = r.eval(f, opts);', 'el.textContent = x;', 'const e = evaluate(x);', 'prisma.$queryRaw`select 1`', 'el.innerHTML = x; // sast-ok: static trusted markup']) expect(scanText(ok).length === 0 ? ok : `FALSE POSITIVE ${ok}`).toBe(ok);
  });
});
