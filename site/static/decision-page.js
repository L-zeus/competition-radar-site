(function () {
  "use strict";

  const root = document.querySelector("[data-decision-app]");
  const catalog = window.RadarDecisionCatalog;
  const engine = window.RadarDecisionEngine;
  const intelligence = window.RadarEligibilityIntelligence;
  const campusIntelligence = window.RadarCampusIntelligence;
  const institutionContext = campusIntelligence && campusIntelligence.institution_context;
  if (!root || !catalog || !engine || root.dataset.initialized) return;
  root.dataset.initialized = "true";

  const competitions = Array.isArray(catalog.competitions) ? catalog.competitions : [];
  const compareIds = new Set();
  const planIds = new Set();
  let profile = {};
  let recommendation = null;
  let plan = null;
  let showAll = false;
  const sharedExplanations = new Set();
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const add = (parent, tag, className, content) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined && content !== null) node.textContent = document.body.hasAttribute("data-ux-polish") && !parent.closest?.("details") ? String(content).replaceAll("UNKNOWN", "待核验").replaceAll("NOT_VERIFIED", "尚未验证").replaceAll("ADMITTED_PUBLIC_ONLY", "已接纳公开资料") : String(content);
    parent.appendChild(node);
    return node;
  };
  const text = (value, fallback) => typeof value === "string" && value.trim() ? value.trim() : fallback;
  const localHref = (competition) => {
    if (typeof competition.href !== "string" || !competition.href) return null;
    const rootLink = new URL("../index.html", window.location.href);
    const base = rootLink.href.replace(/index\.html(?:[?#].*)?$/, "");
    try {
      const resolved = new URL(competition.href, base);
      return resolved.origin === window.location.origin ? resolved.href : null;
    } catch (_error) {
      return null;
    }
  };
  const sourceUrl = (source) => {
    if (!source || typeof source.url !== "string") return null;
    try {
      const parsed = new URL(source.url, window.location.href);
      return ["https:", "http:"].includes(parsed.protocol) ? parsed.href : null;
    } catch (_error) {
      return null;
    }
  };
  const listText = (items, fallback) => Array.isArray(items) && items.length ? items.join("、") : fallback;
  const displayScope = (value) => {
    const labels = {
      "edition-wide registration notice; track requirements remain separate": "全赛事报名公告（各赛道条件分别适用）",
      "edition-wide; track-specific requirements remain separate": "全赛事通用（各赛道条件分别适用）",
      "edition-wide fee policy; travel and accommodation excluded": "全赛事费用政策（不含交通住宿）",
      "traditional three tracks vs WeChat Xiaowei special": "传统三赛项与微信小微专项分别适用",
      "traditional team track; vocational students only": "传统团队赛项（仅高职学生）",
      "all tracks; national final progression": "各赛项国赛晋级阶段",
      "national final; not regional entry": "全国决赛（不适用于区域赛报名）",
      "regional；报名原文补证": "区域赛报名",
      "regional；资格原文补证": "区域赛参赛条件",
      "regional；费用": "区域赛费用",
      "regional；退赛与缺赛": "区域赛退赛与缺赛",
    };
    return Object.entries(labels).reduce((result, [raw, label]) => result.split(raw).join(label), value);
  };
  const taskPreview = (value) => {
    value = displayScope(value);
    const sentence = value.match(/^.{12,}?[。！？]/u);
    return sentence ? sentence[0] : value.length > 110 ? value.slice(0, 110) + "…" : value;
  };
  const WINDOW_LABELS = {
    registration: "报名窗口", national_registration: "全国报名窗口",
    preliminary_registration_and_submission: "初赛报名与作品提交",
    work_creation: "作品完成时段", national_submission: "国赛资料提交",
    qualification_review: "资格审核", work_submission: "作品提交",
    live_ctf_preliminary: "实网对抗初赛", competition: "比赛时间",
    regional_competition: "区域赛比赛时间", national_final: "全国总决赛",
    current_phase: "当前赛期", edition_state: "届次状态",
  };
  const WINDOW_STATES = {
    WINDOW_ENDED_BY_PUBLISHED_DEADLINE: "公布截止已过",
    PUBLISHED_OPEN: "公布窗口内",
    PUBLISHED_WINDOW_WITH_TENTATIVE_END: "截止日暂定",
    CONFLICT_UNRESOLVED: "日期冲突未解决",
    HISTORICAL_COMPLETED: "本届已结束",
  };
  function windowLabel(window) {
    if (!window) return "UNKNOWN · 未核实报名窗口";
    const range = window.opens || window.starts
      ? (window.opens || window.starts) + (window.closes || window.ends ? " 至 " + (window.closes || window.ends) : "")
      : window.value || (Array.isArray(window.values) ? window.values.join("；") : "日期未提供");
    const state = WINDOW_STATES[window.state_as_of] || window.status || "Research-only";
    return (WINDOW_LABELS[window.kind] || window.kind || "时间节点") + "：" + range + " · " + state;
  }

  function collectProfile() {
    const fields = {};
    $$("[data-profile]").forEach((input) => {
      const key = input.dataset.profile;
      const value = input.value.trim();
      if (!value) return;
      if (["directions", "languages", "technologies"].includes(key)) fields[key] = engine.splitInput(value);
      else if (key === "weekly_hours") fields[key] = Number(value);
      else if (key === "team_available") fields[key] = value === "true";
      else fields[key] = value;
    });
    fields.goals = $$("[data-goal]:checked").map((input) => input.value);
    fields.skills = [...(fields.languages || []), ...(fields.technologies || [])];
    fields.qualifications = {};
    $$("[data-qualification]").forEach((input) => {
      const value = input.value.trim();
      if (!value) return;
      fields.qualifications[input.dataset.qualification] = ["age", "team_size", "academic_year", "team_adviser_count", "csp_best_score"].includes(input.dataset.qualification)
        ? Number(value) : value === "true" ? true : value === "false" ? false : value;
    });
    fields.school_identity = engine.resolveInstitution(fields.school_name, institutionContext);
    if (fields.school_identity.status === "MATCHED") fields.institution_id = fields.school_identity.institution_id;
    if (Object.prototype.hasOwnProperty.call(fields, "team_available")) {
      fields.qualifications.team_available = fields.team_available;
    }
    return fields;
  }

  function renderSourceLinks(parent, items) {
    const safeItems = (Array.isArray(items) ? items : []).map((source) => ({ source, url: sourceUrl(source) })).filter((item) => item.url);
    if (!safeItems.length) return;
    const list = add(parent, "div", "decision-official-links");
    safeItems.slice(0, 4).forEach(({ source, url }) => {
      const link = add(list, "a", "", text(source.label, "打开赛事资料"));
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    });
  }

  function makeCard(item) {
    const competition = competitions.find((candidate) => candidate.id === item.id);
    const presentation = item.student_presentation || (competition && competition.student_presentation) || {};
    const title = text(presentation.title, item.title);
    const task = text(presentation.task, text(item.task, item.bucket === "insufficient" ? "公开任务信息不足；先打开来源核对当届规则。" : "当前目录没有足够的任务细节。"));
    const card = add(document.createDocumentFragment(), "article", "decision-card");
    const top = add(card, "div", "decision-card-top");
    add(top, "span", "decision-tag", item.bucket_label);
    add(top, "span", "status-pill", item.layer === "g6" ? "官方赛事规则" : item.layer === "discovery" ? "官方赛事补充" : "赛事线索");
    add(card, "h3", "", title);

    const meta = add(card, "div", "decision-card-meta");
    if (["MATCH", "MISMATCH"].includes(item.eligibility.status)) add(meta, "span", "", item.eligibility.label);
    add(meta, "span", "", item.time.label);
    if (!item.format_fit.startsWith("UNKNOWN")) add(meta, "span", "", item.format_fit);
    const fullTask = task;
    const compactTask = taskPreview(fullTask);
    add(card, "p", "decision-task", compactTask);
    const blocking = item.eligibility.status === "MISMATCH";
    if (blocking) add(card, "p", "decision-card-risk", item.bucket_reason);
    (presentation.critical_restrictions || []).forEach((restriction) => add(card, "p", "decision-card-risk", restriction));
    const fitReason = item.reasons.find((reason) => reason.startsWith("目标") || reason.startsWith("你关注") || reason.startsWith("你已填写"));
    if (fitReason) add(card, "p", "decision-card-reasons", fitReason);
    const nextStep = text(presentation.next_step, item.next_step);
    if (nextStep) add(card, "p", "decision-card-next", "下一步：" + nextStep);
    const studentActions = Array.isArray(presentation.official_actions) ? presentation.official_actions : [];
    if (studentActions.length) {
      const official = add(card, "div", "decision-official-links");
      studentActions.slice(0, 2).forEach((action) => {
        const url = sourceUrl({ url: action.url });
        if (!url) return;
        const link = add(official, "a", "", action.label);
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      });
    }

    const details = add(card, "details", "");
    add(details, "summary", "", "查看完整要求、匹配依据与待核对事项");
    if (fullTask !== compactTask) add(details, "p", "", "完整任务：" + fullTask);
    if (item.summary && item.summary !== item.task) add(details, "p", "", item.summary);
    const detailList = add(details, "ul", "", "");
    const shown = new Set([...sharedExplanations, fitReason, blocking ? item.bucket_reason : null]);
    const reasonRow = (reason) => {
      if (!reason || shown.has(reason)) return;
      shown.add(reason);
      add(detailList, "li", "", reason);
    };
    [item.bucket_reason, ...item.reasons].forEach(reasonRow);
    reasonRow("已有技能重合：" + listText(item.matched_skills, item.skill_assessed ? "尚无明确重合" : "未填写技能"));
    reasonRow("建议补充：" + listText(item.skill_gaps, "当前目录未列出具体技能缺口"));
    item.time.reasons.forEach(reasonRow);
    // Engine unknowns may include eligibility.reason verbatim. Render it once.
    reasonRow(item.eligibility.reason);
    item.unknowns.forEach(reasonRow);
    add(details, "p", "", "证据状态：" + item.evidence.reason);
    add(details, "p", "", "报名状态：" + text(item.registration_label, "UNKNOWN") + "；" + text(item.portal_acceptance_label, "平台受理未知"));
    if (item.participation) {
      const participation = item.participation;
      add(details, "p", "", "正式资格：" + text(participation.formal_eligibility.status, "UNKNOWN") + " · " + text(participation.formal_eligibility.reason, "未核实"));
      add(details, "p", "", "官方资格研究（Research-only）：" + text(participation.eligibility_research.summary, "未提供"));
      if (participation.eligibility_research.checks.length) {
        const checks = add(details, "ul", "", "");
        participation.eligibility_research.checks.forEach((check) => {
          const label = check.status === "MATCHES_RESEARCH" ? "按自述符合研究条件（非正式）"
            : check.status === "POTENTIAL_MISMATCH_RESEARCH" ? "与研究条件可能冲突（非正式）"
              : check.status === "TRACK_NOT_SELECTED" ? "需先选择适用赛道；此条件不能用于其他赛道"
                : check.status === "NOT_APPLICABLE_TO_SELECTED_TRACK" ? "不适用于当前选择的赛道"
              : "缺少个人信息或本届字段（UNKNOWN）";
          add(checks, "li", "", check.fact_id + " · " + label + " · " + check.scope);
        });
      }
      const routeList = add(details, "ul", "", "");
      participation.routes.forEach((route) => {
        const scope = route.school_applicability === "NOT_APPLICABLE_TO_SCHOOL" ? "此校内路线不适用于已识别学校，不代表全国赛事不适用"
          : route.school_applicability === "SCHOOL_SCOPE_UNKNOWN" ? "需先精确确认学校身份"
            : route.school_applicability === "TRACK_NOT_SELECTED" ? "需先选择适用赛道；不能把路线用于其他赛道"
              : route.school_applicability === "NOT_APPLICABLE_TO_SELECTED_TRACK" ? "这条路线属于其他赛道，不适用于当前选择"
            : route.school_applicability === "REGION_NOT_PROVIDED" ? "尚未填写地区，需按学籍或居住地选择赛区"
              : route.school_applicability === "REGION_AND_PORTAL_SELECTION_REQUIRED" ? "已填写地区；仍需在官方入口确认适用赛区和赛点"
            : route.scope;
        const itemNode = add(routeList, "li", "", text(route.type, "参赛路线") + " · " + scope + " · Research-only");
        const url = sourceUrl({ url: route.url });
        if (url) {
          const link = add(itemNode, "a", "", " 打开官方入口 ↗");
          link.href = url;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
        }
        if (route.next_step) add(itemNode, "span", "", "。下一步：" + route.next_step);
      });
      add(details, "p", "", "报名窗口：" + windowLabel(participation.registration_window) + "；平台受理：" + text(participation.platform_acceptance.status, "UNKNOWN") + " · " + text(participation.platform_acceptance.reason, "未核实"));
      participation.windows.forEach((window) => add(details, "p", "", windowLabel(window) + (window.note ? " · " + window.note : "")));
      participation.track_conditions.forEach((track) => {
        add(details, "p", "", "赛道范围（" + text(track.scope, track.track_id || "未命名赛道") + "）：" + [track.eligibility, track.team, track.route].filter(Boolean).join("；") + "。各赛道规则分别适用。");
      });
      participation.conflicts.forEach((conflict) => add(details, "p", "", "未解决冲突：" + text(conflict.conflict_id, "来源冲突") + " · " + text(conflict.resolution, JSON.stringify(conflict.values || []))));
      if (participation.claims.length) {
        const evidenceList = add(details, "ul", "", "");
        participation.claims.forEach((claim) => {
          const source = claim.source || {};
          const evidence = add(evidenceList, "li", "", claim.field + " · " + text(claim.verification_status, "UNKNOWN") + " · " + text(claim.scope && claim.scope.stage, "范围未注明") + " · " + text(source.locator, "来源定位未提供") + (source.excerpt ? " · “" + source.excerpt + "”" : ""));
          const url = sourceUrl({ url: source.url });
          if (url) {
            const link = add(evidence, "a", "", " 打开字段来源 ↗");
            link.href = url;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
          }
        });
      }
      participation.next_steps.forEach((step) => add(details, "p", "", "下一步：" + step));
    }

    if (item.admitted_public_participation) {
      const admitted = item.admitted_public_participation;
      const publicDetails = add(card, "details", "");
      publicDetails.setAttribute("data-testid", "g1510-decision-public-facts");
      add(publicDetails, "summary", "", "已接纳的公开规则与任务 · ADMITTED_PUBLIC_ONLY");
      add(publicDetails, "p", "", "个人正式资格 UNKNOWN；平台受理 NOT_VERIFIED；字段按各自赛道适用。");
      (admitted.registration_windows || [admitted.registration_window].filter(Boolean)).forEach((window) => add(publicDetails, "p", "", "公告报名截止（" + window.scope.track_scope + "）：" + window.label));
      (admitted.routes || [admitted.route].filter(Boolean)).forEach((route) => add(publicDetails, "p", "", (route.url_role === "REGISTRATION_GUIDE" ? "官方报名说明页（" : "官方公布路径（") + route.scope.track_scope + "）：" + route.steps + " · " + route.url));
      const semantic = item.semantic_facts || engine.semanticFacts(competition || {});
      [["报名费用", semantic.registration_fees], ["赛区选择", semantic.region_selection], ["晋级阶段要求", semantic.stage_advancement]].forEach(([label, value]) => {
        if (value) add(publicDetails, "p", "", label + "：" + value);
      });
      semantic.information_pages.forEach((info) => {
        const row = add(publicDetails, "p", "", "官方信息页（" + info.scope.track_scope + "；报名操作未验证）：");
        const url = sourceUrl(info);
        if (url) { const link = add(row, "a", "", "阅读对应赛道信息 ↗"); link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer"; }
      });
      if (semantic.stage_advancement) add(publicDetails, "p", "", "晋级要求按所列阶段适用；初始报名资格另行核对。");
      const fields = add(publicDetails, "ul", "");
      (admitted.fields || []).forEach((field) => {
        const line = add(fields, "li", "", field.scope.track_scope + " / " + field.scope.stage + " · " + field.semantic + "：" + (field.text || field.value.text) + (field.active_for_decision === false ? " · " + (field.review_status || "SOURCE_REVIEW") + "（不用于当前条件判断）" : ""));
        const url = sourceUrl(field.source);
        if (url) { const link = add(line, "a", "", " 官方依据 ↗"); link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer"; }
      });
    }
    const actions = add(card, "div", "decision-card-actions");
    const compareLabel = add(actions, "label", "decision-pick");
    const compareInput = document.createElement("input");
    compareInput.type = "checkbox";
    compareInput.checked = compareIds.has(item.id);
    compareInput.setAttribute("data-compare-pick", item.id);
    compareLabel.append(compareInput, document.createTextNode("加入比较"));
    const planLabel = add(actions, "label", "decision-pick");
    const planInput = document.createElement("input");
    planInput.type = "checkbox";
    planInput.checked = planIds.has(item.id);
    planInput.setAttribute("data-plan-pick", item.id);
    planLabel.append(planInput, document.createTextNode("加入计划"));
    const internal = localHref(competition || {});
    if (internal) {
      const link = add(actions, "a", "", "查看比赛详情");
      link.href = internal;
    }
    renderSourceLinks(details, item.sources);
    return card;
  }

  function renderRecommendations() {
    const list = $("[data-recommendation-list]");
    const empty = $("[data-recommendation-empty]");
    const count = $("[data-recommendation-count]");
    list.replaceChildren();
    const more = $("[data-show-more]");
    more.hidden = true;
    $(".decision-results").hidden = !recommendation;
    if (!recommendation || !recommendation.personalized) {
      count.textContent = "等待填写";
      empty.hidden = false;
      return;
    }
    const items = recommendation.items || [];
    sharedExplanations.clear();
    const grouped = new Map();
    items.forEach((item) => {
      [item.eligibility.reason, item.bucket_reason].forEach((reason) => {
        if (!grouped.has(reason)) grouped.set(reason, []);
        grouped.get(reason).push(item.title);
      });
    });
    const explanations = $("[data-global-eligibility-reasons]");
    explanations.replaceChildren();
    grouped.forEach((titles, reason) => {
      // Generic formal status prose is generated once for the result set.
      // Distinct competition-specific blockers stay on their own cards.
      if (titles.length > 1 || items.some((item) => item.eligibility.reason === reason)) {
        sharedExplanations.add(reason);
        add(explanations, "li", "", reason + " 适用：" + Array.from(new Set(titles)).join("、"));
      }
    });
    count.textContent = "候选 " + Math.min(items.length, showAll ? items.length : 5) + " / " + items.length;
    empty.hidden = items.length > 0;
    const visible = showAll ? items : items.slice(0, 5);
    visible.forEach((item) => list.appendChild(makeCard(item)));
    renderSelection();
    more.hidden = items.length <= 5;
    more.textContent = showAll ? "收起其他赛事" : "显示更多赛事（" + (items.length - 5) + "）";
  }

  function renderSelection() {
    $(".decision-comparison").hidden = compareIds.size === 0;
    $(".decision-planning").hidden = planIds.size === 0;
    $("[data-run-compare]").disabled = compareIds.size < 2;
    $("[data-compare-count]").textContent = "已选 " + compareIds.size + " 场";
    const directSelect = $("[data-direct-compare-event]");
    const previousDirect = directSelect.value;
    directSelect.replaceChildren();
    const directPlaceholder = add(directSelect, "option", "", "从公开目录选择");
    directPlaceholder.value = "";
    competitions.filter((item) => !compareIds.has(item.id)).forEach((item) => {
      const option = add(directSelect, "option", "", item.title);
      option.value = item.id;
    });
    if (Array.from(directSelect.options).some((option) => option.value === previousDirect)) directSelect.value = previousDirect;
    $("[data-direct-compare-add]").disabled = compareIds.size >= 4;
    const selected = Array.from(compareIds).map((id) => competitions.find((item) => item.id === id)).filter(Boolean);
    $("[data-comparison-empty]").textContent = selected.length < 2
      ? "已选“" + (selected[0] ? selected[0].title : "") + "”；再选择一场即可比较。"
      : "已选：" + selected.map((item) => item.title).join("、") + "。选择比较目标后开始。";
    const primary = $("[data-primary-event]");
    const previous = primary.value;
    primary.replaceChildren();
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "先从计划选择中指定主攻赛事";
    primary.appendChild(empty);
    planIds.forEach((id) => {
      const item = competitions.find((competition) => competition.id === id);
      if (!item) return;
      const option = document.createElement("option");
      option.value = id;
      option.textContent = item.title;
      primary.appendChild(option);
    });
    if (planIds.has(previous)) primary.value = previous;
    else if (planIds.size === 1) primary.value = Array.from(planIds)[0];
    if (!planIds.has(primary.value)) plan = null;
    $("[data-plan-count]").textContent = plan ? "已生成 " + plan.plans.length + " 项" : "尚未生成";
    $("[data-export-plan]").disabled = !plan || !plan.valid;
    $$(".decision-card-actions").forEach((actions) => {
      actions.querySelectorAll("[data-selection-jump]").forEach((link) => link.remove());
      const id = actions.querySelector("[data-compare-pick]").dataset.comparePick;
      if (compareIds.has(id)) {
        const link = add(actions, "a", "decision-selection-jump", "比较已选 " + compareIds.size + " 场");
        link.href = "#comparison";
        link.dataset.selectionJump = "compare";
      }
      if (planIds.has(id)) {
        const link = add(actions, "a", "decision-selection-jump", "安排备赛计划");
        link.href = "#planning";
        link.dataset.selectionJump = "plan";
      }
    });
  }

  function renderComparison(result) {
    const empty = $("[data-comparison-empty]");
    const conclusion = $("[data-compare-conclusion]");
    const output = $("[data-comparison-output]");
    if (!result || !result.valid) {
      output.hidden = true;
      output.replaceChildren();
      conclusion.hidden = true;
      empty.hidden = false;
      if (result && result.message) empty.textContent = result.message;
      return;
    }
    empty.hidden = true;
    conclusion.hidden = false;
    conclusion.textContent = result.conclusion;
    output.hidden = false;
    output.replaceChildren();
    const fields = [
      ["赛期", (item) => item.cycle_status === "historical" ? "历史届次" : item.cycle_status === "current" ? "当前届次（以本页数据日期为准）" : "待核实"],
      ["参赛形式", (item) => item.format === "team" ? "团队" : item.format === "individual" ? "个人" : "未知"],
      ["任务", (item) => engine.admittedFields(item, ["participation.official_task"]).map((field) => field.scope.track_scope + "：" + field.text).join("；") || item.task || item.summary || "任务未知"],
      ["交付成果", (item) => listText(item.deliverables, "未核实")],
      ["技术要求", (item) => listText((item.skills || []).map((skill) => typeof skill === "string" ? skill : skill.label), listText(item.technical_tags, "未核实"))],
      ["团队条件", (item) => engine.admittedFields(item, ["participation.team_size"]).map((field) => field.scope.track_scope + "：" + field.text).join("；") || (item.format === "team" ? "团队参赛；队伍人数、导师和跨校限制须按当届官方规则核对。" : item.format === "individual" ? "个人参赛；当届具体规则仍以官网为准。" : "参赛形式或组队细节 UNKNOWN。")],
      ["报名费用", (item, ranked) => ranked.semantic_facts.registration_fees || "UNKNOWN · 费用未核实"],
      ["赛区选择", (item, ranked) => ranked.semantic_facts.region_selection || "UNKNOWN · 适用赛区未核实"],
      ["后续阶段晋级要求", (item, ranked) => ranked.semantic_facts.stage_advancement ? ranked.semantic_facts.stage_advancement + "（仅适用所列后续阶段，初始报名资格另行核对）" : "UNKNOWN · 后续阶段要求未核实"],
      ["官方信息页", (item, ranked) => ranked.semantic_facts.information_pages.map((info) => info.scope.track_scope + "：" + info.url + "（信息发布页；报名操作未验证）").join("；") || "未接纳独立信息页"],
      ["正式资格", (item, ranked) => ranked.eligibility.label],
      ["官方资格研究", (item, ranked) => ranked.participation ? ranked.participation.eligibility_research.summary + "（Research-only；正式资格 " + ranked.participation.formal_eligibility.status + "）" : "没有附加字段级研究"],
      ["报名路径与适用范围", (item, ranked) => item.admitted_public_participation && item.admitted_public_participation.route ? (item.admitted_public_participation.routes || [item.admitted_public_participation.route]).map((route) => route.scope.track_scope + "（" + (route.url_role === "REGISTRATION_GUIDE" ? "官方报名说明页；操作未验证" : "官方公布路径") + "）：" + route.steps + " · " + route.url).join("；") : ranked.participation ? listText(ranked.participation.routes.map((route) => route.type + " · " + route.school_applicability), "路径未知") : "报名路径未核验"],
      ["公布窗口", (item, ranked) => item.student_presentation && item.student_presentation.date_review_pending === true ? text(item.student_presentation.next_step, "官方时间正在复核；请阅读最新公告核对报名节点。") : item.admitted_public_participation && item.admitted_public_participation.registration_window ? (item.admitted_public_participation.registration_windows || [item.admitted_public_participation.registration_window]).map((window) => window.scope.track_scope + "：" + window.label).join("；") : ranked.participation ? windowLabel(ranked.participation.registration_window) : listText((item.important_dates || []).map((date) => date.label + " " + date.date), "无精确官方节点")],
      ["平台实际受理", (item, ranked) => ranked.participation ? ranked.participation.platform_acceptance.status : item.portal_acceptance_label || "UNKNOWN"],
      ["重要节点", (item) => item.student_presentation && item.student_presentation.date_review_pending === true ? text(item.student_presentation.next_step, "官方时间正在复核；请阅读最新公告核对报名节点。") : listText((item.important_dates || []).map((date) => date.label + " " + date.date + (date.provenance_label ? " · " + date.provenance_label : "")), "没有精确官方节点")],
      ["个人目标适配", (item, ranked) => ranked.reason],
      ["主要未知", (item) => listText(item.unknowns, "没有列出关键未知")],
      ["证据", (item, ranked) => ranked.evidence.label + " · " + ranked.evidence.reason],
      ["下一步", (item) => item.student_presentation && item.student_presentation.next_step ? item.student_presentation.next_step : item.sources && item.sources.length ? "打开官方或来源资料核对当届规则与受理状态。" : "先补充可核验的来源资料。"],
    ];
    const primaryLabels = new Set(["赛期", "任务", "交付成果", "公布窗口", "个人目标适配", "下一步"]);
    if (result.items.some((item) => ["MATCH", "MISMATCH"].includes(item.eligibility.status))) primaryLabels.add("正式资格");
    const renderTable = (parent, rows, compact) => {
      const table = add(parent, "table", "");
      const header = add(add(table, "thead", ""), "tr", "");
      add(header, "th", "", "比较维度");
      result.items.forEach((item) => add(header, "th", "", item.title));
      const body = add(table, "tbody", "");
      rows.forEach(([label, getter]) => {
        const row = add(body, "tr", "");
        add(row, "th", "", label);
        result.items.forEach((ranked) => {
          const competition = competitions.find((candidate) => candidate.id === ranked.id) || {};
          const value = getter(competition, ranked);
          const td = add(row, "td", "", compact ? label === "任务" ? taskPreview(value) : displayScope(value) : value);
          if (label === "正式资格") td.setAttribute("data-eligibility", ranked.eligibility.status);
        });
      });
    };
    renderTable(output, fields.filter(([label]) => primaryLabels.has(label)), true);
    const details = add(output, "details", "decision-comparison-details");
    add(details, "summary", "", "展开完整任务与全部比较维度");
    const extra = fields.filter(([label]) => !primaryLabels.has(label));
    const taskField = fields.find(([label]) => label === "任务");
    renderTable(details, [["完整任务", taskField[1]], ...extra], false);
  }

  function renderPlan(result) {
    const output = $("[data-plan-output]");
    output.replaceChildren();
    const empty = $("[data-plan-empty]");
    if (!result || !result.valid) {
      empty.hidden = false;
      $("[data-plan-count]").textContent = "尚未生成";
      $("[data-export-plan]").disabled = true;
      return;
    }
    empty.hidden = true;
    $("[data-plan-count]").textContent = result.plans.length + " 场 · " + result.conflicts.length + " 条提醒";
    add(output, "p", "quiet-note", result.capacity_note);
    if (result.conflicts.length) {
      const box = add(output, "div", "unknown-callout");
      result.conflicts.forEach((conflict) => add(box, "p", "", conflict.title + "：" + conflict.text));
    }
    result.plans.forEach((item) => {
      const card = add(output, "article", "decision-plan-card");
      add(card, "h3", "", item.role + " · " + item.title);
      const task = text(item.task, "UNKNOWN · 先查官方任务");
      add(card, "p", "", "任务：" + taskPreview(task));
      if (taskPreview(task) !== task) {
        const details = add(card, "details", "");
        add(details, "summary", "", "查看完整官方任务");
        add(details, "p", "", task);
      }
      if (item.deadline) add(card, "p", "", item.deadline.label + "：" + (item.deadline.display || item.deadline.date) + "（" + item.deadline.provenance_label + "；以官方页面复核）");
      const steps = add(card, "ol", "");
      item.steps.forEach((step) => {
        const li = add(steps, "li", "");
        add(li, "strong", "", step.title);
        add(li, "span", "", displayScope(step.text));
        if (displayScope(step.text) !== step.text) {
          const details = add(li, "details", "");
          add(details, "summary", "", "查看原始范围标注");
          add(details, "p", "", step.text);
        }
      });
      if (item.unknowns.length) {
        const details = add(card, "details", "");
        add(details, "summary", "", "仍需核对的信息");
        const ul = add(details, "ul", "");
        item.unknowns.forEach((value) => add(ul, "li", "", value));
      }
      renderSourceLinks(card, item.sources);
    });
  }

  function runRecommendations() {
    const invalid = $$("[data-decision-app] input").find((input) => !input.checkValidity());
    if (invalid) {
      const disclosure = invalid.closest("details");
      if (disclosure) disclosure.open = true;
      $("[data-decision-status]").textContent = "请检查数值范围与步长，再查看推荐。";
      invalid.reportValidity();
      invalid.focus();
      return;
    }
    profile = collectProfile();
    recommendation = engine.recommend(competitions, profile, window.RadarEligibility, intelligence, institutionContext);
    showAll = false;
    plan = null;
    compareIds.clear();
    planIds.clear();
    renderRecommendations();
    renderSelection();
    renderComparison(null);
    renderPlan(null);
    $("[data-decision-status]").textContent = recommendation.message;
    if (recommendation.personalized) $(".decision-results").focus({ preventScroll: true });
  }

  $("[data-run-recommendations]").addEventListener("click", runRecommendations);
  $("[data-show-more]").addEventListener("click", () => { showAll = !showAll; renderRecommendations(); });
  $("[data-recommendation-list]").addEventListener("change", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (input.hasAttribute("data-compare-pick")) {
      if (input.checked && compareIds.size >= 4) { input.checked = false; $("[data-decision-status]").textContent = "一次最多比较 4 场赛事。"; return; }
      input.checked ? compareIds.add(input.dataset.comparePick) : compareIds.delete(input.dataset.comparePick);
      renderSelection();
      renderComparison(null);
    }
    if (input.hasAttribute("data-plan-pick")) {
      if (input.checked && planIds.size >= 4) { input.checked = false; $("[data-decision-status]").textContent = "一次最多安排 4 场赛事。"; return; }
      input.checked ? planIds.add(input.dataset.planPick) : planIds.delete(input.dataset.planPick);
      plan = null;
      renderSelection();
      renderPlan(null);
    }
  });
  $("[data-direct-compare-add]").addEventListener("click", () => {
    const id = $("[data-direct-compare-event]").value;
    if (compareIds.size >= 4 || !competitions.some((item) => item.id === id)) return;
    compareIds.add(id);
    $$("[data-compare-pick]").forEach((input) => { input.checked = compareIds.has(input.dataset.comparePick); });
    renderSelection();
    renderComparison(null);
  });
  $("[data-run-compare]").addEventListener("click", () => {
    const result = engine.compare(competitions, Array.from(compareIds), $("[data-compare-objective]").value, profile, window.RadarEligibility, intelligence);
    renderComparison(result);
  });
  $("[data-clear-compare]").addEventListener("click", () => {
    compareIds.clear();
    $$("[data-compare-pick]").forEach((input) => { input.checked = false; });
    renderSelection();
    renderComparison(null);
  });
  $("[data-build-plan]").addEventListener("click", () => {
    const primaryId = $("[data-primary-event]").value;
    if (!planIds.size) {
      $("[data-plan-empty]").textContent = "先在候選條目中勾選 1–4 场赛事加入计划。";
      $("[data-plan-empty]").hidden = false;
      return;
    }
    plan = engine.buildPlan(competitions, Array.from(planIds), primaryId || Array.from(planIds)[0], profile, intelligence, institutionContext);
    renderPlan(plan);
    renderSelection();
  });
  $("[data-export-plan]").addEventListener("click", () => {
    if (!plan || !plan.valid) return;
    const markdown = engine.planMarkdown(plan, profile);
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "competition-radar-plan.md";
    link.click();
    URL.revokeObjectURL(url);
  });
  function resetResults() {
    compareIds.clear();
    planIds.clear();
    profile = {};
    recommendation = null;
    plan = null;
    showAll = false;
    renderRecommendations();
    renderSelection();
    renderComparison(null);
    renderPlan(null);
  }
  function clearDecision() {
    root.querySelectorAll("input, select").forEach((input) => {
      if (input.type === "checkbox") input.checked = false;
      else input.value = "";
    });
    $("[data-profile='participation_preference']").value = "any";
    $("[data-profile='preparation_intensity']").value = "balanced";
    $("[data-compare-objective]").value = "software";
    root.querySelectorAll("details").forEach((detail) => { detail.open = false; });
    resetResults();
    if (window.location.hash.startsWith("#compare=")) window.history.replaceState(null, "", window.location.pathname + window.location.search);
    $("[data-decision-status]").textContent = "已清空。所有个人输入都只存在于当前页面内存。";
  }
  $("[data-clear-decision]").addEventListener("click", clearDecision);
  root.addEventListener("input", () => {
    if (!recommendation && !compareIds.size && !planIds.size) return;
    resetResults();
    $("[data-decision-status]").textContent = "条件已更改。再次点击“查看推荐”更新结果。";
  });
  // Explicitly clear restored forms and JS state, including the back-forward cache.
  window.addEventListener("pagehide", clearDecision);
  window.addEventListener("pageshow", (event) => { if (event.persisted) clearDecision(); });

  function loadPublicComparison() {
    if (!window.location.hash.startsWith("#compare=")) return;
    let ids;
    try { ids = decodeURIComponent(window.location.hash.slice(9)).split(","); }
    catch (_error) { return; }
    const validIds = ids.filter((id) => competitions.some((item) => item.id === id));
    if (!validIds.length) return;
    compareIds.clear();
    validIds.slice(0, 4).forEach((id) => compareIds.add(id));
    renderSelection();
    renderComparison(compareIds.size >= 2 ? engine.compare(competitions, Array.from(compareIds), $("[data-compare-objective]").value, profile, window.RadarEligibility, intelligence) : null);
    $(".decision-comparison").scrollIntoView({ block: "start" });
  }
  window.addEventListener("hashchange", loadPublicComparison);
  renderRecommendations();
  renderSelection();
  loadPublicComparison();

  function renderSourceReport() {
    const report = window.RadarDecisionSourceReport;
    const list = $("[data-source-checks]");
    if (!report || typeof report !== "object") return;
    const checks = Array.isArray(report.source_checks) ? report.source_checks : [];
    const queue = Array.isArray(report.research_queue) ? report.research_queue : [];
    const changes = report.changes || {};
    $("[data-source-status]").textContent = text(report.status, "已附加刷新报告");
    $("[data-source-summary]").textContent = "来源观察：" + text(report.as_of, "UNKNOWN") + "；完成检查 " + checks.filter((item) => item.source_health_result === "HEALTHY").length + " / " + checks.length + "。新增 " + (changes.added || 0) + "、更新 " + (changes.updated || 0) + "、未变化 " + (changes.unchanged || 0) + "、暂未重见但保留 " + (changes.preserved_missing || 0) + " 条。自动发现只进入 Research Queue。";
    list.replaceChildren();
    checks.forEach((check) => add(list, "li", "", text(check.source_id, "source") + " · " + text(check.fetch_status, "UNKNOWN") + " · " + text(check.source_health_result, "UNKNOWN")));
    $("[data-source-lead-count]").textContent = String(queue.length);
    const leadList = $("[data-source-leads]");
    leadList.replaceChildren();
    queue.forEach((lead) => {
      const li = add(leadList, "li", "");
      const url = sourceUrl({ url: lead.source_url });
      if (url) {
        const link = add(li, "a", "", text(lead.title, "无标题来源线索"));
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      } else {
        add(li, "span", "", text(lead.title, "无标题来源线索"));
      }
      add(li, "span", "source-lead-meta", " · " + text(lead.source_name, "官方来源") + (lead.observed_this_run === false ? " · 本轮未再次观察到" : " · 本轮观察"));
    });
  }
  renderSourceReport();
})();
