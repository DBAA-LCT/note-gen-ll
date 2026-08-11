use tauri::{AppHandle, Emitter, Manager, WindowEvent};
use tauri_plugin_store::StoreExt;

pub fn setup_window_events(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        let window_clone = window.clone();
        let app_handle = app.clone();
        window.on_window_event(move |event| {
            handle_window_event(event, &window_clone, &app_handle);
        });
    }
    Ok(())
}

fn handle_window_event(
    event: &WindowEvent,
    window: &tauri::WebviewWindow,
    app_handle: &AppHandle,
) {
    let WindowEvent::CloseRequested { api, .. } = event else {
        return;
    };

    match get_close_behavior(app_handle).as_str() {
        "quit" => {
            api.prevent_close();
            app_handle.exit(0);
        }
        "ask" => {
            api.prevent_close();
            let _ = window.emit("close-behavior-requested", ());
        }
        _ => {
            api.prevent_close();
            let _ = window.hide();
        }
    }
}

fn get_close_behavior(app_handle: &AppHandle) -> String {
    app_handle
        .store("store.json")
        .ok()
        .and_then(|store| store.get("closeBehavior"))
        .and_then(|value| value.as_str().map(ToOwned::to_owned))
        .unwrap_or_else(|| "minimize".to_string())
}

pub fn handle_single_instance(app: &AppHandle, _argv: Vec<String>, _cwd: String) {
    if let Some(window) = app.get_webview_window("main") {
        let is_visible = window.is_visible().unwrap_or(false);
        let is_minimized = window.is_minimized().unwrap_or(false);

        if !is_visible {
            let _ = window.show();
            let _ = window.set_focus();
            let _ = window.set_always_on_top(true);
            let _ = window.set_always_on_top(false);
        } else if is_minimized {
            let _ = window.unminimize();
            std::thread::sleep(std::time::Duration::from_millis(100));
            let _ = window.show();
            let _ = window.set_focus();
            let _ = window.set_always_on_top(true);
            let _ = window.set_always_on_top(false);
        } else {
            let _ = window.set_focus();
            let _ = window.set_always_on_top(true);
            let _ = window.set_always_on_top(false);
        }
    }

    crate::file_open::handle_single_instance_open_files(app, _argv);
}

#[cfg(target_os = "macos")]
pub fn handle_macos_reopen(app_handle: &AppHandle, has_visible_windows: bool) {
    if !has_visible_windows {
        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
            let _ = app_handle.show();
        }
    }
}
