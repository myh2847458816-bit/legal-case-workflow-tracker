(function exposeModel(root, factory) {
  const value = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = value;
  else root.CaseModel = value;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createModel() {
  const STATUS = {
    PENDING: 'pending',
    DONE: 'done',
    NOT_APPLICABLE: 'not_applicable',
    OUT_OF_SCOPE: 'out_of_scope',
    COMPLETED_ELSEWHERE: 'completed_elsewhere',
    REVIEW: 'review',
    // Compatibility alias for callers written against state version 3.
    SKIPPED: 'not_applicable'
  };
  const APPLICABILITY = {
    UNDECIDED: 'undecided',
    INCLUDED: 'included',
    EXCLUDED: 'excluded'
  };
  const WORK_STATE = Object.freeze({
    ACTIVE: 'active',
    CLEARED_FUTURE_PENDING: 'cleared_future_pending',
    CLEARED: 'cleared',
    COMPLETE: 'complete',
    ALL_NOT_APPLICABLE: 'all_not_applicable',
    EMPTY: 'empty'
  });
  const NEXT_TASK_DECISION = Object.freeze({
    ACTUAL: 'actual',
    LATER: 'later',
    PRIOR: 'prior',
    FOCUS: 'focus',
    NONE: 'none'
  });
  const ACTIVITY_TYPE = Object.freeze({
    TASK_STATUS: 'task_status',
    GROUP_STATUS: 'group_status',
    STAGE_APPLICABILITY: 'stage_applicability',
    GROUP_APPLICABILITY: 'group_applicability',
    CUSTOM_TEMPLATE_DELETE: 'custom_template_delete',
    CUSTOM_STAGE_DELETE: 'custom_stage_delete',
    CUSTOM_GROUP_DELETE: 'custom_group_delete',
    CUSTOM_TASK_DELETE: 'custom_task_delete',
    CASE_IMPORTANT_DATE_STATUS: 'case_important_date_status',
    CASE_DELETE: 'case_delete',
    CASE_RESTORE: 'case_restore'
  });
  // Version 7 adds recoverable deletion activity types. Keeping this distinct
  // lets an older build reject a newer backup cleanly instead of treating the
  // new activity records as corrupt version-6 data.
  const CURRENT_STATE_VERSION = 7;
  const RECENT_ACTIVITY_LIMIT = 200;
  const RECYCLE_BIN_CASE_LIMIT = 50;
  const VALIDATION_LIMITS = Object.freeze({
    cases: 2000,
    customTemplates: 500,
    stagesPerWorkflow: 200,
    groupsPerStage: 300,
    tasksPerGroup: 1000,
    totalTasks: 50000,
    idLength: 200,
    textLength: 10000,
    sourcesPerSnapshot: 100,
    recentActivity: RECENT_ACTIVITY_LIMIT,
    recycleBinCases: RECYCLE_BIN_CASE_LIMIT
  });
  const TERMINAL_STATUSES = new Set([
    STATUS.DONE,
    STATUS.NOT_APPLICABLE,
    STATUS.OUT_OF_SCOPE,
    STATUS.COMPLETED_ELSEWHERE
  ]);
  const OPEN_STATUSES = new Set([STATUS.PENDING, STATUS.REVIEW]);
  const VALID_STATUSES = new Set(Object.values(STATUS));
  const VALID_ACTIVITY_TYPES = new Set(Object.values(ACTIVITY_TYPE));
  const CUSTOM_DELETE_ACTIVITY_TYPES = new Set([
    ACTIVITY_TYPE.CUSTOM_TEMPLATE_DELETE,
    ACTIVITY_TYPE.CUSTOM_STAGE_DELETE,
    ACTIVITY_TYPE.CUSTOM_GROUP_DELETE,
    ACTIVITY_TYPE.CUSTOM_TASK_DELETE
  ]);
  // Early private builds contained three over-specific descriptions.  Public
  // source must not preserve those original words, so legacy v1-v3 data is
  // migrated by its stable sentence shape instead of embedding the old term.
  const LEGACY_TITLE_RULES = [
    [/^发函给.{1,4}法院$/, '发函给法院'],
    [/^申请法院.{1,4}选定评估、审计机构$/, '申请法院选定评估、审计机构'],
    [/^向法院申请.{1,4}选定评估机构及审计机构$/, '向法院申请选定评估机构及审计机构']
  ];

  function normalizeLegacyTitle(value, inputVersion) {
    if (inputVersion >= 4 || typeof value !== 'string') return value;
    for (const [pattern, replacement] of LEGACY_TITLE_RULES) {
      if (pattern.test(value)) return replacement;
    }
    return value;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function stringOrEmpty(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function templateSnapshot(template, capturedAt = new Date().toISOString()) {
    return {
      schemaVersion: 1,
      id: stringOrEmpty(template?.id),
      name: stringOrEmpty(template?.name),
      category: stringOrEmpty(template?.category) || 'custom',
      categoryLabel: stringOrEmpty(template?.categoryLabel) || '自定义案件',
      description: stringOrEmpty(template?.description),
      role: stringOrEmpty(template?.role),
      scope: stringOrEmpty(template?.scope),
      sourceVersion: stringOrEmpty(template?.sourceVersion),
      lastReviewedAt: stringOrEmpty(template?.lastReviewedAt),
      legalNote: stringOrEmpty(template?.legalNote),
      sources: Array.isArray(template?.sources)
        ? template.sources.map((source) => ({ title: stringOrEmpty(source?.title), url: stringOrEmpty(source?.url) }))
        : [],
      capturedAt,
      completeness: 'complete'
    };
  }

  function legacyTemplateSnapshot(caseItem, capturedAt) {
    return {
      schemaVersion: 1,
      id: stringOrEmpty(caseItem?.templateId),
      name: stringOrEmpty(caseItem?.templateName),
      category: stringOrEmpty(caseItem?.caseType) || 'custom',
      categoryLabel: stringOrEmpty(caseItem?.caseTypeLabel) || '其他 / 自定义',
      description: '',
      role: '',
      scope: '',
      sourceVersion: '',
      lastReviewedAt: '',
      legalNote: '',
      sources: [],
      capturedAt: stringOrEmpty(capturedAt),
      completeness: 'legacy_partial'
    };
  }

  function createId(prefix = 'id') {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function normalizeStatus(status) {
    if (status === 'skipped') return STATUS.NOT_APPLICABLE;
    return VALID_STATUSES.has(status) ? status : STATUS.PENDING;
  }

  function defaultApplicability(item) {
    return item?.conditional ? APPLICABILITY.UNDECIDED : APPLICABILITY.INCLUDED;
  }

  function isIncluded(item) {
    return (item?.applicability || defaultApplicability(item)) === APPLICABILITY.INCLUDED;
  }

  function createEmptyState() {
    return {
      version: CURRENT_STATE_VERSION,
      cases: [],
      customTemplates: [],
      recentActivity: [],
      recycleBin: { cases: [] },
      settings: { upcomingDays: 7 },
      updatedAt: new Date().toISOString()
    };
  }

  function instantiateStages(template) {
    return clone(template.stages || []).map((stage) => ({
      ...stage,
      applicability: defaultApplicability(stage),
      groups: (stage.groups || []).map((group) => ({
        ...group,
        applicability: defaultApplicability(group),
        tasks: (group.tasks || []).map((task) => ({
          ...task,
          status: STATUS.PENDING,
          dueDate: '',
          note: '',
          completedAt: null,
          updatedAt: null
        }))
      }))
    }));
  }

  function createCase(fields, template) {
    const now = new Date().toISOString();
    const stages = instantiateStages(template);
    return {
      id: createId('case'),
      name: String(fields.name || '').trim(),
      companyName: String(fields.companyName || '').trim(),
      caseNumber: String(fields.caseNumber || '').trim(),
      court: String(fields.court || '').trim(),
      manager: String(fields.manager || '').trim(),
      startDate: fields.startDate || '',
      importantDate: fields.importantDate || '',
      importantDateHandledAt: null,
      notes: String(fields.notes || '').trim(),
      archived: false,
      templateId: template.id,
      templateName: template.name,
      caseType: template.category || 'custom',
      caseTypeLabel: template.categoryLabel || '自定义案件',
      templateSnapshot: templateSnapshot(template, now),
      stages,
      actualStageId: stages.find(isIncluded)?.id || null,
      createdAt: now,
      updatedAt: now
    };
  }

  function normalizeState(input) {
    const empty = createEmptyState();
    if (!input || typeof input !== 'object' || !Array.isArray(input.cases)) return empty;
    const inputVersion = Number(input.version) || 0;
    const cases = input.cases.filter(Boolean).map((caseItem) => {
      const migrated = clone(caseItem);
      if (!migrated.caseType) {
        migrated.caseType = migrated.templateId === 'bankruptcy-workflow-v1' ? 'bankruptcy' : 'custom';
      }
      if (!migrated.caseTypeLabel) migrated.caseTypeLabel = migrated.caseType === 'bankruptcy' ? '破产案件' : '其他 / 自定义';
      if (!migrated.importantDate) migrated.importantDateHandledAt = null;
      else if (typeof migrated.importantDateHandledAt !== 'string') migrated.importantDateHandledAt = null;
      if (!migrated.templateSnapshot || typeof migrated.templateSnapshot !== 'object') {
        migrated.templateSnapshot = legacyTemplateSnapshot(migrated, migrated.createdAt || input.updatedAt || '');
      } else migrated.templateSnapshot = {
        ...legacyTemplateSnapshot(migrated, migrated.createdAt || input.updatedAt || ''),
        ...clone(migrated.templateSnapshot),
        sources: Array.isArray(migrated.templateSnapshot.sources) ? clone(migrated.templateSnapshot.sources) : []
      };
      if (!Array.isArray(migrated.stages)) migrated.stages = [];
      for (const stage of migrated.stages) {
        if (!Array.isArray(stage.groups)) stage.groups = [];
        for (const group of stage.groups) {
          if (!Array.isArray(group.tasks)) group.tasks = [];
          group.title = normalizeLegacyTitle(group.title, inputVersion);
          for (const task of group.tasks) {
            task.title = normalizeLegacyTitle(task.title, inputVersion);
            task.status = normalizeStatus(task.status);
          }
          group.applicability = migrateApplicability(group, group.tasks);
        }
        stage.applicability = migrateApplicability(stage, stage.groups.flatMap((group) => group.tasks));
      }
      const actualStage = migrated.stages.find((stage) => stage.id === migrated.actualStageId && isIncluded(stage));
      if (actualStage) migrated.actualStageId = actualStage.id;
      else if (inputVersion < 5) {
        migrated.actualStageId = effectiveStages(migrated).find((stage) => stageStats(stage, { effectiveOnly: true }).open > 0)?.id
          || effectiveStages(migrated)[0]?.id
          || null;
      } else migrated.actualStageId = null;
      return migrated;
    });
    const customTemplates = Array.isArray(input.customTemplates) ? clone(input.customTemplates) : [];
    for (const customTemplate of customTemplates) {
      for (const stage of customTemplate.stages || []) {
        delete stage.applicability;
        for (const group of stage.groups || []) {
          delete group.applicability;
          group.title = normalizeLegacyTitle(group.title, inputVersion);
          for (const task of group.tasks || []) task.title = normalizeLegacyTitle(task.title, inputVersion);
        }
      }
    }
    return {
      version: CURRENT_STATE_VERSION,
      cases,
      customTemplates,
      recentActivity: inputVersion >= 6 && Array.isArray(input.recentActivity)
        ? clone(input.recentActivity).slice(0, RECENT_ACTIVITY_LIMIT)
        : [],
      recycleBin: {
        cases: inputVersion >= 6 && Array.isArray(input.recycleBin?.cases)
          ? clone(input.recycleBin.cases).map((entry) => {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
            const normalized = { ...entry };
            if (normalized.caseSnapshot && typeof normalized.caseSnapshot === 'object' && !Array.isArray(normalized.caseSnapshot)) {
              const holder = normalizeState({
                version: inputVersion,
                cases: [normalized.caseSnapshot],
                customTemplates: [],
                recentActivity: [],
                recycleBin: { cases: [] }
              });
              normalized.caseSnapshot = holder.cases[0] || normalized.caseSnapshot;
            }
            return normalized;
          })
          : []
      },
      settings: { ...empty.settings, ...(input.settings || {}) },
      updatedAt: input.updatedAt || empty.updatedAt
    };
  }

  function validateState(input, { allowLegacy = true } = {}) {
    const errors = [];
    const warnings = [];
    let caseCount = 0;
    let customTemplateCount = 0;
    let totalTasks = 0;
    const addError = (code, path, message) => errors.push({ code, path, message });
    const addWarning = (code, path, message) => warnings.push({ code, path, message });

    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      addError('INVALID_ROOT', '$', '台账数据必须是对象');
      return { ok: false, errors, warnings, summary: { caseCount, customTemplateCount, totalTasks } };
    }
    const version = Number(input.version) || 0;
    if (version > CURRENT_STATE_VERSION) addError('UNSUPPORTED_VERSION', '$.version', '备份来自更高版本的程序');
    if (!allowLegacy && version !== CURRENT_STATE_VERSION) addError('VERSION_MISMATCH', '$.version', '台账版本不受支持');
    if (version < CURRENT_STATE_VERSION) addWarning('LEGACY_VERSION', '$.version', '旧版台账将在导入后迁移');
    if (!Array.isArray(input.cases)) addError('INVALID_CASES', '$.cases', 'cases 必须是数组');
    if (!Array.isArray(input.customTemplates)) {
      if (allowLegacy && input.customTemplates === undefined) addWarning('MISSING_CUSTOM_TEMPLATES', '$.customTemplates', '旧版台账没有自定义模板字段');
      else addError('INVALID_CUSTOM_TEMPLATES', '$.customTemplates', 'customTemplates 必须是数组');
    }
    if (version >= 6 && input.recentActivity === undefined) {
      addWarning('MISSING_RECENT_ACTIVITY', '$.recentActivity', '台账没有最近操作字段，将按空记录补齐');
    } else if (version >= 6 && !Array.isArray(input.recentActivity)) {
      addError('INVALID_RECENT_ACTIVITY', '$.recentActivity', 'recentActivity 必须是数组');
    }
    if (version >= 6 && input.recycleBin === undefined) {
      addWarning('MISSING_RECYCLE_BIN', '$.recycleBin', '台账没有最近删除字段，将按空回收站补齐');
    } else if (version >= 6 && (!input.recycleBin || typeof input.recycleBin !== 'object' || Array.isArray(input.recycleBin))) {
      addError('INVALID_RECYCLE_BIN', '$.recycleBin', 'recycleBin 必须是对象');
    } else if (version >= 6 && !Array.isArray(input.recycleBin?.cases)) {
      addError('INVALID_RECYCLE_BIN_CASES', '$.recycleBin.cases', 'recycleBin.cases 必须是数组');
    }

    const cases = Array.isArray(input.cases) ? input.cases : [];
    const templates = Array.isArray(input.customTemplates) ? input.customTemplates : [];
    caseCount = cases.length;
    customTemplateCount = templates.length;
    if (caseCount > VALIDATION_LIMITS.cases) addError('LIMIT_EXCEEDED', '$.cases', '案件数量超过允许上限');
    if (customTemplateCount > VALIDATION_LIMITS.customTemplates) addError('LIMIT_EXCEEDED', '$.customTemplates', '自定义模板数量超过允许上限');

    const validateId = (value, path, registry) => {
      if (typeof value !== 'string' || !value.trim() || value.length > VALIDATION_LIMITS.idLength) {
        addError('INVALID_ID', path, 'ID 必须是非空且长度合理的字符串');
        return;
      }
      if (registry.has(value)) addError('DUPLICATE_ID', path, `ID 与 ${registry.get(value)} 重复`);
      else registry.set(value, path);
    };
    const validateText = (value, path, required = false) => {
      if (required && (typeof value !== 'string' || !value.trim())) addError('INVALID_TEXT', path, '必填文字不能为空');
      else if (value !== undefined && value !== null && typeof value !== 'string') addError('INVALID_TEXT', path, '文字字段必须是字符串');
      else if (typeof value === 'string' && value.length > VALIDATION_LIMITS.textLength) addError('LIMIT_EXCEEDED', path, '文字字段超过长度上限');
    };
    const validateDate = (value, path) => {
      if (value !== undefined && value !== null && value !== '' && !parseLocalDate(value)) addError('INVALID_DATE', path, '日期必须是有效的 YYYY-MM-DD');
    };
    const validateTimestamp = (value, path, { nullable = false } = {}) => {
      if (nullable && (value === null || value === undefined || value === '')) return;
      if (typeof value !== 'string' || !value || !Number.isFinite(Date.parse(value))) addError('INVALID_TIMESTAMP', path, '时间必须是有效的 ISO 日期时间字符串');
    };
    const validateSources = (sources, path, required = false) => {
      if (!Array.isArray(sources)) {
        if (required) addError('INVALID_SOURCES', path, 'sources 必须是数组');
        return;
      }
      if (sources.length > VALIDATION_LIMITS.sourcesPerSnapshot) addError('LIMIT_EXCEEDED', path, '参考来源数量超过允许上限');
      sources.forEach((source, index) => {
        const sourcePath = `${path}[${index}]`;
        if (!source || typeof source !== 'object' || Array.isArray(source)) { addError('INVALID_SOURCE', sourcePath, '参考来源必须是对象'); return; }
        validateText(source.title, `${sourcePath}.title`, true);
        validateText(source.url, `${sourcePath}.url`, true);
        if (typeof source.url === 'string') {
          try {
            const protocol = new URL(source.url).protocol;
            if (!['http:', 'https:'].includes(protocol)) addError('INVALID_URL', `${sourcePath}.url`, '参考来源仅支持 http 或 https 地址');
          } catch (_) {
            addError('INVALID_URL', `${sourcePath}.url`, '参考来源地址格式无效');
          }
        }
      });
    };
    const validateTemplateSnapshot = (snapshot, path, required) => {
      if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
        if (required) addError('INVALID_TEMPLATE_SNAPSHOT', path, 'templateSnapshot 必须是对象');
        else addWarning('MISSING_TEMPLATE_SNAPSHOT', path, '旧版案件没有模板元数据快照');
        return;
      }
      if (snapshot.schemaVersion !== 1) addError('INVALID_TEMPLATE_SNAPSHOT', `${path}.schemaVersion`, '模板快照版本无效');
      if (!['complete', 'legacy_partial'].includes(snapshot.completeness)) addError('INVALID_TEMPLATE_SNAPSHOT', `${path}.completeness`, '模板快照完整性标记无效');
      for (const field of ['id', 'name', 'category', 'categoryLabel', 'description', 'role', 'scope', 'sourceVersion', 'lastReviewedAt', 'legalNote', 'capturedAt']) {
        validateText(snapshot[field], `${path}.${field}`, ['name', 'category', 'categoryLabel'].includes(field));
      }
      validateSources(snapshot.sources, `${path}.sources`, true);
    };
    const validateTask = (task, path, isCase, workflowIds) => {
      if (!task || typeof task !== 'object' || Array.isArray(task)) { addError('INVALID_TASK', path, '任务必须是对象'); return; }
      validateId(task.id, `${path}.id`, workflowIds);
      validateText(task.title, `${path}.title`, true);
      validateText(task.detail, `${path}.detail`);
      if (isCase) {
        const status = task.status === 'skipped' && allowLegacy ? STATUS.NOT_APPLICABLE : task.status;
        if (!VALID_STATUSES.has(status)) addError('INVALID_STATUS', `${path}.status`, '任务状态无效');
        validateDate(task.dueDate, `${path}.dueDate`);
        validateText(task.note, `${path}.note`);
      }
    };
    const validateGroup = (group, path, isCase, workflowIds) => {
      if (!group || typeof group !== 'object' || Array.isArray(group)) { addError('INVALID_GROUP', path, '事项组必须是对象'); return; }
      validateId(group.id, `${path}.id`, workflowIds);
      validateText(group.title, `${path}.title`, true);
      validateText(group.conditionText, `${path}.conditionText`);
      if (isCase && group.applicability !== undefined && !Object.values(APPLICABILITY).includes(group.applicability)) addError('INVALID_APPLICABILITY', `${path}.applicability`, '事项组适用状态无效');
      if (!Array.isArray(group.tasks)) { addError('INVALID_TASKS', `${path}.tasks`, 'tasks 必须是数组'); return; }
      if (group.tasks.length > VALIDATION_LIMITS.tasksPerGroup) addError('LIMIT_EXCEEDED', `${path}.tasks`, '任务数量超过允许上限');
      totalTasks += group.tasks.length;
      group.tasks.forEach((task, index) => validateTask(task, `${path}.tasks[${index}]`, isCase, workflowIds));
    };
    const validateStage = (stage, path, isCase, workflowIds) => {
      if (!stage || typeof stage !== 'object' || Array.isArray(stage)) { addError('INVALID_STAGE', path, '阶段必须是对象'); return; }
      validateId(stage.id, `${path}.id`, workflowIds);
      validateText(stage.name, `${path}.name`, true);
      validateText(stage.conditionText, `${path}.conditionText`);
      if (isCase && stage.applicability !== undefined && !Object.values(APPLICABILITY).includes(stage.applicability)) addError('INVALID_APPLICABILITY', `${path}.applicability`, '阶段适用状态无效');
      if (!Array.isArray(stage.groups)) { addError('INVALID_GROUPS', `${path}.groups`, 'groups 必须是数组'); return; }
      if (stage.groups.length > VALIDATION_LIMITS.groupsPerStage) addError('LIMIT_EXCEEDED', `${path}.groups`, '事项组数量超过允许上限');
      stage.groups.forEach((group, index) => validateGroup(group, `${path}.groups[${index}]`, isCase, workflowIds));
    };
    const validateWorkflow = (owner, path, isCase, ownerIds) => {
      if (!owner || typeof owner !== 'object' || Array.isArray(owner)) {
        addError('INVALID_ITEM', path, '流程项目必须是对象');
        return;
      }
      validateId(owner.id, `${path}.id`, ownerIds);
      validateText(owner.name, `${path}.name`, true);
      for (const field of ['description', 'role', 'scope', 'sourceVersion', 'lastReviewedAt', 'legalNote']) validateText(owner[field], `${path}.${field}`);
      validateSources(owner.sources, `${path}.sources`);
      if (owner.derivedFrom !== undefined) {
        const derivedPath = `${path}.derivedFrom`;
        if (!owner.derivedFrom || typeof owner.derivedFrom !== 'object' || Array.isArray(owner.derivedFrom)) {
          addError('INVALID_DERIVED_FROM', derivedPath, '派生来源必须是对象');
        } else {
          if (owner.derivedFrom.kind !== 'case') addError('INVALID_DERIVED_FROM', `${derivedPath}.kind`, '当前仅支持从案件派生模板');
          for (const field of ['caseId', 'caseName', 'templateId', 'templateName']) validateText(owner.derivedFrom[field], `${derivedPath}.${field}`);
          validateTimestamp(owner.derivedFrom.at, `${derivedPath}.at`);
        }
      }
      const workflowIds = new Map();
      if (!Array.isArray(owner.stages)) {
        addError('INVALID_STAGES', `${path}.stages`, 'stages 必须是数组');
        return;
      }
      if (owner.stages.length > VALIDATION_LIMITS.stagesPerWorkflow) addError('LIMIT_EXCEEDED', `${path}.stages`, '阶段数量超过允许上限');
      owner.stages.forEach((stage, index) => validateStage(stage, `${path}.stages[${index}]`, isCase, workflowIds));
    };

    const validateStatusSnapshot = (value, path) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) { addError('INVALID_ACTIVITY_STATE', path, '任务状态快照必须是对象'); return; }
      if (!VALID_STATUSES.has(value.status)) addError('INVALID_STATUS', `${path}.status`, '操作记录中的任务状态无效');
      validateTimestamp(value.completedAt, `${path}.completedAt`, { nullable: true });
    };
    const validateApplicabilitySnapshot = (value, path, includeActualStage = false) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) { addError('INVALID_ACTIVITY_STATE', path, '适用状态快照必须是对象'); return; }
      if (!Object.values(APPLICABILITY).includes(value.applicability)) addError('INVALID_APPLICABILITY', `${path}.applicability`, '操作记录中的适用状态无效');
      if (includeActualStage && value.actualStageId !== null && value.actualStageId !== undefined) validateText(value.actualStageId, `${path}.actualStageId`);
    };
    const validateImportantDateStatusSnapshot = (value, path) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) { addError('INVALID_ACTIVITY_STATE', path, '关键日期状态快照必须是对象'); return; }
      validateDate(value.importantDate, `${path}.importantDate`);
      if (!value.importantDate) addError('INVALID_ACTIVITY_STATE', `${path}.importantDate`, '关键日期状态快照必须保留日期');
      if (value.importantDateHandledAt !== null) validateTimestamp(value.importantDateHandledAt, `${path}.importantDateHandledAt`);
    };

    const caseIds = new Map();
    const templateIds = new Map();
    const validateCase = (caseItem, path) => {
      validateWorkflow(caseItem, path, true, caseIds);
      if (caseItem && typeof caseItem === 'object') {
        for (const field of ['companyName', 'caseNumber', 'court', 'manager', 'templateId', 'templateName', 'caseType', 'caseTypeLabel']) validateText(caseItem[field], `${path}.${field}`);
        if (caseItem.notes !== undefined && caseItem.notes !== null && typeof caseItem.notes !== 'string') addError('INVALID_TEXT', `${path}.notes`, '案件备注必须是字符串');
        validateDate(caseItem.startDate, `${path}.startDate`);
        validateDate(caseItem.importantDate, `${path}.importantDate`);
        if (caseItem.importantDateHandledAt === undefined && version < 7) {
          // Version 6 did not persist this field; normalizeState supplies null.
        } else if (caseItem.importantDateHandledAt !== null) {
          validateTimestamp(caseItem.importantDateHandledAt, `${path}.importantDateHandledAt`);
        }
        if (!caseItem.importantDate && caseItem.importantDateHandledAt) {
          addError('INVALID_IMPORTANT_DATE_STATUS', `${path}.importantDateHandledAt`, '没有关键日期时不能保留已处理状态');
        }
        validateTemplateSnapshot(caseItem.templateSnapshot, `${path}.templateSnapshot`, false);
        if (caseItem.archived !== undefined && typeof caseItem.archived !== 'boolean') addError('INVALID_ARCHIVED', `${path}.archived`, 'archived 必须是布尔值');
      }
    };
    cases.forEach((caseItem, index) => validateCase(caseItem, `$.cases[${index}]`));
    templates.forEach((template, index) => validateWorkflow(template, `$.customTemplates[${index}]`, false, templateIds));

    const activity = Array.isArray(input.recentActivity) ? input.recentActivity : [];
    if (activity.length > VALIDATION_LIMITS.recentActivity) addError('LIMIT_EXCEEDED', '$.recentActivity', '最近操作数量超过允许上限');
    const activityIds = new Map();
    activity.forEach((event, index) => {
      const path = `$.recentActivity[${index}]`;
      if (!event || typeof event !== 'object' || Array.isArray(event)) { addError('INVALID_ACTIVITY', path, '最近操作必须是对象'); return; }
      validateId(event.id, `${path}.id`, activityIds);
      validateTimestamp(event.at, `${path}.at`);
      if (!VALID_ACTIVITY_TYPES.has(event.type)) addError('INVALID_ACTIVITY_TYPE', `${path}.type`, '最近操作类型无效');
      validateText(event.caseId, `${path}.caseId`, event.type !== ACTIVITY_TYPE.CUSTOM_TEMPLATE_DELETE);
      validateText(event.caseName, `${path}.caseName`);
      validateText(event.label, `${path}.label`, true);
      validateTimestamp(event.undoneAt, `${path}.undoneAt`, { nullable: true });
      if (event.undoOf !== null && event.undoOf !== undefined) validateText(event.undoOf, `${path}.undoOf`, true);
      if (!event.target || typeof event.target !== 'object' || Array.isArray(event.target)) { addError('INVALID_ACTIVITY_TARGET', `${path}.target`, '操作目标必须是对象'); return; }

      if (event.type === ACTIVITY_TYPE.TASK_STATUS) {
        validateText(event.target.taskId, `${path}.target.taskId`, true);
        validateStatusSnapshot(event.before, `${path}.before`);
        validateStatusSnapshot(event.after, `${path}.after`);
      } else if (event.type === ACTIVITY_TYPE.GROUP_STATUS) {
        validateText(event.target.groupId, `${path}.target.groupId`, true);
        if (!Array.isArray(event.changes) || !event.changes.length) addError('INVALID_ACTIVITY_CHANGES', `${path}.changes`, '批量操作必须包含实际变更的任务');
        const taskIds = new Map();
        (Array.isArray(event.changes) ? event.changes : []).forEach((change, changeIndex) => {
          const changePath = `${path}.changes[${changeIndex}]`;
          if (!change || typeof change !== 'object' || Array.isArray(change)) { addError('INVALID_ACTIVITY_CHANGE', changePath, '任务变更必须是对象'); return; }
          validateId(change.taskId, `${changePath}.taskId`, taskIds);
          validateStatusSnapshot(change.before, `${changePath}.before`);
          validateStatusSnapshot(change.after, `${changePath}.after`);
        });
      } else if (event.type === ACTIVITY_TYPE.STAGE_APPLICABILITY) {
        validateText(event.target.stageId, `${path}.target.stageId`, true);
        validateApplicabilitySnapshot(event.before, `${path}.before`, true);
        validateApplicabilitySnapshot(event.after, `${path}.after`, true);
      } else if (event.type === ACTIVITY_TYPE.GROUP_APPLICABILITY) {
        validateText(event.target.groupId, `${path}.target.groupId`, true);
        validateApplicabilitySnapshot(event.before, `${path}.before`);
        validateApplicabilitySnapshot(event.after, `${path}.after`);
      } else if (event.type === ACTIVITY_TYPE.CASE_IMPORTANT_DATE_STATUS) {
        validateImportantDateStatusSnapshot(event.before, `${path}.before`);
        validateImportantDateStatusSnapshot(event.after, `${path}.after`);
      } else if (CUSTOM_DELETE_ACTIVITY_TYPES.has(event.type)) {
        const idField = event.type === ACTIVITY_TYPE.CUSTOM_TEMPLATE_DELETE
          ? 'templateId'
          : event.type === ACTIVITY_TYPE.CUSTOM_STAGE_DELETE
            ? 'stageId'
            : event.type === ACTIVITY_TYPE.CUSTOM_GROUP_DELETE ? 'groupId' : 'taskId';
        validateText(event.target[idField], `${path}.target.${idField}`, true);
        if (!Number.isInteger(event.target.originalIndex) || event.target.originalIndex < 0) {
          addError('INVALID_ACTIVITY_TARGET', `${path}.target.originalIndex`, '删除记录必须包含原始位置');
        }
        if ([ACTIVITY_TYPE.CUSTOM_GROUP_DELETE, ACTIVITY_TYPE.CUSTOM_TASK_DELETE].includes(event.type)) {
          validateText(event.target.stageId, `${path}.target.stageId`, true);
        }
        if (event.type === ACTIVITY_TYPE.CUSTOM_TASK_DELETE) validateText(event.target.groupId, `${path}.target.groupId`, true);
        const deletedItem = event.before?.item;
        if (!deletedItem || typeof deletedItem !== 'object' || Array.isArray(deletedItem)) {
          addError('INVALID_ACTIVITY_STATE', `${path}.before.item`, '删除记录必须包含完整项目快照');
        } else {
          const itemPath = `${path}.before.item`;
          if (deletedItem.id !== event.target[idField]) addError('INVALID_ACTIVITY_STATE', `${itemPath}.id`, '删除快照与目标 ID 不一致');
          // A deleted snapshot is a dormant, restorable piece of the ledger.
          // Validate it with the same recursive rules as an active item, but
          // with its own ID registry because it is intentionally not active.
          if (event.type === ACTIVITY_TYPE.CUSTOM_TEMPLATE_DELETE) {
            validateWorkflow(deletedItem, itemPath, false, new Map());
          } else if (event.type === ACTIVITY_TYPE.CUSTOM_STAGE_DELETE) {
            validateStage(deletedItem, itemPath, true, new Map());
          } else if (event.type === ACTIVITY_TYPE.CUSTOM_GROUP_DELETE) {
            validateGroup(deletedItem, itemPath, true, new Map());
          } else {
            totalTasks += 1;
            validateTask(deletedItem, itemPath, true, new Map());
          }
        }
        if (!event.after || event.after.itemPresent !== false) addError('INVALID_ACTIVITY_STATE', `${path}.after`, '删除后的状态标记无效');
        if (event.type === ACTIVITY_TYPE.CUSTOM_STAGE_DELETE) {
          if (event.before?.actualStageId !== null && event.before?.actualStageId !== undefined) validateText(event.before.actualStageId, `${path}.before.actualStageId`);
          if (event.after?.actualStageId !== null && event.after?.actualStageId !== undefined) validateText(event.after.actualStageId, `${path}.after.actualStageId`);
        }
      } else if ([ACTIVITY_TYPE.CASE_DELETE, ACTIVITY_TYPE.CASE_RESTORE].includes(event.type)) {
        validateText(event.target.trashId, `${path}.target.trashId`, true);
      }
    });

    const recycledCases = Array.isArray(input.recycleBin?.cases) ? input.recycleBin.cases : [];
    if (recycledCases.length > VALIDATION_LIMITS.recycleBinCases) addError('LIMIT_EXCEEDED', '$.recycleBin.cases', '最近删除中的案件数量超过允许上限');
    const trashIds = new Map();
    recycledCases.forEach((entry, index) => {
      const path = `$.recycleBin.cases[${index}]`;
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { addError('INVALID_RECYCLED_CASE', path, '最近删除项目必须是对象'); return; }
      validateId(entry.id, `${path}.id`, trashIds);
      validateTimestamp(entry.deletedAt, `${path}.deletedAt`);
      if (!entry.caseSnapshot || typeof entry.caseSnapshot !== 'object' || Array.isArray(entry.caseSnapshot)) addError('INVALID_CASE_SNAPSHOT', `${path}.caseSnapshot`, '最近删除项目必须包含完整案件快照');
      else validateCase(entry.caseSnapshot, `${path}.caseSnapshot`);
    });
    if (input.settings !== undefined) {
      if (!input.settings || typeof input.settings !== 'object' || Array.isArray(input.settings)) addError('INVALID_SETTINGS', '$.settings', 'settings 必须是对象');
      else if (input.settings.upcomingDays !== undefined && (!Number.isInteger(input.settings.upcomingDays) || input.settings.upcomingDays < 1 || input.settings.upcomingDays > 365)) {
        addError('INVALID_UPCOMING_DAYS', '$.settings.upcomingDays', 'upcomingDays 必须是 1 至 365 的整数');
      }
    }
    if (totalTasks > VALIDATION_LIMITS.totalTasks) addError('LIMIT_EXCEEDED', '$', '任务总数超过允许上限');
    return { ok: errors.length === 0, errors, warnings, summary: { caseCount, customTemplateCount, recycleBinCaseCount: recycledCases.length, totalTasks, version } };
  }

  function migrateApplicability(item, tasks) {
    if (Object.values(APPLICABILITY).includes(item?.applicability)) return item.applicability;
    if (!item?.conditional) return APPLICABILITY.INCLUDED;
    const normalizedTasks = tasks || [];
    const allLegacySkipped = normalizedTasks.length > 0
      && normalizedTasks.every((task) => task.status === STATUS.NOT_APPLICABLE)
      && normalizedTasks.every((task) => !task.dueDate && !String(task.note || '').trim());
    if (allLegacySkipped) return APPLICABILITY.EXCLUDED;
    const hasWork = normalizedTasks.some((task) =>
      task.status !== STATUS.PENDING
      || Boolean(task.dueDate)
      || Boolean(String(task.note || '').trim())
      || Boolean(task.completedAt)
      || Boolean(task.updatedAt)
    );
    if (hasWork) return APPLICABILITY.INCLUDED;
    return APPLICABILITY.UNDECIDED;
  }

  function flattenTasks(caseItem) {
    const result = [];
    for (const stage of caseItem?.stages || []) {
      for (const group of stage.groups || []) {
        for (const task of group.tasks || []) result.push({ stage, group, task });
      }
    }
    return result;
  }

  function effectiveStages(caseItem) {
    return (caseItem?.stages || []).filter(isIncluded);
  }

  function effectiveTasks(caseItem) {
    const result = [];
    for (const stage of effectiveStages(caseItem)) {
      for (const group of stage.groups || []) {
        if (!isIncluded(group)) continue;
        for (const task of group.tasks || []) result.push({ stage, group, task });
      }
    }
    return result;
  }

  function unresolvedApplicabilityItems(caseItem) {
    const result = [];
    for (const [stageIndex, stage] of (caseItem?.stages || []).entries()) {
      const stageApplicability = stage.applicability || defaultApplicability(stage);
      if (stageApplicability === APPLICABILITY.UNDECIDED) {
        result.push({ kind: 'stage', stage, stageIndex, item: stage });
        continue;
      }
      if (stageApplicability !== APPLICABILITY.INCLUDED) continue;
      for (const group of stage.groups || []) {
        if ((group.applicability || defaultApplicability(group)) !== APPLICABILITY.UNDECIDED) continue;
        result.push({ kind: 'group', stage, stageIndex, group, item: group });
      }
    }
    return result;
  }

  function unresolvedApplicability(caseItem) {
    return unresolvedApplicabilityItems(caseItem).length > 0;
  }

  function workflowFocus(caseItem) {
    const stages = caseItem?.stages || [];
    if (!stages.length) return { stage: null, stageIndex: -1, source: 'none' };

    const actualStageIndex = stages.findIndex((stage) => stage.id === caseItem?.actualStageId && isIncluded(stage));
    if (actualStageIndex >= 0) {
      return { stage: stages[actualStageIndex], stageIndex: actualStageIndex, source: 'actual' };
    }

    const firstOpenIndex = stages.findIndex((stage) =>
      isIncluded(stage) && stageStats(stage, { effectiveOnly: true }).open > 0
    );
    // A condition earlier in the workflow is actionable work too. Compare it
    // with the first open task instead of always sending an unset case to a
    // later included stage and leaving the earlier decision behind.
    const firstUnresolved = unresolvedApplicabilityItems(caseItem)[0];
    if (firstUnresolved && (firstOpenIndex < 0 || firstUnresolved.stageIndex <= firstOpenIndex)) {
      return {
        stage: firstUnresolved.stage,
        stageIndex: firstUnresolved.stageIndex,
        source: 'next_unresolved'
      };
    }
    if (firstOpenIndex >= 0) {
      return { stage: stages[firstOpenIndex], stageIndex: firstOpenIndex, source: 'next_open' };
    }

    let lastIncludedIndex = -1;
    for (let index = stages.length - 1; index >= 0; index -= 1) {
      if (isIncluded(stages[index])) {
        lastIncludedIndex = index;
        break;
      }
    }
    if (lastIncludedIndex >= 0) {
      return { stage: stages[lastIncludedIndex], stageIndex: lastIncludedIndex, source: 'last_included' };
    }
    return { stage: stages[0], stageIndex: 0, source: 'first_stage' };
  }

  function focusedUnresolvedItems(caseItem) {
    const focus = workflowFocus(caseItem);
    if (focus.stageIndex < 0) return [];
    return unresolvedApplicabilityItems(caseItem).filter((item) => item.stageIndex <= focus.stageIndex);
  }

  function taskStats(tasks) {
    const statuses = tasks.map((task) => normalizeStatus(task.status));
    const count = (status) => statuses.filter((candidate) => candidate === status).length;
    const done = count(STATUS.DONE);
    const notApplicable = count(STATUS.NOT_APPLICABLE);
    const outOfScope = count(STATUS.OUT_OF_SCOPE);
    const completedElsewhere = count(STATUS.COMPLETED_ELSEWHERE);
    const review = count(STATUS.REVIEW);
    const pendingOnly = count(STATUS.PENDING);
    const handled = statuses.filter((status) => TERMINAL_STATUSES.has(status)).length;
    const total = tasks.length;
    const applicable = total - notApplicable - outOfScope;
    const completed = done + completedElsewhere;
    const processedPercent = total ? Math.round((handled / total) * 100) : 0;
    const completionPercent = applicable ? Math.round((completed / applicable) * 100) : 100;
    return {
      total,
      done,
      notApplicable,
      outOfScope,
      completedElsewhere,
      review,
      pendingOnly,
      open: pendingOnly + review,
      pending: pendingOnly + review,
      handled,
      applicable,
      completed,
      processedPercent,
      handledPercent: processedPercent,
      completionPercent,
      // Version 3 compatibility aliases.
      skipped: notApplicable,
      percent: processedPercent
    };
  }

  function stageStats(stage, { effectiveOnly = false } = {}) {
    const allGroups = stage?.groups || [];
    const stageIncluded = isIncluded(stage);
    const includedGroups = allGroups.filter(isIncluded);
    const unresolvedGroupCount = allGroups.filter((group) =>
      (group.applicability || defaultApplicability(group)) === APPLICABILITY.UNDECIDED
    ).length;
    const excludedGroupCount = allGroups.filter((group) =>
      (group.applicability || defaultApplicability(group)) === APPLICABILITY.EXCLUDED
    ).length;
    const rawTasks = allGroups.flatMap((group) => group.tasks || []);
    const effectiveTasksForStage = stageIncluded
      ? includedGroups.flatMap((group) => group.tasks || [])
      : [];
    const tasks = effectiveOnly ? effectiveTasksForStage : rawTasks;
    const effectiveUnresolvedGroupCount = stageIncluded ? unresolvedGroupCount : 0;
    const allNotApplicable = rawTasks.length > 0
      && effectiveTasksForStage.length === 0
      && effectiveUnresolvedGroupCount === 0;
    return {
      ...taskStats(tasks),
      effectiveOnly,
      stageIncluded,
      groupCount: effectiveOnly ? (stageIncluded ? includedGroups.length : 0) : allGroups.length,
      includedGroupCount: stageIncluded ? includedGroups.length : 0,
      unresolvedGroupCount,
      effectiveUnresolvedGroupCount,
      excludedGroupCount,
      rawTotal: rawTasks.length,
      effectiveTotal: effectiveTasksForStage.length,
      allNotApplicable
    };
  }

  function groupStats(group, { effectiveOnly = false } = {}) {
    const included = isIncluded(group);
    const rawTasks = group?.tasks || [];
    const tasks = effectiveOnly && !included ? [] : rawTasks;
    return {
      ...taskStats(tasks),
      effectiveOnly,
      groupIncluded: included,
      rawTotal: rawTasks.length,
      effectiveTotal: included ? rawTasks.length : 0
    };
  }

  function caseStats(caseItem) {
    const taskEntries = effectiveTasks(caseItem);
    const tasks = taskEntries.map((item) => item.task);
    const stats = taskStats(tasks);
    const includedStages = effectiveStages(caseItem);
    const currentStage = includedStages.find((stage) => stageStats(stage, { effectiveOnly: true }).open > 0) || includedStages.at(-1) || null;
    const selectedActualStage = findStage(caseItem, caseItem?.actualStageId);
    const actualStage = isIncluded(selectedActualStage) ? selectedActualStage : null;
    const unresolvedItems = unresolvedApplicabilityItems(caseItem);
    const focusedItems = focusedUnresolvedItems(caseItem);
    const focus = workflowFocus(caseItem);
    const focusOpen = focus.stage
      ? stageStats(focus.stage, { effectiveOnly: true }).open
      : 0;
    const focusStageUnresolved = focusedItems.filter((item) => item.stageIndex === focus.stageIndex).length;
    const focusedOpen = taskEntries.filter(({ stage, task }) => {
      const stageIndex = (caseItem?.stages || []).indexOf(stage);
      return stageIndex >= 0 && stageIndex <= focus.stageIndex && OPEN_STATUSES.has(normalizeStatus(task.status));
    }).length;
    const actualStageIndex = actualStage ? (caseItem?.stages || []).indexOf(actualStage) : -1;
    const priorOpenCount = actualStageIndex < 0 ? 0 : taskEntries.filter(({ stage, task }) => {
      const stageIndex = (caseItem?.stages || []).indexOf(stage);
      return stageIndex >= 0 && stageIndex < actualStageIndex && OPEN_STATUSES.has(normalizeStatus(task.status));
    }).length;
    const rawTaskCount = flattenTasks(caseItem).length;
    const hasUndecided = unresolvedItems.length > 0;
    const futureOpenCount = taskEntries.filter(({ stage, task }) => {
      const stageIndex = (caseItem?.stages || []).indexOf(stage);
      return stageIndex > focus.stageIndex && OPEN_STATUSES.has(normalizeStatus(task.status));
    }).length;
    const futureUnresolvedCount = Math.max(0, unresolvedItems.length - focusedItems.length);
    const currentWorkCleared = focus.stageIndex >= 0
      && focusedOpen === 0
      && focusedItems.length === 0;
    const allNotApplicable = rawTaskCount > 0 && tasks.length === 0 && !hasUndecided;
    const wholeCaseComplete = (tasks.length > 0 && stats.open === 0 && !hasUndecided)
      || allNotApplicable;
    const hasFutureWork = futureOpenCount > 0 || futureUnresolvedCount > 0;
    const workflowEmpty = rawTaskCount === 0 && unresolvedItems.length === 0;
    const currentWorkState = allNotApplicable
      ? WORK_STATE.ALL_NOT_APPLICABLE
      : (wholeCaseComplete
        ? WORK_STATE.COMPLETE
      : (workflowEmpty
        ? WORK_STATE.EMPTY
        : (currentWorkCleared
          ? (hasFutureWork ? WORK_STATE.CLEARED_FUTURE_PENDING : WORK_STATE.CLEARED)
          : WORK_STATE.ACTIVE)));
    const nextActionStage = (caseItem?.stages || []).find((stage, stageIndex) => {
      if (stageIndex <= focus.stageIndex) return false;
      if (unresolvedItems.some((item) => item.stageIndex === stageIndex)) return true;
      return isIncluded(stage) && stageStats(stage, { effectiveOnly: true }).open > 0;
    }) || null;
    return {
      ...stats,
      currentStage,
      nextPendingStage: currentStage,
      actualStage,
      hasUndecided,
      hasFocusedUndecided: focusedItems.length > 0,
      focusedUnresolvedCount: focusedItems.length,
      futureUnresolvedCount,
      focusStage: focus.stage,
      focusSource: focus.source,
      focusOpen,
      focusedOpen,
      priorOpenCount,
      futureOpenCount,
      hasFutureWork,
      rawTaskCount,
      allNotApplicable,
      currentWorkCleared,
      currentWorkState,
      wholeCaseComplete,
      needsStageAdvance: currentWorkCleared && !wholeCaseComplete && hasFutureWork,
      nextActionStage,
      currentStageComplete: Boolean(focus.stage) && focusOpen === 0 && focusStageUnresolved === 0,
      focusComplete: Boolean(focus.stage) && focusedOpen === 0 && focusedItems.length === 0,
      // "complete" deliberately remains a whole-case decision. Future
      // conditional branches must still be confirmed before the case is
      // presented as fully processed.
      complete: wholeCaseComplete
    };
  }

  function nextTaskInfo(caseItem) {
    const openEntries = effectiveTasks(caseItem).filter(({ task }) => OPEN_STATUSES.has(normalizeStatus(task.status)));
    const stages = caseItem?.stages || [];
    const actualStageIndex = stages.findIndex((stage) => stage.id === caseItem?.actualStageId && isIncluded(stage));
    const focus = workflowFocus(caseItem);
    const referenceStageIndex = actualStageIndex >= 0 ? actualStageIndex : focus.stageIndex;
    const indexed = openEntries.map((entry) => ({ ...entry, stageIndex: stages.indexOf(entry.stage) }));
    const priorEntries = referenceStageIndex < 0
      ? []
      : indexed.filter((entry) => entry.stageIndex >= 0 && entry.stageIndex < referenceStageIndex);
    const stageEntries = referenceStageIndex < 0
      ? []
      : indexed.filter((entry) => entry.stageIndex === referenceStageIndex);
    const laterEntries = referenceStageIndex < 0
      ? indexed
      : indexed.filter((entry) => entry.stageIndex > referenceStageIndex);
    let selected = null;
    let decision = NEXT_TASK_DECISION.NONE;
    let fallback = null;

    if (actualStageIndex >= 0) {
      selected = stageEntries[0] || laterEntries[0] || priorEntries[0] || null;
      if (stageEntries.length) decision = NEXT_TASK_DECISION.ACTUAL;
      else if (laterEntries.length) { decision = NEXT_TASK_DECISION.LATER; fallback = 'later'; }
      else if (priorEntries.length) { decision = NEXT_TASK_DECISION.PRIOR; fallback = 'prior'; }
    } else if (openEntries.length) {
      selected = stageEntries[0] || laterEntries[0] || priorEntries[0] || indexed[0] || null;
      decision = NEXT_TASK_DECISION.FOCUS;
      // Keep the value expected by version 1.6.1 renderers while exposing the
      // more precise decision and focus fields to new callers.
      fallback = 'workflow';
    }

    let entry = null;
    let selectedStageIndex = -1;
    if (selected) {
      selectedStageIndex = selected.stageIndex;
      const { stageIndex: ignoredStageIndex, ...plainEntry } = selected;
      entry = plainEntry;
    }

    return {
      entry,
      next: entry,
      decision,
      fallback,
      isFallback: Boolean(entry) && decision !== NEXT_TASK_DECISION.ACTUAL,
      hasOpenWork: openEntries.length > 0,
      workflowOpenCount: openEntries.length,
      priorOpenCount: priorEntries.length,
      stageOpenCount: stageEntries.length,
      currentStageOpenCount: stageEntries.length,
      actualStageOpenCount: actualStageIndex >= 0 ? stageEntries.length : 0,
      laterOpenCount: laterEntries.length,
      priorEntry: priorEntries[0] || null,
      stageEntry: stageEntries[0] || null,
      laterEntry: laterEntries[0] || null,
      actualStage: actualStageIndex >= 0 ? stages[actualStageIndex] : null,
      actualStageIndex,
      focusStage: focus.stage,
      focusStageIndex: focus.stageIndex,
      focusSource: focus.source,
      referenceStageIndex,
      referenceStage: referenceStageIndex >= 0 ? stages[referenceStageIndex] : null,
      selectedStageIndex,
      selectedStage: entry?.stage || null
    };
  }

  function nextTask(caseItem) {
    const info = nextTaskInfo(caseItem);
    if (!info.entry) return null;
    return {
      ...info.entry,
      decision: info.decision,
      priorOpenCount: info.priorOpenCount,
      stageOpenCount: info.stageOpenCount,
      currentStageOpenCount: info.currentStageOpenCount,
      actualStageOpenCount: info.actualStageOpenCount,
      laterOpenCount: info.laterOpenCount,
      workflowOpenCount: info.workflowOpenCount,
      fallback: info.fallback,
      isFallback: info.isFallback,
      focusStage: info.focusStage,
      focusSource: info.focusSource
    };
  }

  function openWorkItems(stateOrCases, { includeArchived = false } = {}) {
    const cases = Array.isArray(stateOrCases) ? stateOrCases : (stateOrCases?.cases || []);
    const items = [];
    for (const caseItem of cases) {
      if (!caseItem || (!includeArchived && caseItem.archived)) continue;
      for (const entry of effectiveTasks(caseItem)) {
        const status = normalizeStatus(entry.task.status);
        if (!OPEN_STATUSES.has(status)) continue;
        items.push({
          kind: 'task',
          caseItem,
          caseId: caseItem.id,
          stage: entry.stage,
          stageId: entry.stage.id,
          group: entry.group,
          groupId: entry.group.id,
          task: entry.task,
          taskId: entry.task.id,
          status,
          dueDate: entry.task.dueDate || ''
        });
      }
      for (const stage of caseItem.stages || []) {
        const stageApplicability = stage.applicability || defaultApplicability(stage);
        if (stageApplicability === APPLICABILITY.UNDECIDED) {
          items.push({ kind: 'applicability', level: 'stage', caseItem, caseId: caseItem.id, stage, stageId: stage.id, item: stage });
          continue;
        }
        if (stageApplicability !== APPLICABILITY.INCLUDED) continue;
        for (const group of stage.groups || []) {
          if ((group.applicability || defaultApplicability(group)) !== APPLICABILITY.UNDECIDED) continue;
          items.push({ kind: 'applicability', level: 'group', caseItem, caseId: caseItem.id, stage, stageId: stage.id, group, groupId: group.id, item: group });
        }
      }
    }
    return items;
  }

  function parseLocalDate(value) {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(year, month - 1, day, 12, 0, 0, 0);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return date;
  }

  function todayAtNoon() {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    return date;
  }

  function daysUntil(value, from = todayAtNoon()) {
    const date = parseLocalDate(value);
    if (!date) return null;
    const normalizedFrom = new Date(from);
    normalizedFrom.setHours(12, 0, 0, 0);
    return Math.round((date - normalizedFrom) / 86400000);
  }

  function dueStatus(task, upcomingDays = 7, from) {
    if (!OPEN_STATUSES.has(normalizeStatus(task.status)) || !task.dueDate) return null;
    const days = daysUntil(task.dueDate, from);
    if (days === null) return null;
    if (days < 0) return { kind: 'overdue', days, label: `已超过提醒日期 ${Math.abs(days)} 天` };
    if (days === 0) return { kind: 'today', days, label: '今天提醒' };
    if (days <= upcomingDays) return { kind: 'upcoming', days, label: `${days} 天后提醒` };
    return { kind: 'future', days, label: `${days} 天后提醒` };
  }

  function csvSafeValue(value) {
    let text = String(value ?? '');
    // Spreadsheet programs may execute cells beginning with these characters
    // as formulas. Prefix user-controlled values with an apostrophe so an
    // exported case name, number or note is always treated as plain text.
    if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
    return text;
  }

  function findTask(caseItem, taskId) {
    return flattenTasks(caseItem).find(({ task }) => task.id === taskId) || null;
  }

  function findStage(caseItem, stageId) {
    return (caseItem?.stages || []).find((stage) => stage.id === stageId) || null;
  }

  function findGroup(caseItem, groupId) {
    for (const stage of caseItem?.stages || []) {
      const group = (stage.groups || []).find((candidate) => candidate.id === groupId);
      if (group) return { stage, group };
    }
    return null;
  }

  function customTask(fields = {}) {
    return {
      id: createId('task'),
      title: String(fields.title || '').trim(),
      detail: String(fields.detail || '').trim(),
      optional: Boolean(fields.optional),
      custom: true,
      status: STATUS.PENDING,
      dueDate: fields.dueDate || '',
      note: String(fields.note || '').trim(),
      completedAt: null,
      updatedAt: new Date().toISOString()
    };
  }

  function addTask(caseItem, groupId, fields) {
    const entry = findGroup(caseItem, groupId);
    if (!entry || !String(fields?.title || '').trim()) return null;
    const task = customTask(fields);
    entry.group.tasks.push(task);
    caseItem.updatedAt = task.updatedAt;
    return task;
  }

  function addGroup(caseItem, stageId, fields) {
    const stage = findStage(caseItem, stageId);
    if (!stage || !String(fields?.title || '').trim() || !String(fields?.firstTaskTitle || '').trim()) return null;
    const group = {
      id: createId('group'),
      title: String(fields.title).trim(),
      conditional: Boolean(fields.conditional),
      conditionText: String(fields.conditionText || '').trim(),
      applicability: fields.conditional ? APPLICABILITY.UNDECIDED : APPLICABILITY.INCLUDED,
      custom: true,
      tasks: [customTask({ title: fields.firstTaskTitle, detail: fields.firstTaskDetail, optional: fields.firstTaskOptional })]
    };
    stage.groups.push(group);
    caseItem.updatedAt = new Date().toISOString();
    return group;
  }

  function addStage(caseItem, fields) {
    if (!String(fields?.name || '').trim() || !String(fields?.firstTaskTitle || '').trim()) return null;
    const stage = {
      id: createId('stage'),
      name: String(fields.name).trim(),
      conditional: Boolean(fields.conditional),
      conditionText: String(fields.conditionText || '').trim(),
      applicability: fields.conditional ? APPLICABILITY.UNDECIDED : APPLICABILITY.INCLUDED,
      custom: true,
      groups: [{
        id: createId('group'),
        title: String(fields.groupTitle || '自定义事项').trim() || '自定义事项',
        conditional: false,
        conditionText: '',
        applicability: APPLICABILITY.INCLUDED,
        custom: true,
        tasks: [customTask({ title: fields.firstTaskTitle, detail: fields.firstTaskDetail, optional: fields.firstTaskOptional })]
      }]
    };
    caseItem.stages.push(stage);
    caseItem.updatedAt = new Date().toISOString();
    return stage;
  }

  function deleteCustomTask(caseItem, taskId) {
    const entry = findTask(caseItem, taskId);
    if (!entry?.task.custom) return false;
    entry.group.tasks = entry.group.tasks.filter((task) => task.id !== taskId);
    caseItem.updatedAt = new Date().toISOString();
    return true;
  }

  function deleteCustomGroup(caseItem, groupId) {
    const entry = findGroup(caseItem, groupId);
    if (!entry?.group.custom) return false;
    entry.stage.groups = entry.stage.groups.filter((group) => group.id !== groupId);
    caseItem.updatedAt = new Date().toISOString();
    return true;
  }

  function deleteCustomStage(caseItem, stageId) {
    const stage = findStage(caseItem, stageId);
    if (!stage?.custom) return false;
    caseItem.stages = caseItem.stages.filter((candidate) => candidate.id !== stageId);
    if (caseItem.actualStageId === stageId) caseItem.actualStageId = null;
    caseItem.updatedAt = new Date().toISOString();
    return true;
  }

  function workflowHasId(caseItem, itemId) {
    if (!caseItem || !itemId) return false;
    for (const stage of caseItem.stages || []) {
      if (stage.id === itemId) return true;
      for (const group of stage.groups || []) {
        if (group.id === itemId) return true;
        if ((group.tasks || []).some((task) => task.id === itemId)) return true;
      }
    }
    return false;
  }

  function nestedWorkflowIds(item) {
    const ids = [];
    const visit = (candidate) => {
      if (!candidate || typeof candidate !== 'object') return;
      if (typeof candidate.id === 'string') ids.push(candidate.id);
      for (const key of ['stages', 'groups', 'tasks']) {
        for (const child of Array.isArray(candidate[key]) ? candidate[key] : []) visit(child);
      }
    };
    visit(item);
    return ids;
  }

  function snapshotIdsAreAvailable(caseItem, snapshot) {
    return Boolean(caseItem && snapshot)
      && nestedWorkflowIds(snapshot).every((itemId) => !workflowHasId(caseItem, itemId));
  }

  function deleteCustomTemplateWithActivity(state, templateId, changedAt = new Date().toISOString()) {
    if (!ensureRecoveryState(state) || !Array.isArray(state.customTemplates)) return { ok: false, reason: 'INVALID_STATE' };
    const index = state.customTemplates.findIndex((item) => item?.id === templateId);
    const item = state.customTemplates[index];
    if (index < 0 || !item || item.builtIn === true) return { ok: false, reason: 'CUSTOM_TEMPLATE_NOT_FOUND' };
    const at = timestamp(changedAt);
    state.customTemplates.splice(index, 1);
    const event = recordActivity(state, {
      type: ACTIVITY_TYPE.CUSTOM_TEMPLATE_DELETE,
      caseId: '',
      caseName: '',
      target: { templateId, originalIndex: index },
      label: `删除自定义模板“${item.name}”`,
      before: { item: clone(item) },
      after: { itemPresent: false }
    }, at);
    return { ok: true, event, deleted: clone(item) };
  }

  function deleteCustomStageWithActivity(state, caseId, stageId, changedAt = new Date().toISOString()) {
    const caseItem = caseForChange(state, caseId);
    const index = (caseItem?.stages || []).findIndex((stage) => stage?.id === stageId);
    const item = caseItem?.stages?.[index];
    if (index < 0 || !item?.custom) return { ok: false, reason: 'CUSTOM_STAGE_NOT_FOUND' };
    const at = timestamp(changedAt);
    const beforeActualStageId = caseItem.actualStageId || null;
    caseItem.stages.splice(index, 1);
    if (caseItem.actualStageId === stageId) caseItem.actualStageId = null;
    caseItem.updatedAt = at;
    const event = recordActivity(state, {
      type: ACTIVITY_TYPE.CUSTOM_STAGE_DELETE,
      caseId,
      caseName: caseItem.name,
      target: { stageId, originalIndex: index },
      label: `删除自定义阶段“${item.name}”`,
      before: { item: clone(item), actualStageId: beforeActualStageId },
      after: { itemPresent: false, actualStageId: caseItem.actualStageId || null }
    }, at);
    return { ok: true, event, deleted: clone(item) };
  }

  function deleteCustomGroupWithActivity(state, caseId, groupId, changedAt = new Date().toISOString()) {
    const caseItem = caseForChange(state, caseId);
    const entry = findGroup(caseItem, groupId);
    const index = (entry?.stage.groups || []).findIndex((group) => group?.id === groupId);
    if (index < 0 || !entry?.group.custom) return { ok: false, reason: 'CUSTOM_GROUP_NOT_FOUND' };
    const at = timestamp(changedAt);
    const item = clone(entry.group);
    entry.stage.groups.splice(index, 1);
    caseItem.updatedAt = at;
    const event = recordActivity(state, {
      type: ACTIVITY_TYPE.CUSTOM_GROUP_DELETE,
      caseId,
      caseName: caseItem.name,
      target: { stageId: entry.stage.id, groupId, originalIndex: index },
      label: `删除自定义事项组“${item.title}”`,
      before: { item },
      after: { itemPresent: false }
    }, at);
    return { ok: true, event, deleted: clone(item) };
  }

  function deleteCustomTaskWithActivity(state, caseId, taskId, changedAt = new Date().toISOString()) {
    const caseItem = caseForChange(state, caseId);
    const entry = findTask(caseItem, taskId);
    const index = (entry?.group.tasks || []).findIndex((task) => task?.id === taskId);
    if (index < 0 || !entry?.task.custom) return { ok: false, reason: 'CUSTOM_TASK_NOT_FOUND' };
    const at = timestamp(changedAt);
    const item = clone(entry.task);
    entry.group.tasks.splice(index, 1);
    caseItem.updatedAt = at;
    const event = recordActivity(state, {
      type: ACTIVITY_TYPE.CUSTOM_TASK_DELETE,
      caseId,
      caseName: caseItem.name,
      target: { stageId: entry.stage.id, groupId: entry.group.id, taskId, originalIndex: index },
      label: `删除自定义步骤“${item.title}”`,
      before: { item },
      after: { itemPresent: false }
    }, at);
    return { ok: true, event, deleted: clone(item) };
  }

  function stripTaskForTemplate(task) {
    const result = {
      id: task.id || createId('task'),
      title: String(task.title || '').trim(),
      custom: true
    };
    if (task.detail) result.detail = String(task.detail).trim();
    if (task.optional) result.optional = true;
    if (task.needsReview) result.needsReview = true;
    return result;
  }

  function stagesForTemplate(stages) {
    return clone(stages || []).map((stage) => ({
      id: stage.id || createId('stage'),
      name: String(stage.name || '').trim(),
      custom: true,
      ...(stage.conditional ? { conditional: true } : {}),
      ...(stage.conditionText ? { conditionText: String(stage.conditionText).trim() } : {}),
      groups: (stage.groups || []).map((group) => ({
        id: group.id || createId('group'),
        title: String(group.title || '').trim(),
        custom: true,
        conditional: Boolean(group.conditional),
        conditionText: String(group.conditionText || '').trim(),
        tasks: (group.tasks || []).map(stripTaskForTemplate)
      }))
    }));
  }

  function templateFromCase(caseItem, fields = {}) {
    const sourceSnapshot = caseItem?.templateSnapshot && typeof caseItem.templateSnapshot === 'object'
      ? caseItem.templateSnapshot
      : {};
    const hasField = (field) => Object.prototype.hasOwnProperty.call(fields, field);
    const inheritedText = (field, ...fallbacks) => {
      if (hasField(field)) return stringOrEmpty(fields[field]);
      const candidates = [sourceSnapshot[field], ...fallbacks];
      return candidates.map(stringOrEmpty).find(Boolean) || '';
    };
    const sourceList = hasField('sources') ? fields.sources : sourceSnapshot.sources;
    const sources = Array.isArray(sourceList)
      ? sourceList.map((source) => ({ title: stringOrEmpty(source?.title), url: stringOrEmpty(source?.url) }))
      : [];
    const now = new Date().toISOString();
    return {
      id: createId('template'),
      name: String(fields.name || `${caseItem.name}流程模板`).trim(),
      category: inheritedText('category', caseItem?.caseType, 'custom'),
      categoryLabel: inheritedText('categoryLabel', caseItem?.caseTypeLabel, '自定义案件'),
      description: inheritedText('description', '由案件流程保存生成，可继续编辑。'),
      role: inheritedText('role'),
      scope: inheritedText('scope'),
      sourceVersion: inheritedText('sourceVersion'),
      lastReviewedAt: inheritedText('lastReviewedAt'),
      legalNote: inheritedText('legalNote'),
      sources,
      derivedFrom: {
        kind: 'case',
        caseId: stringOrEmpty(caseItem?.id),
        caseName: stringOrEmpty(caseItem?.name),
        templateId: stringOrEmpty(sourceSnapshot.id) || stringOrEmpty(caseItem?.templateId),
        templateName: stringOrEmpty(sourceSnapshot.name) || stringOrEmpty(caseItem?.templateName),
        at: now
      },
      builtIn: false,
      createdAt: now,
      updatedAt: now,
      stages: stagesForTemplate(caseItem.stages)
    };
  }

  function createBlankTemplate(fields = {}) {
    const pseudoCase = { stages: [] };
    const stage = addStage(pseudoCase, {
      name: fields.stageName || '第一阶段',
      groupTitle: fields.groupTitle || '主要事项',
      firstTaskTitle: fields.firstTaskTitle || '第一个办理步骤'
    });
    return {
      id: createId('template'),
      name: String(fields.name || '自定义流程模板').trim(),
      category: fields.category || 'custom',
      categoryLabel: String(fields.categoryLabel || '其他 / 自定义').trim(),
      description: String(fields.description || '自定义流程模板').trim(),
      role: stringOrEmpty(fields.role),
      scope: stringOrEmpty(fields.scope),
      builtIn: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      stages: stagesForTemplate(stage ? pseudoCase.stages : [])
    };
  }

  function setTaskStatus(caseItem, taskId, status, changedAt = new Date().toISOString()) {
    const item = findTask(caseItem, taskId);
    const normalizedStatus = status === 'skipped' ? STATUS.NOT_APPLICABLE : status;
    if (!item || !VALID_STATUSES.has(normalizedStatus)) return false;
    item.task.status = normalizedStatus;
    item.task.completedAt = normalizedStatus === STATUS.DONE ? changedAt : null;
    item.task.updatedAt = changedAt;
    caseItem.updatedAt = item.task.updatedAt;
    return true;
  }

  function setGroupStatus(caseItem, groupId, status, changedAt = new Date().toISOString()) {
    let changed = false;
    for (const stage of caseItem.stages || []) {
      const group = (stage.groups || []).find((candidate) => candidate.id === groupId);
      if (!group) continue;
      for (const task of group.tasks || []) {
        const currentStatus = normalizeStatus(task.status);
        if (status === STATUS.DONE && !OPEN_STATUSES.has(currentStatus)) continue;
        if (status === STATUS.PENDING && ![STATUS.DONE, STATUS.NOT_APPLICABLE].includes(currentStatus)) continue;
        changed = setTaskStatus(caseItem, task.id, status, changedAt) || changed;
      }
      break;
    }
    return changed;
  }

  function setStageApplicability(caseItem, stageId, applicability, changedAt = new Date().toISOString()) {
    const stage = findStage(caseItem, stageId);
    if (!stage?.conditional || !Object.values(APPLICABILITY).includes(applicability)) return false;
    stage.applicability = applicability;
    if (applicability !== APPLICABILITY.INCLUDED && caseItem.actualStageId === stage.id) caseItem.actualStageId = null;
    caseItem.updatedAt = changedAt;
    return true;
  }

  function setGroupApplicability(caseItem, groupId, applicability, changedAt = new Date().toISOString()) {
    const entry = findGroup(caseItem, groupId);
    if (!entry?.group.conditional || !Object.values(APPLICABILITY).includes(applicability)) return false;
    entry.group.applicability = applicability;
    caseItem.updatedAt = changedAt;
    return true;
  }

  function setActualStage(caseItem, stageId) {
    if (stageId === null || stageId === '') {
      caseItem.actualStageId = null;
      caseItem.updatedAt = new Date().toISOString();
      return true;
    }
    const stage = findStage(caseItem, stageId);
    if (!stage || !isIncluded(stage)) return false;
    caseItem.actualStageId = stage.id;
    caseItem.updatedAt = new Date().toISOString();
    return true;
  }

  function ensureRecoveryState(state) {
    if (!state || typeof state !== 'object' || Array.isArray(state)) return false;
    if (!Array.isArray(state.cases)) state.cases = [];
    if (!Array.isArray(state.recentActivity)) state.recentActivity = [];
    if (!state.recycleBin || typeof state.recycleBin !== 'object' || Array.isArray(state.recycleBin)) state.recycleBin = { cases: [] };
    if (!Array.isArray(state.recycleBin.cases)) state.recycleBin.cases = [];
    return true;
  }

  function timestamp(value) {
    return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : new Date().toISOString();
  }

  function statusSnapshot(task) {
    return { status: normalizeStatus(task?.status), completedAt: task?.completedAt || null };
  }

  function sameStatusSnapshot(task, snapshot) {
    return Boolean(task && snapshot)
      && normalizeStatus(task.status) === snapshot.status
      && (task.completedAt || null) === (snapshot.completedAt || null);
  }

  function importantDateStatusSnapshot(caseItem) {
    return {
      importantDate: String(caseItem?.importantDate || ''),
      importantDateHandledAt: caseItem?.importantDateHandledAt || null
    };
  }

  function sameImportantDateStatusSnapshot(caseItem, snapshot) {
    return Boolean(caseItem && snapshot)
      && String(caseItem.importantDate || '') === snapshot.importantDate
      && (caseItem.importantDateHandledAt || null) === (snapshot.importantDateHandledAt || null);
  }

  function recordActivity(state, details, changedAt) {
    if (!ensureRecoveryState(state)) return null;
    const event = {
      id: createId('activity'),
      at: timestamp(changedAt),
      type: details.type,
      caseId: String(details.caseId || ''),
      caseName: String(details.caseName || ''),
      target: clone(details.target || {}),
      label: String(details.label || '更新案件流程'),
      before: details.before === undefined ? null : clone(details.before),
      after: details.after === undefined ? null : clone(details.after),
      changes: Array.isArray(details.changes) ? clone(details.changes) : [],
      undoneAt: null,
      undoOf: null
    };
    state.recentActivity.unshift(event);
    state.recentActivity = state.recentActivity.slice(0, RECENT_ACTIVITY_LIMIT);
    state.updatedAt = event.at;
    return event;
  }

  function caseForChange(state, caseId) {
    if (!ensureRecoveryState(state)) return null;
    return state.cases.find((item) => item?.id === caseId) || null;
  }

  function changeTaskStatus(state, caseId, taskId, status, changedAt = new Date().toISOString()) {
    const caseItem = caseForChange(state, caseId);
    const entry = findTask(caseItem, taskId);
    const normalizedStatus = status === 'skipped' ? STATUS.NOT_APPLICABLE : status;
    if (!entry || !VALID_STATUSES.has(normalizedStatus)) return { ok: false, reason: 'INVALID_TARGET_OR_STATUS' };
    const before = statusSnapshot(entry.task);
    if (before.status === normalizedStatus) return { ok: false, reason: 'NO_CHANGE' };
    const at = timestamp(changedAt);
    setTaskStatus(caseItem, taskId, normalizedStatus, at);
    const after = statusSnapshot(entry.task);
    const event = recordActivity(state, {
      type: ACTIVITY_TYPE.TASK_STATUS,
      caseId,
      caseName: caseItem.name,
      target: { stageId: entry.stage.id, groupId: entry.group.id, taskId },
      label: `更新任务“${entry.task.title}”状态`,
      before,
      after
    }, at);
    return { ok: true, event };
  }

  function changeGroupStatus(state, caseId, groupId, status, changedAt = new Date().toISOString()) {
    const caseItem = caseForChange(state, caseId);
    const entry = findGroup(caseItem, groupId);
    const normalizedStatus = status === 'skipped' ? STATUS.NOT_APPLICABLE : status;
    if (!entry || !VALID_STATUSES.has(normalizedStatus)) return { ok: false, reason: 'INVALID_TARGET_OR_STATUS' };
    const candidates = (entry.group.tasks || []).filter((task) => {
      const current = normalizeStatus(task.status);
      if (normalizedStatus === STATUS.DONE) return OPEN_STATUSES.has(current);
      if (normalizedStatus === STATUS.PENDING) return [STATUS.DONE, STATUS.NOT_APPLICABLE].includes(current);
      return current !== normalizedStatus;
    });
    if (!candidates.length) return { ok: false, reason: 'NO_CHANGE' };
    const at = timestamp(changedAt);
    const changes = candidates.map((task) => ({ taskId: task.id, before: statusSnapshot(task), after: null }));
    for (const change of changes) {
      setTaskStatus(caseItem, change.taskId, normalizedStatus, at);
      change.after = statusSnapshot(findTask(caseItem, change.taskId)?.task);
    }
    const event = recordActivity(state, {
      type: ACTIVITY_TYPE.GROUP_STATUS,
      caseId,
      caseName: caseItem.name,
      target: { stageId: entry.stage.id, groupId },
      label: normalizedStatus === STATUS.DONE ? `批量完成“${entry.group.title}”` : `批量更新“${entry.group.title}”`,
      changes
    }, at);
    return { ok: true, event };
  }

  function changeStageApplicability(state, caseId, stageId, applicability, changedAt = new Date().toISOString()) {
    const caseItem = caseForChange(state, caseId);
    const stage = findStage(caseItem, stageId);
    if (!stage?.conditional || !Object.values(APPLICABILITY).includes(applicability)) return { ok: false, reason: 'INVALID_TARGET_OR_APPLICABILITY' };
    const before = { applicability: stage.applicability || defaultApplicability(stage), actualStageId: caseItem.actualStageId || null };
    if (before.applicability === applicability) return { ok: false, reason: 'NO_CHANGE' };
    const at = timestamp(changedAt);
    setStageApplicability(caseItem, stageId, applicability, at);
    const after = { applicability: stage.applicability, actualStageId: caseItem.actualStageId || null };
    const event = recordActivity(state, {
      type: ACTIVITY_TYPE.STAGE_APPLICABILITY,
      caseId,
      caseName: caseItem.name,
      target: { stageId },
      label: `将阶段“${stage.name}”设为${applicability === APPLICABILITY.INCLUDED ? '适用' : applicability === APPLICABILITY.EXCLUDED ? '不适用' : '待确认'}`,
      before,
      after
    }, at);
    return { ok: true, event };
  }

  function changeGroupApplicability(state, caseId, groupId, applicability, changedAt = new Date().toISOString()) {
    const caseItem = caseForChange(state, caseId);
    const entry = findGroup(caseItem, groupId);
    if (!entry?.group.conditional || !Object.values(APPLICABILITY).includes(applicability)) return { ok: false, reason: 'INVALID_TARGET_OR_APPLICABILITY' };
    const before = { applicability: entry.group.applicability || defaultApplicability(entry.group) };
    if (before.applicability === applicability) return { ok: false, reason: 'NO_CHANGE' };
    const at = timestamp(changedAt);
    setGroupApplicability(caseItem, groupId, applicability, at);
    const after = { applicability: entry.group.applicability };
    const event = recordActivity(state, {
      type: ACTIVITY_TYPE.GROUP_APPLICABILITY,
      caseId,
      caseName: caseItem.name,
      target: { stageId: entry.stage.id, groupId },
      label: `将事项组“${entry.group.title}”设为${applicability === APPLICABILITY.INCLUDED ? '适用' : applicability === APPLICABILITY.EXCLUDED ? '不适用' : '待确认'}`,
      before,
      after
    }, at);
    return { ok: true, event };
  }

  function changeCaseImportantDateStatus(state, caseId, handled, changedAt = new Date().toISOString()) {
    const caseItem = caseForChange(state, caseId);
    if (!caseItem) return { ok: false, reason: 'CASE_NOT_FOUND' };
    if (!caseItem.importantDate) return { ok: false, reason: 'IMPORTANT_DATE_NOT_SET' };
    if (typeof handled !== 'boolean') return { ok: false, reason: 'INVALID_HANDLED_STATUS' };
    const before = importantDateStatusSnapshot(caseItem);
    if (Boolean(before.importantDateHandledAt) === handled) return { ok: false, reason: 'NO_CHANGE' };
    const at = timestamp(changedAt);
    caseItem.importantDateHandledAt = handled ? at : null;
    caseItem.updatedAt = at;
    const after = importantDateStatusSnapshot(caseItem);
    const event = recordActivity(state, {
      type: ACTIVITY_TYPE.CASE_IMPORTANT_DATE_STATUS,
      caseId,
      caseName: caseItem.name,
      target: {},
      label: handled ? '将案件关键日期标记为已处理' : '将案件关键日期恢复为待处理',
      before,
      after
    }, at);
    return { ok: true, event };
  }

  function moveCaseToRecycleBin(state, caseId, changedAt = new Date().toISOString()) {
    if (!ensureRecoveryState(state)) return { ok: false, reason: 'INVALID_STATE' };
    if (state.recycleBin.cases.length >= RECYCLE_BIN_CASE_LIMIT) return { ok: false, reason: 'RECYCLE_BIN_FULL' };
    const index = state.cases.findIndex((item) => item?.id === caseId);
    if (index < 0) return { ok: false, reason: 'CASE_NOT_FOUND' };
    const at = timestamp(changedAt);
    const caseItem = state.cases[index];
    const trash = {
      id: createId('trash'),
      deletedAt: at,
      originalIndex: index,
      caseSnapshot: clone(caseItem)
    };
    state.cases.splice(index, 1);
    state.recycleBin.cases.unshift(trash);
    const event = recordActivity(state, {
      type: ACTIVITY_TYPE.CASE_DELETE,
      caseId,
      caseName: caseItem.name,
      target: { trashId: trash.id, originalIndex: index },
      label: `将案件“${caseItem.name}”移至最近删除`
    }, at);
    return { ok: true, event, trash };
  }

  function restoreRecycledCase(state, trashId, changedAt = new Date().toISOString()) {
    if (!ensureRecoveryState(state)) return { ok: false, reason: 'INVALID_STATE' };
    const index = state.recycleBin.cases.findIndex((item) => item?.id === trashId);
    if (index < 0) return { ok: false, reason: 'RECYCLED_CASE_NOT_FOUND' };
    const trash = state.recycleBin.cases[index];
    if (state.cases.some((item) => item?.id === trash.caseSnapshot?.id)) return { ok: false, reason: 'CASE_ID_CONFLICT' };
    const at = timestamp(changedAt);
    const caseItem = clone(trash.caseSnapshot);
    const insertionIndex = Math.min(Math.max(Number.isInteger(trash.originalIndex) ? trash.originalIndex : 0, 0), state.cases.length);
    state.recycleBin.cases.splice(index, 1);
    state.cases.splice(insertionIndex, 0, caseItem);
    const event = recordActivity(state, {
      type: ACTIVITY_TYPE.CASE_RESTORE,
      caseId: caseItem.id,
      caseName: caseItem.name,
      target: { trashId, originalIndex: insertionIndex },
      label: `恢复案件“${caseItem.name}”`
    }, at);
    return { ok: true, event, caseItem };
  }

  function purgeRecycledCase(state, trashId, changedAt = new Date().toISOString()) {
    if (!ensureRecoveryState(state)) return { ok: false, reason: 'INVALID_STATE' };
    const index = state.recycleBin.cases.findIndex((item) => item?.id === trashId);
    if (index < 0) return { ok: false, reason: 'RECYCLED_CASE_NOT_FOUND' };
    state.recycleBin.cases.splice(index, 1);
    state.updatedAt = timestamp(changedAt);
    return { ok: true };
  }

  function canUndoActivity(state, eventOrId) {
    if (!ensureRecoveryState(state)) return false;
    const event = typeof eventOrId === 'string'
      ? state.recentActivity.find((item) => item?.id === eventOrId)
      : eventOrId;
    if (!event || event.undoneAt) return false;
    const caseItem = state.cases.find((item) => item?.id === event.caseId);
    if (event.type === ACTIVITY_TYPE.TASK_STATUS) {
      return sameStatusSnapshot(findTask(caseItem, event.target?.taskId)?.task, event.after);
    }
    if (event.type === ACTIVITY_TYPE.GROUP_STATUS) {
      return Array.isArray(event.changes) && event.changes.length > 0
        && event.changes.every((change) => sameStatusSnapshot(findTask(caseItem, change.taskId)?.task, change.after));
    }
    if (event.type === ACTIVITY_TYPE.STAGE_APPLICABILITY) {
      const stage = findStage(caseItem, event.target?.stageId);
      return Boolean(stage)
        && (stage.applicability || defaultApplicability(stage)) === event.after?.applicability
        && (caseItem.actualStageId || null) === (event.after?.actualStageId || null);
    }
    if (event.type === ACTIVITY_TYPE.GROUP_APPLICABILITY) {
      const group = findGroup(caseItem, event.target?.groupId)?.group;
      return Boolean(group) && (group.applicability || defaultApplicability(group)) === event.after?.applicability;
    }
    if (event.type === ACTIVITY_TYPE.CASE_IMPORTANT_DATE_STATUS) {
      return sameImportantDateStatusSnapshot(caseItem, event.after);
    }
    if (event.type === ACTIVITY_TYPE.CUSTOM_TEMPLATE_DELETE) {
      const snapshot = event.before?.item;
      return Boolean(snapshot)
        && Array.isArray(state.customTemplates)
        && !state.customTemplates.some((item) => item?.id === snapshot.id);
    }
    if (event.type === ACTIVITY_TYPE.CUSTOM_STAGE_DELETE) {
      const snapshot = event.before?.item;
      return Boolean(caseItem && snapshot)
        && snapshotIdsAreAvailable(caseItem, snapshot)
        && (caseItem.actualStageId || null) === (event.after?.actualStageId || null);
    }
    if (event.type === ACTIVITY_TYPE.CUSTOM_GROUP_DELETE) {
      const snapshot = event.before?.item;
      const parent = findStage(caseItem, event.target?.stageId);
      return Boolean(parent && snapshot) && snapshotIdsAreAvailable(caseItem, snapshot);
    }
    if (event.type === ACTIVITY_TYPE.CUSTOM_TASK_DELETE) {
      const snapshot = event.before?.item;
      const parent = findGroup(caseItem, event.target?.groupId)?.group;
      return Boolean(parent && snapshot) && !workflowHasId(caseItem, snapshot.id);
    }
    if (event.type === ACTIVITY_TYPE.CASE_DELETE) {
      return !caseItem && state.recycleBin.cases.some((item) => item?.id === event.target?.trashId && item.caseSnapshot?.id === event.caseId);
    }
    if (event.type === ACTIVITY_TYPE.CASE_RESTORE) {
      return Boolean(caseItem) && !state.recycleBin.cases.some((item) => item?.id === event.target?.trashId);
    }
    return false;
  }

  function undoActivity(state, eventId, changedAt = new Date().toISOString()) {
    if (!ensureRecoveryState(state)) return { ok: false, reason: 'INVALID_STATE' };
    const event = state.recentActivity.find((item) => item?.id === eventId);
    if (!event || !canUndoActivity(state, event)) return { ok: false, reason: 'NOT_UNDOABLE' };
    const at = timestamp(changedAt);
    const caseItem = state.cases.find((item) => item?.id === event.caseId);
    if (event.type === ACTIVITY_TYPE.TASK_STATUS) {
      const task = findTask(caseItem, event.target.taskId).task;
      task.status = event.before.status;
      task.completedAt = event.before.completedAt || null;
      task.updatedAt = at;
      caseItem.updatedAt = at;
    } else if (event.type === ACTIVITY_TYPE.GROUP_STATUS) {
      for (const change of event.changes) {
        const task = findTask(caseItem, change.taskId).task;
        task.status = change.before.status;
        task.completedAt = change.before.completedAt || null;
        task.updatedAt = at;
      }
      caseItem.updatedAt = at;
    } else if (event.type === ACTIVITY_TYPE.STAGE_APPLICABILITY) {
      const stage = findStage(caseItem, event.target.stageId);
      stage.applicability = event.before.applicability;
      caseItem.actualStageId = event.before.actualStageId || null;
      caseItem.updatedAt = at;
    } else if (event.type === ACTIVITY_TYPE.GROUP_APPLICABILITY) {
      const group = findGroup(caseItem, event.target.groupId).group;
      group.applicability = event.before.applicability;
      caseItem.updatedAt = at;
    } else if (event.type === ACTIVITY_TYPE.CASE_IMPORTANT_DATE_STATUS) {
      caseItem.importantDateHandledAt = event.before.importantDateHandledAt || null;
      caseItem.updatedAt = at;
    } else if (event.type === ACTIVITY_TYPE.CUSTOM_TEMPLATE_DELETE) {
      const insertionIndex = Math.min(Math.max(event.target.originalIndex, 0), state.customTemplates.length);
      state.customTemplates.splice(insertionIndex, 0, clone(event.before.item));
    } else if (event.type === ACTIVITY_TYPE.CUSTOM_STAGE_DELETE) {
      const insertionIndex = Math.min(Math.max(event.target.originalIndex, 0), caseItem.stages.length);
      caseItem.stages.splice(insertionIndex, 0, clone(event.before.item));
      caseItem.actualStageId = event.before.actualStageId || null;
      caseItem.updatedAt = at;
    } else if (event.type === ACTIVITY_TYPE.CUSTOM_GROUP_DELETE) {
      const stage = findStage(caseItem, event.target.stageId);
      const insertionIndex = Math.min(Math.max(event.target.originalIndex, 0), stage.groups.length);
      stage.groups.splice(insertionIndex, 0, clone(event.before.item));
      caseItem.updatedAt = at;
    } else if (event.type === ACTIVITY_TYPE.CUSTOM_TASK_DELETE) {
      const group = findGroup(caseItem, event.target.groupId).group;
      const insertionIndex = Math.min(Math.max(event.target.originalIndex, 0), group.tasks.length);
      group.tasks.splice(insertionIndex, 0, clone(event.before.item));
      caseItem.updatedAt = at;
    } else if (event.type === ACTIVITY_TYPE.CASE_DELETE) {
      const index = state.recycleBin.cases.findIndex((item) => item?.id === event.target.trashId);
      const trash = state.recycleBin.cases[index];
      const insertionIndex = Math.min(Math.max(Number.isInteger(event.target.originalIndex) ? event.target.originalIndex : 0, 0), state.cases.length);
      state.recycleBin.cases.splice(index, 1);
      state.cases.splice(insertionIndex, 0, clone(trash.caseSnapshot));
    } else if (event.type === ACTIVITY_TYPE.CASE_RESTORE) {
      if (state.recycleBin.cases.length >= RECYCLE_BIN_CASE_LIMIT) return { ok: false, reason: 'RECYCLE_BIN_FULL' };
      const index = state.cases.findIndex((item) => item?.id === event.caseId);
      if (index < 0) return { ok: false, reason: 'NOT_UNDOABLE' };
      const caseSnapshot = clone(state.cases[index]);
      state.cases.splice(index, 1);
      state.recycleBin.cases.unshift({
        id: event.target.trashId,
        deletedAt: at,
        originalIndex: Number.isInteger(event.target.originalIndex) ? event.target.originalIndex : index,
        caseSnapshot
      });
    }
    event.undoneAt = at;
    const discardAfterUndo = CUSTOM_DELETE_ACTIVITY_TYPES.has(event.type)
      || event.type === ACTIVITY_TYPE.CASE_IMPORTANT_DATE_STATUS;
    if (discardAfterUndo) {
      const eventIndex = state.recentActivity.findIndex((item) => item?.id === event.id);
      if (eventIndex >= 0) state.recentActivity.splice(eventIndex, 1);
    }
    state.updatedAt = at;
    return { ok: true, event, activityRemoved: discardAfterUndo };
  }

  return {
    CURRENT_STATE_VERSION,
    VALIDATION_LIMITS,
    RECENT_ACTIVITY_LIMIT,
    RECYCLE_BIN_CASE_LIMIT,
    STATUS,
    APPLICABILITY,
    WORK_STATE,
    NEXT_TASK_DECISION,
    ACTIVITY_TYPE,
    clone,
    createEmptyState,
    createCase,
    templateSnapshot,
    normalizeState,
    validateState,
    flattenTasks,
    effectiveStages,
    effectiveTasks,
    unresolvedApplicabilityItems,
    unresolvedApplicability,
    workflowFocus,
    focusedUnresolvedItems,
    isIncluded,
    stageStats,
    groupStats,
    caseStats,
    nextTaskInfo,
    nextTask,
    openWorkItems,
    parseLocalDate,
    daysUntil,
    dueStatus,
    csvSafeValue,
    createId,
    findStage,
    findGroup,
    findTask,
    addTask,
    addGroup,
    addStage,
    deleteCustomTask,
    deleteCustomGroup,
    deleteCustomStage,
    deleteCustomTemplateWithActivity,
    deleteCustomStageWithActivity,
    deleteCustomGroupWithActivity,
    deleteCustomTaskWithActivity,
    stagesForTemplate,
    templateFromCase,
    createBlankTemplate,
    setTaskStatus,
    setGroupStatus,
    setStageApplicability,
    setGroupApplicability,
    setActualStage,
    changeTaskStatus,
    changeGroupStatus,
    changeStageApplicability,
    changeGroupApplicability,
    changeCaseImportantDateStatus,
    moveCaseToRecycleBin,
    restoreRecycledCase,
    purgeRecycledCase,
    canUndoActivity,
    undoActivity
  };
});
