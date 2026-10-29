/* Run against the actual reviewed public site before allowing publication. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(process.argv[2] || 'site');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public-manifest.json'), 'utf8'));
const active = name => {
  const relative = manifest.active_assets && manifest.active_assets['static/' + name];
  assert.ok(typeof relative === 'string' && /^static\/v\/[0-9a-f]{64}\/[a-z0-9-]+\.js$/.test(relative), `missing active resource ${name}`);
  return path.join(root, relative);
};
const model = require(active('temporal-state.js'));
globalThis.RadarTemporalState = model;
const engine = require(active('decision-engine.js'));
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(active('decision-catalog.js'), 'utf8'), context);
const competitions = context.window.RadarDecisionCatalog.competitions;
const event = id => {
  const found = competitions.find(item => String(item.id) === id);
  assert.ok(found, `missing reviewed event ${id}`);
  return found;
};
const at = text => Date.parse(text);

const software = event('software-testing-11-2026');
const window = software.admitted_public_participation.registration_windows[0];
assert.equal(window.closes, '2026-10-30T20:00');
assert.equal(model.evaluateWindow(window, at('2026-10-30T20:00:00Z')).state, 'boundary');
assert.equal(model.evaluateCompetition(software, at('2026-11-01T12:00:00Z')).registration, 'closed');
assert.equal(model.evaluateWindow(window, at('2026-10-29T12:00:00Z'), {conflict: true}).state, 'conflict');
const track = {track_scope:'A', stage:'registration'};
const conflicting = {admitted_public_participation:{registration_windows:[
  {closes:'2026-10-30', precision:'date', timezone:'UNKNOWN', scope:track},
  {closes:'2026-11-30', precision:'date', timezone:'UNKNOWN', scope:track}
]}};
assert.equal(model.evaluateCompetition(conflicting, at('2026-11-01T12:00:00Z'), {track:'A'}).state, 'conflict');
assert.equal(model.evaluateWindow({closes:'2026-11-06', precision:'date', timezone:'UNKNOWN'}, at('2026-11-06T20:00:00Z')).state, 'boundary');
assert.equal(model.evaluateWindow({closes:'2026-11-06', precision:'date', timezone:'UNKNOWN'}, at('2026-11-08T00:00:00Z')).state, 'ended');

const cacc = event('cacc-3-2026');
assert.equal(model.evaluateCompetition(cacc, at('2026-11-18T09:00:00Z')).state, 'boundary');
assert.equal(model.evaluateCompetition(cacc, at('2026-11-19T12:00:00Z')).state, 'ended');

const ncccu = model.evaluateCompetition(event('ncccu-8-2026'), at('2026-11-08T00:00:00Z'));
assert.equal(ncccu.windows.find(row => row.window.scope.track_scope.includes('大数据')).state, 'ended');
assert.notEqual(ncccu.windows.find(row => row.window.scope.track_scope.includes('人工智能')).state, 'ended');
const huawei = model.evaluateCompetition(event('huawei-ict-11-2026-27'), at('2026-11-01T12:00:00Z'));
assert.equal(huawei.windows.find(row => row.window.scope.track_scope.includes('算子')).state, 'ended');
assert.notEqual(huawei.windows.find(row => row.window.scope.track_scope.includes('创新')).state, 'ended');
assert.equal(model.evaluateCompetition({important_dates:[{kind:'submission_deadline', date:'2026-11-06'}]}, at('2026-11-08T00:00:00Z')).registration, 'unknown');

// The 14:00 date in G6 1 is scoped to a university notice. Without an
// institution selection it cannot establish a national registration window.
for (const date of ['2026-11-01T12:00:00Z', '2026-12-20T12:00:00Z']) {
  assert.equal(model.evaluateCompetition(event('1'), at(date)).state, 'unknown');
  assert.equal(model.evaluateCompetition(event('1'), at(date)).registration, 'unknown');
}

Date.now = () => at('2026-11-01T12:00:00Z');
const profile = {goals:['software'], directions:[], skills:[], languages:[], technologies:[], qualifications:{}, weekly_hours:6};
const recommended = engine.recommend([software], profile).items[0];
assert.equal(recommended.registration_status, 'closed');
assert.ok(!['priority', 'research'].includes(recommended.bucket));
const compared = engine.compare([software, cacc], [software.id, cacc.id], 'software', profile);
assert.equal(compared.items.find(item => item.id === software.id).time.temporal.registration, 'closed');
const plan = engine.buildPlan([software], [software.id], software.id, profile).plans[0];
assert.equal(plan.time.temporal.registration, 'closed');
assert.match(plan.steps[0].title, /已报名者/);
console.log('PASS published deadline, timezone, scope, conflict, recommendation, comparison and plan checks');
