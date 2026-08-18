const fsPromises = require('node:fs/promises');
const fsConstants = require('node:fs').constants;
const path = require('node:path');
const crypto = require('node:crypto');

const STATE_FILE_NAME = 'case-tracker-data.json';
const BACKUP_DIRECTORY_NAME = 'backups';
const LEGACY_PROTECTED_DIRECTORY_NAME = 'legacy-protected';
const MAX_STATE_BYTES = 25 * 1024 * 1024;
// A recovery file contains the validated state inside a small metadata
// envelope. Pretty-printing that nested object also adds indentation to every
// state line, so a valid state close to 25 MiB can legitimately produce a
// larger recovery file. Keep a separate container limit while continuing to
// validate the unwrapped state against MAX_STATE_BYTES.
const MAX_BACKUP_BYTES = (MAX_STATE_BYTES * 2) + (64 * 1024);
const MAX_EXPORT_TEXT_BYTES = 10 * 1024 * 1024;
const MAX_DAILY_BACKUPS = 14;
const MAX_RECOVERY_BACKUPS = 10;
const MAX_CORRUPT_BACKUPS = 5;
const MAX_BACKUP_TOTAL_BYTES = 300 * 1024 * 1024;
const IMPORT_TOKEN_TTL_MS = 15 * 60 * 1000;
const BACKUP_FORMAT = 'legal-case-tracker-backup';
const BACKUP_FORMAT_VERSION = 1;
const LOCAL_ENCRYPTED_FORMAT = 'legal-case-tracker-local-encrypted';
const LOCAL_ENCRYPTED_FORMAT_VERSION = 1;
const MAX_OPAQUE_CORRUPT_BYTES = MAX_STATE_BYTES;

// Base64 and the small JSON wrapper make an old OS-bound container larger
// than its plaintext. Recovery-point plaintext can legitimately be larger
// than a state file because it contains the state inside an envelope, so the
// container limit must follow the declared payload type as well.
function encryptedContainerLimit(plaintextLimit) {
  return Math.ceil(plaintextLimit * 1.5) + (64 * 1024);
}

const MAX_LOCAL_ENCRYPTED_BYTES = encryptedContainerLimit(MAX_STATE_BYTES);
const MAX_LOCAL_ENCRYPTED_BACKUP_BYTES = encryptedContainerLimit(MAX_BACKUP_BYTES);

function plaintextLimitForPayloadType(payloadType) {
  if (payloadType === 'backup') return MAX_BACKUP_BYTES;
  if (payloadType === 'opaque-corrupt') return MAX_OPAQUE_CORRUPT_BYTES;
  return MAX_STATE_BYTES;
}

function encryptedLimitForPayloadType(payloadType) {
  return encryptedContainerLimit(plaintextLimitForPayloadType(payloadType));
}

function byteLength(value) {
  return Buffer.byteLength(value, 'utf8');
}

function stateDigest(state) {
  return crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex');
}

function textDigest(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function isLocalEncryptedContainer(value) {
  return Boolean(value && typeof value === 'object' && value.format === LOCAL_ENCRYPTED_FORMAT);
}

function validateLocalEncryptedContainer(value) {
  if (!isLocalEncryptedContainer(value)) return value;
  if (value.formatVersion !== LOCAL_ENCRYPTED_FORMAT_VERSION) throw new Error('本机加密文件版本不受支持');
  if (value.protection !== 'os-bound' || value.encoding !== 'base64') throw new Error('本机加密文件保护信息无效');
  if (!['state', 'backup', 'opaque-corrupt'].includes(value.payloadType)) throw new Error('本机加密文件内容类型无效');
  if (typeof value.ciphertext !== 'string' || !value.ciphertext.length || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.ciphertext)) {
    throw new Error('本机加密文件密文无效');
  }
  return value;
}

function localDateStamp(value = new Date()) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function safeTimestamp(value = new Date()) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().replace(/[:.]/g, '-');
}

function backupEnvelope(state, reason, createdAt = new Date().toISOString()) {
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt,
    reason,
    encrypted: false,
    checksum: { algorithm: 'sha256', value: stateDigest(state) },
    state
  };
}

function unwrapBackup(value) {
  if (value && typeof value === 'object' && value.format === BACKUP_FORMAT) {
    if (value.formatVersion !== BACKUP_FORMAT_VERSION || !value.state) {
      throw new Error('备份文件格式或版本不受支持');
    }
    let integrity = 'unverified';
    if (value.checksum !== undefined) {
      if (value.checksum?.algorithm !== 'sha256' || !/^[a-f0-9]{64}$/i.test(String(value.checksum?.value || ''))) {
        throw new Error('备份完整性校验信息无效');
      }
      if (stateDigest(value.state) !== value.checksum.value.toLowerCase()) throw new Error('备份完整性校验失败，文件可能已损坏或被修改');
      integrity = 'verified';
    }
    return {
      state: value.state,
      envelope: true,
      metadata: value,
      integrity,
      warnings: integrity === 'unverified' ? ['旧版备份不含完整性校验值'] : []
    };
  }
  return { state: value, envelope: false, metadata: null, integrity: 'legacy', warnings: ['旧版裸台账文件不含完整性校验值'] };
}

function fallbackValidateState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('台账数据必须是 JSON 对象');
  if (!Array.isArray(state.cases)) throw new Error('台账数据缺少 cases 数组');
  if (state.customTemplates !== undefined && !Array.isArray(state.customTemplates)) throw new Error('customTemplates 必须是数组');
  return state;
}

