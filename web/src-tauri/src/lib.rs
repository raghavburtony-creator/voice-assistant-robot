use serde::{Deserialize, Serialize};
use std::process::Command;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

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

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopMovementEvent {
    status: &'static str,
    destination: String,
    message: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopMovementResult {
    ok: bool,
    destination: String,
}


#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopRect { x: i32, y: i32, width: u32, height: u32 }

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopPoint { x: i32, y: i32 }

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopWindowContext { x: Option<i32>, y: Option<i32>, width: u32, height: u32, visible: bool }

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActiveWindowContext { application: String, title: String }

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopContext {
    platform: &'static str,
    monitor: DesktopRect,
    otto: DesktopWindowContext,
    cursor: DesktopPoint,
    active_window: Option<ActiveWindowContext>,
}

/// A closed set of desktop actions. Values are deserialized by Tauri and unknown
/// variants are rejected before any operating-system operation is attempted.
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum DesktopAction {
    MinimizeOtto,
    RestoreOtto,
    MoveHome,
    MoveLeft,
    MoveRight,
    MoveTop,
    MoveBottom,
    LaunchCalculator,
    LaunchTextEditor,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConsentCertificate {
    certificate_id: String,
    request_id: String,
    action: DesktopAction,
    decision: &'static str,
    method: &'static str,
    issued_at_unix_ms: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopActionResult {
    action: DesktopAction,
    ok: bool,
    status: &'static str,
    verification: &'static str,
    message: String,
    consent_certificate: Option<ConsentCertificate>,
}

fn action_result(action: DesktopAction, ok: bool, status: &'static str, verification: &'static str, message: String) -> DesktopActionResult {
    DesktopActionResult { action, ok, status, verification, message, consent_certificate: None }
}

fn consent_certificate(request_id: String, action: DesktopAction, decision: &'static str) -> ConsentCertificate {
    use std::time::{SystemTime, UNIX_EPOCH};
    let issued_at_unix_ms = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default()
        .as_millis().min(u64::MAX as u128) as u64;
    ConsentCertificate {
        certificate_id: format!("{request_id}-{issued_at_unix_ms}"),
        request_id, action, decision, method: "native_os_dialog", issued_at_unix_ms,
    }
}

fn desktop_action_label(action: DesktopAction) -> &'static str {
    match action {
        DesktopAction::MinimizeOtto => "minimize Otto",
        DesktopAction::RestoreOtto => "restore Otto",
        DesktopAction::MoveHome => "move Otto to the centre of the desktop",
        DesktopAction::MoveLeft => "move Otto to the left side of the desktop",
        DesktopAction::MoveRight => "move Otto to the right side of the desktop",
        DesktopAction::MoveTop => "move Otto to the top of the desktop",
        DesktopAction::MoveBottom => "move Otto to the bottom of the desktop",
        DesktopAction::LaunchCalculator => "launch Calculator",
        DesktopAction::LaunchTextEditor => "launch Text Editor",
    }
}

const MOVEMENT_MARGIN: i32 = 20;
const MOVEMENT_STEPS: i32 = 24;
const MOVEMENT_FRAME_MS: u64 = 16;

/// Read-only runtime information. Desktop actions are intentionally narrow and
/// intent-based; no raw coordinates or general window-management API is exposed.
#[tauri::command]
fn desktop_status() -> DesktopStatus {
    DesktopStatus::current()
}

/// Execute one allow-listed desktop action after the web UI has obtained explicit
/// approval for that exact request. The native enum is the final argument boundary.
#[tauri::command]
async fn desktop_action(app: AppHandle, action: DesktopAction, request_id: String) -> DesktopActionResult {
    if request_id.len() != 32 || !request_id.bytes().all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase()) {
        return action_result(action, false, "failed", "unavailable", "The desktop request identifier is invalid.".into());
    }
    let window = match app.get_webview_window("main") {
        Some(window) => window,
        None => return action_result(action, false, "failed", "unavailable", "Otto's desktop window is unavailable.".into()),
    };

    // Approval is enforced inside the native command, so a direct webview invoke
    // cannot skip the visitor's decision by bypassing the React confirmation UI.
    let approved = app.dialog()
        .message(format!("Allow Otto to {}?", desktop_action_label(action)))
        .title("Otto desktop action")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom("Allow".into(), "Cancel".into()))
        .blocking_show();
    if !approved {
        let mut result = action_result(action, false, "denied", "not_verified", "The visitor declined this desktop action. Nothing was executed.".into());
        result.consent_certificate = Some(consent_certificate(request_id, action, "denied"));
        return result;
    }

    let mut result = match action {
        DesktopAction::MinimizeOtto => {
            if let Err(error) = window.minimize() {
                let mut result = action_result(action, false, "failed", "unavailable", format!("Otto could not be minimized: {error}"));
                result.consent_certificate = Some(consent_certificate(request_id.clone(), action, "approved"));
                return result;
            }
            match window.is_minimized() {
                Ok(true) => action_result(action, true, "completed", "verified", "Otto is minimized.".into()),
                Ok(false) => action_result(action, false, "failed", "not_verified", "The operating system did not confirm that Otto was minimized.".into()),
                Err(error) => action_result(action, true, "completed", "unavailable", format!("Minimize was accepted, but its state could not be checked: {error}")),
            }
        }
        DesktopAction::RestoreOtto => {
            let result = window.unminimize().and_then(|_| window.show()).and_then(|_| window.set_focus());
            if let Err(error) = result {
                let mut result = action_result(action, false, "failed", "unavailable", format!("Otto could not be restored: {error}"));
                result.consent_certificate = Some(consent_certificate(request_id.clone(), action, "approved"));
                return result;
            }
            match (window.is_minimized(), window.is_visible()) {
                (Ok(false), Ok(true)) => action_result(action, true, "completed", "verified", "Otto is visible and restored.".into()),
                _ => action_result(action, false, "failed", "not_verified", "The operating system did not confirm that Otto is visible and restored.".into()),
            }
        }
        DesktopAction::MoveHome | DesktopAction::MoveLeft | DesktopAction::MoveRight | DesktopAction::MoveTop | DesktopAction::MoveBottom => {
            let destination = match action {
                DesktopAction::MoveHome => "home",
                DesktopAction::MoveLeft => "desktop-left",
                DesktopAction::MoveRight => "desktop-right",
                DesktopAction::MoveTop => "top",
                DesktopAction::MoveBottom => "bottom",
                _ => unreachable!(),
            };
            match move_desktop_window_inner(&app, destination.to_string()).await {
                Ok(_) => action_result(action, true, "completed", "native_api_completed", format!("Otto's move to {destination} completed through the native window API.")),
                Err(error) => action_result(action, false, "failed", "unavailable", error),
            }
        }
        DesktopAction::LaunchCalculator | DesktopAction::LaunchTextEditor => {
            match launch_allowlisted_application(action) {
                Ok(application) => action_result(action, true, "started", "process_spawned", format!("{application} was launched. The operating system has not confirmed that its window is ready.")),
                Err(error) => action_result(action, false, "failed", "unavailable", error),
            }
        }
    };
    result.consent_certificate = Some(consent_certificate(request_id, action, "approved"));
    result
}

