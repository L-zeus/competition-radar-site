"use strict";
(() => {
  const root = document.querySelector('[data-action-workspace]');
  if (!root) return;
  const cards = Array.from(root.querySelectorAll('[data-action-event]'));
  const completed = new Set();
  const labels = { current: '节点尚未到，先核对', verify: '时间或参与条件待核验', closed: '公布截止已过', history: '仅供历史参考' };
  const rank = { current: 0, verify: 1, closed: 2, history: 3 };
  function state(task, now) {
    if (task.dataset.taskState === 'history') return 'history';
    let w; try { w = JSON.parse(task.dataset.taskWindow); } catch { return 'verify'; }
    if (!w?.earliest_utc || !w?.latest_utc) return 'verify';
    if (now >= Date.parse(w.latest_utc)) return 'closed';
    return now < Date.parse(w.earliest_utc) ? 'current' : 'verify';
  }
  function refresh() {
    const now = Date.now();
    cards.forEach(card => {
      const tasks = Array.from(card.querySelectorAll('[data-action-task]'));
      tasks.forEach(task => {
        task.dataset.taskState = state(task, now);
        task.querySelector('[data-task-state-label]').textContent = (completed.has(task.dataset.actionTask) ? "本次已处理此步骤；" : "") + labels[task.dataset.taskState];
      });
      tasks.sort((a,b) => rank[a.dataset.taskState] - rank[b.dataset.taskState] ||
        (JSON.parse(a.dataset.taskWindow)?.closes || '9999').localeCompare(JSON.parse(b.dataset.taskWindow)?.closes || '9999'));
      const remaining = tasks.filter(task => !completed.has(task.dataset.actionTask));
      const first = remaining[0] || tasks[0];
      if (!first) return;
      const window = JSON.parse(first.dataset.taskWindow);
      card.dataset.actionState = first.dataset.taskState;
      card.dataset.sortDate = window?.closes || '9999';
      const primary = card.querySelector('[data-primary-action]');
      primary.replaceChildren(...Array.from(first.children).filter(e => !e.hasAttribute('data-task-state-label')).map(e => e.cloneNode(true)));
      const done = remaining.length === 0;
      card.dataset.primaryTaskId=first.dataset.actionTask;
      const button=card.querySelector('[data-action-done]');
      button.setAttribute('aria-pressed',String(done));
      button.textContent=done?'重新放回待处理':'本次已处理这一步';
      card.querySelector('[data-action-done-note]').hidden=!done;
      const section = root.querySelector(`[data-action-section="${done ? 'done' : card.dataset.actionState}"] [data-action-group-list]`);
      section.appendChild(card);
    });
    root.querySelectorAll('[data-action-section]').forEach(section => {
      const list = section.querySelector('[data-action-group-list]');
      Array.from(list.children).sort((a,b) => a.dataset.sortDate.localeCompare(b.dataset.sortDate)).forEach(card => list.appendChild(card));
      section.hidden = list.children.length === 0;
      section.querySelector('[data-section-count]').textContent = list.children.length;
    });
    root.querySelector('[data-action-empty]').hidden = root.querySelector('[data-action-section="current"] [data-action-group-list]').children.length + root.querySelector('[data-action-section="verify"] [data-action-group-list]').children.length > 0;
    const clock = document.querySelector('[data-action-clock]');
    clock.textContent = `行动分组随设备时间更新；资料截至 ${clock.dataset.evidenceAsOf}。`;
  }
  root.addEventListener('click', e => {
    const button = e.target.closest('[data-action-done]');
    if (!button) return;
    const card=button.closest('[data-action-event]');
    if(button.getAttribute('aria-pressed')==='true') card.querySelectorAll('[data-action-task]').forEach(task=>completed.delete(task.dataset.actionTask));
    else completed.add(card.dataset.primaryTaskId);
    refresh();
    button.focus({preventScroll:true});
  });
  function reset() {
    completed.clear();
    cards.forEach(card => {
      const button = card.querySelector('[data-action-done]');
      button.setAttribute('aria-pressed','false');button.textContent='本次已处理这一步';
      card.querySelector('[data-action-done-note]').hidden = true;
    });
    refresh();
  }
  window.addEventListener('pageshow', e => { if(e.persisted) reset(); });
  document.addEventListener('visibilitychange', () => { if(!document.hidden) refresh(); });
  setInterval(refresh,60000);
  refresh();
})();
