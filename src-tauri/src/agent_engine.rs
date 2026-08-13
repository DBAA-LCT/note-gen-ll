use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
#[cfg(windows)]
use std::process::Command as StdCommand;
use std::sync::Arc;
use tauri::State;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;
use tokio::time::{timeout, Duration};

#[derive(Default)]
pub struct AgentEngineManager {
    processes: Mutex<HashMap<String, (u32, Arc<std::sync::atomic::AtomicBool>)>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEngineRequest {
    run_id: String,
    engine: String,
    prompt: String,
    workspace: String,
    executable: Option<String>,
    model: Option<String>,
    permission_mode: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEngineResult {
    exit_code: i32,
    stdout: String,
    stderr: String,
    cancelled: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEngineInspection {
    engine: String,
    available: bool,
    executable: Option<String>,
    version: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEngineModel {
    id: String,
    name: String,
    description: Option<String>,
    is_current: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentEngineCommand {
    name: String,
    description: String,
    argument_hint: Option<String>,
    source: String,
}

fn command_description(engine: &str, name: &str) -> &'static str {
    match (engine, name) {
        (_, "init") => "初始化当前项目的 Agent 配置",
        (_, "context") => "查看当前上下文占用",
        (_, "status") => "查看当前 Agent 与工作区状态",
        (_, "doctor") => "检查 Agent 环境与配置",
        (_, "review") | (_, "code-review") => "审查当前工作区的代码改动",
        (_, "security-review") => "执行安全审查",
        (_, "compact") => "压缩当前会话上下文",
        (_, "usage") | (_, "cost") => "查看用量与消耗",
        (_, "recap") => "回顾当前会话的工作",
        (_, "debug") => "诊断并调试当前问题",
        (_, "simplify") => "检查并简化最近的代码改动",
        (_, "batch") => "批量执行可并行的工作",
        (_, "loop") => "按指定间隔重复执行任务",
        (_, "undo") => "撤销上一次 Agent 修改",
        (_, "redo") => "重做上一次撤销的修改",
        (_, "share") => "分享当前 Agent 会话",
        (_, "help") => "显示此 Agent 的帮助信息",
        ("codex", "diff") => "查看当前工作区差异",
        ("codex", "permissions") => "调整 Codex 的审批与沙箱权限",
        ("codex", "model") => "切换 Codex 模型",
        _ => "运行此 Agent 提供的快捷指令",
    }
}

fn push_command(commands: &mut Vec<AgentEngineCommand>, engine: &str, name: &str, source: &str, description: Option<String>, argument_hint: Option<String>) {
    let name = name.trim().trim_start_matches('/');
    if name.is_empty() || !name.chars().all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | ':' | '.')) {
        return;
    }
    if commands.iter().any(|command| command.name == name) { return; }
    commands.push(AgentEngineCommand {
        name: name.to_string(),
        description: description.filter(|value| !value.trim().is_empty()).unwrap_or_else(|| command_description(engine, name).to_string()),
        argument_hint,
        source: source.to_string(),
    });
}

fn markdown_frontmatter_value(content: &str, key: &str) -> Option<String> {
    let mut lines = content.lines();
    if lines.next()?.trim() != "---" { return None; }
    for line in lines {
        let line = line.trim();
        if line == "---" { break; }
        let Some((field, value)) = line.split_once(':') else { continue; };
        if field.trim() == key {
            return Some(value.trim().trim_matches(['\'', '"']).to_string());
        }
    }
    None
}

fn scan_command_markdown(commands: &mut Vec<AgentEngineCommand>, engine: &str, root: &Path, current: &Path, skills: bool, source: &str, depth: usize) {
    if depth > 8 || commands.len() >= 300 { return; }
    let Ok(entries) = std::fs::read_dir(current) else { return; };
    for entry in entries.flatten() {
        if commands.len() >= 300 { break; }
        let Ok(file_type) = entry.file_type() else { continue; };
        if file_type.is_symlink() { continue; }
        let path = entry.path();
        if file_type.is_dir() {
            scan_command_markdown(commands, engine, root, &path, skills, source, depth + 1);
            continue;
        }
        let is_skill = skills && path.file_name().and_then(|value| value.to_str()).is_some_and(|value| value.eq_ignore_ascii_case("SKILL.md"));
        let is_command = !skills && path.extension().and_then(|value| value.to_str()).is_some_and(|value| value.eq_ignore_ascii_case("md"));
        if !is_skill && !is_command { continue; }
        let command_path = if is_skill { path.parent().unwrap_or(&path) } else { path.as_path() };
        let Ok(relative) = command_path.strip_prefix(root) else { continue; };
        let mut parts = relative.components().filter_map(|part| part.as_os_str().to_str()).map(str::to_string).collect::<Vec<_>>();
        if !is_skill {
            if let Some(last) = parts.last_mut() {
                *last = Path::new(last).file_stem().and_then(|value| value.to_str()).unwrap_or(last).to_string();
            }
        }
        let name = parts.join(":");
        let content = std::fs::read_to_string(&path).unwrap_or_default();
        push_command(
            commands,
            engine,
            &name,
            source,
            markdown_frontmatter_value(&content, "description"),
            markdown_frontmatter_value(&content, "argument-hint"),
        );
    }
}

fn scan_engine_commands(commands: &mut Vec<AgentEngineCommand>, engine: &str, base: &Path, folder: &str, source: &str) {
    let commands_root = base.join(folder).join("commands");
    scan_command_markdown(commands, engine, &commands_root, &commands_root, false, source, 0);
    let skills_root = base.join(folder).join("skills");
    scan_command_markdown(commands, engine, &skills_root, &skills_root, true, source, 0);
}

fn default_command(engine: &str) -> Result<&'static str, String> {
    match engine {
        "opencode" => Ok("opencode"),
        "claude" => Ok("claude"),
        "codex" => Ok("codex"),
        "workbuddy" => Ok("codebuddy"),
        _ => Err("Unsupported Agent engine".to_string()),
    }
}

fn command_with_script_support(executable: &str) -> (String, Vec<String>) {
    if cfg!(windows) && executable.to_ascii_lowercase().ends_with(".ps1") {
        return ("powershell.exe".to_string(), vec![
            "-NoProfile".to_string(), "-ExecutionPolicy".to_string(), "Bypass".to_string(),
            "-File".to_string(), executable.to_string(),
        ]);
    }
    if cfg!(windows) && Path::new(executable).is_file() && Path::new(executable).extension().is_none() {
        return ("node.exe".to_string(), vec![executable.to_string()]);
    }
    (executable.to_string(), Vec::new())
}

fn resolved_executable(engine: &str, custom: Option<&str>) -> Result<String, String> {
    let custom = custom.map(str::trim).filter(|value| !value.is_empty());
    #[cfg(windows)]
    let detected = std::env::var("LOCALAPPDATA").ok().map(|root| {
        PathBuf::from(root).join("Programs/WorkBuddy/resources/app.asar.unpacked/cli/bin/codebuddy")
    }).filter(|path| engine == "workbuddy" && path.is_file());
    #[cfg(not(windows))]
    let detected: Option<PathBuf> = None;
    let value = custom.map(str::to_string)
        .or_else(|| detected.map(|path| path.to_string_lossy().to_string()))
        .or_else(|| discover_windows_command(engine))
        .unwrap_or(default_command(engine)?.to_string());
    if value.contains('\0') { return Err("Invalid Agent executable path".to_string()); }
    Ok(value)
}

fn user_home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

fn push_model(models: &mut Vec<AgentEngineModel>, id: &str, name: Option<&str>) {
    let id = id.trim();
    if id.is_empty() || models.iter().any(|item| item.id == id) { return; }
    models.push(AgentEngineModel {
        id: id.to_string(),
        name: name.map(str::trim).filter(|value| !value.is_empty()).unwrap_or(id).to_string(),
        description: None,
        is_current: false,
    });
}

fn workbuddy_models_from_acp(value: &serde_json::Value) -> Vec<AgentEngineModel> {
    let result = value.get("result").unwrap_or(value);
    let current_model = result.pointer("/models/currentModelId")
        .or_else(|| result.get("currentModelId"))
        .and_then(serde_json::Value::as_str);
    let available = result.pointer("/models/availableModels")
        .or_else(|| result.get("availableModels"))
        .and_then(serde_json::Value::as_array);
    let mut models = Vec::new();

    if let Some(items) = available {
        for item in items {
            let Some(id) = item.get("modelId").or_else(|| item.get("id")).and_then(serde_json::Value::as_str) else { continue; };
            let id = id.trim();
            if id.is_empty() || models.iter().any(|model: &AgentEngineModel| model.id == id) { continue; }
            models.push(AgentEngineModel {
                id: id.to_string(),
                name: item.get("name").and_then(serde_json::Value::as_str).map(str::trim).filter(|name| !name.is_empty()).unwrap_or(id).to_string(),
                description: item.get("description").and_then(serde_json::Value::as_str).map(str::trim).filter(|description| !description.is_empty()).map(str::to_string),
                is_current: current_model == Some(id),
            });
        }
    }

    if models.is_empty() {
        if let Some(options) = result.get("configOptions").and_then(serde_json::Value::as_array) {
            if let Some(model_option) = options.iter().find(|option| option.get("id").and_then(serde_json::Value::as_str) == Some("model")) {
                let selected = model_option.get("currentValue").and_then(serde_json::Value::as_str);
                if let Some(items) = model_option.get("options").and_then(serde_json::Value::as_array) {
                    for item in items {
                        let Some(id) = item.get("value").and_then(serde_json::Value::as_str) else { continue; };
                        let id = id.trim();
                        if id.is_empty() { continue; }
                        models.push(AgentEngineModel {
                            id: id.to_string(),
                            name: item.get("name").and_then(serde_json::Value::as_str).unwrap_or(id).to_string(),
                            description: item.get("description").and_then(serde_json::Value::as_str).map(str::to_string),
                            is_current: selected == Some(id),
                        });
                    }
                }
            }
        }
    }
    models
}

async fn list_workbuddy_models_via_acp(executable: &str, workspace: Option<&str>) -> Result<Vec<AgentEngineModel>, String> {
    let (program, mut args) = command_with_script_support(executable);
    args.push("--acp".to_string());
    let mut command = Command::new(&program);
    command.args(&args).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
    if let Some(workspace) = workspace.map(str::trim).filter(|path| !path.is_empty()) {
        let path = Path::new(workspace);
        if !path.is_dir() { return Err(format!("Agent workspace does not exist: {}", path.display())); }
        command.current_dir(path);
    }
    let mut child = command.spawn().map_err(|error| format!("Failed to start WorkBuddy ACP: {error}"))?;
    let mut stdin = child.stdin.take().ok_or("Failed to open WorkBuddy ACP input")?;
    let stdout = child.stdout.take().ok_or("Failed to open WorkBuddy ACP output")?;
    let initialize = serde_json::json!({
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": { "protocolVersion": 1, "clientCapabilities": {} }
    });
    stdin.write_all(format!("{initialize}\n").as_bytes()).await.map_err(|error| format!("Failed to initialize WorkBuddy ACP: {error}"))?;
    stdin.flush().await.map_err(|error| error.to_string())?;

    let cwd = workspace.map(str::trim).filter(|path| !path.is_empty())
        .map(str::to_string)
        .or_else(|| std::env::current_dir().ok().map(|path| path.to_string_lossy().to_string()))
        .ok_or("Failed to determine WorkBuddy workspace")?;
    let mut lines = BufReader::new(stdout).lines();
    let response = timeout(Duration::from_secs(45), async {
        let mut session_requested = false;
        while let Some(line) = lines.next_line().await.map_err(|error| error.to_string())? {
            let Ok(message) = serde_json::from_str::<serde_json::Value>(&line) else { continue; };
            if message.get("id").and_then(serde_json::Value::as_i64) == Some(1) && !session_requested {
                if let Some(error) = message.get("error") { return Err(format!("WorkBuddy ACP initialization failed: {error}")); }
                let request = serde_json::json!({
                    "jsonrpc": "2.0", "id": 2, "method": "session/new",
                    "params": { "cwd": cwd, "mcpServers": [] }
                });
                stdin.write_all(format!("{request}\n").as_bytes()).await.map_err(|error| error.to_string())?;
                stdin.flush().await.map_err(|error| error.to_string())?;
                session_requested = true;
            } else if message.get("id").and_then(serde_json::Value::as_i64) == Some(2) {
                if let Some(error) = message.get("error") { return Err(format!("WorkBuddy ACP session failed: {error}")); }
                return Ok(message);
            }
        }
        Err("WorkBuddy ACP closed before returning its model list".to_string())
    }).await.map_err(|_| "Timed out while reading WorkBuddy account models".to_string())??;
    let _ = child.kill().await;
    let models = workbuddy_models_from_acp(&response);
    if models.is_empty() { Err("WorkBuddy ACP returned an empty model list".to_string()) } else { Ok(models) }
}

fn read_json_file(path: &Path) -> Option<serde_json::Value> {
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

fn models_from_local_config(engine: &str) -> Vec<AgentEngineModel> {
    let Some(home) = user_home_dir() else { return Vec::new(); };
    let mut models = Vec::new();
    match engine {
        "workbuddy" => {
            if let Some(value) = read_json_file(&home.join(".codebuddy/models.json")) {
                if let Some(items) = value.get("models").and_then(serde_json::Value::as_array) {
                    for item in items {
                        if let Some(id) = item.get("id").and_then(serde_json::Value::as_str) {
                            push_model(&mut models, id, item.get("name").and_then(serde_json::Value::as_str));
                        }
                    }
                }
            }
            if let Some(value) = read_json_file(&home.join(".codebuddy/settings.json")) {
                if let Some(model) = value.get("model").and_then(serde_json::Value::as_str) {
                    push_model(&mut models, model, None);
                }
            }
        }
        "claude" => {
            if let Some(value) = read_json_file(&home.join(".claude/settings.json")) {
                if let Some(model) = value.get("model").and_then(serde_json::Value::as_str) {
                    push_model(&mut models, model, None);
                }
                if let Some(env) = value.get("env").and_then(serde_json::Value::as_object) {
                    for (key, value) in env {
                        if key.ends_with("_MODEL") {
                            if let Some(model) = value.as_str() { push_model(&mut models, model, None); }
                        }
                    }
                }
            }
        }
        "codex" => {
            if let Some(value) = read_json_file(&home.join(".codex/models_cache.json")) {
                if let Some(items) = value.get("models").and_then(serde_json::Value::as_array) {
                    for item in items {
                        if item.get("visibility").and_then(serde_json::Value::as_str) == Some("hide") { continue; }
                        if let Some(id) = item.get("slug").and_then(serde_json::Value::as_str) {
                            push_model(&mut models, id, item.get("display_name").and_then(serde_json::Value::as_str));
                        }
                    }
                }
            }
        }
        _ => {}
    }
    models
}

#[cfg(windows)]
fn discover_windows_command(engine: &str) -> Option<String> {
    let command_name = default_command(engine).ok()?;
    let script = format!(
        "(Get-Command -Name '{}' -CommandType Application,ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source)",
        command_name
    );
    let output = StdCommand::new("powershell.exe")
        .args(["-NoProfile", "-Command", &script])
        .stdin(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() { return None; }
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() { None } else { Some(path) }
}

#[cfg(not(windows))]
fn discover_windows_command(_engine: &str) -> Option<String> { None }

#[tauri::command]
pub async fn inspect_agent_engine(engine: String, executable: Option<String>) -> Result<AgentEngineInspection, String> {
    let value = resolved_executable(&engine, executable.as_deref())?;
    let (program, mut prefix) = command_with_script_support(&value);
    prefix.push("--version".to_string());
    match Command::new(&program).args(&prefix).stdin(Stdio::null()).output().await {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            Ok(AgentEngineInspection {
                engine, available: output.status.success(), executable: Some(value),
                version: if stdout.is_empty() { None } else { Some(stdout.lines().next().unwrap_or_default().to_string()) },
                error: if output.status.success() { None } else { Some(stderr) },
            })
        }
        Err(error) => Ok(AgentEngineInspection { engine, available: false, executable: Some(value), version: None, error: Some(error.to_string()) }),
    }
}

#[tauri::command]
pub async fn list_agent_engine_models(engine: String, executable: Option<String>, workspace: Option<String>) -> Result<Vec<AgentEngineModel>, String> {
    if engine == "opencode" {
        let value = resolved_executable(&engine, executable.as_deref())?;
        let (program, mut args) = command_with_script_support(&value);
        args.push("models".to_string());
        let output = Command::new(&program).args(&args).stdin(Stdio::null()).output().await
            .map_err(|error| format!("Failed to list OpenCode models: {error}"))?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        let mut models = Vec::new();
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            let id = line.trim();
            if id.contains('/') { push_model(&mut models, id, None); }
        }
        return Ok(models);
    }
    if engine == "workbuddy" {
        let value = resolved_executable(&engine, executable.as_deref())?;
        return list_workbuddy_models_via_acp(&value, workspace.as_deref()).await;
    }
    Ok(models_from_local_config(&engine))
}

async fn discover_claude_slash_commands(executable: &str, workspace: Option<&Path>) -> Vec<String> {
    let (program, mut args) = command_with_script_support(executable);
    args.extend(["-p", "/help", "--output-format", "stream-json", "--verbose", "--permission-mode", "plan"].map(str::to_string));
    let mut command = Command::new(&program);
    command.args(&args).stdin(Stdio::null());
    if let Some(workspace) = workspace { command.current_dir(workspace); }
    let Ok(Ok(output)) = timeout(Duration::from_secs(20), command.output()).await else { return Vec::new(); };
    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        let Ok(message) = serde_json::from_str::<serde_json::Value>(line) else { continue; };
        if message.get("type").and_then(serde_json::Value::as_str) != Some("system")
            || message.get("subtype").and_then(serde_json::Value::as_str) != Some("init") { continue; }
        return message.get("slash_commands")
            .and_then(serde_json::Value::as_array)
            .into_iter().flatten()
            .filter_map(serde_json::Value::as_str)
            .filter(|name| !name.starts_with("__") && !name.starts_with("workflow-"))
            .map(str::to_string)
            .collect();
    }
    Vec::new()
}

