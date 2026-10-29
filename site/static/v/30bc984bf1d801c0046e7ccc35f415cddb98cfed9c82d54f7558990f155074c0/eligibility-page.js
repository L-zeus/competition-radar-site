"use strict";

(() => {
  const app = document.querySelector("[data-eligibility-app]");
  if (!app) return;

  const polished = app.hasAttribute("data-ux-polish");
  const natural = value => polished ? String(value).replaceAll("UNKNOWN", "待核验").replaceAll("NOT_VERIFIED", "尚未验证").replace("G6 公开规则明确 student_only=false。", "公开规则未限定必须是在校学生。").replace("G6 公开规则明确 student_only=true。", "公开规则要求参赛者是在校学生。") : value;

  const statusText = app.querySelector("[data-eligibility-status]");
  const runButton = app.querySelector("[data-run-eligibility]");
  const clearButton = app.querySelector("[data-clear-eligibility]");
  const trackSelector = app.querySelector("[data-track-selector]");
  const eventSelector = app.querySelector("[data-event-selector]");
  const demoToggle = document.querySelector("[data-include-demos]");
  const resultsSection = document.querySelector("[data-eligibility-results-section]");
  const resultsList = resultsSection?.querySelector("[data-result-list]");
  const resultsEmpty = resultsSection?.querySelector("[data-results-empty]");
  const resultCount = resultsSection?.querySelector("[data-result-count]");
  const profileSummary = resultsSection?.querySelector("[data-profile-summary]");
  const dimensionSpecs = [
    ["public_rule_fit", "公开规则适配"],
    ["registration_window", "报名窗口"],
    ["entry_path", "参赛路径"],
    ["preparation_readiness", "准备度"],
  ];
  const statusLabels = {
    TRUE: "符合已知条件",
    FALSE: "不符合此项已知条件",
    UNKNOWN: polished ? "仍待核验" : "UNKNOWN · 待核对",
    NOT_APPLICABLE: "不适用",
    VALID: "规则范围有效",
    INVALID: "规则范围不匹配",
  };
  const resultGroups = [
    ["matched_conditions", "符合的条件"],
    ["mismatched_conditions", "不符合的条件"],
    ["unknown_conditions", "待核对的条件"],
    ["not_applicable_conditions", "不适用的条件"],
  ];
  const eligibilitySummaryLabels = {
    ELIGIBLE: "初步符合已核验规则",
    INELIGIBLE: "与至少一项已核验规则明确不匹配",
    UNKNOWN: "资格待核验",
    NOT_APPLICABLE: "此规则不适用于当前范围",
  };
  let catalog;

  const element = (tagName, className, text) => {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  };

  const fieldHomes = new Map();
  function restoreNeeded() {
    fieldHomes.forEach((marker,label)=>marker.after(label));
  }
  const clearInputs = () => {
    if(polished) {
      restoreNeeded();
      const controls=app.querySelector('[data-formal-inputs]');if(controls)controls.hidden=false;
      if(runButton)runButton.hidden=false;
    }
    app.querySelectorAll("[data-user-field]").forEach((field) => {
      if (field instanceof HTMLSelectElement) field.selectedIndex = 0;
      else field.value = "";
    });
    app.querySelectorAll("[data-user-preference]").forEach((field) => {
      field.checked = false;
    });
    if (trackSelector) trackSelector.selectedIndex = 0;
    if (eventSelector) eventSelector.selectedIndex = 0;
    if (demoToggle) demoToggle.checked = false;
    if (trackSelector) Array.from(trackSelector.options).forEach((option) => { option.hidden = false; });
  };

  const clearResults = () => {
    if (resultsSection) resultsSection.hidden = true;
    resultsList?.replaceChildren();
    if (resultsEmpty) resultsEmpty.hidden = false;
    if (resultCount) resultCount.textContent = "尚未计算";
    if (profileSummary) {
      profileSummary.textContent = "";
      profileSummary.hidden = true;
    }
  };

  const clearAll = (announce = true) => {
    clearInputs();
    clearResults();
    document.querySelectorAll("[data-public-eligibility]").forEach(p=>p.hidden=true);
    const hint=document.querySelector("[data-required-fields]");if(hint)hint.hidden=true;
    if (announce && statusText) {
      statusText.textContent = "已清空输入与结果。内容只保留在当前页面内存中。";
    }
  };

  const readUserFacts = () => {
    const facts = [];
    const scope = { edition_id: null, track_id: null, institution_id: null };
    app.querySelectorAll("[data-user-field]").forEach((field) => {
      const factId = field.dataset.userField;
      let value;
      if (field instanceof HTMLSelectElement) {
        if (!field.value) return;
        value = field.value === "true" ? true : field.value === "false" ? false : field.value;
      } else if (field.type === "number") {
        if (field.value.trim() === "") return;
        if (!field.reportValidity()) throw new Error("请检查数值输入范围。");
        value = Number(field.value);
        if (!Number.isFinite(value)) throw new Error("请填写有效数字。");
      } else {
        value = field.value.trim();
        if (!value) return;
      }
      facts.push({ fact_id: factId, value, status: "PROVIDED", scope, evidence_refs: [] });
    });

    const teamSize = facts.find((fact) => fact.fact_id === "team_size")?.value;
    const eligibleInternationalMembers = facts.find(
      (fact) => fact.fact_id === "eligible_international_member_count",
    )?.value;
    if (Number.isInteger(teamSize) && teamSize > 0 &&
        Number.isInteger(eligibleInternationalMembers) &&
        eligibleInternationalMembers >= 0 && eligibleInternationalMembers <= teamSize) {
      facts.push({
        fact_id: "eligible_international_member_ratio",
        value: eligibleInternationalMembers / teamSize,
        status: "PROVIDED",
        scope,
        evidence_refs: [],
      });
    }

    const preferences = Array.from(app.querySelectorAll("[data-user-preference]:checked"))
      .map((field) => field.value);
    if (preferences.length) {
      facts.push({
        fact_id: "preferred_topics",
        value: preferences,
        status: "PROVIDED",
        scope,
        evidence_refs: [],
      });
    }
    return facts;
  };

  const referenceText = (references) => {
    if (!Array.isArray(references) || references.length === 0) return "";
    return references.map((reference) => {
      if (typeof reference === "string") return reference;
      if (!reference || typeof reference !== "object") return "";
      return reference.claim_id || reference.requirement_id || reference.source_id || "";
    }).filter(Boolean).join(" · ");
  };

  const safeEvidenceUrl = (value) => {
    if (typeof value !== "string" || !value.trim()) return null;
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
      return url.href;
    } catch {
      return null;
    }
  };

  const appendEvidenceLinks = (container, references) => {
    if (!Array.isArray(references)) return;
    references.forEach((reference) => {
      if (!reference || typeof reference !== "object") return;
      const href = safeEvidenceUrl(reference.source_url || reference.safe_url);
      if (!href) return;
      const label = [reference.label || reference.claim_id || reference.source_id, reference.locator]
        .filter(Boolean).join(" · ") || "查看官方来源";
      const link = element("a", "eligibility-evidence-link", label);
      link.href = href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      container.appendChild(link);
    });
  };

  const appendConditions = (container, dimension) => {
    resultGroups.forEach(([key, label]) => {
      const items = Array.isArray(dimension?.[key]) ? dimension[key] : [];
      if (!items.length) return;
      const group = element("div", "eligibility-reason-group");
      group.appendChild(element("h5", "", label));
      const list = element("ul", "eligibility-reason-list");
      items.forEach((item) => {
        const entry = element("li", "");
        const title = item?.label || item?.condition_id || item?.conditionId || "规则条件";
        entry.appendChild(element("strong", "", title));
        const reason = item?.reason;
        if (typeof reason === "string" && reason.trim()) {
          entry.appendChild(element("p", "", natural(reason)));
          if (polished && natural(reason) !== reason) {
            const raw = element("details", "eligibility-condition-evidence");
            raw.appendChild(element("summary", "", "原始状态说明"));raw.appendChild(element("p", "", reason));entry.appendChild(raw);
          }
        }
        const itemEvidence = Array.isArray(item?.evidence_refs) ? item.evidence_refs : [];
        const refs = referenceText(itemEvidence.length ? itemEvidence : item?.requirement_refs);
        if (refs || itemEvidence.length) {
          const evidence = element("details", "eligibility-condition-evidence");
          evidence.appendChild(element("summary", "", "查看此项依据"));
          if (refs) evidence.appendChild(element("small", "eligibility-reference", `依据编号：${refs}`));
          appendEvidenceLinks(evidence, itemEvidence);
          entry.appendChild(evidence);
        }
        list.appendChild(entry);
      });
      group.appendChild(list);
      container.appendChild(group);
    });

    const evidenceRefs = referenceText(dimension?.evidence_refs);
    if (evidenceRefs || dimension?.evidence_refs?.length) {
      const evidence = element("details", "eligibility-condition-evidence");
      evidence.appendChild(element("summary", "", "查看公开证据"));
      if (evidenceRefs) evidence.appendChild(element("p", "eligibility-reference", `公开证据编号：${evidenceRefs}`));
      appendEvidenceLinks(evidence, dimension?.evidence_refs);
      container.appendChild(evidence);
    }
  };

  const renderResult = (competition, result) => {
    const card = element("article", "eligibility-result-card");
    card.dataset.recordKind = competition.record_kind || "UNKNOWN";
    card.dataset.editionId = competition.edition_id || "UNKNOWN";
    if (competition.evaluation_track?.track_id) card.dataset.trackId = competition.evaluation_track.track_id;
    const heading = element("div", "eligibility-result-heading");
    const resultTitle = competition.student_presentation?.title || competition.title || competition.edition_id || "赛事示例";
    heading.appendChild(element(
      "h3",
      "",
      competition.evaluation_track?.track_name
        ? `${resultTitle} · ${competition.evaluation_track.track_name}`
        : resultTitle,
    ));
    const meta = element("div", "eligibility-result-meta");
    meta.appendChild(element(
      "span",
      competition.record_kind === "SYNTHETIC_DEMO" ? "eligibility-record-kind synthetic-record" : "eligibility-record-kind official-record",
      competition.record_kind === "SYNTHETIC_DEMO"
        ? "合成示例 · 非官方"
        : competition.evaluation_track ? "届次与所选赛道规则" : "届次规则",
    ));
    const ruleLabel = result?.rule_id ||
      (Array.isArray(result?.rule_ids) && result.rule_ids.length ? result.rule_ids.join(" + ") : "规则编号未知");
    const ruleEvidence = element("details", "eligibility-rule-evidence");
    ruleEvidence.appendChild(element("summary", "", "规则编号"));
    ruleEvidence.appendChild(element("code", "eligibility-rule-id", ruleLabel));
    meta.appendChild(ruleEvidence);
    heading.appendChild(meta);
    card.appendChild(heading);

    const eligibilitySummary = result?.eligibility_summary || "UNKNOWN";
    card.appendChild(element(
      "p",
      `eligibility-summary summary-${String(eligibilitySummary).toLowerCase()}`,
      eligibilitySummaryLabels[eligibilitySummary] || "资格待核验",
    ));

    if (result?.scope_validation?.status !== "VALID") {
      const validation = result?.scope_validation || {};
      const state = element("p", "eligibility-validation", statusLabels[validation.status] || "规则范围待核对");
      card.appendChild(state);
      if (Array.isArray(validation.errors)) {
        validation.errors.forEach((error) => {
          const detail = typeof error === "string" ? error : error?.code || "规则范围待核对";
          card.appendChild(element("p", "muted", detail));
        });
      }
    }

    const dimensionGrid = element("div", "eligibility-dimensions");
    dimensionSpecs.forEach(([key, label]) => {
      const dimension = result?.dimensions?.[key] || {};
      const status = dimension.status || "UNKNOWN";
      const panel = element("section", `eligibility-dimension status-${status.toLowerCase()}`);
      panel.appendChild(element("h4", "", label));
      const statusLabel = key === "entry_path" && status === "TRUE"
        ? "已找到官方入口"
        : statusLabels[status] || status;
      const badge = element("span", "eligibility-dimension-status", statusLabel);
      badge.setAttribute("data-status", status);
      panel.appendChild(badge);
      appendConditions(panel, dimension);
      if (!panel.querySelector(".eligibility-reason-group") && !dimension.evidence_refs?.length) {
        panel.appendChild(element("p", "muted", "当前规则没有提供可展示的条件依据。"));
      }
      dimensionGrid.appendChild(panel);
    });
    card.appendChild(dimensionGrid);
    return card;
  };

  const evaluateLocally = async () => {
    if (!window.RadarEligibility || typeof window.RadarEligibility.evaluate !== "function") {
      if (statusText) statusText.textContent = "本地规则引擎暂不可用；示例规则仍可在下方查看。";
      return;
    }
    if (!catalog || !Array.isArray(catalog.official_competitions) || !Array.isArray(catalog.demo_competitions)) {
      if (statusText) statusText.textContent = "示例规则数据不可用，当前无法计算。";
      return;
    }

    clearResults();
    if (polished && publicContext()) return;
    if (statusText) statusText.textContent = "正在此设备的浏览器内计算；个人输入不会离开此页面。";
    if (runButton) runButton.disabled = true;
    try {
      const userFacts = readUserFacts();
      const asOf = app.dataset.asOf || "";
      const results = [];
      let selectedEditionId = eventSelector?.value || "";
      const includeDemos = demoToggle?.checked === true;
      let competitions = [];
      let selectedTrack = null;
      if (trackSelector?.value) {
        try {
          const selection = JSON.parse(trackSelector.value);
          if (Array.isArray(selection) && selection.length === 2 &&
              selection.every((value) => typeof value === "string")) {
            selectedEditionId = selection[0];
            if (eventSelector) eventSelector.value = selectedEditionId;
            const selectedTrackId = selection[1];
            const selectedCompetition = catalog.official_competitions.find(
              (item) => item.edition_id === selectedEditionId,
            );
            selectedTrack = selectedCompetition?.tracks?.find(
              (item) => item.track_id === selectedTrackId,
            ) || null;
          }
        } catch {
          selectedTrack = null;
        }
      }
      competitions = catalog.official_competitions.filter((item) => item.edition_id === selectedEditionId);
      if (includeDemos) competitions = competitions.concat(catalog.demo_competitions);
      if (!competitions.length) {
        if (statusText) statusText.textContent = "请先选择一场赛事，再核对你的条件。";
        eventSelector?.focus();
        return;
      }
      for (const competition of competitions) {
        const appliesSelectedTrack = competition.record_kind !== "SYNTHETIC_DEMO" &&
          selectedTrack && competition.edition_id === selectedTrack.rule?.scope?.edition_id;
        const evaluationTrack = appliesSelectedTrack ? selectedTrack : null;
        const rules = Array.isArray(competition.rules) ? competition.rules.slice() : [];
        if (evaluationTrack?.rule) rules.push(evaluationTrack.rule);
        if (!rules.length) continue;
        const factsById = new Map();
        (Array.isArray(competition.facts) ? competition.facts : []).forEach((fact) => {
          if (fact && typeof fact.fact_id === "string") factsById.set(fact.fact_id, fact);
        });
        (Array.isArray(evaluationTrack?.facts) ? evaluationTrack.facts : []).forEach((fact) => {
          if (fact && typeof fact.fact_id === "string") factsById.set(fact.fact_id, fact);
        });
        const resultCompetition = evaluationTrack
          ? { ...competition, evaluation_track: evaluationTrack }
          : competition;
        const input = {
          contract_version: catalog.contract_version,
          as_of: asOf,
          subject: {
            edition_id: competition.edition_id,
            track_id: evaluationTrack?.track_id ?? competition.track_id ?? null,
            institution_id: competition.institution_id ?? null,
          },
          user: { facts: userFacts },
          facts: Array.from(factsById.values()),
          rules,
        };
        const result = await Promise.resolve(window.RadarEligibility.evaluate(input));
        results.push({ competition: resultCompetition, result });
      }

      const fragment = document.createDocumentFragment();
      results.forEach(({ competition, result }) => {
        fragment.appendChild(renderResult(competition, result));
      });
      resultsList?.replaceChildren(fragment);
      if (resultsSection) resultsSection.hidden = false;
      if (resultsEmpty) resultsEmpty.hidden = results.length > 0;
      const officialCount = results.filter(({ competition }) => competition.record_kind !== "SYNTHETIC_DEMO").length;
      const demoCount = results.length - officialCount;
      if (resultCount) resultCount.textContent = `${officialCount} 场所选赛事${demoCount ? ` · ${demoCount} 个合成示例（非官方）` : ""}`;
      if (profileSummary) {
        const providedCount = userFacts.filter((fact) => fact.fact_id !== "preferred_topics").length;
        const preferenceCount = userFacts.find((fact) => fact.fact_id === "preferred_topics")?.value.length || 0;
        profileSummary.textContent = `${providedCount} 项自述信息已提交本次本地规则核对；只有已核实规则实际引用的字段会影响资格结果。${preferenceCount} 个兴趣偏好仅作为非资格参考。`;
        profileSummary.hidden = false;
      }
      if (statusText) statusText.textContent = "计算完成。结果只在当前页面显示，没有保存或发送。";
      resultsSection?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch {
      clearResults();
      if (statusText) statusText.textContent = "计算没有完成。请检查填写内容后重试；输入仍只保留在当前页面。";
    } finally {
      if (runButton) runButton.disabled = false;
    }
  };

  try {
    const dataNode = document.querySelector("#eligibility-catalog");
    catalog = dataNode ? JSON.parse(dataNode.textContent || "{}") : null;
  } catch {
    catalog = null;
  }

  clearAll(false);
  if (statusText) {
    statusText.textContent = window.RadarEligibility && typeof window.RadarEligibility.evaluate === "function"
      ? "本地规则引擎已就绪。填写任意选填信息后计算；内容仅在当前页面内存中处理。"
      : "本地规则引擎暂不可用；公开说明和示例规则仍可查看。";
  }
  const syncTrackOptions = () => {
    if (!trackSelector) return;
    Array.from(trackSelector.options).forEach((option) => {
      if (!option.value) return;
      try { option.hidden = !!eventSelector?.value && JSON.parse(option.value)[0] !== eventSelector.value; }
      catch { option.hidden = true; }
    });
  };
  eventSelector?.addEventListener("change", () => {
    if (trackSelector) trackSelector.value = "";
    clearResults();
    syncTrackOptions();
  });
  trackSelector?.addEventListener("change", () => {
    clearResults();
    if (trackSelector.value && eventSelector) {
      try { eventSelector.value = JSON.parse(trackSelector.value)[0]; } catch { /* Keep unselected. */ }
    }
    syncTrackOptions();
  });
  function publicContext() {
    const id = eventSelector?.value;
    const panels = Array.from(document.querySelectorAll('[data-public-eligibility]'));
    const selected = panels.find(panel => panel.dataset.publicEligibility === id);
    panels.forEach(panel => { panel.hidden = panel !== selected; });
    const controls=app.querySelector('[data-formal-inputs]');if(controls)controls.hidden=!!selected;
    if(runButton)runButton.hidden=!!selected;
    if (selected) {
      if (statusText) statusText.textContent = '本场可核对公开条件；正式资格仍待核验，请打开对应官方依据。';
      return true;
    }
    return false;
  }
  function requiredFields() {
    if (!polished) return;
    const hint = document.querySelector('[data-required-fields]');
    const item = catalog?.official_competitions?.find(item => item.edition_id === eventSelector?.value);
    const needed = new Set();
    const visit = value => {
      if (!value || typeof value !== 'object') return;
      if (value.source === 'user' && value.fact_id) needed.add(value.fact_id);
      Object.values(value).forEach(child => { if (Array.isArray(child)) child.forEach(visit); else visit(child); });
    };
    (item?.rules || []).forEach(rule => visit(rule.dimensions?.public_rule_fit));
    if (trackSelector?.value) {
      try { const pair=JSON.parse(trackSelector.value);visit(item?.tracks?.find(t=>t.track_id===pair[1])?.rule?.dimensions?.public_rule_fit); } catch {}
    }
    restoreNeeded();
    const host=app.querySelector("[data-needed-inputs]");
    const names=[];
    needed.forEach(id => {
      const input=app.querySelector(`[data-user-field="${id}"]`);
      if(!input) return;
      const label=input.closest('label');names.push(label?.childNodes[0]?.textContent?.trim() || id);
      if(label && host) {
        if(!fieldHomes.has(label)) {const marker=document.createComment('original field position');label.before(marker);fieldHomes.set(label,marker);}
        host.appendChild(label);
      }
    });
    hint.hidden=!names.length;
    hint.textContent=names.length ? '本场已核实规则会用到：'+names.join('、')+'。不确定的条件可留空。' : '';
    publicContext();
  }
  if(polished) {
    eventSelector?.addEventListener('change',requiredFields);
    trackSelector?.addEventListener('change',requiredFields);
  }
  // Only public event identity is read from the fragment; personal inputs never enter URLs.
  const requestedEvent = new URLSearchParams(window.location.hash.slice(1)).get("event");
  if (requestedEvent && eventSelector && catalog?.official_competitions?.some((item) => item.edition_id === requestedEvent)) {
    eventSelector.value = requestedEvent;
    syncTrackOptions();
  } else if (requestedEvent && polished && Array.from(document.querySelectorAll("[data-public-eligibility]")).some(p => p.dataset.publicEligibility === requestedEvent)) {
    eventSelector.value=requestedEvent;publicContext();
  } else if (requestedEvent) {
    const researchLink = Array.from(document.querySelectorAll("[data-research-event]")).find((link) => link.dataset.researchEvent === requestedEvent)
      || Array.from(document.querySelectorAll("[data-competition-id]")).find((record) => record.dataset.competitionId === requestedEvent)?.querySelector("h3 a");
    const context = document.querySelector("[data-research-event-context]");
    if (context) {
      context.hidden = false;
      context.appendChild(element("strong", "", researchLink?.textContent?.trim() || "所选发现赛事"));
      context.appendChild(document.createTextNode("：当前没有对应的 G6 已核实资格规则，正式资格 UNKNOWN。公开研究资料可供核对，不能据此判断个人可报名。"));
      if (researchLink) {
        const back = element("a", "", " 返回此赛事查看公开规则与路径 →");
        back.href = researchLink.href;
        context.appendChild(back);
      }
    }
  }
  if (polished) {
    const track = new URLSearchParams(window.location.hash.slice(1)).get('track');
    if(track && catalog?.official_competitions?.find(i=>i.edition_id===eventSelector?.value)?.tracks?.some(t=>t.track_id===track)) trackSelector.value=JSON.stringify([eventSelector.value,track]);
    requiredFields();
  }
  runButton?.addEventListener("click", evaluateLocally);
  clearButton?.addEventListener("click", () => clearAll(true));
  app.querySelectorAll("[data-user-field]").forEach((field) => {
    field.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && field.tagName !== "SELECT") {
        event.preventDefault();
        evaluateLocally();
      }
    });
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) clearAll(false);
  });
})();
