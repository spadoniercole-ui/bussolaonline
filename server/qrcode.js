import { qrcode_generator_default } from './vendor/qrcode-generator.mjs';

function qrSvg(text, { cellSize = 5, margin = 2, ecc = "M" } = {}) {
  const qr = qrcode_generator_default(0, ecc);
  qr.addData(String(text || ""));
  qr.make();
  return qr.createSvgTag({ cellSize, margin, scalable: true });
}

export { qrSvg };
