const { packager } = require('@electron/packager');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const packageMetadata = require('../package.json');
const electronChecksums = require('electron/checksums.json');

const PACKAGER_IGNORE = [
  /^\/(?:dist|releases|tests|node_modules|previews|docs|\.git|\.github)(?:$|\/)/,
  /^\/(?:backups|legacy-protected|user-data|userdata|用户数据)(?:$|\/)/i,
  /^\/case-tracker-data\.json$/i,
  /^\/.*(?:台账备份|案件备份).*\.json$/i,
  /^\/.*\.(?:csv|xlsx)$/i,
  /^\/.*\.(?:pem|key|p12|pfx|cer|zip)$/i,
  /^\/\.DS_Store$/
];

function tidyMainPlist(appPath, plist) {
  const plistPath = path.join(appPath, 'Contents', 'Info.plist');
  const info = plist.parse(fs.readFileSync(plistPath, 'utf8'));
  info.CFBundleDisplayName = '法律案件流程台账';
  info.CFBundleName = '法律案件流程台账';
  info.LSApplicationCategoryType = 'public.app-category.productivity';
  info.NSAppTransportSecurity = { NSAllowsArbitraryLoads: false };
  for (const key of [
    'NSAudioCaptureUsageDescription',
    'NSBluetoothAlwaysUsageDescription',
    'NSBluetoothPeripheralUsageDescription',
    'NSCameraUsageDescription',
    'NSMicrophoneUsageDescription'
  ]) delete info[key];
  fs.writeFileSync(plistPath, plist.build(info));
}

async function main() {
  const plistNamespace = await import('plist');
  const plist = plistNamespace.default || plistNamespace;
  const paths = await packager({
    dir: '.',
    name: packageMetadata.productName,
    executableName: 'LegalCaseTracker',
    platform: 'darwin',
    arch: 'arm64',
    out: 'dist',
    overwrite: true,
    asar: true,
    prune: false,
    icon: 'assets/icon.icns',
    ignore: PACKAGER_IGNORE,
    appBundleId: 'local.legal.case.tracker',
    appCategoryType: 'public.app-category.productivity',
    extendInfo: 'assets/mac-info.plist',
    electronVersion: packageMetadata.devDependencies.electron,
    download: { checksums: electronChecksums },
    appVersion: packageMetadata.version
  });

  for (const outputPath of paths) {
    const appPath = path.join(outputPath, `${packageMetadata.productName}.app`);
    tidyMainPlist(appPath, plist);
    // The plist is adjusted after packaging, so refresh the local preview
    // signature to keep the bundle internally consistent. Public releases
    // still require a Developer ID signature and notarization.
    childProcess.execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath]);
    childProcess.execFileSync('codesign', ['--verify', '--deep', '--strict', appPath]);
  }
  process.stdout.write(`${paths.join('\n')}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
