#![cfg_attr(test, allow(dead_code))]

mod gmail_oauth;
mod microsoft_oauth;
mod oauth_callback_page;
mod release_support;
mod secure_storage;
mod unsubscribe;

use galmail_core::database::{EncryptedDatabase, SyncWrite, CURRENT_SCHEMA_VERSION};
use gmail_oauth::{BeginOAuth, ConnectedAccount, GmailApiResponse, GmailOAuthState};
use microsoft_oauth::{
    GraphApiResponse, MicrosoftBeginOAuth, MicrosoftConnectedAccount, MicrosoftOAuthState,
};
use release_support::{classify_startup_error, release_channel, RecoveryStatus, ReleaseSupport};
use secure_storage::{open_or_create, MacOsKeychain};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use tauri::Manager;
use tauri::State;
use tauri_plugin_updater::UpdaterExt;

struct AppState {
    database: Option<EncryptedDatabase>,
    gmail_oauth: GmailOAuthState,
    microsoft_oauth: MicrosoftOAuthState,
    release_support: ReleaseSupport,
    safe_mode: bool,
    startup_issue: Option<&'static str>,
}

impl AppState {
    fn database(&self) -> Result<&EncryptedDatabase, String> {
        self.database.as_ref().ok_or_else(|| {
            "encrypted database is unavailable; use GalMail recovery commands".into()
        })
    }

