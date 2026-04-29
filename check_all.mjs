import { transform } from 'sucrase';
import { readFileSync } from 'fs';
const files = ['src/App.jsx','src/OdInsights.jsx','src/ReportsAnalytics.jsx','src/tableSort.jsx'];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  try {
    transform(src, { transforms: ['jsx'], production: true });
    console.log(f, '-> OK');
  } catch (e) {
    console.log(f, '-> ERROR:', e.message);
  }
}