fn launch_allowlisted_application(action: DesktopAction) -> Result<&'static str, String> {
    #[cfg(target_os = "windows")]
    let (program, args, label): (&str, &[&str], &str) = match action {
        DesktopAction::LaunchCalculator => ("calc.exe", &[], "Calculator"),
        DesktopAction::LaunchTextEditor => ("notepad.exe", &[], "Text Editor"),
        _ => return Err("This action is not an application launch.".into()),
    };

    #[cfg(target_os = "macos")]
    let (program, args, label): (&str, &[&str], &str) = match action {
        DesktopAction::LaunchCalculator => ("open", &["-a", "Calculator"], "Calculator"),
        DesktopAction::LaunchTextEditor => ("open", &["-a", "TextEdit"], "Text Editor"),
        _ => return Err("This action is not an application launch.".into()),
    };

    #[cfg(target_os = "linux")]
    let (program, args, label): (&str, &[&str], &str) = match action {
        DesktopAction::LaunchCalculator => ("gtk-launch", &["org.gnome.Calculator"], "Calculator"),
        DesktopAction::LaunchTextEditor => ("gtk-launch", &["org.gnome.TextEditor"], "Text Editor"),
        _ => return Err("This action is not an application launch.".into()),
    };

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    return Err("Application launching is not supported on this platform.".into());

    #[cfg(target_os = "linux")]
    {
        // gtk-launch is a short-lived desktop-entry dispatcher. Waiting for its
        // exit status distinguishes a successful dispatch from a missing or
        // broken desktop entry; spawn() alone would only prove gtk-launch started.
        let status = Command::new(program).args(args).status()
            .map_err(|error| format!("{label} could not be launched: {error}"))?;
        if status.success() {
            Ok(label)
        } else {
            Err(format!("{label} launcher exited unsuccessfully ({status})."))
        }
    }

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        // These platform launchers hand the request to the OS and may remain
        // attached to the launched app, so report process spawn rather than wait.
        Command::new(program).args(args).spawn()
            .map(|_| label)
            .map_err(|error| format!("{label} could not be launched: {error}"))
    }
}

