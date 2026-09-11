/**
 * Generate a SKU like TENT-A1B2C3
 */
function generateSku(category = 'ITEM') {
  const prefix = String(category)
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 4)
    .toUpperCase() || 'ITEM';
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}-${suffix}`;
}

/**
 * Generate a numeric barcode string (EAN-13 style, not checksum-validated).
 */
function generateBarcode() {
  let code = '2';
  for (let i = 0; i < 11; i++) {
    code += Math.floor(Math.random() * 10);
  }
  return code;
}

module.exports = { generateSku, generateBarcode };
