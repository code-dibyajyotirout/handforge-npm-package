const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const SRC_CSS = path.join(ROOT_DIR, 'src', 'styles', 'style.css');
const DIST_CSS = path.join(DIST_DIR, 'style.css');
const TSC_BIN = path.join(ROOT_DIR, 'node_modules', 'typescript', 'bin', 'tsc');

console.log('Building HandForge library...');

// 1. Clean dist directory
if (fs.existsSync(DIST_DIR)) {
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
}
fs.mkdirSync(DIST_DIR, { recursive: true });

// 2. Compile TypeScript declarations and ES modules
try {
  console.log('Compiling TypeScript declarations and ES modules...');
  execSync(`node "${TSC_BIN}" -p tsconfig.build.json`, { cwd: ROOT_DIR, stdio: 'inherit' });
} catch (err) {
  console.error('TypeScript compilation failed:', err);
  process.exit(1);
}

// 3. Move ESM files directly into dist root
const esmDir = path.join(DIST_DIR, 'esm');
if (fs.existsSync(esmDir)) {
  function copyDir(src, dest) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        copyDir(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  copyDir(esmDir, DIST_DIR);
  fs.rmSync(esmDir, { recursive: true, force: true });
}

// 4. Resolve relative ESM imports to include explicit .js extensions
function fixEsmImports(dir) {
  const files = fs.readdirSync(dir, { withFileTypes: true });
  for (const f of files) {
    const fullPath = path.join(dir, f.name);
    if (f.isDirectory()) {
      fixEsmImports(fullPath);
    } else if (f.name.endsWith('.js') || f.name.endsWith('.d.ts')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      
      content = content.replace(/(from\s+['"])(\.[^'"]+)(['"])/g, (match, prefix, relPath, suffix) => {
        if (relPath.endsWith('.js') || relPath.endsWith('.json') || relPath.endsWith('.css')) return match;
        const targetPath = path.resolve(dir, relPath);
        if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
          return `${prefix}${relPath}/index.js${suffix}`;
        }
        return `${prefix}${relPath}.js${suffix}`;
      });

      content = content.replace(/(export\s+\*\s+from\s+['"])(\.[^'"]+)(['"])/g, (match, prefix, relPath, suffix) => {
        if (relPath.endsWith('.js') || relPath.endsWith('.json') || relPath.endsWith('.css')) return match;
        const targetPath = path.resolve(dir, relPath);
        if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
          return `${prefix}${relPath}/index.js${suffix}`;
        }
        return `${prefix}${relPath}.js${suffix}`;
      });

      content = content.replace(/(export\s+\{[^}]+\}\s+from\s+['"])(\.[^'"]+)(['"])/g, (match, prefix, relPath, suffix) => {
        if (relPath.endsWith('.js') || relPath.endsWith('.json') || relPath.endsWith('.css')) return match;
        const targetPath = path.resolve(dir, relPath);
        if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
          return `${prefix}${relPath}/index.js${suffix}`;
        }
        return `${prefix}${relPath}.js${suffix}`;
      });

      fs.writeFileSync(fullPath, content, 'utf8');
    }
  }
}

fixEsmImports(DIST_DIR);

// 5. Copy style.css to dist/style.css
if (fs.existsSync(SRC_CSS)) {
  fs.copyFileSync(SRC_CSS, DIST_CSS);
  console.log('Copied style.css to dist/style.css');
}

// 6. Write dist/package.json to declare ESM format
fs.writeFileSync(path.join(DIST_DIR, 'package.json'), JSON.stringify({ type: 'module' }, null, 2));

// 7. Create .mjs aliases for compatibility with dual ESM bundlers
function createMjsAliases(dir) {
  const files = fs.readdirSync(dir, { withFileTypes: true });
  for (const f of files) {
    const fullPath = path.join(dir, f.name);
    if (f.isDirectory()) {
      createMjsAliases(fullPath);
    } else if (f.name.endsWith('.js') && !f.name.endsWith('.map') && f.name !== 'package.json') {
      const mjsPath = fullPath.replace(/\.js$/, '.mjs');
      let content = fs.readFileSync(fullPath, 'utf8');
      content = content.replace(/\.js(['"])/g, '.mjs$1');
      fs.writeFileSync(mjsPath, content, 'utf8');
    }
  }
}

createMjsAliases(DIST_DIR);
console.log('HandForge library build complete with ESM (.js/.mjs) and TypeScript declarations.');

