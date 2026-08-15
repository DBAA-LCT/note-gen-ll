use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::oneshot;
use zip::ZipArchive;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

const NOTIFICATION_EVENT: &str = "deepseek-harness://notification";
const CLOSED_EVENT: &str = "deepseek-harness://closed";

struct HarnessProcess {
    child: Arc<Mutex<Child>>,
    stdin: Arc<Mutex<ChildStdin>>,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<Result<Value, String>>>>>,
}

pub struct DeepSeekHarnessManager {
    process: Mutex<Option<Arc<HarnessProcess>>>,
    next_id: AtomicU64,
}

impl DeepSeekHarnessManager {
    pub fn new() -> Self {
        Self {
            process: Mutex::new(None),
            next_id: AtomicU64::new(1),
        }
    }

    fn take_process(&self) -> Option<Arc<HarnessProcess>> {
        self.process.lock().ok()?.take()
    }
}

impl Drop for DeepSeekHarnessManager {
    fn drop(&mut self) {
        if let Ok(slot) = self.process.get_mut() {
            if let Some(process) = slot.take() {
                if let Ok(mut child) = process.child.lock() {
                    let _ = child.kill();
                }
            }
        }
    }
}

fn development_runtime() -> Option<(PathBuf, PathBuf)> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent()?;
    let script = root.join("harness/apps/cli/lib/bin.js");
    script.exists().then(|| (PathBuf::from("node"), script))
}

fn packaged_runtime(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let archive_path = app
        .path()
        .resource_dir()
        .map_err(|error| format!("Cannot resolve application resources: {error}"))?
        .join("harness-runtime.zip");
    let archive_size = std::fs::metadata(&archive_path)
        .map_err(|error| format!("Cannot inspect packaged Harness runtime: {error}"))?
        .len();
    let root = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("Cannot resolve application cache: {error}"))?
        .join(format!("harness-runtime-{}-{archive_size}", app.package_info().version));
    #[cfg(target_os = "windows")]
    let node = root.join("node.exe");
    #[cfg(not(target_os = "windows"))]
    let node = root.join("bin/node");
    let script = root.join("harness/lib/bin.js");
    if !node.exists() || !script.exists() {
        extract_runtime_archive(&archive_path, &root)?;
        if !node.exists() || !script.exists() {
            return Err(format!(
                "Packaged DeepSeek Harness runtime is incomplete at {}",
                root.display()
            ));
        }
    }
    Ok((node, script))
}

fn extract_runtime_archive(archive_path: &Path, target: &Path) -> Result<(), String> {
    let parent = target.parent().ok_or("Harness runtime cache has no parent directory")?;
    std::fs::create_dir_all(parent)
        .map_err(|error| format!("Cannot create Harness runtime cache: {error}"))?;
    let temp = parent.join(format!(".harness-runtime-extract-{}", std::process::id()));
    if temp.exists() {
        std::fs::remove_dir_all(&temp)
            .map_err(|error| format!("Cannot clear temporary Harness runtime: {error}"))?;
    }
    std::fs::create_dir_all(&temp)
        .map_err(|error| format!("Cannot create temporary Harness runtime: {error}"))?;
    let file = std::fs::File::open(archive_path)
        .map_err(|error| format!("Cannot open packaged Harness runtime: {error}"))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|error| format!("Invalid packaged Harness runtime: {error}"))?;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)
            .map_err(|error| format!("Cannot read packaged Harness entry: {error}"))?;
        let relative = entry.enclosed_name()
            .ok_or_else(|| format!("Unsafe path in packaged Harness runtime: {}", entry.name()))?;
        let output = temp.join(relative);
        if entry.is_dir() {
            std::fs::create_dir_all(&output)
                .map_err(|error| format!("Cannot create Harness runtime directory: {error}"))?;
            continue;
        }
        if let Some(output_parent) = output.parent() {
            std::fs::create_dir_all(output_parent)
                .map_err(|error| format!("Cannot create Harness runtime directory: {error}"))?;
        }
        let mut output_file = std::fs::File::create(&output)
            .map_err(|error| format!("Cannot create Harness runtime file: {error}"))?;
        std::io::copy(&mut entry, &mut output_file)
            .map_err(|error| format!("Cannot extract Harness runtime file: {error}"))?;
    }
    if target.exists() {
        std::fs::remove_dir_all(target)
            .map_err(|error| format!("Cannot replace incomplete Harness runtime: {error}"))?;
    }
    std::fs::rename(&temp, target)
        .map_err(|error| format!("Cannot activate Harness runtime: {error}"))?;
    Ok(())
}

fn runtime_paths(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    development_runtime().map(Ok).unwrap_or_else(|| packaged_runtime(app))
}

fn response_id(value: &Value) -> Option<String> {
    value.get("id").map(|id| {
        id.as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| id.to_string())
    })
}

