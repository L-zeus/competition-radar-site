"use strict";

const compareValues = (left, right) => {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (left !== "" && right !== "" && Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber;
  }
  return left.localeCompare(right, "zh-CN", { numeric: true, sensitivity: "base" });
};

document.querySelectorAll("[data-radar-table]").forEach((panel) => {
  const input = panel.querySelector("[data-search]");
  const rows = Array.from(panel.querySelectorAll("tbody[data-sort-rows] tr[data-searchable]"));
  const filters = Array.from(panel.querySelectorAll("[data-filter-field]"));
  const count = panel.querySelector("[data-result-count]");
  const empty = panel.querySelector("[data-radar-empty]");
  const reset = panel.querySelector("[data-reset-filters]");

  const applyFilters = () => {
    const needle = input?.value.trim().toLocaleLowerCase("zh-CN") || "";
    let visible = 0;
    rows.forEach((row) => {
      const matchesText = !needle || row.textContent.toLocaleLowerCase("zh-CN").includes(needle);
      const matchesFilters = filters.every((filter) => {
        if (!filter.value) return true;
        const field = filter.dataset.filterField;
        if (field === "actionStatus") {
          if (filter.value === "HAS_ACTIONS") return row.dataset.filterHasActions === "true";
          return (row.dataset.filterActionStatuses || "").split(",").includes(filter.value);
        }
        const datasetKey = `filter${field[0].toUpperCase()}${field.slice(1)}`;
        return (row.dataset[datasetKey] || "").split("|").includes(filter.value);
      });
      row.hidden = !(matchesText && matchesFilters);
      if (!row.hidden) visible += 1;
    });
    if (count) count.textContent = `显示 ${visible} / ${rows.length} 条`;
    if (empty) empty.hidden = visible > 0;
  };

  input?.addEventListener("input", applyFilters);
  filters.forEach((filter) => filter.addEventListener("change", applyFilters));
  reset?.addEventListener("click", () => {
    if (input) input.value = "";
    filters.forEach((filter) => { filter.value = ""; });
    applyFilters();
    input?.focus();
  });
  applyFilters();

  panel.querySelectorAll("[data-sort]").forEach((button) => {
    const heading = button.closest("th");
    const baseLabel = button.getAttribute("aria-label") || button.textContent.trim();
    button.addEventListener("click", () => {
      const body = button.closest("table")?.querySelector("tbody[data-sort-rows]");
      if (!body) return;
      const currentSort = heading?.getAttribute("aria-sort");
      const ascending = currentSort === "descending"
        ? true
        : currentSort === "ascending"
          ? false
          : button.dataset.sortDefault === "asc";
      const key = button.dataset.sort;
      const datasetKey = `sort${key[0].toUpperCase()}${key.slice(1)}`;
      const sortableRows = Array.from(body.querySelectorAll("tr[data-searchable]"));
      sortableRows.sort((left, right) => {
        const leftValue = left.dataset[datasetKey] || "";
        const rightValue = right.dataset[datasetKey] || "";
        if (key === "priority" && Boolean(leftValue) !== Boolean(rightValue)) {
          return leftValue ? -1 : 1;
        }
        const order = compareValues(leftValue, rightValue);
        const primaryOrder = ascending ? order : -order;
        if (primaryOrder) return primaryOrder;
        if (key === "priority") {
          const lifecycleOrder = compareValues(
            left.dataset.sortLifecycle || "99",
            right.dataset.sortLifecycle || "99",
          );
          if (lifecycleOrder) return lifecycleOrder;
        }
        return (left.dataset.sortEditionId || "").localeCompare(right.dataset.sortEditionId || "");
      });
      sortableRows.forEach((row) => body.appendChild(row));
      tableSortState(button, heading, baseLabel, ascending);
    });
  });
});

document.querySelectorAll("[data-public-list]").forEach((panel) => {
  const items = Array.from(panel.querySelectorAll("[data-public-list-item]"));
  const search = panel.querySelector("[data-public-list-search]");
  const filter = panel.querySelector("[data-public-list-filter]");
  const sort = panel.querySelector("[data-public-list-sort]");
  const count = panel.querySelector("[data-public-list-count]");
  const empty = panel.querySelector("[data-public-list-empty]");
  const reset = panel.querySelector("[data-public-list-reset]");
  const itemList = panel.querySelector("[data-public-list-items]");
  const initialOrder = new Map(items.map((item, index) => [item, index]));

  const applyControls = () => {
    const needle = search?.value.trim().toLocaleLowerCase("zh-CN") || "";
    const filterValue = filter?.value || "";
    let visible = 0;
    items.forEach((item) => {
      const matchesText = !needle || item.textContent.toLocaleLowerCase("zh-CN").includes(needle);
      const matchesFilter = !filterValue || item.dataset.filterValue === filterValue;
      item.hidden = !(matchesText && matchesFilter);
      if (!item.hidden) visible += 1;
    });

    if (count) {
      const unit = count.dataset.countUnit || "项";
      count.textContent = `显示 ${visible} / ${items.length} ${unit}`;
    }
    if (empty) empty.hidden = visible > 0;

    if (sort && itemList) {
      const key = sort.value;
      const datasetKey = { edition: "sortEdition", type: "sortType", origin: "sortOrigin" }[key];
      const ordered = [...items].sort((left, right) => {
        if (!datasetKey) return initialOrder.get(left) - initialOrder.get(right);
        const order = compareValues(left.dataset[datasetKey] || "", right.dataset[datasetKey] || "");
        return order || initialOrder.get(left) - initialOrder.get(right);
      });
      ordered.forEach((item) => itemList.appendChild(item));
    }
  };

  search?.addEventListener("input", applyControls);
  filter?.addEventListener("change", applyControls);
  sort?.addEventListener("change", applyControls);
  reset?.addEventListener("click", () => {
    if (search) search.value = "";
    if (filter) filter.value = "";
    if (sort) sort.value = "original";
    applyControls();
    search?.focus();
  });
  applyControls();
});

