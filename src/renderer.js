(function runApplication() {
  'use strict';

  const api = window.caseTracker;
  const model = window.CaseModel;
  const workflow = window.WorkflowData.template;
  const builtInTemplates = [
    ...(window.WorkflowData.templates || [workflow]),
    ...(window.AdditionalWorkflowData?.templates || [])
  ];
  const templateCategories = window.WorkflowData.categories || [{ id: 'custom', name: '其他 / 自定义' }];

  let state = model.createEmptyState();
  let currentView = 'dashboard';
  let selectedCaseId = null;
  let selectedTemplateId = null;
  let templateDraft = null;
  let templateDraftBaseline = '';
  let activeStageId = null;
  let searchQuery = '';
  let caseTaskSearchQuery = '';
  let caseFilter = 'all';
  let caseTypeFilter = 'all';
  let todoFilter = 'workday';
  let todoCaseFilter = 'all';
  let todoTypeFilter = 'all';
  let todoOwnerFilter = 'all';
  let todoPage = 1;
  let saveTimer = null;
  let saveMessage = '数据保存在本机';
  let renderedView = null;
  let pendingBackupToken = null;
  let saveInFlight = Promise.resolve();
  let recoveryInProgress = false;
  let changeRevision = 0;
  let persistedRevision = 0;
  let storageInfoCache = null;
  let storageHealthCache = null;
  let dataCenterTab = 'backup';
  const localUndoActions = new Map();
  const TODO_PAGE_SIZE = 50;
  const WORKDAY_UNDATED_LIMIT_PER_CASE = 3;

  const appRoot = document.getElementById('app');
  const modalRoot = document.getElementById('modal-root');
  const toastRoot = document.getElementById('toast-root');

  if (!api) {
    appRoot.innerHTML = '<div class="launch-screen"><div class="launch-mark">案</div><div style="color:#34445c;font-size:16px;font-weight:700">这是桌面程序的内部页面</div><div style="max-width:520px;text-align:center;line-height:1.8">请不要直接用浏览器打开 index.html。请解压 Windows 便携版后，双击“LegalCaseTracker.exe”运行。</div></div>';
    return;
  }

  const icons = {
    dashboard: '<path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"/>',
    todo: '<path d="M9 5h11M9 12h11M9 19h11M4 5l1 1 2-2M4 12l1 1 2-2M4 19l1 1 2-2"/>',
    cases: '<path d="M4 5h16v15H4zM8 5V3h8v2M8 10h8M8 14h8"/>',
    templates: '<path d="M5 4h12a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2V4Zm2 12h12M9 8h6M9 11h7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    download: '<path d="M12 3v12m0 0 5-5m-5 5-5-5M5 21h14"/>',
    upload: '<path d="M12 16V4m0 0 5 5m-5-5L7 9M5 20h14"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.01"/>',
    export: '<path d="M14 3h7v7m0-7-9 9M19 13v7H4V5h7"/>',
    edit: '<path d="m4 20 4.5-1 10-10-3.5-3.5-10 10L4 20zM13.5 7l3.5 3.5"/>',
    archive: '<path d="M3 6h18v4H3zM5 10v10h14V10M9 14h6"/>'
  };

  function icon(name, className = 'btn-icon') {
    return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || ''}</svg>`;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function formatDate(value) {
    const date = model.parseLocalDate(value);
    if (!date) return '';
    return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
  }

  function formatClock(value = new Date()) {
    return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(value);
  }

  function todayInputValue() {
    const date = new Date();
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  const taskStatusOptions = [
    { value: model.STATUS.PENDING || 'pending', label: '待办理', tone: 'pending' },
    { value: model.STATUS.DONE || 'done', label: '已完成', tone: 'done' },
    { value: model.STATUS.NOT_APPLICABLE || 'not_applicable', label: '不适用', tone: 'not-applicable' },
    { value: model.STATUS.OUT_OF_SCOPE || 'out_of_scope', label: '非委托范围', tone: 'out-of-scope' },
    { value: model.STATUS.COMPLETED_ELSEWHERE || 'completed_elsewhere', label: '已由他人完成', tone: 'completed-elsewhere' },
    { value: model.STATUS.REVIEW || 'review', label: '待复核', tone: 'review' }
  ];

  function normalizedTaskStatus(task) {
    if (task?.status === 'skipped') return model.STATUS.NOT_APPLICABLE || 'not_applicable';
    return taskStatusOptions.some((item) => item.value === task?.status) ? task.status : (model.STATUS.PENDING || 'pending');
  }

  function taskStatusMeta(task) {
    const value = normalizedTaskStatus(task);
    return taskStatusOptions.find((item) => item.value === value) || taskStatusOptions[0];
  }

  function applicabilityOf(item) {
    return item?.conditional ? (['undecided', 'included', 'excluded'].includes(item.applicability) ? item.applicability : 'undecided') : 'included';
  }

  function applicabilityLabel(value) {
    return ({ undecided: '待确认', included: '适用', excluded: '不适用' })[value] || '待确认';
  }

  function isStageEffective(stage) {
    if (typeof model.isIncluded === 'function') return model.isIncluded(stage);
    if (typeof model.isStageActive === 'function') return model.isStageActive(stage);
    return !stage?.conditional || applicabilityOf(stage) === 'included';
  }

  function isGroupEffective(stage, group) {
    if (!isStageEffective(stage)) return false;
    if (typeof model.isIncluded === 'function') return model.isIncluded(group);
    if (typeof model.isGroupActive === 'function') return model.isGroupActive(group, stage);
    return !group?.conditional || applicabilityOf(group) === 'included';
  }

  function effectiveTaskEntries(caseItem) {
    if (typeof model.effectiveTasks === 'function') return model.effectiveTasks(caseItem);
    return model.flattenTasks(caseItem).filter(({ stage, group }) => isGroupEffective(stage, group));
  }

  function statValue(stats, key, fallbackKey, fallback = 0) {
    if (Number.isFinite(stats?.[key])) return stats[key];
    if (fallbackKey && Number.isFinite(stats?.[fallbackKey])) return stats[fallbackKey];
    return fallback;
  }

  function progressValues(stats) {
    return {
      processed: statValue(stats, 'processed', 'handled'),
      open: statValue(stats, 'open', 'pending'),
      handledPercent: statValue(stats, 'handledPercent', 'percent'),
      completionPercent: statValue(stats, 'completionPercent', null, statValue(stats, 'percent')),
      applicable: statValue(stats, 'applicable', 'total'),
      completed: statValue(stats, 'completed', 'done'),
      review: statValue(stats, 'review', null)
    };
  }

  function actualStageFor(caseItem, stats = model.caseStats(caseItem)) {
    return stats.actualStage || (caseItem.actualStageId ? getStage(caseItem, caseItem.actualStageId) : null);
  }

  function workdayStageFor(caseItem, stats = model.caseStats(caseItem)) {
    return actualStageFor(caseItem, stats) || stats.focusStage || stats.nextPendingStage || stats.currentStage || caseItem.stages?.[0] || null;
  }

  function caseWorkState(caseItem, stats = model.caseStats(caseItem)) {
    const rawTaskCount = Number.isFinite(stats.rawTaskCount) ? stats.rawTaskCount : model.flattenTasks(caseItem).length;
    const allNotApplicable = Boolean(stats.allNotApplicable)
      || stats.currentWorkState === (model.WORK_STATE?.ALL_NOT_APPLICABLE || 'all_not_applicable')
      || (rawTaskCount > 0 && effectiveTaskEntries(caseItem).length === 0 && !stats.hasUndecided);
    return {
      allNotApplicable,
      complete: Boolean(stats.complete || stats.wholeCaseComplete || allNotApplicable),
      currentCleared: Boolean(stats.currentWorkCleared),
      hasFutureWork: Boolean(stats.hasFutureWork)
    };
  }

  function caseWorkLabel(caseItem, stats = model.caseStats(caseItem)) {
    const work = caseWorkState(caseItem, stats);
    if (work.allNotApplicable) return '本案无适用清单';
    if (work.complete) return '全案清单已处理';
    if (work.currentCleared && work.hasFutureWork) return '当前阶段已处理';
    if (work.currentCleared) return '当前清单已处理';
    return '办理中';
  }

  function isOpenTask(task) {
    const status = normalizedTaskStatus(task);
    return [model.STATUS.PENDING || 'pending', model.STATUS.REVIEW || 'review'].includes(status);
  }

  function caseNextInfo(caseItem) {
    if (typeof model.nextTaskInfo === 'function') {
      const info = model.nextTaskInfo(caseItem) || {};
      const entry = info.entry || info.next || info.taskEntry || (info.task ? info : null);
      return {
        entry,
        fallback: info.fallback || '',
        decision: info.decision || '',
        priorOpenCount: Number(info.priorOpenCount ?? info.priorPendingCount) || 0,
        stageOpenCount: Number(info.stageOpenCount ?? info.currentStageOpenCount) || 0,
        laterOpenCount: Number(info.laterOpenCount) || 0,
        isFallback: Boolean(info.isFallback)
      };
    }

    const modelNext = model.nextTask(caseItem);
    if (modelNext && ('priorOpenCount' in modelNext || 'actualStageOpenCount' in modelNext || 'isFallback' in modelNext)) {
      return {
        entry: modelNext.task ? modelNext : (modelNext.entry || null),
        fallback: modelNext.fallback || '',
        priorOpenCount: Number(modelNext.priorOpenCount) || 0,
        stageOpenCount: Number(modelNext.actualStageOpenCount) || 0,
        isFallback: Boolean(modelNext.isFallback)
      };
    }

    const stages = caseItem.stages || [];
    const actual = actualStageFor(caseItem);
    const actualIndex = stages.findIndex((stage) => stage.id === actual?.id);
    let entry = null;
    let priorOpenCount = 0;
    let stageOpenCount = 0;
    for (const [stageIndex, stage] of stages.entries()) {
      if (!isStageEffective(stage)) continue;
      for (const group of stage.groups || []) {
        if (!isGroupEffective(stage, group)) continue;
        for (const task of group.tasks || []) {
          if (!isOpenTask(task)) continue;
          const taskEntry = { stage, group, task };
          if (actualIndex >= 0 && stageIndex < actualIndex) priorOpenCount += 1;
          if (actualIndex >= 0 && stageIndex === actualIndex) {
            stageOpenCount += 1;
            if (!entry) entry = taskEntry;
          }
        }
      }
    }
    if (!entry) entry = modelNext;
    return { entry, priorOpenCount, stageOpenCount };
  }

  function nextTaskTitle(nextInfo) {
    return nextInfo?.entry?.task?.title || nextInfo?.entry?.title || nextInfo?.fallback || '';
  }

  function nextTaskSummary(caseItem, stats = model.caseStats(caseItem)) {
    const work = caseWorkState(caseItem, stats);
    if (work.allNotApplicable) return { entry: null, title: '所有流程均已设为不适用', label: '清单状态：', priorOpenCount: 0 };
    const info = caseNextInfo(caseItem);
    let title = nextTaskTitle(info) || '无待办或待复核事项';
    let label = work.complete ? '全案清单已处理：' : ({ later: '后续下一项：', prior: '前序待补：', workflow: '下一项：' }[info.fallback] || (info.entry ? '本阶段下一项：' : '下一项：'));
    if (!work.complete && work.currentCleared) {
      label = work.hasFutureWork ? '当前阶段已处理：' : '当前清单已处理：';
      if (!info.entry && work.hasFutureWork) title = '推进案件阶段后，再确认后续分支';
    }
    return { ...info, title, label };
  }

  function reminderLabel(due) {
    if (!due) return '';
    if (due.kind === 'overdue') return `已过计划日 ${Math.abs(due.days)} 天`;
    if (due.kind === 'today') return '今天计划办理';
    return `${due.days} 天后计划办理`;
  }

  function templateReviewDate(template) {
    return template?.lastReviewedAt || template?.sourceVersion || '';
  }

  function templateScope(template) {
    return [template?.role, template?.scope].filter(Boolean).join(' · ');
  }

  function templateMetaLine(template) {
    const parts = [];
    const reviewed = templateReviewDate(template);
    if (reviewed) parts.push(`最后核对：${formatDate(reviewed) || reviewed}`);
    if (templateScope(template)) parts.push(templateScope(template));
    if (template?.completeness === 'legacy_partial') parts.push('旧案依据不完整');
    else if (template?.completeness === 'complete') parts.push('已保留建案快照');
    return parts.join(' · ');
  }

  function workflowFocusStageIndex(caseItem) {
    const stages = caseItem?.stages || [];
    const stats = model.caseStats(caseItem);
    const focus = actualStageFor(caseItem, stats) || stats.nextPendingStage || stats.currentStage || stages.find(isStageEffective) || stages[0];
    const index = stages.findIndex((stage) => stage.id === focus?.id);
    return index >= 0 ? index : 0;
  }

  function undecidedWorkflowItems(caseItem) {
    const focusedHelper = model.focusedUnresolvedItems || model.focusedUnresolvedApplicability;
    if (typeof focusedHelper === 'function') {
      const focused = focusedHelper(caseItem);
      if (Array.isArray(focused)) return focused.map((item) => {
        const isStage = item.kind === 'stage' || item.kind === 'stage-applicability';
        return {
          ...item,
          kind: isStage ? 'stage-applicability' : 'group-applicability',
          caseItem,
          group: isStage ? null : item.group,
          title: item.title || (isStage ? item.stage?.name : item.group?.title) || '条件流程',
          detail: item.detail || (isStage ? item.stage?.conditionText : item.group?.conditionText) || '请确认该流程是否适用。'
        };
      });
    }
    const items = [];
    const stages = caseItem.stages || [];
    const focusIndex = workflowFocusStageIndex(caseItem);
    for (const [stageIndex, stage] of stages.entries()) {
      // Later conditional branches are intentionally deferred until the case
      // reaches them, so a newly-created case is not flooded with decisions.
      if (stageIndex > focusIndex) continue;
      if (stage.conditional && applicabilityOf(stage) === 'undecided') {
        items.push({ kind: 'stage-applicability', caseItem, stage, group: null, title: stage.name, detail: stage.conditionText || '请确认该阶段是否适用。' });
        continue;
      }
      if (!isStageEffective(stage)) continue;
      for (const group of stage.groups || []) {
        if (group.conditional && applicabilityOf(group) === 'undecided') {
          items.push({ kind: 'group-applicability', caseItem, stage, group, title: group.title, detail: group.conditionText || '请确认该事项组是否适用。' });
        }
      }
    }
    return items;
  }

  function collectTodoItems({ sort = true } = {}) {
    const items = [];
    for (const caseItem of state.cases.filter((item) => !item.archived)) {
      if (caseItem.importantDate && !caseItem.importantDateHandledAt) {
        items.push({
          kind: 'case-date',
          caseItem,
          title: '案件关键日期',
          due: model.dueStatus({ status: model.STATUS.PENDING || 'pending', dueDate: caseItem.importantDate }, state.settings.upcomingDays)
        });
      }
      for (const entry of effectiveTaskEntries(caseItem)) {
        const status = normalizedTaskStatus(entry.task);
        if (![model.STATUS.PENDING || 'pending', model.STATUS.REVIEW || 'review'].includes(status)) continue;
        items.push({ kind: 'task', caseItem, ...entry, status, due: model.dueStatus(entry.task, state.settings.upcomingDays) });
      }
      items.push(...undecidedWorkflowItems(caseItem));
    }
    if (!sort) return items;
    return items.sort((a, b) => {
      const isCondition = (item) => ['stage-applicability', 'group-applicability'].includes(item.kind);
      if (isCondition(a) !== isCondition(b)) return isCondition(a) ? -1 : 1;
      const aDate = a.kind === 'case-date' ? a.caseItem.importantDate : a.task?.dueDate;
      const bDate = b.kind === 'case-date' ? b.caseItem.importantDate : b.task?.dueDate;
      if (!aDate && !bDate) return String(b.caseItem.updatedAt || '').localeCompare(String(a.caseItem.updatedAt || ''));
      if (!aDate) return 1;
      if (!bDate) return -1;
      return aDate.localeCompare(bDate);
    });
  }

  function todoMatchesFilter(item, filter = todoFilter) {
    if (filter === 'workday') {
      if (item.kind === 'case-date') return Boolean(item.due && item.due.kind !== 'future');
      if (item.kind !== 'task') return false;
      if (item.status === (model.STATUS.REVIEW || 'review')) return true;
      if (item.task.dueDate) return Boolean(item.due && item.due.kind !== 'future');
      return item.stage?.id === workdayStageFor(item.caseItem)?.id;
    }
    if (filter === 'all') return true;
    if (filter === 'conditions') return ['stage-applicability', 'group-applicability'].includes(item.kind);
    if (item.kind === 'case-date') {
      if (filter === 'overdue') return item.due?.kind === 'overdue';
      if (filter === 'today') return item.due?.kind === 'today';
      if (filter === 'upcoming') return ['today', 'upcoming'].includes(item.due?.kind);
      return false;
    }
    if (item.kind !== 'task') return false;
    if (filter === 'pending') return item.status === (model.STATUS.PENDING || 'pending');
    if (filter === 'review') return item.status === (model.STATUS.REVIEW || 'review');
    if (filter === 'overdue') return item.due?.kind === 'overdue';
    if (filter === 'today') return item.due?.kind === 'today';
    if (filter === 'upcoming') return ['today', 'upcoming'].includes(item.due?.kind);
    if (filter === 'undated') return !item.task.dueDate;
    return true;
  }

  function workdayItems(items) {
    const visible = [];
    const undatedByCase = new Map();
    const hiddenByCase = new Map();
    for (const item of items) {
      if (!todoMatchesFilter(item, 'workday')) continue;
      const limited = item.kind === 'task'
        && !item.task.dueDate
        && item.status !== (model.STATUS.REVIEW || 'review')
        && item.stage?.id === workdayStageFor(item.caseItem)?.id;
      if (!limited) {
        visible.push(item);
        continue;
      }
      const caseId = item.caseItem.id;
      const count = undatedByCase.get(caseId) || 0;
      if (count < WORKDAY_UNDATED_LIMIT_PER_CASE) visible.push(item);
      else hiddenByCase.set(caseId, (hiddenByCase.get(caseId) || 0) + 1);
      undatedByCase.set(caseId, count + 1);
    }
    return { visible, hiddenByCase };
  }

  function todoCounts(items = collectTodoItems()) {
    const count = (filter) => items.filter((item) => todoMatchesFilter(item, filter)).length;
    return { workday: workdayItems(items).visible.length, all: items.length, pending: count('pending'), review: count('review'), conditions: count('conditions'), overdue: count('overdue'), today: count('today'), upcoming: count('upcoming'), undated: count('undated') };
  }

  function taskStatusOptionsHtml(selectedValue) {
    const primaryValues = new Set([
      model.STATUS.PENDING || 'pending',
      model.STATUS.DONE || 'done',
      model.STATUS.REVIEW || 'review'
    ]);
    const option = (item) => `<option value="${escapeHtml(item.value)}" ${item.value === selectedValue ? 'selected' : ''}>${escapeHtml(item.label)}</option>`;
    const primary = taskStatusOptions.filter((item) => primaryValues.has(item.value));
    const secondary = taskStatusOptions.filter((item) => !primaryValues.has(item.value));
    return `${primary.map(option).join('')}<optgroup label="更多状态">${secondary.map(option).join('')}</optgroup>`;
  }

  function selectedCase() {
    return state.cases.find((item) => item.id === selectedCaseId) || null;
  }

  function allTemplates() {
    return [...builtInTemplates, ...(state.customTemplates || [])];
  }

  function categoryName(categoryId) {
    return templateCategories.find((item) => item.id === categoryId)?.name || '其他 / 自定义';
  }

  function activeWorkflowOwner() {
    return currentView === 'template-editor' ? templateDraft : selectedCase();
  }

  function getStage(caseItem, stageId) {
    return (caseItem.stages || []).find((stage) => stage.id === stageId) || null;
  }

  function touchState() {
    state.updatedAt = new Date().toISOString();
  }

  function queueStateSave(snapshot, revision) {
    const request = saveInFlight.catch(() => undefined).then(async () => {
      const result = await api.saveState(snapshot);
      persistedRevision = Math.max(persistedRevision, revision);
      return result;
    });
    saveInFlight = request;
    return request;
  }

  async function flushPendingSave() {
    window.clearTimeout(saveTimer);
    saveTimer = null;
    while (persistedRevision < changeRevision) {
      const revision = changeRevision;
      const snapshot = model.clone(state);
      await queueStateSave(snapshot, revision);
    }
    await saveInFlight;
    saveMessage = `已自动保存 · ${formatClock()}`;
    updateSaveLabel();
  }

  function scheduleSave({ immediate = false } = {}) {
    if (recoveryInProgress) {
      showToast('正在恢复台账，暂时不能修改内容', 'error');
      return;
    }
    touchState();
    changeRevision += 1;
    saveMessage = '正在自动保存…';
    updateSaveLabel();
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(async () => {
      try {
        const revision = changeRevision;
        await queueStateSave(model.clone(state), revision);
        saveMessage = `已自动保存 · ${formatClock()}`;
        updateSaveLabel();
      } catch (error) {
        saveMessage = '保存失败，请先导出备份';
        updateSaveLabel();
        showToast(`保存失败：${error.message}`, 'error');
        void refreshStorageHealth();
      }
    }, immediate ? 0 : 280);
  }

  async function settleSavesBeforeRecovery() {
    recoveryInProgress = true;
    await flushPendingSave();
  }

  function updateSaveLabel() {
    const label = document.querySelector('[data-save-state]');
    if (label) label.textContent = saveMessage;
  }

  function storageWarningMessages() {
    const messages = (storageHealthCache?.warnings || []).map((item) => String(item?.message || item || '').trim()).filter(Boolean);
    if (storageHealthCache?.automaticBackup?.status === 'failed') {
      messages.unshift(storageHealthCache.automaticBackup.error || '自动恢复点暂时未能更新');
    }
    return [...new Set(messages)];
  }

  function storageWarningBannerHtml() {
    if (!storageWarningMessages().length) return '';
    return `<aside class="storage-warning-banner" role="status"><span class="storage-warning-symbol">!</span><div><strong>自动恢复点需要留意</strong><p>案件记录仍可继续使用。建议现在导出一份完整备份，避免电脑故障时缺少最新恢复点。</p></div><button class="btn btn-small" data-action="data-center">查看备份</button></aside>`;
  }

  function storageHealthPanelHtml() {
    const warnings = storageWarningMessages();
    if (!warnings.length) return '<div class="storage-health-card healthy"><span>✓</span><div><strong>本机保存与自动恢复点状态正常</strong><p>程序会继续自动保存，仍建议定期导出完整备份。</p></div></div>';
    return `<div class="storage-health-card warning"><span>!</span><div><strong>自动恢复点需要留意</strong><p>台账仍可使用；请先导出完整备份。${warnings[0] ? ` 详情：${escapeHtml(warnings[0])}` : ''}</p></div></div>`;
  }

  async function refreshStorageHealth() {
    if (typeof api.getStorageHealth !== 'function') return null;
    storageHealthCache = await api.getStorageHealth().catch(() => storageHealthCache);
    const banner = document.getElementById('storage-health-banner-host');
    if (banner) banner.innerHTML = storageWarningBannerHtml();
    const panel = document.getElementById('storage-health-panel');
    if (panel) panel.innerHTML = storageHealthPanelHtml();
    return storageHealthCache;
  }

  function showToast(message, type = '', action = null) {
    toastRoot.replaceChildren();
    const toast = document.createElement('div');
    toast.className = `toast ${type} ${action ? 'has-action' : ''}`.trim();
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    const text = document.createElement('span');
    text.textContent = message;
    toast.appendChild(text);
    if (action) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'toast-action';
      button.dataset.action = action.name;
      for (const [key, value] of Object.entries(action.data || {})) button.dataset[key] = value;
      button.textContent = action.label || '撤销';
      toast.appendChild(button);
    }
    toastRoot.appendChild(toast);
    window.setTimeout(() => toast.remove(), action ? 9000 : 3200);
  }

  function showUndoToast(message, result) {
    if (!result?.ok || !result.event?.id) return;
    showToast(message, '', { name: 'undo-activity', label: '撤销', data: { activityId: result.event.id } });
  }

  function showLocalUndoToast(message, restore) {
    if (typeof restore !== 'function') return;
    const undoId = model.createId('local-undo');
    localUndoActions.set(undoId, restore);
    while (localUndoActions.size > 10) localUndoActions.delete(localUndoActions.keys().next().value);
    showToast(message, '', { name: 'undo-local-delete', label: '撤销', data: { undoId } });
  }

  function formatActivityTime(value) {
    if (!value || !Number.isFinite(Date.parse(value))) return '时间未记录';
    return new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function recentActivityHtml() {
    const items = (state.recentActivity || []).slice(0, 20);
    if (!items.length) return '<div class="recovery-empty">还没有可显示的操作记录。</div>';
    return `<div class="activity-list">${items.map((item) => {
      const undoable = typeof model.canUndoActivity === 'function' && model.canUndoActivity(state, item);
      return `<div class="activity-row"><div><strong>${escapeHtml(item.label || '案件流程已更新')}</strong><span>${escapeHtml(item.caseName || (item.type === model.ACTIVITY_TYPE?.CUSTOM_TEMPLATE_DELETE ? '流程模板' : '未命名案件'))} · ${escapeHtml(formatActivityTime(item.at))}${item.undoneAt ? ' · 已撤销' : ''}</span></div>${undoable ? `<button class="btn btn-small btn-ghost" data-action="undo-activity" data-activity-id="${escapeHtml(item.id)}">撤销</button>` : '<small>仅供查看</small>'}</div>`;
    }).join('')}</div>`;
  }

  function recycledCasesHtml() {
    const items = state.recycleBin?.cases || [];
    if (!items.length) return '<div class="recovery-empty">最近删除中没有案件。</div>';
    return `<div class="recycle-list">${items.slice(0, 20).map((item) => {
      const caseItem = item.caseSnapshot || {};
      const detail = [caseItem.caseNumber, caseItem.caseTypeLabel, formatActivityTime(item.deletedAt)].filter(Boolean).join(' · ');
      return `<div class="recycle-row"><div><strong>${escapeHtml(caseItem.name || '未命名案件')}</strong><span>${escapeHtml(detail || '删除时间未记录')}</span></div><div><button class="btn btn-small" data-action="restore-recycled-case" data-trash-id="${escapeHtml(item.id)}">恢复</button><button class="btn btn-small btn-ghost danger-text" data-action="purge-recycled-case" data-trash-id="${escapeHtml(item.id)}">永久删除</button></div></div>`;
    }).join('')}</div>${items.length > 20 ? `<p class="recovery-more">另有 ${items.length - 20} 个较早删除的案件未显示。</p>` : ''}`;
  }

  function sidebarHtml(todoItems) {
    const counts = todoCounts(todoItems || collectTodoItems({ sort: false }));
    return `
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-mark">案</div>
          <div><div class="brand-title">法律案件工作台</div><div class="brand-subtitle">多类型流程与待办管理</div></div>
        </div>
        <nav class="side-nav" aria-label="主导航">
          <button class="nav-button ${currentView === 'dashboard' ? 'active' : ''}" data-action="nav" data-view="dashboard">${icon('dashboard', 'nav-icon')}<span>案件总览</span></button>
          <button class="nav-button ${currentView === 'todos' ? 'active' : ''}" data-action="nav" data-view="todos">${icon('todo', 'nav-icon')}<span>我的待办</span>${counts.overdue ? `<em class="nav-count">${counts.overdue}</em>` : ''}</button>
          <button class="nav-button ${currentView === 'cases' ? 'active' : ''}" data-action="nav" data-view="cases">${icon('cases', 'nav-icon')}<span>所有案件</span></button>
          <button class="nav-button ${['templates', 'template-editor'].includes(currentView) ? 'active' : ''}" data-action="nav" data-view="templates">${icon('templates', 'nav-icon')}<span>流程模板</span></button>
        </nav>
        <div class="sidebar-bottom">
          <button class="nav-button" data-action="data-center">${icon('info', 'nav-icon')}<span>数据与备份</span></button>
          <div class="save-state" data-save-state>${escapeHtml(saveMessage)}</div>
        </div>
      </aside>`;
  }

  function topbarHtml(title, kicker, options = {}) {
    const showSearch = options.search !== false;
    return `
      <header class="topbar">
        <div class="topbar-left">
          <div class="topbar-kicker">${escapeHtml(kicker)}</div>
          <h1 class="topbar-title">${escapeHtml(title)}</h1>
        </div>
        <div class="topbar-actions">
          ${showSearch ? `<label class="search-box"><span class="search-symbol">${icon('search', 'btn-icon')}</span><input id="global-search" type="search" value="${escapeHtml(searchQuery)}" placeholder="搜索案件、客户、案号或承办人" aria-label="搜索案件" /></label>` : ''}
          ${options.extra || ''}
          <button class="btn btn-primary" data-action="new-case">${icon('plus')}新建案件</button>
        </div>
      </header>`;
  }

  function renderApp() {
    if (currentView === 'detail' && !selectedCase()) {
      currentView = 'dashboard';
      selectedCaseId = null;
    }
    if (currentView === 'template-editor' && !templateDraft) currentView = 'templates';

    const todoItems = collectTodoItems({ sort: currentView === 'todos' });
    let topbar;
    let body;
    if (currentView === 'dashboard') {
      topbar = topbarHtml('案件总览', new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date()));
      body = renderDashboard();
    } else if (currentView === 'todos') {
      const counts = todoCounts(todoItems);
      topbar = topbarHtml('我的待办', `今日工作 ${counts.workday} 项 · 全部清单 ${counts.all} 项`, { search: false });
      body = renderTodosPage(todoItems);
    } else if (currentView === 'cases') {
      topbar = topbarHtml('所有案件', `共 ${state.cases.length} 个案件`);
      body = renderCasesPage();
    } else if (currentView === 'templates') {
      topbar = topbarHtml('流程模板', `内置 ${builtInTemplates.length} 个 · 自定义 ${(state.customTemplates || []).length} 个`, { search: false, extra: '<button class="btn" data-action="create-template">＋ 新建空白模板</button>' });
      body = renderTemplatesPage();
    } else if (currentView === 'template-editor') {
      topbar = topbarHtml(templateDraft.name, '自定义模板编辑器', { search: false, extra: '<button class="btn" data-action="cancel-template-edit">返回模板库</button><button class="btn btn-primary" data-action="save-template">保存模板</button>' });
      body = renderTemplateEditor();
    } else {
      const caseItem = selectedCase();
      topbar = topbarHtml(caseItem.name, '案件流程详情', { search: false });
      body = renderCaseDetail(caseItem);
    }

    const scroll = document.querySelector('.main-scroll');
    const shouldRestoreScroll = renderedView === currentView;
    const scrollTop = shouldRestoreScroll ? (scroll?.scrollTop || 0) : 0;
    appRoot.innerHTML = `<div class="app-shell">${sidebarHtml(todoItems)}<section class="workspace">${topbar}<div id="storage-health-banner-host">${storageWarningBannerHtml()}</div><main class="main-scroll"><div class="content-wrap">${body}</div></main></section></div>`;
    if (shouldRestoreScroll) document.querySelector('.main-scroll')?.scrollTo({ top: scrollTop });
    renderedView = currentView;
  }

  function templateCounts(template) {
    const stages = template.stages || [];
    const groups = stages.flatMap((stage) => stage.groups || []);
    const tasks = groups.flatMap((group) => group.tasks || []);
    return { stages: stages.length, groups: groups.length, tasks: tasks.length };
  }

  function renderTemplatesPage() {
    const templates = allTemplates();
    const categorySections = templateCategories.map((category) => ({
      ...category,
      templates: templates.filter((template) => template.category === category.id)
    })).filter((category) => category.templates.length);
    const taskTotal = templates.reduce((total, item) => total + templateCounts(item).tasks, 0);
    return `
      <section class="template-intro">
        <div>
          <div class="template-eyebrow">流程模板库</div>
          <h2>一套工作台，管理不同类型的法律事务</h2>
          <p>新建案件时选择基础模板；实际办理中仍可随时增加阶段、事项组和步骤。复制系统模板后，还可以沉淀成自己的办案标准。</p>
        </div>
        <div class="template-intro-stats"><strong>${templates.length}</strong><span>套流程模板</span><strong>${taskTotal}</strong><span>项基础步骤</span></div>
      </section>
      <div class="template-tip"><span>i</span><div><strong>模板与案件相互独立</strong><p>修改模板只影响以后用它新建的案件，不会改动已经在办的案件；每个案件也可以继续单独增删流程。</p></div></div>
      <div class="template-library">
        ${categorySections.map((section) => `
          <section class="template-category-section">
            <div class="template-category-head"><div><span class="category-dot category-${escapeHtml(section.id)}"></span><h3>${escapeHtml(section.name)}</h3><span>${section.templates.length} 个模板</span></div></div>
            <div class="template-grid">${section.templates.map(renderTemplateCard).join('')}</div>
          </section>`).join('')}
      </div>`;
  }

  function renderTemplateCard(template) {
    const counts = templateCounts(template);
    const initial = String(template.categoryLabel || categoryName(template.category)).slice(0, 1);
    const meta = templateMetaLine(template);
    return `<article class="template-card">
      <div class="template-card-top">
        <div class="template-symbol category-${escapeHtml(template.category)}">${escapeHtml(initial)}</div>
        <div class="template-card-badges"><span class="badge ${template.builtIn ? 'badge-blue' : 'badge-violet'}">${template.builtIn ? '系统基础模板' : '我的模板'}</span></div>
      </div>
      <h4>${escapeHtml(template.name)}</h4>
      <p>${escapeHtml(template.description || '可复制、编辑并用于新建案件。')}</p>
      ${meta ? `<div class="template-meta-line">${escapeHtml(meta)}</div>` : '<div class="template-meta-line warning">未标注核对日期与适用范围</div>'}
      <div class="template-counts"><span><strong>${counts.stages}</strong> 个阶段</span><span><strong>${counts.groups}</strong> 个事项组</span><span><strong>${counts.tasks}</strong> 个步骤</span></div>
      <div class="template-card-actions">
        <button class="btn btn-small btn-primary-soft" data-action="new-case-with-template" data-template-id="${escapeHtml(template.id)}">用此模板建案</button>
        <button class="btn btn-small btn-ghost" data-action="preview-template" data-template-id="${escapeHtml(template.id)}">查看流程</button>
        <button class="btn btn-small btn-ghost" data-action="${template.builtIn ? 'customize-template' : 'edit-template'}" data-template-id="${escapeHtml(template.id)}">${template.builtIn ? '复制并编辑' : '编辑'}</button>
        ${template.builtIn ? '' : `<button class="btn btn-small btn-ghost danger-text" data-action="delete-template" data-template-id="${escapeHtml(template.id)}">删除</button>`}
      </div>
    </article>`;
  }

  function editableCopyOfTemplate(template, preserveId = false) {
    const now = new Date().toISOString();
    return {
      ...model.clone(template),
      id: preserveId ? template.id : model.createId('template'),
      name: preserveId ? template.name : `${template.name}（自定义）`,
      description: preserveId ? template.description : `基于“${template.name}”复制，可按本所习惯调整。`,
      builtIn: false,
      sourceTemplateId: template.sourceTemplateId || template.id,
      createdAt: preserveId ? (template.createdAt || now) : now,
      updatedAt: now,
      stages: model.stagesForTemplate(template.stages)
    };
  }

  function templateDraftSignature(value = templateDraft) {
    if (!value) return '';
    const clean = model.clone(value);
    delete clean.updatedAt;
    return JSON.stringify(clean);
  }

  function templateDraftIsDirty() {
    return Boolean(templateDraft && templateDraftSignature() !== templateDraftBaseline);
  }

  function confirmLeaveTemplateEditor() {
    return !templateDraftIsDirty() || window.confirm('流程模板还有未保存的修改。离开后这些修改会丢失，是否仍然离开？');
  }

  function leaveTemplateEditor(destination = 'templates') {
    if (!confirmLeaveTemplateEditor()) return false;
    templateDraft = null;
    templateDraftBaseline = '';
    selectedTemplateId = null;
    activeStageId = null;
    currentView = destination;
    return true;
  }

  function openTemplateEditor(template, preserveId = false) {
    if (!template) return;
    templateDraft = editableCopyOfTemplate(template, preserveId);
    templateDraftBaseline = templateDraftSignature(templateDraft);
    selectedTemplateId = preserveId ? template.id : null;
    activeStageId = templateDraft.stages?.[0]?.id || null;
    currentView = 'template-editor';
    renderApp();
  }

  function renderTemplateEditor() {
    if (!templateDraft) return '';
    if (!activeStageId || !getStage(templateDraft, activeStageId)) activeStageId = templateDraft.stages?.[0]?.id || null;
    const stage = getStage(templateDraft, activeStageId);
    const counts = templateCounts(templateDraft);
    return `
      <div class="breadcrumb"><button data-action="cancel-template-edit">流程模板</button><span>›</span><span>${escapeHtml(templateDraft.name)}</span></div>
      <section class="template-editor-hero">
        <div><span class="badge badge-violet">${escapeHtml(categoryName(templateDraft.category))}</span><h2>${escapeHtml(templateDraft.name)}</h2><p>${escapeHtml(templateDraft.description || '自定义流程模板')}</p></div>
        <div class="template-editor-summary"><span><strong>${counts.stages}</strong>阶段</span><span><strong>${counts.groups}</strong>事项组</span><span><strong>${counts.tasks}</strong>步骤</span><button class="btn btn-small" data-action="edit-template-info">模板设置</button></div>
      </section>
      <div class="editor-notice"><span>编辑模式</span> 在这里增删或改写流程。保存后，它会出现在“我的模板”中。</div>
      <section class="case-detail-grid template-editor-grid">
        <nav class="stage-nav" aria-label="模板阶段"><div class="stage-nav-title">模板阶段</div>${templateDraft.stages.map(renderTemplateStageButton).join('')}<button class="stage-add-button" data-action="add-stage"><span>＋</span> 新增阶段</button></nav>
        <div class="stage-content">${renderTemplateStageContent(stage)}</div>
      </section>`;
  }

  function renderTemplateStageButton(stage, index) {
    const tasks = (stage.groups || []).flatMap((group) => group.tasks || []).length;
    return `<button class="stage-button ${stage.id === activeStageId ? 'active' : ''}" data-action="select-stage" data-stage-id="${escapeHtml(stage.id)}"><span class="stage-number">${index + 1}</span><span class="stage-name">${escapeHtml(stage.name)}${stage.conditional ? '<small>条件阶段</small>' : ''}</span><span class="stage-count">${tasks}</span></button>`;
  }

  function renderTemplateStageContent(stage) {
    if (!stage) return '<div class="empty-state"><h3>模板里还没有阶段</h3><p>点击左侧“新增阶段”建立第一段流程。</p></div>';
    const taskCount = (stage.groups || []).flatMap((group) => group.tasks || []).length;
    return `<div class="stage-content-head"><div><div class="stage-title-line"><h3>${escapeHtml(stage.name)}</h3><span class="badge badge-violet">模板阶段</span>${stage.conditional ? '<span class="badge badge-amber">条件阶段</span>' : ''}</div>${stage.conditionText ? `<p class="stage-condition">适用条件：${escapeHtml(stage.conditionText)}</p>` : ''}<p>${stage.groups.length} 个事项组，共 ${taskCount} 个步骤</p></div><div class="stage-head-actions"><button class="btn btn-small btn-ghost" data-action="edit-stage" data-stage-id="${escapeHtml(stage.id)}">编辑阶段</button><button class="btn btn-small btn-ghost danger-text" data-action="delete-stage" data-stage-id="${escapeHtml(stage.id)}">删除</button><button class="btn btn-small btn-primary-soft" data-action="add-group" data-stage-id="${escapeHtml(stage.id)}">＋ 新增事项组</button></div></div>${stage.groups.length ? stage.groups.map(renderTemplateGroup).join('') : '<div class="empty-state"><h3>这个阶段还没有事项</h3><p>点击“新增事项组”添加第一项工作。</p></div>'}`;
  }

  function renderTemplateGroup(group) {
    return `<article class="task-group template-task-group">
      <header class="group-head"><div><div class="group-title-row"><h4 class="group-title">${escapeHtml(group.title)}</h4>${group.conditional ? '<span class="badge badge-amber">视情况办理</span>' : ''}<span class="badge badge-outline">${group.tasks.length} 个步骤</span></div>${group.conditionText ? `<p class="group-condition">${escapeHtml(group.conditionText)}</p>` : ''}</div><div class="group-actions"><button class="btn btn-small btn-primary-soft" data-action="add-task" data-group-id="${escapeHtml(group.id)}">＋ 添加步骤</button><button class="btn btn-small btn-ghost" data-action="edit-group" data-group-id="${escapeHtml(group.id)}">编辑</button><button class="btn btn-small btn-ghost danger-text" data-action="delete-group" data-group-id="${escapeHtml(group.id)}">删除</button></div></header>
      <div class="template-task-list">${group.tasks.map(renderTemplateTask).join('')}</div>
    </article>`;
  }

  function renderTemplateTask(task, index) {
    return `<div class="template-task-row"><span class="template-task-index">${index + 1}</span><div><div class="task-title-row"><span class="task-title">${escapeHtml(task.title)}</span>${task.optional ? '<span class="badge">可选</span>' : ''}${task.needsReview ? '<span class="badge badge-red">待补充确认</span>' : ''}</div>${task.detail ? `<div class="task-detail">${escapeHtml(task.detail)}</div>` : ''}</div><div class="task-row-actions"><button class="task-action" data-action="edit-task" data-task-id="${escapeHtml(task.id)}">编辑</button><button class="task-action danger-text" data-action="delete-task" data-task-id="${escapeHtml(task.id)}">删除</button></div></div>`;
  }

  function filteredCases(includeArchived = true) {
    const query = searchQuery.trim().toLocaleLowerCase('zh-CN');
    return state.cases
      .filter((caseItem) => includeArchived || !caseItem.archived)
      .filter((caseItem) => {
        if (!query) return true;
        return [caseItem.name, caseItem.companyName, caseItem.caseNumber, caseItem.court, caseItem.manager, caseItem.caseTypeLabel, caseItem.templateName]
          .some((value) => String(value || '').toLocaleLowerCase('zh-CN').includes(query));
      })
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  }

  function renderTodoFilter(label, value, count) {
    return `<button class="todo-filter ${todoFilter === value ? 'active' : ''}" data-action="todo-filter" data-filter="${value}"><span>${escapeHtml(label)}</span><strong>${count}</strong></button>`;
  }

  function renderTodoItem(item) {
    if (item.kind === 'workday-more') {
      return `<article class="todo-more-row"><button data-action="open-todo" data-case-id="${escapeHtml(item.caseItem.id)}" data-stage-id="${escapeHtml(item.stage.id)}"><strong>${escapeHtml(item.caseItem.name)}</strong><span>本阶段另有 ${item.hiddenCount} 项未排期事项，进入案件查看全部 →</span></button></article>`;
    }
    if (item.kind === 'case-date') {
      const reminder = item.due ? reminderLabel(item.due) : `计划 ${formatDate(item.caseItem.importantDate)}`;
      return `<article class="todo-item case-date-todo ${item.due?.kind === 'overdue' ? 'overdue' : ''}">
        <button class="todo-open" data-action="open-todo" data-case-id="${escapeHtml(item.caseItem.id)}"><span class="todo-kind case-date">关键日期</span><strong>${escapeHtml(item.caseItem.name)}</strong><small>${escapeHtml(reminder)} · ${formatDate(item.caseItem.importantDate)}</small><p>这是案件资料中的关键日期，不是流程步骤的计划办理日。</p></button>
        <button class="btn btn-small btn-primary-soft" data-action="set-case-date-status" data-case-id="${escapeHtml(item.caseItem.id)}" data-handled="true">标记已处理</button>
      </article>`;
    }
    const caseMeta = `${item.caseItem.name} · ${item.stage?.name || '未分阶段'}`;
    if (item.kind !== 'task') {
      const isStage = item.kind === 'stage-applicability';
      return `<article class="todo-item condition-todo">
        <button class="todo-open" data-action="open-todo" data-case-id="${escapeHtml(item.caseItem.id)}" data-stage-id="${escapeHtml(item.stage.id)}"><span class="todo-kind condition">条件待确认</span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(caseMeta)}</small><p>${escapeHtml(item.detail)}</p></button>
        <label class="todo-applicability"><span>是否适用</span><select class="${isStage ? 'stage-applicability' : 'group-applicability'}" ${isStage ? `data-stage-id="${escapeHtml(item.stage.id)}"` : `data-group-id="${escapeHtml(item.group.id)}"`} data-case-id="${escapeHtml(item.caseItem.id)}"><option value="undecided" selected>待确认</option><option value="included">适用</option><option value="excluded">不适用</option></select></label>
      </article>`;
    }
    const status = taskStatusMeta(item.task);
    const reminder = item.task.dueDate ? (item.due ? reminderLabel(item.due) : `计划 ${formatDate(item.task.dueDate)}`) : '未设计划办理日';
    return `<article class="todo-item task-todo ${item.due?.kind === 'overdue' ? 'overdue' : ''}">
      <label class="task-check todo-check" title="快速标记已完成"><input class="task-checkbox" type="checkbox" data-case-id="${escapeHtml(item.caseItem.id)}" data-task-id="${escapeHtml(item.task.id)}"/><span class="check-visual"></span></label>
      <button class="todo-open" data-action="open-todo" data-case-id="${escapeHtml(item.caseItem.id)}" data-stage-id="${escapeHtml(item.stage.id)}" data-task-id="${escapeHtml(item.task.id)}"><span class="todo-kind status-${status.tone}">${escapeHtml(status.label)}</span><strong>${escapeHtml(item.task.title)}</strong><small>${escapeHtml(caseMeta)} · ${escapeHtml(reminder)}</small>${item.task.note ? `<p>${escapeHtml(item.task.note)}</p>` : ''}</button>
      <select class="task-status-select todo-status" data-case-id="${escapeHtml(item.caseItem.id)}" data-task-id="${escapeHtml(item.task.id)}" aria-label="任务状态">${taskStatusOptionsHtml(status.value)}</select>
      <details class="todo-quick-record"><summary>计划与备注${item.task.dueDate || item.task.note ? '<span>已记录</span>' : ''}</summary><div class="todo-quick-record-fields"><label><span>计划办理日</span><input class="task-date" type="date" data-case-id="${escapeHtml(item.caseItem.id)}" data-task-id="${escapeHtml(item.task.id)}" value="${escapeHtml(item.task.dueDate || '')}" /></label><label class="todo-note-field"><span>办理备注</span><input class="task-note" type="text" maxlength="300" data-case-id="${escapeHtml(item.caseItem.id)}" data-task-id="${escapeHtml(item.task.id)}" value="${escapeHtml(item.task.note || '')}" placeholder="补充办理情况或材料位置" /></label></div></details>
    </article>`;
  }

  function renderTodosPage(items = collectTodoItems()) {
    const scopedItems = items.filter((item) => {
      if (todoCaseFilter !== 'all' && item.caseItem.id !== todoCaseFilter) return false;
      if (todoTypeFilter !== 'all' && item.caseItem.caseType !== todoTypeFilter) return false;
      if (todoOwnerFilter !== 'all' && String(item.caseItem.manager || '').trim() !== todoOwnerFilter) return false;
      return true;
    });
    const counts = todoCounts(scopedItems);
    const workday = workdayItems(scopedItems);
    const focusedConditions = scopedItems.filter((item) => todoMatchesFilter(item, 'conditions'));
    const visible = todoFilter === 'workday' ? workday.visible : scopedItems.filter((item) => todoMatchesFilter(item));
    const pageCount = Math.max(1, Math.ceil(visible.length / TODO_PAGE_SIZE));
    todoPage = Math.min(Math.max(1, todoPage), pageCount);
    const pageStart = (todoPage - 1) * TODO_PAGE_SIZE;
    let pageItems = visible.slice(pageStart, pageStart + TODO_PAGE_SIZE);
    const overflowItems = [];
    if (todoFilter === 'workday' && todoPage === pageCount && workday.hiddenByCase.size) {
      overflowItems.push(...[...workday.hiddenByCase.entries()].map(([caseId, hiddenCount]) => {
        const caseItem = state.cases.find((item) => item.id === caseId);
        return { kind: 'workday-more', caseItem, stage: workdayStageFor(caseItem), hiddenCount };
      }).filter((item) => item.caseItem && item.stage));
    }
    const availableCases = state.cases.filter((item) => !item.archived).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN'));
    const availableTypes = [...new Set(availableCases.map((item) => item.caseType).filter(Boolean))];
    const availableOwners = [...new Set(availableCases.map((item) => String(item.manager || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    const conditionPrompt = todoFilter === 'workday' && focusedConditions.length
      ? `<section class="workday-conditions"><div class="workday-conditions-head"><div><span>先确认流程</span><strong>${focusedConditions.length} 个当前阶段及以前的条件待确认</strong><p>这些确认不会计入右侧“今日工作”数量；确认适用后，相关步骤才会进入清单。</p></div>${focusedConditions.length > 3 ? `<button class="btn btn-small" data-action="todo-filter" data-filter="conditions">查看全部 ${focusedConditions.length} 项</button>` : ''}</div><div class="workday-condition-list">${focusedConditions.slice(0, 3).map(renderTodoItem).join('')}</div></section>`
      : '';
    return `<section class="todo-hero"><div><h2>今天先处理什么</h2><p>集中显示已过计划日、今天、七日内和待复核工作；条件流程在下方单独提醒，不混入今日任务数量。</p></div><div class="todo-hero-count"><strong>${counts.workday}</strong><span>项今日工作</span>${counts.overdue ? `<em>${counts.overdue} 项已过计划日</em>` : '<em>无已过计划日事项</em>'}</div></section>
      ${availableCases.length > 1 || availableTypes.length > 1 || availableOwners.length > 1 ? `<div class="todo-scope-filters">${availableCases.length > 1 ? `<label><span>案件</span><select id="todo-case-filter"><option value="all">全部案件</option>${availableCases.map((item) => `<option value="${escapeHtml(item.id)}" ${todoCaseFilter === item.id ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select></label>` : ''}${availableTypes.length > 1 ? `<label><span>业务类型</span><select id="todo-type-filter"><option value="all">全部类型</option>${availableTypes.map((value) => `<option value="${escapeHtml(value)}" ${todoTypeFilter === value ? 'selected' : ''}>${escapeHtml(categoryName(value))}</option>`).join('')}</select></label>` : ''}${availableOwners.length > 1 ? `<label><span>承办人</span><select id="todo-owner-filter"><option value="all">全部承办人</option>${availableOwners.map((value) => `<option value="${escapeHtml(value)}" ${todoOwnerFilter === value ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('')}</select></label>` : ''}</div>` : ''}
      ${conditionPrompt}
      <nav class="todo-filters" aria-label="待办筛选">${renderTodoFilter('今日工作', 'workday', counts.workday)}${renderTodoFilter('已过计划日', 'overdue', counts.overdue)}${renderTodoFilter('今天', 'today', counts.today)}${renderTodoFilter('7日内（含今天）', 'upcoming', counts.upcoming)}${renderTodoFilter('待复核', 'review', counts.review)}${renderTodoFilter('条件待确认', 'conditions', counts.conditions)}${renderTodoFilter('未设计划日', 'undated', counts.undated)}${renderTodoFilter('全部清单', 'all', counts.all)}</nav>
      <section class="todo-panel"><div class="todo-panel-head"><div><h3>${escapeHtml(({ workday: '今日工作', all: '全部开放清单', pending: '待办理事项', review: '待复核事项', conditions: '当前阶段及以前待确认流程', overdue: '已过计划办理日', today: '今天计划办理', upcoming: '七日内计划办理（含今天）', undated: '未设计划办理日' })[todoFilter] || '今日工作')}</h3><p>显示 ${visible.length} 项${pageCount > 1 ? ` · 第 ${todoPage}/${pageCount} 页` : ''}${todoFilter === 'workday' && workday.hiddenByCase.size ? ` · 另有 ${[...workday.hiddenByCase.values()].reduce((sum, value) => sum + value, 0)} 项收起` : ''}</p></div></div>${visible.length ? `<div class="todo-list">${pageItems.map(renderTodoItem).join('')}</div>${overflowItems.length ? `<div class="todo-overflow-list">${overflowItems.map(renderTodoItem).join('')}</div>` : ''}${pageCount > 1 ? `<nav class="todo-pagination" aria-label="待办分页"><button class="btn btn-small" data-action="todo-page" data-page="${todoPage - 1}" ${todoPage <= 1 ? 'disabled' : ''}>上一页</button><span>第 ${todoPage} 页，共 ${pageCount} 页</span><button class="btn btn-small" data-action="todo-page" data-page="${todoPage + 1}" ${todoPage >= pageCount ? 'disabled' : ''}>下一页</button></nav>` : ''}` : `<div class="empty-state todo-empty"><div class="empty-mark">✓</div><h3>${todoFilter === 'workday' ? '今天没有需要集中处理的事项' : '该分类暂无事项'}</h3><p>${todoFilter === 'workday' && focusedConditions.length ? '今日任务已经处理完；上方还有条件流程需要确认。' : (items.length ? '可切换筛选查看全部清单，或进入案件为下一项工作设置计划办理日。' : '所有有效流程中当前都没有待办、待复核或待确认事项。')}</p></div>`}</section>`;
  }

  function dashboardMetrics() {
    const visible = state.cases.filter((item) => !item.archived);
    let inProgress = 0;
    let complete = 0;
    for (const caseItem of visible) {
      const stats = model.caseStats(caseItem);
      if (caseWorkState(caseItem, stats).complete) complete += 1;
      else inProgress += 1;
    }
    const todo = todoCounts(collectTodoItems({ sort: false }));
    return { inProgress, complete, overdue: todo.overdue, upcoming: todo.upcoming };
  }

  function getReminders(limit = 8) {
    const reminders = [];
    for (const caseItem of state.cases.filter((item) => !item.archived)) {
      if (caseItem.importantDate && !caseItem.importantDateHandledAt) {
        const due = model.dueStatus({ status: model.STATUS.PENDING || 'pending', dueDate: caseItem.importantDate }, state.settings.upcomingDays);
        if (due && due.kind !== 'future') reminders.push({ kind: 'case-date', caseItem, due });
      }
      for (const entry of effectiveTaskEntries(caseItem)) {
        const due = model.dueStatus(entry.task, state.settings.upcomingDays);
        if (!due || due.kind === 'future') continue;
        reminders.push({ kind: 'task', caseItem, ...entry, due });
      }
    }
    return reminders.sort((a, b) => {
      const aDate = a.kind === 'case-date' ? a.caseItem.importantDate : a.task.dueDate;
      const bDate = b.kind === 'case-date' ? b.caseItem.importantDate : b.task.dueDate;
      return String(aDate || '').localeCompare(String(bDate || ''));
    }).slice(0, limit);
  }

  function renderDashboard() {
    const metrics = dashboardMetrics();
    const cases = filteredCases(false).slice(0, 6);
    const reminders = getReminders();
    return `
      <section class="stats-grid" aria-label="案件统计">
        ${statCard('stat-blue', '进行中案件', metrics.inProgress, '尚有待办或待复核事项')}
        ${statCard('stat-green', '清单已处理案件', metrics.complete, '含无适用清单的案件')}
        ${statCard('stat-red', '已过计划日', metrics.overdue, '请优先查看')}
        ${statCard('stat-amber', '七日内计划', metrics.upcoming, '包含今天')}
      </section>
      <section class="dashboard-grid">
        <div class="panel">
          <div class="panel-header">
            <div><h2 class="panel-title">最近案件</h2><div class="panel-subtitle">按最近更新时间排列</div></div>
            ${state.cases.length ? '<button class="btn btn-small" data-action="nav" data-view="cases">查看全部</button>' : ''}
          </div>
          ${cases.length ? `<div class="case-list">${cases.map(renderCaseCard).join('')}</div>` : renderEmptyState('还没有案件', '新建第一个案件后，程序会自动生成完整的阶段流程和可勾选任务。')}
        </div>
        <div class="panel reminders-panel">
          <div class="panel-header"><div><h2 class="panel-title">近期计划</h2><div class="panel-subtitle">已过计划办理日与七日内工作</div></div></div>
          ${reminders.length ? `<div class="reminder-list">${reminders.map(renderReminder).join('')}</div>` : '<div class="empty-state" style="padding:34px 18px"><div class="empty-mark" style="width:48px;height:48px;font-size:21px">✓</div><h3>暂无近期计划</h3><p>给任务设置计划办理日后，会在这里集中显示。</p></div>'}
        </div>
      </section>`;
  }

  function statCard(className, label, value, note) {
    const filter = className === 'stat-red' ? 'overdue' : (className === 'stat-amber' ? 'upcoming' : '');
    const content = `<div class="stat-label">${escapeHtml(label)}</div><div class="stat-value">${value}</div><div class="stat-note">${escapeHtml(note)}${filter ? ' · 点击查看' : ''}</div>`;
    return filter
      ? `<button type="button" class="stat-card stat-card-action ${className}" data-action="open-todo-filter" data-filter="${filter}">${content}</button>`
      : `<article class="stat-card ${className}">${content}</article>`;
  }

  function renderEmptyState(title, text) {
    return `<div class="empty-state"><div class="empty-mark">案</div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p><button class="btn btn-primary" data-action="new-case">${icon('plus')}新建案件</button></div>`;
  }

  function renderFilteredCasesEmpty() {
    const filtered = searchQuery.trim() || caseFilter !== 'all' || caseTypeFilter !== 'all';
    if (!filtered) return renderEmptyState('还没有案件', '新建第一个案件后，程序会自动生成对应的办理流程。');
    return `<div class="empty-state"><div class="empty-mark">查</div><h3>没有符合条件的案件</h3><p>可以清除搜索词和筛选条件，再查看全部案件。</p><button class="btn btn-primary" data-action="clear-case-filters">清除筛选</button></div>`;
  }

  function renderCaseCard(caseItem) {
    const stats = model.caseStats(caseItem);
    const work = caseWorkState(caseItem, stats);
    const progress = progressValues(stats);
    const next = nextTaskSummary(caseItem, stats);
    const undecided = undecidedWorkflowItems(caseItem);
    const stageName = actualStageFor(caseItem, stats)?.name || '未设置实际阶段';
    return `
      <button class="case-card" data-action="open-case" data-case-id="${escapeHtml(caseItem.id)}">
        <div class="case-card-top">
          <div><div class="case-title-line"><span class="case-type-dot category-${escapeHtml(caseItem.caseType || 'custom')}"></span><h3 class="case-name">${escapeHtml(caseItem.name)}</h3></div><div class="case-meta">${escapeHtml(caseItem.caseTypeLabel || categoryName(caseItem.caseType))} · ${escapeHtml(caseItem.caseNumber || '未填写案号')} · ${escapeHtml(caseItem.manager || '未填写承办人')}</div></div>
          <span class="badge ${work.complete ? 'badge-green' : 'badge-blue'}">${escapeHtml(work.allNotApplicable ? '无适用清单' : stageName)}</span>
        </div>
        <div class="case-next"><strong>${undecided.length ? '待确认流程：' : next.label}</strong>${escapeHtml(undecided[0]?.title || next.title)}${!undecided.length && next.priorOpenCount ? `<span class="prior-open-hint"> · 前序另有 ${next.priorOpenCount} 项未处理</span>` : ''}</div>
        <div class="progress-row"><div class="progress-track" title="${work.allNotApplicable ? '所有条件流程均已确认不适用' : `已处理 ${progress.processed}/${stats.total}`}"><div class="progress-fill" style="width:${work.allNotApplicable ? 100 : progress.handledPercent}%"></div></div><div class="progress-text">${work.allNotApplicable ? '无适用清单 · 0 项待办' : `已处理 ${progress.processed}/${stats.total}${progress.review ? ` · 待复核 ${progress.review}` : ''}`}</div></div>
      </button>`;
  }

  function renderReminder(item) {
    if (item.kind === 'case-date') {
      return `<div class="reminder-item reminder-case-date"><button class="reminder-open" data-action="open-case" data-case-id="${escapeHtml(item.caseItem.id)}"><span class="reminder-dot ${item.due.kind === 'overdue' ? 'overdue' : ''}"></span><span><span class="reminder-title">案件关键日期</span><span class="reminder-meta">${escapeHtml(item.caseItem.name)} · ${escapeHtml(reminderLabel(item.due))} · ${formatDate(item.caseItem.importantDate)}</span></span></button><button class="reminder-resolve" data-action="set-case-date-status" data-case-id="${escapeHtml(item.caseItem.id)}" data-handled="true">标记已处理</button></div>`;
    }
    return `<div class="reminder-item" role="button" tabindex="0" data-action="open-reminder" data-case-id="${escapeHtml(item.caseItem.id)}" data-stage-id="${escapeHtml(item.stage.id)}" data-task-id="${escapeHtml(item.task.id)}"><span class="reminder-dot ${item.due.kind === 'overdue' ? 'overdue' : ''}"></span><div><div class="reminder-title">${escapeHtml(item.task.title)}</div><div class="reminder-meta">${escapeHtml(item.caseItem.name)} · ${escapeHtml(reminderLabel(item.due))} · ${formatDate(item.task.dueDate)}</div></div></div>`;
  }

  function renderCasesPage() {
    let cases = filteredCases(true);
    if (caseFilter === 'active') cases = cases.filter((item) => !item.archived && !caseWorkState(item).complete);
    if (caseFilter === 'complete') cases = cases.filter((item) => caseWorkState(item).complete && !item.archived);
    if (caseFilter === 'archived') cases = cases.filter((item) => item.archived);
    if (caseTypeFilter !== 'all') cases = cases.filter((item) => item.caseType === caseTypeFilter);
    return `
      <div class="toolbar">
        <div class="filter-group">
          <select class="select" id="case-filter" aria-label="筛选案件">
            <option value="all" ${caseFilter === 'all' ? 'selected' : ''}>全部案件</option>
            <option value="active" ${caseFilter === 'active' ? 'selected' : ''}>进行中</option>
            <option value="complete" ${caseFilter === 'complete' ? 'selected' : ''}>清单已处理 / 无适用清单</option>
            <option value="archived" ${caseFilter === 'archived' ? 'selected' : ''}>已归档</option>
          </select>
          <select class="select" id="case-type-filter" aria-label="筛选业务类型">
            <option value="all" ${caseTypeFilter === 'all' ? 'selected' : ''}>全部业务类型</option>
            ${templateCategories.map((category) => `<option value="${escapeHtml(category.id)}" ${caseTypeFilter === category.id ? 'selected' : ''}>${escapeHtml(category.name)}</option>`).join('')}
          </select>
          <span class="badge badge-outline">显示 ${cases.length} 个</span>
        </div>
        <button class="btn" data-action="export-csv">${icon('export')}导出 Excel 清单</button>
      </div>
      <div class="panel">
        ${cases.length ? `<table class="case-table"><thead><tr><th>案件</th><th>类型</th><th>实际阶段</th><th>承办人</th><th>下一事项</th><th>清单进度</th></tr></thead><tbody>${cases.map(renderCaseRow).join('')}</tbody></table>` : renderFilteredCasesEmpty()}
      </div>`;
  }

  function renderCaseRow(caseItem) {
    const stats = model.caseStats(caseItem);
    const work = caseWorkState(caseItem, stats);
    const progress = progressValues(stats);
    const next = nextTaskSummary(caseItem, stats);
    const stage = actualStageFor(caseItem, stats)?.name || '未设置';
    return `<tr data-action="open-case" data-case-id="${escapeHtml(caseItem.id)}"><td><div class="table-case-name">${escapeHtml(caseItem.name)}</div><div class="table-sub">${escapeHtml(caseItem.caseNumber || '未填写案号')}${caseItem.archived ? ' · 已归档' : ''}</div></td><td><span class="badge badge-outline"><span class="case-type-dot category-${escapeHtml(caseItem.caseType || 'custom')}"></span>${escapeHtml(caseItem.caseTypeLabel || categoryName(caseItem.caseType))}</span></td><td><span class="badge ${work.complete ? 'badge-green' : 'badge-blue'}">${escapeHtml(work.allNotApplicable ? '无适用清单' : stage)}</span></td><td>${escapeHtml(caseItem.manager || '—')}</td><td><div style="max-width:310px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(next.title || '—')}${next.priorOpenCount ? ` · 前序 ${next.priorOpenCount} 项` : ''}</div></td><td><div class="mini-progress"><div class="progress-track"><div class="progress-fill" style="width:${progress.handledPercent}%"></div></div><span>${work.allNotApplicable ? '无适用清单' : `已处理 ${progress.processed}/${stats.total}`}</span></div></td></tr>`;
  }

  function renderCaseTemplateBasis(caseItem) {
    const snapshot = caseItem.templateSnapshot;
    if (!snapshot) return `<details class="case-template-basis"><summary><span>本案清单依据</span><small>旧版案件未保存模板依据快照</small></summary><div class="basis-body"><div class="basis-warning">本案仅保留了模板名称“${escapeHtml(caseItem.templateName || '未知模板')}”，无法还原建案时的法律说明和参考依据。</div></div></details>`;
    const sources = Array.isArray(snapshot.sources) ? snapshot.sources : [];
    const meta = templateMetaLine(snapshot);
    return `<details class="case-template-basis"><summary><span>本案清单依据</span><small>${escapeHtml(snapshot.name || caseItem.templateName || '自定义流程')}${meta ? ` · ${escapeHtml(meta)}` : ''}</small></summary><div class="basis-body"><div class="basis-grid"><div><label>建案时模板</label><strong>${escapeHtml(snapshot.name || caseItem.templateName || '—')}</strong></div><div><label>适用范围</label><strong>${escapeHtml(templateScope(snapshot) || '未单独标注')}</strong></div><div><label>核对日期</label><strong>${escapeHtml(formatDate(templateReviewDate(snapshot)) || templateReviewDate(snapshot) || '未标注')}</strong></div><div><label>快照时间</label><strong>${escapeHtml(snapshot.capturedAt ? new Date(snapshot.capturedAt).toLocaleString('zh-CN') : '未标注')}</strong></div></div>${snapshot.description ? `<p class="basis-description">${escapeHtml(snapshot.description)}</p>` : ''}${snapshot.legalNote ? `<div class="legal-note">${escapeHtml(snapshot.legalNote)}</div>` : '<div class="basis-warning">该模板未附独立法律风险说明，请承办人根据现行规则和案件文书复核。</div>'}${sources.length ? `<div class="template-sources"><strong>建案时参考依据</strong>${sources.map((source) => { const title = typeof source === 'string' ? source : source.title; const url = typeof source === 'string' ? '' : source.url; return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(title)}</a>` : `<span>${escapeHtml(title)}</span>`; }).join('')}</div>` : '<div class="basis-warning">该快照未列出参考来源。</div>'}</div></details>`;
  }

  function renderCaseDetail(caseItem) {
    const stats = model.caseStats(caseItem);
    const work = caseWorkState(caseItem, stats);
    const progress = progressValues(stats);
    if (!activeStageId || !getStage(caseItem, activeStageId)) activeStageId = stats.actualStage?.id || stats.focusStage?.id || stats.nextActionStage?.id || stats.nextPendingStage?.id || stats.currentStage?.id || caseItem.stages?.[0]?.id;
    const stage = getStage(caseItem, activeStageId);
    const next = nextTaskSummary(caseItem, stats);
    const undecided = undecidedWorkflowItems(caseItem);
    const actualStage = actualStageFor(caseItem, stats);
    const actualStageProgress = actualStage ? progressValues(model.stageStats(actualStage, { effectiveOnly: true })) : null;
    const nextActualStage = stats.nextActionStage || null;
    const nextStageNeedsDecision = Boolean(nextActualStage?.conditional && applicabilityOf(nextActualStage) === 'undecided');
    const actualStageHasUnresolved = undecided.some((item) => item.stage?.id === actualStage?.id);
    const showStageHandoff = Boolean(actualStage && actualStageProgress?.open === 0 && !actualStageHasUnresolved && nextActualStage && !work.complete && !caseItem.archived);
    const actualStageOptions = (caseItem.stages || []).filter(isStageEffective).map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === actualStage?.id ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('');
    const meta = [caseItem.caseNumber, caseItem.court, caseItem.manager ? `承办人：${caseItem.manager}` : '', caseItem.startDate ? `开始：${formatDate(caseItem.startDate)}` : ''].filter(Boolean);
    const statusSummary = [
      ['待办理', Math.max(0, progress.open - progress.review), 'pending'],
      ['待复核', progress.review, 'review'],
      ['已完成', Number(stats.done) || 0, 'done'],
      ['不适用', Number(stats.notApplicable) || 0, 'muted'],
      ['非委托范围', Number(stats.outOfScope) || 0, 'muted'],
      ['他人已完成', Number(stats.completedElsewhere) || 0, 'elsewhere']
    ].filter(([, count], index) => count > 0 || index < 3);
    return `
      <div class="breadcrumb"><button data-action="back-to-cases">所有案件</button><span>›</span><span>${escapeHtml(caseItem.name)}</span></div>
      <section class="case-hero">
        <div class="case-hero-top">
          <div><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span class="badge">${escapeHtml(caseItem.caseTypeLabel || categoryName(caseItem.caseType))}</span><h2>${escapeHtml(caseItem.name)}</h2>${caseItem.archived ? '<span class="badge">已归档</span>' : ''}${work.complete ? `<span class="badge badge-green">${escapeHtml(caseWorkLabel(caseItem, stats))}</span>` : (work.currentCleared ? `<span class="badge badge-amber">${escapeHtml(caseWorkLabel(caseItem, stats))}</span>` : '')}</div><div class="hero-meta">${meta.length ? meta.map((item) => `<span>${escapeHtml(item)}</span>`).join('') : '<span>尚未填写案件资料</span>'}</div>${caseItem.importantDate ? `<div class="hero-meta case-key-date"><span class="badge ${caseItem.importantDateHandledAt ? 'badge-green' : 'badge-amber'}">案件关键日期：${formatDate(caseItem.importantDate)} · ${caseItem.importantDateHandledAt ? '已处理' : '待处理'}</span><button data-action="set-case-date-status" data-case-id="${escapeHtml(caseItem.id)}" data-handled="${caseItem.importantDateHandledAt ? 'false' : 'true'}">${caseItem.importantDateHandledAt ? '恢复提醒' : '标记已处理'}</button></div>` : ''}</div>
          <div class="hero-actions"><button class="btn btn-small" data-action="save-case-template">保存为模板</button><button class="btn btn-small" data-action="edit-case">${icon('edit')}编辑资料</button><button class="btn btn-small" data-action="toggle-archive">${icon('archive')}${caseItem.archived ? '取消归档' : '归档'}</button></div>
        </div>
        <div class="actual-stage-control"><label for="actual-stage-select">实际办理阶段</label><select id="actual-stage-select" aria-label="实际办理阶段"><option value="">未设置</option>${actualStageOptions}</select><span>与清单中最早未处理阶段分开记录</span></div>
        ${showStageHandoff ? `<div class="stage-handoff"><div><strong>当前阶段已处理</strong><span>${nextStageNeedsDecision ? `下一项行动是确认“${escapeHtml(nextActualStage.name)}”是否适用。` : `下一项行动位于“${escapeHtml(nextActualStage.name)}”。实际进入后可切换当前阶段。`}</span></div><button class="btn btn-small" data-action="${nextStageNeedsDecision ? 'review-next-stage' : 'advance-actual-stage'}" data-stage-id="${escapeHtml(nextActualStage.id)}">${nextStageNeedsDecision ? '前往确认' : '切换到该阶段'}</button></div>` : ''}
        ${undecided.length ? `<button class="case-undecided-alert" data-action="open-first-condition" data-stage-id="${escapeHtml(undecided[0].stage.id)}"><strong>${undecided.length} 个当前条件流程待确认</strong><span>仅显示实际阶段及此前；确认后计入清单和计划 →</span></button>` : ''}
        <div class="hero-progress work-progress"><div>${work.allNotApplicable ? '<div class="workflow-resolved-note"><strong>本案无适用清单</strong><span>所有条件流程均已确认不适用，案件不会继续产生流程待办。</span></div>' : `<div class="work-progress-bar"><strong>已处理 ${progress.processed}/${stats.total}</strong><div class="progress-track" title="已处理 ${progress.handledPercent}%"><div class="progress-fill" style="width:${progress.handledPercent}%"></div></div><span>${progress.handledPercent}%</span></div><div class="case-status-summary" aria-label="清单状态摘要">${statusSummary.map(([label, count, tone]) => `<span class="status-summary-${tone}">${escapeHtml(label)} <strong>${count}</strong></span>`).join('')}</div>`}<div class="case-next"><strong>${undecided.length ? '当前待确认：' : next.label}</strong>${escapeHtml(undecided[0]?.title || next.title)}${!undecided.length && next.priorOpenCount ? `<span class="prior-open-hint"> · 前序另有 ${next.priorOpenCount} 项未处理</span>` : ''}</div></div></div>
      </section>
      ${renderCaseTemplateBasis(caseItem)}
      ${renderCaseTaskSearch(caseItem)}
      <section class="case-detail-grid">
        <nav class="stage-nav" aria-label="案件阶段"><div class="stage-nav-title">案件阶段</div>${caseItem.stages.map(renderStageButton).join('')}<button class="stage-add-button" data-action="add-stage"><span>＋</span> 新增阶段</button></nav>
        <div class="stage-content">${renderStageContent(caseItem, stage)}</div>
      </section>`;
  }

  function caseTaskSearchResults(caseItem) {
    const query = caseTaskSearchQuery.trim().toLocaleLowerCase('zh-CN');
    if (!query) return [];
    return model.flattenTasks(caseItem).filter(({ task }) => [task.title, task.detail, task.note]
      .some((value) => String(value || '').toLocaleLowerCase('zh-CN').includes(query))).slice(0, 30);
  }

  function renderCaseTaskSearch(caseItem) {
    const results = caseTaskSearchResults(caseItem);
    const query = caseTaskSearchQuery.trim();
    return `<section class="case-task-search"><label>${icon('search', 'btn-icon')}<input id="case-task-search" type="search" value="${escapeHtml(caseTaskSearchQuery)}" placeholder="搜索本案办理事项、说明或备注" aria-label="搜索本案办理事项" /></label>${query ? `<div class="case-task-search-results">${results.length ? results.map(({ stage, task }) => `<button data-action="open-case-search-result" data-stage-id="${escapeHtml(stage.id)}" data-task-id="${escapeHtml(task.id)}"><strong>${escapeHtml(task.title)}</strong><span>${escapeHtml(stage.name)}${task.note ? ` · 备注：${escapeHtml(task.note)}` : ''}</span></button>`).join('') : '<div class="case-task-search-empty">没有找到相关办理事项</div>'}${results.length >= 30 ? '<small>最多显示前 30 项，请输入更具体的关键词。</small>' : ''}</div>` : ''}</section>`;
  }

  function renderStageButton(stage, index) {
    const stats = model.stageStats(stage, { effectiveOnly: true });
    const progress = progressValues(stats);
    const applicability = applicabilityOf(stage);
    const inactiveCondition = stage.conditional && applicability !== 'included';
    const unresolvedGroupCount = Number(stats.effectiveUnresolvedGroupCount ?? stats.unresolvedGroupCount) || 0;
    const hasPendingGroups = !inactiveCondition && unresolvedGroupCount > 0;
    const allNotApplicable = Boolean(stats.allNotApplicable) && !hasPendingGroups;
    const complete = !inactiveCondition && stats.total > 0 && progress.open === 0 && unresolvedGroupCount === 0;
    const marker = applicability === 'undecided' || hasPendingGroups ? '?' : (applicability === 'excluded' || allNotApplicable ? '—' : (complete ? '✓' : index + 1));
    const count = inactiveCondition ? '不计入' : (hasPendingGroups ? `${unresolvedGroupCount} 组待确认` : (allNotApplicable ? '无适用事项' : `${progress.processed}/${stats.total}`));
    return `<button class="stage-button ${stage.id === activeStageId ? 'active' : ''} ${complete ? 'complete' : ''} ${stage.conditional ? `conditional-${applicability}` : ''}" data-action="select-stage" data-stage-id="${escapeHtml(stage.id)}" data-task-total="${stats.rawTotal ?? stats.total}"><span class="stage-number">${marker}</span><span class="stage-name">${escapeHtml(stage.name)}${stage.custom ? '<small>自定义</small>' : ''}${stage.conditional ? `<small>${applicabilityLabel(applicability)}</small>` : ''}</span><span class="stage-count">${count}</span></button>`;
  }

  function renderStageContent(caseItem, stage) {
    if (!stage) return '<div class="empty-state"><h3>暂无阶段内容</h3></div>';
    const stats = model.stageStats(stage, { effectiveOnly: true });
    const progress = progressValues(stats);
    const applicability = applicabilityOf(stage);
    const stageEffective = isStageEffective(stage);
    const selector = stage.conditional ? `<label class="applicability-control"><span>本阶段</span><select class="stage-applicability" data-case-id="${escapeHtml(caseItem.id)}" data-stage-id="${escapeHtml(stage.id)}"><option value="undecided" ${applicability === 'undecided' ? 'selected' : ''}>待确认</option><option value="included" ${applicability === 'included' ? 'selected' : ''}>适用</option><option value="excluded" ${applicability === 'excluded' ? 'selected' : ''}>不适用</option></select></label>` : '';
    const stageSummary = stageEffective ? `已处理 ${progress.processed} 项，已完成 ${progress.completed} 项，待办 ${Math.max(0, progress.open - progress.review)} 项${progress.review ? `，待复核 ${progress.review} 项` : ''}${stats.unresolvedGroupCount ? `；另有 ${stats.unresolvedGroupCount} 个条件事项组待确认，暂不计入` : ''}` : `共 ${stats.rawTotal ?? stats.total} 项模板任务，当前不计入案件进度`;
    return `<div class="stage-content-head"><div><div class="stage-title-line"><h3>${escapeHtml(stage.name)}</h3>${stage.custom ? '<span class="badge badge-violet">自定义阶段</span>' : ''}${stage.conditional ? `<span class="badge badge-amber">条件阶段 · ${applicabilityLabel(applicability)}</span>` : ''}</div>${stage.conditionText ? `<p class="stage-condition">适用条件：${escapeHtml(stage.conditionText)}</p>` : ''}<p>${stageSummary}</p></div><div class="stage-head-actions">${selector}${stage.custom ? `<button class="btn btn-small btn-ghost" data-action="edit-stage" data-stage-id="${escapeHtml(stage.id)}">编辑阶段</button><button class="btn btn-small btn-ghost danger-text" data-action="delete-stage" data-stage-id="${escapeHtml(stage.id)}">删除</button>` : ''}${stageEffective ? `<button class="btn btn-small btn-primary-soft" data-action="add-group" data-stage-id="${escapeHtml(stage.id)}">＋ 新增事项组</button>` : ''}<span class="stage-percent">${stageEffective ? `${progress.processed}/${stats.total}` : '—'}</span></div></div>${applicability === 'excluded' ? '<div class="excluded-notice">本阶段已设为不适用。任务仍可查看，但不计入待办、计划和进度。</div>' : applicability === 'undecided' ? '<div class="undecided-notice">请先确认本阶段是否适用；确认前不计入待办和进度。</div>' : ''}${stage.groups.length ? stage.groups.map((group) => renderTaskGroup(caseItem, stage, group)).join('') : '<div class="empty-state"><h3>这个阶段还没有事项</h3><p>点击“新增事项组”添加第一项工作。</p></div>'}`;
  }

  function renderTaskGroup(caseItem, stage, group) {
    const stats = model.groupStats(group);
    const progress = progressValues(stats);
    const applicability = applicabilityOf(group);
    const disabled = !isGroupEffective(stage, group);
    const selector = group.conditional ? `<label class="applicability-control compact"><span>本事项组</span><select class="group-applicability" data-case-id="${escapeHtml(caseItem.id)}" data-group-id="${escapeHtml(group.id)}" ${!isStageEffective(stage) ? 'disabled' : ''}><option value="undecided" ${applicability === 'undecided' ? 'selected' : ''}>待确认</option><option value="included" ${applicability === 'included' ? 'selected' : ''}>适用</option><option value="excluded" ${applicability === 'excluded' ? 'selected' : ''}>不适用</option></select></label>` : '';
    const groupCount = disabled ? '不计入' : `${progress.processed}/${stats.total}`;
    const readonlyReason = !isStageEffective(stage) ? '随所属阶段暂不计入' : (applicability === 'excluded' ? '本事项组已设为不适用' : '本事项组尚待确认');
    return `<article class="task-group ${disabled ? 'workflow-excluded' : ''}">
      <header class="group-head"><div><div class="group-title-row"><h4 class="group-title">${escapeHtml(group.title)}</h4>${group.custom ? '<span class="badge badge-violet">自定义</span>' : ''}${group.conditional ? `<span class="badge badge-amber">条件事项 · ${applicabilityLabel(applicability)}</span>` : ''}<span class="badge badge-outline">${groupCount}</span></div>${group.conditionText ? `<p class="group-condition">${escapeHtml(group.conditionText)}</p>` : ''}</div><div class="group-actions">${selector}${disabled ? '' : `<button class="btn btn-small btn-primary-soft" data-action="add-task" data-group-id="${escapeHtml(group.id)}">＋ 添加步骤</button>`}${group.custom ? `<button class="btn btn-small btn-ghost" data-action="edit-group" data-group-id="${escapeHtml(group.id)}">编辑</button><button class="btn btn-small btn-ghost danger-text" data-action="delete-group" data-group-id="${escapeHtml(group.id)}">删除</button>` : ''}${!disabled && progress.open > 0 ? `<button class="btn btn-small btn-ghost" data-action="complete-group" data-group-id="${escapeHtml(group.id)}">将 ${progress.open} 项标记完成</button>` : ''}</div></header>
      ${disabled ? `<div class="group-readonly-note">${readonlyReason}，下列任务仅供查看。</div>` : ''}
      <div class="task-list">${group.tasks.map((task) => renderTask(caseItem, task, disabled)).join('')}</div>
    </article>`;
  }

  function renderTask(caseItem, task, workflowDisabled = false) {
    const status = taskStatusMeta(task);
    const isDone = status.value === (model.STATUS.DONE || 'done');
    const due = model.dueStatus(task, state.settings.upcomingDays);
    const planLabel = task.dueDate ? (due ? reminderLabel(due) : `计划 ${formatDate(task.dueDate)}`) : '未设计划办理日';
    return `<div class="task-row task-row-compact status-${status.tone} ${workflowDisabled ? 'workflow-readonly' : ''}" data-task-id="${escapeHtml(task.id)}">
      <label class="task-check" title="${workflowDisabled ? '条件流程未适用' : (isDone ? '恢复为待办理' : '快速标记已完成')}"><input class="task-checkbox" type="checkbox" data-case-id="${escapeHtml(caseItem.id)}" data-task-id="${escapeHtml(task.id)}" ${isDone ? 'checked' : ''} ${workflowDisabled ? 'disabled' : ''}/><span class="check-visual"></span></label>
      <div class="task-main"><div class="task-title-row"><span class="task-title">${escapeHtml(task.title)}</span>${task.custom ? '<span class="badge badge-violet">自定义</span>' : ''}${task.optional ? '<span class="badge">可选</span>' : ''}${task.needsReview ? '<span class="badge badge-red">模板内容待确认</span>' : ''}${status.value === (model.STATUS.REVIEW || 'review') || ![model.STATUS.PENDING || 'pending', model.STATUS.DONE || 'done'].includes(status.value) ? `<span class="task-status-badge status-${status.tone}">${escapeHtml(status.label)}</span>` : ''}</div>
        <details class="task-more"><summary><span>${escapeHtml(planLabel)}</span>${task.note ? '<em>有备注</em>' : ''}<b>详情与记录</b></summary><div class="task-more-content">${task.detail ? `<div class="task-detail">${escapeHtml(task.detail)}</div>` : '<div class="task-detail task-detail-empty">模板未附详细说明，可在备注中记录办理情况。</div>'}<div class="task-fields"><div class="field-inline"><label>计划办理日</label><input class="task-date" type="date" data-case-id="${escapeHtml(caseItem.id)}" data-task-id="${escapeHtml(task.id)}" value="${escapeHtml(task.dueDate || '')}" ${workflowDisabled ? 'disabled' : ''}/>${due && due.kind !== 'future' ? `<span class="due-label ${due.kind}">${escapeHtml(reminderLabel(due))}</span>` : ''}</div><div class="field-inline"><label>办理备注</label><input class="task-note" type="text" data-case-id="${escapeHtml(caseItem.id)}" data-task-id="${escapeHtml(task.id)}" value="${escapeHtml(task.note || '')}" placeholder="补充办理情况、材料位置等" ${workflowDisabled ? 'disabled' : ''}/></div></div></div></details>
      </div>
      <div class="task-row-actions"><label class="task-status-control"><span class="sr-only">任务状态</span><select class="task-status-select" data-case-id="${escapeHtml(caseItem.id)}" data-task-id="${escapeHtml(task.id)}" aria-label="任务状态" ${workflowDisabled ? 'disabled' : ''}>${taskStatusOptionsHtml(status.value)}</select></label>${workflowDisabled ? '' : `<button class="task-action" data-action="edit-task" data-task-id="${escapeHtml(task.id)}">编辑</button>${task.custom ? `<button class="task-action danger-text" data-action="delete-task" data-task-id="${escapeHtml(task.id)}">删除</button>` : ''}`}</div>
    </div>`;
  }

  function revealTask(taskId, { focus = true } = {}) {
    if (!taskId) return;
    window.requestAnimationFrame(() => {
      const row = document.querySelector(`.task-row[data-task-id="${CSS.escape(taskId)}"]`);
      if (!row) return;
      row.classList.add('search-highlight');
      const details = row.querySelector('.task-more');
      if (details) details.open = true;
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (focus) details?.querySelector('summary')?.focus({ preventScroll: true });
      window.setTimeout(() => row.classList.remove('search-highlight'), 2400);
    });
  }

  function openCase(caseId, stageId = null, taskId = null) {
    selectedCaseId = caseId;
    const caseItem = selectedCase();
    if (!caseItem) return;
    caseTaskSearchQuery = '';
    const stats = model.caseStats(caseItem);
    activeStageId = stageId || stats.actualStage?.id || stats.focusStage?.id || stats.nextActionStage?.id || stats.nextPendingStage?.id || stats.currentStage?.id || caseItem.stages?.[0]?.id;
    currentView = 'detail';
    renderApp();
    revealTask(taskId);
  }

  function templateOptionHtml(template, selectedId) {
    const counts = templateCounts(template);
    return `<option value="${escapeHtml(template.id)}" ${template.id === selectedId ? 'selected' : ''}>${escapeHtml(template.name)}（${counts.stages} 阶段 / ${counts.tasks} 步骤）</option>`;
  }

  function templateChooserSummary(template) {
    if (!template) return '';
    const counts = templateCounts(template);
    const meta = templateMetaLine(template);
    return `<div class="chosen-template-symbol category-${escapeHtml(template.category)}">${escapeHtml((template.categoryLabel || categoryName(template.category)).slice(0, 1))}</div><div><strong>${escapeHtml(template.name)}</strong><p>${escapeHtml(template.description || '')}</p>${meta ? `<small>${escapeHtml(meta)}</small>` : '<small class="warning-text">未标注核对日期与适用范围</small>'}<span>${counts.stages} 个阶段 · ${counts.tasks} 个基础步骤；建案时会保留独立依据快照</span></div>`;
  }

  function updateCaseTemplatePresentation(template) {
    const summary = document.getElementById('case-template-summary');
    const recommended = document.getElementById('recommended-template-name');
    const scope = document.getElementById('recommended-template-scope');
    if (summary) summary.innerHTML = template ? templateChooserSummary(template) : '<div class="template-choice-placeholder">请选择业务类型，再确认采用的流程。</div>';
    if (recommended) recommended.textContent = template?.name || '尚无可用流程';
    if (scope) scope.textContent = template ? (templateScope(template) || '角色未单独标注') : '';
  }

  function refreshCaseTemplateChooser(categoryId, preferredId = '') {
    const select = document.getElementById('case-template-select');
    const summary = document.getElementById('case-template-summary');
    if (!select || !summary) return;
    const available = allTemplates().filter((template) => template.category === categoryId);
    const fallback = available[0] || null;
    const chosenId = available.some((item) => item.id === preferredId) ? preferredId : fallback?.id;
    select.innerHTML = available.length ? available.map((item) => templateOptionHtml(item, chosenId)).join('') : '<option value="">该类型还没有模板，请先到模板中心创建</option>';
    select.disabled = !available.length;
    const chosen = available.find((item) => item.id === chosenId) || fallback;
    if (available.length) updateCaseTemplatePresentation(chosen);
    else {
      updateCaseTemplatePresentation(null);
      summary.innerHTML = '<div class="missing-template-notice"><strong>这个业务类型还没有流程模板</strong><p>请先建立一套空白模板，再用它新建案件。</p><button class="btn btn-small" type="button" data-action="open-template-library">去流程模板</button></div>';
    }
    const submit = document.getElementById('case-form')?.querySelector('button[type="submit"]');
    if (submit) {
      submit.disabled = !available.length;
      submit.title = available.length ? '' : '请先为该业务类型创建流程模板';
    }
    return chosenId || '';
  }

  function formSnapshot(form) {
    if (!form) return '';
    return JSON.stringify([...new FormData(form).entries()]);
  }

  function markModalFormClean(form) {
    if (form) form.dataset.cleanSnapshot = formSnapshot(form);
  }

  function modalFormHasUnsavedChanges(form) {
    if (!form || form.dataset.submitting === 'true') return false;
    return formSnapshot(form) !== (form.dataset.cleanSnapshot || '');
  }

  function openCaseModal(caseItem = null, preferredTemplateId = '') {
    const isEdit = Boolean(caseItem);
    const preferredTemplate = allTemplates().find((item) => item.id === preferredTemplateId) || null;
    const initialCategory = preferredTemplate?.category || '';
    const available = initialCategory ? allTemplates().filter((item) => item.category === initialCategory) : [];
    modalRoot.innerHTML = `<dialog id="case-dialog"><form id="case-form"><div class="modal-head"><h2>${isEdit ? '编辑案件资料' : '新建案件'}</h2><button class="modal-close" type="button" data-action="close-modal" aria-label="关闭">×</button></div><div class="modal-body"><div class="form-grid">
      ${isEdit ? `<div class="case-type-readonly full"><span class="chosen-template-symbol category-${escapeHtml(caseItem.caseType || 'custom')}">${escapeHtml((caseItem.caseTypeLabel || categoryName(caseItem.caseType)).slice(0, 1))}</span><div><label>业务类型</label><strong>${escapeHtml(caseItem.caseTypeLabel || categoryName(caseItem.caseType))}</strong><p>本案使用：${escapeHtml(caseItem.templateName || '自定义流程')}</p></div></div>` : `<section class="case-create-step full"><div class="case-create-step-head"><span>1</span><div><strong>选择业务类型</strong><p>请先明确选择；系统不会默认创建破产案件。建案后仍可增删步骤。</p></div></div><div class="form-field"><label>业务类型 <span class="required">*</span></label><select name="caseType" id="case-type-select" required><option value="" ${initialCategory ? '' : 'selected'} disabled>请选择业务类型</option>${templateCategories.map((category) => `<option value="${escapeHtml(category.id)}" ${category.id === initialCategory ? 'selected' : ''}>${escapeHtml(category.name)}</option>`).join('')}</select></div><div class="recommended-template-line">采用流程：<strong id="recommended-template-name">${escapeHtml(preferredTemplate?.name || '选择业务类型后显示')}</strong><span id="recommended-template-scope">${escapeHtml(preferredTemplate ? (templateScope(preferredTemplate) || '角色未单独标注') : '')}</span></div><details class="template-picker-more" ${preferredTemplate ? '' : 'open'}><summary>查看并确认流程模板</summary><div class="template-picker"><div class="template-picker-heading"><div><strong>采用的流程</strong><p>创建前请核对阶段与基础步骤数量。</p></div><button class="btn btn-small" type="button" data-action="open-template-library">管理模板</button></div><div class="template-picker-controls"><div class="form-field full"><label>采用流程 <span class="required">*</span></label><select name="templateId" id="case-template-select" required ${available.length ? '' : 'disabled'}>${available.length ? available.map((item) => templateOptionHtml(item, preferredTemplate?.id)).join('') : '<option value="">请先选择业务类型</option>'}</select></div></div><div class="case-template-summary" id="case-template-summary">${preferredTemplate ? templateChooserSummary(preferredTemplate) : '<div class="template-choice-placeholder">请选择业务类型，再确认采用的流程。</div>'}</div></div></details></section><div class="case-create-step-head case-create-basics full"><span>2</span><div><strong>填写案件基本资料</strong><p>案件名称为必填，其余资料可稍后补充。</p></div></div>`}
      <div class="form-field full"><label>案件 / 项目名称 <span class="required">*</span></label><input name="name" required maxlength="80" value="${escapeHtml(caseItem?.name || '')}" placeholder="例如：某公司合同纠纷案、某专项法律服务" autofocus /></div>
      <div class="form-field"><label>当事人 / 客户名称</label><input name="companyName" maxlength="100" value="${escapeHtml(caseItem?.companyName || '')}" placeholder="个人或单位名称" /></div>
      <div class="form-field"><label>案号 / 项目编号</label><input name="caseNumber" maxlength="80" value="${escapeHtml(caseItem?.caseNumber || '')}" placeholder="没有时可暂不填写" /></div>
      <div class="form-field"><label>承办人</label><input name="manager" maxlength="50" value="${escapeHtml(caseItem?.manager || '')}" placeholder="承办人姓名" /></div>
      <div class="form-field"><label>开始日期</label><input name="startDate" type="date" value="${escapeHtml(caseItem?.startDate || '')}" /><div class="form-help">如暂不确定，可以留空；程序不会自动填入今天。</div></div>
      <details class="case-more-fields full"><summary>更多资料（可稍后填写）</summary><div class="form-grid">
        <div class="form-field"><label>办理机关</label><input name="court" maxlength="100" value="${escapeHtml(caseItem?.court || '')}" placeholder="法院、检察院、公安机关或其他机构" /></div>
        <div class="form-field"><label>案件关键日期</label><input name="importantDate" type="date" value="${escapeHtml(caseItem?.importantDate || '')}" /><div class="form-help">用于案件总览，例如开庭或申报日；不会自动生成任务计划办理日。</div></div>
        <div class="form-field full"><label>案件备注</label><textarea name="notes" maxlength="1000" placeholder="可填写联系人、特殊情况、办理目标等">${escapeHtml(caseItem?.notes || '')}</textarea></div>
      </div></details>
    </div></div><div class="modal-actions">${isEdit ? '<button class="btn btn-danger" type="button" data-action="delete-case">移至最近删除</button>' : ''}<span style="flex:1"></span><button class="btn" type="button" data-action="close-modal">取消</button><button class="btn btn-primary" type="submit">${isEdit ? '保存修改' : '创建案件'}</button></div></form></dialog>`;
    const dialog = document.getElementById('case-dialog');
    dialog.dataset.caseId = caseItem?.id || '';
    dialog.showModal();
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeModal(); });
    const caseForm = document.getElementById('case-form');
    caseForm.addEventListener('submit', handleCaseFormSubmit);
    if (!isEdit) {
      if (initialCategory) refreshCaseTemplateChooser(initialCategory, preferredTemplate?.id);
      else {
        const submit = caseForm.querySelector('button[type="submit"]');
        submit.disabled = true;
        submit.title = '请先选择业务类型和流程模板';
      }
      document.getElementById('case-type-select').addEventListener('change', (event) => {
        refreshCaseTemplateChooser(event.target.value);
      });
      document.getElementById('case-template-select').addEventListener('change', (event) => {
        const chosen = allTemplates().find((item) => item.id === event.target.value);
        if (chosen) updateCaseTemplatePresentation(chosen);
      });
    }
    markModalFormClean(caseForm);
  }

  function closeModal({ force = false } = {}) {
    const dialog = modalRoot.querySelector('dialog');
    const form = dialog?.querySelector('form');
    if (!force && modalFormHasUnsavedChanges(form) && !window.confirm('当前窗口还有尚未保存的内容，确定放弃吗？')) return false;
    if (dialog?.open) dialog.close();
    modalRoot.innerHTML = '';
    return true;
  }

  function handleCaseFormSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = Object.fromEntries(new FormData(form).entries());
    if (!String(fields.name || '').trim()) return;
    const dialog = document.getElementById('case-dialog');
    const caseId = dialog.dataset.caseId;
    if (caseId) {
      const caseItem = state.cases.find((item) => item.id === caseId);
      if (!caseItem) return;
      form.dataset.submitting = 'true';
      const previousImportantDate = caseItem.importantDate || '';
      for (const key of ['name', 'companyName', 'caseNumber', 'court', 'manager', 'startDate', 'importantDate', 'notes']) caseItem[key] = String(fields[key] || '').trim();
      if (caseItem.importantDate !== previousImportantDate) caseItem.importantDateHandledAt = null;
      caseItem.updatedAt = new Date().toISOString();
      showToast('案件资料已更新');
    } else {
      const chosenTemplate = allTemplates().find((item) => item.id === fields.templateId && item.category === fields.caseType);
      if (!chosenTemplate) {
        showToast('这个业务类型还没有可用流程，请先到流程模板中创建', 'error');
        return;
      }
      form.dataset.submitting = 'true';
      const caseItem = model.createCase(fields, chosenTemplate);
      state.cases.unshift(caseItem);
      selectedCaseId = caseItem.id;
      activeStageId = caseItem.stages[0]?.id;
      currentView = 'detail';
      showToast(`案件已创建，已生成“${chosenTemplate.name}”流程`);
    }
    closeModal({ force: true });
    scheduleSave({ immediate: true });
    renderApp();
  }

  function categoryOptions(selected) {
    return templateCategories.map((category) => `<option value="${escapeHtml(category.id)}" ${category.id === selected ? 'selected' : ''}>${escapeHtml(category.name)}</option>`).join('');
  }

  function openTemplateFormModal(mode = 'create') {
    const editing = mode === 'edit';
    const source = editing ? templateDraft : null;
    modalRoot.innerHTML = `<dialog id="template-form-dialog"><form id="template-form"><div class="modal-head"><div><div class="modal-kicker">流程模板</div><h2>${editing ? '模板设置' : '新建空白模板'}</h2></div><button class="modal-close" type="button" data-action="close-modal">×</button></div><div class="modal-body"><div class="form-grid">
      <div class="form-field full"><label>模板名称 <span class="required">*</span></label><input name="name" required maxlength="80" value="${escapeHtml(source?.name || '')}" placeholder="例如：建设工程合同纠纷—原告代理" autofocus /></div>
      <div class="form-field"><label>业务类型</label><select name="category">${categoryOptions(source?.category || 'custom')}</select></div>
      <div class="form-field"><label>适用角色</label><input name="role" maxlength="100" value="${escapeHtml(source?.role || '')}" placeholder="例如：原告代理人、被告代理人" /></div>
      <div class="form-field full"><label>适用范围</label><input name="scope" maxlength="300" value="${escapeHtml(source?.scope || '')}" placeholder="例如：一审普通程序；具体案件需逐项核对" /></div>
      <div class="form-field full"><label>模板说明</label><textarea name="description" maxlength="300" placeholder="说明适用场景、委托人角色或使用注意事项">${escapeHtml(source?.description || '')}</textarea></div>
      ${editing ? '<div class="form-help full template-category-change-note">如更换业务类型，原核对日期、法律提示和参考来源将自动清除，避免把其他业务的依据误带入新分类。</div>' : ''}
      ${editing ? '' : `<div class="form-divider full"><span>先建立第一项流程，保存后可继续扩充</span></div><div class="form-field"><label>第一阶段名称</label><input name="stageName" maxlength="50" value="第一阶段" /></div><div class="form-field"><label>事项组名称</label><input name="groupTitle" maxlength="80" value="主要事项" /></div><div class="form-field full"><label>第一个办理步骤</label><input name="firstTaskTitle" maxlength="120" value="收集并核对基础材料" /></div>`}
    </div></div><div class="modal-actions"><button class="btn" type="button" data-action="close-modal">取消</button><button class="btn btn-primary" type="submit">${editing ? '保存设置' : '进入流程编辑'}</button></div></form></dialog>`;
    const dialog = document.getElementById('template-form-dialog');
    dialog.dataset.mode = mode;
    dialog.showModal();
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeModal(); });
    const templateForm = document.getElementById('template-form');
    templateForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const fields = Object.fromEntries(new FormData(event.currentTarget).entries());
      if (!String(fields.name || '').trim()) return;
      event.currentTarget.dataset.submitting = 'true';
      const categoryLabel = categoryName(fields.category);
      if (editing) {
        const categoryChanged = fields.category !== source.category;
        if (categoryChanged && String(fields.role || '').trim() === String(source.role || '').trim()) fields.role = '';
        if (categoryChanged && String(fields.scope || '').trim() === String(source.scope || '').trim()) fields.scope = '';
        templateDraft.name = String(fields.name).trim();
        templateDraft.category = fields.category;
        templateDraft.categoryLabel = categoryLabel;
        templateDraft.role = String(fields.role || '').trim();
        templateDraft.scope = String(fields.scope || '').trim();
        templateDraft.description = String(fields.description || '').trim();
        if (categoryChanged) {
          templateDraft.sourceVersion = '';
          templateDraft.lastReviewedAt = '';
          templateDraft.legalNote = '';
          templateDraft.sources = [];
          templateDraft.completeness = 'legacy_partial';
        }
        templateDraft.updatedAt = new Date().toISOString();
        closeModal();
        renderApp();
        showToast(categoryChanged ? '业务类型已更新；原法律依据已清除，请重新核对后保存' : '模板设置已更新，记得点击“保存模板”');
      } else {
        const draft = model.createBlankTemplate({ ...fields, categoryLabel });
        closeModal();
        templateDraft = draft;
        templateDraftBaseline = '';
        selectedTemplateId = null;
        activeStageId = draft.stages?.[0]?.id || null;
        currentView = 'template-editor';
        renderApp();
      }
    });
    markModalFormClean(templateForm);
  }

  function sourceLinksHtml(template) {
    const sources = Array.isArray(template.sources) ? template.sources : [];
    if (!sources.length) return '';
    return `<div class="template-sources"><strong>参考依据</strong>${sources.map((source) => {
      const title = typeof source === 'string' ? source : source.title;
      const url = typeof source === 'string' ? '' : source.url;
      return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(title)}</a>` : `<span>${escapeHtml(title)}</span>`;
    }).join('')}</div>`;
  }

  function openTemplatePreviewModal(template) {
    if (!template) return;
    const counts = templateCounts(template);
    const meta = templateMetaLine(template);
    modalRoot.innerHTML = `<dialog id="template-preview-dialog" class="wide-dialog"><div class="modal-head"><div><div class="modal-kicker">${escapeHtml(template.categoryLabel || categoryName(template.category))}</div><h2>${escapeHtml(template.name)}</h2></div><button class="modal-close" type="button" data-action="close-modal">×</button></div><div class="modal-body template-preview-body"><div class="preview-summary"><div><p>${escapeHtml(template.description || '')}</p>${meta ? `<small>${escapeHtml(meta)}</small>` : '<small class="warning-text">未标注核对日期与适用范围</small>'}</div><span>${counts.stages} 个阶段 · ${counts.groups} 个事项组 · ${counts.tasks} 个步骤</span></div>${template.legalNote ? `<div class="legal-note">${escapeHtml(template.legalNote)}</div>` : '<div class="basis-warning">本模板未附独立法律风险说明，请根据本案材料与现行规则复核。</div>'}<div class="preview-stage-list">${(template.stages || []).map((stage, index) => `<details ${index === 0 ? 'open' : ''}><summary><span>${index + 1}</span><strong>${escapeHtml(stage.name)}${stage.conditional ? '（条件阶段）' : ''}</strong><em>${(stage.groups || []).flatMap((group) => group.tasks || []).length} 项</em></summary><div>${stage.conditionText ? `<p class="group-condition">适用条件：${escapeHtml(stage.conditionText)}</p>` : ''}${(stage.groups || []).map((group) => `<section><h4>${escapeHtml(group.title)}${group.conditional ? '<small>视情况办理</small>' : ''}</h4><ul>${(group.tasks || []).map((task) => `<li>${escapeHtml(task.title)}${task.optional ? '<small>可选</small>' : ''}</li>`).join('')}</ul></section>`).join('')}</div></details>`).join('')}</div>${sourceLinksHtml(template)}</div><div class="modal-actions"><button class="btn" type="button" data-action="close-modal">关闭</button><button class="btn btn-primary" type="button" data-action="new-case-with-template" data-template-id="${escapeHtml(template.id)}">用此模板新建案件</button></div></dialog>`;
    const dialog = document.getElementById('template-preview-dialog');
    dialog.showModal();
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeModal(); });
  }

  function openSaveCaseTemplateModal() {
    const caseItem = selectedCase();
    if (!caseItem) return;
    modalRoot.innerHTML = `<dialog id="save-case-template-dialog"><form id="save-case-template-form"><div class="modal-head"><div><div class="modal-kicker">沉淀办案经验</div><h2>将本案流程保存为模板</h2></div><button class="modal-close" type="button" data-action="close-modal">×</button></div><div class="modal-body"><div class="form-grid"><div class="form-field full"><label>模板名称 <span class="required">*</span></label><input name="name" required maxlength="80" value="${escapeHtml(`${caseItem.name}流程模板`)}" autofocus /></div><div class="form-field"><label>业务类型</label><strong>${escapeHtml(caseItem.caseTypeLabel || categoryName(caseItem.caseType))}</strong><input type="hidden" name="category" value="${escapeHtml(caseItem.caseType || 'custom')}" /></div><div class="form-field full"><label>模板说明</label><textarea name="description" maxlength="300">由“${escapeHtml(caseItem.name)}”的现有流程保存生成，可继续编辑。</textarea></div></div><div class="save-template-hint">将保留原流程的适用角色、范围和核对依据；不会带入本案的任务状态、计划办理日、备注或当事人资料。</div></div><div class="modal-actions"><button class="btn" type="button" data-action="close-modal">取消</button><button class="btn btn-primary" type="submit">保存到我的模板</button></div></form></dialog>`;
    const dialog = document.getElementById('save-case-template-dialog');
    dialog.showModal();
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeModal(); });
    const saveCaseTemplateForm = document.getElementById('save-case-template-form');
    saveCaseTemplateForm.addEventListener('submit', (event) => {
      event.preventDefault();
      event.currentTarget.dataset.submitting = 'true';
      const fields = Object.fromEntries(new FormData(event.currentTarget).entries());
      fields.categoryLabel = categoryName(fields.category);
      const template = model.templateFromCase(caseItem, fields);
      state.customTemplates.push(template);
      closeModal();
      scheduleSave({ immediate: true });
      renderApp();
      showToast('已保存到“我的模板”');
    });
    markModalFormClean(saveCaseTemplateForm);
  }

  function saveTemplateDraft() {
    if (!templateDraft || !templateDraft.stages?.length) {
      showToast('模板至少需要一个阶段', 'error');
      return false;
    }
    const saved = {
      ...model.clone(templateDraft),
      builtIn: false,
      categoryLabel: categoryName(templateDraft.category),
      updatedAt: new Date().toISOString(),
      stages: model.stagesForTemplate(templateDraft.stages)
    };
    const index = state.customTemplates.findIndex((item) => item.id === saved.id);
    if (index >= 0) state.customTemplates[index] = saved;
    else state.customTemplates.unshift(saved);
    templateDraft = model.clone(saved);
    templateDraftBaseline = templateDraftSignature(templateDraft);
    selectedTemplateId = saved.id;
    scheduleSave({ immediate: true });
    renderApp();
    showToast(index >= 0 ? '模板修改已保存' : '新模板已保存');
    return true;
  }

  function showWorkflowDialog({ entity, mode = 'create', stage = null, group = null, task = null }) {
    const isEdit = mode === 'edit';
    const editingTemplate = currentView === 'template-editor';
    const titles = {
      stage: isEdit ? '编辑自定义阶段' : '新增案件阶段',
      group: isEdit ? '编辑自定义事项组' : '新增事项组',
      task: isEdit ? '编辑步骤' : '添加办理步骤'
    };

    let fields = '';
    if (entity === 'stage') {
      fields = `
        <div class="form-field full"><label>阶段名称 <span class="required">*</span></label><input name="name" required maxlength="50" value="${escapeHtml(stage?.name || '')}" placeholder="例如：财产处置、追加分配" autofocus /></div>
        <div class="form-field full"><label class="checkbox-field"><input type="checkbox" name="conditional" ${stage?.conditional ? 'checked' : ''}/><span>这是需要先确认是否适用的条件阶段</span></label></div>
        <div class="form-field full"><label>适用条件说明</label><input name="conditionText" maxlength="200" value="${escapeHtml(stage?.conditionText || '')}" placeholder="例如：一审后需要提起二审时适用" /></div>
        ${isEdit ? '' : `<div class="form-field full"><label>第一个事项组</label><input name="groupTitle" maxlength="80" value="自定义事项" placeholder="例如：处置准备" /></div><div class="form-field full"><label>第一个步骤 <span class="required">*</span></label><input name="firstTaskTitle" required maxlength="120" placeholder="例如：拟定财产处置方案" /></div><div class="form-field full"><label>步骤说明</label><textarea name="firstTaskDetail" maxlength="600" placeholder="可补充材料要求或操作说明"></textarea></div>`}
      `;
    } else if (entity === 'group') {
      fields = `
        <div class="form-field full"><label>事项组名称 <span class="required">*</span></label><input name="title" required maxlength="80" value="${escapeHtml(group?.title || '')}" placeholder="例如：补充财产调查" autofocus /></div>
        <div class="form-field full"><label class="checkbox-field"><input type="checkbox" name="conditional" ${group?.conditional ? 'checked' : ''}/><span>这是视情况办理的事项</span></label></div>
        <div class="form-field full"><label>适用条件说明</label><input name="conditionText" maxlength="200" value="${escapeHtml(group?.conditionText || '')}" placeholder="例如：发现可处置财产时办理" /></div>
        ${isEdit ? '' : `<div class="form-field full"><label>第一个步骤 <span class="required">*</span></label><input name="firstTaskTitle" required maxlength="120" placeholder="填写具体需要完成的工作" /></div><div class="form-field full"><label>步骤说明</label><textarea name="firstTaskDetail" maxlength="600" placeholder="可补充材料要求或操作说明"></textarea></div>`}
      `;
    } else {
      fields = `
        <div class="form-field full"><label>步骤名称 <span class="required">*</span></label><input name="title" required maxlength="120" value="${escapeHtml(task?.title || '')}" placeholder="填写具体需要完成的工作" autofocus /></div>
        <div class="form-field full"><label>详细说明</label><textarea name="detail" maxlength="600" placeholder="可补充材料要求、办理方式或注意事项">${escapeHtml(task?.detail || '')}</textarea></div>
        ${editingTemplate ? '' : `<div class="form-field"><label>计划办理日</label><input name="dueDate" type="date" value="${escapeHtml(task?.dueDate || '')}" /></div>`}
        <div class="form-field"><label class="checkbox-field checkbox-field-spaced"><input type="checkbox" name="optional" ${task?.optional ? 'checked' : ''}/><span>标记为可选步骤</span></label></div>
        ${editingTemplate ? '' : `<div class="form-field full"><label>备注</label><input name="note" maxlength="300" value="${escapeHtml(task?.note || '')}" placeholder="经办情况、材料位置等" /></div>`}
      `;
    }

    modalRoot.innerHTML = `<dialog id="workflow-dialog"><form id="workflow-form"><div class="modal-head"><div><div class="modal-kicker">${editingTemplate ? '编辑流程模板' : '自定义案件流程'}</div><h2>${titles[entity]}</h2></div><button class="modal-close" type="button" data-action="close-modal" aria-label="关闭">×</button></div><div class="modal-body"><div class="form-grid">${fields}</div></div><div class="modal-actions"><button class="btn" type="button" data-action="close-modal">取消</button><button class="btn btn-primary" type="submit">${isEdit ? '保存修改' : '确认添加'}</button></div></form></dialog>`;
    const dialog = document.getElementById('workflow-dialog');
    dialog.dataset.entity = entity;
    dialog.dataset.mode = mode;
    dialog.dataset.stageId = stage?.id || activeStageId || '';
    dialog.dataset.groupId = group?.id || '';
    dialog.dataset.taskId = task?.id || '';
    dialog.showModal();
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeModal(); });
    const workflowForm = document.getElementById('workflow-form');
    workflowForm.addEventListener('submit', handleWorkflowFormSubmit);
    markModalFormClean(workflowForm);
  }

  function handleWorkflowFormSubmit(event) {
    event.preventDefault();
    const dialog = document.getElementById('workflow-dialog');
    const form = event.currentTarget;
    const fields = Object.fromEntries(new FormData(form).entries());
    fields.optional = form.elements.optional?.checked || false;
    fields.conditional = form.elements.conditional?.checked || false;
    const caseItem = activeWorkflowOwner();
    if (!caseItem) return;

    const { entity, mode, stageId, groupId, taskId } = dialog.dataset;
    let success = false;
    if (entity === 'stage') {
      if (mode === 'edit') {
        const stage = model.findStage(caseItem, stageId);
        if (stage?.custom && String(fields.name || '').trim()) {
          stage.name = String(fields.name).trim();
          stage.conditional = fields.conditional;
          stage.conditionText = String(fields.conditionText || '').trim();
          stage.applicability = fields.conditional ? (['included', 'excluded'].includes(stage.applicability) ? stage.applicability : 'undecided') : 'included';
          caseItem.updatedAt = new Date().toISOString();
          success = true;
        }
      } else {
        const stage = model.addStage(caseItem, fields);
        if (stage) { activeStageId = stage.id; success = true; }
      }
    } else if (entity === 'group') {
      if (mode === 'edit') {
        const entry = model.findGroup(caseItem, groupId);
        if (entry?.group.custom && String(fields.title || '').trim()) {
          entry.group.title = String(fields.title).trim();
          entry.group.conditional = fields.conditional;
          entry.group.conditionText = String(fields.conditionText || '').trim();
          entry.group.applicability = fields.conditional ? (['included', 'excluded'].includes(entry.group.applicability) ? entry.group.applicability : 'undecided') : 'included';
          caseItem.updatedAt = new Date().toISOString();
          success = true;
        }
      } else success = Boolean(model.addGroup(caseItem, stageId, fields));
    } else if (entity === 'task') {
      if (mode === 'edit') {
        const entry = model.findTask(caseItem, taskId);
        if (entry && String(fields.title || '').trim()) {
          entry.task.title = String(fields.title).trim();
          entry.task.detail = String(fields.detail || '').trim();
          entry.task.dueDate = fields.dueDate || '';
          entry.task.note = String(fields.note || '').trim();
          entry.task.optional = fields.optional;
          entry.task.updatedAt = new Date().toISOString();
          caseItem.updatedAt = entry.task.updatedAt;
          success = true;
        }
      } else success = Boolean(model.addTask(caseItem, groupId, fields));
    }

    if (!success) return;
    form.dataset.submitting = 'true';
    closeModal();
    if (currentView !== 'template-editor') scheduleSave({ immediate: true });
    renderApp();
    showToast(currentView === 'template-editor' ? '模板草稿已更新，记得保存模板' : (mode === 'edit' ? '修改已保存' : '已添加到本案流程'));
  }

  function dataCenterPanelHtml() {
    if (dataCenterTab === 'activity') {
      return `<section class="data-center-panel" role="tabpanel" aria-label="最近操作"><div class="recovery-section-head"><div><h3>最近操作</h3></div><small>显示最近 20 条；只有没有被后续修改的操作才可以撤销</small></div>${recentActivityHtml()}</section>`;
    }
    if (dataCenterTab === 'deleted') {
      return `<section class="data-center-panel" role="tabpanel" aria-label="最近删除"><div class="recovery-section-head"><div><h3>最近删除</h3></div><small>${state.recycleBin?.cases?.length || 0} / ${model.RECYCLE_BIN_CASE_LIMIT || 50} 个案件</small></div>${recycledCasesHtml()}</section>`;
    }
    return `<section class="data-center-panel backup-center-panel" role="tabpanel" aria-label="完整备份">
      <div id="storage-health-panel">${storageHealthPanelHtml()}</div>
      <div class="backup-overview">
        <div><span>当前台账</span><strong>${state.cases.length}</strong><small>个案件</small></div>
        <div><span>个人模板</span><strong>${(state.customTemplates || []).length}</strong><small>个模板</small></div>
        <div><span>自动保存</span><strong>已开启</strong><small>关闭前会确认保存</small></div>
      </div>
      <div class="backup-primary-card">
        <div><span class="card-eyebrow">完整台账备份</span><h3>保存全部案件资料</h3><p>包含案件、流程步骤、办理状态、备注和个人模板，可以在另一台电脑完整恢复。</p></div>
        <div class="backup-actions"><button class="btn btn-primary" data-action="export-backup">${icon('download')}导出完整备份</button><button class="btn" data-action="inspect-backup">${icon('upload')}从备份恢复</button></div>
      </div>
      <div class="transfer-guide"><div class="transfer-guide-head"><span>换电脑只需三步</span><small>Windows 与 Mac 可以互相恢复</small></div><ol><li><b>1</b><span>在旧电脑导出完整备份</span></li><li><b>2</b><span>把台账备份文件复制到可信设备</span></li><li><b>3</b><span>在新电脑选择“从备份恢复”</span></li></ol></div>
      <div class="backup-secondary-card"><div><h3>Excel 案件清单</h3><p>适合查看、筛选和统计，不包含完整流程，<strong>不能用来恢复台账。</strong></p></div><button class="btn" data-action="export-csv">${icon('export')}导出 Excel 清单</button></div>
      <div class="local-recovery-card"><div class="recovery-section-head"><div><h3>本机恢复点</h3></div><small id="backup-status">正在读取…</small></div><div id="local-backups">正在读取本机恢复点…</div></div>
      <details class="storage-location"><summary>查看本机保存位置</summary><span class="data-path" id="data-path">正在读取…</span></details>
      <p class="backup-privacy-note">数据只保存在这台电脑，不会自动上传。完整备份包含全部案件资料，请保存到可信位置。</p>
    </section>`;
  }

  function openAboutModal(tab = dataCenterTab) {
    dataCenterTab = ['backup', 'activity', 'deleted'].includes(tab) ? tab : 'backup';
    const tabs = [
      ['backup', '完整备份'],
      ['activity', '最近操作'],
      ['deleted', `最近删除${state.recycleBin?.cases?.length ? ` ${state.recycleBin.cases.length}` : ''}`]
    ];
    modalRoot.innerHTML = `<dialog id="about-dialog" class="data-center-dialog"><div class="modal-head"><div><h2>数据与备份</h2></div><button class="modal-close" type="button" data-action="close-modal">×</button></div><div class="data-center-tabs" role="tablist">${tabs.map(([id, label]) => `<button type="button" role="tab" aria-selected="${dataCenterTab === id}" class="${dataCenterTab === id ? 'active' : ''}" data-action="data-center-tab" data-tab="${id}">${label}</button>`).join('')}</div><div class="modal-body about-copy">${dataCenterPanelHtml()}</div><div class="modal-actions"><button class="btn btn-primary" type="button" data-action="close-modal">完成</button></div></dialog>`;
    const dialog = document.getElementById('about-dialog');
    dialog.showModal();
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeModal(); });
    if (dataCenterTab !== 'backup') return;
    const storagePromise = typeof api.getStorageInfo === 'function' ? api.getStorageInfo() : api.getDataPath().then((statePath) => ({ statePath }));
    storagePromise.then((info) => {
      storageInfoCache = info || null;
      const element = document.getElementById('data-path');
      if (element) element.textContent = info?.statePath || '暂时无法读取保存位置';
    }).catch(() => {});
    refreshStorageHealth();
    if (typeof api.listLocalBackups === 'function') api.listLocalBackups().then((items) => renderLocalBackups(Array.isArray(items) ? items : [])).catch(() => renderLocalBackups([]));
    else renderLocalBackups([]);
  }

  function renderLocalBackups(items) {
    const element = document.getElementById('local-backups');
    const status = document.getElementById('backup-status');
    if (!element) return;
    if (!items.length) {
      element.innerHTML = '<div class="recovery-empty">还没有本机恢复点。完成首次保存后，程序会自动保留。</div>';
      if (status) status.textContent = '暂无恢复点';
      return;
    }
    const latest = items[0];
    element.innerHTML = items.slice(0, 5).map((item) => `<div class="local-backup"><div><span>${escapeHtml(item.label || item.createdAt || item.name || item.fileName || '本地恢复点')}</span><small>${Number(item.caseCount ?? item.cases) || 0} 个案件</small></div><button class="btn btn-small" data-action="restore-local-backup" data-backup-id="${escapeHtml(item.id)}">恢复</button></div>`).join('');
    if (status) status.textContent = `最近一次 ${latest.createdAt ? new Date(latest.createdAt).toLocaleString('zh-CN') : ''}`;
  }

  async function openRecoveryScreen(message) {
    appRoot.innerHTML = `<div class="launch-screen recovery-screen"><div class="launch-mark">!</div><h2>台账暂时无法打开</h2><p>${escapeHtml(message)}</p><div class="recovery-notice"><strong>原文件不会被自动覆盖。</strong><p>你可以选择本机恢复点，也可以从以前导出的完整备份恢复。</p></div><div class="recovery-actions"><button class="btn btn-primary" data-action="recovery-import">从完整备份恢复</button></div><div id="startup-backups" class="startup-backups">正在查找本机恢复点…</div></div>`;
    const area = document.getElementById('startup-backups');
    try {
      const items = typeof api.listLocalBackups === 'function' ? await api.listLocalBackups() : [];
      if (!area) return;
      area.innerHTML = items.length ? `<strong>可用本地恢复点</strong>${items.slice(0, 10).map((item) => `<div class="local-backup"><div><span>${escapeHtml(item.label || item.createdAt || item.name || '本地恢复点')}</span><small>${Number(item.caseCount ?? item.cases) || 0} 个案件</small></div><button class="btn btn-small" data-action="recovery-restore" data-backup-id="${escapeHtml(item.id)}">恢复</button></div>`).join('')}` : '<span>没有找到可用的本机恢复点，请选择以前导出的备份文件。</span>';
    } catch (_error) {
      if (area) area.textContent = '暂时无法列出本地恢复点，请选择以前导出的备份文件。';
    }
  }

  function isStorageProtectionError(message) {
    return /系统安全存储|系统密钥|safeStorage|Keychain|钥匙串|DPAPI|encryptString|decryptString/i.test(String(message || ''));
  }

  function openStorageProtectionScreen(message) {
    appRoot.innerHTML = `<div class="launch-screen recovery-screen protection-screen"><div class="launch-mark">↻</div><h2>检测到旧版台账</h2><p>这份台账来自旧版本，需要完成一次升级后才能继续使用。</p><div class="recovery-notice"><strong>原文件不会被覆盖。</strong><p>请允许本次系统授权，然后重新尝试。也可以直接选择以前导出的完整备份。</p></div><details class="legacy-error-details"><summary>查看详细信息</summary><span>${escapeHtml(message)}</span></details><div class="recovery-actions"><button class="btn btn-primary" data-action="retry-initialize">重新尝试</button><button class="btn" data-action="recovery-import">从完整备份恢复</button></div></div>`;
  }

  async function recoverAtStartupFromImport() {
    try {
      const result = await api.inspectBackup();
      if (!result || result.canceled) return;
      const preview = result.preview || result;
      if (!window.confirm(`完整备份中包含 ${Number(preview.caseCount ?? result.cases) || 0} 个案件。恢复后将替换当前台账，是否继续？`)) return;
      const applied = await api.applyBackup(result.token);
      if (!applied?.state) throw new Error('恢复结果中没有台账数据');
      state = model.normalizeState(applied.state);
      saveMessage = `已恢复 · ${formatClock()}`;
      currentView = 'dashboard';
      renderApp();
      showToast('已从完整备份恢复台账');
    } catch (error) {
      await openRecoveryScreen(`恢复失败：${error.message}`);
    }
  }

  async function recoverAtStartupFromLocal(backupId) {
    if (!backupId || !window.confirm('确认使用这个本地恢复点替换当前损坏的主台账吗？')) return;
    try {
      const result = await api.restoreLocalBackup(backupId);
      if (!result?.state) throw new Error('恢复结果中没有台账数据');
      state = model.normalizeState(result.state);
      saveMessage = `已恢复 · ${formatClock()}`;
      currentView = 'dashboard';
      renderApp();
      showToast('已从本地恢复点恢复台账');
    } catch (error) {
      await openRecoveryScreen(`恢复失败：${error.message}`);
    }
  }

  async function exportBackup() {
    try {
      const result = await api.exportBackup(state);
      if (!result.canceled) showToast('完整备份已导出，请妥善保管', '', result.revealToken && typeof api.showExportInFolder === 'function'
        ? { name: 'show-export-in-folder', label: '打开所在文件夹', data: { revealToken: result.revealToken } }
        : null);
    } catch (error) {
      showToast(`导出失败：${error.message}`, 'error');
    }
  }

  function formatFileSize(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value} B`;
    if (value < 1048576) return `${Math.round(value / 1024)} KB`;
    return `${(value / 1048576).toFixed(1)} MB`;
  }

  async function inspectBackup() {
    if (typeof api.inspectBackup !== 'function') {
      showToast('当前版本不支持安全的备份预检，请升级后重试', 'error');
      return;
    }
    try {
      const result = await api.inspectBackup();
      if (!result || result.canceled) return;
      pendingBackupToken = result.token;
      const preview = result.preview || {
        fileName: result.filePath ? String(result.filePath).split(/[\\/]/).pop() : '台账备份',
        exportedAt: result.createdAt || '',
        caseCount: result.cases,
        templateCount: result.customTemplates,
        stateVersion: result.version,
        sizeBytes: result.size,
        warnings: result.envelope ? [] : ['这是旧版备份，未包含新版完整性信息；导入后会自动升级。']
      };
      const warnings = Array.isArray(preview.warnings) ? preview.warnings : [];
      modalRoot.innerHTML = `<dialog id="backup-preview-dialog"><div class="modal-head"><div><div class="modal-kicker">恢复前检查</div><h2>确认完整备份</h2></div><button class="modal-close" type="button" data-action="close-modal">×</button></div><div class="modal-body"><div class="backup-preview-grid"><div><label>文件</label><strong>${escapeHtml(preview.fileName || '完整备份')}</strong></div><div><label>导出时间</label><strong>${escapeHtml(preview.exportedAt ? new Date(preview.exportedAt).toLocaleString('zh-CN') : '未记录')}</strong></div><div><label>案件</label><strong>${Number(preview.caseCount) || 0} 个</strong></div><div><label>个人模板</label><strong>${Number(preview.templateCount) || 0} 个</strong></div><div><label>数据版本</label><strong>v${Number(preview.stateVersion) || '—'}</strong></div><div><label>文件大小</label><strong>${formatFileSize(preview.sizeBytes)}</strong></div></div>${warnings.length ? `<div class="backup-warnings"><strong>检查提示</strong>${warnings.map((warning) => `<p>${escapeHtml(typeof warning === 'string' ? warning : warning.message)}</p>`).join('')}</div>` : '<div class="backup-check-ok">✓ 完整备份检查通过，可以恢复</div>'}<div class="recovery-notice"><strong>恢复后将替换当前台账</strong><p>程序会先保存当前数据的本机恢复点，再使用这份完整备份。</p></div></div><div class="modal-actions"><button class="btn" type="button" data-action="close-modal">取消</button><button class="btn btn-danger" type="button" data-action="apply-backup">保存当前数据并恢复</button></div></dialog>`;
      const dialog = document.getElementById('backup-preview-dialog');
      dialog.showModal();
      dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeModal(); });
    } catch (error) {
      showToast(`备份预检失败：${error.message}`, 'error');
    }
  }

  async function applyInspectedBackup() {
    if (!pendingBackupToken || typeof api.applyBackup !== 'function') return;
    try {
      await settleSavesBeforeRecovery();
      const result = await api.applyBackup(pendingBackupToken);
      if (!result?.ok || !result.state) throw new Error('未能读取恢复后的台账');
      state = model.normalizeState(result.state);
      pendingBackupToken = null;
      selectedCaseId = null;
      activeStageId = null;
      currentView = 'dashboard';
      closeModal();
      renderApp();
      showToast(`已恢复 ${state.cases.length} 个案件，导入前数据已保存为本地恢复点`);
    } catch (error) {
      showToast(`应用备份失败：${error.message}`, 'error');
    } finally {
      recoveryInProgress = false;
    }
  }

  async function restoreLocalBackup(backupId) {
    if (!backupId || typeof api.restoreLocalBackup !== 'function') return;
    if (!window.confirm('恢复该本地备份将替换当前台账，程序会先保留当前数据的恢复点。是否继续？')) return;
    try {
      await settleSavesBeforeRecovery();
      const result = await api.restoreLocalBackup(backupId);
      if (!result?.ok || !result.state) throw new Error('未能读取恢复后的台账');
      state = model.normalizeState(result.state);
      selectedCaseId = null;
      activeStageId = null;
      currentView = 'dashboard';
      closeModal();
      renderApp();
      showToast(`已从本地恢复点恢复 ${state.cases.length} 个案件`);
    } catch (error) {
      showToast(`恢复失败：${error.message}`, 'error');
    } finally {
      recoveryInProgress = false;
    }
  }

  function csvCell(value) {
    const text = typeof model.csvSafeValue === 'function' ? model.csvSafeValue(value) : String(value ?? '');
    return `"${text.replaceAll('"', '""')}"`;
  }

  async function exportCasesCsv() {
    if (!window.confirm('即将导出 Excel 案件清单，包含案名、案号、客户、办理机关和承办人。该清单只能查看和统计，不能恢复台账。是否继续？')) return;
    const rows = [['案件名称', '业务类型', '模板角色', '当事人/客户', '案号/项目编号', '办理机关', '承办人', '实际阶段', '当前/建议阶段', '下一事项', '清单状态', '当前待确认条件', '处理进度', '完成率', '不适用', '非委托范围', '已由他人完成', '待复核', '案件关键日期', '关键日期状态', '是否归档']];
    for (const caseItem of state.cases) {
      const stats = model.caseStats(caseItem);
      const progress = progressValues(stats);
      const work = caseWorkState(caseItem, stats);
      const actualStage = actualStageFor(caseItem, stats);
      const focusStage = actualStage || stats.focusStage || stats.nextActionStage || stats.nextPendingStage || stats.currentStage;
      const next = nextTaskSummary(caseItem, stats);
      const focusedConditions = Number.isFinite(stats.focusedUnresolvedCount) ? stats.focusedUnresolvedCount : undecidedWorkflowItems(caseItem).length;
      rows.push([
        caseItem.name,
        caseItem.caseTypeLabel || categoryName(caseItem.caseType),
        caseItem.templateSnapshot?.role || '',
        caseItem.companyName,
        caseItem.caseNumber,
        caseItem.court,
        caseItem.manager,
        actualStage?.name || '',
        focusStage?.name || '',
        next.title || '',
        caseWorkLabel(caseItem, stats),
        focusedConditions,
        `${progress.handledPercent}%`,
        work.allNotApplicable ? '—' : `${progress.completionPercent}%`,
        stats.notApplicable || 0,
        stats.outOfScope || 0,
        stats.completedElsewhere || 0,
        progress.review,
        caseItem.importantDate,
        caseItem.importantDate ? (caseItem.importantDateHandledAt ? '已处理' : '待处理') : '未设置',
        caseItem.archived ? '是' : '否'
      ]);
    }
    const content = `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
    try {
      const result = await api.exportText({ title: '导出案件清单', defaultName: `法律案件清单-${todayInputValue()}.csv`, content, filters: [{ name: 'CSV 表格', extensions: ['csv'] }] });
      if (!result.canceled) showToast('Excel 案件清单已导出，不能用于恢复台账', '', result.revealToken && typeof api.showExportInFolder === 'function'
        ? { name: 'show-export-in-folder', label: '打开所在文件夹', data: { revealToken: result.revealToken } }
        : null);
    } catch (error) {
      showToast(`导出失败：${error.message}`, 'error');
    }
  }

  function updateTaskField(target, field) {
    const caseItem = state.cases.find((item) => item.id === target.dataset.caseId);
    const entry = caseItem && model.findTask(caseItem, target.dataset.taskId);
    if (!entry) return;
    if (entry.task[field] === target.value) return;
    entry.task[field] = target.value;
    entry.task.updatedAt = new Date().toISOString();
    caseItem.updatedAt = entry.task.updatedAt;
    scheduleSave();
  }

  function syncVisibleTaskNotes() {
    for (const target of document.querySelectorAll('.task-note[data-case-id][data-task-id]')) {
      const caseItem = state.cases.find((item) => item.id === target.dataset.caseId);
      const entry = caseItem && model.findTask(caseItem, target.dataset.taskId);
      if (!entry || entry.task.note === target.value) continue;
      entry.task.note = target.value;
      entry.task.updatedAt = new Date().toISOString();
      caseItem.updatedAt = entry.task.updatedAt;
      touchState();
      changeRevision += 1;
    }
  }

  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;

    if (action === 'nav') {
      const destination = target.dataset.view;
      if (currentView === 'template-editor' && destination !== 'template-editor' && !leaveTemplateEditor(destination)) return;
      else currentView = destination;
      selectedCaseId = null;
      activeStageId = null;
      renderApp();
    } else if (action === 'new-case') openCaseModal();
    else if (action === 'new-case-with-template') {
      const templateId = target.dataset.templateId;
      if (!closeModal()) return;
      openCaseModal(null, templateId);
    }
    else if (action === 'create-template') openTemplateFormModal('create');
    else if (action === 'preview-template') openTemplatePreviewModal(allTemplates().find((item) => item.id === target.dataset.templateId));
    else if (action === 'customize-template') openTemplateEditor(builtInTemplates.find((item) => item.id === target.dataset.templateId), false);
    else if (action === 'edit-template') openTemplateEditor((state.customTemplates || []).find((item) => item.id === target.dataset.templateId), true);
    else if (action === 'edit-template-info') openTemplateFormModal('edit');
    else if (action === 'save-template') saveTemplateDraft();
    else if (action === 'cancel-template-edit') { if (leaveTemplateEditor('templates')) renderApp(); }
    else if (action === 'delete-template') {
      const template = (state.customTemplates || []).find((item) => item.id === target.dataset.templateId);
      if (!template || !window.confirm(`确定删除自定义模板“${template.name}”吗？已经用它创建的案件不会受影响。`)) return;
      let result;
      if (typeof model.deleteCustomTemplateWithActivity === 'function') result = model.deleteCustomTemplateWithActivity(state, template.id);
      else {
        const index = state.customTemplates.findIndex((item) => item.id === template.id);
        state.customTemplates.splice(index, 1);
        result = { ok: true };
        showLocalUndoToast('自定义模板已删除', () => state.customTemplates.splice(Math.min(index, state.customTemplates.length), 0, template));
      }
      if (!result?.ok) { showToast('自定义模板删除失败', 'error'); return; }
      scheduleSave({ immediate: true });
      renderApp();
      if (result.event) showUndoToast('自定义模板已删除', result);
    }
    else if (action === 'open-template-library') { if (!closeModal()) return; currentView = 'templates'; selectedCaseId = null; activeStageId = null; renderApp(); }
    else if (action === 'save-case-template') openSaveCaseTemplateModal();
    else if (action === 'open-case') openCase(target.dataset.caseId);
    else if (action === 'open-reminder') openCase(target.dataset.caseId, target.dataset.stageId, target.dataset.taskId);
    else if (action === 'open-todo') openCase(target.dataset.caseId, target.dataset.stageId, target.dataset.taskId);
    else if (action === 'set-case-date-status') {
      const caseItem = state.cases.find((item) => item.id === target.dataset.caseId);
      const handled = target.dataset.handled === 'true';
      if (!caseItem || typeof model.changeCaseImportantDateStatus !== 'function') return;
      const result = model.changeCaseImportantDateStatus(state, caseItem.id, handled);
      if (!result?.ok) { showToast('案件关键日期状态更新失败', 'error'); return; }
      scheduleSave({ immediate: true });
      renderApp();
      showUndoToast(handled ? '案件关键日期已标记为已处理' : '案件关键日期已恢复提醒', result);
    }
    else if (action === 'open-todo-filter') { currentView = 'todos'; todoFilter = target.dataset.filter || 'workday'; todoPage = 1; selectedCaseId = null; activeStageId = null; renderApp(); }
    else if (action === 'todo-filter') { todoFilter = target.dataset.filter || 'all'; todoPage = 1; renderApp(); }
    else if (action === 'todo-page') { todoPage = Math.max(1, Number(target.dataset.page) || 1); renderApp(); }
    else if (action === 'data-center') { dataCenterTab = 'backup'; openAboutModal('backup'); }
    else if (action === 'data-center-tab') openAboutModal(target.dataset.tab);
    else if (action === 'show-export-in-folder') {
      if (target.dataset.revealToken && typeof api.showExportInFolder === 'function') {
        api.showExportInFolder(target.dataset.revealToken).catch((error) => showToast(`无法打开文件夹：${error.message}`, 'error'));
      }
    }
    else if (action === 'undo-activity') {
      const result = typeof model.undoActivity === 'function' ? model.undoActivity(state, target.dataset.activityId) : { ok: false };
      if (!result?.ok) { showToast('这项操作之后已有新的修改，无法安全撤销', 'error'); return; }
      scheduleSave({ immediate: true });
      renderApp();
      showToast('已撤销上一项操作');
    }
    else if (action === 'undo-local-delete') {
      const restore = localUndoActions.get(target.dataset.undoId);
      if (!restore) { showToast('这项撤销已经失效', 'error'); return; }
      localUndoActions.delete(target.dataset.undoId);
      restore();
      if (currentView !== 'template-editor') scheduleSave({ immediate: true });
      renderApp();
      showToast('已撤销删除');
    }
    else if (action === 'restore-recycled-case') {
      const result = typeof model.restoreRecycledCase === 'function' ? model.restoreRecycledCase(state, target.dataset.trashId) : { ok: false };
      if (!result?.ok) {
        showToast(result?.reason === 'CASE_ID_CONFLICT' ? '当前台账已有同一案件，无法恢复' : '案件恢复失败', 'error');
        return;
      }
      scheduleSave({ immediate: true });
      openAboutModal('deleted');
      showToast(`已恢复“${result.caseItem?.name || '案件'}”`);
    }
    else if (action === 'purge-recycled-case') {
      const recycled = (state.recycleBin?.cases || []).find((item) => item.id === target.dataset.trashId);
      const name = recycled?.caseSnapshot?.name || '该案件';
      if (!recycled || !window.confirm(`永久删除“${name}”吗？此操作不能通过最近操作撤销。`)) return;
      if (!window.confirm(`请再次确认：永久删除后，只能从以前导出的备份中恢复“${name}”。是否继续？`)) return;
      const result = model.purgeRecycledCase(state, recycled.id);
      if (!result?.ok) { showToast('永久删除失败', 'error'); return; }
      scheduleSave({ immediate: true });
      openAboutModal('deleted');
      showToast(`已永久删除“${name}”`);
    }
    else if (action === 'inspect-backup') inspectBackup();
    else if (action === 'apply-backup') applyInspectedBackup();
    else if (action === 'restore-local-backup') restoreLocalBackup(target.dataset.backupId);
    else if (action === 'recovery-import') recoverAtStartupFromImport();
    else if (action === 'recovery-restore') recoverAtStartupFromLocal(target.dataset.backupId);
    else if (action === 'retry-initialize') initialize();
    else if (action === 'open-first-condition') { activeStageId = target.dataset.stageId; renderApp(); }
    else if (action === 'clear-case-filters') { searchQuery = ''; caseFilter = 'all'; caseTypeFilter = 'all'; renderApp(); }
    else if (action === 'open-case-search-result') {
      activeStageId = target.dataset.stageId;
      const taskId = target.dataset.taskId;
      caseTaskSearchQuery = '';
      renderApp();
      revealTask(taskId);
    }
    else if (action === 'advance-actual-stage') {
      const caseItem = selectedCase();
      const stage = caseItem && getStage(caseItem, target.dataset.stageId);
      if (!caseItem || !stage || typeof model.setActualStage !== 'function' || !model.setActualStage(caseItem, stage.id)) return;
      activeStageId = stage.id;
      scheduleSave({ immediate: true });
      renderApp();
      showToast(`实际办理阶段已切换为“${stage.name}”`);
    }
    else if (action === 'review-next-stage') {
      activeStageId = target.dataset.stageId;
      renderApp();
      document.querySelector('.stage-content')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    else if (action === 'back-to-cases') { caseTaskSearchQuery = ''; currentView = 'cases'; selectedCaseId = null; activeStageId = null; renderApp(); }
    else if (action === 'select-stage') { activeStageId = target.dataset.stageId; renderApp(); }
    else if (action === 'edit-case') openCaseModal(selectedCase());
    else if (action === 'add-stage') showWorkflowDialog({ entity: 'stage' });
    else if (action === 'edit-stage') {
      const stage = model.findStage(activeWorkflowOwner(), target.dataset.stageId);
      if (stage?.custom) showWorkflowDialog({ entity: 'stage', mode: 'edit', stage });
    } else if (action === 'delete-stage') {
      const caseItem = activeWorkflowOwner();
      const stage = model.findStage(caseItem, target.dataset.stageId);
      if (!stage?.custom || !window.confirm(`确定删除自定义阶段“${stage.name}”及其中全部事项吗？`)) return;
      let result;
      if (currentView === 'template-editor') {
        const index = caseItem.stages.findIndex((item) => item.id === stage.id);
        const snapshot = model.clone(stage);
        result = { ok: model.deleteCustomStage(caseItem, stage.id) };
        if (result.ok) showLocalUndoToast('模板阶段已删除', () => caseItem.stages.splice(Math.min(index, caseItem.stages.length), 0, snapshot));
      } else if (typeof model.deleteCustomStageWithActivity === 'function') result = model.deleteCustomStageWithActivity(state, caseItem.id, stage.id);
      else result = { ok: model.deleteCustomStage(caseItem, stage.id) };
      if (!result?.ok) { showToast('自定义阶段删除失败', 'error'); return; }
      const nextStats = currentView === 'template-editor' ? null : model.caseStats(caseItem);
      activeStageId = currentView === 'template-editor' ? caseItem.stages?.[0]?.id : (nextStats.actualStage?.id || nextStats.focusStage?.id || nextStats.nextActionStage?.id || nextStats.nextPendingStage?.id || nextStats.currentStage?.id || caseItem.stages?.[0]?.id);
      if (currentView !== 'template-editor') scheduleSave({ immediate: true });
      renderApp();
      if (result.event) showUndoToast('自定义阶段已删除', result);
    } else if (action === 'add-group') {
      const stage = model.findStage(activeWorkflowOwner(), target.dataset.stageId);
      if (stage && (currentView === 'template-editor' || isStageEffective(stage))) showWorkflowDialog({ entity: 'group', stage });
    } else if (action === 'edit-group') {
      const entry = model.findGroup(activeWorkflowOwner(), target.dataset.groupId);
      if (entry?.group.custom) showWorkflowDialog({ entity: 'group', mode: 'edit', stage: entry.stage, group: entry.group });
    } else if (action === 'delete-group') {
      const caseItem = activeWorkflowOwner();
      const entry = model.findGroup(caseItem, target.dataset.groupId);
      if (!entry?.group.custom || !window.confirm(`确定删除自定义事项组“${entry.group.title}”吗？`)) return;
      let result;
      if (currentView === 'template-editor') {
        const index = entry.stage.groups.findIndex((item) => item.id === entry.group.id);
        const stageId = entry.stage.id;
        const snapshot = model.clone(entry.group);
        result = { ok: model.deleteCustomGroup(caseItem, entry.group.id) };
        if (result.ok) showLocalUndoToast('模板事项组已删除', () => {
          const parent = model.findStage(caseItem, stageId);
          if (parent) parent.groups.splice(Math.min(index, parent.groups.length), 0, snapshot);
        });
      } else if (typeof model.deleteCustomGroupWithActivity === 'function') result = model.deleteCustomGroupWithActivity(state, caseItem.id, entry.group.id);
      else result = { ok: model.deleteCustomGroup(caseItem, entry.group.id) };
      if (!result?.ok) { showToast('自定义事项组删除失败', 'error'); return; }
      if (currentView !== 'template-editor') scheduleSave({ immediate: true });
      renderApp();
      if (result.event) showUndoToast('自定义事项组已删除', result);
    } else if (action === 'add-task') {
      const entry = model.findGroup(activeWorkflowOwner(), target.dataset.groupId);
      if (entry && (currentView === 'template-editor' || isGroupEffective(entry.stage, entry.group))) showWorkflowDialog({ entity: 'task', stage: entry.stage, group: entry.group });
    } else if (action === 'edit-task') {
      const entry = model.findTask(activeWorkflowOwner(), target.dataset.taskId);
      if (entry) showWorkflowDialog({ entity: 'task', mode: 'edit', stage: entry.stage, group: entry.group, task: entry.task });
    } else if (action === 'delete-task') {
      const caseItem = activeWorkflowOwner();
      const entry = model.findTask(caseItem, target.dataset.taskId);
      if (!entry?.task.custom || !window.confirm(`确定删除自定义步骤“${entry.task.title}”吗？`)) return;
      let result;
      if (currentView === 'template-editor') {
        const index = entry.group.tasks.findIndex((item) => item.id === entry.task.id);
        const groupId = entry.group.id;
        const snapshot = model.clone(entry.task);
        result = { ok: model.deleteCustomTask(caseItem, entry.task.id) };
        if (result.ok) showLocalUndoToast('模板步骤已删除', () => {
          const parent = model.findGroup(caseItem, groupId)?.group;
          if (parent) parent.tasks.splice(Math.min(index, parent.tasks.length), 0, snapshot);
        });
      } else if (typeof model.deleteCustomTaskWithActivity === 'function') result = model.deleteCustomTaskWithActivity(state, caseItem.id, entry.task.id);
      else result = { ok: model.deleteCustomTask(caseItem, entry.task.id) };
      if (!result?.ok) { showToast('自定义步骤删除失败', 'error'); return; }
      if (currentView !== 'template-editor') scheduleSave({ immediate: true });
      renderApp();
      if (result.event) showUndoToast('自定义步骤已删除', result);
    }
    else if (action === 'close-modal') closeModal();
    else if (action === 'about') openAboutModal();
    else if (action === 'export-backup') exportBackup();
    else if (action === 'export-csv') exportCasesCsv();
    else if (action === 'toggle-archive') {
      const caseItem = selectedCase();
      caseItem.archived = !caseItem.archived;
      caseItem.updatedAt = new Date().toISOString();
      scheduleSave({ immediate: true });
      renderApp();
      showToast(caseItem.archived ? '案件已归档' : '案件已取消归档');
    } else if (action === 'delete-case') {
      const caseId = document.getElementById('case-dialog')?.dataset.caseId;
      const caseItem = state.cases.find((item) => item.id === caseId);
      if (!caseItem || !window.confirm(`将“${caseItem.name}”移至最近删除吗？之后可以在“数据与备份”中恢复。`)) return;
      const result = typeof model.moveCaseToRecycleBin === 'function' ? model.moveCaseToRecycleBin(state, caseId) : { ok: false };
      if (!result?.ok) {
        showToast(result?.reason === 'RECYCLE_BIN_FULL' ? '最近删除已满，请先恢复或永久删除其中的案件' : '未能移至最近删除', 'error');
        return;
      }
      selectedCaseId = null;
      activeStageId = null;
      currentView = 'cases';
      closeModal({ force: true });
      scheduleSave({ immediate: true });
      renderApp();
      showUndoToast('案件已移至最近删除', result);
    } else if (action === 'complete-group') {
      const caseItem = selectedCase();
      const entry = caseItem && model.findGroup(caseItem, target.dataset.groupId);
      const openCount = entry ? progressValues(model.groupStats(entry.group)).open : 0;
      if (!openCount || !window.confirm(`将该事项组中 ${openCount} 个待办或待复核任务标记为已完成吗？\n\n已设为不适用、非委托范围或由他人完成的任务不会改动，完成后可以撤销。`)) return;
      const result = model.changeGroupStatus(state, caseItem?.id, target.dataset.groupId, model.STATUS.DONE);
      if (!result?.ok) return;
      scheduleSave({ immediate: true });
      renderApp();
      showUndoToast('事项组中的开放任务已标记完成', result);
    }
  });

  document.addEventListener('change', (event) => {
    const target = event.target;
    if (target.matches('.task-checkbox')) {
      const caseItem = state.cases.find((item) => item.id === target.dataset.caseId);
      if (!caseItem) return;
      const beforeStageId = (model.caseStats(caseItem).nextPendingStage || model.caseStats(caseItem).currentStage)?.id;
      const result = model.changeTaskStatus(state, caseItem.id, target.dataset.taskId, target.checked ? model.STATUS.DONE : model.STATUS.PENDING);
      if (!result?.ok) { renderApp(); return; }
      const afterStage = model.caseStats(caseItem).nextPendingStage || model.caseStats(caseItem).currentStage;
      let message = target.checked ? '任务已标记完成' : '任务已恢复为待办理';
      if (target.checked && beforeStageId === activeStageId && afterStage?.id && afterStage.id !== beforeStageId) {
        message = `本阶段清单已处理；下一待处理阶段：${afterStage.name}`;
      }
      scheduleSave();
      renderApp();
      showUndoToast(message, result);
    } else if (target.matches('.task-status-select')) {
      const caseItem = state.cases.find((item) => item.id === target.dataset.caseId);
      if (!caseItem) return;
      const result = model.changeTaskStatus(state, caseItem.id, target.dataset.taskId, target.value);
      if (!result?.ok) { renderApp(); return; }
      scheduleSave();
      renderApp();
      showUndoToast('任务状态已更新', result);
    } else if (target.matches('.stage-applicability')) {
      const caseItem = state.cases.find((item) => item.id === target.dataset.caseId) || selectedCase();
      if (!caseItem || typeof model.changeStageApplicability !== 'function') return;
      const stage = model.findStage(caseItem, target.dataset.stageId);
      const oldValue = applicabilityOf(stage);
      if (target.value === 'excluded' && oldValue === 'included') {
        const affected = (stage?.groups || []).flatMap((group) => group.tasks || []).filter((task) => task.status !== (model.STATUS.PENDING || 'pending') || task.dueDate || task.note).length;
        if (affected && !window.confirm(`本阶段已有 ${affected} 项办理记录。设为不适用后，这些记录会保留，但不再计入待办、计划和进度。是否继续？`)) { target.value = oldValue; return; }
      }
      const result = model.changeStageApplicability(state, caseItem.id, target.dataset.stageId, target.value);
      if (!result?.ok) { renderApp(); return; }
      scheduleSave();
      renderApp();
      showUndoToast(`“${stage?.name || '条件阶段'}”已设为${applicabilityLabel(target.value)}`, result);
    } else if (target.matches('.group-applicability')) {
      const caseItem = state.cases.find((item) => item.id === target.dataset.caseId) || selectedCase();
      if (!caseItem || typeof model.changeGroupApplicability !== 'function') return;
      const entry = model.findGroup(caseItem, target.dataset.groupId);
      const oldValue = applicabilityOf(entry?.group);
      if (target.value === 'excluded' && oldValue === 'included') {
        const affected = (entry?.group.tasks || []).filter((task) => task.status !== (model.STATUS.PENDING || 'pending') || task.dueDate || task.note).length;
        if (affected && !window.confirm(`本事项组已有 ${affected} 项办理记录。设为不适用后，记录会保留但不再计入进度和计划。是否继续？`)) { target.value = oldValue; return; }
      }
      const result = model.changeGroupApplicability(state, caseItem.id, target.dataset.groupId, target.value);
      if (!result?.ok) { renderApp(); return; }
      scheduleSave();
      renderApp();
      showUndoToast(`“${entry?.group.title || '条件事项组'}”已设为${applicabilityLabel(target.value)}`, result);
    } else if (target.id === 'actual-stage-select') {
      const caseItem = selectedCase();
      if (!caseItem || typeof model.setActualStage !== 'function') return;
      model.setActualStage(caseItem, target.value || null);
      if (target.value) activeStageId = target.value;
      scheduleSave();
      renderApp();
    } else if (target.matches('.task-date')) {
      const taskId = target.dataset.taskId;
      const caseId = target.dataset.caseId;
      updateTaskField(target, 'dueDate');
      renderApp();
      window.requestAnimationFrame(() => {
        const input = document.querySelector(`.task-date[data-case-id="${CSS.escape(caseId)}"][data-task-id="${CSS.escape(taskId)}"]`);
        const details = input?.closest('.task-more, .todo-quick-record');
        if (details) details.open = true;
        input?.focus({ preventScroll: true });
      });
    } else if (target.matches('.task-note')) updateTaskField(target, 'note');
    else if (target.id === 'case-filter') { caseFilter = target.value; renderApp(); }
    else if (target.id === 'case-type-filter') { caseTypeFilter = target.value; renderApp(); }
    else if (target.id === 'todo-case-filter') { todoCaseFilter = target.value; todoPage = 1; renderApp(); }
    else if (target.id === 'todo-type-filter') { todoTypeFilter = target.value; todoPage = 1; renderApp(); }
    else if (target.id === 'todo-owner-filter') { todoOwnerFilter = target.value; todoPage = 1; renderApp(); }
  });

  document.addEventListener('input', (event) => {
    const target = event.target;
    if (target.matches('.task-note')) {
      updateTaskField(target, 'note');
      return;
    }
    if (target.id === 'case-task-search') {
      caseTaskSearchQuery = target.value;
      const value = caseTaskSearchQuery;
      window.clearTimeout(target._searchTimer);
      target._searchTimer = window.setTimeout(() => {
        if (caseTaskSearchQuery === value) {
          renderApp();
          const search = document.getElementById('case-task-search');
          if (search) { search.focus(); search.setSelectionRange(search.value.length, search.value.length); }
        }
      }, 140);
      return;
    }
    if (target.id !== 'global-search') return;
    searchQuery = target.value;
    const value = searchQuery;
    window.clearTimeout(target._searchTimer);
    target._searchTimer = window.setTimeout(() => {
      if (searchQuery === value) {
        renderApp();
        const search = document.getElementById('global-search');
        if (search) { search.focus(); search.setSelectionRange(search.value.length, search.value.length); }
      }
    }, 160);
  });

  document.addEventListener('keydown', (event) => {
    const reminder = event.target.closest?.('.reminder-item[data-action]');
    if (reminder && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      openCase(reminder.dataset.caseId, reminder.dataset.stageId, reminder.dataset.taskId);
    }
  });

  async function initialize() {
    appRoot.innerHTML = '<div class="launch-screen"><div class="launch-mark">案</div><div id="launch-status">正在打开案件台账…</div></div>';
    const openingWaitTimer = window.setTimeout(() => {
      const status = document.getElementById('launch-status');
      if (status) status.textContent = '数据较多，正在继续读取…';
    }, 1200);
    try {
      const stored = await api.loadState();
      const storedVersion = Number(stored?.version) || 0;
      state = model.normalizeState(stored);
      persistedRevision = changeRevision;
      if (stored && storedVersion < model.CURRENT_STATE_VERSION) {
        await api.saveState(state);
        saveMessage = `已更新案件模板 · ${formatClock()}`;
      }
      const [storageInfo, storageHealth] = await Promise.all([
        typeof api.getStorageInfo === 'function' ? api.getStorageInfo().catch(() => null) : Promise.resolve(null),
        typeof api.getStorageHealth === 'function' ? api.getStorageHealth().catch(() => null) : Promise.resolve(null)
      ]);
      storageInfoCache = storageInfo;
      storageHealthCache = storageHealth;
      renderApp();
    } catch (error) {
      if (isStorageProtectionError(error.message)) openStorageProtectionScreen(error.message);
      else await openRecoveryScreen(error.message);
    } finally {
      window.clearTimeout(openingWaitTimer);
    }
  }

  if (typeof api.onPrepareClose === 'function') api.onPrepareClose(async () => {
    const openForm = modalRoot.querySelector('dialog[open] form');
    if (modalFormHasUnsavedChanges(openForm)) {
      throw new Error('当前窗口还有尚未保存的内容。请先保存或取消当前窗口，再退出程序。');
    }
    syncVisibleTaskNotes();
    if (templateDraftIsDirty() && !saveTemplateDraft()) {
      throw new Error('当前模板没有有效阶段。请先新增阶段并保存模板，或返回模板库放弃草稿后再退出。');
    }
    await flushPendingSave();
  });

  initialize();
})();
