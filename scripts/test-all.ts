/**
 * Chay toan bo test. Dung: npm test
 * Thoat khac 0 neu bat ky bo nao hong — de cam vao CI sau nay.
 */
import { spawnSync } from 'node:child_process';

const SUITES = [
  ['So co thang (tinh tien)', 'scripts/test-fixed.ts'],
  ['Cua so cuon chieu (bo loc che do)', 'scripts/test-rolling.ts'],
  ['Paper broker (P&L sau phi)', 'scripts/test-broker.ts'],
  ['Doi chieu ATR: TypeScript vs SQL', 'scripts/test-atr-parity.ts'],
] as const;

let failed = 0;
const results: { name: string; ok: boolean; tail: string }[] = [];

for (const [name, file] of SUITES) {
  const r = spawnSync('npx', ['tsx', file], {
    encoding: 'utf8',
    env: { ...process.env, DRY_RUN: '1' },
    shell: process.platform === 'win32',
  });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  const ok = r.status === 0;
  if (!ok) failed += 1;
  const lines = out.trim().split('\n');
  const fails = lines.filter((l) => l.startsWith('FAIL'));
  results.push({
    name,
    ok,
    tail: fails.length > 0 ? fails.join('\n      ') : (lines[lines.length - 1] ?? ''),
  });
}

console.log('\n' + '='.repeat(66));
console.log('  KET QUA TOAN BO TEST');
console.log('='.repeat(66));
for (const r of results) {
  console.log(`  ${r.ok ? '[OK]  ' : '[HONG]'} ${r.name}`);
  if (!r.ok) console.log(`      ${r.tail}`);
}
console.log('='.repeat(66));

if (failed === 0) {
  console.log(`  ${SUITES.length}/${SUITES.length} bo test PASS\n`);
} else {
  console.log(`  ${failed}/${SUITES.length} bo test HONG\n`);
}
process.exit(failed === 0 ? 0 : 1);
