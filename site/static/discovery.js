"use strict";

document.querySelectorAll("[data-discovery-feed]").forEach((feed) => {
  const cards = Array.from(feed.querySelectorAll("[data-discovery-card]"));
  const search = feed.querySelector("[data-discovery-search]");
  const tagSelect = feed.querySelector("[data-discovery-tag-select]");
  const cycleSelect = feed.querySelector("[data-discovery-cycle-filter]");
  const registrationSelect = feed.querySelector("[data-discovery-registration-filter]");
  const verificationSelect = feed.querySelector("[data-discovery-verification-filter]");
  const formatSelect = feed.querySelector("[data-discovery-format-filter]");
  const submissionSelect = feed.querySelector("[data-discovery-submission-filter]");
  const sortSelect = feed.querySelector("[data-discovery-sort]");
  const count = feed.querySelector("[data-discovery-count]");
  const empty = feed.querySelector("[data-discovery-empty]");
  const chips = Array.from(feed.querySelectorAll("[data-discovery-tag]"));
  const clear = feed.querySelector("[data-discovery-clear]");
  const initialOrder = new Map(cards.map((card, index) => [card, index]));
  let activeTag = "";

  const update = () => {
    const needle = search?.value.trim().toLocaleLowerCase("zh-CN") || "";
    const tag = tagSelect?.value || activeTag;
    const cycle = cycleSelect?.value || "";
    const registration = registrationSelect?.value || "";
    const verification = verificationSelect?.value || "";
    const format = formatSelect?.value || "";
    const submission = submissionSelect?.value || "";
    let visible = 0;
    cards.forEach((card) => {
      const text = (card.dataset.searchText || card.textContent).toLocaleLowerCase("zh-CN");
      const tags = (card.dataset.discoveryTags || "").split("|");
      const matches = (!needle || text.includes(needle))
        && (!tag || tags.includes(tag))
        && (!cycle || card.dataset.discoveryCycle === cycle);
      const fullyMatches = matches
        && (!registration || card.dataset.discoveryRegistration === registration)
        && (!verification || card.dataset.discoveryVerification === verification)
        && (!format || card.dataset.discoveryFormat === format)
        && (!submission || card.dataset.discoverySubmission === submission);
      card.hidden = !fullyMatches;
      if (fullyMatches) visible += 1;
    });
    if (count) count.textContent = `显示 ${visible} / ${cards.length} 场`;
    if (empty) empty.hidden = visible > 0;

    if (sortSelect) {
      const list = feed.querySelector(".discovery-grid");
      const mode = sortSelect.value;
      const sorted = [...cards].sort((left, right) => {
        if (mode === "date") {
          const leftDate = left.dataset.sortDate || "9999-12-31";
          const rightDate = right.dataset.sortDate || "9999-12-31";
          const dateDifference = leftDate.localeCompare(rightDate);
          if (dateDifference) return dateDifference;
        } else if (mode === "relevance") {
          const registrationOrder = { open: 0, unknown: 1, closed: 2 };
          const registrationDifference = (registrationOrder[left.dataset.discoveryRegistration] ?? 1)
            - (registrationOrder[right.dataset.discoveryRegistration] ?? 1);
          if (registrationDifference) return registrationDifference;
          const rankDifference = Number(right.dataset.sortRank || 0) - Number(left.dataset.sortRank || 0);
          if (rankDifference) return rankDifference;
        }
        const nameOrder = (left.dataset.sortName || "").localeCompare(right.dataset.sortName || "", "zh-CN", { sensitivity: "base" });
        return nameOrder || initialOrder.get(left) - initialOrder.get(right);
      });
      sorted.forEach((card) => list?.appendChild(card));
    }
    chips.forEach((chip) => chip.classList.toggle("is-active", (chip.dataset.discoveryTag || "") === activeTag));
  };

  search?.addEventListener("input", update);
  tagSelect?.addEventListener("change", update);
  cycleSelect?.addEventListener("change", update);
  registrationSelect?.addEventListener("change", update);
  verificationSelect?.addEventListener("change", update);
  formatSelect?.addEventListener("change", update);
  submissionSelect?.addEventListener("change", update);
  sortSelect?.addEventListener("change", update);
  chips.forEach((chip) => chip.addEventListener("click", () => {
    activeTag = chip.dataset.discoveryTag || "";
    if (tagSelect) tagSelect.value = activeTag;
    update();
  }));
  clear?.addEventListener("click", () => {
    if (search) search.value = "";
    if (tagSelect) tagSelect.value = "";
    if (cycleSelect) cycleSelect.value = "";
    if (registrationSelect) registrationSelect.value = "";
    if (verificationSelect) verificationSelect.value = "";
    if (formatSelect) formatSelect.value = "";
    if (submissionSelect) submissionSelect.value = "";
    if (sortSelect) sortSelect.value = "relevance";
    activeTag = "";
    update();
    search?.focus();
  });
  update();
});

