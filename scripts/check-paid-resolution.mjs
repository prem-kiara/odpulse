#!/usr/bin/env node
/**
 * check-paid-resolution.mjs
 *
 * Guards the one helper that decides what an entry recovered.
 *
 * On 2026-10-19 every amount column in Individual OD Records and Group OD
 * Records read Rs. 0. The money was never lost — it was in `paidAmount`, and
 * three of the four copies of this helper fell back from `totalPaidAmount`
 * straight to `customerShare`, never consulting `paidAmount` at all. The fourth
 * copy had it right, which is why the Dashboard disagreed with the tables.
 *
 * Measured against live data at the time: Rs. 11.76 lakh hidden across 408
 * entries — in the cells, the Total Recovered tile, the CSV export, and every
 * per-branch and per-staff figure in Reports & Analytics.
 *
 * The fixtures below are the field shapes that actually occur in production, so
 * a regression is caught here rather than in a recovery report.
 *
 * Run: node scripts/check-paid-resolution.mjs
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'src', 'App.jsx'), 'utf8');

// Lift the real helper out of the real file — never a copy that can drift.
const m = /const paidOf = \(e\) =>\s*([\s\S]*?);\n/.exec(src);
if (!m) {
  console.error('FAIL: paidOf not found in src/App.jsx — did it move or get renamed?');
  process.exit(1);
}
const paidOf = new Function('e', 'return ' + m[1].trim());

let pass = 0, fail = 0;
const ok = (name, got, want) => {
  if (got === want) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name} -> got ${got}, want ${want}`); }
};

console.log('\nWhat an entry recovered');

// The shapes that exist in the live file.
ok('current entry (totalPaidAmount)',        paidOf({ totalPaidAmount: 5000, paidAmount: 5000 }), 5000);
ok('audit-replayed entry (paidAmount only)', paidOf({ paidAmount: 2500 }), 2500);
ok('group entry (groupOdPaidAmount)',        paidOf({ groupOdPaidAmount: 1800 }), 1800);
ok('legacy entry (customerShare)',           paidOf({ customerShare: 1200 }), 1200);

// The regression itself: totalPaidAmount absent, paidAmount present. This is
// the case that showed Rs. 0 for 408 entries.
ok('REGRESSION: no totalPaidAmount, real paidAmount', paidOf({ paidAmount: 7300, customerShare: undefined }), 7300);
ok('REGRESSION: group row, no totalPaidAmount',       paidOf({ paidAmount: 950, odType: 'Group OD' }), 950);

// Precedence — most specific wins, and we never silently prefer a stale field.
ok('totalPaidAmount beats paidAmount',   paidOf({ totalPaidAmount: 100, paidAmount: 999 }), 100);
ok('paidAmount beats groupOdPaidAmount', paidOf({ paidAmount: 100, groupOdPaidAmount: 999 }), 100);
ok('groupOdPaidAmount beats customerShare', paidOf({ groupOdPaidAmount: 100, customerShare: 999 }), 100);

// A genuine zero is a real value. `||` here instead of `??` would skip past it
// to whatever the next field held — reporting money that was never collected.
ok('a real zero stays zero, not the next field', paidOf({ totalPaidAmount: 0, paidAmount: 4000 }), 0);
ok('zero paidAmount stays zero',                 paidOf({ paidAmount: 0, customerShare: 6000 }), 0);

// null is "not recorded" and must fall through — live group rows carry
// paidAmount: null alongside a real totalPaidAmount.
ok('null falls through to the next field', paidOf({ totalPaidAmount: null, paidAmount: 3000 }), 3000);
ok('null paidAmount falls through',        paidOf({ paidAmount: null, groupOdPaidAmount: 450 }), 450);

// Never throws, never NaN — this feeds sums across thousands of rows.
ok('no money fields at all -> 0', paidOf({ customerName: 'x' }), 0);
ok('empty object -> 0',           paidOf({}), 0);
ok('null entry -> 0',             paidOf(null), 0);
ok('undefined entry -> 0',        paidOf(undefined), 0);
ok('garbage string -> 0',         paidOf({ totalPaidAmount: 'abc' }), 0);
ok('numeric string is read',      paidOf({ paidAmount: '1500' }), 1500);

// Summing must not produce NaN even with a bad row in the middle.
const mixed = [{ paidAmount: 100 }, { totalPaidAmount: 'x' }, null, { customerShare: 50 }];
ok('a bad row cannot poison a total', mixed.reduce((s, e) => s + paidOf(e), 0), 150);

// There must be exactly ONE definition. Four copies, three wrong, is what
// caused this — a new local copy would reintroduce it silently.
const copies = (src.match(/totalPaidAmount !== undefined \? e\.totalPaidAmount : \(Number\(e\.customerShare\)/g) || []).length;
ok('no broken local copies remain', copies, 0);

// ── odDueOf: which field holds the OD amount this entry was raised for ──────
//
// The records table rendered `groupOdAmount` for BOTH tables, so all 1042
// Individual OD rows showed Rs. 0 — that field does not exist on them, while
// `amountDue` held the real figure on 928. The CSV export had it right, which
// is why a download disagreed with the screen it came from.
const m2 = /const odDueOf = \(e\) =>\s*([\s\S]*?);\n/.exec(src);
if (!m2) { console.error('FAIL: odDueOf not found in src/App.jsx'); process.exit(1); }
const odDueOf = new Function('e', 'return ' + m2[1].trim());

console.log('\nWhat the entry was raised for');
ok('individual reads amountDue',            odDueOf({ odType: 'Individual OD', amountDue: 4500 }), 4500);
ok('REGRESSION: individual ignores absent groupOdAmount',
   odDueOf({ odType: 'Individual OD', amountDue: 7000, groupOdAmount: undefined }), 7000);
ok('individual never borrows groupOdAmount',
   odDueOf({ odType: 'Individual OD', amountDue: 500, groupOdAmount: 99999 }), 500);
ok('group reads groupOdAmount',             odDueOf({ odType: 'Group OD', groupOdAmount: 60000 }), 60000);
ok('group falls back to amountDue',         odDueOf({ odType: 'Group OD', amountDue: 2000 }), 2000);
ok('group prefers groupOdAmount over amountDue',
   odDueOf({ odType: 'Group OD', groupOdAmount: 100, amountDue: 999 }), 100);
ok('a real zero stays zero',                odDueOf({ odType: 'Group OD', groupOdAmount: 0, amountDue: 5000 }), 0);
ok('no fields -> 0',                        odDueOf({ odType: 'Individual OD' }), 0);
ok('null entry -> 0',                       odDueOf(null), 0);
ok('garbage -> 0',                          odDueOf({ odType: 'Individual OD', amountDue: 'abc' }), 0);
ok('the table cell uses it, not the raw field',
   /formatINR\(odDueOf\(e\)\)/.test(src) && !/formatINR\(e\.groupOdAmount\)}<\/td>/.test(src), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
