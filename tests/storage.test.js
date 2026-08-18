const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const model = require('../src/data-model');
const storageModule = require('../src/storage-service');

async function withStorage(run, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'case-tracker-storage-'));
  const service = storageModule.createStorageService({ ...options, dataDirectory: directory, model: options.model || model });
  try { return await run({ directory, service }); }
  finally { await fs.rm(directory, { recursive: true, force: true }); }
}

function legacyContainer(text, payloadType) {
  return JSON.stringify({
    format: storageModule.LOCAL_ENCRYPTED_FORMAT,
    formatVersion: storageModule.LOCAL_ENCRYPTED_FORMAT_VERSION,
    protection: 'os-bound',
    encoding: 'base64',
    payloadType,
    ciphertext: Buffer.from(text, 'utf8').toString('base64')
  });
}

function passthroughLegacyCodec(available = true) {
  return {
    isAvailable: async () => available,
    decrypt: async (bytes) => bytes.toString('utf8')
  };
}

test('plain local ledger saves, loads and creates a recovery point', async () => {
  await withStorage(async ({ directory, service }) => {
    const state = model.createEmptyState();
    state.settings.upcomingDays = 7;
    await service.saveState(state);
    assert.deepEqual(await service.loadState(), state);
    const mainText = await fs.readFile(path.join(directory, 'case-tracker-data.json'), 'utf8');
    assert.equal(JSON.parse(mainText).version, model.CURRENT_STATE_VERSION);
    assert.equal((await service.listBackups()).length, 1);
  });
});

test('rapid saves coalesce and persist the newest snapshot', async () => {
  await withStorage(async ({ service }) => {
    const requests = [];
    for (let revision = 0; revision < 40; revision += 1) {
      const state = model.createEmptyState();
      state.settings.upcomingDays = revision + 1;
      requests.push(service.saveState(state));
    }
    await Promise.all(requests);
    assert.equal((await service.loadState()).settings.upcomingDays, 40);
  });
});

test('backup envelopes have independent container capacity and verified round trips', () => {
  assert.ok(storageModule.MAX_BACKUP_BYTES > storageModule.MAX_STATE_BYTES);
  const state = model.createEmptyState();
  const envelope = storageModule.backupEnvelope(state, 'test');
  assert.equal(storageModule.unwrapBackup(envelope).state, state);
});

test('backup inspection and application preserve a recovery point', async () => {
  await withStorage(async ({ directory, service }) => {
    const original = model.createEmptyState();
    await service.saveState(original);
    const imported = model.createEmptyState();
    imported.settings.upcomingDays = 21;
    const filePath = path.join(directory, 'portable.json');
    await service.exportBackup(filePath, imported);
    const inspected = await service.inspectImport(filePath);
    const applied = await service.applyImport(inspected.token);
    assert.equal(applied.state.settings.upcomingDays, 21);
    assert.ok(applied.recoveryPath);
    assert.equal((await service.loadState()).settings.upcomingDays, 21);
  });
});

test('a damaged same-day recovery point is preserved byte-for-byte and rebuilt', async () => {
  const fixedNow = () => new Date('2026-08-14T08:00:00.000Z');
  await withStorage(async ({ directory, service }) => {
    const state = model.createEmptyState();
    await service.saveState(state);
    const dailyPath = path.join(directory, 'backups', 'daily-2026-08-14.json');
    const damagedBytes = Buffer.from([0x7b, 0xff, 0x00, 0x61, 0x62, 0x63]);
    await fs.writeFile(dailyPath, damagedBytes);

    assert.deepEqual(await service.loadState(), state);

    const names = await fs.readdir(path.join(directory, 'backups'));
    const archivedName = names.find((name) => name.startsWith('corrupt-daily-invalid-'));
    assert.ok(archivedName);
    assert.deepEqual(await fs.readFile(path.join(directory, 'backups', archivedName)), damagedBytes);

    const rebuilt = storageModule.unwrapBackup(JSON.parse(await fs.readFile(dailyPath, 'utf8')));
    assert.equal(rebuilt.integrity, 'verified');
    assert.deepEqual(rebuilt.state, state);
    const health = await service.getStorageHealth();
    assert.equal(health.automaticBackup.status, 'ok');
    assert.equal(health.automaticBackup.error, null);
    assert.ok(health.automaticBackup.repairArchive.endsWith(archivedName));
    assert.ok(health.warnings.some((warning) => warning.code === 'DAILY_BACKUP_REBUILT'));
  }, { now: fixedNow });
});

test('import inspection exposes only a token and preview and supersedes the old token', async () => {
  await withStorage(async ({ directory, service }) => {
    const first = model.createEmptyState();
    first.settings.upcomingDays = 11;
    const second = model.createEmptyState();
    second.settings.upcomingDays = 12;
    const firstPath = path.join(directory, 'first.json');
    const secondPath = path.join(directory, 'second.json');
    await service.exportBackup(firstPath, first);
    await service.exportBackup(secondPath, second);

    const firstInspection = await service.inspectImport(firstPath);
    assert.deepEqual(Object.keys(firstInspection).sort(), ['preview', 'token']);
    assert.equal(firstInspection.preview.caseCount, 0);
    assert.equal('state' in firstInspection, false);
    const secondInspection = await service.inspectImport(secondPath);

    await assert.rejects(service.applyImport(firstInspection.token), /凭证无效或已使用/);
    const applied = await service.applyImport(secondInspection.token);
    assert.equal(applied.state.settings.upcomingDays, 12);
  });
});

