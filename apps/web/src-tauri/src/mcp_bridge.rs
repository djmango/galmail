//! Loopback HTTP bridge so local MCP clients can invoke tools against the
//! running GalMail webview (live vault / sync engine). Desktop only.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    net::SocketAddr,
    sync::{
        atomic::{AtomicBool, AtomicU16, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::oneshot,
    time::timeout,
};

const DEFAULT_PORT: u16 = 8675;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(300);

type PendingMap = Arc<Mutex<HashMap<String, oneshot::Sender<BridgeResponse>>>>;

#[derive(Clone)]
pub struct McpBridgeState {
    enabled: Arc<AtomicBool>,
    port: Arc<AtomicU16>,
    tokens: Arc<Mutex<HashSet<String>>>,
    pending: PendingMap,
    shutdown: Arc<Mutex<Option<tokio::sync::watch::Sender<bool>>>>,
}

impl Default for McpBridgeState {
    fn default() -> Self {
        Self {
            enabled: Arc::new(AtomicBool::new(false)),
            port: Arc::new(AtomicU16::new(0)),
            tokens: Arc::new(Mutex::new(HashSet::new())),
            pending: Arc::new(Mutex::new(HashMap::new())),
            shutdown: Arc::new(Mutex::new(None)),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpBridgeStartRequest {
    pub tokens: Vec<String>,
    pub port: Option<u16>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpBridgeTokensRequest {
    pub tokens: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpBridgeRespondRequest {
    pub id: String,
    pub ok: bool,
    pub result: Option<Value>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct McpBridgeStatus {
    pub running: bool,
    pub port: u16,
    pub url: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BridgeRequestEvent {
    id: String,
    name: String,
    arguments: Value,
    token: String,
}

#[derive(Debug, Clone)]
struct BridgeResponse {
    ok: bool,
    result: Option<Value>,
    error: Option<String>,
}

#[tauri::command]
pub fn mcp_bridge_status(state: State<'_, McpBridgeState>) -> McpBridgeStatus {
    status_from(&state)
}

#[tauri::command]
pub async fn mcp_bridge_start(
    app: AppHandle,
    state: State<'_, McpBridgeState>,
    request: McpBridgeStartRequest,
) -> Result<McpBridgeStatus, String> {
    let tokens: HashSet<String> = request
        .tokens
        .into_iter()
        .map(|token| token.trim().to_string())
        .filter(|token| !token.is_empty())
        .collect();
    if tokens.is_empty() {
        return Err("at least one MCP client token is required".into());
    }

    {
        let mut guard = state
            .tokens
            .lock()
            .map_err(|_| "mcp bridge token lock poisoned".to_string())?;
        *guard = tokens;
    }

    if state.enabled.load(Ordering::SeqCst) {
        return Ok(status_from(&state));
    }

    let preferred = request.port.unwrap_or(DEFAULT_PORT);
    let listener = match TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], preferred))).await {
        Ok(listener) => listener,
        Err(_) if preferred != 0 => TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))
            .await
            .map_err(|error| format!("cannot bind MCP bridge: {error}"))?,
        Err(error) => return Err(format!("cannot bind MCP bridge: {error}")),
    };
    let port = listener
        .local_addr()
        .map_err(|error| format!("cannot read MCP bridge port: {error}"))?
        .port();

    let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);
    {
        let mut guard = state
            .shutdown
            .lock()
            .map_err(|_| "mcp bridge shutdown lock poisoned".to_string())?;
        *guard = Some(shutdown_tx);
    }

    state.port.store(port, Ordering::SeqCst);
    state.enabled.store(true, Ordering::SeqCst);

    let app_handle = app.clone();
    let bridge = state.inner().clone();
    tauri::async_runtime::spawn(async move {
        run_accept_loop(app_handle, bridge, listener, shutdown_rx).await;
    });

    Ok(status_from(&state))
}

#[tauri::command]
pub async fn mcp_bridge_stop(state: State<'_, McpBridgeState>) -> Result<McpBridgeStatus, String> {
    stop_bridge(&state)?;
    Ok(status_from(&state))
}

#[tauri::command]
pub fn mcp_bridge_update_tokens(
    state: State<'_, McpBridgeState>,
    request: McpBridgeTokensRequest,
) -> Result<(), String> {
    let tokens: HashSet<String> = request
        .tokens
        .into_iter()
        .map(|token| token.trim().to_string())
        .filter(|token| !token.is_empty())
        .collect();
    let mut guard = state
        .tokens
        .lock()
        .map_err(|_| "mcp bridge token lock poisoned".to_string())?;
    *guard = tokens;
    Ok(())
}

#[tauri::command]
pub fn mcp_bridge_respond(
    state: State<'_, McpBridgeState>,
    request: McpBridgeRespondRequest,
) -> Result<(), String> {
    let sender = {
        let mut pending = state
            .pending
            .lock()
            .map_err(|_| "mcp bridge pending lock poisoned".to_string())?;
        pending.remove(&request.id)
    };
    let Some(sender) = sender else {
        return Err("unknown or expired MCP bridge request".into());
    };
    let _ = sender.send(BridgeResponse {
        ok: request.ok,
        result: request.result,
        error: request.error,
    });
    Ok(())
}

fn status_from(state: &McpBridgeState) -> McpBridgeStatus {
    let running = state.enabled.load(Ordering::SeqCst);
    let port = state.port.load(Ordering::SeqCst);
    McpBridgeStatus {
        running,
        port,
        url: if running && port > 0 {
            Some(format!("http://127.0.0.1:{port}"))
        } else {
            None
        },
    }
}

fn stop_bridge(state: &McpBridgeState) -> Result<(), String> {
    if let Ok(mut guard) = state.shutdown.lock() {
        if let Some(tx) = guard.take() {
            let _ = tx.send(true);
        }
    }
    state.enabled.store(false, Ordering::SeqCst);
    state.port.store(0, Ordering::SeqCst);
    if let Ok(mut pending) = state.pending.lock() {
        for (_, sender) in pending.drain() {
            let _ = sender.send(BridgeResponse {
                ok: false,
                result: None,
                error: Some("MCP bridge stopped".into()),
            });
        }
    }
    Ok(())
}

async fn run_accept_loop(
    app: AppHandle,
    state: McpBridgeState,
    listener: TcpListener,
    mut shutdown_rx: tokio::sync::watch::Receiver<bool>,
) {
    loop {
        tokio::select! {
            _ = shutdown_rx.changed() => {
                if *shutdown_rx.borrow() {
                    break;
                }
            }
            accepted = listener.accept() => {
                match accepted {
                    Ok((stream, _)) => {
                        let app = app.clone();
                        let state = state.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = handle_connection(app, state, stream).await;
                        });
                    }
                    Err(_) => break,
                }
            }
        }
    }
    state.enabled.store(false, Ordering::SeqCst);
    state.port.store(0, Ordering::SeqCst);
}

