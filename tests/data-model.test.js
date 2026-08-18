const test = require('node:test');
const assert = require('node:assert/strict');

const model = require('../src/data-model');
const { template } = require('../src/workflow-template');
const { templates: additionalTemplates } = require('../src/additional-templates');

test('built-in workflows instantiate independently', () => {
  const first = model.createCase({ name: '甲公司案' }, template);
  const second = model.createCase({ name: '乙公司案' }, template);
  assert.equal(first.stages.length, 15);
  assert.equal(model.flattenTasks(first).length, 207);
  model.setTaskStatus(first, 'appointment-oa-filing', model.STATUS.DONE);
  assert.equal(model.findTask(first, 'appointment-oa-filing').task.status, model.STATUS.DONE);
  assert.equal(model.findTask(second, 'appointment-oa-filing').task.status, model.STATUS.PENDING);
  assert.equal(additionalTemplates.length, 7);
});

test('legacy over-specific titles migrate without retaining their private wording', () => {
  const legacy = model.createEmptyState();
  legacy.version = 3;
  const caseItem = model.createCase({ name: '旧版迁移案' }, template);
  caseItem.stages[0].groups[0].title = '发函给旧式方式法院';
  legacy.cases.push(caseItem);

  const migrated = model.normalizeState(legacy);
  assert.equal(migrated.cases[0].stages[0].groups[0].title, '发函给法院');

  const current = model.createEmptyState();
  current.cases.push(model.createCase({ name: '当前版本案' }, template));
  current.cases[0].stages[0].groups[0].title = '发函给自定义法院';
  assert.equal(model.normalizeState(current).cases[0].stages[0].groups[0].title, '发函给自定义法院');
});

test('effective stage statistics exclude undecided and excluded conditional groups', () => {
  const caseItem = model.createCase({ name: '条件口径案' }, {
    id: 'stats-template', name: '统计模板', category: 'custom', categoryLabel: '自定义', stages: [{
      id: 'stage', name: '阶段', groups: [
        { id: 'included', title: '必办', tasks: [{ id: 'a', title: 'A' }] },
        { id: 'conditional', title: '条件', conditional: true, tasks: [{ id: 'b', title: 'B' }, { id: 'c', title: 'C' }] }
      ]
    }]
  });
  const stage = caseItem.stages[0];
  assert.equal(model.stageStats(stage).total, 3);
  const effective = model.stageStats(stage, { effectiveOnly: true });
  assert.equal(effective.total, 1);
  assert.equal(effective.rawTotal, 3);
  assert.equal(effective.unresolvedGroupCount, 1);
  assert.equal(model.setGroupApplicability(caseItem, 'conditional', model.APPLICABILITY.INCLUDED), true);
  assert.equal(model.stageStats(stage, { effectiveOnly: true }).total, 3);
});

test('work states distinguish current clearance from whole-case completion', () => {
  const caseItem = model.createCase({ name: '分支流程案' }, {
    id: 'work-state-template', name: '工作状态', category: 'custom', categoryLabel: '自定义', stages: [
      { id: 'current', name: '当前', groups: [{ id: 'current-group', title: '当前事项', tasks: [{ id: 'current-task', title: '当前任务' }] }] },
      { id: 'future', name: '后续条件', conditional: true, conditionText: '视情况', groups: [{ id: 'future-group', title: '后续事项', tasks: [{ id: 'future-task', title: '后续任务' }] }] }
    ]
  });
  model.setTaskStatus(caseItem, 'current-task', model.STATUS.DONE);
  const stats = model.caseStats(caseItem);
  assert.equal(stats.currentWorkCleared, true);
  assert.equal(stats.wholeCaseComplete, false);
  assert.equal(stats.hasFutureWork, true);
  assert.equal(stats.currentWorkState, model.WORK_STATE.CLEARED_FUTURE_PENDING);
  assert.equal(stats.needsStageAdvance, true);
});

