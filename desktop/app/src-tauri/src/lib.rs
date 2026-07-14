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
            sync_run_again
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