#[tauri::command]
pub async fn list_agent_engine_commands(engine: String, executable: Option<String>, workspace: Option<String>) -> Result<Vec<AgentEngineCommand>, String> {
    if !matches!(engine.as_str(), "opencode" | "claude" | "codex" | "workbuddy") {
        return Err("Unsupported Agent engine".to_string());
    }
    let workspace_path = workspace.as_deref().map(str::trim).filter(|value| !value.is_empty()).map(PathBuf::from);
    if workspace_path.as_ref().is_some_and(|path| !path.is_dir()) {
        return Err(format!("Agent workspace does not exist: {}", workspace_path.as_ref().unwrap().display()));
    }

    let mut commands = Vec::new();
    let folder = match engine.as_str() {
        "claude" => Some(".claude"),
        "workbuddy" => Some(".codebuddy"),
        "opencode" => Some(".opencode"),
        _ => None,
    };
    if let Some(folder) = folder {
        if let Some(home) = user_home_dir() { scan_engine_commands(&mut commands, &engine, &home, folder, "personal"); }
        if let Some(workspace) = workspace_path.as_deref() { scan_engine_commands(&mut commands, &engine, workspace, folder, "project"); }
    }

    let builtin_names: &[&str] = match engine.as_str() {
        "claude" => {
            let value = resolved_executable(&engine, executable.as_deref())?;
            let discovered = discover_claude_slash_commands(&value, workspace_path.as_deref()).await;
            let discovery_failed = discovered.is_empty();
            for name in discovered { push_command(&mut commands, &engine, &name, "claude", None, None); }
            if discovery_failed { &["context", "init", "review", "security-review", "usage"] } else { &[] }
        }
        "workbuddy" => &["help", "doctor", "status", "context", "cost", "init", "compact", "insights"],
        "opencode" => &["init", "undo", "redo", "share", "help"],
        "codex" => &["status", "model", "permissions", "review", "init", "compact", "diff", "mcp"],
        _ => &[],
    };
    for name in builtin_names { push_command(&mut commands, &engine, name, "builtin", None, None); }
    commands.sort_by(|left, right| left.source.cmp(&right.source).then_with(|| left.name.cmp(&right.name)));
    Ok(commands)
}

