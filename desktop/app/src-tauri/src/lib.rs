use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

// --- Durable auth store (F-017) -------------------------------------------
// A tiny key/value store the webview's supabase client persists its session to
// (see desktop/app/src/lib/supabase.ts). It lives in the app's own data dir,
// NOT the WebView2 data folder that Windows AV/OneDrive wipe — the fix for the
// "always logs out" bug. Backed by one JSON file (a String→String map).

fn auth_store_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("auth-session.json"))
}

fn read_auth_map(app: &tauri::AppHandle) -> Result<HashMap<String, String>, String> {
    let path = auth_store_path(app)?;
    match fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(HashMap::new()),
        Err(e) => Err(e.to_string()),
    }
}

fn write_auth_map(app: &tauri::AppHandle, map: &HashMap<String, String>) -> Result<(), String> {
    let path = auth_store_path(app)?;
    let s = serde_json::to_string(map).map_err(|e| e.to_string())?;
    fs::write(&path, s).map_err(|e| e.to_string())
}

#[tauri::command]
fn auth_store_get(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    Ok(read_auth_map(&app)?.get(&key).cloned())
}

#[tauri::command]
fn auth_store_set(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    let mut map = read_auth_map(&app)?;
    map.insert(key, value);
    write_auth_map(&app, &map)
}

#[tauri::command]
fn auth_store_remove(app: tauri::AppHandle, key: String) -> Result<(), String> {
    let mut map = read_auth_map(&app)?;
    map.remove(&key);
    write_auth_map(&app, &map)
}

// --- Past runs: list saved on-disk sessions (v0.7.0) -----------------------
// Every sourcing run leaves a folder under ~/.smarkstock-sessions/<runId>/
// (config.json + results.json + CLAUDE.md). We enumerate them so the desktop
// "Past runs → Resume / Re-sync" list can re-open a run without creating a new
// one. read_json_stripped tolerates the UTF-8 BOM the agent may write (F-018).

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalSession {
    run_id: String,
    bom_id: String,
    line_count: usize,
    result_lines: usize,
    complete: bool,
    modified_ms: u64,
}

fn read_json_stripped(path: &std::path::Path) -> Result<serde_json::Value, String> {
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let trimmed = raw.strip_prefix('\u{feff}').unwrap_or(&raw);
    serde_json::from_str(trimmed).map_err(|e| e.to_string())
}

fn sessions_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().home_dir().map_err(|e| e.to_string())?.join(".smarkstock-sessions"))
}

#[tauri::command]
fn list_local_sessions(app: tauri::AppHandle) -> Result<Vec<LocalSession>, String> {
    let base = sessions_dir(&app)?;
    let mut out: Vec<LocalSession> = Vec::new();
    let entries = match fs::read_dir(&base) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(out),
        Err(e) => return Err(e.to_string()),
    };
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        // A real session has a parseable config.json carrying a bomId.
        let cfg = match read_json_stripped(&dir.join("config.json")) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let bom_id = cfg.get("bomId").and_then(|v| v.as_str()).unwrap_or("").to_string();
        if bom_id.is_empty() {
            continue;
        }
        let run_id = entry.file_name().to_string_lossy().to_string();
        let line_count = cfg.get("lines").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
        let (result_lines, complete) = match read_json_stripped(&dir.join("results.json")) {
            Ok(r) => (
                r.get("lines").and_then(|v| v.as_object()).map(|o| o.len()).unwrap_or(0),
                r.get("complete").and_then(|v| v.as_bool()).unwrap_or(false),
            ),
            Err(_) => (0, false),
        };
        let modified_ms = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        out.push(LocalSession { run_id, bom_id, line_count, result_lines, complete, modified_ms });
    }
    out.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    Ok(out)
}

/// "Resume" a saved run — relaunch the browser + Claude terminal on the existing
/// ~/.smarkstock-sessions/<run_id> session and keep syncing, WITHOUT creating a
/// new run (the runner's --resume mode). Mirrors start_sourcing_run's env/token
/// handoff. project_id lets the runner print the exact review link.
#[tauri::command]
async fn resume_sourcing_run(
    app: tauri::AppHandle,
    state: State<'_, RunnerState>,
    run_id: String,
    project_id: String,
    web_base: String,
    access_token: String,
    refresh_token: String,
    supabase_url: String,
    supabase_anon_key: String,
) -> Result<(), String> {
    let args = vec![
        "--resume".to_string(),
        run_id,
        "--project".to_string(),
        project_id,
        "--web".to_string(),
        web_base,
    ];

    let stop_file = stop_file_path();
    let _ = fs::remove_file(&stop_file);

    let (rx, child) = app
        .shell()
        .sidecar("smarkstock-runner")
        .map_err(|e| e.to_string())?
        .args(args)
        .env("DESKTOP_ACCESS_TOKEN", access_token)
        .env("DESKTOP_REFRESH_TOKEN", refresh_token)
        .env("DESKTOP_SUPABASE_URL", supabase_url)
        .env("DESKTOP_SUPABASE_ANON_KEY", supabase_anon_key)
        .env("DESKTOP_STOP_FILE", stop_file.to_string_lossy().to_string())
        .spawn()
        .map_err(|e| e.to_string())?;

    *state.0.lock().map_err(|e| e.to_string())? = Some(RunnerHandle { child, stop_file });

    pump_events(app.clone(), rx, true);
    Ok(())
}

