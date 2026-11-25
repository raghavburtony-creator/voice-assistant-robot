use serde::Serialize;
use std::{thread, time::Duration};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition};

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
    monitor: Option<String>,
    x: Option<i32>,
    y: Option<i32>,
    message: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopMovementResult {
    ok: bool,
    destination: String,
    monitor: Option<String>,
    x: i32,
    y: i32,
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

/// Move Otto to one of a small set of named positions on the monitor he currently
/// occupies. Coordinates stay inside the native host and are clamped to the
/// monitor work area, which may have a negative desktop origin.
#[tauri::command]
fn move_desktop_window(app: AppHandle, destination: String) -> Result<DesktopMovementResult, String> {
    if !matches!(destination.as_str(), "home" | "desktop-left" | "desktop-right" | "top" | "bottom") {
        return Err("Unsupported desktop destination.".to_string());
    }

    let window = app.get_webview_window("main")
        .ok_or_else(|| "Otto's desktop window is unavailable.".to_string())?;
    let monitor = window.current_monitor()
        .map_err(|error| error.to_string())?
        .or(window.primary_monitor().map_err(|error| error.to_string())?)
        .ok_or_else(|| "No display monitor is available.".to_string())?;

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

    let monitor_name = monitor.name().cloned();
    let started = DesktopMovementEvent {
        status: "started",
        destination: destination.clone(),
        monitor: monitor_name.clone(),
        x: Some(target_x),
        y: Some(target_y),
        message: None,
    };
    let _ = app.emit("otto://desktop-movement", started);

    for step in 1..=MOVEMENT_STEPS {
        let t = step as f64 / MOVEMENT_STEPS as f64;
        // Smoothstep easing: zero velocity at the beginning and end.
        let eased = t * t * (3.0 - 2.0 * t);
        let x = start.x + ((target_x - start.x) as f64 * eased).round() as i32;
        let y = start.y + ((target_y - start.y) as f64 * eased).round() as i32;
        if let Err(error) = window.set_position(PhysicalPosition::new(x, y)) {
            let _ = app.emit("otto://desktop-movement", DesktopMovementEvent {
                status: "failed",
                destination: destination.clone(),
                monitor: monitor_name.clone(),
                x: Some(x),
                y: Some(y),
                message: Some(error.to_string()),
            });
            return Err(format!("Otto could not finish moving: {error}"));
        }
        thread::sleep(Duration::from_millis(MOVEMENT_FRAME_MS));
    }

    let result = DesktopMovementResult {
        ok: true,
        destination: destination.clone(),
        monitor: monitor_name.clone(),
        x: target_x,
        y: target_y,
    };
    let _ = app.emit("otto://desktop-movement", DesktopMovementEvent {
        status: "completed",
        destination,
        monitor: monitor_name,
        x: Some(target_x),
        y: Some(target_y),
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
    let centre_x = left.saturating_add((right - left).max(0) / 2).saturating_sub(width / 2);
    let raw = match destination {
        "home" | "desktop-right" => (max_x, max_y),
        "desktop-left" => (min_x, max_y),
        "top" => (centre_x, min_y),
        "bottom" => (centre_x, max_y),
        _ => return Err("Unsupported desktop destination.".to_string()),
    };
    Ok((raw.0.clamp(min_x, max_x), raw.1.clamp(min_y, max_y)))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![desktop_status, move_desktop_window])
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
    use super::resolve_destination;

    #[test]
    fn named_destinations_stay_inside_a_negative_origin_work_area() {
        let left = resolve_destination("desktop-left", -1920, 0, 0, 1080, 420, 640, 20).unwrap();
        let right = resolve_destination("desktop-right", -1920, 0, 0, 1080, 420, 640, 20).unwrap();
        let top = resolve_destination("top", -1920, 0, 0, 1080, 420, 640, 20).unwrap();
        assert_eq!(left, (-1900, 420));
        assert_eq!(right, (-440, 420));
        assert_eq!(top, (-1170, 20));
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