async fn move_desktop_window_inner(app: &AppHandle, destination: String) -> Result<DesktopMovementResult, String> {
    if !matches!(destination.as_str(), "home" | "desktop-left" | "desktop-right" | "top" | "bottom") {
        return Err("Unsupported desktop destination.".to_string());
    }

    let window = app.get_webview_window("main")
        .ok_or_else(|| "Otto's desktop window is unavailable.".to_string())?;
    // Never guess another display: if the current monitor cannot be identified,
    // refuse the move rather than unexpectedly relocating Otto to the primary monitor.
    let monitor = window.current_monitor()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Otto's current monitor could not be identified.".to_string())?;

    let area = monitor.work_area();
    let area_left = area.position.x;
    let area_top = area.position.y;
    let area_right = area_left.saturating_add(area.size.width as i32);
    let area_bottom = area_top.saturating_add(area.size.height as i32);
    let size = window.outer_size().map_err(|error| error.to_string())?;
    let width = size.width as i32;
    let height = size.height as i32;
    let start = window.outer_position().map_err(|error| error.to_string())?;
    let (target_x, target_y) = resolve_destination(
        destination.as_str(), area_left, area_top, area_right, area_bottom, width, height, MOVEMENT_MARGIN,
    )?;

    let started = DesktopMovementEvent {
        status: "started",
        destination: destination.clone(),
        message: None,
    };
    let _ = app.emit("otto://desktop-movement", started);

    for step in 1..=MOVEMENT_STEPS {
        let t = step as f64 / MOVEMENT_STEPS as f64;
        // Smoothstep easing: zero velocity at the beginning and end.
        let eased = t * t * (3.0 - 2.0 * t);
        let x = (start.x as f64 + (target_x as f64 - start.x as f64) * eased).round() as i32;
        let y = (start.y as f64 + (target_y as f64 - start.y as f64) * eased).round() as i32;
        if let Err(error) = window.set_position(PhysicalPosition::new(x, y)) {
            let _ = app.emit("otto://desktop-movement", DesktopMovementEvent {
                status: "failed",
                destination: destination.clone(),
                message: Some(format!("Otto could not finish moving: {error}")),
            });
            return Err(format!("Otto could not finish moving: {error}"));
        }
        tokio::time::sleep(Duration::from_millis(MOVEMENT_FRAME_MS)).await;
    }

    let result = DesktopMovementResult {
        ok: true,
        destination: destination.clone(),
    };
    let _ = app.emit("otto://desktop-movement", DesktopMovementEvent {
        status: "completed",
        destination,
        message: None,
    });
    Ok(result)
}

fn resolve_destination(
    destination: &str,
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
    width: i32,
    height: i32,
    margin: i32,
) -> Result<(i32, i32), String> {
    let min_x = left.saturating_add(margin);
    let min_y = top.saturating_add(margin);
    let max_x = right.saturating_sub(width).saturating_sub(margin).max(min_x);
    let max_y = bottom.saturating_sub(height).saturating_sub(margin).max(min_y);
    let centre_x = left.saturating_add(right.saturating_sub(left).max(0) / 2).saturating_sub(width / 2);
    let centre_y = top.saturating_add(bottom.saturating_sub(top).max(0) / 2).saturating_sub(height / 2);
    let raw = match destination {
        "home" => (centre_x, centre_y),
        "desktop-left" => (min_x, centre_y),
        "desktop-right" => (max_x, centre_y),
        "top" => (centre_x, min_y),
        "bottom" => (centre_x, max_y),
        _ => return Err("Unsupported desktop destination.".to_string()),
    };
    Ok((raw.0.clamp(min_x, max_x), raw.1.clamp(min_y, max_y)))
}


/// Read desktop metadata only after the UI has explicitly enabled desktop awareness.
/// No screenshots, application contents, keystrokes, process ids or executable paths are returned.
#[tauri::command]
fn desktop_context(app: AppHandle) -> Result<DesktopContext, String> {
    let window = app.get_webview_window("main")
        .ok_or_else(|| "Otto's desktop window is unavailable.".to_string())?;
    let monitor = window.current_monitor()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Otto's current monitor could not be identified.".to_string())?;
    let area = monitor.work_area();
    // Wayland compositors may intentionally withhold a window's global position.
    // Keep the rest of the desktop context useful and represent that field as unavailable.
    let position = window.outer_position().ok();
    let size = window.outer_size().map_err(|error| error.to_string())?;
    let cursor = window.cursor_position().map_err(|error| error.to_string())?;
    let visible = window.is_visible().map_err(|error| error.to_string())?;

    Ok(DesktopContext {
        platform: std::env::consts::OS,
        monitor: DesktopRect { x: area.position.x, y: area.position.y, width: area.size.width, height: area.size.height },
        otto: DesktopWindowContext { x: position.as_ref().map(|point| point.x), y: position.as_ref().map(|point| point.y), width: size.width, height: size.height, visible },
        cursor: DesktopPoint { x: cursor.x.round() as i32, y: cursor.y.round() as i32 },
        active_window: active_window_context(),
    })
}

