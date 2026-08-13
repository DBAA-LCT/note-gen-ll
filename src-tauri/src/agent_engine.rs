use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
#[cfg(windows)]
use std::process::Command as StdCommand;
use std::sync::Arc;
use tauri::State;
use tokio::process::Command;
use tokio::sync::Mutex;

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
    });
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
pub async fn list_agent_engine_models(engine: String, executable: Option<String>) -> Result<Vec<AgentEngineModel>, String> {
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
    Ok(models_from_local_config(&engine))
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
