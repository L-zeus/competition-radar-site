"use strict";
(() => {
  const root = document.querySelector('[data-action-workspace]');
  const temporal = window.RadarTemporalState;
  const catalog = window.RadarDecisionCatalog;
  if (!root || !temporal || !catalog || !Array.isArray(catalog.competitions)) return;
  const cards = Array.from(root.querySelectorAll('[data-action-event]'));
  const events = new Map(catalog.competitions.map(event => [String(event.id), event]));
  const completed = new Set();
  const rank = { current: 0, verify: 1, closed: 2, history: 3 };
  const taskWindows = new Map();
  cards.forEach(card => card.querySelectorAll('[data-action-task]').forEach(task => {
    let raw = null;
    try { raw = JSON.parse(task.dataset.taskWindow); } catch { /* Keep an unresolved state. */ }
    taskWindows.set(task, raw);
  }));
  let lastSignature = '';

  function evaluation(task, event, eventState, now) {
    const raw = taskWindows.get(task);
    // A build-time grouping may reflect a historical track, not the whole
    // competition. Prefer the catalog's explicit edition-level cycle state.
    const historical = event ? event.cycle_status === 'historical' : task.dataset.taskHistory === 'true';
    const registration = ['registration', 'official_registration_deadline', 'national_registration', 'preliminary_registration_and_submission'].includes(task.dataset.taskKind);
    if (eventState && eventState.state === 'clock_error') return { group: 'verify', label: eventState.label };
    let result = null;
    if (registration && eventState && raw) {
      const matches = eventState.windows.filter(item => {
        const candidate = item.window || {};
        if (raw.claim_id && candidate.claim_id) return raw.claim_id === candidate.claim_id;
        const rawScope = raw.scope && raw.scope.track_scope;
        const candidateScope = candidate.scope && candidate.scope.track_scope;
        return raw.closes && raw.closes === candidate.closes && rawScope && rawScope === candidateScope;
      });
      if (matches.length === 1) result = matches[0];
    }
    if (!result && registration && eventState && eventState.windows.some(item => item.state === 'conflict')) {
      return { group: 'verify', label: '适用赛道和报名日期需核验' };
    }
    if (!result) result = temporal.evaluateWindow(raw, now, {
      historical,
      conflict: Boolean(registration && eventState && eventState.state === 'conflict'),
      referenceDate: event && (event.public_evidence_as_of || event.decision_as_of),
    });
    if (historical) return { group: 'history', label: '仅供历史参考' };
    const group = result.state === 'ended' ? 'closed'
      : result.state === 'historical' ? 'history'
        : result.state === 'within' ? 'current' : 'verify';
    const label = task.dataset.taskKind === 'submission_deadline' ? result.label.replaceAll('报名', '提交') : result.label;
    return { group, label };
  }

  function refresh(force = false) {
    const now = Date.now();
    const snapshots = cards.map(card => {
      const id = card.dataset.actionEvent;
      const event = events.get(id) || (id.startsWith('g6-') ? events.get(id.slice(3)) : null);
      const eventState = event ? temporal.evaluateCompetition(event, now) : null;
      const tasks = Array.from(card.querySelectorAll('[data-action-task]')).map(task => ({
        task, ...evaluation(task, event, eventState, now),
      }));
      return { card, tasks };
    });
    const signature = JSON.stringify([snapshots.map(({tasks}) => tasks.map(item => [item.group, item.label])), Array.from(completed).sort()]);
    if (!force && signature === lastSignature) return;
    lastSignature = signature;
    snapshots.forEach(({card, tasks}) => {
      tasks.forEach(({task, group, label}) => {
        task.dataset.taskState = group;
        task.querySelector('[data-task-state-label]').textContent = (completed.has(task.dataset.actionTask) ? '本次已处理此步骤；' : '') + label;
        task.querySelectorAll('.task-next-step').forEach(node => { node.hidden = group === 'closed' || group === 'history'; });
      });
      tasks.sort((a, b) => rank[a.group] - rank[b.group] ||
        ((taskWindows.get(a.task) || {}).closes || '9999').localeCompare((taskWindows.get(b.task) || {}).closes || '9999'));
      const remaining = tasks.filter(item => !completed.has(item.task.dataset.actionTask));
      const first = remaining[0] || tasks[0];
      if (!first) return;
      const window = taskWindows.get(first.task);
      card.dataset.actionState = first.group;
      card.dataset.sortDate = window && window.closes || '9999';
      card.querySelector('[data-primary-action]').replaceChildren(...Array.from(first.task.children).map(node => node.cloneNode(true)));
      const done = remaining.length === 0;
      card.dataset.primaryTaskId = first.task.dataset.actionTask;
      const button = card.querySelector('[data-action-done]');
      button.setAttribute('aria-pressed', String(done));
      button.textContent = done ? '重新放回待处理' : '本次已处理这一步';
      card.querySelector('[data-action-done-note]').hidden = !done;
      const section = root.querySelector(`[data-action-section="${done ? 'done' : first.group}"] [data-action-group-list]`);
      section.appendChild(card);
    });
    root.querySelectorAll('[data-action-section]').forEach(section => {
      const list = section.querySelector('[data-action-group-list]');
      Array.from(list.children).sort((a, b) => a.dataset.sortDate.localeCompare(b.dataset.sortDate)).forEach(card => list.appendChild(card));
      section.hidden = list.children.length === 0;
      section.querySelector('[data-section-count]').textContent = list.children.length;
    });
    root.querySelector('[data-action-empty]').hidden = root.querySelector('[data-action-section="current"] [data-action-group-list]').children.length + root.querySelector('[data-action-section="verify"] [data-action-group-list]').children.length > 0;
    const clock = document.querySelector('[data-action-clock]');
    clock.textContent = `行动分组依据设备时间与已公布日期计算；资料截至 ${clock.dataset.evidenceAsOf}，平台受理与官方变化仍须核对。`;
  }
  root.addEventListener('click', event => {
    const button = event.target.closest('[data-action-done]');
    if (!button) return;
    const card = button.closest('[data-action-event]');
    if (button.getAttribute('aria-pressed') === 'true') card.querySelectorAll('[data-action-task]').forEach(task => completed.delete(task.dataset.actionTask));
    else completed.add(card.dataset.primaryTaskId);
    refresh(true);
    button.focus({preventScroll: true});
  });
  window.addEventListener('pageshow', event => { if (event.persisted) completed.clear(); refresh(true); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  setInterval(refresh, 60000);
  refresh();
})();