test('next task information preserves actual, prior and later context', () => {
  const caseItem = model.createCase({ name: '阶段衔接案' }, {
    id: 'next-template', name: '衔接', category: 'custom', categoryLabel: '自定义', stages: [
      { id: 's1', name: '前序', groups: [{ id: 'g1', title: '前序', tasks: [{ id: 't1', title: '前序待办' }] }] },
      { id: 's2', name: '实际', groups: [{ id: 'g2', title: '实际', tasks: [{ id: 't2', title: '实际已办' }] }] },
      { id: 's3', name: '后续', groups: [{ id: 'g3', title: '后续', tasks: [{ id: 't3', title: '后续待办' }] }] }
    ]
  });
  model.setActualStage(caseItem, 's2');
  model.setTaskStatus(caseItem, 't2', model.STATUS.DONE);
  const info = model.nextTaskInfo(caseItem);
  assert.equal(info.entry.task.id, 't3');
  assert.equal(info.fallback, 'later');
  assert.equal(info.priorOpenCount, 1);
  assert.equal(info.laterOpenCount, 1);
});

test('state validation and CSV safety remain enabled', () => {
  const state = model.createEmptyState();
  state.cases.push(model.createCase({ name: '完整性测试' }, template));
  assert.equal(model.validateState(state).ok, true);
  assert.equal(model.csvSafeValue('=HYPERLINK("https://example.com")').startsWith("'="), true);
  assert.equal(model.csvSafeValue('普通案件'), '普通案件');
});

test('all resolved conditional branches can form an all-not-applicable terminal state', () => {
  const conditionalTemplate = {
    id: 'conditional-only',
    name: '全条件流程',
    category: 'custom',
    categoryLabel: '自定义',
    stages: [
      {
        id: 'conditional-stage',
        name: '条件阶段',
        conditional: true,
        groups: [{ id: 'inside', title: '阶段内事项', tasks: [{ id: 'inside-task', title: '阶段任务' }] }]
      },
      {
        id: 'included-stage',
        name: '普通阶段',
        groups: [{
          id: 'conditional-group',
          title: '条件事项组',
          conditional: true,
          tasks: [{ id: 'group-task', title: '事项组任务' }]
        }]
      }
    ]
  };
  const caseItem = model.createCase({ name: '全不适用案' }, conditionalTemplate);
  model.setStageApplicability(caseItem, 'conditional-stage', model.APPLICABILITY.EXCLUDED);
  model.setGroupApplicability(caseItem, 'conditional-group', model.APPLICABILITY.EXCLUDED);

  const stats = model.caseStats(caseItem);
  assert.equal(stats.rawTaskCount, 2);
  assert.equal(stats.total, 0);
  assert.equal(stats.hasUndecided, false);
  assert.equal(stats.allNotApplicable, true);
  assert.equal(stats.wholeCaseComplete, true);
  assert.equal(stats.complete, true);
  assert.equal(stats.currentWorkState, model.WORK_STATE.ALL_NOT_APPLICABLE);
  assert.equal(model.stageStats(caseItem.stages[0], { effectiveOnly: true }).allNotApplicable, true);

  const emptyCase = model.createCase({ name: '空白流程案' }, {
    id: 'empty-template', name: '空模板', category: 'custom', categoryLabel: '自定义', stages: []
  });
  const emptyStats = model.caseStats(emptyCase);
  assert.equal(emptyStats.rawTaskCount, 0);
  assert.equal(emptyStats.allNotApplicable, false);
  assert.equal(emptyStats.wholeCaseComplete, false);
  assert.equal(emptyStats.currentWorkState, model.WORK_STATE.EMPTY);
});

