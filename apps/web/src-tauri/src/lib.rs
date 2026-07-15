use galmail_core::{seal, Outbox, MutationKind};
use tauri::State;
use std::sync::Mutex;

struct AppState {
    outbox: Mutex<Outbox>,
    vault_key: Vec<u8>,
}

#[tauri::command]
fn core_version() -> String {
    "galmail-core/0.1.0".into()
}

#[tauri::command]
fn enqueue_archive(state: State<'_, AppState>, account_id: String, message_id: String) -> String {
    let outbox = state.outbox.lock().unwrap();
    let m = outbox.enqueue(&account_id, MutationKind::Archive, vec![message_id]);
    m.id
}

#[tauri::command]
fn seal_blob(state: State<'_, AppState>, plaintext: Vec<u8>) -> Result<Vec<u8>, String> {
    seal(&plaintext, &state.vault_key).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState {
        outbox: Mutex::new(Outbox::new()),
        vault_key: b"dev-only-vault-key-change-me!!!!".to_vec(),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![core_version, enqueue_archive, seal_blob])
        .run(tauri::generate_context!())
        .expect("error while running GalMail");
}
