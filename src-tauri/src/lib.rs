use tauri::Manager;

#[tauri::command]
fn theory_json_path(app: tauri::AppHandle) -> Result<String, String> {
  let path = app.path().resource_dir()
    .map_err(|e| e.to_string())?
    .join("theory.json");
  Ok(path.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
  .plugin(tauri_plugin_fs::init())
  .plugin(tauri_plugin_shell::init())
  .invoke_handler(tauri::generate_handler![theory_json_path])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