test('templates derived from cases preserve provenance and legal metadata without sharing references', () => {
  const sourceTemplate = {
    id: 'civil-plaintiff-v3',
    name: '民事原告一审',
    category: 'civil',
    categoryLabel: '民事诉讼',
    description: '适用于代理原告参加民事一审。',
    role: '原告代理人',
    scope: '民事一审普通程序',
    sourceVersion: '2026-08',
    lastReviewedAt: '2026-08-01',
    legalNote: '使用前结合案件事实复核。',
    sources: [{ title: '法律依据', url: 'https://example.com/law' }],
    stages: [{ id: 's', name: '立案', groups: [{ id: 'g', title: '准备', tasks: [{ id: 't', title: '起诉材料' }] }] }]
  };
  const caseItem = model.createCase({ name: '甲诉乙合同案' }, sourceTemplate);
  const derived = model.templateFromCase(caseItem, { name: '合同纠纷原告模板' });

  for (const field of ['category', 'categoryLabel', 'description', 'role', 'scope', 'sourceVersion', 'lastReviewedAt', 'legalNote']) {
    assert.equal(derived[field], caseItem.templateSnapshot[field]);
  }
  assert.deepEqual(derived.sources, caseItem.templateSnapshot.sources);
  assert.notEqual(derived.sources, caseItem.templateSnapshot.sources);
  assert.deepEqual(derived.derivedFrom, {
    kind: 'case',
    caseId: caseItem.id,
    caseName: caseItem.name,
    templateId: sourceTemplate.id,
    templateName: sourceTemplate.name,
    at: derived.createdAt
  });

  derived.sources[0].title = '已修改来源';
  derived.stages[0].groups[0].tasks[0].title = '已修改步骤';
  assert.equal(caseItem.templateSnapshot.sources[0].title, '法律依据');
  assert.equal(caseItem.stages[0].groups[0].tasks[0].title, '起诉材料');

  const state = model.createEmptyState();
  state.customTemplates.push(derived);
  const roundTripped = model.normalizeState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(roundTripped.customTemplates[0].derivedFrom, derived.derivedFrom);
  assert.equal(model.validateState(roundTripped).ok, true);

  const legacyCase = model.normalizeState({
    version: 5,
    cases: [{
      id: 'legacy-case', name: '旧案件', templateId: 'legacy', templateName: '旧模板',
      caseType: 'custom', caseTypeLabel: '自定义', stages: []
    }],
    customTemplates: []
  }).cases[0];
  const legacyDerived = model.templateFromCase(legacyCase, { name: '旧案派生模板', description: '' });
  assert.equal(legacyDerived.role, '');
  assert.equal(legacyDerived.scope, '');
  assert.equal(legacyDerived.sources.length, 0);
  assert.equal(legacyDerived.description, '');
});

function customFixture() {
  const workflow = model.createBlankTemplate({
    name: '可编辑模板',
    stageName: '第一阶段',
    groupTitle: '第一组',
    firstTaskTitle: '第一步'
  });
  const caseItem = model.createCase({ name: '撤销测试案' }, workflow);
  model.addStage(caseItem, { name: '第二阶段', groupTitle: '第二组', firstTaskTitle: '第二步' });
  const state = model.createEmptyState();
  state.cases.push(caseItem);
  state.customTemplates.push(workflow, model.createBlankTemplate({ name: '保留模板' }));
  return { state, caseItem, workflow };
}

test('recoverable custom deletions survive round trips and restore exact snapshots and positions', () => {
  const templateFixture = customFixture();
  const templateSnapshot = model.clone(templateFixture.workflow);
  const templateDelete = model.deleteCustomTemplateWithActivity(templateFixture.state, templateFixture.workflow.id, '2026-08-14T01:00:00.000Z');
  assert.equal(templateDelete.ok, true);
  let loaded = model.normalizeState(JSON.parse(JSON.stringify(templateFixture.state)));
  assert.equal(model.validateState(loaded).ok, true);
  assert.equal(model.canUndoActivity(loaded, templateDelete.event.id), true);
  assert.equal(model.undoActivity(loaded, templateDelete.event.id, '2026-08-14T01:01:00.000Z').ok, true);
  assert.deepEqual(loaded.customTemplates[0], templateSnapshot);
  assert.equal(loaded.recentActivity.some((event) => event.id === templateDelete.event.id), false);

  const taskFixture = customFixture();
  const task = taskFixture.caseItem.stages[0].groups[0].tasks[0];
  const taskSnapshot = model.clone(task);
  const taskDelete = model.deleteCustomTaskWithActivity(taskFixture.state, taskFixture.caseItem.id, task.id, '2026-08-14T02:00:00.000Z');
  assert.equal(taskDelete.ok, true);
  loaded = model.normalizeState(JSON.parse(JSON.stringify(taskFixture.state)));
  assert.equal(model.validateState(loaded).ok, true);
  assert.equal(model.undoActivity(loaded, taskDelete.event.id, '2026-08-14T02:01:00.000Z').ok, true);
  assert.deepEqual(model.findTask(loaded.cases[0], task.id).task, taskSnapshot);
  assert.equal(loaded.recentActivity.some((event) => event.id === taskDelete.event.id), false);

  const groupFixture = customFixture();
  const group = groupFixture.caseItem.stages[0].groups[0];
  const groupSnapshot = model.clone(group);
  const groupDelete = model.deleteCustomGroupWithActivity(groupFixture.state, groupFixture.caseItem.id, group.id, '2026-08-14T03:00:00.000Z');
  assert.equal(groupDelete.ok, true);
  loaded = model.normalizeState(JSON.parse(JSON.stringify(groupFixture.state)));
  assert.equal(model.validateState(loaded).ok, true);
  assert.equal(model.undoActivity(loaded, groupDelete.event.id, '2026-08-14T03:01:00.000Z').ok, true);
  assert.deepEqual(model.findGroup(loaded.cases[0], group.id).group, groupSnapshot);
  assert.equal(loaded.recentActivity.some((event) => event.id === groupDelete.event.id), false);

  const stageFixture = customFixture();
  const stage = stageFixture.caseItem.stages[0];
  const stageSnapshot = model.clone(stage);
  const stageDelete = model.deleteCustomStageWithActivity(stageFixture.state, stageFixture.caseItem.id, stage.id, '2026-08-14T04:00:00.000Z');
  assert.equal(stageDelete.ok, true);
  loaded = model.normalizeState(JSON.parse(JSON.stringify(stageFixture.state)));
  assert.equal(model.validateState(loaded).ok, true);
  assert.equal(model.undoActivity(loaded, stageDelete.event.id, '2026-08-14T04:01:00.000Z').ok, true);
  assert.deepEqual(model.findStage(loaded.cases[0], stage.id), stageSnapshot);
  assert.equal(loaded.cases[0].actualStageId, stage.id);
  assert.equal(loaded.recentActivity.some((event) => event.id === stageDelete.event.id), false);
});

