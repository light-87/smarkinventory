use std::sync::Mutex;
use tauri::{Emitter, Manager, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Holds the currently-running sidecar child (if any) so it can be killed
/// from `cancel_sourcing_run` — otherwise a run left running after the user
/// closes the Claude Code terminal (killing the agent, not the sidecar) waits
/// on results.json forever with no way to stop it from the UI.
struct RunnerState(Mutex<Option<CommandChild>>);

/// Spawns the compiled desktop/runner sidecar (bun build --compile) for one
/// sourcing run, using the access token the Tauri app already has (see
/// desktop/runner/run.ts's DESKTOP_ACCESS_TOKEN priority path) rather than
/// signing in twice. Streams stdout/stderr lines to the frontend as
/// `run-progress` events and the exit code as `run-complete`.
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

    let (mut rx, child) = app
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

    *state.0.lock().map_err(|e| e.to_string())? = Some(child);

    let app_for_task = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let _ = app_for_task.emit("run-progress", String::from_utf8_lossy(&line).to_string());
                }
                CommandEvent::Stderr(line) => {
                    let _ = app_for_task.emit("run-progress", format!("[stderr] {}", String::from_utf8_lossy(&line)));
                }
                CommandEvent::Terminated(payload) => {
                    let _ = app_for_task.emit("run-complete", payload.code.unwrap_or(-1));
                    if let Ok(mut guard) = app_for_task.state::<RunnerState>().0.lock() {
                        *guard = None;
                    }
                }
                _ => {}
            }
        }
    });

    Ok(())
}

/// Kills the in-flight sidecar (e.g. the user closed the Claude Code terminal
/// mid-run and the watch loop would otherwise wait on results.json forever).
#[tauri::command]
fn cancel_sourcing_run(state: State<'_, RunnerState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(child) = guard.take() {
        child.kill().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(RunnerState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![greet, start_sourcing_run, cancel_sourcing_run])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
