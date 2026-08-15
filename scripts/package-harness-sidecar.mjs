import { copyFile, cp, mkdir, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const harnessRoot = resolve(projectRoot, 'harness')
const stageRoot = resolve(projectRoot, '.codex-runtime/harness-package-stage')
const runtimeRoot = resolve(stageRoot, 'harness')
const archiveTarget = resolve(projectRoot, 'src-tauri/resources/harness-runtime.zip')

if (!stageRoot.startsWith(resolve(projectRoot, '.codex-runtime') + '\\')
  && !stageRoot.startsWith(resolve(projectRoot, '.codex-runtime') + '/')) {
  throw new Error(`Refusing to replace runtime stage outside project cache: ${stageRoot}`)
}
await rm(stageRoot, { recursive: true, force: true })
await rm(resolve(projectRoot, 'src-tauri/resources/harness-runtime'), { recursive: true, force: true })
await rm(archiveTarget, { force: true })
await mkdir(stageRoot, { recursive: true })

await new Promise((resolvePromise, reject) => {
  const pnpmArgs = [
    // Deploy the CLI package because `harness/lib/bin.js` is the executable
    // entrypoint. The NoteGoal profile bundle is a CLI dependency, so pnpm
    // includes both the launcher dependencies and our profile composition.
    'pnpm', 'deploy', '--legacy', '--config.node-linker=hoisted', '--filter', '@deepseek-ai/dsh',
    '--prod', runtimeRoot,
  ]
  const command = process.platform === 'win32'
    ? (process.env.ComSpec ?? 'cmd.exe')
    : 'corepack'
  const args = process.platform === 'win32'
    ? ['/d', '/c', `corepack ${pnpmArgs.map(quoteWindowsArg).join(' ')}`]
    : pnpmArgs
  const child = spawn(command, args, {
    cwd: harnessRoot,
    env: {
      ...process.env,
      CI: 'true',
      npm_config_confirm_modules_purge: 'false',
    },
    stdio: 'inherit',
  })
  child.once('error', reject)
  child.once('exit', code => code === 0
    ? resolvePromise()
    : reject(new Error(`Harness deploy exited with code ${code}`)))
})

function quoteWindowsArg(value) {
  return /\s/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

const nodeTarget = process.platform === 'win32'
  ? resolve(stageRoot, 'node.exe')
  : resolve(stageRoot, 'bin/node')
await mkdir(dirname(nodeTarget), { recursive: true })
await copyFile(process.execPath, nodeTarget)
await cp(resolve(harnessRoot, 'apps/cli/lib'), resolve(runtimeRoot, 'lib'), { recursive: true, force: true })
await cp(resolve(harnessRoot, 'apps/cli/config'), resolve(runtimeRoot, 'config'), { recursive: true, force: true })

// libarchive follows the hoisted pnpm links while the virtual store itself is
// excluded. This produces ordinary files in the ZIP without a slow JS copy of
// every package or leaking pnpm's absolute development paths.
await run('tar', [
  '--format', 'zip',
  '--options', 'zip:compression=store',
  '-L',
  '--exclude', 'harness/node_modules/.pnpm',
  '-cf', archiveTarget,
  '-C', stageRoot,
  '.',
], projectRoot)
await rm(stageRoot, { recursive: true, force: true })

console.log(`Packaged DeepSeek Harness sidecar at ${archiveTarget}`)

function run(command, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', code => code === 0
      ? resolvePromise()
      : reject(new Error(`${command} exited with code ${code}`)))
  })
}