test('available legacy codec migrates the main ledger and preserves the protected original', async () => {
  await withStorage(async ({ directory, service }) => {
    const state = model.createEmptyState();
    state.settings.upcomingDays = 18;
    const plaintext = JSON.stringify(state, null, 2);
    const protectedText = legacyContainer(plaintext, 'state');
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'case-tracker-data.json'), protectedText);

    assert.deepEqual(await service.loadState(), state);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, 'case-tracker-data.json'), 'utf8')), state);
    const protectedNames = await fs.readdir(path.join(directory, 'legacy-protected'));
    assert.equal(protectedNames.length, 1);
    assert.equal(await fs.readFile(path.join(directory, 'legacy-protected', protectedNames[0]), 'utf8'), protectedText);
    const health = await service.getStorageHealth();
    assert.equal(health.legacyMigration.status, 'complete');
    assert.equal(health.legacyMigration.migrated, 1);
  }, { legacyCodec: passthroughLegacyCodec() });
});

test('unavailable legacy codec leaves the protected main ledger untouched', async () => {
  await withStorage(async ({ directory, service }) => {
    const state = model.createEmptyState();
    const protectedText = legacyContainer(JSON.stringify(state), 'state');
    const statePath = path.join(directory, 'case-tracker-data.json');
    await fs.writeFile(statePath, protectedText);

    await assert.rejects(service.loadState(), /系统安全存储暂不可用/);
    assert.equal(await fs.readFile(statePath, 'utf8'), protectedText);
    const health = await service.getStorageHealth();
    assert.equal(health.status, 'unreadable');
    assert.equal(health.readable, false);
  }, { legacyCodec: passthroughLegacyCodec(false) });
});

test('an unavailable codec for an auxiliary legacy backup does not block a healthy plain ledger', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'case-tracker-storage-'));
  try {
    const state = model.createEmptyState();
    const writer = storageModule.createStorageService({ dataDirectory: directory, model });
    await writer.saveState(state);
    const statePath = path.join(directory, 'case-tracker-data.json');
    const mainBefore = await fs.readFile(statePath, 'utf8');
    const backupDirectory = path.join(directory, 'backups');
    const legacyPath = path.join(backupDirectory, 'daily-2026-08-13.json');
    const legacyText = legacyContainer(JSON.stringify(storageModule.backupEnvelope(state, 'daily')), 'backup');
    await fs.writeFile(legacyPath, legacyText);

    let codecCalls = 0;
    const reader = storageModule.createStorageService({
      dataDirectory: directory,
      model,
      legacyCodec: {
        isAvailable: async () => { codecCalls += 1; return false; },
        decrypt: async () => { codecCalls += 1; throw new Error('不应在正常启动时调用'); }
      }
    });
    assert.deepEqual(await reader.loadState(), state);
    assert.equal(await fs.readFile(statePath, 'utf8'), mainBefore);
    assert.equal(await fs.readFile(legacyPath, 'utf8'), legacyText);
    const health = await reader.getStorageHealth();
    assert.equal(health.status, 'healthy');
    assert.equal(health.readable, true);
    assert.equal(health.legacyMigration.status, 'partial');
    assert.equal(codecCalls, 0);
    assert.ok(health.warnings.some((warning) => warning.code === 'LEGACY_BACKUP_PENDING'));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('legacy backup plaintext may exceed the state-file limit while its nested state remains valid', async () => {
  await withStorage(async ({ directory, service }) => {
    const state = model.createEmptyState();
    state.padding = '';
    const targetStateBytes = storageModule.MAX_STATE_BYTES - 32;
    const emptyPaddingBytes = Buffer.byteLength(JSON.stringify(state, null, 2), 'utf8');
    state.padding = 'x'.repeat(targetStateBytes - emptyPaddingBytes);
    const serializedStateBytes = Buffer.byteLength(JSON.stringify(state, null, 2), 'utf8');
    assert.equal(serializedStateBytes, targetStateBytes);

    const backupText = JSON.stringify(storageModule.backupEnvelope(state, 'daily'), null, 2);
    assert.ok(Buffer.byteLength(backupText, 'utf8') > storageModule.MAX_STATE_BYTES);
    assert.ok(Buffer.byteLength(backupText, 'utf8') <= storageModule.MAX_BACKUP_BYTES);
    const protectedText = legacyContainer(backupText, 'backup');
    assert.ok(Buffer.byteLength(protectedText, 'utf8') <= storageModule.MAX_LOCAL_ENCRYPTED_BACKUP_BYTES);

    const backupDirectory = path.join(directory, 'backups');
    await fs.mkdir(backupDirectory, { recursive: true });
    const backupPath = path.join(backupDirectory, 'daily-2026-08-13.json');
    await fs.writeFile(backupPath, protectedText);
    const migration = await service.migrateLocalFiles();

    assert.equal(migration.status, 'complete');
    assert.equal(migration.migrated, 1);
    const migrated = storageModule.unwrapBackup(JSON.parse(await fs.readFile(backupPath, 'utf8')));
    assert.equal(migrated.state.padding.length, state.padding.length);
  }, { legacyCodec: passthroughLegacyCodec() });
});