function validateWithModel(state, model) {
  const validate = model && typeof model.validateState === 'function' ? model.validateState : fallbackValidateState;
  const result = validate(state);
  if (result === false) throw new Error('台账数据未通过验证');
  if (result && typeof result === 'object') {
    if (result.valid === false || result.ok === false) {
      const detail = result.error || result.message || (Array.isArray(result.errors)
        ? result.errors.map((item) => item?.message || item?.code || String(item)).join('；')
        : '');
      throw new Error(detail || '台账数据未通过验证');
    }
    if (result.state && typeof result.state === 'object') return result.state;
    if (result.value && typeof result.value === 'object') return result.value;
  }
  return state;
}

function serializeValidatedState(state, model) {
  const validated = validateWithModel(state, model);
  const text = JSON.stringify(validated, null, 2);
  const size = byteLength(text);
  if (size > MAX_STATE_BYTES) throw new Error(`台账数据超过 ${MAX_STATE_BYTES / 1024 / 1024} MiB 上限`);
  return { state: validated, text, size };
}

async function readRegularFile(fs, filePath, maxBytes = MAX_STATE_BYTES) {
  const stat = await fs.lstat(filePath);
  if (!stat.isFile()) throw new Error('所选路径不是普通文件');
  if (stat.size > maxBytes) throw new Error(`文件超过 ${Math.floor(maxBytes / 1024 / 1024)} MiB 上限`);
  const text = await fs.readFile(filePath, 'utf8');
  if (byteLength(text) > maxBytes) throw new Error(`文件超过 ${Math.floor(maxBytes / 1024 / 1024)} MiB 上限`);
  return text;
}

