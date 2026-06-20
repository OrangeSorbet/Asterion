#[tauri::command]
fn theory_json_path() -> String {
  let manifest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
  let path = manifest_dir.join("..").join("theory.json");
  let canonical = std::fs::canonicalize(&path).unwrap_or(path);
  let s = canonical.to_string_lossy().to_string();
  s.strip_prefix(r"\\?\").unwrap_or(&s).to_string()
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
