use serde::Serialize;
use tauri::Emitter;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopStatus {
    runtime: &'static str,
    platform: &'static str,
    version: &'static str,
}

impl DesktopStatus {
    fn current() -> Self {
        Self {
            runtime: "tauri",
            platform: std::env::consts::OS,
            version: env!("CARGO_PKG_VERSION"),
        }
    }
}

/// Read-only runtime information. Desktop actions are intentionally not exposed here;
/// future capabilities must be added through the permissioned gateway (DESKTOP-04).
#[tauri::command]
fn desktop_status() -> DesktopStatus {
    DesktopStatus::current()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![desktop_status])
        .setup(|app| {
            // Informational lifecycle event only; it grants no desktop action.
            app.emit("otto://desktop-ready", DesktopStatus::current())?;
            Ok(())
        })
        .on_page_load(|window, _payload| {
            let _ = window.emit("otto://desktop-page-loaded", ());
        })
        .run(tauri::generate_context!())
        .expect("failed to run Otto desktop shell");
}