test('undo of a custom deletion refuses to overwrite later conflicting changes', () => {
  const { state, caseItem } = customFixture();
  const firstStage = caseItem.stages[0];
  const task = firstStage.groups[0].tasks[0];
  const taskDelete = model.deleteCustomTaskWithActivity(state, caseItem.id, task.id, '2026-08-14T05:00:00.000Z');
  firstStage.groups[0].tasks.push({ ...task, title: '后来创建的同 ID 步骤' });
  assert.equal(model.canUndoActivity(state, taskDelete.event.id), false);
  assert.deepEqual(model.undoActivity(state, taskDelete.event.id), { ok: false, reason: 'NOT_UNDOABLE' });

  const { state: stageState, caseItem: stageCase } = customFixture();
  const deletedStage = stageCase.stages[0];
  const remainingStage = stageCase.stages[1];
  const stageDelete = model.deleteCustomStageWithActivity(stageState, stageCase.id, deletedStage.id, '2026-08-14T06:00:00.000Z');
  assert.equal(model.setActualStage(stageCase, remainingStage.id), true);
  assert.equal(model.canUndoActivity(stageState, stageDelete.event.id), false);
  assert.equal(stageCase.actualStageId, remainingStage.id);

  const { state: groupState, caseItem: groupCase } = customFixture();
  const deletedGroup = groupCase.stages[0].groups[0];
  const nestedTask = model.clone(deletedGroup.tasks[0]);
  const groupDelete = model.deleteCustomGroupWithActivity(groupState, groupCase.id, deletedGroup.id, '2026-08-14T06:10:00.000Z');
  groupCase.stages[1].groups[0].tasks.push({ ...nestedTask, title: '后来占用原步骤 ID' });
  // Deleted snapshots and active workflows have separate validation scopes,
  // while undo still refuses to introduce an active-workflow ID collision.
  assert.equal(model.validateState(groupState).ok, true);
  assert.equal(model.canUndoActivity(groupState, groupDelete.event.id), false);
});

test('version 6 ledgers migrate to version 7 without losing recent activity or recycled cases', () => {
  const state = model.createEmptyState();
  state.version = 6;
  state.recentActivity = [];
  state.recycleBin = { cases: [] };
  const normalized = model.normalizeState(state);
  assert.equal(normalized.version, model.CURRENT_STATE_VERSION);
  assert.equal(model.CURRENT_STATE_VERSION, 7);
  assert.deepEqual(normalized.recentActivity, []);
  assert.deepEqual(normalized.recycleBin, { cases: [] });
  assert.equal(model.validateState(normalized).ok, true);
});

test('important date handled state migrates safely and requires a nullable ISO timestamp', () => {
  const withDate = model.createCase({ name: '有关键日期', importantDate: '2026-09-01' }, template);
  const withoutDate = model.createCase({ name: '无关键日期' }, template);
  delete withDate.importantDateHandledAt;
  delete withoutDate.importantDateHandledAt;
  const legacy = model.createEmptyState();
  legacy.version = 6;
  legacy.cases = [withDate, withoutDate];

  assert.equal(model.validateState(legacy).ok, true);
  withoutDate.importantDateHandledAt = '2026-08-14T08:00:00.000Z';
  const normalized = model.normalizeState(JSON.parse(JSON.stringify(legacy)));
  assert.equal(normalized.cases[0].importantDateHandledAt, null);
  assert.equal(normalized.cases[1].importantDateHandledAt, null);
  assert.equal(model.validateState(normalized).ok, true);

  normalized.cases[0].importantDateHandledAt = '不是时间';
  assert.equal(model.validateState(normalized).ok, false);
  assert.equal(model.createCase({ name: '新案件', importantDate: '2026-09-02' }, template).importantDateHandledAt, null);
});