function createStorageService(options) {
  const fs = options.fs || fsPromises;
  const dataDirectory = path.resolve(options.dataDirectory);
  const statePath = path.join(dataDirectory, options.stateFileName || STATE_FILE_NAME);
  const backupDirectory = path.join(dataDirectory, BACKUP_DIRECTORY_NAME);
  const legacyProtectedDirectory = path.join(dataDirectory, LEGACY_PROTECTED_DIRECTORY_NAME);
  const model = options.model || null;
  const now = options.now || (() => new Date());
  const randomId = options.randomId || (() => crypto.randomBytes(16).toString('hex'));
  const maxBackupTotalBytes = options.maxBackupTotalBytes || MAX_BACKUP_TOTAL_BYTES;
  // Local JSON is the only write format. `legacyCodec` is deliberately
  // read-only and is consulted only when an old OS-bound container is found.
  // Keep the old `codec` option as a compatibility alias for callers/tests.
  const legacyCodec = options.legacyCodec || options.codec || null;
  const pendingImports = new Map();
  const healthWarnings = new Map();
  const health = {
    stateStatus: 'unknown',
    readable: null,
    mainFileError: null,
    automaticBackup: {
      status: 'unknown',
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastRepairAt: null,
      repairArchive: null,
      error: null
    },
    encryption: {
      mode: 'local-json',
      available: null,
      migration: { status: legacyCodec ? 'not-needed' : 'not-configured', migrated: 0, remaining: 0, error: null }
    },
    legacyMigration: { status: 'not-needed', migrated: 0, remaining: 0, error: null }
  };
  let writeQueue = Promise.resolve();
  let activeSaveBatch = null;
  let tempSequence = 0;
  let codecProbe = null;

  async function ensureEncryptionAvailable() {
    if (!legacyCodec) return false;
    if (codecProbe) return codecProbe;
    codecProbe = (async () => {
      let available = true;
      try {
        if (typeof legacyCodec.isAvailable === 'function') available = Boolean(await legacyCodec.isAvailable());
        if (!available) throw new Error('系统安全存储没有报告可用状态');
      } catch (error) {
        health.encryption.available = false;
        health.encryption.migration.error = error.message;
        codecProbe = null;
        throw new Error(`系统安全存储暂不可用：${error.message}`);
      }
      health.encryption.available = true;
      return true;
    })();
    return codecProbe;
  }

  function normalizeDecrypted(result) {
    if (typeof result === 'string') return { text: result, shouldReEncrypt: false };
    if (result && typeof result.result === 'string') return { text: result.result, shouldReEncrypt: Boolean(result.shouldReEncrypt) };
    if (result && typeof result.text === 'string') return { text: result.text, shouldReEncrypt: Boolean(result.shouldReEncrypt) };
    throw new Error('系统安全存储返回了无效的解密结果');
  }

  async function decodeLocalContainer(container, expectedPayloadType = null) {
    validateLocalEncryptedContainer(container);
    if (expectedPayloadType && container.payloadType !== expectedPayloadType) {
      throw new Error(`本机加密文件内容类型不符：应为 ${expectedPayloadType}，实际为 ${container.payloadType}`);
    }
    if (!legacyCodec) throw new Error('检测到旧版受保护数据，但当前程序无法访问系统安全存储');
    await ensureEncryptionAvailable();
    let decrypted;
    try {
      decrypted = normalizeDecrypted(await legacyCodec.decrypt(Buffer.from(container.ciphertext, 'base64')));
    } catch (error) {
      throw new Error(`无法使用系统密钥解密本机数据：${error.message}`);
    }
    const plaintextLimit = plaintextLimitForPayloadType(container.payloadType);
    if (byteLength(decrypted.text) > plaintextLimit) {
      throw new Error(`解密后的本机数据超过 ${Math.floor(plaintextLimit / 1024 / 1024)} MiB 上限`);
    }
    return { ...decrypted, payloadType: container.payloadType };
  }

  async function readLocalText(filePath, maxPlaintextBytes = MAX_STATE_BYTES) {
    const maxContainerBytes = Math.max(encryptedContainerLimit(maxPlaintextBytes), maxPlaintextBytes);
    const rawText = await readRegularFile(fs, filePath, maxContainerBytes);
    let parsed;
    try { parsed = JSON.parse(rawText); } catch (_error) { parsed = null; }
    if (!isLocalEncryptedContainer(parsed)) {
      if (byteLength(rawText) > maxPlaintextBytes) {
        throw new Error(`文件超过 ${Math.floor(maxPlaintextBytes / 1024 / 1024)} MiB 上限`);
      }
      return { text: rawText, encrypted: false, shouldReEncrypt: false, payloadType: null };
    }
    const decrypted = await decodeLocalContainer(parsed);
    return { text: decrypted.text, encrypted: true, shouldReEncrypt: decrypted.shouldReEncrypt, payloadType: decrypted.payloadType };
  }

  function recordHealthWarning(code, message) {
    healthWarnings.set(code, { code, message, at: now().toISOString() });
  }

  function clearHealthWarning(code) {
    healthWarnings.delete(code);
  }

  function appendToWriteQueue(operation) {
    const result = writeQueue.then(operation, operation);
    writeQueue = result.catch(() => undefined);
    return result;
  }

  function enqueue(operation) {
    // Imports, restores and explicit backup operations are ordering barriers.
    // Saves submitted after one of these calls must form a new batch so they
    // cannot jump ahead of that operation.
    if (activeSaveBatch) activeSaveBatch.accepting = false;
    return appendToWriteQueue(operation);
  }

  async function atomicWrite(filePath, text, verifyTemporary = null) {
    await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    tempSequence += 1;
    const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${tempSequence}-${randomId()}`;
    let handle;
    try {
      handle = await fs.open(tempPath, 'wx', 0o600);
      if (Buffer.isBuffer(text)) await handle.writeFile(text);
      else await handle.writeFile(text, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      if (verifyTemporary) await verifyTemporary(await fs.readFile(tempPath, 'utf8'));
      await fs.rename(tempPath, filePath);
      await enforceMode(filePath, 0o600);
    } catch (error) {
      if (handle) await handle.close().catch(() => undefined);
      await fs.unlink(tempPath).catch(() => undefined);
      throw error;
    }
  }

  async function atomicCopyFile(sourcePath, targetPath) {
    await fs.mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
    tempSequence += 1;
    const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}-${tempSequence}-${randomId()}`;
    let handle;
    try {
      await fs.copyFile(sourcePath, tempPath, fsConstants.COPYFILE_EXCL);
      const [sourceStat, temporaryStat] = await Promise.all([fs.lstat(sourcePath), fs.lstat(tempPath)]);
      if (!sourceStat.isFile() || !temporaryStat.isFile() || sourceStat.size !== temporaryStat.size) {
        throw new Error('文件副本大小校验失败');
      }
      handle = await fs.open(tempPath, 'r');
      await handle.sync();
      await handle.close();
      handle = null;
      await fs.rename(tempPath, targetPath);
      await enforceMode(targetPath, 0o600);
    } catch (error) {
      if (handle) await handle.close().catch(() => undefined);
      await fs.unlink(tempPath).catch(() => undefined);
      throw error;
    }
  }

  async function enforceMode(filePath, mode) {
    if (process.platform === 'win32') return;
    await fs.chmod(filePath, mode);
  }

  async function ensureStoragePermissions() {
    await fs.mkdir(dataDirectory, { recursive: true, mode: 0o700 });
    await enforceMode(dataDirectory, 0o700);
    for (const directory of [backupDirectory, legacyProtectedDirectory]) {
      try {
        const stat = await fs.lstat(directory);
        if (stat.isDirectory()) {
          await enforceMode(directory, 0o700);
          for (const name of await fs.readdir(directory)) {
            const filePath = path.join(directory, name);
            const fileStat = await fs.lstat(filePath);
            if (fileStat.isFile()) await enforceMode(filePath, 0o600);
          }
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    for (const filePath of [statePath]) {
      try {
        const stat = await fs.lstat(filePath);
        if (stat.isFile()) await enforceMode(filePath, 0o600);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }

  async function readStateFile() {
    try {
      const local = await readLocalText(statePath);
      const text = local.text;
      const parsed = JSON.parse(text);
      const { state } = unwrapBackup(parsed);
      return { state: validateWithModel(state, model), local };
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      if (error instanceof SyntaxError) throw new Error('主台账文件不是有效 JSON');
      throw error;
    }
  }

  async function backupFileEntries() {
    let names;
    try {
      names = await fs.readdir(backupDirectory);
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    const entries = [];
    for (const name of names) {
      if (!/^(?:daily-\d{4}-\d{2}-\d{2}(?:-compat)?|pre-(?:import|restore|schema-upgrade)-.+|corrupt-.+)\.json$/.test(name)) continue;
      const filePath = path.join(backupDirectory, name);
      try {
        const stat = await fs.lstat(filePath);
        if (stat.isFile()) entries.push({ name, filePath, size: stat.size, mtimeMs: stat.mtimeMs });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    return entries;
  }

  async function pruneBackups() {
    const entries = [];
    for (const entry of await backupFileEntries()) {
      try {
        const parsed = JSON.parse(await fs.readFile(entry.filePath, 'utf8'));
        // Legacy OS-bound recovery points are never removed by the ordinary
        // plaintext retention policy, even when the old key is unavailable.
        if (isLocalEncryptedContainer(parsed)) continue;
      } catch (_error) {
        // Opaque corrupt files remain eligible for their separate retention cap.
      }
      entries.push(entry);
    }
    const daily = entries.filter((entry) => entry.name.startsWith('daily-')).sort((a, b) => b.name.localeCompare(a.name));
    const newestFirst = (a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name);
    const recovery = entries.filter((entry) => entry.name.startsWith('pre-')).sort(newestFirst);
    const corrupt = entries.filter((entry) => entry.name.startsWith('corrupt-')).sort(newestFirst);
    const remove = new Map();
    for (const entry of daily.slice(MAX_DAILY_BACKUPS)) remove.set(entry.name, entry);
    for (const entry of recovery.slice(MAX_RECOVERY_BACKUPS)) remove.set(entry.name, entry);
    for (const entry of corrupt.slice(MAX_CORRUPT_BACKUPS)) remove.set(entry.name, entry);

    const retained = entries.filter((entry) => !remove.has(entry.name));
    let totalBytes = retained.reduce((sum, entry) => sum + entry.size, 0);
    for (const entry of retained.sort((a, b) => a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name))) {
      if (totalBytes <= maxBackupTotalBytes) break;
      remove.set(entry.name, entry);
      totalBytes -= entry.size;
    }
    await Promise.all([...remove.values()].map((entry) => fs.unlink(entry.filePath).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    })));
  }

  async function writeBackup(state, reason, fileName) {
    const validated = serializeValidatedState(state, model).state;
    const plainText = JSON.stringify(backupEnvelope(validated, reason, now().toISOString()), null, 2);
    if (byteLength(plainText) > MAX_BACKUP_BYTES) throw new Error('备份容器超过安全大小上限');
    const target = path.join(backupDirectory, fileName);
    await atomicWrite(target, plainText);
    await pruneBackups();
    return target;
  }

  async function validateDailyBackup(filePath) {
    let text;
    try {
      text = (await readLocalText(filePath, MAX_BACKUP_BYTES)).text;
    } catch (error) {
      throw new Error(`每日恢复点无法读取：${error.message}`);
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (_error) {
      throw new Error('每日恢复点不是有效 JSON');
    }
    const unwrapped = unwrapBackup(parsed);
    if (!unwrapped.envelope || unwrapped.integrity !== 'verified' || unwrapped.metadata?.reason !== 'daily') {
      throw new Error('每日恢复点缺少可验证的完整性信息');
    }
    serializeValidatedState(unwrapped.state, model);
    return true;
  }

  async function archiveInvalidDailyBackup(filePath, validationError) {
    const stat = await fs.lstat(filePath);
    if (!stat.isFile()) throw new Error('每日恢复点路径不是普通文件，无法安全重建');
    const fileName = `corrupt-daily-invalid-${safeTimestamp(now())}-${randomId()}.json`;
    const target = path.join(backupDirectory, fileName);
    try {
      await atomicCopyFile(filePath, target);
    } catch (error) {
      throw new Error(`无法原样保留损坏的每日恢复点：${error.message}`);
    }
    recordHealthWarning(
      'DAILY_BACKUP_INVALID_ARCHIVED',
      `当日恢复点未通过校验，原文件已保留为 ${fileName}（${validationError.message}）`
    );
    return { target, fileName };
  }

  async function ensureDailyBackup(state) {
    if (!state) return null;
    health.automaticBackup.lastAttemptAt = now().toISOString();
    const fileName = `daily-${localDateStamp(now())}.json`;
    const target = path.join(backupDirectory, fileName);
    try {
      const stat = await fs.stat(target);
      if (!stat.isFile()) throw new Error('每日恢复点路径不是普通文件');
      try {
        await validateDailyBackup(target);
        health.automaticBackup.status = 'ok';
        health.automaticBackup.lastSuccessAt = now().toISOString();
        health.automaticBackup.error = null;
        clearHealthWarning('AUTOMATIC_BACKUP_FAILED');
        return target;
      } catch (validationError) {
        const archived = await archiveInvalidDailyBackup(target, validationError);
        await writeBackup(state, 'daily', fileName);
        health.automaticBackup.lastRepairAt = now().toISOString();
        health.automaticBackup.repairArchive = archived.target;
        clearHealthWarning('DAILY_BACKUP_INVALID_ARCHIVED');
        recordHealthWarning(
          'DAILY_BACKUP_REBUILT',
          `当日恢复点未通过校验，原文件已保留为 ${archived.fileName}，现已重新创建（${validationError.message}）`
        );
        health.automaticBackup.status = 'ok';
        health.automaticBackup.lastSuccessAt = now().toISOString();
        health.automaticBackup.error = null;
        clearHealthWarning('AUTOMATIC_BACKUP_FAILED');
        return target;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        health.automaticBackup.status = 'failed';
        health.automaticBackup.error = error.message;
        recordHealthWarning('AUTOMATIC_BACKUP_FAILED', `自动恢复点创建失败：${error.message}`);
        throw error;
      }
    }
    try {
      await writeBackup(state, 'daily', fileName);
      health.automaticBackup.status = 'ok';
      health.automaticBackup.lastSuccessAt = now().toISOString();
      health.automaticBackup.error = null;
      clearHealthWarning('AUTOMATIC_BACKUP_FAILED');
      return target;
    } catch (error) {
      health.automaticBackup.status = 'failed';
      health.automaticBackup.error = error.message;
      recordHealthWarning('AUTOMATIC_BACKUP_FAILED', `自动恢复点创建失败：${error.message}`);
      throw error;
    }
  }

  async function archiveUnreadableStateFile(error) {
    let stat;
    try {
      stat = await fs.lstat(statePath);
    } catch (statError) {
      if (statError.code === 'ENOENT') return null;
      throw statError;
    }
    if (!stat.isFile()) throw new Error('主台账路径不是普通文件，无法安全保留后继续恢复');
    await fs.mkdir(backupDirectory, { recursive: true, mode: 0o700 });
    const fileName = `corrupt-${safeTimestamp(now())}-${randomId()}.json`;
    const target = path.join(backupDirectory, fileName);
    try {
      const raw = await fs.readFile(statePath);
      let targetBytes = raw;
      let parsed = null;
      try { parsed = JSON.parse(raw.toString('utf8')); } catch (_parseError) { /* preserve opaque bytes */ }
      await atomicWrite(target, targetBytes);
      await pruneBackups();
    } catch (copyError) {
      await fs.unlink(target).catch(() => undefined);
      throw new Error(`无法保留损坏的主台账文件：${copyError.message}`);
    }
    recordHealthWarning('CORRUPT_STATE_ARCHIVED', `原主台账无法读取，已原样保留为 ${fileName}`);
    health.mainFileError = error?.message || '主台账无法读取';
    return target;
  }

  async function preserveCurrentBeforeReplacement(reason) {
    try {
      const current = await readStateFile();
      if (!current) return { recoveryPath: null, corruptPath: null };
      const recoveryPath = await writeBackup(current.state, reason, `${reason}-${safeTimestamp(now())}-${randomId()}.json`);
      return { recoveryPath, corruptPath: null };
    } catch (error) {
      const corruptPath = await archiveUnreadableStateFile(error);
      return { recoveryPath: null, corruptPath };
    }
  }

  async function migrationCandidates() {
    const items = [];
    try {
      const stat = await fs.lstat(statePath);
      if (stat.isFile()) items.push({ filePath: statePath, payloadType: 'state' });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    for (const entry of await backupFileEntries()) {
      if (entry.name.startsWith('daily-') || entry.name.startsWith('pre-')) {
        items.push({ filePath: entry.filePath, payloadType: 'backup' });
      } else if (entry.name.startsWith('corrupt-')) {
        items.push({ filePath: entry.filePath, payloadType: 'opaque-corrupt' });
      }
    }
    return items;
  }

  async function hasLegacyEncryptedState() {
    try {
      const parsed = JSON.parse(await readRegularFile(fs, statePath, MAX_LOCAL_ENCRYPTED_BYTES));
      return isLocalEncryptedContainer(parsed);
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return false;
      throw error;
    }
  }

  async function validateMigrationPlaintext(text, payloadType) {
    let parsed;
    try { parsed = JSON.parse(text); } catch (_error) { throw new Error('待迁移文件不是有效 JSON'); }
    const unwrapped = unwrapBackup(parsed);
    const state = validateWithModel(unwrapped.state, model);
    serializeValidatedState(state, model);
  }

  async function preserveLegacyProtectedBytes(filePath, rawText, payloadType) {
    await fs.mkdir(legacyProtectedDirectory, { recursive: true, mode: 0o700 });
    const base = path.basename(filePath, path.extname(filePath)).replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 80) || payloadType;
    const digest = textDigest(rawText);
    const existing = await fs.readdir(legacyProtectedDirectory).catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    const prior = existing.find((name) => name.endsWith(`-${digest}.json`));
    if (prior) return path.join(legacyProtectedDirectory, prior);
    const target = path.join(legacyProtectedDirectory, `${base}-${safeTimestamp(now())}-${digest}.json`);
    await atomicWrite(target, rawText);
    const reread = await readRegularFile(fs, target, encryptedLimitForPayloadType(payloadType));
    if (textDigest(reread) !== digest) throw new Error('旧版受保护原件保留后校验失败');
    return target;
  }

  async function migrateLegacyContainer(candidate) {
    const rawText = await readRegularFile(fs, candidate.filePath, encryptedLimitForPayloadType(candidate.payloadType));
    let container;
    try { container = JSON.parse(rawText); } catch (_error) { return false; }
    if (!isLocalEncryptedContainer(container)) return false;
    const decrypted = await decodeLocalContainer(container, candidate.payloadType);
    const payloadType = decrypted.payloadType;
    if (payloadType !== 'opaque-corrupt') await validateMigrationPlaintext(decrypted.text, payloadType);
    await preserveLegacyProtectedBytes(candidate.filePath, rawText, candidate.payloadType);
    await atomicWrite(candidate.filePath, decrypted.text, async (temporaryText) => {
      if (textDigest(temporaryText) !== textDigest(decrypted.text)) throw new Error('旧版受保护数据转换临时文件校验失败');
      if (payloadType !== 'opaque-corrupt') await validateMigrationPlaintext(temporaryText, payloadType);
    });
    const verified = await readRegularFile(fs, candidate.filePath, plaintextLimitForPayloadType(payloadType));
    if (textDigest(verified) !== textDigest(decrypted.text)) throw new Error('旧版受保护数据转换后回读不一致');
    if (payloadType !== 'opaque-corrupt') await validateMigrationPlaintext(verified, payloadType);
    return true;
  }

  async function migrateLocalFiles() {
    const candidates = await migrationCandidates();
    const encrypted = [];
    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(await readRegularFile(fs, candidate.filePath, encryptedLimitForPayloadType(candidate.payloadType)));
        if (isLocalEncryptedContainer(parsed)) encrypted.push(candidate);
      } catch (_error) { /* validation happens through the normal read path */ }
    }
    health.legacyMigration = { status: encrypted.length ? 'running' : 'not-needed', migrated: 0, remaining: encrypted.length, error: null };
    health.encryption.migration = health.legacyMigration;
    for (const candidate of encrypted) {
      try {
        await migrateLegacyContainer(candidate);
        health.legacyMigration.migrated += 1;
        health.legacyMigration.remaining -= 1;
      } catch (error) {
        if (candidate.payloadType === 'state') {
          health.legacyMigration.status = 'failed';
          health.legacyMigration.error = error.message;
          health.encryption.migration = { ...health.legacyMigration };
          throw error;
        }
        recordHealthWarning('LEGACY_BACKUP_MIGRATION_FAILED', `旧版受保护恢复点暂未转换，原文件已保留：${path.basename(candidate.filePath)}（${error.message}）`);
      }
    }
    health.legacyMigration.status = health.legacyMigration.remaining ? 'partial' : (encrypted.length ? 'complete' : 'not-needed');
    health.legacyMigration.error = health.legacyMigration.remaining ? `仍有 ${health.legacyMigration.remaining} 个旧版恢复点未完成转换` : null;
    health.encryption.migration = { ...health.legacyMigration };
    return { ...health.legacyMigration };
  }

  async function inspectLegacyAuxiliaryFiles() {
    let remaining = 0;
    for (const candidate of await migrationCandidates()) {
      if (candidate.payloadType === 'state') continue;
      try {
        const parsed = JSON.parse(await readRegularFile(fs, candidate.filePath, encryptedLimitForPayloadType(candidate.payloadType)));
        if (isLocalEncryptedContainer(parsed)) remaining += 1;
      } catch (_error) {
        // Damaged ordinary recovery files are handled by the normal recovery
        // validation path. This scan only identifies old protected containers.
      }
    }
    health.legacyMigration = {
      status: remaining ? 'partial' : 'not-needed',
      migrated: 0,
      remaining,
      error: remaining ? `保留了 ${remaining} 个旧版恢复点` : null
    };
    health.encryption.migration = { ...health.legacyMigration };
    clearHealthWarning('LEGACY_BACKUP_PENDING');
    if (remaining) {
      recordHealthWarning(
        'LEGACY_BACKUP_PENDING',
        `发现 ${remaining} 个旧版恢复点，程序已原样保留；当前台账不受影响，建议另行导出一份完整备份。`
      );
    }
    return { ...health.legacyMigration };
  }

  async function loadState() {
    await writeQueue;
    await ensureStoragePermissions();
    const legacyMain = await hasLegacyEncryptedState();
    if (legacyMain) {
      try {
        await migrateLocalFiles();
      } catch (error) {
        health.stateStatus = 'unreadable';
        health.readable = false;
        health.mainFileError = error.message;
        recordHealthWarning('MAIN_STATE_UNREADABLE', `主台账无法读取：${error.message}`);
        throw error;
      }
    }
    let state;
    let loaded;
    try {
      loaded = await readStateFile();
      state = loaded?.state || null;
      health.stateStatus = state ? 'healthy' : 'missing';
      health.readable = true;
      health.mainFileError = null;
      clearHealthWarning('MAIN_STATE_UNREADABLE');
    } catch (error) {
      health.stateStatus = 'unreadable';
      health.readable = false;
      health.mainFileError = error.message;
      recordHealthWarning('MAIN_STATE_UNREADABLE', `主台账无法读取：${error.message}`);
      throw error;
    }
    if (state) {
      health.automaticBackup.lastAttemptAt = now().toISOString();
      try {
        const version = Number(state.version) || 0;
        if (model?.CURRENT_STATE_VERSION && version < model.CURRENT_STATE_VERSION) {
          const digest = stateDigest(state);
          const fileName = `pre-schema-upgrade-v${version}-${digest}.json`;
          const target = path.join(backupDirectory, fileName);
          try {
            const stat = await fs.stat(target);
            if (!stat.isFile()) throw new Error('升级前恢复点路径不是普通文件');
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            await enqueue(() => writeBackup(state, 'pre-schema-upgrade', fileName));
          }
        }
        await enqueue(() => ensureDailyBackup(state));
        health.automaticBackup.status = 'ok';
        health.automaticBackup.lastSuccessAt = now().toISOString();
        health.automaticBackup.error = null;
        clearHealthWarning('AUTOMATIC_BACKUP_FAILED');
      } catch (error) {
        health.automaticBackup.status = 'failed';
        health.automaticBackup.error = error.message;
        recordHealthWarning('AUTOMATIC_BACKUP_FAILED', `主台账已读取，但自动恢复点创建失败：${error.message}`);
      }
    }
    if (!legacyMain) {
      // Ordinary use must never trigger a system-key prompt merely because an
      // old auxiliary recovery point still exists. Keep it untouched and show
      // a simple backup reminder; explicit legacy migration remains available
      // for controlled recovery work.
      await inspectLegacyAuxiliaryFiles().catch((error) => {
        recordHealthWarning('LEGACY_BACKUP_SCAN_FAILED', `旧版恢复点检查未完成：${error.message}`);
      });
    }
    return state;
  }

  function saveState(state) {
    let serialized;
    try {
      serialized = serializeValidatedState(state, model);
    } catch (error) {
      return Promise.reject(error);
    }
    const persist = async (snapshot) => {
      await ensureStoragePermissions();
      const previous = await readStateFile();
      await ensureDailyBackup(previous?.state || snapshot.state);
      await atomicWrite(statePath, snapshot.text);
      return { ok: true, savedAt: now().toISOString(), size: snapshot.size };
    };

    return new Promise((resolve, reject) => {
      let batch = activeSaveBatch;
      if (!batch || !batch.accepting) {
        batch = { accepting: true, latest: null, waiters: [] };
        activeSaveBatch = batch;
        appendToWriteQueue(async () => {
          let lastResult = null;
          try {
            // While a disk write is running, retain only the newest snapshot.
            // Every caller still settles only after a state at least as recent
            // as its request has been persisted.
            while (batch.latest) {
              const snapshot = batch.latest;
              batch.latest = null;
              const waiters = batch.waiters.splice(0);
              try {
                lastResult = await persist(snapshot);
                for (const waiter of waiters) waiter.resolve(lastResult);
              } catch (error) {
                batch.latest = null;
                for (const waiter of [...waiters, ...batch.waiters.splice(0)]) waiter.reject(error);
                throw error;
              }
            }
            return lastResult;
          } finally {
            batch.accepting = false;
            if (activeSaveBatch === batch) activeSaveBatch = null;
          }
        });
      }
      batch.latest = serialized;
      batch.waiters.push({ resolve, reject });
    });
  }

  async function inspectImport(filePath) {
    const currentTime = now().getTime();
    for (const [token, pending] of pendingImports) {
      if (pending.expiresAt < currentTime) pendingImports.delete(token);
    }
    let text;
    try {
      text = await readRegularFile(fs, filePath, MAX_BACKUP_BYTES);
    } catch (error) {
      if (error.code === 'ENOENT') throw new Error('导入文件不存在');
      throw error;
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (_error) {
      throw new Error('导入文件不是有效 JSON');
    }
    const unwrapped = unwrapBackup(parsed);
    let state = validateWithModel(unwrapped.state, model);
    if (model && typeof model.normalizeState === 'function') state = model.normalizeState(state);
    state = validateWithModel(state, model);
    serializeValidatedState(state, model);
    const token = randomId();
    const expiresAt = now().getTime() + IMPORT_TOKEN_TTL_MS;
    // Keep at most one inspected payload in the main process. A newer valid
    // preview supersedes the earlier confirmation token.
    pendingImports.clear();
    pendingImports.set(token, { filePath: path.resolve(filePath), state, expiresAt, applying: false });
    return {
      token,
      preview: {
        fileName: path.basename(filePath),
        exportedAt: unwrapped.metadata?.createdAt || '',
        caseCount: state.cases.length,
        templateCount: Array.isArray(state.customTemplates) ? state.customTemplates.length : 0,
        stateVersion: state.version || null,
        sizeBytes: byteLength(text),
        integrity: unwrapped.integrity,
        warnings: unwrapped.warnings,
        expiresAt: new Date(expiresAt).toISOString()
      }
    };
  }

  function applyImport(token) {
    return enqueue(async () => {
      const pending = pendingImports.get(token);
      if (!pending) throw new Error('导入检查凭证无效或已使用');
      if (pending.expiresAt < now().getTime()) throw new Error('导入检查凭证已过期，请重新选择文件');
      if (pending.applying) throw new Error('该导入正在处理');
      pending.applying = true;
      try {
        const serialized = serializeValidatedState(pending.state, model);
        const { recoveryPath, corruptPath } = await preserveCurrentBeforeReplacement('pre-import');
        await atomicWrite(statePath, serialized.text);
        pendingImports.delete(token);
        health.stateStatus = 'healthy';
        health.readable = true;
        health.mainFileError = null;
        clearHealthWarning('MAIN_STATE_UNREADABLE');
        return { ok: true, state: pending.state, recoveryPath, corruptPath, savedAt: now().toISOString() };
      } catch (error) {
        pending.applying = false;
        throw error;
      }
    });
  }

  async function listBackups() {
    let names;
    try {
      names = await fs.readdir(backupDirectory);
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    const items = [];
    for (const name of names.filter((item) => item.endsWith('.json'))) {
      const filePath = path.join(backupDirectory, name);
      try {
        const stat = await fs.lstat(filePath);
        if (!stat.isFile() || stat.size > Math.max(MAX_BACKUP_BYTES, MAX_LOCAL_ENCRYPTED_BACKUP_BYTES)) continue;
        const parsed = JSON.parse((await readLocalText(filePath, MAX_BACKUP_BYTES)).text);
        const unwrapped = unwrapBackup(parsed);
        const state = serializeValidatedState(unwrapped.state, model).state;
        items.push({
          id: name,
          name,
          label: unwrapped.metadata?.reason === 'daily' ? `每日恢复点 ${name.slice(6, 16)}` : name,
          reason: unwrapped.metadata?.reason || 'legacy',
          createdAt: unwrapped.metadata?.createdAt || stat.mtime.toISOString(),
          cases: state.cases.length,
          size: stat.size
        });
      } catch (_error) {
        // Corrupt files are omitted from the recovery list instead of breaking it.
      }
    }
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  function restoreBackup(id) {
    if (typeof id !== 'string' || path.basename(id) !== id || !id.endsWith('.json')) {
      return Promise.reject(new Error('备份标识无效'));
    }
    return enqueue(async () => {
      const filePath = path.join(backupDirectory, id);
      const parsed = JSON.parse((await readLocalText(filePath, MAX_BACKUP_BYTES)).text);
      const state = validateWithModel(unwrapBackup(parsed).state, model);
      const serialized = serializeValidatedState(state, model);
      const { recoveryPath, corruptPath } = await preserveCurrentBeforeReplacement('pre-restore');
      await atomicWrite(statePath, serialized.text);
      health.stateStatus = 'healthy';
      health.readable = true;
      health.mainFileError = null;
      clearHealthWarning('MAIN_STATE_UNREADABLE');
      return { ok: true, state, recoveryPath, corruptPath, savedAt: now().toISOString() };
    });
  }

  async function exportBackup(filePath, candidateState) {
    await writeQueue;
    let state;
    let source;
    if (candidateState !== undefined) {
      state = serializeValidatedState(candidateState, model).state;
      source = 'candidate';
    } else {
      state = (await readStateFile())?.state || null;
      source = 'saved';
    }
    if (!state) throw new Error('尚无已保存的台账数据可导出');
    const text = JSON.stringify(backupEnvelope(state, 'manual-export', now().toISOString()), null, 2);
    if (byteLength(text) > MAX_BACKUP_BYTES) throw new Error('备份容器超过安全大小上限');
    await atomicWrite(path.resolve(filePath), text);
    return { ok: true, filePath, size: byteLength(text), source };
  }

  async function exportText(filePath, payload) {
    const allowedExtensions = new Set(['.csv', '.txt']);
    const extension = path.extname(filePath).toLowerCase();
    if (!allowedExtensions.has(extension)) throw new Error('只能导出 CSV 或 TXT 文件');
    if (typeof payload?.content !== 'string') throw new Error('导出内容必须是文本');
    const content = payload.content;
    if (byteLength(content) > MAX_EXPORT_TEXT_BYTES) throw new Error('导出文本超过 10 MiB 上限');
    await atomicWrite(path.resolve(filePath), content);
    return { ok: true, filePath, size: byteLength(content) };
  }

  function getStorageInfo() {
    return {
      dataDirectory,
      statePath,
      backupDirectory,
      legacyProtectedDirectory,
      encrypted: false,
      encryption: {
        mode: 'local-json',
        available: health.encryption.available,
        migration: { ...health.encryption.migration }
      },
      legacyMigration: { ...health.legacyMigration },
      maxStateBytes: MAX_STATE_BYTES,
      maxBackupBytes: MAX_BACKUP_BYTES,
      dailyBackupRetention: MAX_DAILY_BACKUPS,
      recoveryBackupRetention: MAX_RECOVERY_BACKUPS,
      corruptBackupRetention: MAX_CORRUPT_BACKUPS,
      maxBackupTotalBytes
    };
  }

  async function getStorageHealth() {
    await writeQueue;
    let corruptFiles = [];
    try {
      const names = await fs.readdir(backupDirectory);
      for (const name of names.filter((item) => /^corrupt-.+\.json$/.test(item))) {
        const filePath = path.join(backupDirectory, name);
        try {
          const stat = await fs.lstat(filePath);
          if (stat.isFile()) corruptFiles.push({ id: name, path: filePath, size: stat.size, createdAt: stat.mtime.toISOString() });
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      corruptFiles = corruptFiles.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch (error) {
      if (error.code !== 'ENOENT') recordHealthWarning('RECOVERY_DIRECTORY_UNREADABLE', `无法读取恢复目录：${error.message}`);
    }
    return {
      status: health.stateStatus,
      readable: health.readable,
      encrypted: false,
      encryption: {
        mode: 'local-json',
        available: health.encryption.available,
        migration: { ...health.encryption.migration }
      },
      legacyMigration: { ...health.legacyMigration },
      mainFile: { path: statePath, status: health.stateStatus, error: health.mainFileError },
      automaticBackup: { ...health.automaticBackup },
      recovery: { backupDirectory, corruptFiles },
      warnings: [...healthWarnings.values()]
    };
  }

  return {
    loadState,
    saveState,
    inspectImport,
    applyImport,
    listBackups,
    restoreBackup,
    exportBackup,
    exportText,
    getStorageInfo,
    getStorageHealth,
    migrateLocalFiles,
    waitForWrites: () => writeQueue
  };
}

module.exports = {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  LOCAL_ENCRYPTED_FORMAT,
  LOCAL_ENCRYPTED_FORMAT_VERSION,
  MAX_LOCAL_ENCRYPTED_BYTES,
  MAX_LOCAL_ENCRYPTED_BACKUP_BYTES,
  MAX_OPAQUE_CORRUPT_BYTES,
  MAX_STATE_BYTES,
  MAX_BACKUP_BYTES,
  MAX_EXPORT_TEXT_BYTES,
  MAX_DAILY_BACKUPS,
  MAX_RECOVERY_BACKUPS,
  MAX_CORRUPT_BACKUPS,
  MAX_BACKUP_TOTAL_BYTES,
  backupEnvelope,
  unwrapBackup,
  validateWithModel,
  createStorageService
};
