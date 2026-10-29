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