async fn handle_connection(
    app: AppHandle,
    state: McpBridgeState,
    mut stream: TcpStream,
) -> Result<(), String> {
    let (method, path, headers, body) = read_http_request(&mut stream).await?;
    if method == "GET" && path == "/health" {
        return write_json(
            &mut stream,
            200,
            &serde_json::json!({ "ok": true, "service": "galmail-mcp-bridge" }),
        )
        .await;
    }
    if method == "GET" && path == "/v1/status" {
        let status = serde_json::to_value(status_from(&state))
            .unwrap_or_else(|_| serde_json::json!({ "running": false, "port": 0 }));
        return write_json(&mut stream, 200, &status).await;
    }
    if method != "POST" || path != "/v1/tools/call" {
        return write_text(&mut stream, 404, "Not found").await;
    }

    let token = bearer_token(&headers).unwrap_or_default();
    if !token_allowed(&state, &token) {
        return write_text(&mut stream, 401, "Unauthorized").await;
    }

    let payload: Value =
        serde_json::from_slice(&body).map_err(|_| "invalid JSON body".to_string())?;
    let name = payload
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    if name.is_empty() {
        return write_json(
            &mut stream,
            400,
            &serde_json::json!({ "ok": false, "error": "missing tool name" }),
        )
        .await;
    }
    let arguments = payload
        .get("arguments")
        .cloned()
        .unwrap_or_else(|| Value::Object(serde_json::Map::new()));
    let id = payload
        .get("id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| format!("req_{}", random_id()));

    let (tx, rx) = oneshot::channel();
    {
        let mut pending = state
            .pending
            .lock()
            .map_err(|_| "mcp bridge pending lock poisoned".to_string())?;
        pending.insert(id.clone(), tx);
    }

    let event = BridgeRequestEvent {
        id: id.clone(),
        name,
        arguments,
        token,
    };
    if app.emit("mcp-bridge-request", &event).is_err() {
        {
            let mut pending = state
                .pending
                .lock()
                .map_err(|_| "mcp bridge pending lock poisoned".to_string())?;
            pending.remove(&id);
        }
        return write_json(
            &mut stream,
            503,
            &serde_json::json!({ "ok": false, "error": "GalMail UI is not ready" }),
        )
        .await;
    }

    // Keep the main window awake so approvals can render.
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }

    match timeout(REQUEST_TIMEOUT, rx).await {
        Ok(Ok(response)) => {
            if response.ok {
                write_json(
                    &mut stream,
                    200,
                    &serde_json::json!({
                        "ok": true,
                        "result": response.result.unwrap_or(Value::Null),
                    }),
                )
                .await
            } else {
                write_json(
                    &mut stream,
                    200,
                    &serde_json::json!({
                        "ok": false,
                        "error": response.error.unwrap_or_else(|| "tool failed".into()),
                    }),
                )
                .await
            }
        }
        Ok(Err(_)) => {
            write_json(
                &mut stream,
                504,
                &serde_json::json!({ "ok": false, "error": "bridge response channel closed" }),
            )
            .await
        }
        Err(_) => {
            if let Ok(mut pending) = state.pending.lock() {
                pending.remove(&id);
            }
            write_json(
                &mut stream,
                504,
                &serde_json::json!({ "ok": false, "error": "approval or tool timed out" }),
            )
            .await
        }
    }
}

