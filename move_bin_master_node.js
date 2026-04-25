const fs = require('fs');

let text = fs.readFileSync('backend/public/admin.html', 'utf-8');

const startMarker = '<!-- BinMaster Upload Card -->';
const endMarker = '<!-- Bin Content Upload Card -->';

const idxStart = text.indexOf(startMarker);
const idxEnd = text.indexOf(endMarker);

if (idxStart === -1 || idxEnd === -1) {
  console.log('Could not find markers for binMasterUploadBlock');
  process.exit(1);
}

const blockToMove = text.substring(idxStart, idxEnd).trim();

// Remove block
text = text.substring(0, idxStart) + text.substring(idxEnd);

// Find tmplSectionBins
const tmplStartMarker = '<div id="tmplSectionBins" style="display:none">';
const tmplIdxStart = text.indexOf(tmplStartMarker);

if (tmplIdxStart === -1) {
  console.log('Could not find tmplSectionBins start marker');
  process.exit(1);
}

// Find the end marker after the start marker
const suffixStart = text.indexOf('<div style="text-align: center; padding: 16px">', tmplIdxStart);

// Walk back to find the closest </div></div> structure before the suffixStart
let sliceBeforeSuffix = text.substring(tmplIdxStart, suffixStart);

// We know tmplSectionBins ends right before <div style="text-align: center; padding: 16px">, exactly where the #pageTemplate wrapper ends.
// Let's replace the whole slice.

// The slice is currently from '<div id="tmplSectionBins"' up to (but not including) '<div style="text-align: center'
// Let's replace everything after '<div id="tmplSectionBins"' up to suffixStart, but preserving the outer div logic.
// wait, tmplSectionBins closes itself, then #pageTemplate closes itself.
// so right before '<div style="text-align: center; padding: 16px">' is:
//       </div> <!-- close tmplSectionBins -->
//     </div> <!-- close pageTemplate -->

const lastDivIndex = sliceBeforeSuffix.lastIndexOf('</div>');
const secondLastDivIndex = sliceBeforeSuffix.lastIndexOf('</div>', lastDivIndex - 1);

// We replace between tmplIdxStart + tmplStartMarker.length and secondLastDivIndex
const newContent = '\n          <div style="max-width: 800px; margin: 0 auto;">\n' + blockToMove + '\n          </div>\n        ';

text = text.substring(0, tmplIdxStart + tmplStartMarker.length) + newContent + text.substring(tmplIdxStart + secondLastDivIndex);

fs.writeFileSync('backend/public/admin.html', text, 'utf-8');
console.log('Successfully moved node!');
