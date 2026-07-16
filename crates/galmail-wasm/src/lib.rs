use galmail_core::{
    crypto,
    keys::{VaultKey, KEY_LEN},
};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn galmail_generate_vault_key() -> Result<Vec<u8>, JsValue> {
    VaultKey::generate()
        .map(|key| key.expose().to_vec())
        .map_err(js_error)
}

#[wasm_bindgen]
pub fn galmail_seal(
    plaintext: &[u8],
    vault_key: &[u8],
    associated_data: &[u8],
) -> Result<Vec<u8>, JsValue> {
    let key = parse_key(vault_key)?;
    crypto::seal(plaintext, &key, associated_data).map_err(js_error)
}

#[wasm_bindgen]
pub fn galmail_open(
    ciphertext: &[u8],
    vault_key: &[u8],
    associated_data: &[u8],
) -> Result<Vec<u8>, JsValue> {
    let key = parse_key(vault_key)?;
    crypto::open(ciphertext, &key, associated_data).map_err(js_error)
}

#[wasm_bindgen]
pub fn galmail_version() -> String {
    format!("0.1.0/envelope-v{}", crypto::ENVELOPE_VERSION)
}

fn parse_key(value: &[u8]) -> Result<[u8; KEY_LEN], JsValue> {
    value
        .try_into()
        .map_err(|_| JsValue::from_str("vault keys must be 256 bits"))
}

fn js_error(error: galmail_core::CoreError) -> JsValue {
    JsValue::from_str(&error.to_string())
}
