fn main() {
    // `tauri::generate_context!` requires frontendDist ("../dist") to exist even for
    // `cargo check` (Apple CI / ios:rust:check). Real `tauri build` overwrites this
    // via beforeBuildCommand; only create a stub when the path is missing.
    let dist = std::path::Path::new("../dist");
    let index = dist.join("index.html");
    if !index.exists() {
        let _ = std::fs::create_dir_all(dist);
        let _ = std::fs::write(
            index,
            "<!doctype html><html><head><title>GalMail</title></head><body></body></html>\n",
        );
    }
    tauri_build::build()
}