test('important dates can be handled and safely undone without deleting the date', () => {
  const state = model.createEmptyState();
  const caseItem = model.createCase({ name: '关键日期案', importantDate: '2026-09-10' }, template);
  state.cases.push(caseItem);
  const handledAt = '2026-08-14T09:00:00.000Z';
  const result = model.changeCaseImportantDateStatus(state, caseItem.id, true, handledAt);

  assert.equal(result.ok, true);
  assert.equal(result.event.type, model.ACTIVITY_TYPE.CASE_IMPORTANT_DATE_STATUS);
  assert.equal(caseItem.importantDate, '2026-09-10');
  assert.equal(caseItem.importantDateHandledAt, handledAt);
  assert.deepEqual(result.event.before, { importantDate: '2026-09-10', importantDateHandledAt: null });
  assert.deepEqual(result.event.after, { importantDate: '2026-09-10', importantDateHandledAt: handledAt });
  assert.deepEqual(model.changeCaseImportantDateStatus(state, caseItem.id, true, handledAt), { ok: false, reason: 'NO_CHANGE' });

  const loaded = model.normalizeState(JSON.parse(JSON.stringify(state)));
  assert.equal(model.validateState(loaded).ok, true);
  assert.equal(model.canUndoActivity(loaded, result.event.id), true);
  const undone = model.undoActivity(loaded, result.event.id, '2026-08-14T09:05:00.000Z');
  assert.equal(undone.ok, true);
  assert.equal(undone.activityRemoved, true);
  assert.equal(loaded.cases[0].importantDate, '2026-09-10');
  assert.equal(loaded.cases[0].importantDateHandledAt, null);
  assert.equal(loaded.recentActivity.some((event) => event.id === result.event.id), false);

  const noDate = model.createCase({ name: '无日期案' }, template);
  state.cases.push(noDate);
  assert.deepEqual(model.changeCaseImportantDateStatus(state, noDate.id, true), { ok: false, reason: 'IMPORTANT_DATE_NOT_SET' });
  assert.deepEqual(model.changeCaseImportantDateStatus(state, caseItem.id, 'yes'), { ok: false, reason: 'INVALID_HANDLED_STATUS' });
});

test('important date undo refuses to overwrite a later status or a changed date', () => {
  const state = model.createEmptyState();
  const caseItem = model.createCase({ name: '关键日期冲突案', importantDate: '2026-10-01' }, template);
  state.cases.push(caseItem);
  const first = model.changeCaseImportantDateStatus(state, caseItem.id, true, '2026-08-14T10:00:00.000Z');
  caseItem.importantDateHandledAt = '2026-08-14T10:01:00.000Z';
  assert.equal(model.canUndoActivity(state, first.event.id), false);
  assert.deepEqual(model.undoActivity(state, first.event.id), { ok: false, reason: 'NOT_UNDOABLE' });
  assert.equal(caseItem.importantDateHandledAt, '2026-08-14T10:01:00.000Z');

  caseItem.importantDateHandledAt = first.event.after.importantDateHandledAt;
  caseItem.importantDate = '2026-10-02';
  assert.equal(model.canUndoActivity(state, first.event.id), false);
  assert.equal(caseItem.importantDate, '2026-10-02');
});

test('repeated custom deletion and undo does not retain growing snapshots in activity', () => {
  const { state, caseItem } = customFixture();
  const task = caseItem.stages[0].groups[0].tasks[0];
  task.detail = '大'.repeat(9000);
  const baselineLength = JSON.stringify(state).length;

  for (let index = 0; index < 8; index += 1) {
    const deleted = model.deleteCustomTaskWithActivity(state, caseItem.id, task.id, `2026-08-14T11:0${index}:00.000Z`);
    assert.equal(deleted.ok, true);
    assert.equal(state.recentActivity.length, 1);
    const undone = model.undoActivity(state, deleted.event.id, `2026-08-14T12:0${index}:00.000Z`);
    assert.equal(undone.ok, true);
    assert.equal(undone.activityRemoved, true);
    assert.equal(state.recentActivity.length, 0);
    assert.equal(model.findGroup(caseItem, caseItem.stages[0].groups[0].id).group.tasks.length, 1);
  }
  assert.ok(JSON.stringify(state).length <= baselineLength + 100);
});

