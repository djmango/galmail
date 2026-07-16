//! Durable SQLCipher storage and transactional schema migrations.

use crate::{
    crypto::{self, AssociatedData},
    keys::{DerivedKey, KeyPurpose, VaultKey},
    CoreError,
};
use parking_lot::Mutex;
use rusqlite::{params, Connection, OpenFlags, OptionalExtension, TransactionBehavior};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};

pub const CURRENT_SCHEMA_VERSION: u32 = 3;

pub const DURABLE_MAIL_KINDS: &[&str] = &[
    "cursor",
    "message",
    "thread",
    "label",
    "contact",
    "attachment",
    "attachment_blob",
    "mutation",
    "outbox",
];

#[derive(Debug)]
pub struct SyncWrite<'a> {
    pub kind: &'a str,
    pub object_id: &'a str,
    pub payload: &'a [u8],
}

pub struct EncryptedDatabase {
    connection: Mutex<Connection>,
    blob_key: DerivedKey,
    path: PathBuf,
}

impl EncryptedDatabase {
    pub fn open(path: impl AsRef<Path>, vault_key: &VaultKey) -> Result<Self, CoreError> {
        let path = path.as_ref().to_path_buf();
        let database_key = vault_key.derive(KeyPurpose::Database)?;
        let blob_key = vault_key.derive(KeyPurpose::LocalBlob)?;
        let mut connection = Connection::open_with_flags(
            &path,
            OpenFlags::SQLITE_OPEN_READ_WRITE
                | OpenFlags::SQLITE_OPEN_CREATE
                | OpenFlags::SQLITE_OPEN_FULL_MUTEX,
        )
        .map_err(database_error)?;

        configure_sqlcipher(&connection, database_key.expose())?;
        migrate(&mut connection)?;
        verify_integrity(&connection)?;

        Ok(Self {
            connection: Mutex::new(connection),
            blob_key,
            path,
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn schema_version(&self) -> Result<u32, CoreError> {
        self.connection
            .lock()
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(database_error)
    }

    pub fn verify_integrity(&self) -> Result<(), CoreError> {
        verify_integrity(&self.connection.lock())
    }

    pub fn put_record(
        &self,
        account_id: &str,
        kind: &str,
        object_id: &str,
        plaintext: &[u8],
    ) -> Result<(), CoreError> {
        validate_identifier(account_id)?;
        validate_durable_kind(kind)?;
        validate_identifier(object_id)?;
        let aad = AssociatedData {
            purpose: kind,
            account_id,
            object_id,
        }
        .encode();
        let envelope = crypto::seal(plaintext, self.blob_key.expose(), &aad)?;
        self.connection
            .lock()
            .execute(
                "INSERT INTO encrypted_records
                    (account_id, kind, object_id, envelope, updated_at)
                 VALUES (?1, ?2, ?3, ?4, unixepoch())
                 ON CONFLICT(account_id, kind, object_id) DO UPDATE SET
                    envelope = excluded.envelope,
                    updated_at = excluded.updated_at",
                params![account_id, kind, object_id, envelope],
            )
            .map_err(database_error)?;
        Ok(())
    }

    pub fn get_record(
        &self,
        account_id: &str,
        kind: &str,
        object_id: &str,
    ) -> Result<Option<Vec<u8>>, CoreError> {
        validate_identifier(account_id)?;
        validate_durable_kind(kind)?;
        validate_identifier(object_id)?;
        let envelope: Option<Vec<u8>> = self
            .connection
            .lock()
            .query_row(
                "SELECT envelope FROM encrypted_records
                 WHERE account_id = ?1 AND kind = ?2 AND object_id = ?3",
                params![account_id, kind, object_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(database_error)?;
        let Some(envelope) = envelope else {
            return Ok(None);
        };
        let aad = AssociatedData {
            purpose: kind,
            account_id,
            object_id,
        }
        .encode();
        crypto::open(&envelope, self.blob_key.expose(), &aad).map(Some)
    }

    pub fn delete_record(
        &self,
        account_id: &str,
        kind: &str,
        object_id: &str,
    ) -> Result<bool, CoreError> {
        validate_identifier(account_id)?;
        validate_durable_kind(kind)?;
        validate_identifier(object_id)?;
        let changed = self
            .connection
            .lock()
            .execute(
                "DELETE FROM encrypted_records
                 WHERE account_id = ?1 AND kind = ?2 AND object_id = ?3",
                params![account_id, kind, object_id],
            )
            .map_err(database_error)?;
        Ok(changed != 0)
    }

    pub fn list_records(
        &self,
        account_id: &str,
        kind: &str,
    ) -> Result<Vec<(String, Vec<u8>)>, CoreError> {
        validate_identifier(account_id)?;
        validate_durable_kind(kind)?;
        let connection = self.connection.lock();
        let mut statement = connection
            .prepare(
                "SELECT object_id, envelope FROM encrypted_records
                 WHERE account_id = ?1 AND kind = ?2 ORDER BY object_id",
            )
            .map_err(database_error)?;
        let rows = statement
            .query_map(params![account_id, kind], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?))
            })
            .map_err(database_error)?;
        let mut records = Vec::new();
        for row in rows {
            let (object_id, envelope) = row.map_err(database_error)?;
            let aad = AssociatedData {
                purpose: kind,
                account_id,
                object_id: &object_id,
            }
            .encode();
            records.push((
                object_id,
                crypto::open(&envelope, self.blob_key.expose(), &aad)?,
            ));
        }
        Ok(records)
    }

    /// Atomically applies normalized provider objects, deletes, and the next cursor.
    pub fn apply_sync_batch(
        &self,
        account_id: &str,
        upserts: &[SyncWrite<'_>],
        deletes: &[(&str, &str)],
        cursor: &[u8],
    ) -> Result<(), CoreError> {
        validate_identifier(account_id)?;
        let mut sealed = Vec::with_capacity(upserts.len());
        for write in upserts {
            validate_durable_kind(write.kind)?;
            validate_identifier(write.object_id)?;
            let aad = AssociatedData {
                purpose: write.kind,
                account_id,
                object_id: write.object_id,
            }
            .encode();
            sealed.push((
                write.kind,
                write.object_id,
                crypto::seal(write.payload, self.blob_key.expose(), &aad)?,
            ));
        }
        for (kind, object_id) in deletes {
            validate_durable_kind(kind)?;
            validate_identifier(object_id)?;
        }
        let cursor_aad = AssociatedData {
            purpose: "cursor",
            account_id,
            object_id: "gmail",
        }
        .encode();
        let sealed_cursor = crypto::seal(cursor, self.blob_key.expose(), &cursor_aad)?;

        let mut connection = self.connection.lock();
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        for (kind, object_id, envelope) in sealed {
            transaction
                .execute(
                    "INSERT INTO encrypted_records
                        (account_id, kind, object_id, envelope, updated_at)
                     VALUES (?1, ?2, ?3, ?4, unixepoch())
                     ON CONFLICT(account_id, kind, object_id) DO UPDATE SET
                        envelope = excluded.envelope,
                        updated_at = excluded.updated_at",
                    params![account_id, kind, object_id, envelope],
                )
                .map_err(database_error)?;
        }
        for (kind, object_id) in deletes {
            transaction
                .execute(
                    "DELETE FROM encrypted_records
                     WHERE account_id = ?1 AND kind = ?2 AND object_id = ?3",
                    params![account_id, kind, object_id],
                )
                .map_err(database_error)?;
        }
        transaction
            .execute(
                "INSERT INTO encrypted_records
                    (account_id, kind, object_id, envelope, updated_at)
                 VALUES (?1, 'cursor', 'gmail', ?2, unixepoch())
                 ON CONFLICT(account_id, kind, object_id) DO UPDATE SET
                    envelope = excluded.envelope,
                    updated_at = excluded.updated_at",
                params![account_id, sealed_cursor],
            )
            .map_err(database_error)?;
        transaction
            .execute(
                "INSERT INTO sync_commits(account_id, committed_at)
                 VALUES (?1, unixepoch())
                 ON CONFLICT(account_id) DO UPDATE SET committed_at = excluded.committed_at",
                [account_id],
            )
            .map_err(database_error)?;
        transaction.commit().map_err(database_error)
    }

    /// Deletes every account-scoped row in one transaction.
    pub fn delete_account(&self, account_id: &str) -> Result<usize, CoreError> {
        let mut connection = self.connection.lock();
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        let records = transaction
            .execute(
                "DELETE FROM encrypted_records WHERE account_id = ?1",
                [account_id],
            )
            .map_err(database_error)?;
        transaction
            .execute(
                "DELETE FROM mail_search WHERE account_id = ?1",
                [account_id],
            )
            .map_err(database_error)?;
        transaction
            .execute(
                "DELETE FROM sync_commits WHERE account_id = ?1",
                [account_id],
            )
            .map_err(database_error)?;
        transaction.commit().map_err(database_error)?;
        Ok(records)
    }

    pub fn record_count(&self) -> Result<u64, CoreError> {
        let count: i64 = self
            .connection
            .lock()
            .query_row("SELECT count(*) FROM encrypted_records", [], |row| {
                row.get(0)
            })
            .map_err(database_error)?;
        u64::try_from(count).map_err(|_| CoreError::Database("invalid record count".into()))
    }

    pub fn index_mail(
        &self,
        account_id: &str,
        object_id: &str,
        subject: &str,
        sender: &str,
        body: &str,
    ) -> Result<(), CoreError> {
        let mut connection = self.connection.lock();
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        transaction
            .execute(
                "DELETE FROM mail_search WHERE account_id = ?1 AND object_id = ?2",
                params![account_id, object_id],
            )
            .map_err(database_error)?;
        transaction
            .execute(
                "INSERT INTO mail_search(account_id, object_id, subject, sender, body)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![account_id, object_id, subject, sender, body],
            )
            .map_err(database_error)?;
        transaction.commit().map_err(database_error)?;
        Ok(())
    }

    pub fn search(&self, account_id: &str, query: &str) -> Result<Vec<String>, CoreError> {
        let connection = self.connection.lock();
        let mut statement = connection
            .prepare(
                "SELECT object_id FROM mail_search
                 WHERE mail_search MATCH ?1 AND account_id = ?2
                 ORDER BY rank LIMIT 200",
            )
            .map_err(database_error)?;
        let rows = statement
            .query_map(params![query, account_id], |row| row.get(0))
            .map_err(database_error)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(database_error)
    }
}

fn configure_sqlcipher(connection: &Connection, key: &[u8; 32]) -> Result<(), CoreError> {
    let hex_key: String = key.iter().map(|byte| format!("{byte:02x}")).collect();
    connection
        .execute_batch(&format!("PRAGMA key = \"x'{hex_key}'\";"))
        .map_err(database_error)?;
    connection
        .execute_batch(
            "PRAGMA cipher_memory_security = ON;
             PRAGMA foreign_keys = ON;
             PRAGMA secure_delete = ON;
             PRAGMA journal_mode = WAL;",
        )
        .map_err(|_| CoreError::DatabaseLockedOrCorrupt)?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(database_error)?;

    let cipher_version: String = connection
        .query_row("PRAGMA cipher_version", [], |row| row.get(0))
        .map_err(|_| CoreError::SqlCipherUnavailable)?;
    if cipher_version.trim().is_empty() {
        return Err(CoreError::SqlCipherUnavailable);
    }
    // Reading the schema forces SQLCipher to authenticate an existing file.
    connection
        .query_row("SELECT count(*) FROM sqlite_master", [], |row| {
            row.get::<_, i64>(0)
        })
        .map_err(|_| CoreError::DatabaseLockedOrCorrupt)?;
    Ok(())
}

fn migrate(connection: &mut Connection) -> Result<(), CoreError> {
    let current: u32 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(database_error)?;
    if current > CURRENT_SCHEMA_VERSION {
        return Err(CoreError::UnsupportedSchemaVersion(current));
    }

    for version in current + 1..=CURRENT_SCHEMA_VERSION {
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Exclusive)
            .map_err(database_error)?;
        match version {
            1 => transaction
                .execute_batch(
                    "CREATE TABLE encrypted_records (
                        account_id TEXT NOT NULL,
                        kind TEXT NOT NULL,
                        object_id TEXT NOT NULL,
                        envelope BLOB NOT NULL,
                        updated_at INTEGER NOT NULL,
                        PRIMARY KEY (account_id, kind, object_id)
                     ) WITHOUT ROWID;
                     CREATE TABLE migration_history (
                        version INTEGER PRIMARY KEY,
                        applied_at INTEGER NOT NULL
                     );",
                )
                .map_err(database_error)?,
            2 => transaction
                .execute_batch(
                    "CREATE VIRTUAL TABLE mail_search USING fts5(
                        account_id UNINDEXED,
                        object_id UNINDEXED,
                        subject,
                        sender,
                        body,
                        tokenize = 'unicode61 remove_diacritics 2'
                     );
                     CREATE INDEX encrypted_records_updated
                     ON encrypted_records(account_id, updated_at);",
                )
                .map_err(database_error)?,
            3 => transaction
                .execute_batch(
                    "CREATE TABLE sync_commits (
                        account_id TEXT PRIMARY KEY,
                        committed_at INTEGER NOT NULL
                     ) WITHOUT ROWID;",
                )
                .map_err(database_error)?,
            _ => return Err(CoreError::UnsupportedSchemaVersion(version)),
        }
        transaction
            .execute(
                "INSERT INTO migration_history(version, applied_at)
                 VALUES (?1, unixepoch())",
                [version],
            )
            .map_err(database_error)?;
        transaction
            .pragma_update(None, "user_version", version)
            .map_err(database_error)?;
        transaction.commit().map_err(database_error)?;
    }
    Ok(())
}