#[tauri::command]
pub async fn run_agent_engine(manager: State<'_, AgentEngineManager>, request: AgentEngineRequest) -> Result<AgentEngineResult, String> {
    if request.run_id.len() > 80 || request.prompt.len() > 2_000_000 || request.model.as_deref().is_some_and(|model| model.len() > 300 || model.contains('\0')) {
        return Err("Invalid Agent request".to_string());
    }
    let workspace = PathBuf::from(&request.workspace);
    if !workspace.is_dir() {
        return Err(format!("Agent workspace does not exist: {}", workspace.display()));
    }
    let executable = resolved_executable(&request.engine, request.executable.as_deref())?;
    let (program, mut args) = command_with_script_support(&executable);
    let writable = request.permission_mode.as_deref() != Some("read-only");
    match request.engine.as_str() {
        "opencode" => {
            args.extend(["run", "--format", "json"].map(str::to_string));
            if let Some(model) = request.model.as_deref().map(str::trim).filter(|model| !model.is_empty()) {
                args.extend(["--model".to_string(), model.to_string()]);
            }
            args.push(request.prompt.clone());
        }
        "claude" => {
            args.extend(["-p", "--output-format", "json", "--permission-mode", if writable { "acceptEdits" } else { "plan" }].map(str::to_string));
            if let Some(model) = request.model.as_deref().map(str::trim).filter(|model| !model.is_empty()) {
                args.extend(["--model".to_string(), model.to_string()]);
            }
            args.push(request.prompt.clone());
        }
        "codex" => {
            args.extend(["exec", "--json", "--skip-git-repo-check", "--sandbox", if writable { "workspace-write" } else { "read-only" }, "-C"].map(str::to_string));
            args.push(workspace.to_string_lossy().to_string());
            if let Some(model) = request.model.as_deref().map(str::trim).filter(|model| !model.is_empty()) {
                args.extend(["--model".to_string(), model.to_string()]);
            }
            args.push(request.prompt.clone());
        }
        "workbuddy" => {
            args.extend(["--print", "--output-format", "json", "--permission-mode", if writable { "acceptEdits" } else { "plan" }].map(str::to_string));
            if let Some(model) = request.model.as_deref().map(str::trim).filter(|model| !model.is_empty()) {
                args.extend(["--model".to_string(), model.to_string()]);
            }
            args.push(request.prompt.clone());
        }
        _ => return Err("Unsupported Agent engine".to_string()),
    }
    let child = Command::new(&program).args(&args).current_dir(Path::new(&request.workspace))
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true)
        .spawn().map_err(|e| format!("Failed to start {}: {e}", request.engine))?;
    let pid = child.id().ok_or("Failed to determine Agent process ID")?;
    let cancelled = Arc::new(std::sync::atomic::AtomicBool::new(false));
    manager.processes.lock().await.insert(request.run_id.clone(), (pid, cancelled.clone()));
    let output = child.wait_with_output().await.map_err(|e| format!("Agent process failed: {e}"))?;
    manager.processes.lock().await.remove(&request.run_id);
    Ok(AgentEngineResult {
        exit_code: output.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        cancelled: cancelled.load(std::sync::atomic::Ordering::SeqCst),
    })
}

#[tauri::command]
pub async fn cancel_agent_engine(manager: State<'_, AgentEngineManager>, run_id: String) -> Result<bool, String> {
    let process = manager.processes.lock().await.get(&run_id).cloned();
    let Some((pid, cancelled)) = process else { return Ok(false); };
    cancelled.store(true, std::sync::atomic::Ordering::SeqCst);
    #[cfg(windows)]
    let status = Command::new("taskkill").args(["/PID", &pid.to_string(), "/T", "/F"]).output().await;
    #[cfg(not(windows))]
    let status = Command::new("kill").args(["-TERM", &pid.to_string()]).output().await;
    status.map_err(|e| format!("Failed to stop Agent process: {e}"))?;
    Ok(true)
}