fn fail_pending(process: &HarnessProcess, error: &str) {
    if let Ok(mut pending) = process.pending.lock() {
        for (_, sender) in pending.drain() {
            let _ = sender.send(Err(error.to_owned()));
        }
    }
}

fn spawn_runtime(
    app: &AppHandle,
    harness_home: &Path,
    api_key: Option<&str>,
    permission_mode: &str,
) -> Result<Arc<HarnessProcess>, String> {
    let (node, script) = runtime_paths(app)?;
    std::fs::create_dir_all(harness_home)
        .map_err(|error| format!("Cannot create Harness data directory: {error}"))?;

    let mut command = Command::new(node);
    command
        .arg(script)
        .args(["--profile", "notegoal"])
        .env("DSH_HOME", harness_home)
        .env("DSH_TELEMETRY_DISABLED", "1")
        .env("DSH_PERMISSION_MODE", permission_mode)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(api_key) = api_key.filter(|value| !value.is_empty()) {
        command.env("NOTEGOAL_AI_API_KEY", api_key);
    }

    #[cfg(target_os = "windows")]
    command.creation_flags(windows::Win32::System::Threading::CREATE_NO_WINDOW.0);

    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to start DeepSeek Harness: {error}"))?;
    let stdin = child.stdin.take().ok_or("Harness stdin is unavailable")?;
    let stdout = child.stdout.take().ok_or("Harness stdout is unavailable")?;
    let stderr = child.stderr.take().ok_or("Harness stderr is unavailable")?;
    let process = Arc::new(HarnessProcess {
        child: Arc::new(Mutex::new(child)),
        stdin: Arc::new(Mutex::new(stdin)),
        pending: Arc::new(Mutex::new(HashMap::new())),
    });

    let reader_process = process.clone();
    let reader_app = app.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let line = match line {
                Ok(line) => line,
                Err(error) => {
                    let message = format!("Failed to read Harness output: {error}");
                    fail_pending(&reader_process, &message);
                    let _ = reader_app.emit(CLOSED_EVENT, json!({ "error": message }));
                    return;
                }
            };
            if line.trim().is_empty() {
                continue;
            }
            let value = match serde_json::from_str::<Value>(&line) {
                Ok(value) => value,
                Err(error) => {
                    let _ = reader_app.emit(
                        NOTIFICATION_EVENT,
                        json!({ "method": "runtime.stderr", "params": { "message": format!("Invalid Harness frame: {error}") } }),
                    );
                    continue;
                }
            };
            if value.get("method").and_then(Value::as_str).is_some() && value.get("id").is_some() {
                let _ = reader_app.emit(NOTIFICATION_EVENT, value);
            } else if let Some(id) = response_id(&value) {
                if let Ok(mut pending) = reader_process.pending.lock() {
                    if let Some(sender) = pending.remove(&id) {
                        let result = value.get("error").map_or_else(
                            || Ok(value.get("result").cloned().unwrap_or(Value::Null)),
                            |error| Err(error.to_string()),
                        );
                        let _ = sender.send(result);
                    }
                }
            } else {
                let _ = reader_app.emit(NOTIFICATION_EVENT, value);
            }
        }
        fail_pending(&reader_process, "DeepSeek Harness closed its output stream");
        let _ = reader_app.emit(CLOSED_EVENT, json!({ "error": null }));
    });

    let stderr_app = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            let _ = stderr_app.emit(
                NOTIFICATION_EVENT,
                json!({ "method": "runtime.stderr", "params": { "message": line } }),
            );
        }
    });

    Ok(process)
}

async fn request(
    process: Arc<HarnessProcess>,
    id: u64,
    method: &str,
    params: Option<Value>,
    timeout_ms: u64,
) -> Result<Value, String> {
    let id_key = id.to_string();
    let (sender, receiver) = oneshot::channel();
    process.pending.lock().map_err(|_| "Harness request state is poisoned")?.insert(id_key.clone(), sender);
    let frame = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
    let write_result = process
        .stdin
        .lock()
        .map_err(|_| "Harness stdin is poisoned".to_owned())
        .and_then(|mut stdin| {
        writeln!(stdin, "{frame}").map_err(|error| format!("Failed to write Harness request: {error}"))?;
        stdin.flush().map_err(|error| format!("Failed to flush Harness request: {error}"))
        });
    if let Err(error) = write_result {
        if let Ok(mut pending) = process.pending.lock() {
            pending.remove(&id_key);
        }
        return Err(error);
    }
    match tokio::time::timeout(std::time::Duration::from_millis(timeout_ms), receiver).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("Harness response channel closed".to_owned()),
        Err(_) => {
            if let Ok(mut pending) = process.pending.lock() {
                pending.remove(&id_key);
            }
            Err(format!("Harness request timed out after {timeout_ms}ms"))
        }
    }
}

