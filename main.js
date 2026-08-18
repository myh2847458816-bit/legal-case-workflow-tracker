const { app, BrowserWindow, dialog, ipcMain, session, shell, safeStorage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { fileURLToPath } = require('node:url');
const model = require('./src/data-model');
const { createStorageService } = require('./src/storage-service');

const STATE_FILE_NAME = 'case-tracker-data.json';
// Keep the original data directory so upgrading from the bankruptcy-only app
// opens the user's existing cases automatically.
const DATA_DIRECTORY_NAME = '破产案件流程台账';
const RECOVERY_SMOKE_TEST = process.argv.includes('--recovery-smoke-test');
const CLOSE_SMOKE_TEST = process.argv.includes('--close-smoke-test');
const SMOKE_TEST = process.argv.includes('--smoke-test') || RECOVERY_SMOKE_TEST || CLOSE_SMOKE_TEST;
const SHOW_SMOKE_WINDOW = SMOKE_TEST && process.env.CASE_TRACKER_SHOW_SMOKE === '1';
const TEST_OUTPUT_DIR = process.env.CASE_TRACKER_TEST_OUTPUT || path.join(
  app.getPath('temp'),
  `case-tracker-smoke-${process.pid}-${Date.now()}-${crypto.randomUUID()}`
);
const CLOSE_SAVE_TIMEOUT_MS = 15000;
const EXPORT_REVEAL_TTL_MS = 10 * 60 * 1000;
const recentExportPaths = new Map();

if (SMOKE_TEST) app.setPath('userData', path.join(TEST_OUTPUT_DIR, 'user-data'));
else app.setPath('userData', path.join(app.getPath('appData'), DATA_DIRECTORY_NAME));

function getStatePath() {
  return path.join(app.getPath('userData'), STATE_FILE_NAME);
}

function assertTrustedIpcEvent(event) {
  const win = BrowserWindow.fromWebContents(event?.sender);
  if (!win || win.isDestroyed()) throw new Error('已拒绝未知页面的应用请求');
  const senderUrl = event.senderFrame?.url || event.sender.getURL();
  try {
    const target = new URL(senderUrl);
    target.search = '';
    target.hash = '';
    const expected = path.resolve(__dirname, 'src', 'index.html');
    if (target.protocol !== 'file:' || path.resolve(fileURLToPath(target)) !== expected) {
      throw new Error('untrusted sender');
    }
  } catch (_error) {
    throw new Error('已拒绝未知页面的应用请求');
  }
}

function trustedIpc(handler) {
  return (event, ...args) => {
    assertTrustedIpcEvent(event);
    return handler(event, ...args);
  };
}

function rememberExportPath(filePath) {
  const token = crypto.randomUUID();
  recentExportPaths.set(token, { filePath: path.resolve(filePath), expiresAt: Date.now() + EXPORT_REVEAL_TTL_MS });
  for (const [key, value] of recentExportPaths) if (value.expiresAt < Date.now()) recentExportPaths.delete(key);
  return token;
}

async function showRecentExport(token) {
  const entry = recentExportPaths.get(String(token || ''));
  if (!entry || entry.expiresAt < Date.now()) {
    recentExportPaths.delete(String(token || ''));
    throw new Error('导出文件定位已过期，请重新导出');
  }
  const stat = await fs.lstat(entry.filePath);
  if (!stat.isFile()) throw new Error('导出文件不存在');
  shell.showItemInFolder(entry.filePath);
  return { ok: true };
}

let storage = null;

function createSafeStorageCodec() {
  return {
    isAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
    encrypt: (text) => safeStorage.encryptStringAsync(text),
    decrypt: (buffer) => safeStorage.decryptStringAsync(buffer)
  };
}

function initializeStorage() {
  if (storage) return storage;
  storage = createStorageService({
    dataDirectory: app.getPath('userData'),
    stateFileName: STATE_FILE_NAME,
    model,
    legacyCodec: createSafeStorageCodec()
  });
  return storage;
}
const hasSingleInstanceLock = SMOKE_TEST || app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) app.quit();

app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

function clearPendingClose(win) {
  const pending = win?.__caseTrackerPendingClose;
  if (pending?.timer) clearTimeout(pending.timer);
  if (win) win.__caseTrackerPendingClose = null;
}

function destroyAfterSave(win) {
  if (!win || win.isDestroyed()) return;
  clearPendingClose(win);
  win.__caseTrackerAllowClose = true;
  win.destroy();
}

async function resolveCloseProblem(win, requestId, message, timedOut = false) {
  if (!win || win.isDestroyed() || win.__caseTrackerPendingClose?.requestId !== requestId) return;
  clearTimeout(win.__caseTrackerPendingClose.timer);
  win.__caseTrackerPendingClose.timer = null;
  const result = await dialog.showMessageBox(win, {
    type: 'warning',
    title: '数据尚未保存',
    message: timedOut ? '保存等待时间较长，程序尚未确认数据已经写入。' : '退出前保存数据失败。',
    detail: `${String(message || '未知原因').slice(0, 500)}\n\n为避免丢失刚才的修改，建议先重试或取消退出。`,
    buttons: timedOut ? ['继续等待', '取消退出', '仍然退出'] : ['重试保存', '取消退出', '仍然退出'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  });
  if (win.isDestroyed() || win.__caseTrackerPendingClose?.requestId !== requestId) return;
  if (result.response === 2) {
    destroyAfterSave(win);
    return;
  }
  clearPendingClose(win);
  if (result.response === 0) requestWindowClose(win);
}

function requestWindowClose(win) {
  if (!win || win.isDestroyed() || win.__caseTrackerPendingClose) return;
  const requestId = crypto.randomUUID();
  const pending = { requestId, timer: null };
  win.__caseTrackerPendingClose = pending;
  try {
    win.webContents.send('window:prepare-close', { requestId });
  } catch (error) {
    void resolveCloseProblem(win, requestId, error.message);
    return;
  }
  pending.timer = setTimeout(() => {
    void resolveCloseProblem(win, requestId, '保存响应超时。你可以继续等待，或取消退出后检查数据。', true);
  }, CLOSE_SAVE_TIMEOUT_MS);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1050,
    minHeight: 680,
    backgroundColor: '#f4f6f9',
    title: '法律案件流程台账',
    show: !SMOKE_TEST || SHOW_SMOKE_WINDOW,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  if (SMOKE_TEST) {
    win.webContents.once('did-finish-load', () => {
      if (RECOVERY_SMOKE_TEST) runRecoverySmokeTest(win);
      else if (CLOSE_SMOKE_TEST) runCloseSmokeTest(win);
      else runSmokeTest(win);
    });
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      if (target.protocol === 'https:') shell.openExternal(target.href);
    } catch (_error) {
      // Invalid or non-web links stay blocked inside the desktop application.
    }
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });

  win.on('close', (event) => {
    if (win.__caseTrackerAllowClose) return;
    event.preventDefault();
    requestWindowClose(win);
  });
  win.on('closed', () => clearPendingClose(win));
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function prepareRecoverySmokeFixture() {
  const { template } = require('./src/workflow-template');
  const fixtureState = model.createEmptyState();
  fixtureState.cases.push(model.createCase({ name: '某公司本地恢复测试案', caseNumber: '（2026）恢复测试号', manager: '测试承办人' }, template));
  await storage.saveState(fixtureState);
  await storage.loadState();
  await fs.writeFile(getStatePath(), '{"corrupted":', 'utf8');
}

