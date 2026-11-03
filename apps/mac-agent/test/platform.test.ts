import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectPlatform, securityPatterns } from '../src/platform/index.ts';
import { darwin, darwinPlist } from '../src/platform/darwin.ts';
import { linux, linuxServicePath, linuxShell, linuxUnit, parseConf } from '../src/platform/linux.ts';

test('platform selection follows process.platform', () => {
  assert.equal(selectPlatform('darwin').id, 'darwin');
  assert.equal(selectPlatform('linux').id, 'linux');
  assert.throws(() => selectPlatform('win32'), /macOS and Linux/);
  assert.equal(selectPlatform().id, process.platform);
});

test('linux unit: ExecStart, restart policy, env and log files', () => {
  const unit = linuxUnit({
    node: '/usr/bin/node',
    bin: '/opt/cmc/apps/mac-agent/bin/cmc.mjs',
    path: linuxServicePath('/home/u', '/usr/bin/node'),
    home: '/home/u',
    logDir: '/home/u/.callmeclaude/logs',
  });
  const lines = unit.split('\n');
  assert.ok(lines.includes('ExecStart="/usr/bin/node" "/opt/cmc/apps/mac-agent/bin/cmc.mjs" serve'));
  assert.ok(lines.includes('Restart=always'));
  assert.ok(lines.includes('Environment="PATH=/usr/local/bin:/usr/bin:/bin:/home/u/.local/bin"'));
  assert.ok(lines.includes('Environment="HOME=/home/u"'));
  assert.ok(lines.includes('Environment=NODE_NO_WARNINGS=1'));
  assert.ok(lines.includes('StandardOutput=append:/home/u/.callmeclaude/logs/systemd.out.log'));
  assert.ok(lines.includes('StandardError=append:/home/u/.callmeclaude/logs/systemd.err.log'));
  assert.ok(lines.includes('WantedBy=default.target'));
  assert.ok(unit.endsWith('\n'));
});

test('linux unit escapes systemd specifiers, quotes and spaces', () => {
  const unit = linuxUnit({ node: '/home/a b/n%de"x', bin: '/b', path: '/p', home: '/home/a b', logDir: '/l%s' });
  assert.ok(unit.includes('ExecStart="/home/a b/n%%de\\"x" "/b" serve'));
  assert.ok(unit.includes('StandardOutput=append:/l%%s/systemd.out.log'));
});

test('linux service PATH includes node dir once, ~/.local/bin, system bins', () => {
  assert.equal(linuxServicePath('/home/u', '/home/u/.nvm/versions/node/v24/bin/node'), '/usr/local/bin:/usr/bin:/bin:/home/u/.local/bin:/home/u/.nvm/versions/node/v24/bin');
});

test('linux shell: $SHELL, else /bin/sh', () => {
  assert.equal(linuxShell({ SHELL: '/usr/bin/fish' }), '/usr/bin/fish');
  assert.equal(linuxShell({}), '/bin/sh');
});

test('LAN filters: utun on macOS, tailscale0 on Linux', () => {
  assert.equal(darwin.isLanInterface('utun3'), false);
  assert.equal(darwin.isLanInterface('en0'), true);
  assert.equal(linux.isLanInterface('tailscale0'), false);
  assert.equal(linux.isLanInterface('wlan0'), true);
});

test('logind config parsing: last value wins', () => {
  assert.deepEqual(parseConf('[Login]\n#HandleLidSwitch=suspend\nHandleLidSwitch=suspend\n\n# /etc/x.conf\nHandleLidSwitch = ignore\n'), { HandleLidSwitch: 'ignore' });
});

test('macOS security patterns are unchanged', () => {
  const { PROTECTED, DESTRUCTIVE } = securityPatterns(darwin);
  const original = /(rm\s+-rf?\s+[~\/]|mkfs|diskutil\s+erase|dd\s+if=|:\(\)\s*\{|shutdown|halt\b|security\s+(delete|dump|find-generic-password\s+.*-w)|launchctl\s+unload|csrutil|sudo\s)/i;
  assert.equal(DESTRUCTIVE.source, original.source);
  assert.equal(DESTRUCTIVE.flags, original.flags);
  const originalProtected = [/\.ssh\//, /Library\/Keychains/, /\.aws\/credentials/, /\.gnupg\//, /\/\.env(\.|$)/, /\.claude\/\.credentials/];
  assert.deepEqual(PROTECTED.map(String).sort(), originalProtected.map(String).sort());
});

test('linux security patterns block the Linux equivalents and the shared ones', () => {
  const { PROTECTED, DESTRUCTIVE } = securityPatterns(linux);
  for (const cmd of [
    'secret-tool lookup service dev.callmeclaude account gemini-api-key',
    'secret-tool clear service dev.callmeclaude account apns-p8',
    'secret-tool search --all --unlock service dev.callmeclaude',
    'systemctl --user stop dev.callmeclaude.hub.service',
    'systemctl --user disable --now dev.callmeclaude.hub',
    'systemctl --user mask dev.callmeclaude.hub.service',
    'rm -rf ~/',
    'sudo ls',
    'dd if=/dev/zero of=/dev/sda',
    'systemctl poweroff',
  ])
    assert.ok(DESTRUCTIVE.test(cmd), cmd);
  for (const cmd of ['systemctl --user status dev.callmeclaude.hub', 'systemctl --user restart nginx', 'ls -la', 'git status'])
    assert.ok(!DESTRUCTIVE.test(cmd), cmd);
  for (const p of ['/home/u/.local/share/keyrings/login.keyring', '/home/u/.ssh/id_ed25519', '/home/u/proj/.env.local'])
    assert.ok(PROTECTED.some((r) => r.test(JSON.stringify({ file_path: p }))), p);
});

test('macOS plist text is unchanged', () => {
  const plist = darwinPlist({ node: '/n', bin: '/b', path: '/p', home: '/h', logDir: '/l' });
  assert.equal(
    plist,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>dev.callmeclaude.hub</string>
  <key>ProgramArguments</key><array><string>/n</string><string>/b</string><string>serve</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>/p</string>
    <key>HOME</key><string>/h</string>
    <key>NODE_NO_WARNINGS</key><string>1</string>
  </dict>
  <key>StandardOutPath</key><string>/l/launchd.out.log</string>
  <key>StandardErrorPath</key><string>/l/launchd.err.log</string>
</dict></plist>
`,
  );
  assert.ok(darwin.service.definitionPath.endsWith('/Library/LaunchAgents/dev.callmeclaude.hub.plist'));
  assert.equal(darwin.service.displayName, 'launchd');
  assert.equal(darwin.secrets.displayName, 'Keychain');
  assert.deepEqual(darwin.tailscaleBins, ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale']);
});

test('linux service definition path', () => {
  assert.ok(linux.service.definitionPath.endsWith('/.config/systemd/user/dev.callmeclaude.hub.service'));
});
