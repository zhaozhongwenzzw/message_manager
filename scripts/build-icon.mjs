// Generate src/assets/image/icon.ico (multi-size: 16, 24, 32, 48, 64, 128, 256)
// from icon.png. NSIS rejects single-frame ICOs larger than 256×256.
// Run with: node scripts/build-icon.mjs
import pngToIco from 'png-to-ico';
import sharp from 'sharp';
import { promises as fs } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = resolve(__dirname, '../src/assets/image/icon.png');
const dest = resolve(__dirname, '../src/assets/image/icon.ico');

const sizes = [16, 24, 32, 48, 64, 128, 256];
const buffers = await Promise.all(
  sizes.map((s) =>
    sharp(src)
      .resize(s, s, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toBuffer()
  )
);

const ico = await pngToIco(buffers);
await fs.writeFile(dest, ico);
console.log(`wrote ${dest} (${ico.length.toLocaleString()} bytes, sizes: ${sizes.join(',')})`);