#[cfg(windows)]
fn active_window_context() -> Option<ActiveWindowContext> {
    use std::{ffi::c_void, os::windows::ffi::OsStringExt};

    #[link(name = "user32")]
    extern "system" {
        fn GetForegroundWindow() -> *mut c_void;
        fn GetWindowTextW(hwnd: *mut c_void, text: *mut u16, max_count: i32) -> i32;
        fn GetWindowThreadProcessId(hwnd: *mut c_void, process_id: *mut u32) -> u32;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn OpenProcess(access: u32, inherit: i32, process_id: u32) -> *mut c_void;
        fn QueryFullProcessImageNameW(process: *mut c_void, flags: u32, path: *mut u16, size: *mut u32) -> i32;
        fn CloseHandle(handle: *mut c_void) -> i32;
    }

    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() { return None; }
        let mut title_buffer = [0u16; 256];
        let title_len = GetWindowTextW(hwnd, title_buffer.as_mut_ptr(), title_buffer.len() as i32);
        let title = if title_len > 0 {
            String::from_utf16_lossy(&title_buffer[..title_len as usize])
                .chars().filter(|ch| !ch.is_control()).take(120).collect::<String>()
        } else { String::new() };

        let mut process_id = 0u32;
        if GetWindowThreadProcessId(hwnd, &mut process_id) == 0 || process_id == 0 { return None; }
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id);
        if process.is_null() { return None; }
        let mut path_buffer = [0u16; 1024];
        let mut path_len = path_buffer.len() as u32;
        let ok = QueryFullProcessImageNameW(process, 0, path_buffer.as_mut_ptr(), &mut path_len);
        let _ = CloseHandle(process);
        if ok == 0 { return None; }
        let path = std::ffi::OsString::from_wide(&path_buffer[..path_len as usize]);
        let application = std::path::Path::new(&path).file_name()?.to_string_lossy()
            .chars().filter(|ch| !ch.is_control()).take(80).collect::<String>();
        if application.is_empty() { return None; }
        Some(ActiveWindowContext { application, title })
    }
}

#[cfg(not(windows))]
fn active_window_context() -> Option<ActiveWindowContext> { None }

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![desktop_status, desktop_context, desktop_action])
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

#[cfg(test)]
mod tests {
    use super::{desktop_action_label, resolve_destination, DesktopAction};

    #[test]
    fn native_consent_receipt_binds_the_request_action_and_decision() {
        let receipt = consent_certificate(
            "0123456789abcdef0123456789abcdef".into(),
            DesktopAction::LaunchCalculator,
            "approved",
        );
        assert_eq!(receipt.request_id, "0123456789abcdef0123456789abcdef");
        assert!(receipt.certificate_id.starts_with(&receipt.request_id));
        assert!(matches!(receipt.action, DesktopAction::LaunchCalculator));
        assert_eq!(receipt.decision, "approved");
        assert_eq!(receipt.method, "native_os_dialog");
        assert!(receipt.issued_at_unix_ms > 0);
    }

    #[test]
    fn every_native_action_has_a_specific_confirmation_label() {
        let actions = [
            DesktopAction::MinimizeOtto,
            DesktopAction::RestoreOtto,
            DesktopAction::MoveHome,
            DesktopAction::MoveLeft,
            DesktopAction::MoveRight,
            DesktopAction::MoveTop,
            DesktopAction::MoveBottom,
            DesktopAction::LaunchCalculator,
            DesktopAction::LaunchTextEditor,
        ];
        for action in actions {
            assert!(!desktop_action_label(action).is_empty());
        }
    }

    #[test]
    fn named_destinations_stay_inside_a_negative_origin_work_area() {
        let left = resolve_destination("desktop-left", -1920, 0, 0, 1080, 420, 640, 20).unwrap();
        let right = resolve_destination("desktop-right", -1920, 0, 0, 1080, 420, 640, 20).unwrap();
        let top = resolve_destination("top", -1920, 0, 0, 1080, 420, 640, 20).unwrap();
        let bottom = resolve_destination("bottom", -1920, 0, 0, 1080, 420, 640, 20).unwrap();
        assert_eq!(left, (-1900, 220));
        assert_eq!(right, (-440, 220));
        assert_eq!(top, (-1170, 20));
        assert_eq!(bottom, (-1170, 420));
    }

    #[test]
    fn oversized_window_is_clamped_to_the_work_area_origin() {
        assert_eq!(resolve_destination("home", 100, 50, 300, 200, 500, 400, 20).unwrap(), (120, 70));
    }

    #[test]
    fn unknown_destination_is_rejected() {
        assert!(resolve_destination("somewhere", 0, 0, 1000, 800, 420, 640, 20).is_err());
    }
}
