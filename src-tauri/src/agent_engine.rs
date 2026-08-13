use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
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

fn default_command(engine: &str) -> Result<&'static str, String> {
    match engine {
        "opencode" => Ok("opencode"),
        "claude" => Ok("claude"),
        "codex" => Ok("codex"),
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
    (executable.to_string(), Vec::new())
}

fn resolved_executable(engine: &str, custom: Option<&str>) -> Result<String, String> {
    let value = custom.map(str::trim).filter(|v| !v.is_empty()).unwrap_or(default_command(engine)?);
    if value.contains('\0') { return Err("Invalid Agent executable path".to_string()); }
    Ok(value.to_string())
}

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
pub async fn run_agent_engine(manager: State<'_, AgentEngineManager>, request: AgentEngineRequest) -> Result<AgentEngineResult, String> {
    if request.run_id.len() > 80 || request.prompt.len() > 2_000_000 { return Err("Invalid Agent request".to_string()); }
    let workspace = PathBuf::from(&request.workspace);
    if !workspace.is_dir() { return Err("Agent workspace does not exist".to_string()); }
    let executable = resolved_executable(&request.engine, request.executable.as_deref())?;
    let (program, mut args) = command_with_script_support(&executable);
    let writable = request.permission_mode.as_deref() != Some("read-only");
    match request.engine.as_str() {
        "opencode" => {
            args.extend(["run", "--format", "json"].map(str::to_string));
            args.push(request.prompt.clone());
        }
        "claude" => {
            args.extend(["-p", "--output-format", "json", "--permission-mode", if writable { "acceptEdits" } else { "plan" }].map(str::to_string));
            args.push(request.prompt.clone());
        }
        "codex" => {
            args.extend(["exec", "--json", "--skip-git-repo-check", "--sandbox", if writable { "workspace-write" } else { "read-only" }, "-C"].map(str::to_string));
            args.push(workspace.to_string_lossy().to_string());
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