    fn require_normal_mode(&self) -> Result<(), String> {
        if self.safe_mode || self.database.is_none() {
            Err("network and account operations are disabled in safe mode".into())
        } else {
            Ok(())
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RecordRequest {
    account_id: String,
    object_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PutMessageRequest {
    account_id: String,
    object_id: String,
    payload: Vec<u8>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DurableRecordRequest {
    account_id: String,
    kind: String,
    object_id: String,
    payload: Vec<u8>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DurableKeyRequest {
    account_id: String,
    kind: String,
    object_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ListRecordsRequest {
    account_id: String,
    kind: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DurableRecord {
    object_id: String,
    payload: Vec<u8>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SyncBatchRequest {
    account_id: String,
    upserts: Vec<DurableRecordInput>,
    deletes: Vec<DurableDeleteInput>,
    cursor: Vec<u8>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DurableRecordInput {
    kind: String,
    object_id: String,
    payload: Vec<u8>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DurableDeleteInput {
    kind: String,
    object_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GmailApiRequest {
    account_id: String,
    client_id: String,
    method: String,
    path: String,
    body: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GraphApiRequest {
    account_id: String,
    client_id: String,
    method: String,
    path: String,
    body: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageStatus {
    schema_version: u32,
    record_count: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct IndexMailRequest {
    account_id: String,
    object_id: String,
    subject: String,
    sender: String,
    body: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SearchMailRequest {
    account_id: String,
    query: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AccountRemoval {
    local_records_deleted: u64,
    remotely_revoked: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RestartRequired {
    restart_required: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DatabaseRepairResult {
    verified: bool,
    repaired: bool,
    message: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateAvailability {
    current_version: String,
    version: String,
    notes: Option<String>,
}

#[tauri::command]
fn core_version() -> String {
    "galmail-core/0.1.0".into()
}

#[tauri::command]
fn put_message(state: State<'_, AppState>, request: PutMessageRequest) -> Result<(), String> {
    const MAX_MESSAGE_BYTES: usize = 25 * 1024 * 1024;
    if request.payload.len() > MAX_MESSAGE_BYTES {
        return Err("message exceeds local storage limit".into());
    }
    state
        .database()?
        .put_record(
            &request.account_id,
            "message",
            &request.object_id,
            &request.payload,
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_message(
    state: State<'_, AppState>,
    request: RecordRequest,
) -> Result<Option<Vec<u8>>, String> {
    state
        .database()?
        .get_record(&request.account_id, "message", &request.object_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn put_durable_record(
    state: State<'_, AppState>,
    request: DurableRecordRequest,
) -> Result<(), String> {
    if request.payload.len() > 25 * 1024 * 1024 {
        return Err("durable record exceeds local storage limit".into());
    }
    state
        .database()?
        .put_record(
            &request.account_id,
            &request.kind,
            &request.object_id,
            &request.payload,
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_durable_record(
    state: State<'_, AppState>,
    request: DurableKeyRequest,
) -> Result<Option<Vec<u8>>, String> {
    state
        .database()?
        .get_record(&request.account_id, &request.kind, &request.object_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_durable_records(
    state: State<'_, AppState>,
    request: ListRecordsRequest,
) -> Result<Vec<DurableRecord>, String> {
    state
        .database()?
        .list_records(&request.account_id, &request.kind)
        .map(|records| {
            records
                .into_iter()
                .map(|(object_id, payload)| DurableRecord { object_id, payload })
                .collect()
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn apply_sync_batch(state: State<'_, AppState>, request: SyncBatchRequest) -> Result<(), String> {
    if request.upserts.len() + request.deletes.len() > 10_000 {
        return Err("sync batch exceeds operation limit".into());
    }
    if request
        .upserts
        .iter()
        .any(|record| record.payload.len() > 25 * 1024 * 1024)
    {
        return Err("sync record exceeds local storage limit".into());
    }
    let upserts: Vec<_> = request
        .upserts
        .iter()
        .map(|record| SyncWrite {
            kind: &record.kind,
            object_id: &record.object_id,
            payload: &record.payload,
        })
        .collect();
    let deletes: Vec<_> = request
        .deletes
        .iter()
        .map(|record| (record.kind.as_str(), record.object_id.as_str()))
        .collect();
    state
        .database()?
        .apply_sync_batch(&request.account_id, &upserts, &deletes, &request.cursor)
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn gmail_oauth_begin(
    state: State<'_, AppState>,
    client_id: String,
) -> Result<BeginOAuth, String> {
    state.require_normal_mode()?;
    state.gmail_oauth.begin(client_id).await
}

#[tauri::command]
async fn gmail_oauth_complete(
    state: State<'_, AppState>,
    attempt_id: String,
) -> Result<ConnectedAccount, String> {
    state.require_normal_mode()?;
    state.gmail_oauth.complete(&attempt_id).await
}

#[tauri::command]
async fn gmail_api_request(
    state: State<'_, AppState>,
    request: GmailApiRequest,
) -> Result<GmailApiResponse, String> {
    state.require_normal_mode()?;
    state
        .gmail_oauth
        .api_request(
            &request.account_id,
            &request.client_id,
            &request.method,
            &request.path,
            request.body,
        )
        .await
}

#[tauri::command]
async fn google_calendar_request(
    state: State<'_, AppState>,
    request: GmailApiRequest,
) -> Result<GmailApiResponse, String> {
    state.require_normal_mode()?;
    state
        .gmail_oauth
        .calendar_api_request(
            &request.account_id,
            &request.client_id,
            &request.method,
            &request.path,
            request.body,
        )
        .await
}

#[tauri::command]
async fn gmail_revoke(state: State<'_, AppState>, account_id: String) -> Result<bool, String> {
    state.require_normal_mode()?;
    state.gmail_oauth.revoke(&account_id).await
}

#[tauri::command]
async fn gmail_remove_account(
    state: State<'_, AppState>,
    account_id: String,
) -> Result<AccountRemoval, String> {
    state.require_normal_mode()?;
    let remotely_revoked = state.gmail_oauth.revoke(&account_id).await?;
    let deleted = state
        .database()?
        .delete_account(&account_id)
        .map_err(|error| error.to_string())?;
    Ok(AccountRemoval {
        local_records_deleted: u64::try_from(deleted)
            .map_err(|_| "invalid deletion count".to_string())?,
        remotely_revoked,
    })
}

#[tauri::command]
async fn microsoft_oauth_begin(
    state: State<'_, AppState>,
    client_id: String,
    tenant: Option<String>,
) -> Result<MicrosoftBeginOAuth, String> {
    state.require_normal_mode()?;
    state.microsoft_oauth.begin(client_id, tenant).await
}

#[tauri::command]
async fn microsoft_oauth_complete(
    state: State<'_, AppState>,
    attempt_id: String,
) -> Result<MicrosoftConnectedAccount, String> {
    state.require_normal_mode()?;
    state.microsoft_oauth.complete(&attempt_id).await
}

#[tauri::command]
async fn microsoft_graph_request(
    state: State<'_, AppState>,
    request: GraphApiRequest,
) -> Result<GraphApiResponse, String> {
    state.require_normal_mode()?;
    state
        .microsoft_oauth
        .api_request(
            &request.account_id,
            &request.client_id,
            &request.method,
            &request.path,
            request.body,
        )
        .await
}

#[tauri::command]
fn microsoft_remove_account(
    state: State<'_, AppState>,
    account_id: String,
) -> Result<AccountRemoval, String> {
    state.require_normal_mode()?;
    state.microsoft_oauth.disconnect(&account_id)?;
    let deleted = state
        .database()?
        .delete_account(&account_id)
        .map_err(|error| error.to_string())?;
    Ok(AccountRemoval {
        local_records_deleted: u64::try_from(deleted)
            .map_err(|_| "invalid deletion count".to_string())?,
        // Microsoft has no public-client token revocation endpoint. Tenant
        // consent removal is an explicit external account-management action.
        remotely_revoked: false,
    })
}

#[tauri::command]
fn delete_account(state: State<'_, AppState>, account_id: String) -> Result<u64, String> {
    state
        .database()?
        .delete_account(&account_id)
        .and_then(|count| {
            u64::try_from(count)
                .map_err(|_| galmail_core::CoreError::Database("invalid deletion count".into()))
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn storage_status(state: State<'_, AppState>) -> Result<StorageStatus, String> {
    state
        .database()?
        .verify_integrity()
        .map_err(|error| error.to_string())?;
    let schema_version = state
        .database()?
        .schema_version()
        .map_err(|error| error.to_string())?;
    if schema_version != CURRENT_SCHEMA_VERSION {
        return Err("unsupported local storage schema".into());
    }
    Ok(StorageStatus {
        schema_version,
        record_count: state
            .database()?
            .record_count()
            .map_err(|error| error.to_string())?,
    })
}

#[tauri::command]
fn index_mail(state: State<'_, AppState>, request: IndexMailRequest) -> Result<(), String> {
    if request.subject.len() + request.sender.len() + request.body.len() > 10 * 1024 * 1024 {
        return Err("search document exceeds local limit".into());
    }
    state
        .database()?
        .index_mail(
            &request.account_id,
            &request.object_id,
            &request.subject,
            &request.sender,
            &request.body,
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn search_mail(
    state: State<'_, AppState>,
    request: SearchMailRequest,
) -> Result<Vec<String>, String> {
    if request.query.len() > 4_096 {
        return Err("search query exceeds local limit".into());
    }
    state
        .database()?
        .search(&request.account_id, &request.query)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn recovery_status(state: State<'_, AppState>) -> RecoveryStatus {
    RecoveryStatus {
        release_channel: release_channel(),
        safe_mode: state.safe_mode,
        database_available: state.database.is_some(),
        startup_issue: state.startup_issue,
        portable_recovery_configured: false,
    }
}

#[tauri::command]
fn request_safe_mode(state: State<'_, AppState>) -> Result<RestartRequired, String> {
    state.release_support.set_safe_mode(true)?;
    Ok(RestartRequired {
        restart_required: true,
    })
}

#[tauri::command]
fn exit_safe_mode(state: State<'_, AppState>) -> Result<RestartRequired, String> {
    state.release_support.set_safe_mode(false)?;
    Ok(RestartRequired {
        restart_required: true,
    })
}

#[tauri::command]
fn database_repair(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<DatabaseRepairResult, String> {
    if !state.safe_mode || state.database.is_some() {
        return Err("database repair is available only after restarting in safe mode".into());
    }
    let data_directory = app
        .path()
        .app_data_dir()
        .map_err(|_| "cannot locate GalMail data directory".to_string())?;
    let database = open_or_create(&data_directory, &MacOsKeychain)?;
    database
        .verify_integrity()
        .map_err(|_| "encrypted database could not be repaired; restore or reset it".to_string())?;
    Ok(DatabaseRepairResult {
        verified: true,
        repaired: false,
        message: "database verified and pending migrations completed; exit safe mode and restart",
    })
}

#[tauri::command]
fn export_encrypted_recovery_bundle(state: State<'_, AppState>) -> Result<String, String> {
    state
        .release_support
        .export_recovery_bundle(state.database.is_none())
        .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
fn export_redacted_diagnostics(state: State<'_, AppState>) -> Result<String, String> {
    let database_status = state.database.as_ref().and_then(|database| {
        Some((
            database.schema_version().ok()?,
            database.record_count().ok()?,
        ))
    });
    let (schema_version, record_count) = database_status
        .map(|(schema, count)| (Some(schema), Some(count)))
        .unwrap_or((None, None));
    state
        .release_support
        .export_redacted_diagnostics(
            state.safe_mode,
            schema_version,
            record_count,
            state.startup_issue,
        )
        .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
fn reset_local_database(
    state: State<'_, AppState>,
    confirmation: String,
) -> Result<RestartRequired, String> {
    state
        .release_support
        .reset_local_database(&confirmation, state.database.is_none())?;
    Ok(RestartRequired {
        restart_required: true,
    })
}

#[tauri::command]
async fn check_for_update(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<UpdateAvailability>, String> {
    state.require_normal_mode()?;
    app.updater()
        .map_err(|_| "updater is not configured for this build".to_string())?
        .check()
        .await
        .map_err(|_| "update check failed".to_string())
        .map(|update| {
            update.map(|update| UpdateAvailability {
                current_version: update.current_version,
                version: update.version,
                notes: update.body,
            })
        })
}

#[tauri::command]
async fn install_update(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<bool, String> {
    state.require_normal_mode()?;
    let Some(update) = app
        .updater()
        .map_err(|_| "updater is not configured for this build".to_string())?
        .check()
        .await
        .map_err(|_| "update check failed".to_string())?
    else {
        return Ok(false);
    };
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|_| "signed update download or installation failed".to_string())?;
    app.restart()
}

fn initialize_app(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let data_directory = app.path().app_data_dir()?;
    let release_support = ReleaseSupport::new(data_directory.clone());
    let safe_mode = release_support.safe_mode_requested();
    let (database, startup_issue) = if safe_mode {
        (None, None)
    } else {
        match open_or_create(&data_directory, &MacOsKeychain) {
            Ok(database) => (Some(database), None),
            Err(error) => (None, Some(classify_startup_error(&error))),
        }
    };
    let token_store = Arc::new(MacOsKeychain);
    app.manage(AppState {
        database,
        gmail_oauth: GmailOAuthState::new(token_store.clone()),
        microsoft_oauth: MicrosoftOAuthState::new(token_store),
        release_support,
        safe_mode: safe_mode || startup_issue.is_some(),
        startup_issue,
    });
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[cfg(not(test))]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(initialize_app)
        .invoke_handler(tauri::generate_handler![
            core_version,
            put_message,
            get_message,
            put_durable_record,
            get_durable_record,
            list_durable_records,
            apply_sync_batch,
            delete_account,
            storage_status,
            index_mail,
            search_mail,
            gmail_oauth_begin,
            gmail_oauth_complete,
            gmail_api_request,
            google_calendar_request,
            gmail_revoke,
            gmail_remove_account,
            microsoft_oauth_begin,
            microsoft_oauth_complete,
            microsoft_graph_request,
            microsoft_remove_account,
            recovery_status,
            request_safe_mode,
            exit_safe_mode,
            database_repair,
            export_encrypted_recovery_bundle,
            export_redacted_diagnostics,
            reset_local_database,
            check_for_update,
            install_update,
            unsubscribe::one_click_unsubscribe,
            unsubscribe::open_external_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running GalMail");
}

#[cfg(test)]
mod command_tests {
    use super::*;

    #[test]
    fn command_payloads_reject_unknown_fields() {
        let record = serde_json::json!({
            "accountId": "gmail:test",
            "objectId": "m1",
            "unexpected": "must not cross the native boundary"
        });
        assert!(serde_json::from_value::<RecordRequest>(record).is_err());

        let gmail = serde_json::json!({
            "accountId": "gmail:test",
            "clientId": "desktop-client",
            "method": "GET",
            "path": "/gmail/v1/users/me/messages",
            "body": null,
            "clientSecret": "forbidden"
        });
        assert!(serde_json::from_value::<GmailApiRequest>(gmail).is_err());
    }

    #[test]
    fn command_payloads_use_camel_case_and_core_version_is_stable() {
        let request = serde_json::from_value::<RecordRequest>(serde_json::json!({
            "accountId": "gmail:test",
            "objectId": "m1"
        }))
        .unwrap();
        assert_eq!(request.account_id, "gmail:test");
        assert_eq!(request.object_id, "m1");
        assert_eq!(core_version(), "galmail-core/0.1.0");
    }
}
