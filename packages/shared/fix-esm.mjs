import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

function fixFile(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  let changed = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const importMatch = line.match(/import\s+.*from\s+['"]([^'"]+)['"]/);
    if (importMatch) {
      const fromPath = importMatch[1];
      if (fromPath.startsWith('.') && !fromPath.endsWith('.js') && !fromPath.endsWith('.json')) {
        const newLine = line.replace(`from '${fromPath}'`, `from '${fromPath}.js'`).replace(`from "${fromPath}"`, `from "${fromPath}.js"`);
        if (newLine !== line) {
          lines[i] = newLine;
          changed = true;
        }
      }
    }
  }
  
  if (changed) {
    writeFileSync(filePath, lines.join('\n'));
    console.log(`Fixed: ${filePath}`);
  }
}

function fixDir(dir) {
  const files = readdirSync(dir, { withFileTypes: true });
  for (const file of files) {
    const fullPath = join(dir, file.name);
    if (file.isDirectory()) {
      fixDir(fullPath);
    } else if (file.name.endsWith('.js')) {
      fixFile(fullPath);
    }
  }
}

fixDir('./dist/esm');
console.log('Done!');
