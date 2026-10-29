(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RadarEligibility = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CONTRACT_VERSION = "g15.0-eligibility-v1";
  const DIMENSIONS = [
    "public_rule_fit",
    "registration_window",
    "entry_path",
    "preparation_readiness",
  ];
  const STATUS = new Set(["TRUE", "FALSE", "UNKNOWN", "NOT_APPLICABLE"]);

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function canonical(value) {
    if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
    if (isObject(value)) {
      return "{" + Object.keys(value).sort().map(function (key) {
        return JSON.stringify(key) + ":" + canonical(value[key]);
      }).join(",") + "}";
    }
    return JSON.stringify(value);
  }

  function unique(values) {
    const seen = new Set();
    const result = [];
    values.forEach(function (value) {
      if (value === null || value === undefined) return;
      const key = canonical(value);
      if (!seen.has(key)) {
        seen.add(key);
        result.push(value);
      }
    });
    return result;
  }

  function list(value) {
    return Array.isArray(value) ? value.slice() : [];
  }

  function hasReferences(value) {
    return Array.isArray(value) && value.some(function (reference) {
      if (typeof reference === "string") return reference.trim() !== "";
      if (!isObject(reference)) return false;
      return Object.keys(reference).some(function (key) {
        const part = reference[key];
        return (typeof part === "string" && part.trim() !== "") ||
          (typeof part === "number" && Number.isFinite(part));
      });
    });
  }

  function missingValue(value) {
    return value === null || value === undefined ||
      (typeof value === "string" && value.trim() === "");
  }

  function reasonItem(node, status, reasonCode, reason, evidenceRefs, requirementRefs, basis) {
    const item = {
      condition_id: typeof node.id === "string" && node.id ? node.id : "condition",
      label: typeof node.label === "string" && node.label ? node.label : "未命名条件",
      status: status,
      reason_code: reasonCode,
      reason: reason,
      evidence_refs: unique(evidenceRefs || []),
      requirement_refs: unique(requirementRefs || []),
    };
    if (basis) item.basis = basis;
    return item;
  }

  function emptyDetails() {
    return {
      matched_conditions: [],
      mismatched_conditions: [],
      unknown_conditions: [],
      not_applicable_conditions: [],
      evidence_refs: [],
      requirement_refs: [],
    };
  }

  function addItem(details, item) {
    const key = item.status === "TRUE" ? "matched_conditions" :
      item.status === "FALSE" ? "mismatched_conditions" :
      item.status === "NOT_APPLICABLE" ? "not_applicable_conditions" :
      "unknown_conditions";
    details[key].push(item);
    details.evidence_refs = unique(details.evidence_refs.concat(item.evidence_refs));
    details.requirement_refs = unique(details.requirement_refs.concat(item.requirement_refs));
  }

  function invert(status) {
    if (status === "TRUE") return "FALSE";
    if (status === "FALSE") return "TRUE";
    return status;
  }

  function combine(statuses, connective) {
    if (!statuses.length) return "UNKNOWN";
    const applicable = statuses.filter(function (status) { return status !== "NOT_APPLICABLE"; });
    if (!applicable.length) return "NOT_APPLICABLE";
    if (connective === "AND") {
      if (applicable.includes("FALSE")) return "FALSE";
      if (applicable.includes("UNKNOWN")) return "UNKNOWN";
      return "TRUE";
    }
    if (applicable.includes("TRUE")) return "TRUE";
    if (applicable.includes("UNKNOWN")) return "UNKNOWN";
    return "FALSE";
  }

  function scopeStatus(fact, source, env) {
    const scope = fact.scope;
    if (source === "competition") {
      if (!isObject(scope) || typeof scope.edition_id !== "string" || !scope.edition_id.trim()) {
        return { status: "UNKNOWN", reason_code: "FACT_SCOPE_MISSING" };
      }
      if ((scope.track_id != null && (typeof scope.track_id !== "string" || !scope.track_id.trim())) ||
          (scope.institution_id != null && (typeof scope.institution_id !== "string" || !scope.institution_id.trim()))) {
        return { status: "UNKNOWN", reason_code: "FACT_SCOPE_INVALID" };
      }
      if (scope.edition_id !== env.subject.edition_id) {
        return { status: "UNKNOWN", reason_code: "FACT_EDITION_SCOPE_MISMATCH" };
      }
      if (scope.track_id != null && scope.track_id !== env.subject.track_id) {
        return { status: "UNKNOWN", reason_code: "FACT_TRACK_SCOPE_MISMATCH" };
      }
    } else if (scope != null && !isObject(scope)) {
      return { status: "UNKNOWN", reason_code: "FACT_SCOPE_INVALID" };
    } else if (scope) {
      if (["edition_id", "track_id", "institution_id"].some(function (key) {
        return scope[key] != null && (typeof scope[key] !== "string" || !scope[key].trim());
      })) {
        return { status: "UNKNOWN", reason_code: "FACT_SCOPE_INVALID" };
      }
      if (scope.edition_id != null && scope.edition_id !== env.subject.edition_id) {
        return { status: "UNKNOWN", reason_code: "USER_FACT_EDITION_SCOPE_MISMATCH" };
      }
      if (scope.track_id != null && scope.track_id !== env.subject.track_id) {
        return { status: "UNKNOWN", reason_code: "USER_FACT_TRACK_SCOPE_MISMATCH" };
      }
    }

    if (scope && scope.institution_id != null) {
      if (env.subject.institution_id == null) {
        return { status: "UNKNOWN", reason_code: "INSTITUTION_SCOPE_UNKNOWN" };
      }
      if (scope.institution_id !== env.subject.institution_id) {
        return { status: "NOT_APPLICABLE", reason_code: "INSTITUTION_SCOPE_NOT_APPLICABLE" };
      }
    }
    return { status: "TRUE", reason_code: "SCOPE_MATCHED" };
  }

  function resolveFact(ref, env) {
    if (!isObject(ref) || !["user", "competition"].includes(ref.source) ||
        typeof ref.fact_id !== "string" || !ref.fact_id.trim()) {
      return { status: "UNKNOWN", reason_code: "FACT_REFERENCE_INVALID" };
    }
    const pool = ref.source === "user" ? env.userFacts : env.competitionFacts;
    const matches = pool.filter(function (fact) { return isObject(fact) && fact.fact_id === ref.fact_id; });
    if (!matches.length) return { status: "UNKNOWN", reason_code: "FACT_MISSING" };
    if (matches.length > 1) return { status: "UNKNOWN", reason_code: "FACT_REFERENCE_AMBIGUOUS" };

    const fact = matches[0];
    const checkedScope = scopeStatus(fact, ref.source, env);
    if (checkedScope.status !== "TRUE") {
      return {
        status: checkedScope.status,
        reason_code: checkedScope.reason_code,
        evidence_refs: list(fact.evidence_refs),
        basis: ref.source === "user" ? "USER_PROVIDED" : undefined,
      };
    }

    if (ref.source === "competition" && fact.status !== "VERIFIED") {
      return {
        status: "UNKNOWN",
        reason_code: fact.status === "CONFLICTED" ? "FACT_CONFLICTED" : "FACT_NOT_VERIFIED",
        evidence_refs: list(fact.evidence_refs),
      };
    }
    if (ref.source === "user" && !["PROVIDED", "VERIFIED"].includes(fact.status)) {
      return {
        status: "UNKNOWN",
        reason_code: fact.status === "CONFLICTED" ? "USER_FACT_CONFLICTED" : "USER_FACT_UNKNOWN",
        evidence_refs: list(fact.evidence_refs),
      };
    }
    if (ref.source === "user" && fact.status === "VERIFIED" && !hasReferences(fact.evidence_refs)) {
      return { status: "UNKNOWN", reason_code: "USER_EVIDENCE_REFERENCE_MISSING", evidence_refs: [] };
    }
    if (missingValue(fact.value)) {
      return {
        status: "UNKNOWN",
        reason_code: "FACT_VALUE_MISSING",
        evidence_refs: list(fact.evidence_refs),
        basis: ref.source === "user" ? (fact.status === "PROVIDED" ? "USER_PROVIDED" : "USER_VERIFIED") : undefined,
      };
    }
    if (ref.source === "competition" && !hasReferences(fact.evidence_refs)) {
      return { status: "UNKNOWN", reason_code: "EVIDENCE_REFERENCE_MISSING", evidence_refs: [] };
    }
    return {
      status: "TRUE",
      value: fact.value,
      evidence_refs: list(fact.evidence_refs),
      basis: ref.source === "user" ? (fact.status === "PROVIDED" ? "USER_PROVIDED" : "USER_VERIFIED") : undefined,
    };
  }

  function compare(left, operator, right) {
    if (operator === "EQ") return canonical(left) === canonical(right);
    if (operator === "NEQ") return canonical(left) !== canonical(right);
    if (operator === "IN" || operator === "NOT_IN") {
      if (!Array.isArray(right)) return null;
      const found = right.some(function (candidate) { return canonical(candidate) === canonical(left); });
      return operator === "IN" ? found : !found;
    }
    if (operator === "GTE" || operator === "LTE") {
      if (typeof left !== "number" || typeof right !== "number" ||
          !Number.isFinite(left) || !Number.isFinite(right)) return null;
      return operator === "GTE" ? left >= right : left <= right;
    }
    if (operator === "TRUTHY") {
      return left === true ||
        (typeof left === "string" && left.trim() !== "") ||
        (typeof left === "number" && Number.isFinite(left) && left !== 0) ||
        (Array.isArray(left) && left.length > 0);
    }
    return null;
  }

  function parseZonedInstant(value) {
    if (typeof value !== "string" || value.trim() === "") {
      return { error: "REGISTRATION_TIMESTAMP_MISSING" };
    }
    if (value !== value.trim()) return { error: "REGISTRATION_TIMESTAMP_INVALID" };
    const text = value;
    const localTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
    if (localTimestamp.test(text)) return { error: "REGISTRATION_TIMEZONE_REQUIRED" };

    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(text);
    if (!match) return { error: "REGISTRATION_TIMESTAMP_INVALID" };
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6]);
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const monthDays = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > monthDays[month - 1] ||
        hour > 23 || minute > 59 || second > 59) {
      return { error: "REGISTRATION_TIMESTAMP_INVALID" };
    }

    const zone = match[8];
    let offsetSeconds = 0;
    if (zone !== "Z") {
      const offsetHour = Number(zone.slice(1, 3));
      const offsetMinute = Number(zone.slice(4, 6));
      if (offsetHour > 23 || offsetMinute > 59) return { error: "REGISTRATION_TIMESTAMP_INVALID" };
      // RFC 3339 uses -00:00 to mean that the local offset is unknown.
      if (zone === "-00:00") return { error: "REGISTRATION_TIMEZONE_REQUIRED" };
      const direction = zone[0] === "+" ? 1 : -1;
      offsetSeconds = direction * (offsetHour * 3600 + offsetMinute * 60);
    }

    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    date.setUTCHours(hour, minute, second, 0);
    const epochSeconds = date.getTime() / 1000 - offsetSeconds;
    if (!Number.isFinite(epochSeconds)) return { error: "REGISTRATION_TIMESTAMP_INVALID" };
    return {
      instant: {
        seconds: epochSeconds,
        fraction: match[7] ? match[7].slice(1) : "",
      },
    };
  }

  function compareInstants(left, right) {
    if (left.seconds < right.seconds) return -1;
    if (left.seconds > right.seconds) return 1;
    const length = Math.max(left.fraction.length, right.fraction.length);
    for (let index = 0; index < length; index += 1) {
      const leftDigit = index < left.fraction.length ? left.fraction.charCodeAt(index) : 48;
      const rightDigit = index < right.fraction.length ? right.fraction.charCodeAt(index) : 48;
      if (leftDigit < rightDigit) return -1;
      if (leftDigit > rightDigit) return 1;
    }
    return 0;
  }

  function evaluateRegistrationWindow(node, env, negate, details) {
    const requirementRefs = list(node.requirement_refs);
    // Only references on the two resolved competition facts can evidence a
    // registration window; expression-level refs cannot stand in for them.
    const evidenceRefs = [];
    const unknown = function (reasonCode, reason, start, end) {
      const refs = unique(evidenceRefs
        .concat(start ? list(start.evidence_refs) : [])
        .concat(end ? list(end.evidence_refs) : []));
      addItem(details, reasonItem(node, "UNKNOWN", reasonCode, reason, refs, requirementRefs));
      return "UNKNOWN";
    };

    if (!isObject(node.start) || !isObject(node.end) ||
        node.start.source !== "competition" || node.end.source !== "competition") {
      return unknown(
        "REGISTRATION_WINDOW_COMPETITION_FACT_REQUIRED",
        "报名起止时间必须引用届次或赛道范围内的公开竞赛事实",
      );
    }
    const start = resolveFact(node.start, env);
    const end = resolveFact(node.end, env);
    const refs = unique(evidenceRefs.concat(list(start.evidence_refs)).concat(list(end.evidence_refs)));
    if (start.status !== "TRUE" || end.status !== "TRUE") {
      const failed = start.status !== "TRUE" ? start : end;
      const code = failed.status === "NOT_APPLICABLE" ? "FACT_INSTITUTION_SCOPE_MISMATCH" : failed.reason_code;
      const reason = code === "FACT_MISSING" ? "缺少报名起止时间事实" :
        code === "FACT_REFERENCE_AMBIGUOUS" ? "报名起止时间引用对应多条记录" :
        code === "FACT_TRACK_SCOPE_MISMATCH" || code === "FACT_EDITION_SCOPE_MISMATCH" || code === "FACT_INSTITUTION_SCOPE_MISMATCH" ? "报名时间事实范围与当前届次、赛道或学校不匹配" :
        code === "FACT_NOT_VERIFIED" || code === "FACT_CONFLICTED" ? "报名时间事实尚未通过核验或存在冲突" :
        code === "EVIDENCE_REFERENCE_MISSING" ? "报名时间事实缺少证据引用" :
        "报名起止时间事实不完整或不可用";
      addItem(details, reasonItem(node, "UNKNOWN", code || "REGISTRATION_FACT_UNKNOWN", reason, refs, requirementRefs));
      return "UNKNOWN";
    }

    const asOfParsed = parseZonedInstant(env.asOf);
    const startParsed = parseZonedInstant(start.value);
    const endParsed = parseZonedInstant(end.value);
    const invalidInstant = asOfParsed.error ? { error: asOfParsed.error, label: "评估时点" } :
      startParsed.error ? { error: startParsed.error, label: "报名开始时间" } :
      endParsed.error ? { error: endParsed.error, label: "报名截止时间" } : null;
    if (invalidInstant) {
      const reason = invalidInstant.error === "REGISTRATION_TIMEZONE_REQUIRED"
        ? invalidInstant.label + "必须包含明确时区偏移"
        : invalidInstant.error === "REGISTRATION_TIMESTAMP_MISSING"
          ? invalidInstant.label + "缺失"
          : invalidInstant.label + "格式无效，必须是带明确时区偏移的完整时间戳";
      return unknown(invalidInstant.error, reason, start, end);
    }
    if (compareInstants(startParsed.instant, endParsed.instant) > 0) {
      return unknown("REGISTRATION_WINDOW_RANGE_INVALID", "报名开始时间晚于截止时间", start, end);
    }

    const beforeStart = compareInstants(asOfParsed.instant, startParsed.instant) < 0;
    const afterDeadline = compareInstants(asOfParsed.instant, endParsed.instant) > 0;
    let status = beforeStart || afterDeadline ? "FALSE" : "TRUE";
    let reasonCode = beforeStart ? "REGISTRATION_NOT_STARTED" :
      afterDeadline ? "REGISTRATION_DEADLINE_PASSED" : "REGISTRATION_WINDOW_OPEN";
    let reason = beforeStart ? "报名窗口尚未开始" :
      afterDeadline ? "报名截止时间已过" : "当前评估时点位于报名窗口内";
    if (negate) {
      status = invert(status);
      if (status === "TRUE") {
        reasonCode = "NEGATED_CONDITION_MATCHED";
        reason = "取反后的条件满足";
      } else {
        reasonCode = "NEGATED_CONDITION_MISMATCHED";
        reason = "取反后的条件不满足";
      }
    }
    addItem(details, reasonItem(node, status, reasonCode, reason, refs, requirementRefs));
    return status;
  }

  function evaluateNode(node, env, negate, details) {
    if (!isObject(node) || typeof node.op !== "string") {
      const item = reasonItem({}, "UNKNOWN", "EXPRESSION_INVALID", "表达式结构无效", [], []);
      addItem(details, item);
      return "UNKNOWN";
    }

    if (node.op === "NOT") return evaluateNode(node.arg, env, !negate, details);

    if (node.op === "AND" || node.op === "OR") {
      if (!Array.isArray(node.args) || node.args.length === 0) {
        const item = reasonItem(node, "UNKNOWN", "EXPRESSION_EMPTY", "逻辑表达式没有条件", node.evidence_refs, node.requirement_refs);
        addItem(details, item);
        return "UNKNOWN";
      }
      const childStatuses = node.args.map(function (child) {
        return evaluateNode(child, env, negate, details);
      });
      const connective = (node.op === "AND") !== negate ? "AND" : "OR";
      return combine(childStatuses, connective);
    }

    if (node.op === "NOT_APPLICABLE") {
      const item = reasonItem(
        node,
        "NOT_APPLICABLE",
        node.reason_code || "RULE_NOT_APPLICABLE",
        node.reason || "此条件不适用于当前对象",
        node.evidence_refs,
        node.requirement_refs,
      );
      addItem(details, item);
      return "NOT_APPLICABLE";
    }

    if (node.op === "STATE") {
      let status = STATUS.has(node.status) ? node.status : "UNKNOWN";
      let code = node.reason_code || (status === "UNKNOWN" ? "STATE_UNKNOWN" : "STATE_EVALUATED");
      let text = node.reason || "条件状态由输入规则给出";
      const evidenceRefs = list(node.evidence_refs);
      const requirementRefs = list(node.requirement_refs);
      if ((status === "TRUE" || status === "FALSE") && node.verification_status !== "VERIFIED") {
        status = "UNKNOWN";
        code = "STATE_NOT_VERIFIED";
        text = "条件状态缺少核验标记";
      }
      if ((status === "TRUE" || status === "FALSE") && !hasReferences(evidenceRefs)) {
        status = "UNKNOWN";
        code = "EVIDENCE_REFERENCE_MISSING";
        text = "确定状态缺少证据引用";
      }
      if (negate) {
        status = invert(status);
        if (status === "TRUE") text = "取反后的条件满足";
        if (status === "FALSE") text = "取反后的条件不满足";
      }
      addItem(details, reasonItem(node, status, code, text, evidenceRefs, requirementRefs));
      return status;
    }

    if (node.op === "REGISTRATION_WINDOW") {
      return evaluateRegistrationWindow(node, env, negate, details);
    }

    if (node.op !== "COMPARE") {
      const item = reasonItem(node, "UNKNOWN", "EXPRESSION_OPERATOR_UNSUPPORTED", "不支持此条件运算", node.evidence_refs, node.requirement_refs);
      addItem(details, item);
      return "UNKNOWN";
    }

    const left = resolveFact(node.left, env);
    const rightIsRef = isObject(node.right) && Object.prototype.hasOwnProperty.call(node.right, "source");
    const right = rightIsRef ? resolveFact(node.right, env) : {
      status: missingValue(node.right && node.right.value) ? "UNKNOWN" : "TRUE",
      value: node.right && node.right.value,
      reason_code: "LITERAL_VALUE",
    };
    const evidenceRefs = unique(list(node.evidence_refs)
      .concat(list(left.evidence_refs)).concat(list(right.evidence_refs)));
    const requirementRefs = list(node.requirement_refs);
    let status = "UNKNOWN";
    let reasonCode = "FACT_UNKNOWN";
    let reason = "条件所需事实不完整或不可用";
    let basis;

    if (left.status === "NOT_APPLICABLE" || right.status === "NOT_APPLICABLE") {
      status = "NOT_APPLICABLE";
      reasonCode = left.status === "NOT_APPLICABLE" ? left.reason_code : right.reason_code;
      reason = "引用事实不适用于当前范围";
    } else if (left.status !== "TRUE" || right.status !== "TRUE") {
      reasonCode = left.status !== "TRUE" ? left.reason_code : right.reason_code;
      reason = reasonCode === "FACT_MISSING" ? "缺少所需事实" :
        reasonCode === "FACT_REFERENCE_AMBIGUOUS" ? "事实引用对应多条记录" :
        reasonCode === "FACT_TRACK_SCOPE_MISMATCH" || reasonCode === "FACT_EDITION_SCOPE_MISMATCH" ? "事实范围与当前赛道或届次不匹配" :
        reasonCode === "FACT_NOT_VERIFIED" || reasonCode === "FACT_CONFLICTED" ? "事实尚未通过核验或存在冲突" :
        "条件所需事实不完整或不可用";
    } else {
      const matched = compare(left.value, node.operator, right.value);
      if (matched === null) {
        reasonCode = "COMPARISON_UNSUPPORTED";
        reason = "比较运算符与输入值不兼容";
      } else {
        status = matched ? "TRUE" : "FALSE";
        reasonCode = matched ? "CONDITION_MATCHED" : "CONDITION_MISMATCHED";
        const userProvided = [left.basis, right.basis].includes("USER_PROVIDED");
        reason = userProvided
          ? (matched ? "已提交的个人信息满足该条件" : "已提交的个人信息不满足该条件")
          : (matched ? "已核验证据满足该条件" : "已核验证据不满足该条件");
      }
      basis = [left.basis, right.basis].filter(Boolean).includes("USER_PROVIDED") ? "USER_PROVIDED" :
        ([left.basis, right.basis].filter(Boolean).length ? "USER_VERIFIED" : undefined);
    }

    if (negate) {
      status = invert(status);
      if (status === "TRUE") {
        reasonCode = "NEGATED_CONDITION_MATCHED";
        reason = "取反后的条件满足";
      }
      if (status === "FALSE") {
        reasonCode = "NEGATED_CONDITION_MISMATCHED";
        reason = "取反后的条件不满足";
      }
    }
    addItem(details, reasonItem(node, status, reasonCode, reason, evidenceRefs, requirementRefs, basis));
    return status;
  }

  function ruleScope(rule, subject) {
    if (!isObject(rule.scope) || typeof rule.scope.edition_id !== "string" || !rule.scope.edition_id.trim()) {
      return { status: "INVALID", errors: [{ code: "RULE_EDITION_SCOPE_MISSING", rule_id: rule.rule_id }] };
    }
    if (rule.scope.track_id != null && (typeof rule.scope.track_id !== "string" || !rule.scope.track_id.trim())) {
      return { status: "INVALID", errors: [{ code: "RULE_TRACK_SCOPE_INVALID", rule_id: rule.rule_id }] };
    }
    if (rule.scope.institution_id != null &&
        (typeof rule.scope.institution_id !== "string" || !rule.scope.institution_id.trim())) {
      return { status: "INVALID", errors: [{ code: "RULE_INSTITUTION_SCOPE_INVALID", rule_id: rule.rule_id }] };
    }
    if (rule.scope.edition_id !== subject.edition_id) {
      return { status: "INVALID", errors: [{ code: "RULE_EDITION_SCOPE_MISMATCH", rule_id: rule.rule_id }] };
    }
    if (rule.scope.track_id != null && rule.scope.track_id !== subject.track_id) {
      return { status: "INVALID", errors: [{ code: "RULE_TRACK_SCOPE_MISMATCH", rule_id: rule.rule_id }] };
    }
    if (rule.scope.institution_id != null) {
      if (subject.institution_id == null) return { status: "UNKNOWN", reason_code: "INSTITUTION_SCOPE_UNKNOWN" };
      if (rule.scope.institution_id !== subject.institution_id) return { status: "NOT_APPLICABLE", reason_code: "RULE_INSTITUTION_SCOPE_NOT_APPLICABLE" };
    }
    return { status: "APPLICABLE" };
  }

  function scopeReason(rule, status, code, reason) {
    return reasonItem(
      { id: "scope:" + rule.rule_id, label: rule.label || rule.rule_id || "规则范围" },
      status,
      code,
      reason,
      rule.evidence_refs,
      rule.requirement_refs,
    );
  }

  function dimensionFromRule(expression, rule, env, applicability) {
    const details = emptyDetails();
    let status;
    if (applicability.status === "INVALID") {
      status = "UNKNOWN";
      const error = applicability.errors && applicability.errors[0];
      addItem(details, scopeReason(
        rule,
        status,
        error ? error.code : "RULE_SCOPE_INVALID",
        "规则范围无效，不能评估此条件",
      ));
    } else if (applicability.status === "NOT_APPLICABLE") {
      status = "NOT_APPLICABLE";
      addItem(details, scopeReason(rule, status, applicability.reason_code, "此规则仅适用于其他学校"));
    } else if (applicability.status === "UNKNOWN") {
      status = "UNKNOWN";
      addItem(details, scopeReason(rule, status, applicability.reason_code, "缺少学校信息，无法判断规则是否适用"));
    } else if (expression === undefined || expression === null) {
      status = "UNKNOWN";
      addItem(details, scopeReason(rule, status, "DIMENSION_RULE_MISSING", "缺少此维度的规则"));
    } else {
      status = evaluateNode(expression, env, false, details);
    }
    return Object.assign({ status: status }, details);
  }

  function combineDimensions(results) {
    if (!results.length) {
      const details = emptyDetails();
      const item = reasonItem({}, "UNKNOWN", "RULES_MISSING", "没有可评估的规则", [], []);
      addItem(details, item);
      return Object.assign({ status: "UNKNOWN" }, details);
    }
    const details = emptyDetails();
    results.forEach(function (result) {
      ["matched_conditions", "mismatched_conditions", "unknown_conditions", "not_applicable_conditions"].forEach(function (key) {
        details[key] = details[key].concat(result[key]);
      });
      details.evidence_refs = unique(details.evidence_refs.concat(result.evidence_refs));
      details.requirement_refs = unique(details.requirement_refs.concat(result.requirement_refs));
    });
    const status = combine(results.map(function (result) { return result.status; }), "AND");
    return Object.assign({ status: status }, details);
  }

  function invalidDimension(errors) {
    const details = emptyDetails();
    errors.forEach(function (error) {
      addItem(details, reasonItem(
        { id: error.rule_id || "scope", label: "规则适用范围" },
        "UNKNOWN",
        error.code,
        error.code === "RULE_ID_INVALID" ? "规则编号无效，不能评估此条件" :
          "规则的届次或赛道范围与当前对象不匹配",
        [],
        [],
      ));
    });
    return Object.assign({ status: "UNKNOWN" }, details);
  }

  function evaluate(input) {
    if (!isObject(input)) throw new TypeError("input must be an object");
    if (input.contract_version !== CONTRACT_VERSION) throw new TypeError("unsupported contract_version");
    if (!isObject(input.subject) || typeof input.subject.edition_id !== "string" || !input.subject.edition_id.trim()) {
      throw new TypeError("subject.edition_id must be a non-empty string");
    }
    if (input.subject.track_id != null && typeof input.subject.track_id !== "string") {
      throw new TypeError("subject.track_id must be a string or null");
    }
    if (input.subject.track_id != null && !input.subject.track_id.trim()) {
      throw new TypeError("subject.track_id must be non-empty when provided");
    }
    if (input.subject.institution_id != null && typeof input.subject.institution_id !== "string") {
      throw new TypeError("subject.institution_id must be a string or null");
    }
    if (input.subject.institution_id != null && !input.subject.institution_id.trim()) {
      throw new TypeError("subject.institution_id must be non-empty when provided");
    }
    const rules = Array.isArray(input.rules) ? input.rules : [];
    const errors = [];
    const seenRuleIds = new Set();
    rules.forEach(function (rule) {
      if (!isObject(rule) || typeof rule.rule_id !== "string" || !rule.rule_id.trim()) {
        errors.push({ code: "RULE_ID_INVALID", rule_id: "unknown" });
      } else if (seenRuleIds.has(rule.rule_id)) {
        errors.push({ code: "RULE_ID_DUPLICATE", rule_id: rule.rule_id });
      } else {
        seenRuleIds.add(rule.rule_id);
        errors.push.apply(errors, ruleScope(rule, input.subject).errors || []);
      }
    });

    const env = {
      subject: input.subject,
      asOf: input.as_of,
      userFacts: input.user && Array.isArray(input.user.facts) ? input.user.facts : [],
      competitionFacts: Array.isArray(input.facts) ? input.facts : [],
    };
    const perRule = rules.map(function (rule) {
      const ruleId = rule && rule.rule_id ? rule.rule_id : "unknown";
      const ruleErrors = errors.filter(function (error) { return error.rule_id === ruleId; });
      const applicability = !isObject(rule) ? { status: "INVALID" } :
        ruleErrors.length ? { status: "INVALID", errors: ruleErrors } : ruleScope(rule, input.subject);
      const ruleDimensions = {};
      DIMENSIONS.forEach(function (dimension) {
        ruleDimensions[dimension] = dimensionFromRule(
          rule && rule.dimensions ? rule.dimensions[dimension] : undefined,
          rule || {},
          env,
          applicability,
        );
      });
      return {
        rule_id: rule && rule.rule_id ? rule.rule_id : "unknown",
        scope_status: applicability.status,
        dimensions: ruleDimensions,
      };
    });

    const dimensions = {};
    DIMENSIONS.forEach(function (dimension) {
      dimensions[dimension] = errors.length ? invalidDimension(errors) :
        combineDimensions(perRule.map(function (ruleResult) { return ruleResult.dimensions[dimension]; }));
    });
    const publicRuleStatus = dimensions.public_rule_fit.status;
    const eligibilitySummary = publicRuleStatus === "TRUE" ? "ELIGIBLE" :
      publicRuleStatus === "FALSE" ? "INELIGIBLE" :
      publicRuleStatus === "NOT_APPLICABLE" ? "NOT_APPLICABLE" : "UNKNOWN";

    const result = {
      contract_version: CONTRACT_VERSION,
      as_of: typeof input.as_of === "string" ? input.as_of : null,
      subject: {
        edition_id: input.subject.edition_id,
        track_id: input.subject.track_id == null ? null : input.subject.track_id,
        institution_id: input.subject.institution_id == null ? null : input.subject.institution_id,
      },
      scope_validation: { status: errors.length ? "INVALID" : "VALID", errors: errors },
      rule_ids: rules.map(function (rule) { return rule && rule.rule_id ? rule.rule_id : "unknown"; }),
      eligibility_summary: eligibilitySummary,
      dimensions: dimensions,
      rule_results: perRule,
    };
    if (rules.length === 1 && rules[0] && typeof rules[0].rule_id === "string") {
      result.rule_id = rules[0].rule_id;
    }
    return result;
  }

  return {
    contract_version: CONTRACT_VERSION,
    dimensions: DIMENSIONS.slice(),
    evaluate: evaluate,
  };
});