/// The in-flight sidecar child plus the sentinel path "Finish & sync" writes to
/// ask it to stop gracefully (flush results, then exit) — a hard `kill()` on
/// Windows is `TerminateProcess`, which skips the runner's signal handler and
/// so its final upload, losing the last results. The file-based stop avoids that.
struct RunnerHandle {
    child: CommandChild,
    stop_file: PathBuf,
}

struct RunnerState(Mutex<Option<RunnerHandle>>);

fn stop_file_path() -> PathBuf {
    std::env::temp_dir().join("smarkstock-stop.flag")
}

/// Streams a spawned sidecar's stdout/stderr as `run-progress` events and its
/// exit code as `run-complete`. Shared by start_sourcing_run + sync_run_again.
fn pump_events(app: tauri::AppHandle, mut rx: tauri::async_runtime::Receiver<CommandEvent>, clear_state_on_exit: bool) {
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let _ = app.emit("run-progress", String::from_utf8_lossy(&line).to_string());
                }
                CommandEvent::Stderr(line) => {
                    let _ = app.emit("run-progress", format!("[stderr] {}", String::from_utf8_lossy(&line)));
                }
                CommandEvent::Terminated(payload) => {
                    let _ = app.emit("run-complete", payload.code.unwrap_or(-1));
                    if clear_state_on_exit {
                        if let Ok(mut guard) = app.state::<RunnerState>().0.lock() {
                            *guard = None;
                        }
                    }
                }
                _ => {}
            }
        }
    });
}

/// Spawns the compiled desktop/runner sidecar for one sourcing run, using the
/// access token the Tauri app already has (DESKTOP_ACCESS_TOKEN path) rather
/// than signing in twice.
#[tauri::command]
async fn start_sourcing_run(
    app: tauri::AppHandle,
    state: State<'_, RunnerState>,
    bom_id: String,
    line_limit: Option<u32>,
    web_base: String,
    access_token: String,
    // The refresh token + project URL/key let the runner mint a fresh access
    // token right before uploading results, so a long run doesn't fail with a
    // 401 when the original token expires mid-session.
    refresh_token: String,
    supabase_url: String,
    supabase_anon_key: String,
    // When true, source every to-order line even if a previous run already
    // sourced some (default reuses them — the resume behaviour).
    resource_all: bool,
) -> Result<(), String> {
    let mut args = vec!["--bom".to_string(), bom_id, "--web".to_string(), web_base];
    if let Some(n) = line_limit {
        args.push("--lines".to_string());
        args.push(n.to_string());
    }
    if resource_all {
        args.push("--resource-all".to_string());
    }

    // Clear any stale sentinel from a previous run before this one starts.
    let stop_file = stop_file_path();
    let _ = fs::remove_file(&stop_file);

    let (rx, child) = app
        .shell()
        .sidecar("smarkstock-runner")
        .map_err(|e| e.to_string())?
        .args(args)
        .env("DESKTOP_ACCESS_TOKEN", access_token)
        .env("DESKTOP_REFRESH_TOKEN", refresh_token)
        .env("DESKTOP_SUPABASE_URL", supabase_url)
        .env("DESKTOP_SUPABASE_ANON_KEY", supabase_anon_key)
        .env("DESKTOP_STOP_FILE", stop_file.to_string_lossy().to_string())
        .spawn()
        .map_err(|e| e.to_string())?;

    *state.0.lock().map_err(|e| e.to_string())? = Some(RunnerHandle { child, stop_file });

    pump_events(app.clone(), rx, true);
    Ok(())
}

/// "Finish & sync" — ask the runner to do a final upload then exit cleanly by
/// writing the sentinel file it polls for (works on Windows, unlike a signal).
#[tauri::command]
fn finish_sourcing_run(state: State<'_, RunnerState>) -> Result<(), String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(handle) = guard.as_ref() {
        fs::write(&handle.stop_file, b"stop").map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Hard-stop (abandon) — kills the sidecar immediately without a final flush.
#[tauri::command]
fn cancel_sourcing_run(state: State<'_, RunnerState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(handle) = guard.take() {
        let _ = fs::remove_file(&handle.stop_file);
        handle.child.kill().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// "Sync latest again" — re-upload an already-finished run's results.json from
/// disk (upload-only sidecar), so edits made after "Finish & sync" still reach
/// the web. One-shot: not tracked in RunnerState.
#[tauri::command]
async fn sync_run_again(
    app: tauri::AppHandle,
    run_id: String,
    web_base: String,
    access_token: String,
    refresh_token: String,
    supabase_url: String,
    supabase_anon_key: String,
) -> Result<(), String> {
    let args = vec![
        "--upload-only".to_string(),
        "--run".to_string(),
        run_id,
        "--web".to_string(),
        web_base,
    ];
    let (rx, _child) = app
        .shell()
        .sidecar("smarkstock-runner")
        .map_err(|e| e.to_string())?
        .args(args)
        .env("DESKTOP_ACCESS_TOKEN", access_token)
        .env("DESKTOP_REFRESH_TOKEN", refresh_token)
        .env("DESKTOP_SUPABASE_URL", supabase_url)
        .env("DESKTOP_SUPABASE_ANON_KEY", supabase_anon_key)
        .spawn()
        .map_err(|e| e.to_string())?;

    pump_events(app.clone(), rx, false);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(RunnerState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            greet,
            start_sourcing_run,
            finish_sourcing_run,
            cancel_sourcing_run,
            sync_run_again,
            auth_store_get,
            auth_store_set,
            auth_store_remove,
            list_local_sessions,
            resume_sourcing_run
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
