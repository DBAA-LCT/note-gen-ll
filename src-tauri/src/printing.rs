#[tauri::command]
pub fn print_webview(
    window: tauri::WebviewWindow,
    path: Option<String>,
    event_name: Option<String>,
) -> Result<(), String> {
    let _ = (path, event_name);
    window
        .eval("window.print()")
        .map_err(|error| error.to_string())?;

    Ok(())
}
