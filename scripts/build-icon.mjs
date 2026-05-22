// Generate src/assets/image/icon.ico from icon.png for Windows taskbar quality.
// Run with: node scripts/build-icon.mjs
import pngToIco from 'png-to-ico';
import { promises as fs } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = resolve(__dirname, '../src/assets/image/icon.png');
const dest = resolve(__dirname, '../src/assets/image/icon.ico');

const buf = await pngToIco([src]);
await fs.writeFile(dest, buf);
console.log('wrote', dest, '(', buf.length, 'bytes )');
