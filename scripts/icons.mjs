import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const sharp = require('sharp');
const source = await readFile(new URL('../apps/web/public/icon.svg', import.meta.url));
for (const size of [192, 512])
  await sharp(source)
    .resize(size, size)
    .png()
    .toFile(
      new URL(`../apps/web/public/icon-${size}.png`, import.meta.url).pathname.replace(
        /^\/([A-Za-z]:)/,
        '$1',
      ),
    );
