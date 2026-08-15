import { createServer } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const projectRoot = resolve(import.meta.dirname, '..')
const packagedRoot = process.argv[2] ? resolve(process.argv[2]) : undefined
const node = packagedRoot
  ? join(packagedRoot, process.platform === 'win32' ? 'node.exe' : 'bin/node')
  : process.execPath
const cli = packagedRoot
  ? join(packagedRoot, 'harness/lib/bin.js')
  : join(projectRoot, 'harness/apps/cli/lib/bin.js')
const home = await mkdtemp(join(tmpdir(), 'notegoal-harness-smoke-'))

const modelRequests = []
const server = createServer((request, response) => {
  let body = ''
  request.setEncoding('utf8')
  request.on('data', chunk => { body += chunk })
  request.on('end', () => {
    modelRequests.push(JSON.parse(body))
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write('data: {"choices":[{"delta":{"role":"assistant","content":null,"reasoning_content":""}}]}\n\n')
    response.write('data: {"choices":[{"delta":{"content":"packaged harness ok"}}]}\n\n')
    response.write('data: {"choices":[{"delta":{"content":""},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":3}}\n\n')
    response.write('data: [DONE]\n\n')
    response.end()
  })
})

await new Promise((resolvePromise, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolvePromise)
})
const address = server.address()
if (!address || typeof address === 'string') throw new Error('Harness smoke server has no TCP port')

await writeFile(join(home, 'settings.yaml'), JSON.stringify({
  'llm-pi-ai': {
    providers: {
      notegoal: {
        apiKeyEnv: 'NOTEGOAL_AI_API_KEY',
        displayName: 'NoteGoal smoke',
        api: 'openai-completions',
        baseURL: `http://127.0.0.1:${address.port}`,
        models: [{ id: 'smoke-model', name: 'Smoke Model', contextWindow: 8192, maxTokens: 256 }],
      },
    },
  },
}, null, 2))

const child = spawn(node, [cli, '--profile', 'notegoal'], {
  cwd: projectRoot,
  env: {
    ...process.env,
    DSH_HOME: home,
    DSH_TELEMETRY_DISABLED: '1',
    NOTEGOAL_AI_API_KEY: 'smoke-key',
  },
  stdio: ['pipe', 'pipe', 'pipe'],
})

let stderr = ''
let stdoutBuffer = ''
let nextId = 1
const pending = new Map()
const notifications = []

child.stderr.setEncoding('utf8')
child.stderr.on('data', chunk => { stderr += chunk })
child.stdout.setEncoding('utf8')
child.stdout.on('data', chunk => {
  stdoutBuffer += chunk
  for (;;) {
    const newline = stdoutBuffer.indexOf('\n')
    if (newline < 0) break
    const line = stdoutBuffer.slice(0, newline).trim()
    stdoutBuffer = stdoutBuffer.slice(newline + 1)
    if (!line) continue
    const frame = JSON.parse(line)
    if (frame.id !== undefined && frame.method === undefined) {
      const waiter = pending.get(String(frame.id))
      if (waiter) {
        pending.delete(String(frame.id))
        frame.error ? waiter.reject(new Error(JSON.stringify(frame.error))) : waiter.resolve(frame.result)
      }
    } else if (frame.method) {
      notifications.push(frame)
    }
  }
})

function rpc(method, params, timeoutMs = 60_000) {
  const id = nextId++
  const result = new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(String(id))
      reject(new Error(`${method} timed out; stderr: ${stderr}`))
    }, timeoutMs)
    pending.set(String(id), {
      resolve: value => { clearTimeout(timeout); resolvePromise(value) },
      reject: error => { clearTimeout(timeout); reject(error) },
    })
  })
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  return result
}

async function waitFor(predicate, description, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const match = notifications.find(predicate)
    if (match) return match
    await new Promise(resolvePromise => setTimeout(resolvePromise, 20))
  }
  throw new Error(`Timed out waiting for ${description}; stderr: ${stderr}`)
}

try {
  await rpc('initialize', {
    cwd: projectRoot,
    provider: 'notegoal',
    model: 'smoke-model',
    maxTokens: 256,
  })
  const receipt = await rpc('session/prompt', {
    sessionId: 'smoke-session',
    contentBlocks: [{ type: 'text', text: 'Reply with the smoke result.' }],
  })
  if (typeof receipt?.messageId !== 'string') throw new Error('session/prompt returned no message id')
  await waitFor(frame => frame.method === 'session.event'
    && frame.params?.event?.type === 'assistant/message', 'assistant message')
  await waitFor(frame => frame.method === 'session.status'
    && frame.params?.sessionId === 'smoke-session'
    && frame.params?.status === 'idle', 'idle session')
  const prompted = modelRequests.some(request => request.messages?.some(message => (
    message.role === 'user' && JSON.stringify(message.content).includes('Reply with the smoke result.')
  )))
  if (!prompted) throw new Error(`No model request contained the smoke prompt (${modelRequests.length} requests observed)`)
  await rpc('shutdown', undefined)
  console.log(`DeepSeek Harness smoke passed (${packagedRoot ? 'packaged' : 'development'} runtime)`)
} finally {
  child.stdin.end()
  if (child.exitCode === null) child.kill()
  await new Promise(resolvePromise => server.close(resolvePromise))
  await rm(home, { recursive: true, force: true })
}
