/*
 * Protección de privacidad para textos públicos.
 *
 * Detector conservador de direcciones postales evidentes.
 * No sustituye una validación integral de privacidad.
 */

const word = '[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]+';

const englishStreet =
  '(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|' +
  'Drive|Dr|Lane|Ln|Court|Ct|Place|Pl|Parkway|Pkwy)';

const spanishStreet =
  '(?:Calle|Avenida|Av|Bulevar|Camino|Carretera|Cerrada)';

const usPattern = new RegExp(
  '\\b\\d{1,6}\\s+' +
  '(?:[NSEW]\\. ?\\s+)?'.replace(' ', '') +
  '(?:' + word + '\\s+){1,4}' +
  englishStreet + '\\.?(?![A-Za-z])',
  'i'
);

const mxPattern = new RegExp(
  '\\b' + spanishStreet + '\\s+' +
  '(?:' + word + '\\s+){1,5}' +
  '(?:número\\s+|num\\.?\\s+|no\\.?\\s+|#\\s*)?' +
  '\\d{1,6}\\b',
  'i'
);

export function containsLikelyStreetAddress(
  value: unknown
): boolean {
  if (typeof value !== 'string') {
    return false;
  }

  return usPattern.test(value) || mxPattern.test(value);
}