document.querySelectorAll("[data-preparation-fit]").forEach((panel) => {
  const form = panel.querySelector("[data-fit-form]");
  const result = panel.querySelector("[data-fit-result]");
  const submit = panel.querySelector("[data-fit-submit]");
  const clear = panel.querySelector("[data-fit-clear]");
  if (!form || !result) return;

  submit?.addEventListener("click", () => {
    const selectedDirection = form.querySelector("[data-fit-direction]")?.value || "";
    const time = form.querySelector("[data-fit-time]")?.value || "";
    const hasProject = Boolean(form.querySelector("[data-fit-project]")?.checked);
    const skillChoices = Array.from(form.querySelectorAll("[data-fit-skill]"));
    const familiar = skillChoices.filter((choice) => choice.checked).map((choice) => choice.value);
    const notYet = skillChoices.filter((choice) => !choice.checked).map((choice) => choice.value);

    const directionMessage = selectedDirection
      ? `方向：你选了“${selectedDirection}”，它与本赛的公开内容方向相符。`
      : "方向：尚未填写兴趣方向。";
    const skillMessage = familiar.length
      ? `你标记了 ${familiar.length} 项熟悉的能力：${familiar.join("、")}。`
      : "你还没有标记熟悉的能力；可以先挑一项最有把握的。";
    const gapMessage = notYet.length
      ? `可以优先了解或补练：${notYet.join("、")}。这些是任务相关能力参考，不是报名硬性条件。`
      : "你已标记所有列出的能力；这不代表官方资格或比赛结果。";
    const projectMessage = hasProject
      ? "你表示已有可复用项目经验，可以检查现有作品能否覆盖本赛任务。"
      : "你表示还没有可复用项目；可以从详情页的第一步准备建议开始。";
    const timeMessage = time
      ? `你填写的可用时间是“${time}”。官方没有公布统一准备工时，这里不会把该数字判为足够或不足。`
      : "可用时间未填写；官方没有公布统一准备工时。";

    result.replaceChildren();
    const heading = document.createElement("strong");
    heading.textContent = "你的准备参照（本机临时计算）";
    const text = document.createElement("p");
    text.textContent = [directionMessage, skillMessage, gapMessage, projectMessage, timeMessage].join(" ");
    const note = document.createElement("p");
    note.textContent = "这不是资格审核、适合度打分或获奖预测。输入不会保存，刷新页面后清除；正式资格仍以官方规则和现有资格匹配页为准。";
    result.append(heading, text, note);
    result.hidden = false;
  });

  clear?.addEventListener("click", () => {
    form.reset();
    result.replaceChildren();
    result.hidden = true;
  });
});

// Hash links remain usable when their target lives inside an on-demand section.
// Only DOM identifiers are resolved; no personal state is written to the URL.
(() => {
  const reveal = (hash) => {
    if (!hash || hash === '#') return;
    let id;
    try { id = decodeURIComponent(hash.slice(1)); } catch { return; }
    const target = document.getElementById(id);
    if (!target) return;
    let current = target;
    while (current) {
      if (current instanceof HTMLDetailsElement) current.open = true;
      current = current.parentElement;
    }
    requestAnimationFrame(() => target.scrollIntoView({ block: 'start' }));
  };
  window.addEventListener('hashchange', () => reveal(location.hash));
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href]');
    if (!link) return;
    const url = new URL(link.href, location.href);
    if (url.origin === location.origin && url.pathname === location.pathname) reveal(url.hash);
  });
  reveal(location.hash);
})();
