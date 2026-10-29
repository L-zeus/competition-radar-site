/* Published facts are immutable; these results describe their relation to device time. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RadarTemporalState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;
  const labels = {
    upcoming: '公布的报名截止尚未到，开放状态请核验',
    within: '按已公布资料处于报名时间范围，平台受理请核验',
    boundary: '日期或时区边界不确定，请核验官方信息',
    ended: '按已公布期限已截止，请核验是否调整',
    conflict: '报名日期存在来源冲突，请核验',
    unknown: '报名时间待核验',
    historical: '历史赛事，仅供参考',
    clock_error: '请核对设备日期，再判断报名时间'
  };

  function parts(value, precision) {
    if (typeof value !== 'string') return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/.exec(value);
    if (!m || !['date', 'minute', 'second', 'datetime'].includes(precision)) return null;
    if (precision !== 'date' && m[4] === undefined) return null;
    const p = {y:+m[1], m:+m[2], d:+m[3], h:+(m[4] || 0), min:+(m[5] || 0), s:+(m[6] || 0), offset:m[7]};
    const t = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
    const check = new Date(t);
    if (check.getUTCFullYear() !== p.y || check.getUTCMonth() + 1 !== p.m || check.getUTCDate() !== p.d ||
        p.h > 23 || p.min > 59 || p.s > 59) return null;
    p.wall = t;
    return p;
  }

  // Enumerate valid instants rather than assuming the browser's timezone.
  // This also preserves ambiguity at daylight-saving transitions.
  function zonedInstants(wall, zone) {
    let formatter;
    try {
      formatter = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
        timeZone:zone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit',
        minute:'2-digit', second:'2-digit', hourCycle:'h23'
      });
    } catch (_) { return []; }
    const local = instant => {
      const out = {};
      for (const item of formatter.formatToParts(new Date(instant))) if (item.type !== 'literal') out[item.type] = +item.value;
      return Date.UTC(out.year, out.month - 1, out.day, out.hour, out.minute, out.second);
    };
    const offsets = new Set();
    for (let delta = -48 * HOUR; delta <= 48 * HOUR; delta += 6 * HOUR) {
      const instant = wall + delta;
      offsets.add(local(instant) - instant);
    }
    return [...offsets].map(offset => wall - offset).filter(instant => local(instant) === wall).sort((a,b) => a-b);
  }

  function bounds(value, precision, timezone) {
    const p = parts(value, precision);
    if (!p) return null;
    const duration = precision === 'date' ? DAY : precision === 'minute' ? 60000 : 1000;
    if (p.offset) {
      const point = Date.parse(value.replace(' ', 'T'));
      return Number.isFinite(point) ? {earliest:point, latest:point + duration} : null;
    }
    if (!timezone || String(timezone).toUpperCase() === 'UNKNOWN') {
      return {earliest:p.wall - 14 * HOUR, latest:p.wall + duration + 12 * HOUR};
    }
    const offset = /^(?:UTC|GMT)(?:([+-])(\d{1,2})(?::?(\d{2}))?)?$/i.exec(timezone);
    if (offset) {
      const hours = +(offset[2] || 0), minutes = +(offset[3] || 0);
      if (hours > 14 || minutes > 59 || (hours === 14 && minutes)) return null;
      const delta = (hours * 60 + minutes) * 60000 * (offset[1] === '-' ? -1 : 1);
      return {earliest:p.wall - delta, latest:p.wall - delta + duration};
    }
    const starts = zonedInstants(p.wall, timezone);
    // A date ends at the next local midnight, which may be 23 or 25 hours away.
    const ends = precision === 'date' ? zonedInstants(p.wall + DAY, timezone) : starts.map(x => x + duration);
    return starts.length && ends.length ? {earliest:starts[0], latest:ends[ends.length - 1]} : null;
  }

  function badClock(now, reference) {
    if (!Number.isFinite(now)) return true;
    const year = new Date(now).getUTCFullYear();
    if (year < 2020 || year > 2100) return true;
    const ref = typeof reference === 'string' ? Date.parse(reference.slice(0,10) + 'T00:00:00Z') : NaN;
    return Number.isFinite(ref) && (now < ref - 2 * 366 * DAY || now > ref + 10 * 366 * DAY);
  }

  function result(state, range) {
    return {state, label:labels[state], earliest:range?.earliest ?? null, latest:range?.latest ?? null};
  }

  function evaluateWindow(raw, now = Date.now(), options = {}) {
    if (badClock(now, options.referenceDate)) return result('clock_error');
    if (options.historical) return result('historical');
    if (options.conflict) return result('conflict');
    if (!raw || typeof raw !== 'object') return result('unknown');
    if (raw.requires_institution_verification) {
      return {...result('unknown'), label:'校内来源仅适用于对应学校，请核验适用范围'};
    }
    let end = bounds(raw.closes, raw.precision, raw.timezone);
    // The action workspace already receives conservative bounds from the renderer.
    if (!end && raw.earliest_utc && raw.latest_utc) {
      const earliest = Date.parse(raw.earliest_utc), latest = Date.parse(raw.latest_utc);
      if (Number.isFinite(earliest) && Number.isFinite(latest) && earliest < latest) end = {earliest, latest};
    }
    if (!end) return result('unknown');
    if (now >= end.latest) return result('ended', end);
    if (now >= end.earliest) return result('boundary', end);
    if (!raw.opens) return result('upcoming', end);
    const openPrecision = raw.opens_precision || (raw.opens.includes('T') ? (/:\d{2}:\d{2}/.test(raw.opens) ? 'second' : 'minute') : 'date');
    const start = bounds(raw.opens, openPrecision, raw.timezone);
    if (!start) return result('unknown', end);
    if (now < start.earliest) return result('upcoming', end);
    if (now < start.latest) return result('boundary', end);
    return result('within', end);
  }

  function windowScope(raw) { return raw && raw.scope && typeof raw.scope === 'object' ? raw.scope : {}; }
  function matches(raw, options) {
    const scope = windowScope(raw);
    if (options.track && scope.track_scope !== options.track && scope.track_id !== options.track) return false;
    if (options.stage && scope.stage !== options.stage) return false;
    return true;
  }
  function isDateConflict(conflict, raw) {
    if (!conflict || typeof conflict !== 'object') return false;
    const semantic = String(conflict.semantic_field || conflict.semantic || '');
    const targets = conflict.value && conflict.value.target_claim_ids;
    if (Array.isArray(targets) && raw && targets.includes(raw.claim_id)) return true;
    if (!/registration.*(?:deadline|window)|(?:deadline|window).*registration/.test(semantic)) return false;
    const scope = windowScope(conflict), wscope = windowScope(raw);
    if (scope.stage && wscope.stage && scope.stage !== wscope.stage) return false;
    if (scope.track_scope && wscope.track_scope && scope.track_scope !== wscope.track_scope) return false;
    if (scope.track_id && wscope.track_id && scope.track_id !== wscope.track_id) return false;
    return true;
  }
  function evaluateCompetition(event, now = Date.now(), options = {}) {
    if (!event || typeof event !== 'object') return {...result('unknown'), registration:'unknown', windows:[]};
    const ref = event.public_evidence_as_of || event.decision_as_of;
    if (badClock(now, ref)) return {...result('clock_error'), registration:'unknown', windows:[]};
    if (event.cycle_status === 'historical') return {...result('historical'), registration:'closed', windows:[]};
    const facts = event.admitted_public_participation || {};
    const admitted = Array.isArray(facts.registration_windows) ? facts.registration_windows : [];
    const sourceWindows = admitted.length ? admitted : (Array.isArray(event.temporal_windows) ? event.temporal_windows : []);
    const conflicts = [...(event.temporal_conflicts || []), ...(facts.conflicts || [])];
    const selected = sourceWindows.filter(w => matches(w, options));
    // Two active, differently dated claims for the same scope cannot be
    // resolved by choosing the later deadline. Admission must resolve them.
    const scopeKey = w => {
      const s = windowScope(w);
      return JSON.stringify([s.edition || '', s.institution_id || '', s.institution_scope || '', s.track_id || s.track_scope || '', s.stage || '']);
    };
    const scopeFacts = new Map();
    for (const w of sourceWindows) {
      if (!w.closes) continue;
      const key = scopeKey(w);
      if (!scopeFacts.has(key)) scopeFacts.set(key, new Set());
      scopeFacts.get(key).add(JSON.stringify([w.closes, w.precision || '', w.timezone || 'UNKNOWN']));
    }
    const windows = selected.map(w => ({window:w, ...evaluateWindow(w, now, {
      referenceDate:ref, conflict:(scopeFacts.get(scopeKey(w))?.size || 0) > 1 || conflicts.some(c => isDateConflict(c, w))
    })}));
    let state;
    if (!windows.length) state = conflicts.some(c => isDateConflict(c, null)) && !options.track ? 'conflict' : 'unknown';
    else if (windows.some(w => w.state === 'within')) state = 'within';
    else if (windows.some(w => w.state === 'boundary')) state = 'boundary';
    else if (windows.some(w => w.state === 'upcoming')) state = 'upcoming';
    else if (windows.some(w => w.state === 'conflict')) state = 'conflict';
    else if (windows.some(w => w.state === 'unknown' || w.state === 'clock_error')) state = 'unknown';
    else state = 'ended';
    const overall = result(state);
    if (windows.length === 1 && windows[0].state === state) overall.label = windows[0].label;
    else if (windows.length > 1 && state === 'within') overall.label = '至少一个赛道处于已公布时间范围，其他赛道请分别核验';
    else if (windows.length > 1 && new Set(windows.map(w => w.state)).size > 1) overall.label = '各赛道时间状态不同，请分别核验';
    return {...overall, registration:state === 'within' ? 'open' : state === 'ended' ? 'closed' : 'unknown', windows};
  }

  return {bounds, evaluateWindow, evaluateCompetition};
});
