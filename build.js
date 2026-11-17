// Bundles src/ into main.js. `npm run build` builds once, `npm run dev` rebuilds on every change.
const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

const options = {
  entryPoints: ['src/main.js'],
  outfile: 'main.js',
  bundle: true,
  format: 'cjs',
  target: 'es2018',
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*'],
  sourcemap: watch ? 'inline' : false,
  logLevel: 'info',
};

if (watch) {
  esbuild.context(options).then(ctx => ctx.watch());
} else {
  esbuild.build(options).catch(() => process.exit(1));
}
