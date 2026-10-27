"use strict";

((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RadarDecisionEngine = api;
})(typeof globalThis === "object" ? globalThis : this, () => {
  const VERSION = "g1513-task-matching-v1";
  const BUCKETS = Object.freeze({
    PRIORITY: "priority",
    RESEARCH: "research",
    WATCH: "watch",
    UNSUITABLE: "unsuitable",
    INSUFFICIENT: "insufficient",
  });
  const BUCKET_LABELS = Object.freeze({
    priority: "优先准备",
    research: "值得进一步研究",
    watch: "重点观察",
    unsuitable: "当前不适合",
    insufficient: "信息不足",
  });
  const GOALS = Object.freeze({
    algorithm: { label: "算法提高", tokens: ["编程与算法", "算法", "程序设计"] },
    software: { label: "软件项目", tokens: ["软件开发", "软件", "测试", "工程实践"] },
    ai: { label: "AI 应用", tokens: ["AI 与机器学习", "人工智能", "AI", "大模型", "Agent"] },
    portfolio: { label: "作品集", tokens: ["项目 / 作品", "作品", "原型", "项目", "交付成果"] },
    team: { label: "团队工程实践", tokens: ["团队", "工程实践", "软件开发", "创新创业"] },
    award: { label: "了解奖项与认可", tokens: ["奖项", "获奖", "学校认可"] },
  });
  const OBJECTIVES = Object.freeze({
    algorithm: "算法提高",
    software: "软件项目",
    ai: "AI 应用",
    portfolio: "作品集",
    limited_time: "有限时间内完成",
    team: "团队工程实践",
    award: "奖项信息可核验",
  });
  const QUALIFICATION_FIELDS = Object.freeze([
    "student_status", "education_level", "age", "guardian_consent", "team_available",
    "team_size", "full_time_status", "participant_category", "academic_year", "major",
    "team_adviser_count", "eligible_international_member_count", "team_lead_category",
    "cross_school_team", "first_applicant_confirmed", "advisers_from_member_institutions",
    "csp_best_score", "cacc_track", "qiangwang_track",
  ]);

  const asList = (value) => Array.isArray(value) ? value : [];
  const asText = (value) => typeof value === "string" ? value.trim() : "";
  const norm = (value) => asText(value).toLocaleLowerCase("zh-CN").replace(/[\s\p{P}\p{S}]+/gu, "");
  const unique = (items) => Array.from(new Set(items.filter(Boolean)));
  const splitInput = (value) => unique(asText(value).split(/[,，、;；\n|/]+/u).map((item) => item.trim()).filter(Boolean));

  function institutionContextConfig(context, intelligence) {
    let configured = context;
    if (configured === undefined || configured === null) {
      configured = intelligence && intelligence.institution_context;
    }
    if ((configured === undefined || configured === null) && typeof globalThis === "object") {
      const embedded = globalThis.RadarEligibilityIntelligence;
      configured = embedded && embedded.institution_context;
    }
    if (Array.isArray(configured)) configured = { institutions: configured };
    if (!configured || typeof configured !== "object") configured = {};
    const institutions = Array.isArray(configured.institutions)
      ? configured.institutions
      : Array.isArray(configured.institution_registry)
        ? configured.institution_registry : [];
    return {
      institutions: institutions.filter((item) => item && typeof item === "object"),
      focused_institution_id: asText(configured.focused_institution_id) ||
        asText(configured.default_institution_id) || asText(configured.institution_id),
    };
  }

  function institutionLookup(context) {
    const config = institutionContextConfig(context);
    const byAlias = new Map();
    const ambiguousAliases = new Set();
    const byId = new Map();
    config.institutions.forEach((item) => {
      const id = asText(item.institution_id);
      const canonicalName = asText(item.canonical_name || item.name);
      if (!id || !canonicalName || byId.has(id)) return;
      const entry = { institution_id: id, canonical_name: canonicalName };
      byId.set(id, entry);
      unique([canonicalName, asText(item.english_name), asText(item.short_name), ...asList(item.aliases).map(asText)]).forEach((alias) => {
        const key = norm(alias);
        if (!key || ambiguousAliases.has(key)) return;
        const prior = byAlias.get(key);
        if (prior && prior.institution_id !== id) {
          byAlias.delete(key);
          ambiguousAliases.add(key);
        } else {
          byAlias.set(key, entry);
        }
      });
    });
    return { ...config, byAlias, ambiguousAliases, byId };
  }

  function resolveInstitution(value, context) {
    const lookup = institutionLookup(context);
    const raw = asText(value);
    const key = norm(raw);
    const item = lookup.byId.get(raw) || lookup.byAlias.get(key);
    return item
      ? { status: "MATCHED", institution_id: item.institution_id, canonical_name: item.canonical_name }
      : {
        status: !raw ? "NOT_PROVIDED" : lookup.ambiguousAliases.has(key) ? "AMBIGUOUS" : "UNKNOWN",
        institution_id: null,
        canonical_name: null,
      };
  }

  function focusedInstitution(context, intelligence) {
    const lookup = institutionLookup(institutionContextConfig(context, intelligence));
    const id = lookup.focused_institution_id;
    const item = id ? lookup.byId.get(id) : null;
    return item
      ? { status: "MATCHED", institution_id: item.institution_id, canonical_name: item.canonical_name }
      : { status: id ? "UNKNOWN" : "NOT_PROVIDED", institution_id: null, canonical_name: null };
  }

  function profileInstitution(profile, context) {
    const name = asText(profile && profile.school_name);
    const id = asText(profile && profile.institution_id);
    return resolveInstitution(name || id, context);
  }

  function routeInstitutionContext(profile, context, intelligence) {
    const hasProfileInstitution = Boolean(asText(profile && profile.school_name) || asText(profile && profile.institution_id));
    const schoolIdentity = hasProfileInstitution
      ? profileInstitution(profile, institutionContextConfig(context, intelligence))
      : { status: "NOT_PROVIDED", institution_id: null, canonical_name: null };
    const focusedIdentity = focusedInstitution(context, intelligence);
    const identity = hasProfileInstitution ? schoolIdentity : focusedIdentity;
    return {
      school_identity: schoolIdentity,
      focused_identity: focusedIdentity,
      route_identity: identity,
      source: hasProfileInstitution ? "PROFILE" : identity.status === "MATCHED" ? "FOCUSED_INSTITUTION" : "NONE",
      profile_identity_provided: hasProfileInstitution,
    };
  }

  function relationScopeMatches(relation, competition, record, qualifications) {
    const scope = relation && relation.scope && typeof relation.scope === "object" ? relation.scope
      : relation && relation.evidence_scope && typeof relation.evidence_scope === "object" ? relation.evidence_scope : {};
    const relationEdition = asText(relation && relation.edition_id) || asText(scope.edition_id);
    if (relationEdition) {
      const edition = asText(competition && competition.edition_id) || asText(record && record.edition_id);
      if (!edition || edition !== relationEdition) return false;
    }
    const trackId = asText(relation && relation.track_id) || asText(scope.track_id);
    if (trackId) {
      const selector = asText(relation && relation.track_selector_fact_id) || asText(record && record.track_selector_fact_id);
      if (!selector || qualifications[selector] !== trackId) return false;
    }
    return true;
  }

  function selectedCampusParticipation(competition, record, qualifications, intelligence, routeContext) {
    const topLevel = asList(intelligence && intelligence.campus_relations);
    const recordLevel = asList(record && record.campus_relations);
    const ids = new Set([String(competition.id), String(record.competition_id), ...asList(record.related_competition_ids).map(String)]);
    const relations = [];
    const routes = [];
    const seen = new Set();
    [...topLevel, ...recordLevel].forEach((relation) => {
      if (!relation || typeof relation !== "object") return;
      if (!ids.has(String(relation.competition_id))) return;
      const scope = relation.evidence_scope && typeof relation.evidence_scope === "object" ? relation.evidence_scope
        : relation.scope && typeof relation.scope === "object" ? relation.scope : {};
      const institutionId = asText(relation.institution_id) || asText(scope.institution_id);
      if (!institutionId || routeContext.route_identity.status !== "MATCHED" || routeContext.route_identity.institution_id !== institutionId) return;
      if (!relationScopeMatches(relation, competition, record, qualifications)) return;
      const relationId = asText(relation.relation_id) || asText(relation.claim_id) || [relation.competition_id, institutionId, relation.relation_type || relation.type].join(":");
      if (seen.has(relationId)) return;
      seen.add(relationId);
      const applicability = routeContext.source === "PROFILE" ? "APPLICABLE_TO_SCHOOL" : "APPLICABLE_TO_FOCUSED_CONTEXT";
      const matched = {
        ...relation,
        relation_id: relationId,
        institution_id: institutionId,
        school_applicability: applicability,
        context_source: routeContext.source,
      };
      relations.push(matched);
      const route = relation.route || relation.participation_route ||
        (relation.semantic === "campus_relation.selection_route" ? relation.value : null);
      if (route && typeof route === "object") {
        routes.push({
          ...route,
          route_id: asText(route.route_id) || relationId,
          type: asText(route.type || route.route_type) || asText(relation.relation_type || relation.type) || "CAMPUS_ROUTE",
          institution_id: institutionId,
          campus_only: true,
          relation_id: relationId,
          relation_type: relation.relation_type || relation.type || "UNKNOWN",
          school_applicability: applicability,
          context_source: routeContext.source,
        });
      }
    });
    return { relations, routes };
  }

  function userFacts(profile) {
    const qualification = profile && profile.qualifications && typeof profile.qualifications === "object"
      ? profile.qualifications : {};
    const scope = { edition_id: null, track_id: null, institution_id: null };
    return QUALIFICATION_FIELDS.filter((key) => qualification[key] !== null && qualification[key] !== undefined && qualification[key] !== "")
      .map((fact_id) => ({ fact_id, value: qualification[fact_id], status: "PROVIDED", scope, evidence_refs: [] }));
  }

  function evaluateSingleRuleSet(competition, eligibility, track, profile, evaluator, institutionContext) {
    const rules = asList(eligibility.rules).slice();
    const facts = asList(eligibility.facts).slice();
    let trackId = null;
    if (track) {
      trackId = asText(track.track_id) || null;
      if (track.rule && typeof track.rule === "object") rules.push(track.rule);
      facts.push(...asList(track.facts));
    }
    if (!rules.length || !evaluator || typeof evaluator.evaluate !== "function") {
      return { status: "UNKNOWN", reason: "没有可评估的 G6 资格规则。" };
    }
    try {
      const result = evaluator.evaluate({
        contract_version: eligibility.contract_version,
        as_of: eligibility.as_of,
        subject: {
          edition_id: competition.id,
          track_id: trackId,
          institution_id: profileInstitution(profile, institutionContext).institution_id,
        },
        user: { facts: userFacts(profile) },
        facts,
        rules,
      });
      const state = result && result.dimensions && result.dimensions.public_rule_fit
        ? result.dimensions.public_rule_fit.status : "UNKNOWN";
      return {
        status: state === "TRUE" ? "MATCH" : state === "FALSE" ? "MISMATCH" : "UNKNOWN",
        reason: state === "TRUE" ? "符合此 G6 规则范围内已核实的条件。"
          : state === "FALSE" ? "与此 G6 规则中的至少一项已核实条件不匹配。"
            : "部分资格条件缺少个人信息或官方证据，状态保留 UNKNOWN。",
        result,
        track_id: trackId,
      };
    } catch (_error) {
      return { status: "UNKNOWN", reason: "G15 资格规则无法在此输入下完成评估。" };
    }
  }

  function formalEligibility(competition, profile, evaluator, institutionContext) {
    if (competition.layer !== "g6") {
      return {
        status: "UNKNOWN",
        label: "UNKNOWN · 尚未进入 G6",
        reason: "这条发现记录未通过 G6 正式接纳；不据此推断资格符合或可报名。",
        track_results: [],
      };
    }
    const eligibility = competition.eligibility;
    if (!eligibility || typeof eligibility !== "object") {
      return { status: "UNKNOWN", label: "UNKNOWN · G6 规则未核实", reason: "当前 G6 公开投影没有可评估的一般资格规则。", track_results: [] };
    }
    const tracks = asList(eligibility.tracks).filter((track) => track && typeof track === "object");
    const evaluations = tracks.length
      ? tracks.map((track) => evaluateSingleRuleSet(competition, eligibility, track, profile, evaluator, institutionContext))
      : [evaluateSingleRuleSet(competition, eligibility, null, profile, evaluator, institutionContext)];
    const statuses = evaluations.map((item) => item.status);
    const status = statuses.includes("MATCH") ? "MATCH"
      : statuses.length > 0 && statuses.every((item) => item === "MISMATCH") ? "MISMATCH" : "UNKNOWN";
    const label = status === "MATCH"
      ? (tracks.length ? "MATCH · 至少一个已列赛道符合已核验条件" : "MATCH · 符合已核验条件")
      : status === "MISMATCH" ? "MISMATCH · 不符合已核验条件" : "UNKNOWN · 资格待核对";
    const reason = status === "MATCH"
      ? "这是对 G6 已核实规则的本地初步匹配，不代表主办方审核通过、报名窗口开放或平台受理。"
      : status === "MISMATCH"
        ? "所有已列赛道均与至少一项已核实规则不匹配；不作为当前可报名推荐。"
        : "尚无足够的个人输入或已核实规则得出 MATCH / MISMATCH。UNKNOWN 不代表不符合。";
    return { status, label, reason, track_results: evaluations };
  }

  function researchParticipation(competition, profile, intelligence, institutionContext) {
    const cases = asList(intelligence && intelligence.records);
    const record = cases.find((item) => item && (item.competition_id === competition.id || asList(item.related_competition_ids).includes(competition.id)));
    if (!record) return null;
    const qualifications = profile && profile.qualifications && typeof profile.qualifications === "object"
      ? profile.qualifications : {};
    const routeContext = routeInstitutionContext(profile, institutionContext, intelligence);
    const school = routeContext.school_identity;
    const conditions = asList(record.eligibility_research && record.eligibility_research.conditions);
    const checks = conditions.map((condition) => {
      const fact = qualifications[condition.fact_id];
      const selectedTrack = record.track_selector_fact_id ? qualifications[record.track_selector_fact_id] : null;
      let status = "UNKNOWN";
      if (condition.track_id && !selectedTrack) {
        status = "TRACK_NOT_SELECTED";
      } else if (condition.track_id && selectedTrack !== condition.track_id) {
        status = "NOT_APPLICABLE_TO_SELECTED_TRACK";
      } else if (condition.fact_id === "education_level" && fact) {
        if (condition.operator === "EQ") status = fact === condition.value ? "MATCHES_RESEARCH" : "POTENTIAL_MISMATCH_RESEARCH";
        if (condition.operator === "IN") status = asList(condition.values).includes(fact) ? "MATCHES_RESEARCH" : "POTENTIAL_MISMATCH_RESEARCH";
      } else if (condition.fact_id === "csp_best_score" && fact !== undefined) {
        status = Number(fact) >= Number(condition.value) ? "MATCHES_RESEARCH" : "POTENTIAL_MISMATCH_RESEARCH";
      } else if (condition.fact_id === "team_size" && fact !== undefined) {
        status = Number(fact) >= Number(condition.min) && Number(fact) <= Number(condition.max) ? "MATCHES_RESEARCH" : "POTENTIAL_MISMATCH_RESEARCH";
      } else if (condition.fact_id === "cross_school_team" && fact !== undefined) {
        status = Boolean(fact) === Boolean(condition.value) ? "MATCHES_RESEARCH" : "POTENTIAL_MISMATCH_RESEARCH";
      } else if (condition.fact_id === "team_adviser_count" && fact !== undefined) {
        status = Number(fact) === Number(condition.value) ? "MATCHES_RESEARCH" : "POTENTIAL_MISMATCH_RESEARCH";
      } else if (condition.fact_id === "participant_category") {
        const category = fact || (qualifications.education_level === "undergraduate" ? "ordinary_undergraduate" : null);
        if (category) status = asList(condition.values).includes(category) ? "MATCHES_RESEARCH" : "POTENTIAL_MISMATCH_RESEARCH";
      }
      return { fact_id: condition.fact_id, status, scope: condition.scope, evidence_status: "RESEARCH_ONLY" };
    });
    const potentialMismatch = checks.some((item) => item.status === "POTENTIAL_MISMATCH_RESEARCH");
    const trackNotSelected = checks.some((item) => item.status === "TRACK_NOT_SELECTED");
    const unresolved = checks.filter((item) => ["UNKNOWN", "TRACK_NOT_SELECTED"].includes(item.status));
    const applicableChecks = checks.filter((item) => item.status !== "NOT_APPLICABLE_TO_SELECTED_TRACK");
    const researchStatus = potentialMismatch ? "POTENTIAL_MISMATCH_RESEARCH_ONLY"
      : trackNotSelected ? "TRACK_NOT_SELECTED_RESEARCH_ONLY"
        : unresolved.length ? "CONDITIONS_UNRESOLVED_RESEARCH_ONLY"
          : "MATCHES_STATED_CONDITIONS_RESEARCH_ONLY";
    const campusParticipation = selectedCampusParticipation(competition, record, qualifications, intelligence, routeContext);
    const routes = asList(record.routes).flatMap((route) => {
      if (!route || typeof route !== "object") return [];
      const campusOnly = route.campus_only === true || route.scope_type === "CAMPUS_ONLY";
      if (campusOnly && (!route.institution_id || routeContext.route_identity.status !== "MATCHED" || routeContext.route_identity.institution_id !== route.institution_id)) return [];
      let applicability = route.applicability || "UNKNOWN";
      const selectedTrack = record.track_selector_fact_id ? qualifications[record.track_selector_fact_id] : null;
      if (route.track_id && !selectedTrack) {
        applicability = "TRACK_NOT_SELECTED";
      } else if (route.track_id && selectedTrack !== route.track_id) {
        applicability = "NOT_APPLICABLE_TO_SELECTED_TRACK";
      } else if (route.institution_id) {
        if (routeContext.route_identity.status !== "MATCHED") applicability = "SCHOOL_SCOPE_UNKNOWN";
        else if (routeContext.route_identity.institution_id === route.institution_id) {
          applicability = routeContext.source === "PROFILE" ? "APPLICABLE_TO_SCHOOL" : "APPLICABLE_TO_FOCUSED_CONTEXT";
        } else {
          applicability = routeContext.source === "PROFILE" ? "NOT_APPLICABLE_TO_SCHOOL" : "NOT_APPLICABLE_TO_FOCUSED_INSTITUTION";
        }
      } else if (applicability === "REGION_BY_SCHOOL_OR_RESIDENCE") {
        applicability = asText(profile && profile.region) ? "REGION_AND_PORTAL_SELECTION_REQUIRED" : "REGION_NOT_PROVIDED";
      }
      return [{ ...route, school_applicability: applicability }];
    });
    const publicFacts = competition.admitted_public_participation;
    const publicWindows = asList(publicFacts && publicFacts.registration_windows);
    const windows = publicWindows.length ? publicWindows.map((window) => ({ ...window, kind: "registration", status: "ADMITTED_PUBLIC_ONLY", note: window.scope.track_scope + "；时区未说明" })) : asList(record.windows);
    const currentConflict = Boolean(publicFacts && asList(publicFacts.conflicts).length);
    const registrationWindow = windows.find((item) => ["registration", "national_registration", "preliminary_registration_and_submission"].includes(item.kind)) || null;
    const platform = record.platform_acceptance || { status: "UNKNOWN", reason: "平台受理状态未知。" };
    return {
      record,
      formal_eligibility: record.formal_eligibility || { status: "UNKNOWN", reason: "正式资格尚未核验。" },
      eligibility_research: { status: applicableChecks.length ? researchStatus : "NO_CONDITIONS_FOR_SELECTED_TRACK_RESEARCH_ONLY", summary: record.eligibility_research && record.eligibility_research.summary, checks },
      routes: [...routes, ...campusParticipation.routes].filter((route) => !currentConflict || route.type !== "ranked_advancement"),
      campus_relations: campusParticipation.relations,
      route_status: routes.length || campusParticipation.routes.length ? "OFFICIAL_ROUTE_FOUND_RESEARCH_ONLY" : "UNKNOWN",
      registration_window: registrationWindow,
      windows,
      window_status: registrationWindow && registrationWindow.state_as_of || "UNKNOWN",
      platform_acceptance: platform,
      track_conditions: asList(record.track_conditions),
      claims: asList(record.claims),
      unknowns: asList(record.unknowns),
      conflicts: asList(record.conflicts),
      next_steps: currentConflict ? ["CONFLICTED：官方晋级条件存在冲突，暂不作为行动条件；区域赛报名独立核对。"] : asList(record.next_steps),
      school_identity: school,
      focused_institution: routeContext.focused_identity,
      route_context: {
        source: routeContext.source,
        institution_id: routeContext.route_identity.institution_id,
        canonical_name: routeContext.route_identity.canonical_name,
        status: routeContext.route_identity.status,
      },
    };
  }

  function textForCompetition(competition) {
    return [
      competition.title, competition.summary, competition.task, admittedText(competition, ["participation.official_task"]),
      ...asList(competition.categories), ...asList(competition.technical_tags),
      ...asList(competition.skills).map((item) => item && (item.label || item)),
    ].join(" ");
  }

  function goalMatches(competition, goals) {
    const text = norm(textForCompetition(competition));
    const matches = [];
    asList(goals).forEach((goalId) => {
      const goal = GOALS[goalId];
      if (goal && goal.tokens.some((token) => text.includes(norm(token)))) matches.push(goalId);
    });
    return matches;
  }

  // Preserve language punctuation and token boundaries: C, C++ and C# are
  // distinct; CCF/ICT branding is not a required programming language.
  function containsSkill(text, skill) {
    const token = asText(skill).toLocaleLowerCase("zh-CN");
    const content = asText(text).toLocaleLowerCase("zh-CN");
    if (!token) return false;
    if (/^[a-z0-9.+#_-]+$/i.test(token)) {
      const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp("(^|[^a-z0-9_+#])" + escaped + "(?=$|[^a-z0-9_+#])", "i").test(content);
    }
    return norm(content).includes(norm(token));
  }

  function skillFit(competition, profile) {
    const known = unique([
      ...asList(profile && profile.skills),
      ...asList(profile && profile.languages),
      ...asList(profile && profile.technologies),
    ].map(asText).filter(Boolean));
    const expected = unique([
      ...asList(competition.skills).filter((item) => !item || item.kind !== "suggested").map((item) => asText(item && (item.label || item))),
      ...asList(competition.technical_tags).map(asText),
    ].filter(Boolean));
    if (!known.length) return { matched: [], gaps: expected.slice(0, 4), assessed: false };
    const verifiedTask = ["verified", "partial"].includes(competition.task_status) ? competition.task : "";
    const supported = [...expected, verifiedTask, admittedText(competition, ["participation.official_task"])].join(" ");
    const matched = known.filter((skill) => containsSkill(supported, skill));
    const gaps = expected.filter((skill) => !known.some((item) => containsSkill(skill, item) || containsSkill(item, skill))).slice(0, 5);
    return { matched, gaps, assessed: true };
  }

  function evidenceAssessment(competition) {
    if (competition.layer !== "g6" && admittedFields(competition, ["participation.official_task"]).length) return { level: "medium", label: "中 · 任务字段已正式接纳", reason: "Public-only 公开任务按赛道接纳；个人资格仍为 UNKNOWN，未升级为 G6。" };
    if (competition.layer === "lead") {
      return { level: "low", label: "低 · 聚合线索待核验", reason: "仅作发现线索；日期、任务和资格不视为官方已核实。" };
    }
    if (competition.layer === "g6") {
      return { level: "high", label: "高 · G6 正式公开记录", reason: "赛事身份和公开字段来自通过校验的 G6 公开制品；个人资格和平台受理仍单独判断。" };
    }
    const hasSource = asList(competition.sources).some((source) => source && source.official && source.url);
    if (hasSource && ["verified", "partial"].includes(competition.task_status)) {
      const complete = competition.task_status === "verified" && competition.deliverables_status === "verified";
      return complete
        ? { level: "medium", label: "中 · 官方来源已核对", reason: "任务与交付物有赛事官方来源支持，但记录仍处于 Discovery，资格规则未进入 G6。" }
        : { level: "medium", label: "中 · 官方来源部分核对", reason: "有官方来源支持，但任务或交付信息仍有缺口。" };
    }
    return { level: "low", label: "低 · 证据有限", reason: "当前来源或关键任务信息不足，适合继续观察与核验。" };
  }

  function admittedFields(competition, semantics) {
    const publicFacts = competition.admitted_public_participation;
    return asList(publicFacts && publicFacts.fields).filter((field) => field.active_for_decision !== false && !["CONFLICTED", "SUPERSEDED", "INACTIVE", "SEMANTIC_QUARANTINE", "SEMANTIC_QUARANTINED"].includes(field.review_status) && (!semantics || semantics.includes(field.semantic)));
  }

  function admittedText(competition, semantics) {
    return admittedFields(competition, semantics).map((field) => ((field.scope || {}).track_scope || "赛道未注明") + "：" + (field.text || field.value && field.value.text || "UNKNOWN")).join("；");
  }

  function semanticFacts(competition) {
    return {
      registration_conditions: admittedText(competition, ["participation.student_eligibility", "participation.degree_restriction", "participation.school_restriction", "participation.team_size", "participation.prerequisite", "participation.school_route_required", "participation.track_requirement"]),
      registration_fees: admittedText(competition, ["participation.registration_fee"]),
      region_selection: admittedText(competition, ["participation.region_selection"]),
      stage_advancement: admittedFields(competition, ["participation.stage_advancement"]).map((field) => field.scope.track_scope + " / " + field.scope.stage + "：" + (field.text || field.value.text)).join("；"),
      information_pages: admittedFields(competition, ["participation.official_information_url"]).map((field) => ({
        claim_id: field.claim_id, scope: field.scope, url: field.value.url,
        text: field.text || field.value.text, url_role: "OFFICIAL_INFORMATION_PAGE", operation_verified: false,
      })),
    };
  }

  function pendingDateReview(competition) {
    return Boolean(competition.student_presentation && competition.student_presentation.date_review_pending === true);
  }

  function dateReviewNotice(competition) {
    return asText(competition.student_presentation && competition.student_presentation.next_step) || "官方时间正在复核；先阅读最新公告核对适用赛道和报名节点。";
  }

  function publicNextStep(competition) {
    if (pendingDateReview(competition)) return dateReviewNotice(competition);
    const facts = semanticFacts(competition);
    const participation = competition.admitted_public_participation;
    if (asList(participation && participation.conflicts).length) return "CONFLICTED：先核对对应赛道与阶段的官方条件冲突；争议条件暂停用于行动要求，其它独立报名路径另行核对。";
    const routes = asList(participation && participation.routes).filter((route) => route.active_for_decision !== false);
    if (routes.length && routes.every((route) => route.url_role === "REGISTRATION_GUIDE")) return "先阅读对应赛道的官方报名说明，按说明核对注册、登录和缴费；报名操作与平台受理仍 NOT_VERIFIED。";
    if (routes.length) return "按具体赛道核对官方公布的报名步骤；平台受理仍 NOT_VERIFIED。";
    if (facts.information_pages.length) return "先阅读对应赛道的官方信息页，再按官网报名说明核对账号与操作入口；信息页不证明报名操作或平台受理。";
    return "";
  }

  function exactDeadline(competition) {
    if (pendingDateReview(competition)) return null;
    const publicFacts = competition.admitted_public_participation;
    const windows = asList(publicFacts && publicFacts.registration_windows);
    if (windows.length > 1) return null;
    const window = publicFacts && publicFacts.registration_window;
    if (window && window.closes) return { kind: "registration_deadline", label: "官方公布报名截止", date: window.closes.slice(0, 10),
      time: window.closes.length > 10 ? window.closes.slice(11) : null, exact: true, timezone: window.timezone,
      precision: window.precision, display: window.label, provenance_label: "ADMITTED_PUBLIC_ONLY · " + (window.timezone === "UNKNOWN" ? "时区未说明" : window.timezone) };
    return asList(competition.important_dates).find((item) => item && item.exact === true && item.kind === "registration_deadline") ||
      asList(competition.important_dates).find((item) => item && item.exact === true && item.kind === "submission_deadline") || null;
  }

  function timeFeasibility(competition, profile) {
    const rawHours = profile && profile.weekly_hours;
    const hours = rawHours !== null && rawHours !== undefined && rawHours !== "" && Number.isFinite(Number(rawHours))
      ? Number(rawHours) : null;
    const lightPreference = profile && profile.preparation_intensity === "light";
    const deadline = exactDeadline(competition);
    const reasons = [];
    if (hours === null) reasons.push("未填写每周可投入时间。");
    else if (hours <= 4) {
      reasons.push("你填写的周投入时间较有限；官网未公布统一备赛工时，当前无法确认是否来得及。");
      if (["software", "project"].includes(competition.submission_type)) reasons.push("作品型赛事可先缩小成果范围，再按必需交付物估算自己的实际安排。");
    } else reasons.push("已记录你的每周可投入时间；赛事没有可用于对照的官方备赛工时。");
    if (lightPreference && ["software", "project"].includes(competition.submission_type)) {
      reasons.push("你偏好轻量准备；作品型赛事的实际投入要求未知，先看清交付范围再决定是否主攻。");
    }
    const deadlineDate = deadline && asText(deadline.date).slice(0, 10);
    const deadlinePassed = Boolean(deadlineDate && asText(competition.decision_as_of) && deadlineDate < asText(competition.decision_as_of).slice(0, 10));
    if (pendingDateReview(competition)) reasons.push(dateReviewNotice(competition));
    else if (!deadline) reasons.push("没有可用于倒排的精确报名或提交截止日期。");
    else if (deadlinePassed) reasons.push("“" + deadline.label + "”记录日期为 " + deadline.date + "，早于本版数据日期 " + competition.decision_as_of + "；不据此自动判定已截止，请先核对官网是否发布延期或新入口。");
    else reasons.push("最近的精确节点为“" + deadline.label + "”：" + deadline.date + (deadline.provenance_label ? "（" + deadline.provenance_label + "）" : "") + "；平台受理仍需另行确认。");
    const limited = hours !== null && hours <= 4 && ["software", "project"].includes(competition.submission_type);
    const intensityRisk = Boolean(lightPreference && ["software", "project"].includes(competition.submission_type));
    const limitedUnknown = hours !== null && hours <= 4;
    return {
      state: (limited || deadlinePassed || intensityRisk) ? "risk" : (limitedUnknown || !deadline) ? "unknown" : "conditional",
      label: deadlinePassed ? "节点日期已过 · 官网状态待核实" : limited ? "时间风险偏高 · 准备工时未知" : intensityRisk ? "准备强度偏好待核对" : limitedUnknown ? "UNKNOWN · 周投入有限且备赛工时未公布" : !deadline ? "UNKNOWN · 缺少可用的精确节点" : "有条件可规划 · 准备工时未知",
      reasons,
      deadline,
      deadline_passed: deadlinePassed,
    };
  }

  function participationFit(competition, profile) {
    const preference = asText(profile && profile.participation_preference);
    if (!preference || preference === "any" || competition.format === "unknown" || competition.format === "mixed") return "UNKNOWN · 形式偏好无法区分";
    const expectedTeam = competition.format === "team";
    const wantsTeam = preference === "team";
    if (expectedTeam && profile.team_available === false) return "形式相符 · 目前还没有队友，需要先确认组队";
    if (expectedTeam === wantsTeam) return "方向相符 · " + (expectedTeam ? "团队参赛" : "个人参赛");
    return "形式有差异 · " + (expectedTeam ? "赛事要求团队" : "赛事为个人参赛");
  }

  function preferencePenalty(competition, profile) {
    const participation = asText(profile && profile.participation_preference);
    let formatPenalty = 0;
    if (participation && participation !== "any") {
      formatPenalty = ["unknown", "mixed"].includes(competition.format) ? 1
        : (competition.format === "team") === (participation === "team") ? 0 : 2;
      if (participation === "team" && competition.format === "team" && profile.team_available === false) formatPenalty += 1;
    }
    const goals = asList(profile && profile.goals);
    const type = competition.submission_type;
    let goalPenalty = 0;
    if ((goals.includes("software") || goals.includes("portfolio")) && type === "programming") goalPenalty = 2;
    else if (goals.includes("algorithm")) goalPenalty = type === "programming" ? 0 : type === "unknown" ? 1 : 2;
    else if (goals.includes("team")) goalPenalty = competition.format === "team" && ["project", "software"].includes(type) ? 0 : ["unknown", "mixed"].includes(competition.format) ? 1 : 2;
    return [formatPenalty, goalPenalty];
  }

  function recommendationFor(competition, profile, evaluator, intelligence, institutionContext) {
    const qualification = formalEligibility(competition, profile, evaluator, institutionContext);
    const participation = researchParticipation(competition, profile, intelligence, institutionContext);
    const evidence = evidenceAssessment(competition);
    const fit = skillFit(competition, profile);
    const matchedGoals = goalMatches(competition, profile.goals);
    const directions = asList(profile.directions).filter(Boolean);
    const content = norm(textForCompetition(competition));
    const matchedDirections = directions.filter((direction) => content.includes(norm(direction)));
    const timeFocused = asList(profile.goals).includes("limited_time");
    const relevant = matchedGoals.length > 0 || matchedDirections.length > 0 || fit.matched.length > 0 || timeFocused;
    const time = timeFeasibility(competition, profile);
    const reasons = [];
    matchedGoals.slice(0, 2).forEach((id) => reasons.push("目标“" + GOALS[id].label + "”与公开任务方向相符。"));
    matchedDirections.slice(0, 2).forEach((item) => reasons.push("你关注的“" + item + "”出现在赛事方向或任务资料中。"));
    fit.matched.slice(0, 2).forEach((item) => reasons.push("你已填写的“" + item + "”与赛事公开技能要求有重合。"));
    if (timeFocused) reasons.push("你优先考虑有限时间内完成；准备工时未公开，先比较交付形式、精确节点和时间风险。" );
    if (profile.projects && ["software", "project"].includes(competition.submission_type)) reasons.push("你填写的既有项目可用于检查是否能复用部分原型或测试成果。" );
    if (profile.team_available === false && competition.format === "team") reasons.push("你目前还没有队友；需确认组队方式、队伍人数和校内流程。" );
    if (!reasons.length) reasons.push("目前没有与你填写的方向或技能形成明确匹配的公开字段。" );

    const hasVerifiedTask = admittedFields(competition, ["participation.official_task"]).length > 0 || ["verified", "partial"].includes(competition.task_status) && asText(competition.task);
    const historic = competition.cycle_status === "historical";
    const closed = competition.registration_status === "closed";
    let bucket = BUCKETS.WATCH;
    let bucketReason = "相关性可以继续观察，关键准备或时间信息尚未充分核实。";
    const publicFacts = competition.admitted_public_participation;
    const publicWindows = asList(publicFacts && publicFacts.registration_windows);
    const publicWindowClosed = publicWindows.length ? publicWindows.every((window) => window.state_as_of === "PUBLISHED_ENDED") : publicFacts && publicFacts.registration_window && publicFacts.registration_window.state_as_of === "PUBLISHED_ENDED";
    const researchWindowClosed = publicWindowClosed || (!publicFacts || !publicFacts.registration_window) && participation && participation.window_status === "WINDOW_ENDED_BY_PUBLISHED_DEADLINE";
    if (historic || closed || researchWindowClosed || qualification.status === "MISMATCH") {
      bucket = BUCKETS.UNSUITABLE;
      bucketReason = historic ? "这是历史届次，不作为当前报名候选。"
        : closed ? "公开记录显示报名已截止；可查看后续届次，不作为当前报名候选。"
          : researchWindowClosed ? (publicWindowClosed ? "已接纳的官方公布报名截止日已过；平台受理仍未验证，不列为当前报名机会。" : "官方研究记录的公布报名截止日已过；这是 Research-only 时间结论，平台受理仍未验证。")
          : "资格规则显示 MISMATCH，不推荐为当前可以报名的赛事。";
    } else if (!hasVerifiedTask || evidence.level === "low" || competition.cycle_status === "unknown") {
      bucket = BUCKETS.INSUFFICIENT;
      bucketReason = "任务、届次或来源证据不足；先确认官方信息，再决定准备投入。";
    } else if (time.deadline_passed) {
      bucket = BUCKETS.WATCH;
      bucketReason = "公开节点日期早于本版数据日期；先核对官网是否延期或发布新入口，不据旧日期判断当前受理。";
    } else if (relevant && qualification.status === "MATCH" && evidence.level === "high" && competition.cycle_status === "current" && !closed) {
      bucket = BUCKETS.PRIORITY;
      bucketReason = "目标方向、已核实任务和 G6 资格规则都有支撑；报名平台受理仍需单独确认。";
    } else if (relevant && evidence.level !== "low") {
      bucket = BUCKETS.RESEARCH;
      bucketReason = qualification.status === "UNKNOWN"
        ? "方向与任务资料相符；资格仍为 UNKNOWN，先核对适用规则和参赛路径。"
        : "方向与任务资料相符；请再核实报名节点与平台受理状态。";
    }

    if (participation && participation.eligibility_research.status === "POTENTIAL_MISMATCH_RESEARCH_ONLY" && bucket === BUCKETS.PRIORITY) {
      bucket = BUCKETS.RESEARCH;
      bucketReason = "官方来源的 Research-only 资格条件可能与输入不符；正式资格仍为 UNKNOWN，先核对例外和适用范围。";
    }

    const unresolved = unique([
      ...asList(competition.unknowns).slice(0, 4).map(asText),
      qualification.status === "UNKNOWN" ? qualification.reason : "",
      competition.portal_acceptance_status === "unknown" ? "报名平台当前是否受理尚未独立确认。" : "",
      ...(participation ? participation.unknowns.slice(0, 5) : []),
      competition.layer === "lead" ? "聚合线索不能用于确认任务、日期、资格或报名开放状态。" : "",
    ]);
    return {
      id: competition.id,
      title: competition.title,
      layer: competition.layer,
      href: competition.href,
      bucket,
      bucket_label: BUCKET_LABELS[bucket],
      bucket_reason: bucketReason,
      relevant,
      reasons,
      task: admittedText(competition, ["participation.official_task"]) || competition.task,
      summary: competition.summary,
      deliverables: asList(competition.deliverables).slice(0, 5),
      matched_skills: fit.matched,
      skill_gaps: fit.gaps,
      skill_assessed: fit.assessed,
      matched_goals: matchedGoals,
      eligibility: qualification,
      time,
      evidence,
      registration_status: researchWindowClosed ? "closed" : competition.registration_status,
      registration_label: publicWindowClosed ? "CLOSED_BY_PUBLISHED_DEADLINE · Public-only" : researchWindowClosed ? "公布报名截止已过 · Research-only" : competition.registration_label,
      portal_acceptance_status: competition.portal_acceptance_status,
      portal_acceptance_label: participation ? "平台受理未验证 · Research-only" : competition.portal_acceptance_label,
      participation,
      admitted_public_participation: publicFacts || null,
      semantic_facts: semanticFacts(competition),
      cycle_status: competition.cycle_status,
      format_fit: participationFit(competition, profile),
      next_step: publicNextStep(competition) || (participation && participation.next_steps.length
        ? participation.next_steps[0]
        : competition.layer === "lead"
        ? "打开线索来源，确认是否存在当届官方公告；不要按线索日期安排报名。"
        : competition.registration_status === "open"
          ? "打开赛事官网核对当届规则、报名页面和当前受理状态。"
          : "先阅读官方任务与规则，确认届次、资格和报名节点。"),
      sources: [...asList(competition.sources), ...admittedFields(competition).map((field) => ({label: "已接纳字段 · " + field.scope.track_scope, url: field.source.url, official: true}))],
      unknowns: unresolved,
      _sort: [
        ({ priority: 0, research: 1, watch: 2, insufficient: 3, unsuitable: 4 })[bucket],
        ["risk", "unknown"].includes(time.state) ? 1 : 0,
        ...preferencePenalty(competition, profile),
        -matchedGoals.length,
        -matchedDirections.length,
        -fit.matched.length,
        ({ high: 0, medium: 1, low: 2 })[evidence.level],
        competition.title,
      ],
    };
  }

  function recommend(competitions, profile, evaluator, intelligence, institutionContext) {
    const hasInput = asList(profile && profile.goals).length > 0 ||
      asList(profile && profile.directions).length > 0 ||
      asList(profile && profile.skills).length > 0 ||
      asList(profile && profile.languages).length > 0 ||
      asList(profile && profile.technologies).length > 0 ||
      Boolean(profile && (profile.projects || profile.weekly_hours !== null && profile.weekly_hours !== undefined && profile.weekly_hours !== "")) ||
      Boolean(profile && profile.participation_preference && profile.participation_preference !== "any") ||
      Boolean(profile && (profile.school_name || profile.region)) ||
      Boolean(profile && profile.qualifications && Object.keys(profile.qualifications).length);
    if (!hasInput) return { version: VERSION, personalized: false, items: [], buckets: {}, message: "先填写一个目标或一项熟悉的技能；也可以继续浏览全部公开赛事。" };
    const items = asList(competitions).map((item) => recommendationFor(item, profile, evaluator, intelligence, institutionContext));
    items.sort((left, right) => {
      for (let index = 0; index < left._sort.length; index += 1) {
        const a = left._sort[index];
        const b = right._sort[index];
        if (typeof a === "number" && typeof b === "number" && a !== b) return a - b;
        const order = String(a).localeCompare(String(b), "zh-CN", { sensitivity: "base" });
        if (order) return order;
      }
      return 0;
    });
    const buckets = {};
    Object.values(BUCKETS).forEach((bucket) => { buckets[bucket] = items.filter((item) => item.bucket === bucket).length; });
    return { version: VERSION, personalized: true, items, buckets, message: "规则匹配、技能适配、时间风险和证据等级分开展示；结果不是获奖概率。" };
  }

  function objectiveValue(competition, objective, profile, eligibility, evaluator, intelligence, institutionContext) {
    const text = norm(textForCompetition(competition));
    const tags = norm(asList(competition.categories).concat(asList(competition.technical_tags)).join(" "));
    const types = ["programming", "software", "project"].includes(competition.submission_type)
      ? competition.submission_type : "unknown";
    const knownDeliverables = asList(competition.deliverables).length;
    const hasKnownAwardInfo = asText(competition.award_info) && !norm(competition.award_info).includes("unknown");
    const deadlineCount = pendingDateReview(competition) ? 0 : asList(competition.important_dates).filter((date) => date && date.exact).length;
    const match = (tokens) => tokens.some((token) => text.includes(norm(token)) || tags.includes(norm(token)));
    let value = 0;
    let reason = "公开信息不足，无法可靠区分。";
    if (objective === "algorithm") {
      value = types === "programming" ? 3 : match(["算法", "编程与算法"]) ? 2 : 0;
      reason = value ? "任务属于程序解题或明确包含算法内容。" : "公开任务没有明确显示算法训练为核心。";
    } else if (objective === "software") {
      value = types === "software" ? 3 : types === "project" && match(["软件", "开发", "工程"]) ? 3 : types === "project" ? 2 : 0;
      reason = value ? "提交形式与软件实现或工程项目目标相符。" : "当前资料未显示软件项目型交付。";
    } else if (objective === "ai") {
      value = match(["ai", "人工智能", "大模型", "机器学习", "agent", "智能体"]) ? 3 : 0;
      reason = value ? "公开任务或技术标签明确涉及 AI。" : "公开任务未显示 AI 是核心方向。";
    } else if (objective === "portfolio") {
      value = types === "project" && competition.deliverables_status === "verified" ? 3 : types === "project" && knownDeliverables ? 2 : 0;
      reason = value ? "有可沉淀为作品集的项目交付；这不构成获奖或认可承诺。" : "当前没有已核实的项目型交付物。";
    } else if (objective === "limited_time") {
      value = (deadlineCount > 0 ? 1 : 0) + (knownDeliverables > 0 ? 1 : 0) + (types === "programming" ? 1 : 0);
      reason = value ? "官方节点与交付信息较清楚；这不代表准备工时更少。" : "官方节点或交付信息缺失，无法比较时间安排清晰度。";
    } else if (objective === "team") {
      value = competition.format === "team" && ["software", "project"].includes(types) ? 3 : competition.format === "team" ? 2 : 0;
      reason = value ? "公开形式为团队赛，且以作品或工程交付为主。" : "当前资料未显示团队工程实践是合适的优先方向。";
    } else if (objective === "award") {
      value = hasKnownAwardInfo ? 2 : 0;
      reason = hasKnownAwardInfo ? "已有公开奖项信息可核对；不表示获奖概率。" : "没有足够的官方奖项或学校认定信息用于比较。";
    }
    const qualification = formalEligibility(competition, profile, evaluator, institutionContext);
    if (qualification.status === "MISMATCH") value = 0;
    return { value, reason, eligibility: qualification, participation: researchParticipation(competition, profile, intelligence, institutionContext) };
  }

  function compare(competitions, ids, objective, profile, evaluator, intelligence, institutionContext) {
    const selected = asList(ids).map((id) => asList(competitions).find((item) => item.id === id)).filter(Boolean);
    if (selected.length < 2 || selected.length > 4) {
      return { valid: false, message: "请选择 2–4 场赛事进行比较。", items: [], conclusion: "" };
    }
    const ranked = selected.map((competition) => ({
      competition,
      ...objectiveValue(competition, objective, profile, null, evaluator, intelligence, institutionContext),
    })).sort((left, right) => right.value - left.value || left.competition.title.localeCompare(right.competition.title, "zh-CN"));
    const top = ranked[0];
    const second = ranked[1];
    const allEvidenceSufficient = ranked.every((item) => item.competition.layer !== "lead" && item.competition.task_status !== "unknown");
    const clear = top.value > second.value && top.value - second.value >= 1 && allEvidenceSufficient && top.eligibility.status !== "MISMATCH";
    const conclusion = clear
      ? "按“" + (OBJECTIVES[objective] || "所选目标") + "”优先考虑「" + top.competition.title + "」：" + top.reason + " 这只比较公开任务适配，正式报名仍需复核。"
      : "目前无法可靠选出明显占优的一场：" + (allEvidenceSufficient ? "候选的公开方向接近或优势有限。" : "至少一场的任务或来源信息不足。") + "可以先补充官方资料或缩小比较范围。";
    return {
      valid: true,
      objective,
      objective_label: OBJECTIVES[objective] || "所选目标",
      clear_conclusion: clear,
      conclusion,
      items: ranked.map((item) => ({
        id: item.competition.id,
        title: item.competition.title,
        value: item.value,
        reason: item.reason,
        eligibility: item.eligibility,
        participation: item.participation,
        evidence: evidenceAssessment(item.competition),
        semantic_facts: semanticFacts(item.competition),
      })),
    };
  }

  function preparationSteps(competition, profile, intelligence, institutionContext) {
    const steps = [];
    const push = (title, text, kind) => steps.push({ title, text, kind: kind || "准备" });
    if (pendingDateReview(competition)) push("先核对最新官方时间", dateReviewNotice(competition), "日期复核");
    const participation = researchParticipation(competition, profile, intelligence, institutionContext);
    const publicFacts = competition.admitted_public_participation;
    if (publicFacts) {
      if (asList(publicFacts.conflicts).length) push("先核对官方来源冲突", "CONFLICTED：官方来源对以下条件存在不同表述，暂不用于参赛资格结论：" + publicFacts.conflicts.map((conflict) => conflict.text || conflict.reason || JSON.stringify(conflict)).join("；"), "冲突核对");
      const facts = semanticFacts(competition);
      const rules = facts.registration_conditions;
      if (rules) push("逐赛道核对已接纳的参赛条件", rules + "。这些是官方公开条件，个人正式资格仍 UNKNOWN；不要把一个赛道规则套用到另一个赛道。", "官方规则核对");
      if (facts.registration_fees) push("核对赛道报名费用与支付流程", facts.registration_fees + "。这是费用要求；请核对支付对象、单位与回执，费用不作为技术认证、学历或已有成绩资格。", "报名费用");
      if (facts.region_selection) push("按学籍或居住地核对赛区", facts.region_selection + "。赛区选择与参赛学校范围分别判断；承办学校名单不作为学校白名单。", "赛区选择");
      if (facts.stage_advancement) push("另行规划晋级阶段要求", facts.stage_advancement + "。这些条件仅在标注的后续阶段适用；初始报名条件另行核对，不能因尚未满足晋级要求推断报名资格不符。", "阶段晋级");
      if (facts.information_pages.length) push("从官方信息页核对报名说明", facts.information_pages.map((page) => page.scope.track_scope + "：" + page.url).join("；") + "。这些链接为官方信息页，报名操作入口及账号受理须另行核对；平台受理 NOT_VERIFIED。", "官方信息");
      const tasks = admittedText(competition, ["participation.official_task", "participation.submission_requirement"]);
      if (tasks) push("按官方任务核对交付物", tasks + "。先选择适用赛道，再按官方规则准备；后续练习步骤为学习建议。", "官方任务");
      const windows = asList(publicFacts.registration_windows).length ? publicFacts.registration_windows : [publicFacts.registration_window].filter(Boolean);
      if (!pendingDateReview(competition) && windows.length) push("逐赛道核对公告报名截止", windows.map((window) => window.scope.track_scope + "：" + window.label + "；精度 " + window.precision + "；状态 " + window.state_as_of).join("；") + "。平台是否受理仍 NOT_VERIFIED。", "官方时间");
      const routes = asList(publicFacts.routes).length ? publicFacts.routes : [publicFacts.route].filter(Boolean);
      if (routes.length) push("按赛道核对官方参与路径", routes.map((route) => route.scope.track_scope + "（" + (route.url_role === "REGISTRATION_GUIDE" ? "官方报名说明页；操作未验证" : "官方公布路径") + "）：" + route.steps + " · " + route.url).join("；") + "。校内支持未知时先核对学校流程；不推断本校禁止参赛。", "官方路径");
    }
    if (participation) {
      if (participation.eligibility_research.checks.some((item) => item.fact_id === "csp_best_score" && item.status === "UNKNOWN")) {
        push("核实 CSP 前置成绩", "CCSP Research-only 规则要求核对第37至43次 CSP 至少一次达到200分；达到门槛不保证取得名额。", "资格核对");
      }
      if (participation.eligibility_research.status === "POTENTIAL_MISMATCH_RESEARCH_ONLY") {
        push("确认学历类别及正式例外", "官方来源研究提示你填写的学历可能不满足公开对象范围；正式资格仍为 UNKNOWN。核对当届规则是否列有过渡身份。", "资格核对");
      }
      if (participation.routes.some((route) => route.school_applicability === "NOT_APPLICABLE_TO_SCHOOL")) {
        push("选择适用于本校的全国路线", "已识别的校内流程适用于其他学校；它不排除全国赛事路线。不要使用外校内部报名表或截止日期。", "报名路径");
      }
      if (participation.routes.some((route) => route.applicability === "NATIONAL_ROUTE_WITH_SELECTION")) {
        push("核实校级与省级推荐", "国家级参赛需要沿校级、省级选拔或推荐链推进；先向本校确认当届承办部门和推荐办法。", "报名路径");
      }
      if (participation.routes.some((route) => route.school_applicability === "REGION_NOT_PROVIDED" || route.school_applicability === "REGION_AND_PORTAL_SELECTION_REQUIRED")) {
        push("确认适用赛区和赛点", "赛区按学籍或居住地选择；请在官方入口确认可选城市与赛点。承办高校名单不构成参赛学校白名单。", "报名路径");
      }
      if (participation.track_conditions.length) {
        push("先选定具体赛道", "该赛事不同赛道的对象、组队和晋级条件不同。确认目标赛道后，只按该赛道规则核对资格与时间。", "赛道核对");
      }
      if (participation.platform_acceptance.status === "NOT_VERIFIED") {
        push("分别核对报名窗口与平台受理", "本页只核对公布日期和入口；平台是否正在接受提交仍未验证。不要把作品截止日当作新报名期限。", "报名路径");
      }
    }
    if (competition.submission_type === "programming") {
      push("核对当届规则和参赛入口", "在官方来源确认届次、支持语言、考试形式、可用资料、资格和报名截止；入口显示不等于当前受理。", "规则核对");
      push("选定主力语言并做基线练习", "用你熟悉的语言记录一套代表性题目的正确率、耗时和常见错误；先从任务明确涉及的知识点开始。", "算法训练");
      const gaps = skillFit(competition, profile).gaps;
      push("针对能力缺口练习", gaps.length ? "建议先补练：" + gaps.join("、") + "；再用错题记录区分知识缺口、实现错误和时间管理问题。" : "对照官方题型列出 2–3 个待补知识点，再用官方样题或公开题目验证。", "能力补充");
      push("安排限时模拟与复盘", "当官方赛制适用时，模拟比赛环境；复盘超时、边界、调试和读题问题。没有官方题型说明时，不把模拟范围当成官方要求。", "阶段验证");
      push("赛前确认账号、设备与提交流程", "打开官方入口检查账号、环境和提交回执规则；不要把草稿保存或进入报名页当作报名成功。", "提交前自测");
    } else if (["software", "project"].includes(competition.submission_type)) {
      push("读完官方规则并拆分交付物", "逐项记录作品、报告、演示、资格和素材授权要求；日期冲突按适用赛道核对，不自行合并。", "规则核对");
      push("选定可验证的最小成果", profile.preparation_intensity === "light"
        ? "优先只做能验证官方任务的最小核心流程；实际工时未知，先确认作品边界和必需交付物，再决定是否投入。"
        : "围绕官方任务定义一个可演示的核心流程和验收标准，先完成最小原型，再扩展功能。", "原型");
      if (profile.projects) push("评估既有项目复用", "检查“" + profile.projects + "”中可复用的模块、测试或素材；核对原创贡献、授权和当届任务匹配。", "项目复用");
      else push("列出项目边界和团队分工", "写下目标用户、要交付的最小功能、验证方式和责任人；如果已有项目，先确认复用许可和学生原创贡献。", "项目拆解");
      push("验证作品并整理提交材料", "按官方交付物逐项自测，准备可复现运行说明、必要测试结果和演示路径；规则未要求的材料不当作强制项。", "验证");
      push("提交前复核团队与平台状态", "确认队伍人数、跨校规则、导师要求和学校流程；检查平台是否显示正式提交及回执。", "提交前自测");
      if (profile.preparation_intensity === "intensive") {
        push("增加一次用户与异常场景验证", "邀请目标用户试走核心流程，记录失败和修复结果；只做与官方任务相关的扩展，避免用功能数量代替完成质量。", "深入验证");
      }
    } else {
      push("先核对当前届次和官方任务", "打开官方来源确认赛事年份、实际任务、报名对象和交付物；缺失信息保留 UNKNOWN。", "规则核对");
      push("把可核实的要求转成一项小练习", "选择能直接验证任务方向的练习或小原型；在任务和交付物确认前不要投入大规模开发。", "阶段验证");
      push("确认资格、重要节点和平台受理", "分别核对 G6 资格匹配、官方时间和报名平台当前状态；三者互不替代。", "下一步");
    }
    const matched = asList(profile.skills).filter(Boolean);
    if (matched.length) push("利用现有技能", "已有能力：" + matched.join("、") + "。先把它们用于当前任务，再决定是否补充新技术。", "个人化");
    return steps;
  }

  function daysBetween(from, to) {
    const a = Date.parse(from);
    const b = Date.parse(to);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return Math.floor((b - a) / 86400000);
  }

  function buildPlan(competitions, ids, primaryId, profile, intelligence, institutionContext) {
    const selected = asList(ids).map((id) => asList(competitions).find((item) => item.id === id)).filter(Boolean);
    if (!selected.length) return { valid: false, message: "先从推荐中选择一场作为主攻，或将赛事加入比较与计划。", plans: [], conflicts: [] };
    if (selected.length > 4) return { valid: false, message: "一次最多安排 4 场赛事。", plans: [], conflicts: [] };
    const ordered = selected.slice().sort((a, b) => a.id === primaryId ? -1 : b.id === primaryId ? 1 : a.title.localeCompare(b.title, "zh-CN"));
    const plans = ordered.map((competition, index) => ({
      id: competition.id,
      title: competition.title,
      role: index === 0 ? "主攻" : "次优先 / 观察",
      task_type: competition.submission_type,
      task: admittedText(competition, ["participation.official_task"]) || competition.task,
      steps: preparationSteps(competition, profile, intelligence, institutionContext).slice(0, index === 0 ? 12 : 8),
      deadline: exactDeadline(competition),
      evidence: evidenceAssessment(competition),
      semantic_facts: semanticFacts(competition),
      unknowns: asList(competition.unknowns).slice(0, 5),
      sources: [...asList(competition.sources), ...admittedFields(competition).map((field) => ({label: "已接纳字段 · " + field.scope.track_scope, url: field.source.url, official: true}))],
    }));
    const conflicts = [];
    for (let leftIndex = 0; leftIndex < selected.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < selected.length; rightIndex += 1) {
        const left = selected[leftIndex];
        const right = selected[rightIndex];
        const a = exactDeadline(left);
        const b = exactDeadline(right);
        if (a && b) {
          const days = daysBetween(a.date, b.date);
          if (days !== null && Math.abs(days) <= 14) {
            conflicts.push({
              type: "date_overlap",
              title: "官方截止节点接近",
              text: "「" + left.title + "」的" + a.label + "（" + a.date + "）与「" + right.title + "」的" + b.label + "（" + b.date + "）相隔不超过 14 天。两场赛事没有公开准备工时，请确定主攻。",
            });
          }
        } else {
          conflicts.push({ type: "date_unknown", title: "无法确认是否撞期", text: "「" + left.title + "」或「" + right.title + "」没有足够的精确官方节点；当前不能判断两项准备是否撞期。" });
        }
      }
    }
    const projectCount = selected.filter((item) => ["software", "project"].includes(item.submission_type)).length;
    const rawHours = profile && profile.weekly_hours;
    const weeklyHours = rawHours !== null && rawHours !== undefined && rawHours !== "" && Number.isFinite(Number(rawHours))
      ? Number(rawHours) : null;
    if (selected.length > 1 && weeklyHours !== null && weeklyHours > 0 && weeklyHours <= 4) {
      conflicts.push({ type: "capacity", title: "总投入容量需要人工确认", text: "你填写每周 " + profile.weekly_hours + " 小时，同时选择了多场赛事。公开资料没有这些赛事的统一备赛工时；建议只主攻一场，其余设为观察，不假设它们能并行完成。" });
    } else if (projectCount > 1 && weeklyHours !== null && weeklyHours > 4 && weeklyHours <= 6) {
      conflicts.push({ type: "capacity", title: "作品准备容量需要人工确认", text: "你填写每周 " + profile.weekly_hours + " 小时，同时选择了多项作品型赛事。公开资料没有备赛工时估计；建议只主攻一场，其余设为观察，不把时间平均拆分成伪精确计划。" });
    }
    return {
      valid: true,
      weekly_hours: weeklyHours,
      capacity_note: weeklyHours !== null
        ? "每周可投入 " + profile.weekly_hours + " 小时是你的时间上限输入；赛事没有官方统一备赛工时，计划只安排任务顺序，不估算总工时。"
        : "未填写每周可投入时间；赛事没有官方统一备赛工时，当前只安排任务顺序。",
      plans,
      conflicts,
    };
  }

  function planMarkdown(plan, profile) {
    const lines = ["# Competition Radar · 备赛计划", "", "> 本计划为本机生成的准备建议，不是官方要求、资格结论或获奖预测。", "", plan.capacity_note || ""];
    asList(plan.plans).forEach((item) => {
      lines.push("", "## " + item.role + " · " + item.title, "", "任务：" + (item.task || "UNKNOWN"));
      if (item.deadline) lines.push("截止：" + item.deadline.label + " · " + item.deadline.date + "（以官方来源为准）");
      lines.push("", "### 行动步骤");
      asList(item.steps).forEach((step, index) => lines.push((index + 1) + ". **" + step.title + "** — " + step.text));
      if (item.unknowns.length) lines.push("", "### 待核对", ...item.unknowns.map((value) => "- " + value));
      if (item.sources.length) lines.push("", "### 官方资料", ...item.sources.filter((source) => source.url).map((source) => "- [" + (source.label || source.name || "官方来源") + "](" + source.url + ")"));
    });
    if (asList(plan.conflicts).length) lines.push("", "## 时间与容量提醒", ...plan.conflicts.map((item) => "- **" + item.title + "**：" + item.text));
    lines.push("", "个人输入仅用于生成此下载文件；网站不会保存或上传。", "");
    return lines.join("\n");
  }

  return {
    VERSION,
    BUCKETS,
    BUCKET_LABELS,
    GOALS,
    OBJECTIVES,
    formalEligibility,
    evidenceAssessment,
    skillFit,
    recommendationFor,
    recommend,
    objectiveValue,
    compare,
    timeFeasibility,
    preparationSteps,
    buildPlan,
    planMarkdown,
    splitInput,
    admittedFields,
    semanticFacts,
    resolveInstitution,
    researchParticipation,
  };
});