fn verify_integrity(connection: &Connection) -> Result<(), CoreError> {
    let result: String = connection
        .query_row("PRAGMA quick_check", [], |row| row.get(0))
        .map_err(|_| CoreError::DatabaseLockedOrCorrupt)?;
    if result == "ok" {
        Ok(())
    } else {
        Err(CoreError::DatabaseLockedOrCorrupt)
    }
}

fn validate_identifier(value: &str) -> Result<(), CoreError> {
    if value.is_empty() || value.len() > 512 {
        Err(CoreError::InvalidInput("invalid record identifier".into()))
    } else {
        Ok(())
    }
}

fn validate_durable_kind(kind: &str) -> Result<(), CoreError> {
    if DURABLE_MAIL_KINDS.contains(&kind) {
        Ok(())
    } else {
        Err(CoreError::InvalidInput(
            "unsupported durable record kind".into(),
        ))
    }
}

fn database_error(_error: rusqlite::Error) -> CoreError {
    CoreError::Database("encrypted database operation failed".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;
    use std::collections::BTreeMap;
    use tempfile::tempdir;

    fn vault(byte: u8) -> VaultKey {
        VaultKey::from_bytes([byte; 32])
    }

    #[test]
    fn survives_restart_and_rejects_wrong_key() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("mail.db");
        {
            let database = EncryptedDatabase::open(&path, &vault(1)).unwrap();
            database
                .put_record("gmail:a", "message", "m1", b"durable")
                .unwrap();
        }
        let reopened = EncryptedDatabase::open(&path, &vault(1)).unwrap();
        assert_eq!(
            reopened
                .get_record("gmail:a", "message", "m1")
                .unwrap()
                .unwrap(),
            b"durable"
        );
        drop(reopened);
        assert!(matches!(
            EncryptedDatabase::open(&path, &vault(2)),
            Err(CoreError::DatabaseLockedOrCorrupt)
        ));
    }

    #[test]
    fn corrupted_database_fails_closed() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("corrupt.db");
        drop(EncryptedDatabase::open(&path, &vault(7)).unwrap());
        let mut contents = std::fs::read(&path).unwrap();
        contents[64] ^= 0xff;
        std::fs::write(&path, contents).unwrap();
        assert!(matches!(
            EncryptedDatabase::open(&path, &vault(7)),
            Err(CoreError::DatabaseLockedOrCorrupt) | Err(CoreError::Database(_))
        ));
    }

    #[test]
    fn deletes_records_and_whole_accounts() {
        let directory = tempdir().unwrap();
        let database =
            EncryptedDatabase::open(directory.path().join("mail.db"), &vault(3)).unwrap();
        database.put_record("a", "message", "1", b"one").unwrap();
        database.put_record("a", "message", "2", b"two").unwrap();
        database.put_record("b", "message", "3", b"three").unwrap();
        assert!(database.delete_record("a", "message", "1").unwrap());
        assert_eq!(database.delete_account("a").unwrap(), 1);
        assert_eq!(database.record_count().unwrap(), 1);
    }

    #[test]
    fn migration_interruption_rolls_back() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("rollback.db");
        let key = vault(4);
        let database_key = key.derive(KeyPurpose::Database).unwrap();
        let mut connection = Connection::open(&path).unwrap();
        configure_sqlcipher(&connection, database_key.expose()).unwrap();

        {
            let transaction = connection
                .transaction_with_behavior(TransactionBehavior::Exclusive)
                .unwrap();
            transaction
                .execute_batch("CREATE TABLE interrupted(value TEXT);")
                .unwrap();
            // Dropping without commit models process interruption.
        }

        let table: Option<String> = connection
            .query_row(
                "SELECT name FROM sqlite_master WHERE name = 'interrupted'",
                [],
                |row| row.get(0),
            )
            .optional()
            .unwrap();
        assert!(table.is_none());
        migrate(&mut connection).unwrap();
        assert_eq!(
            connection
                .query_row("PRAGMA user_version", [], |row| row.get::<_, u32>(0))
                .unwrap(),
            CURRENT_SCHEMA_VERSION
        );
    }

    #[test]
    fn representative_scale_roundtrips() {
        let directory = tempdir().unwrap();
        let database =
            EncryptedDatabase::open(directory.path().join("scale.db"), &vault(5)).unwrap();
        for index in 0..10_000 {
            database
                .put_record(
                    "gmail:scale",
                    "message",
                    &format!("m{index}"),
                    format!("subject and body {index}").as_bytes(),
                )
                .unwrap();
        }
        assert_eq!(database.record_count().unwrap(), 10_000);
        assert_eq!(
            database
                .get_record("gmail:scale", "message", "m9999")
                .unwrap()
                .unwrap(),
            b"subject and body 9999"
        );
        database.verify_integrity().unwrap();
    }

    #[test]
    fn fts_is_account_scoped() {
        let directory = tempdir().unwrap();
        let database =
            EncryptedDatabase::open(directory.path().join("search.db"), &vault(6)).unwrap();
        database
            .index_mail("a", "m1", "Quarterly plan", "alex", "Roadmap")
            .unwrap();
        database
            .index_mail("b", "m2", "Quarterly plan", "sam", "Secret")
            .unwrap();
        assert_eq!(database.search("a", "quarterly").unwrap(), vec!["m1"]);
    }

    #[test]
    fn sync_batch_is_atomic_and_restart_safe() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("sync.db");
        {
            let database = EncryptedDatabase::open(&path, &vault(8)).unwrap();
            database
                .apply_sync_batch(
                    "gmail:a",
                    &[
                        SyncWrite {
                            kind: "message",
                            object_id: "m1",
                            payload: br#"{"subject":"one"}"#,
                        },
                        SyncWrite {
                            kind: "thread",
                            object_id: "t1",
                            payload: br#"{"messages":["m1"]}"#,
                        },
                        SyncWrite {
                            kind: "label",
                            object_id: "INBOX",
                            payload: br#"{"name":"Inbox"}"#,
                        },
                        SyncWrite {
                            kind: "contact",
                            object_id: "sender@example.com",
                            payload: br#"{"name":"Sender"}"#,
                        },
                        SyncWrite {
                            kind: "attachment",
                            object_id: "m1:a1",
                            payload: br#"{"size":42}"#,
                        },
                        SyncWrite {
                            kind: "outbox",
                            object_id: "op1",
                            payload: br#"{"status":"pending"}"#,
                        },
                    ],
                    &[],
                    b"history-10",
                )
                .unwrap();
        }
        let reopened = EncryptedDatabase::open(&path, &vault(8)).unwrap();
        assert_eq!(
            reopened.list_records("gmail:a", "message").unwrap().len(),
            1
        );
        assert_eq!(
            reopened
                .get_record("gmail:a", "cursor", "gmail")
                .unwrap()
                .unwrap(),
            b"history-10"
        );
        reopened
            .apply_sync_batch(
                "gmail:a",
                &[],
                &[("message", "m1"), ("thread", "t1")],
                b"history-11",
            )
            .unwrap();
        assert!(reopened
            .get_record("gmail:a", "message", "m1")
            .unwrap()
            .is_none());
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(16))]

        #[test]
        fn arbitrary_record_sequences_survive_migration_and_restart(
            operations in prop::collection::vec((any::<bool>(), 0_u8..16, prop::collection::vec(any::<u8>(), 0..128)), 1..40)
        ) {
            let directory = tempdir().unwrap();
            let path = directory.path().join("property.db");
            let key = vault(9);
            let mut expected = BTreeMap::new();
            {
                let database = EncryptedDatabase::open(&path, &key).unwrap();
                for (put, object, payload) in operations {
                    let object_id = format!("m{object}");
                    if put {
                        database.put_record("gmail:property", "message", &object_id, &payload).unwrap();
                        expected.insert(object_id, payload);
                    } else {
                        database.delete_record("gmail:property", "message", &object_id).unwrap();
                        expected.remove(&object_id);
                    }
                }
                prop_assert_eq!(database.schema_version().unwrap(), CURRENT_SCHEMA_VERSION);
            }
            let reopened = EncryptedDatabase::open(&path, &key).unwrap();
            let actual = reopened
                .list_records("gmail:property", "message")
                .unwrap()
                .into_iter()
                .collect::<BTreeMap<_, _>>();
            prop_assert_eq!(actual, expected);
        }
    }
}
