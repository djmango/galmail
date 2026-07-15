use galmail_core::{open, seal};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn galmail_seal(plaintext: &[u8], vault_key: &[u8]) -> Result<Vec<u8>, JsValue> {
    seal(plaintext, vault_key).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub fn galmail_open(ciphertext: &[u8], vault_key: &[u8]) -> Result<Vec<u8>, JsValue> {
    open(ciphertext, vault_key).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub fn galmail_version() -> String {
    "0.1.0".into()
}