async function prepareCloseSmokeFixture() {
  const { template } = require('./src/workflow-template');
  const fixtureState = model.createEmptyState();
  fixtureState.cases.push(model.createCase({ name: '关闭前保存测试案', caseNumber: '（2026）关闭保存测试号', manager: '测试承办人' }, template));
  await storage.saveState(fixtureState);
}

async function runCloseSmokeTest(win) {
  try {
    await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        const card = document.querySelector('.case-card');
        if (card) { clearInterval(timer); resolve(true); }
        else if (Date.now() - started > 6000) { clearInterval(timer); reject(new Error('关闭保存测试案件未加载')); }
      }, 50);
    })`);
    await win.webContents.executeJavaScript(`(() => {
      document.querySelector('.case-card').click();
      const note = document.querySelector('.task-note');
      if (!note) throw new Error('关闭保存测试找不到任务备注');
      note.closest('details')?.setAttribute('open', '');
      note.focus();
      note.value = '关闭前最后一刻写入的备注';
      note.dispatchEvent(new Event('input', { bubbles: true }));
      if (document.activeElement !== note) throw new Error('关闭保存测试未能聚焦任务备注');
      return true;
    })()`);
    const closed = new Promise((resolve) => win.once('closed', resolve));
    win.close();
    await Promise.race([closed, delay(6000).then(() => { throw new Error('关闭前保存握手超时'); })]);
    const stored = await storage.loadState();
    const saved = stored?.cases?.[0]?.stages?.flatMap((stage) => stage.groups || []).flatMap((group) => group.tasks || []).some((task) => task.note === '关闭前最后一刻写入的备注');
    if (!saved) throw new Error('关闭窗口后最后一刻修改未落盘');
    process.stdout.write(`${JSON.stringify({ ok: true, closeHandshake: true, lastMomentEditSaved: true })}\n`);
    app.exit(0);
  } catch (error) {
    process.stderr.write(`Close smoke test failed: ${error.stack || error.message}\n`);
    app.exit(1);
  }
}

async function runRecoverySmokeTest(win) {
  try {
    await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        const button = document.querySelector('[data-action="recovery-restore"]');
        if (button) { clearInterval(timer); resolve(true); }
        else if (Date.now() - started > 6000) { clearInterval(timer); reject(new Error('损坏台账恢复页未显示本地恢复点')); }
      }, 50);
    })`);
    const recoveryScreen = await win.webContents.executeJavaScript(`(() => {
      const screen = document.querySelector('.recovery-screen');
      const button = document.querySelector('[data-action="recovery-restore"]');
      if (!screen || !screen.textContent.includes('原文件不会被自动覆盖')) throw new Error('恢复页缺少损坏文件保护说明');
      window.confirm = () => true;
      button.click();
      return { recoveryScreen: true, localRecoveryAction: true };
    })()`);
    await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (document.body.textContent.includes('某公司本地恢复测试案') && document.querySelector('.case-card')) { clearInterval(timer); resolve(true); }
        else if (Date.now() - started > 6000) { clearInterval(timer); reject(new Error('本地恢复点未恢复到案件总览')); }
      }, 50);
    })`);
    await fs.mkdir(TEST_OUTPUT_DIR, { recursive: true });
    const image = await win.webContents.capturePage();
    await fs.writeFile(path.join(TEST_OUTPUT_DIR, 'recovery-success.png'), image.toPNG());
    const health = await storage.getStorageHealth();
    if (!health.recovery.corruptFiles.length) throw new Error('损坏主文件未保留为 corrupt 恢复文件');
    process.stdout.write(`${JSON.stringify({ ok: true, ...recoveryScreen, restoredCase: true, corruptFilePreserved: true })}\n`);
    app.exit(0);
  } catch (error) {
    process.stderr.write(`Recovery smoke test failed: ${error.stack || error.message}\n`);
    app.exit(1);
  }
}

async function runSmokeTest(win) {
  try {
    await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (document.querySelector('[data-action="new-case"]')) { clearInterval(timer); resolve(true); }
        else if (Date.now() - started > 8000) {
          clearInterval(timer);
          const visibleText = String(document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 500);
          reject(new Error('应用首页未加载：' + (visibleText || '页面没有可见文字')));
        }
      }, 50);
    })`);
    const startupResult = await win.webContents.executeJavaScript(`(() => {
      if (document.querySelector('#security-notice-dialog')) throw new Error('首次启动仍被数据保护弹窗阻断');
      return { directStartup: true, noSecurityGate: true };
    })()`);
    const missingTemplateResult = await win.webContents.executeJavaScript(`(() => {
      document.querySelector('[data-action="new-case"]').click();
      const form = document.querySelector('#case-form');
      if (form.elements.caseType.value || !form.querySelector('button[type="submit"]').disabled) return { debugError: '新建案件仍默认选择了业务类型' };
      if (form.elements.startDate.value) return { debugError: '新建案件开始日期仍被自动填写', startDate: form.elements.startDate.value };
      const type = form.elements.caseType;
      type.value = 'civil';
      type.dispatchEvent(new Event('change', { bubbles: true }));
      const selector = form.elements.templateId;
      const civilOptions = Array.from(selector.options);
      if (civilOptions.length < 2) return { debugError: '民事诉讼类别缺少可切换的同类模板', optionCount: civilOptions.length };
      const initialName = document.querySelector('#recommended-template-name')?.textContent.trim();
      const initialRole = document.querySelector('#recommended-template-scope')?.textContent.trim();
      const initialSummaryName = document.querySelector('#case-template-summary strong')?.textContent.trim();
      if (!initialName || initialName !== initialSummaryName || !initialRole?.includes('原告代理人')) {
        return { debugError: '首个民事模板的顶部名称或角色未同步', initialName, initialSummaryName, initialRole };
      }
      selector.value = civilOptions[1].value;
      selector.dispatchEvent(new Event('change', { bubbles: true }));
      const switchedName = document.querySelector('#recommended-template-name')?.textContent.trim();
      const switchedRole = document.querySelector('#recommended-template-scope')?.textContent.trim();
      const switchedSummaryName = document.querySelector('#case-template-summary strong')?.textContent.trim();
      if (!switchedName || switchedName === initialName || switchedName !== switchedSummaryName || !switchedRole?.includes('被告代理人')) {
        return { debugError: '同类别切换模板后顶部名称或角色未同步', initialName, switchedName, switchedSummaryName, switchedRole };
      }
      type.value = 'custom';
      type.dispatchEvent(new Event('change', { bubbles: true }));
      const submit = form.querySelector('button[type="submit"]');
      if (!selector.disabled || selector.value || !submit.disabled) return { debugError: '无模板业务类型仍允许创建案件', selectorDisabled: selector.disabled, selectorValue: selector.value, submitDisabled: submit.disabled };
      if (!form.querySelector('.missing-template-notice') || !form.textContent.includes('先建立一套空白模板')) return { debugError: '无模板业务类型缺少清楚指引', text: form.textContent.slice(0, 500) };
      form.elements.name.value = '不应创建的其他类型案件';
      form.requestSubmit();
      if (!document.querySelector('#case-dialog')?.open) return { debugError: '无模板业务类型意外关闭了新建窗口' };
      const originalConfirm = window.confirm;
      window.confirm = () => true;
      document.querySelector('#case-dialog [data-action="close-modal"]').click();
      window.confirm = originalConfirm;
      return { explicitPracticeChoice: true, emptyStartDateDefault: true, sameCategoryTemplateSwitch: true, templateRoleSynced: true, missingTemplateBlocked: true, missingTemplateGuidance: true };
    })()`);
    if (missingTemplateResult.debugError) throw new Error(`${missingTemplateResult.debugError}: ${JSON.stringify(missingTemplateResult)}`);
    await win.webContents.executeJavaScript(`(() => {
      document.querySelector('[data-action="new-case"]').click();
      const form = document.querySelector('#case-form');
      form.elements.caseType.value = 'bankruptcy';
      form.elements.caseType.dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('details.case-more-fields')?.setAttribute('open', '');
      form.elements.name.value = '某新材料有限公司破产清算案';
      form.elements.companyName.value = '某新材料有限公司';
      form.elements.caseNumber.value = '（2026）某01破测1号';
      form.elements.court.value = '某市中级人民法院';
      form.elements.manager.value = '承办律师';
      form.elements.importantDate.value = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
      form.requestSubmit();
      return true;
    })()`);
    await delay(450);
    const bankruptcyResult = await win.webContents.executeJavaScript(`(() => {
      const first = document.querySelector('.task-checkbox');
      if (!first) throw new Error('未生成流程任务');
      const stageCount = document.querySelectorAll('.stage-button').length;
      const taskCount = Array.from(document.querySelectorAll('.stage-button')).reduce((sum, item) => sum + Number(item.dataset.taskTotal || 0), 0);
      if (stageCount !== 15 || taskCount !== 207) throw new Error('破产模板规模异常：' + stageCount + ' 阶段 / ' + taskCount + ' 任务');
      if (!document.body.textContent.includes('本案清单依据')) throw new Error('案件详情缺少清单依据快照');
      if (!document.querySelector('#actual-stage-select')) throw new Error('未生成实际办理阶段选择器');
      const statusSelects = document.querySelectorAll('.task-status-select');
      if (!statusSelects.length) throw new Error('未生成任务状态选择器');
      const expectedStatuses = ['pending', 'done', 'not_applicable', 'out_of_scope', 'completed_elsewhere', 'review'];
      const availableStatuses = Array.from(statusSelects[0].options, (option) => option.value);
      if (!expectedStatuses.every((status) => availableStatuses.includes(status))) throw new Error('任务状态选项不完整');
      if (!statusSelects[0].querySelector('optgroup[label="更多状态"]')) throw new Error('任务状态未将低频选项收入更多状态');
      if (!document.querySelector('.task-more') || document.querySelector('.task-more[open]')) throw new Error('任务详情未默认收起');
      if (!document.body.textContent.includes('计划办理日') || document.body.textContent.includes('截止日期') || document.body.textContent.includes('提醒日期')) throw new Error('计划办理日文案未完成替换');
      if (!document.querySelector('#case-task-search')) throw new Error('案件详情缺少本案事项搜索');
      if (!document.querySelector('.case-hero')?.textContent.includes('案件关键日期')) throw new Error('案件详情未显示关键日期');
      const titleSize = Number.parseFloat(getComputedStyle(document.querySelector('.task-title')).fontSize);
      const statusControl = document.querySelector('.task-status-select').getBoundingClientRect();
      if (titleSize < 14 || statusControl.height < 36) throw new Error('任务字号或状态控件仍然过小');
      first.click();
      const reviewStatus = document.querySelectorAll('.task-status-select')[1];
      reviewStatus.value = 'review';
      reviewStatus.dispatchEvent(new Event('change', { bubbles: true }));
      const reminderDate = document.querySelectorAll('.task-date')[1];
      reminderDate.value = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
      reminderDate.dispatchEvent(new Event('change', { bubbles: true }));
      const note = document.querySelector('.task-note');
      note.value = '已提交 OA，等待审批';
      note.dispatchEvent(new Event('change', { bubbles: true }));
      const activeStage = document.querySelector('.stage-button.active');
      const displayedTotal = Number((activeStage?.querySelector('.stage-count')?.textContent || '').split('/').pop());
      const effectiveTotal = document.querySelectorAll('.task-row:not(.workflow-readonly)').length;
      if (Number.isFinite(displayedTotal) && displayedTotal !== effectiveTotal) throw new Error('阶段统计与实际计入清单的任务数不一致');
      return { bankruptcyStages: stageCount, bankruptcyTasks: taskCount, caseBasis: true, caseSearch: true, criticalDateVisible: true, readableControls: true, stageStatsAligned: true };
    })()`);
    await delay(500);
    const caseSearchResult = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const search = document.querySelector('#case-task-search');
      search.value = '源备案';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      const started = Date.now();
      const timer = setInterval(() => {
        const result = document.querySelector('.case-task-search-results button');
        if (result) {
          clearInterval(timer);
          if (!result.textContent.includes('源备案')) reject(new Error('本案搜索返回了不相关结果'));
          else resolve({ caseSearchResults: true });
        } else if (Date.now() - started > 3000) {
          clearInterval(timer);
          reject(new Error('本案事项搜索未返回匹配结果'));
        }
      }, 40);
    })`);
    await win.webContents.executeJavaScript(`document.querySelector('.case-task-search-results button').click()`);
    await delay(180);
    await fs.mkdir(TEST_OUTPUT_DIR, { recursive: true });
    const detailImage = await win.webContents.capturePage();
    await fs.writeFile(path.join(TEST_OUTPUT_DIR, 'case-detail.png'), detailImage.toPNG());
    const workflowDirtyResult = await win.webContents.executeJavaScript(`(() => {
      document.querySelector('[data-action="add-task"]').click();
      const form = document.querySelector('#workflow-form');
      form.elements.title.value = '尚未提交的步骤草稿';
      let confirmCount = 0;
      const originalConfirm = window.confirm;
      window.confirm = () => { confirmCount += 1; return false; };
      document.querySelector('#workflow-dialog [data-action="close-modal"]').click();
      window.confirm = originalConfirm;
      if (confirmCount !== 1) throw new Error('新增步骤表单有草稿时关闭未触发确认');
      const preservedForm = document.querySelector('#workflow-form');
      if (!preservedForm || preservedForm.elements.title.value !== '尚未提交的步骤草稿') throw new Error('取消关闭后新增步骤草稿未保留');
      form.elements.title.value = '补充向法院提交管理人联系方式';
      form.elements.detail.value = '根据本案沟通情况补充办理。';
      form.elements.optional.checked = true;
      form.requestSubmit();
      return { workflowFormDirtyGuard: true };
    })()`);
    await delay(180);
    await win.webContents.executeJavaScript(`(() => {
      document.querySelector('[data-action="add-group"]').click();
      const form = document.querySelector('#workflow-form');
      form.elements.title.value = '补充程序事项';
      form.elements.firstTaskTitle.value = '核对法院送达地址及联系人';
      form.requestSubmit();
      return true;
    })()`);
    await delay(180);
    const groupDeleteUndoResult = await win.webContents.executeJavaScript(`(() => {
      const group = Array.from(document.querySelectorAll('.task-group')).find((item) => item.querySelector('.group-title')?.textContent.trim() === '补充程序事项');
      const button = group?.querySelector('[data-action="delete-group"]');
      if (!button) throw new Error('找不到可删除的自定义事项组');
      const originalConfirm = window.confirm;
      window.confirm = () => true;
      button.click();
      window.confirm = originalConfirm;
      if (Array.from(document.querySelectorAll('.group-title')).some((item) => item.textContent.trim() === '补充程序事项')) throw new Error('自定义事项组删除后仍然存在');
      const undo = document.querySelector('[data-action="undo-activity"]');
      if (!undo) throw new Error('删除自定义事项组后没有撤销入口');
      undo.click();
      if (!Array.from(document.querySelectorAll('.group-title')).some((item) => item.textContent.trim() === '补充程序事项')) throw new Error('撤销后未恢复自定义事项组');
      return { customGroupDeleteUndo: true };
    })()`);
    await win.webContents.executeJavaScript(`document.querySelector('[data-action="add-stage"]').click()`);
    await delay(180);
    const workflowModalImage = await win.webContents.capturePage();
    await fs.writeFile(path.join(TEST_OUTPUT_DIR, 'workflow-modal.png'), workflowModalImage.toPNG());
    await win.webContents.executeJavaScript(`(() => {
      const form = document.querySelector('#workflow-form');
      form.elements.name.value = '财产处置';
      form.elements.groupTitle.value = '处置准备';
      form.elements.firstTaskTitle.value = '拟定财产处置方案';
      form.elements.firstTaskDetail.value = '结合财产类型、权利负担和市场情况制定方案。';
      form.requestSubmit();
      return true;
    })()`);
    await delay(350);
    for (const title of ['核对财产清册', '确认权利负担', '整理询价材料', '形成处置底稿']) {
      await win.webContents.executeJavaScript(`(() => {
        document.querySelector('[data-action="add-task"]').click();
        const form = document.querySelector('#workflow-form');
        form.elements.title.value = ${JSON.stringify(title)};
        form.requestSubmit();
        return true;
      })()`);
      await delay(90);
    }
    await win.webContents.executeJavaScript(`(() => {
      const actualStage = document.querySelector('#actual-stage-select');
      const customOption = Array.from(actualStage.options).find((option) => option.textContent.trim() === '财产处置');
      if (!customOption) throw new Error('新增阶段未进入实际阶段选项');
      actualStage.value = customOption.value;
      actualStage.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await delay(180);
    const customFlowImage = await win.webContents.capturePage();
    await fs.writeFile(path.join(TEST_OUTPUT_DIR, 'custom-flow.png'), customFlowImage.toPNG());
    await win.webContents.executeJavaScript(`(() => {
      document.querySelector('[data-action="edit-task"]').click();
      const form = document.querySelector('#workflow-form');
      form.elements.title.value = '拟定财产处置与拍卖方案';
      form.requestSubmit();
      return true;
    })()`);
    await delay(160);
    await win.webContents.executeJavaScript(`(() => {
      document.querySelector('[data-action="add-task"]').click();
      const form = document.querySelector('#workflow-form');
      form.elements.title.value = '临时测试步骤';
      form.requestSubmit();
      return true;
    })()`);
    await delay(160);
    const taskDeleteUndoResult = await win.webContents.executeJavaScript(`(() => {
      const row = Array.from(document.querySelectorAll('.task-row')).find((item) => item.querySelector('.task-title')?.textContent.trim() === '临时测试步骤');
      const button = row?.querySelector('[data-action="delete-task"]');
      if (!button) throw new Error('找不到可删除的自定义步骤');
      const originalConfirm = window.confirm;
      window.confirm = () => true;
      button.click();
      window.confirm = originalConfirm;
      if (Array.from(document.querySelectorAll('.task-title')).some((item) => item.textContent.trim() === '临时测试步骤')) throw new Error('自定义步骤删除后仍然存在');
      const undo = document.querySelector('[data-action="undo-activity"]');
      if (!undo) throw new Error('删除自定义步骤后没有撤销入口');
      undo.click();
      if (!Array.from(document.querySelectorAll('.task-title')).some((item) => item.textContent.trim() === '临时测试步骤')) throw new Error('撤销后未恢复自定义步骤');
      return { customTaskDeleteUndo: true };
    })()`);
    await delay(180);
    const stageDeleteUndoResult = await win.webContents.executeJavaScript(`(() => {
      const activeStage = document.querySelector('.stage-button.active');
      const stageId = activeStage?.dataset.stageId;
      const stageName = activeStage?.querySelector('.stage-name')?.textContent || '';
      const button = document.querySelector('.stage-content [data-action="delete-stage"]');
      if (!stageId || !stageName.includes('财产处置') || !button) throw new Error('找不到可删除的自定义阶段');
      const originalConfirm = window.confirm;
      window.confirm = () => true;
      button.click();
      window.confirm = originalConfirm;
      if (document.querySelector('.stage-button[data-stage-id="' + CSS.escape(stageId) + '"]')) throw new Error('自定义阶段删除后仍然存在');
      const undo = document.querySelector('[data-action="undo-activity"]');
      if (!undo) throw new Error('删除自定义阶段后没有撤销入口');
      undo.click();
      const restored = document.querySelector('.stage-button[data-stage-id="' + CSS.escape(stageId) + '"]');
      if (!restored) throw new Error('撤销后未恢复自定义阶段');
      restored.click();
      if (document.querySelector('#actual-stage-select')?.value !== stageId) throw new Error('撤销阶段删除后未恢复实际办理阶段');
      return { customStageDeleteUndo: true };
    })()`);
    await delay(180);
    const result = await win.webContents.executeJavaScript(`(() => ({
      title: document.querySelector('.case-hero h2')?.textContent,
      stageCount: document.querySelectorAll('.stage-button').length,
      taskCount: document.querySelectorAll('.task-row').length,
      customStage: document.querySelector('.stage-button.active .stage-name')?.textContent.trim(),
      customControls: Boolean(document.querySelector('[data-action="add-stage"]') && document.querySelector('[data-action="add-group"]') && document.querySelector('[data-action="add-task"]')),
      customTaskTitle: document.querySelector('.task-title')?.textContent,
      actualStage: document.querySelector('#actual-stage-select option:checked')?.textContent.trim(),
      taskStatusOptions: document.querySelector('.task-status-select')?.options.length,
      planDateWording: document.body.textContent.includes('计划办理日') && !document.body.textContent.includes('截止日期') && !document.body.textContent.includes('提醒日期'),
      progress: document.querySelector('.work-progress-bar')?.textContent.trim(),
      statusSummary: Boolean(document.querySelector('.case-status-summary'))
    }))()`);
    await win.webContents.executeJavaScript(`document.querySelector('[data-action="back-to-cases"]').click()`);
    await delay(250);
    const listImage = await win.webContents.capturePage();
    await fs.writeFile(path.join(TEST_OUTPUT_DIR, 'case-list.png'), listImage.toPNG());
    await win.webContents.executeJavaScript(`document.querySelector('[data-action="nav"][data-view="dashboard"]').click()`);
    await delay(250);
    const dashboardWording = await win.webContents.executeJavaScript(`(() => {
      const text = document.body.textContent;
      const result = text.includes('已过计划日') && text.includes('七日内计划') && text.includes('案件关键日期')
        && !text.includes('截止日期') && !text.includes('逾期待办') && !text.includes('七日内到期') && !text.includes('提醒日期');
      if (!result) throw new Error('仪表盘仍存在旧日期语义');
      const overdueCard = document.querySelector('[data-action="open-todo-filter"][data-filter="overdue"]');
      const upcomingCard = document.querySelector('[data-action="open-todo-filter"][data-filter="upcoming"]');
      if (!overdueCard || !upcomingCard) throw new Error('总览日期统计卡不能直达对应待办');
      return result;
    })()`);
    const dashboardImage = await win.webContents.capturePage();
    await fs.writeFile(path.join(TEST_OUTPUT_DIR, 'dashboard.png'), dashboardImage.toPNG());
    const criticalDateTodoResult = await win.webContents.executeJavaScript(`(() => {
      const card = document.querySelector('[data-action="open-todo-filter"][data-filter="upcoming"]');
      if (!card) throw new Error('找不到七日内计划统计卡');
      card.click();
      if (!document.querySelector('[data-action="todo-filter"].active[data-filter="upcoming"]')) throw new Error('统计卡未进入七日内待办');
      const findCaseDate = () => Array.from(document.querySelectorAll('.case-date-todo')).find((item) => item.textContent.includes('某新材料有限公司破产清算案'));
      const item = findCaseDate();
      if (!item) throw new Error('案件关键日期未进入总览统计卡对应的待办列表');
      const statusButton = item.querySelector('[data-action="set-case-date-status"][data-handled="true"]');
      const caseId = statusButton?.dataset.caseId;
      const displayedDate = item.querySelector('small')?.textContent.split('·').pop().trim();
      if (!statusButton || !caseId || !displayedDate) throw new Error('案件关键日期待办缺少标记已处理入口或日期');
      statusButton.click();
      if (findCaseDate()) throw new Error('案件关键日期标记已处理后仍留在待办列表');
      document.querySelector('[data-action="nav"][data-view="cases"]').click();
      const caseRow = document.querySelector('[data-action="open-case"][data-case-id="' + CSS.escape(caseId) + '"]');
      if (!caseRow) throw new Error('关键日期处理后找不到原案件');
      caseRow.click();
      const keyDate = document.querySelector('.case-key-date');
      if (!keyDate || !keyDate.textContent.includes(displayedDate) || !keyDate.textContent.includes('已处理')) throw new Error('标记已处理后案件详情未保留关键日期及状态');
      document.querySelector('[data-action="edit-case"]').click();
      const editForm = document.querySelector('#case-form');
      if (!editForm?.elements.importantDate.value) throw new Error('标记已处理后编辑资料未保留关键日期');
      document.querySelector('#case-dialog [data-action="close-modal"]').click();
      document.querySelector('[data-action="data-center"]').click();
      document.querySelector('[data-action="data-center-tab"][data-tab="activity"]').click();
      const activity = Array.from(document.querySelectorAll('.activity-row')).find((row) => row.textContent.includes('将案件关键日期标记为已处理'));
      const undo = activity?.querySelector('[data-action="undo-activity"]');
      if (!undo) throw new Error('最近操作中没有关键日期状态的撤销入口');
      undo.click();
      document.querySelector('#about-dialog [data-action="close-modal"]').click();
      document.querySelector('[data-action="nav"][data-view="todos"]').click();
      if (!document.querySelector('[data-action="todo-filter"].active[data-filter="upcoming"]')) document.querySelector('[data-action="todo-filter"][data-filter="upcoming"]')?.click();
      if (!findCaseDate()) throw new Error('撤销后案件关键日期未恢复到待办列表');
      const workday = document.querySelector('[data-action="todo-filter"][data-filter="workday"]');
      if (!workday) throw new Error('关键日期验证后无法返回今日工作');
      workday.click();
      return { criticalDateFromDashboard: true, criticalDateResolved: true, criticalDatePreservedInDetail: true, criticalDatePreservedInEdit: true, criticalDateActivityUndo: true, criticalDateUndo: true };
    })()`);
    await win.webContents.executeJavaScript(`document.querySelector('[data-action="nav"][data-view="todos"]').click()`);
    await delay(300);
      const todoResult = await win.webContents.executeJavaScript(`(() => {
      const filters = document.querySelectorAll('[data-action="todo-filter"]');
      const scopeFilters = document.querySelectorAll('.todo-scope-filters select');
      const task = document.querySelector('.todo-item.task-todo');
      if (!task) throw new Error('今日工作中未显示可办理任务');
      if (!document.querySelector('[data-action="todo-filter"].active[data-filter="workday"]')) throw new Error('待办默认页不是今日工作');
      if (filters.length < 8) throw new Error('待办筛选项不完整');
      if (scopeFilters.length !== 0) throw new Error('单案件、单类型、单承办人时不应显示多余的范围筛选');
      const conditionPrompt = document.querySelector('.workday-conditions');
      if (!conditionPrompt?.querySelector('.condition-todo')) throw new Error('今日工作未单独显示当前条件确认');
      if (document.querySelector('.todo-panel .condition-todo')) throw new Error('条件确认被混入今日任务清单');
      const quickRecord = task.querySelector('.todo-quick-record');
      if (!quickRecord || quickRecord.open) throw new Error('待办快速记录未默认折叠');
      const quickNote = quickRecord.querySelector('.task-note');
      if (!quickNote || quickNote.maxLength !== 300) throw new Error('待办快速备注未限制为 300 字');
      const namedTasks = Array.from(document.querySelectorAll('.todo-item.task-todo')).filter((item) => item.textContent.includes('某新材料有限公司破产清算案') && item.textContent.includes('未设计划办理日'));
      const overflow = Array.from(document.querySelectorAll('.todo-more-row')).find((item) => item.textContent.includes('某新材料有限公司破产清算案'));
      if (namedTasks.length !== 3 || !overflow || !/另有 [1-9]\d* 项未排期事项/.test(overflow.textContent)) return { debugError: '今日工作没有按案件收起超过三项的未排期事项', namedCount: namedTasks.length, overflow: overflow?.textContent || '', all: document.querySelector('.todo-list')?.textContent || '' };
      const taskSelect = task.querySelector('.task-status-select');
      const taskId = taskSelect.dataset.taskId;
      taskSelect.value = 'review';
      taskSelect.dispatchEvent(new Event('change', { bubbles: true }));
      return { filters: filters.length, scopeFilters: scopeFilters.length, taskId, workdayPerCaseLimit: true, workdayOverflowHint: true, workdayConditionsSeparate: true, quickRecordCollapsed: true, quickNoteMaxLength: quickNote.maxLength };
    })()`);
    if (todoResult.debugError) throw new Error(`${todoResult.debugError}: ${JSON.stringify(todoResult)}`);
    await delay(220);
    const todoStateResult = await win.webContents.executeJavaScript(`(() => {
      const reviewSelect = document.querySelector('.todo-item.task-todo .task-status-select option:checked[value="review"]')?.parentElement;
      if (!reviewSelect) throw new Error('待办快速状态未回写');
      return { quickStatus: true, focusedDailyQueue: true };
    })()`);
    await win.webContents.executeJavaScript(`document.querySelector('[data-action="todo-filter"][data-filter="conditions"]').click()`);
    await delay(180);
    const conditionQueueResult = await win.webContents.executeJavaScript(`(() => {
      const conditionSelect = document.querySelector('.todo-item.condition-todo select');
      if (!conditionSelect || conditionSelect.value !== 'undecided') throw new Error('当前阶段的条件待确认未显示');
      const conditionId = conditionSelect.dataset.stageId || conditionSelect.dataset.groupId;
      const conditionKind = conditionSelect.matches('.stage-applicability') ? 'stage' : 'group';
      conditionSelect.value = 'included';
      conditionSelect.dispatchEvent(new Event('change', { bubbles: true }));
      return { conditionId, conditionKind };
    })()`);
    await delay(220);
    const todoApplicabilityResult = await win.webContents.executeJavaScript(`(() => {
      const selector = '${conditionQueueResult.conditionKind}' === 'stage'
        ? '.stage-applicability[data-stage-id="${conditionQueueResult.conditionId}"]'
        : '.group-applicability[data-group-id="${conditionQueueResult.conditionId}"]';
      if (document.querySelector(selector)) throw new Error('已处理的条件项仍留在待确认列表');
      return { currentConditionHandled: true };
    })()`);
    const todosImage = await win.webContents.capturePage();
    await fs.writeFile(path.join(TEST_OUTPUT_DIR, 'todos.png'), todosImage.toPNG());
    await win.webContents.executeJavaScript(`document.querySelector('[data-action="data-center"]').click()`);
    await delay(350);
    const storageResult = await win.webContents.executeJavaScript(`(() => {
      const dialog = document.querySelector('#about-dialog');
      if (!dialog?.open || !dialog.textContent.includes('完整备份') || !dialog.textContent.includes('换电脑只需三步') || !dialog.textContent.includes('Excel 案件清单') || !dialog.textContent.includes('不能用来恢复台账')) throw new Error('数据中心未显示简明备份和换机指引');
      if (dialog.querySelectorAll('[data-action="data-center-tab"]').length !== 3) throw new Error('数据中心不是三页签结构');
      const backups = document.querySelector('#local-backups');
      if (!backups || backups.textContent.includes('正在读取')) throw new Error('本地恢复点区域未完成加载');
      const health = dialog.querySelector('#storage-health-panel .storage-health-card');
      if (!health || !health.matches('.healthy, .warning') || !/(状态正常|需要留意)/.test(health.textContent)) throw new Error('数据中心未显示明确的本机保存健康状态');
      return { dataCenterTabs: true, storageHealthVisible: true, storageHealthTone: health.classList.contains('warning') ? 'warning' : 'healthy', completeBackup: true, excelListNonRestorable: true, localBackupArea: true, localBackupText: backups.textContent.trim() };
    })()`);
    const dataBackupImage = await win.webContents.capturePage();
    await fs.writeFile(path.join(TEST_OUTPUT_DIR, 'data-backup.png'), dataBackupImage.toPNG());
    await win.webContents.executeJavaScript(`document.querySelector('#about-dialog [data-action="close-modal"]').click()`);
    await delay(150);
    await win.webContents.executeJavaScript(`document.querySelector('[data-action="nav"][data-view="templates"]').click()`);
    await delay(300);
    const bankruptcyTemplateResult = await win.webContents.executeJavaScript(`(() => {
      const bankruptcyButton = document.querySelector('[data-template-id="bankruptcy-workflow-v1"]');
      const card = bankruptcyButton?.closest('.template-card')
        || Array.from(document.querySelectorAll('.template-card')).find((item) => item.textContent.includes('破产清算'));
      if (!card) throw new Error('模板库未显示破产模板');
      if (!card.textContent.includes('207') || !card.textContent.includes('核对')) throw new Error('破产模板缺少 207 步骤或核对日期');
      return { bankruptcyTemplate207: true, bankruptcyTemplateReviewDate: true };
    })()`);
    const bankruptcyCompleteTemplateImage = await win.webContents.capturePage();
    await fs.writeFile(path.join(TEST_OUTPUT_DIR, 'bankruptcy-complete-template.png'), bankruptcyCompleteTemplateImage.toPNG());
    const templateLibraryImage = await win.webContents.capturePage();
    await fs.writeFile(path.join(TEST_OUTPUT_DIR, 'template-library.png'), templateLibraryImage.toPNG());
    const libraryResult = await win.webContents.executeJavaScript(`(() => ({
      templateCards: document.querySelectorAll('.template-card').length,
      categorySections: document.querySelectorAll('.template-category-section').length,
      civilTemplate: Boolean(document.querySelector('.template-symbol.category-civil'))
    }))()`);
    await win.webContents.executeJavaScript(`(() => {
      const card = document.querySelector('.template-symbol.category-civil')?.closest('.template-card');
      const button = card?.querySelector('[data-action="new-case-with-template"]');
      if (!button) throw new Error('民事诉讼模板未加载');
      button.click();
      return true;
    })()`);
    await delay(180);
    const newCaseImage = await win.webContents.capturePage();
    await fs.writeFile(path.join(TEST_OUTPUT_DIR, 'new-case-template-picker.png'), newCaseImage.toPNG());
    await win.webContents.executeJavaScript(`(() => {
      const form = document.querySelector('#case-form');
      if (document.querySelectorAll('.case-create-step-head').length !== 2 || !document.querySelector('#recommended-template-name')) throw new Error('新建案件未按两步引导');
      const moreTemplates = document.querySelector('details.template-picker-more');
      if (!moreTemplates || moreTemplates.open) throw new Error('更多模板选项未默认收起');
      const moreFields = document.querySelector('details.case-more-fields');
      if (!moreFields || moreFields.open) throw new Error('非必填资料未默认收起');
      if (!form.textContent.includes('不会自动生成任务计划办理日')) throw new Error('案件关键日期缺少用途说明');
      form.elements.name.value = '某买卖合同纠纷案';
      form.elements.companyName.value = '某科技有限公司';
      form.elements.caseNumber.value = '（2026）某民初测试号';
      form.elements.manager.value = '承办律师';
      form.requestSubmit();
      return true;
    })()`);
    await delay(400);
    const civilDetailImage = await win.webContents.capturePage();
    await fs.writeFile(path.join(TEST_OUTPUT_DIR, 'civil-case-detail.png'), civilDetailImage.toPNG());
    const conditionalInitial = await win.webContents.executeJavaScript(`(() => {
      const appealStage = document.querySelector('.stage-button[data-stage-id="civil-plaintiff-appeal"]');
      if (!appealStage) throw new Error('民事模板缺少二审条件阶段');
      if (!appealStage.textContent.includes('待确认')) throw new Error('条件阶段未显示待确认');
      appealStage.click();
      return true;
    })()`);
    await delay(180);
    const conditionalIncluded = await win.webContents.executeJavaScript(`(() => {
      const applicability = document.querySelector('.stage-applicability[data-stage-id="civil-plaintiff-appeal"]');
      if (!applicability || applicability.value !== 'undecided') throw new Error('条件阶段初始状态不是待确认');
      if (!document.querySelector('.undecided-notice')) throw new Error('缺少条件阶段待确认提示');
      applicability.value = 'included';
      applicability.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await delay(180);
    await win.webContents.executeJavaScript(`(() => {
      const applicability = document.querySelector('.stage-applicability[data-stage-id="civil-plaintiff-appeal"]');
      if (!applicability || applicability.value !== 'included') throw new Error('条件阶段未切换为适用');
      const actualStage = document.querySelector('#actual-stage-select');
      actualStage.value = 'civil-plaintiff-appeal';
      actualStage.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await delay(180);
    const conditionalExcluded = await win.webContents.executeJavaScript(`(() => {
      const actualStage = document.querySelector('#actual-stage-select');
      if (actualStage.value !== 'civil-plaintiff-appeal') throw new Error('实际阶段未独立切换到二审');
      const applicability = document.querySelector('.stage-applicability[data-stage-id="civil-plaintiff-appeal"]');
      applicability.value = 'excluded';
      applicability.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await delay(180);
    const civilResult = await win.webContents.executeJavaScript(`(() => {
      const applicability = document.querySelector('.stage-applicability[data-stage-id="civil-plaintiff-appeal"]');
      const result = {
        civilCaseType: document.querySelector('.case-hero')?.textContent.includes('民事诉讼'),
        civilStageCount: document.querySelectorAll('.stage-button').length,
        civilTaskCount: document.querySelectorAll('.task-row').length,
        conditionalInitial: true,
        conditionalIncluded: true,
        conditionalExcluded: true,
        conditionalStageValue: applicability?.value,
        conditionalStageDisabled: Boolean(document.querySelector('.task-status-select:disabled')),
        actualStageCleared: document.querySelector('#actual-stage-select')?.value === '',
        civilPlanDateWording: document.body.textContent.includes('计划办理日') && !document.body.textContent.includes('截止日期') && !document.body.textContent.includes('提醒日期')
      };
      if (result.conditionalStageValue !== 'excluded' || !result.conditionalStageDisabled || !result.actualStageCleared) throw new Error('条件阶段不适用状态未完整生效');
      if (!result.civilPlanDateWording) throw new Error('民事案件页仍存在旧日期文案');
      return result;
    })()`);
    const recycleUndoResult = await win.webContents.executeJavaScript(`(() => {
      document.querySelector('[data-action="edit-case"]').click();
      window.confirm = () => true;
      document.querySelector('[data-action="delete-case"]').click();
      if (!document.querySelector('[data-action="undo-activity"]')) throw new Error('案件移至最近删除后未提供撤销');
      document.querySelector('[data-action="undo-activity"]').click();
      const restored = Array.from(document.querySelectorAll('.case-table tbody tr, .case-card')).some((item) => item.textContent.includes('某买卖合同纠纷案'));
      if (!restored) throw new Error('撤销删除后案件未恢复');
      return { recycleUndo: true };
    })()`);
    await delay(180);
    await win.webContents.executeJavaScript(`(() => {
      const row = Array.from(document.querySelectorAll('.case-table tbody tr, .case-card')).find((item) => item.textContent.includes('某买卖合同纠纷案'));
      if (!row) throw new Error('找不到恢复后的民事案件');
      row.click();
      document.querySelector('[data-action="edit-case"]').click();
      window.confirm = () => true;
      document.querySelector('[data-action="delete-case"]').click();
      document.querySelector('[data-action="data-center"]').click();
      document.querySelector('[data-action="data-center-tab"][data-tab="deleted"]').click();
      const recycled = Array.from(document.querySelectorAll('.recycle-row')).find((item) => item.textContent.includes('某买卖合同纠纷案'));
      if (!recycled) throw new Error('最近删除中未显示案件');
      recycled.querySelector('[data-action="restore-recycled-case"]').click();
      return true;
    })()`);
    await delay(220);
    const recycleRestoreResult = await win.webContents.executeJavaScript(`(() => {
      document.querySelector('[data-action="data-center-tab"][data-tab="activity"]').click();
      const activity = Array.from(document.querySelectorAll('.activity-row')).some((item) => item.textContent.includes('恢复案件'));
      if (!activity) throw new Error('恢复案件后最近操作未留痕');
      document.querySelector('#about-dialog [data-action="close-modal"]').click();
      document.querySelector('[data-action="nav"][data-view="cases"]').click();
      const restored = Array.from(document.querySelectorAll('.case-table tbody tr')).find((item) => item.textContent.includes('某买卖合同纠纷案'));
      if (!restored) throw new Error('从最近删除恢复后案件未返回列表');
      restored.click();
      return { recycleRestore: true, restoreActivity: true };
    })()`);
    await win.webContents.executeJavaScript(`document.querySelector('[data-action="save-case-template"]').click()`);
    await delay(120);
    await win.webContents.executeJavaScript(`document.querySelector('#save-case-template-form').requestSubmit()`);
    await delay(250);
    await win.webContents.executeJavaScript(`document.querySelector('[data-action="nav"][data-view="templates"]').click()`);
    await delay(250);
    const templateDeleteUndoResult = await win.webContents.executeJavaScript(`(() => {
      const customCard = document.querySelector('.template-card .badge-violet')?.closest('.template-card');
      const button = customCard?.querySelector('[data-action="delete-template"]');
      const templateId = button?.dataset.templateId;
      if (!templateId) throw new Error('找不到可删除的自定义模板');
      const originalConfirm = window.confirm;
      window.confirm = () => true;
      button.click();
      window.confirm = originalConfirm;
      if (document.querySelector('[data-action="edit-template"][data-template-id="' + CSS.escape(templateId) + '"]')) throw new Error('自定义模板删除后仍然存在');
      const undo = document.querySelector('[data-action="undo-activity"]');
      if (!undo) throw new Error('删除自定义模板后没有撤销入口');
      undo.click();
      if (!document.querySelector('[data-action="edit-template"][data-template-id="' + CSS.escape(templateId) + '"]')) throw new Error('撤销后未恢复自定义模板');
      return { customTemplateDeleteUndo: true };
    })()`);
    const savedTemplateResult = await win.webContents.executeJavaScript(`(() => ({
      customTemplates: document.querySelectorAll('.template-card .badge-violet').length
    }))()`);
    await win.webContents.executeJavaScript(`(() => {
      const customCard = document.querySelector('.template-card .badge-violet')?.closest('.template-card');
      const edit = customCard?.querySelector('[data-action="edit-template"]');
      if (!edit) throw new Error('保存的自定义模板未出现在模板库');
      edit.click();
      return true;
    })()`);
    await delay(250);
    const templateEditorImage = await win.webContents.capturePage();
    await fs.writeFile(path.join(TEST_OUTPUT_DIR, 'template-editor.png'), templateEditorImage.toPNG());
    await win.webContents.executeJavaScript(`(() => {
      document.querySelector('[data-action="add-task"]').click();
      const form = document.querySelector('#workflow-form');
      form.elements.title.value = '本所自定义复核步骤';
      form.elements.optional.checked = true;
      form.requestSubmit();
      return true;
    })()`);
    await delay(180);
    const draftGuardResult = await win.webContents.executeJavaScript(`(() => {
      let asked = 0;
      window.confirm = () => { asked += 1; return false; };
      document.querySelector('[data-action="nav"][data-view="dashboard"]').click();
      if (!asked || !document.querySelector('.template-editor-hero') || !document.body.textContent.includes('本所自定义复核步骤')) throw new Error('模板未保存离开保护未生效');
      return { templateDraftGuard: true };
    })()`);
    await win.webContents.executeJavaScript(`document.querySelector('[data-action="save-template"]').click()`);
    await delay(300);
    const editorResult = await win.webContents.executeJavaScript(`(() => ({
      templateEditor: Boolean(document.querySelector('.template-editor-hero')),
      customTemplateTask: document.body.textContent.includes('本所自定义复核步骤')
    }))()`);
    process.stdout.write(`${JSON.stringify({ ok: true, ...startupResult, ...missingTemplateResult, ...bankruptcyResult, ...caseSearchResult, ...workflowDirtyResult, ...groupDeleteUndoResult, ...taskDeleteUndoResult, ...stageDeleteUndoResult, ...result, dashboardWording, ...criticalDateTodoResult, ...todoResult, ...todoStateResult, ...conditionQueueResult, ...todoApplicabilityResult, ...storageResult, ...bankruptcyTemplateResult, ...libraryResult, ...civilResult, ...recycleUndoResult, ...recycleRestoreResult, ...templateDeleteUndoResult, ...savedTemplateResult, ...draftGuardResult, ...editorResult })}\n`);
    app.exit(0);
  } catch (error) {
    process.stderr.write(`Smoke test failed: ${error.stack || error.message}\n`);
    app.exit(1);
  }
}

function dateStamp() {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function registerIpc() {
  ipcMain.on('window:close-ready', (event, payload) => {
    try {
      assertTrustedIpcEvent(event);
    } catch (_error) {
      return;
    }
    const win = BrowserWindow.fromWebContents(event.sender);
    const pending = win?.__caseTrackerPendingClose;
    if (!win || !pending || payload?.requestId !== pending.requestId) return;
    if (payload?.ok === true) destroyAfterSave(win);
    else void resolveCloseProblem(win, pending.requestId, payload?.message || '页面未能完成保存');
  });
  ipcMain.handle('state:load', trustedIpc(() => storage.loadState()));
  ipcMain.handle('state:save', trustedIpc((_event, state) => storage.saveState(state)));
  ipcMain.handle('app:data-path', trustedIpc(() => getStatePath()));
  ipcMain.handle('storage:info', trustedIpc(() => storage.getStorageInfo()));
  ipcMain.handle('storage:health', trustedIpc(() => storage.getStorageHealth()));
  ipcMain.handle('backup:list', trustedIpc(() => storage.listBackups()));
  ipcMain.handle('backup:restore', trustedIpc((_event, id) => storage.restoreBackup(id)));

  ipcMain.handle('backup:export', trustedIpc(async (_event, state) => {
    const result = await dialog.showSaveDialog({
      title: '导出台账备份',
      defaultPath: `法律案件台账备份-${dateStamp()}.json`,
      filters: [{ name: '台账备份文件', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const exported = await storage.exportBackup(result.filePath, state);
    return { canceled: false, ...exported, revealToken: rememberExportPath(result.filePath) };
  }));

  ipcMain.handle('backup:inspect-import', trustedIpc(async () => {
    const result = await dialog.showOpenDialog({
      title: '导入台账备份',
      properties: ['openFile'],
      filters: [{ name: '台账备份文件', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    return { canceled: false, ...(await storage.inspectImport(result.filePaths[0])) };
  }));
  ipcMain.handle('backup:apply-import', trustedIpc((_event, token) => storage.applyImport(token)));

  ipcMain.handle('file:export-text', trustedIpc(async (_event, payload) => {
    const requestedExtension = path.extname(String(payload?.defaultName || '')).toLowerCase();
    if (!['.csv', '.txt'].includes(requestedExtension)) throw new Error('只能导出 CSV 或 TXT 文件');
    const result = await dialog.showSaveDialog({
      title: String(payload?.title || '导出文件').slice(0, 100),
      defaultPath: path.basename(String(payload.defaultName)),
      filters: requestedExtension === '.txt'
        ? [{ name: '文本文件', extensions: ['txt'] }]
        : [{ name: 'CSV 表格', extensions: ['csv'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const exported = await storage.exportText(result.filePath, payload);
    return { canceled: false, ...exported, revealToken: rememberExportPath(result.filePath) };
  }));
  ipcMain.handle('file:show-export-in-folder', trustedIpc((_event, token) => showRecentExport(token)));
}

if (hasSingleInstanceLock) app.whenReady().then(async () => {
  app.setAppUserModelId('local.legal.case.tracker');
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  initializeStorage();
  registerIpc();
  if (RECOVERY_SMOKE_TEST) await prepareRecoverySmokeFixture();
  else if (CLOSE_SMOKE_TEST) await prepareCloseSmokeFixture();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
