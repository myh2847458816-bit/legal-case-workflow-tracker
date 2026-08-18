const { packager } = require('@electron/packager');
const packageMetadata = require('../package.json');

const PACKAGER_IGNORE = [
  /^\/(?:dist|releases|tests|node_modules|previews|docs|\.git|\.github)(?:$|\/)/,
  /^\/(?:backups|legacy-protected|user-data|userdata|用户数据)(?:$|\/)/i,
  /^\/case-tracker-data\.json$/i,
  /^\/.*(?:台账备份|案件备份).*\.json$/i,
  /^\/.*\.(?:csv|xlsx)$/i,
  /^\/.*\.(?:pem|key|p12|pfx|cer|zip)$/i,
  /^\/\.DS_Store$/
];

packager({
  dir: '.',
  name: 'LegalCaseTracker',
  platform: 'win32',
  arch: 'x64',
  out: 'dist',
  overwrite: true,
  asar: true,
  prune: false,
  icon: 'assets/icon.ico',
  ignore: PACKAGER_IGNORE,
  electronVersion: packageMetadata.devDependencies.electron,
  appVersion: packageMetadata.version,
  win32metadata: {
    CompanyName: '法律案件流程台账',
    FileDescription: '法律案件流程台账',
    ProductName: '法律案件流程台账'
  }
}).then((paths) => {
  process.stdout.write(`${paths.join('\n')}\n`);
}).catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