#[tauri::command]
pub async fn start_deepseek_harness(
    cwd: String,
    model: String,
    base_url: String,
    api_key: Option<String>,
    custom_headers: Option<HashMap<String, String>>,
    context_window: Option<u64>,
    max_tokens: Option<u64>,
    permission_mode: String,
    app: AppHandle,
    manager: State<'_, DeepSeekHarnessManager>,
) -> Result<Value, String> {
    if let Some(old) = manager.take_process() {
        if let Ok(mut child) = old.child.lock() {
            let _ = child.kill();
        }
    }
    let app_data = app.path().app_data_dir().map_err(|error| error.to_string())?;
    let harness_home = app_data.join("deepseek-harness");
    std::fs::create_dir_all(&harness_home)
        .map_err(|error| format!("Cannot create Harness data directory: {error}"))?;
    let mut model_profile = json!({
        "id": model,
        "name": model,
        "input": ["text", "image"]
    });
    if let Some(value) = context_window.filter(|value| *value > 0) {
        model_profile["contextWindow"] = json!(value);
    }
    if let Some(value) = max_tokens.filter(|value| *value > 0) {
        model_profile["maxTokens"] = json!(value);
    }
    let mut provider_profile = json!({
        "displayName": "NoteGoal",
        "api": "openai-completions",
        "baseURL": base_url,
        "models": [model_profile],
        "headers": custom_headers.unwrap_or_default()
    });
    if api_key.as_deref().is_some_and(|value| !value.is_empty()) {
        provider_profile["apiKeyEnv"] = json!("NOTEGOAL_AI_API_KEY");
    }
    let settings = json!({
        "llm-pi-ai": {
            "providers": {
                "notegoal": provider_profile
            }
        }
    });
    std::fs::write(
        harness_home.join("settings.yaml"),
        serde_json::to_vec_pretty(&settings).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("Cannot write Harness model settings: {error}"))?;
    let harness_permission_mode = match permission_mode.as_str() {
        "read-only" => "read-only",
        "ask" | "auto-edit" => "workspace-write",
        _ => return Err(format!("Unsupported Agent permission mode: {permission_mode}")),
    };
    let process = spawn_runtime(
        &app,
        &harness_home,
        api_key.as_deref(),
        harness_permission_mode,
    )?;
    *manager.process.lock().map_err(|_| "Harness process state is poisoned")? = Some(process.clone());
    let id = manager.next_id.fetch_add(1, Ordering::Relaxed);
    request(
        process,
        id,
        "initialize",
        Some(json!({ "cwd": cwd, "provider": "notegoal", "model": model, "maxTokens": max_tokens })),
        60_000,
    )
    .await
}

#[tauri::command]
pub async fn request_deepseek_harness(
    method: String,
    params: Option<Value>,
    timeout_ms: Option<u64>,
    manager: State<'_, DeepSeekHarnessManager>,
) -> Result<Value, String> {
    let process = manager
        .process
        .lock()
        .map_err(|_| "Harness process state is poisoned")?
        .clone()
        .ok_or("DeepSeek Harness is not running")?;
    let id = manager.next_id.fetch_add(1, Ordering::Relaxed);
    request(process, id, &method, params, timeout_ms.unwrap_or(60_000)).await
}

#[tauri::command]
pub async fn respond_deepseek_harness(
    id: Value,
    result: Option<Value>,
    error: Option<Value>,
    manager: State<'_, DeepSeekHarnessManager>,
) -> Result<(), String> {
    if !id.is_string() && !id.is_number() {
        return Err("Harness response id must be a string or number".to_owned());
    }
    if result.is_some() == error.is_some() {
        return Err("Harness response must contain exactly one of result or error".to_owned());
    }
    let process = manager
        .process
        .lock()
        .map_err(|_| "Harness process state is poisoned")?
        .clone()
        .ok_or("DeepSeek Harness is not running")?;
    let frame = match error {
        Some(error) => json!({ "jsonrpc": "2.0", "id": id, "error": error }),
        None => json!({ "jsonrpc": "2.0", "id": id, "result": result.unwrap_or(Value::Null) }),
    };
    let mut stdin = process.stdin.lock().map_err(|_| "Harness stdin is poisoned")?;
    writeln!(stdin, "{frame}").map_err(|write_error| format!("Failed to write Harness response: {write_error}"))?;
    stdin.flush().map_err(|flush_error| format!("Failed to flush Harness response: {flush_error}"))
}

#[tauri::command]
pub async fn stop_deepseek_harness(
    manager: State<'_, DeepSeekHarnessManager>,
) -> Result<(), String> {
    let Some(process) = manager.take_process() else {
        return Ok(());
    };
    let id = manager.next_id.fetch_add(1, Ordering::Relaxed);
    if request(process.clone(), id, "shutdown", None, 10_000).await.is_err() {
        process.child.lock().map_err(|_| "Harness child state is poisoned")?.kill().map_err(|error| error.to_string())?;
    }
    Ok(())
}