fn token_allowed(state: &McpBridgeState, token: &str) -> bool {
    let Ok(guard) = state.tokens.lock() else {
        return false;
    };
    !token.is_empty() && guard.contains(token)
}

fn bearer_token(headers: &HashMap<String, String>) -> Option<String> {
    let value = headers.get("authorization")?;
    let rest = value
        .strip_prefix("Bearer ")
        .or_else(|| value.strip_prefix("bearer "))?;
    let trimmed = rest.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn random_id() -> String {
    let mut bytes = [0u8; 8];
    let _ = getrandom::fill(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

async fn read_http_request(
    stream: &mut TcpStream,
) -> Result<(String, String, HashMap<String, String>, Vec<u8>), String> {
    let mut buffer = Vec::with_capacity(8 * 1024);
    let mut chunk = [0u8; 4096];
    let header_end;
    loop {
        let read = stream
            .read(&mut chunk)
            .await
            .map_err(|_| "failed to read MCP bridge request".to_string())?;
        if read == 0 {
            return Err("empty MCP bridge request".into());
        }
        buffer.extend_from_slice(&chunk[..read]);
        if let Some(index) = find_header_end(&buffer) {
            header_end = index;
            break;
        }
        if buffer.len() > 1024 * 1024 {
            return Err("MCP bridge request headers too large".into());
        }
    }

    let header_bytes = &buffer[..header_end];
    let header_text = String::from_utf8_lossy(header_bytes);
    let mut lines = header_text.split("\r\n");
    let request_line = lines.next().unwrap_or_default();
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let path = parts
        .next()
        .unwrap_or("/")
        .split('?')
        .next()
        .unwrap_or("/")
        .to_string();

    let mut headers = HashMap::new();
    let mut content_length = 0usize;
    for line in lines {
        if line.is_empty() {
            continue;
        }
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        let key = name.trim().to_ascii_lowercase();
        let val = value.trim().to_string();
        if key == "content-length" {
            content_length = val.parse().unwrap_or(0);
        }
        headers.insert(key, val);
    }

    let mut body = buffer[header_end + 4..].to_vec();
    while body.len() < content_length {
        let read = stream
            .read(&mut chunk)
            .await
            .map_err(|_| "failed to read MCP bridge body".to_string())?;
        if read == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..read]);
        if body.len() > 8 * 1024 * 1024 {
            return Err("MCP bridge body too large".into());
        }
    }
    body.truncate(content_length);
    Ok((method, path, headers, body))
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

async fn write_json(stream: &mut TcpStream, status: u16, body: &Value) -> Result<(), String> {
    let payload = serde_json::to_vec(body).map_err(|_| "serialize failed".to_string())?;
    let reason = reason_phrase(status);
    let response = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\nAccess-Control-Allow-Origin: *\r\n\r\n",
        payload.len()
    );
    stream
        .write_all(response.as_bytes())
        .await
        .map_err(|_| "failed to write MCP bridge response".to_string())?;
    stream
        .write_all(&payload)
        .await
        .map_err(|_| "failed to write MCP bridge body".to_string())?;
    Ok(())
}

async fn write_text(stream: &mut TcpStream, status: u16, body: &str) -> Result<(), String> {
    let reason = reason_phrase(status);
    let response = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream
        .write_all(response.as_bytes())
        .await
        .map_err(|_| "failed to write MCP bridge response".to_string())
}

fn reason_phrase(status: u16) -> &'static str {
    match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        503 => "Service Unavailable",
        504 => "Gateway Timeout",
        _ => "Error",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_header_terminator() {
        let raw = b"POST /v1/tools/call HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n{}";
        let index = find_header_end(raw).expect("header end");
        assert_eq!(&raw[index..index + 4], b"\r\n\r\n");
    }

    #[test]
    fn bearer_parsing() {
        let mut headers = HashMap::new();
        headers.insert("authorization".into(), "Bearer abc.def".into());
        assert_eq!(bearer_token(&headers).as_deref(), Some("abc.def"));
    }
}
