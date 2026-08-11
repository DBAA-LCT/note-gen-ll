use reqwest::header::ACCEPT;
use serde::Serialize;
use serde_json::Value;
use std::time::Duration;

const MAIMEMO_API_BASE: &str = "https://open.maimemo.com/open";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaimemoResponse {
    status: u16,
    body: String,
}

#[tauri::command]
pub async fn maimemo_request(
    path: String,
    method: String,
    body: Option<Value>,
    token: String,
) -> Result<MaimemoResponse, String> {
    if !path.starts_with("/api/v1/memo/") && !path.starts_with("/api/v1/markji/") {
        return Err("Unsupported Maimemo API endpoint".to_string());
    }
    if token.trim().is_empty() {
        return Err("Maimemo access token is required".to_string());
    }

    let method = match method.as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        _ => return Err("Unsupported Maimemo HTTP method".to_string()),
    };
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent("NoteGoal/0.1")
        .build()
        .map_err(|error| format!("Failed to create Maimemo HTTP client: {error}"))?;
    let mut request = client
        .request(method, format!("{MAIMEMO_API_BASE}{path}"))
        .header(ACCEPT, "application/json")
        .bearer_auth(token.trim());
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request
        .send()
        .await
        .map_err(|error| format!("Maimemo request failed: {error}"))?;
    let status = response.status().as_u16();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Failed to read Maimemo response: {error}"))?;
    Ok(MaimemoResponse { status, body })
}
