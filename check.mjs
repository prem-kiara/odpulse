import { transform } from 'sucrase';
import { readFileSync } from 'fs';
const src = readFileSync('/sessions/happy-intelligent-faraday/mnt/odpulse/odpulse/src/ReportsAnalytics.jsx', 'utf8');
try {
  transform(src, { transforms: ['jsx'], production: true });
  console.log('PARSE OK');
} catch (e) {
  console.log('PARSE ERROR:');
  console.log(e.message);
}