function tableSortState(button, heading, label, ascending) {
  const table = button.closest("table");
  table?.querySelectorAll("th[aria-sort]").forEach((item) => item.setAttribute("aria-sort", "none"));
  heading?.setAttribute("aria-sort", ascending ? "ascending" : "descending");
  button.setAttribute("aria-label", `${label}，${ascending ? "升序" : "降序"}`);
}

document.querySelectorAll("[data-copy-url]").forEach((button) => {
  button.hidden = false;
  button.addEventListener("click", async () => {
    const url = button.dataset.copyUrl || "";
    const feedback = button.parentElement?.querySelector("[data-copy-feedback]");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(url);
      if (feedback) feedback.textContent = "链接已复制。";
    } catch {
      if (feedback) feedback.textContent = "自动复制不可用，请选中上方地址后手动复制。";
    }
  });
});

/* Runtime safety projection: dates do not prove the current official status. */
(() => {
  const records = [{"href":"discovery/cacc-3-2026/","id":"cacc-3-2026","windows":[{"date":"2026-11-18","scope":"regional"}]},{"href":"discovery/software-testing-11-2026/","id":"software-testing-11-2026","windows":[{"date":"2026-10-30","scope":"edition-wide registration notice; track requirements remain separate"}]},{"href":"competitions/4/","id":"4","windows":[{"date":"2026-10-23","scope":"官方报名截止"}]},{"href":"discovery/computer-systems-os-regional-2026/","id":"computer-systems-os-regional-2026","windows":[{"date":"2026-12-27","scope":"官方报名截止"}]},{"href":"discovery/ncccu-8-2026/","id":"ncccu-8-2026","windows":[{"date":"2026-11-13","scope":"人工智能挑战赛·区域赛/省赛"},{"date":"2026-11-06","scope":"大数据挑战赛·区域赛/省赛"},{"date":"2026-11-25","scope":"程序设计挑战赛·区域赛/省赛"}]},{"href":"discovery/iscc-password-23-2026/","id":"iscc-password-23-2026","windows":[{"date":"2026-10-23","scope":"官方报名截止"}]},{"href":"competitions/3/","id":"3","windows":[{"date":"2026-12-06","scope":"官方提交截止"}]},{"href":"discovery/ai-application-innovation-2-2026/","id":"ai-application-innovation-2-2026","windows":[{"date":"2026-11-10","scope":"官方报名截止"}]},{"href":"discovery/huawei-ict-11-2026-27/","id":"huawei-ict-11-2026-27","windows":[{"date":"2026-11-30","scope":"中国创新赛（第十一届）"}]},{"href":"discovery/graduate-smart-city-12-2026/","id":"graduate-smart-city-12-2026","windows":[{"date":"2026-10-23","scope":"官方报名截止"},{"date":"2026-10-25","scope":"官方提交截止"}]},{"href":"discovery/college-innovation-2026/","id":"college-innovation-2026","windows":[{"date":"2026-09-25","scope":"官方报名截止"}]},{"href":"discovery/china-ai-competition-7-2026/","id":"china-ai-competition-7-2026","windows":[{"date":"2026-10-18","scope":"官方报名截止"}]},{"href":"discovery/graduate-cybersecurity-innovation-5-2026/","id":"graduate-cybersecurity-innovation-5-2026","windows":[{"date":"2026-10-18","scope":"官方报名截止"},{"date":"2026-10-22","scope":"官方提交截止"}]},{"href":"discovery/lanqiao-2027-18/","id":"lanqiao-2027-18","windows":[{"date":"2026-12-18","scope":"软件赛·省赛/全国选拔赛"}]}];
  const today = () => new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
  const expired = (row, day) => row.windows.filter(w => w.date < day);
  const notice = (row, windows) => '公布的截止日期已过，当前报名状态待核验：' + windows.map(w => w.scope + ' ' + w.date).join('；') + '。主办方可能延期或调整，请打开官方来源核对。';
  const byId = new Map(records.map(row => [row.id, row]));
  let renderedDay = today();
  function update() {
    const day = today();
    const catalog = window.RadarDecisionCatalog;
    if (catalog && Array.isArray(catalog.competitions)) {
      for (const event of catalog.competitions) {
        const row = byId.get(String(event.id)); if (!row) continue;
        const due = expired(row, day); if (!due.length) continue;
        event.student_presentation = {...event.student_presentation, date_review_pending: true, next_step: notice(row, due)};
        event.registration_status = 'unknown'; event.registration_label = '报名日期待核验';
        const publicFacts = event.admitted_public_participation;
        if (publicFacts) {
          for (const w of publicFacts.registration_windows || []) if (w.closes && w.closes.slice(0,10) < day && w.state_as_of === 'PUBLISHED_OPEN') w.state_as_of = 'TIME_UNRESOLVED';
          if (publicFacts.registration_window && publicFacts.registration_window.closes && publicFacts.registration_window.closes.slice(0,10) < day && publicFacts.registration_window.state_as_of === 'PUBLISHED_OPEN') publicFacts.registration_window.state_as_of = 'TIME_UNRESOLVED';
        }
      }
      const engine = window.RadarDecisionEngine;
      if (engine && !engine._freshnessWrapped) {
        const recommend = engine.recommend;
        engine.recommend = function(...args) {
          const result = recommend.apply(this, args);
          for (const item of result.items || []) {
            const row = byId.get(String(item.id)); const due = row ? expired(row, today()) : [];
            if (!due.length || item.eligibility.status === 'MISMATCH') continue;
            item.bucket = 'watch'; item.bucket_label = '日期待核验'; item.bucket_reason = notice(row, due);
            item.registration_status = 'unknown'; item.registration_label = '报名日期待核验'; item.next_step = notice(row, due);
            if (Array.isArray(item._sort)) item._sort[0] = 2;
          }
          if (result.items) {
            result.items.sort((a, b) => {
              for (let i = 0; i < a._sort.length; i++) {
                const x = a._sort[i], y = b._sort[i];
                const order = typeof x === 'number' && typeof y === 'number' ? x-y : String(x).localeCompare(String(y), 'zh-CN', {sensitivity:'base'});
                if (order) return order;
              }
              return 0;
            });
            result.buckets = {};
            for (const item of result.items) result.buckets[item.bucket] = (result.buckets[item.bucket] || 0) + 1;
          }
          return result;
        };
        engine._freshnessWrapped = true;
      }
    }
    const main = document.querySelector('main');
    const path = decodeURIComponent(location.pathname).replace(/index\.html$/, '').replace(/\/$/, '');
    const detail = records.find(row => row.href && path.endsWith('/' + row.href.replace(/\/$/, '')));
    if (main && detail && expired(detail, day).length) {
      const title = main.querySelector('h1')?.textContent || '赛事信息';
      const links = Array.from(main.querySelectorAll('a[href^="https://"]')).map(a => ({href:a.href, text:a.textContent.trim()}));
      main.replaceChildren(); const h = document.createElement('h1'); h.textContent = title; main.append(h);
      const p = document.createElement('p'); p.textContent = notice(detail, expired(detail, day)); main.append(p);
      const remaining = detail.windows.filter(w => w.date >= day);
      if (remaining.length) {const q = document.createElement('p'); q.textContent = '其他赛道公布日期：' + remaining.map(w => w.scope + ' ' + w.date).join('；') + '。仍须核对官网。';main.append(q);}
      const unique = new Set(); for (const link of links) {if (unique.has(link.href)) continue; unique.add(link.href); const a=document.createElement('a'); a.href=link.href;a.textContent=link.text || '查看官方来源';a.target='_blank';a.rel='noopener noreferrer';const p=document.createElement('p');p.append(a);main.append(p);}
    }
    for (const row of records) {
      const due = expired(row, day); if (!due.length) continue;
      const candidates = Array.from(document.querySelectorAll('[data-directory-id], [data-testid="home-reviewed-opportunity"], [data-testid="g157-public-opportunity"], [data-action-event]'));
      for (const card of candidates) {
        const id = card.getAttribute('data-directory-id') || card.getAttribute('data-action-event') || card.id.replace(/^campus-/, '');
        const link = card.querySelector('a[href]');
        if (id !== row.id && id !== 'g6-' + row.id && !(link && row.href && new URL(link.href, location.href).pathname.replace(/index\.html$/, '').replace(/\/$/, '').endsWith('/' + row.href.replace(/\/$/, '')))) continue;
        if (card.dataset.freshnessWarning) continue;
        for (const el of card.querySelectorAll('p, details, .compact-card-meta, .compact-card-heading')) el.hidden = true;
        const p=document.createElement('p');p.textContent=notice(row,due);card.append(p);card.dataset.freshnessWarning='true';
        if (card.hasAttribute('data-discovery-registration')) card.setAttribute('data-discovery-registration','unknown');
      }
    }
    document.querySelectorAll('main[data-freshness-pending]').forEach(el => {el.hidden=false;el.removeAttribute('data-freshness-pending');});
  }
  document.addEventListener('DOMContentLoaded', update);
  setInterval(() => {const day=today();if(day!==renderedDay){renderedDay=day;location.reload();}}, 60000);
  document.addEventListener('visibilitychange', () => {if(!document.hidden && today()!==renderedDay) location.reload();});
})();
