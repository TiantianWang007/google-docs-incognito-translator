const path = require('node:path');
const sharp = require('sharp');
const icons = path.resolve(__dirname, '../chrome-translate-ten-tabs/icons');
(async () => {
  for (const size of [16, 32, 48, 128]) {
    await sharp(path.join(icons, 'source.svg')).resize(size, size).png().toFile(path.join(icons, `icon${size}.png`));
  }
  console.log('Generated 4 extension icons.');
})().catch(error => { console.error(error); process.exitCode = 1; });