test('validation rejects recursively corrupted custom deletion snapshots before they can be restored', () => {
  const checks = [
    {
      prepare() {
        const fixture = customFixture();
        const result = model.deleteCustomTemplateWithActivity(fixture.state, fixture.workflow.id, '2026-08-14T13:00:00.000Z');
        return { state: fixture.state, event: result.event };
      },
      corrupt(event) { event.before.item.stages[0].groups[0].tasks[0].title = ' '; },
      code: 'INVALID_TEXT'
    },
    {
      prepare() {
        const fixture = customFixture();
        const stage = fixture.caseItem.stages[0];
        const result = model.deleteCustomStageWithActivity(fixture.state, fixture.caseItem.id, stage.id, '2026-08-14T13:01:00.000Z');
        return { state: fixture.state, event: result.event };
      },
      corrupt(event) { event.before.item.groups[0].tasks[0].status = 'corrupt'; },
      code: 'INVALID_STATUS'
    },
    {
      prepare() {
        const fixture = customFixture();
        const group = fixture.caseItem.stages[0].groups[0];
        const result = model.deleteCustomGroupWithActivity(fixture.state, fixture.caseItem.id, group.id, '2026-08-14T13:02:00.000Z');
        return { state: fixture.state, event: result.event };
      },
      corrupt(event) { event.before.item.tasks[0].id = event.before.item.id; },
      code: 'DUPLICATE_ID'
    },
    {
      prepare() {
        const fixture = customFixture();
        const task = fixture.caseItem.stages[0].groups[0].tasks[0];
        const result = model.deleteCustomTaskWithActivity(fixture.state, fixture.caseItem.id, task.id, '2026-08-14T13:03:00.000Z');
        return { state: fixture.state, event: result.event };
      },
      corrupt(event) { event.before.item.dueDate = '2026-99-99'; },
      code: 'INVALID_DATE'
    }
  ];

  for (const check of checks) {
    const { state, event } = check.prepare();
    assert.equal(model.validateState(state).ok, true);
    check.corrupt(event);
    const validation = model.validateState(state);
    assert.equal(validation.ok, false);
    assert.equal(validation.errors.some((error) => error.code === check.code && error.path.includes('.before.item')), true);
  }
});

test('tasks retained inside deletion snapshots count toward the global validation limit', () => {
  const groups = Array.from({ length: 50 }, (_, groupIndex) => ({
    id: `large-group-${groupIndex}`,
    title: `事项组 ${groupIndex + 1}`,
    tasks: Array.from({ length: 1000 }, (_, taskIndex) => ({
      id: `large-task-${groupIndex}-${taskIndex}`,
      title: `步骤 ${groupIndex + 1}-${taskIndex + 1}`
    }))
  }));
  const state = model.createEmptyState();
  state.customTemplates.push({
    id: 'large-template',
    name: '上限测试模板',
    stages: [{ id: 'large-stage', name: '批量阶段', groups }]
  });
  state.recentActivity.push({
    id: 'activity-extra-snapshot',
    at: '2026-08-14T14:00:00.000Z',
    type: model.ACTIVITY_TYPE.CUSTOM_TASK_DELETE,
    caseId: 'case-extra',
    caseName: '任务上限测试案',
    target: { stageId: 'stage-extra', groupId: 'group-extra', taskId: 'task-extra', originalIndex: 0 },
    label: '删除自定义步骤“额外步骤”',
    before: {
      item: {
        id: 'task-extra', title: '额外步骤', custom: true, status: model.STATUS.PENDING,
        dueDate: '', note: '', completedAt: null, updatedAt: null
      }
    },
    after: { itemPresent: false },
    changes: [],
    undoneAt: null,
    undoOf: null
  });

  const validation = model.validateState(state);
  assert.equal(validation.ok, false);
  assert.equal(validation.summary.totalTasks, model.VALIDATION_LIMITS.totalTasks + 1);
  assert.equal(validation.errors.some((error) => error.code === 'LIMIT_EXCEEDED' && error.path === '$'), true);
});
