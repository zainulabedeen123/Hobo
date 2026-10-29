use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::PathBuf,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{
    Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
};
use tauri_plugin_notification::NotificationExt;

const TASKS_FILE: &str = "tasks.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Task {
    id: String,
    text: String,
    completed: bool,
    created_at: i64,
    #[serde(default)]
    tag: String,
    #[serde(default)]
    timer_ends_at: Option<i64>,
}

struct TaskStore(Mutex<Vec<Task>>);

fn tasks_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join(TASKS_FILE))
        .map_err(|error| error.to_string())
}

fn load_tasks(app: &AppHandle) -> Vec<Task> {
    let Ok(path) = tasks_path(app) else {
        return Vec::new();
    };
    let Ok(contents) = fs::read_to_string(path) else {
        return Vec::new();
    };

    serde_json::from_str(&contents).unwrap_or_default()
}

fn save_tasks(app: &AppHandle, tasks: &[Task]) -> Result<(), String> {
    let path = tasks_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let contents = serde_json::to_string_pretty(tasks).map_err(|error| error.to_string())?;
    fs::write(path, contents).map_err(|error| error.to_string())?;
    let remaining = tasks.iter().filter(|task| !task.completed).count();
    let _ = app.emit_to("mini", "tasks-changed", remaining);
    Ok(())
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn lock_store<'a>(state: &'a State<'_, TaskStore>) -> Result<std::sync::MutexGuard<'a, Vec<Task>>, String> {
    state.0.lock().map_err(|error| error.to_string())
}

#[tauri::command]
fn list_tasks(state: State<'_, TaskStore>) -> Result<Vec<Task>, String> {
    Ok(lock_store(&state)?.clone())
}

fn normalize_tag(tag: &str) -> Result<String, String> {
    let tag = tag.trim().to_lowercase();
    match tag.as_str() {
        "" | "urgent" | "work" | "personal" => Ok(tag),
        _ => Err("Choose Urgent, Work, Personal, or no tag.".into()),
    }
}

#[tauri::command]
fn add_task(
    app: AppHandle,
    state: State<'_, TaskStore>,
    text: String,
    tag: String,
) -> Result<Vec<Task>, String> {
    let text = text.trim().to_owned();
    if text.is_empty() {
        return Err("A task needs some text.".into());
    }

    let now = now_millis();
    let tag = normalize_tag(&tag)?;
    let mut tasks = lock_store(&state)?;
    tasks.insert(
        0,
        Task {
            id: format!("{}-{}", now, std::process::id()),
            text,
            completed: false,
            created_at: now,
            tag,
            timer_ends_at: None,
        },
    );
    save_tasks(&app, &tasks)?;
    Ok(tasks.clone())
}

#[tauri::command]
fn toggle_task(app: AppHandle, state: State<'_, TaskStore>, id: String) -> Result<Vec<Task>, String> {
    let mut tasks = lock_store(&state)?;
    if let Some(task) = tasks.iter_mut().find(|task| task.id == id) {
        task.completed = !task.completed;
        if task.completed {
            task.timer_ends_at = None;
        }
    }
    save_tasks(&app, &tasks)?;
    Ok(tasks.clone())
}

#[tauri::command]
fn set_task_tag(
    app: AppHandle,
    state: State<'_, TaskStore>,
    id: String,
    tag: String,
) -> Result<Vec<Task>, String> {
    let tag = normalize_tag(&tag)?;
    let mut tasks = lock_store(&state)?;
    if let Some(task) = tasks.iter_mut().find(|task| task.id == id) {
        task.tag = tag;
    }
    save_tasks(&app, &tasks)?;
    Ok(tasks.clone())
}

#[tauri::command]
fn set_task_timer(
    app: AppHandle,
    state: State<'_, TaskStore>,
    id: String,
    minutes: u64,
) -> Result<Vec<Task>, String> {
    if ![0, 1, 5, 10, 25, 45, 60].contains(&minutes) {
        return Err("Choose one of the available timer durations.".into());
    }

    let mut tasks = lock_store(&state)?;
    if let Some(task) = tasks.iter_mut().find(|task| task.id == id) {
        task.timer_ends_at = (minutes > 0).then(|| now_millis() + (minutes * 60_000) as i64);
    }
    save_tasks(&app, &tasks)?;
    Ok(tasks.clone())
}

#[tauri::command]
fn reorder_tasks(
    app: AppHandle,
    state: State<'_, TaskStore>,
    ids: Vec<String>,
) -> Result<Vec<Task>, String> {
    let mut tasks = lock_store(&state)?;
    if ids.len() != tasks.len() {
        return Err("The task order is out of date. Please try again.".into());
    }

    let mut ordered = Vec::with_capacity(tasks.len());
    for id in ids {
        let index = tasks
            .iter()
            .position(|task| task.id == id)
            .ok_or_else(|| "The task order is out of date. Please try again.".to_owned())?;
        ordered.push(tasks.remove(index));
    }
    *tasks = ordered;
    save_tasks(&app, &tasks)?;
    Ok(tasks.clone())
}

#[tauri::command]
fn delete_task(app: AppHandle, state: State<'_, TaskStore>, id: String) -> Result<Vec<Task>, String> {
    let mut tasks = lock_store(&state)?;
    tasks.retain(|task| task.id != id);
    save_tasks(&app, &tasks)?;
    Ok(tasks.clone())
}

#[tauri::command]
fn clear_completed(app: AppHandle, state: State<'_, TaskStore>) -> Result<Vec<Task>, String> {
    let mut tasks = lock_store(&state)?;
    tasks.retain(|task| !task.completed);
    save_tasks(&app, &tasks)?;
    Ok(tasks.clone())
}

#[tauri::command]
fn replace_tasks(
    app: AppHandle,
    state: State<'_, TaskStore>,
    mut tasks: Vec<Task>,
) -> Result<Vec<Task>, String> {
    if tasks.len() > 500 {
        return Err("Hobo can sync up to 500 tasks.".into());
    }
    let mut ids = std::collections::HashSet::new();
    for task in tasks.iter_mut() {
        task.text = task.text.trim().to_owned();
        task.tag = normalize_tag(&task.tag)?;
        if task.id.is_empty() || task.id.len() > 100 || !ids.insert(task.id.clone()) {
            return Err("The cloud returned invalid task IDs.".into());
        }
        if task.text.is_empty() || task.text.chars().count() > 240 || task.created_at < 0 {
            return Err("The cloud returned an invalid task.".into());
        }
    }
    *lock_store(&state)? = tasks.clone();
    save_tasks(&app, &tasks)?;
    Ok(tasks)
}

fn show_window(window: &WebviewWindow) {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

fn position_mini_window(app: &AppHandle, mini: &WebviewWindow) {
    let monitor = app
        .get_webview_window("main")
        .and_then(|window| window.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());

    if let Some(monitor) = monitor {
        let position = monitor.position();
        let size = monitor.size();
        let mini_height = mini.outer_size().map(|size| size.height).unwrap_or(64);
        let x = position.x + size.width as i32 - 60 - 24;
        let y = position.y + size.height as i32 - mini_height as i32 - 24;
        let _ = mini.set_position(PhysicalPosition::new(x, y));
    }
}

fn restore_main_window(app: &AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        show_window(&main);
    }
    if let Some(mini) = app.get_webview_window("mini") {
        let _ = mini.hide();
    }
}

fn minimize_main_window(app: &AppHandle) {
    if let Some(mini) = app.get_webview_window("mini") {
        position_mini_window(app, &mini);
        let _ = mini.show();
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.hide();
    }
}

#[tauri::command]
fn minimize_to_mini(app: AppHandle) {
    minimize_main_window(&app);
}

#[tauri::command]
fn restore_main(app: AppHandle) {
    restore_main_window(&app);
}

fn toggle_window(app: &AppHandle) {
    let visible = app
        .get_webview_window("main")
        .map(|window| window.is_visible().unwrap_or(false))
        .unwrap_or(false);
    if visible {
        minimize_main_window(app);
    } else {
        restore_main_window(app);
    }
}

fn start_timer_watcher(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(1));
        let expired = {
            let state = app.state::<TaskStore>();
            let Ok(mut tasks) = state.0.lock() else {
                continue;
            };
            let now = now_millis();
            let mut expired = Vec::new();
            for task in tasks.iter_mut() {
                if task.timer_ends_at.is_some_and(|ends_at| ends_at <= now) {
                    task.timer_ends_at = None;
                    expired.push(task.text.clone());
                }
            }
            if expired.is_empty() {
                continue;
            }
            let _ = save_tasks(&app, &tasks);
            let _ = app.emit_to("main", "tasks-updated", tasks.clone());
            expired
        };

        for task_text in expired {
            let _ = app
                .notification()
                .builder()
                .title("Hobo timer finished")
                .body(format!("Timer finished: {task_text}"))
                .show();
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .args(["--minimized"])
                .build(),
        )
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        toggle_window(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            app.manage(TaskStore(Mutex::new(load_tasks(app.handle()))));

            let mini = WebviewWindowBuilder::new(
                app,
                "mini",
                WebviewUrl::App("mini.html".into()),
            )
            .title("Hobo tasks")
            .inner_size(64.0, 64.0)
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .visible(false)
            .build()?;
            position_mini_window(app.handle(), &mini);

            let open_item = MenuItem::with_id(app, "open", "Open Hobo", true, None::<&str>)?;
            let hide_item = MenuItem::with_id(app, "hide", "Hide to tray", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit Hobo", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&open_item, &hide_item, &quit_item])?;

            TrayIconBuilder::with_id("dayfly-tray")
                .icon(app.default_window_icon().expect("Hobo icon missing").clone())
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .tooltip("Hobo — quick to-dos")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => restore_main_window(app),
                    "hide" => {
                        if let Some(main) = app.get_webview_window("main") {
                            let _ = main.hide();
                        }
                        if let Some(mini) = app.get_webview_window("mini") {
                            let _ = mini.hide();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        restore_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            #[cfg(target_os = "macos")]
            let primary_modifier = Modifiers::SUPER;
            #[cfg(not(target_os = "macos"))]
            let primary_modifier = Modifiers::CONTROL;

            let shortcut = Shortcut::new(
                Some(primary_modifier | Modifiers::SHIFT),
                Code::Space,
            );
            app.global_shortcut().register(shortcut)?;

            if !app.autolaunch().is_enabled().unwrap_or(false) {
                let _ = app.autolaunch().enable();
            }

            if std::env::args().any(|argument| argument == "--minimized") {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }

            start_timer_watcher(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            list_tasks,
            add_task,
            toggle_task,
            set_task_tag,
            set_task_timer,
            reorder_tasks,
            delete_task,
            clear_completed,
            replace_tasks,
            minimize_to_mini,
            restore_main
        ])
        .run(tauri::generate_context!())
        .expect("error while running Hobo");
}
