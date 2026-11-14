import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cwd = fileURLToPath(new URL('../release/android/', import.meta.url));
const tasks = process.argv.slice(2);
if (!tasks.length) tasks.push('assembleDebug');
if (tasks.some(task => !/^[a-zA-Z][a-zA-Z0-9:]*$/.test(task))) {
  throw new Error('Pass Gradle task names, such as assembleDebug or assembleRelease.');
}
const windows = process.platform === 'win32';
const result = windows
  ? spawnSync('cmd.exe', ['/d', '/c', 'gradlew.bat', ...tasks], { cwd, stdio: 'inherit' })
  : spawnSync('./gradlew', tasks, { cwd, stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
