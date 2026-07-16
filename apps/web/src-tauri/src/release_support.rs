use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const SAFE_MODE_MARKER: &str = "safe-mode";
const DATABASE_FILES: &[&str] = &[
    "galmail.db",
    "galmail.db-wal",
    "galmail.db-shm",
    "vault-key.gmae",
];

#[derive(Debug)]
pub struct ReleaseSupport {
    data_directory: PathBuf,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryStatus {
    pub release_channel: &'static str,
    pub safe_mode: bool,
    pub database_available: bool,
    pub startup_issue: Option<&'static str>,
    pub portable_recovery_configured: bool,
}

pub fn release_channel() -> &'static str {
    match option_env!("GALMAIL_RELEASE_CHANNEL") {
        Some("alpha") => "alpha",
        Some("beta") => "beta",
        Some("stable") => "stable",
        _ => "development",
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Diagnostics {
    format_version: u8,
    app_version: &'static str,
    os: &'static str,
    architecture: &'static str,
    safe_mode: bool,
    database_available: bool,
    database_schema_version: Option<u32>,
    database_record_count: Option<u64>,
    startup_issue: Option<&'static str>,
    content_included: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecoveryManifest {
    format_version: u8,
    created_at_unix_seconds: u64,
    encrypted_at_rest: bool,
    portable_to_another_device: bool,
    files: Vec<String>,
}

impl ReleaseSupport {
    pub fn new(data_directory: PathBuf) -> Self {
        Self { data_directory }
    }

    pub fn safe_mode_requested(&self) -> bool {
        std::env::var_os("GALMAIL_SAFE_MODE").is_some_and(|value| value == "1")
            || self.data_directory.join(SAFE_MODE_MARKER).exists()
    }

    pub fn set_safe_mode(&self, enabled: bool) -> Result<(), String> {
        fs::create_dir_all(&self.data_directory)
            .map_err(|_| "cannot create GalMail data directory".to_string())?;
        let marker = self.data_directory.join(SAFE_MODE_MARKER);
        if enabled {
            write_private(&marker, b"safe mode requested\n")
        } else {
            match fs::remove_file(marker) {
                Ok(()) => Ok(()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(_) => Err("cannot clear safe-mode marker".into()),
            }
        }
    }

    pub fn export_recovery_bundle(&self, database_closed: bool) -> Result<PathBuf, String> {
        if !database_closed {
            return Err(
                "restart in safe mode before exporting an encrypted recovery bundle".into(),
            );
        }
        let created_at = unix_seconds()?;
        let export_root = self.data_directory.join("recovery-exports");
        create_private_directory(&export_root)?;
        let export_directory = export_root.join(format!("galmail-recovery-{created_at}"));
        create_private_directory(&export_directory)?;

        let mut files = Vec::new();
        for name in DATABASE_FILES {
            let source = self.data_directory.join(name);
            if source.is_file() {
                fs::copy(&source, export_directory.join(name))
                    .map_err(|_| "cannot copy encrypted recovery data".to_string())?;
                files.push((*name).to_string());
            }
        }
        if files.is_empty() {
            let _ = fs::remove_dir(&export_directory);
            return Err("no local encrypted database is available to export".into());
        }

        let manifest = RecoveryManifest {
            format_version: 1,
            created_at_unix_seconds: created_at,
            encrypted_at_rest: true,
            portable_to_another_device: false,
            files,
        };
        write_json(
            &export_directory.join("manifest.json"),
            &manifest,
            "cannot write recovery manifest",
        )?;
        Ok(export_directory)
    }

    pub fn export_redacted_diagnostics(
        &self,
        safe_mode: bool,
        database_schema_version: Option<u32>,
        database_record_count: Option<u64>,
        startup_issue: Option<&'static str>,
    ) -> Result<PathBuf, String> {
        let export_root = self.data_directory.join("diagnostics");
        create_private_directory(&export_root)?;
        let path = export_root.join(format!("galmail-diagnostics-{}.json", unix_seconds()?));
        let diagnostics = Diagnostics {
            format_version: 1,
            app_version: env!("CARGO_PKG_VERSION"),
            os: std::env::consts::OS,
            architecture: std::env::consts::ARCH,
            safe_mode,
            database_available: database_schema_version.is_some(),
            database_schema_version,
            database_record_count,
            startup_issue,
            content_included: false,
        };
        write_json(&path, &diagnostics, "cannot write redacted diagnostics")?;
        Ok(path)
    }

    pub fn reset_local_database(
        &self,
        confirmation: &str,
        database_closed: bool,
    ) -> Result<(), String> {
        if !database_closed {
            return Err("restart in safe mode before resetting local data".into());
        }
        if confirmation != "DELETE LOCAL GALMAIL DATA" {
            return Err("local reset confirmation did not match".into());
        }
        for name in DATABASE_FILES {
            let path = self.data_directory.join(name);
            match fs::remove_file(path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => return Err("cannot remove local encrypted data".into()),
            }
        }
        Ok(())
    }
}

pub fn classify_startup_error(error: &str) -> &'static str {
    if error.contains("Keychain") || error.contains("keychain") {
        "keychain-unavailable"
    } else if error.contains("schema") {
        "unsupported-database-version"
    } else if error.contains("database") || error.contains("SQLCipher") {
        "database-unavailable"
    } else if error.contains("vault") {
        "vault-unavailable"
    } else {
        "native-startup-failed"
    }
}

fn write_json(path: &Path, value: &impl Serialize, error: &str) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|_| error.to_string())?;
    write_private(path, &bytes)
}

fn write_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .map_err(|_| "cannot create private export file".to_string())?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| "cannot persist private export file".to_string())
}

fn create_private_directory(path: &Path) -> Result<(), String> {
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder
        .create(path)
        .map_err(|_| "cannot create private export directory".to_string())
}

fn unix_seconds() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .map_err(|_| "system clock is invalid".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn exports_only_encrypted_recovery_files() {
        let directory = tempdir().unwrap();
        fs::write(directory.path().join("galmail.db"), b"ciphertext").unwrap();
        fs::write(directory.path().join("vault-key.gmae"), b"wrapped").unwrap();
        let support = ReleaseSupport::new(directory.path().to_path_buf());
        let exported = support.export_recovery_bundle(true).unwrap();
        let manifest = fs::read_to_string(exported.join("manifest.json")).unwrap();
        assert!(manifest.contains("\"encryptedAtRest\": true"));
        assert!(manifest.contains("\"portableToAnotherDevice\": false"));
        assert!(!manifest.contains("ciphertext"));
    }

    #[test]
    fn reset_requires_safe_mode_and_exact_confirmation() {
        let directory = tempdir().unwrap();
        fs::write(directory.path().join("galmail.db"), b"ciphertext").unwrap();
        let support = ReleaseSupport::new(directory.path().to_path_buf());
        assert!(support
            .reset_local_database("DELETE LOCAL GALMAIL DATA", false)
            .is_err());
        assert!(support.reset_local_database("delete", true).is_err());
        support
            .reset_local_database("DELETE LOCAL GALMAIL DATA", true)
            .unwrap();
        assert!(!directory.path().join("galmail.db").exists());
    }
}
