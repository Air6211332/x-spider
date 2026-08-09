use reqwest::Method;
use serde_json::Value;
use std::collections::HashMap;
use std::env;

#[derive(Default, serde::Serialize)]
pub struct Response {
  status: u16,
  headers: HashMap<String, Vec<String>>,
  body: Value,
}

#[tauri::command]
pub async fn network_fetch(
  method: String,
  url: String,
  body: String,
  enable_proxy: bool,
  proxy_url: String,
  response_type: String,
  headers: HashMap<String, String>,
) -> Result<Response, String> {
  let map_reqwest_err = |err: reqwest::Error| err.to_string();
  // Convert method string into Method
  let method: Method = match method.to_uppercase().as_str() {
    "GET" => Ok(Method::GET),
    "POST" => Ok(Method::POST),
    "PATCH" => Ok(Method::PATCH),
    "PUT" => Ok(Method::PUT),
    "DELETE" => Ok(Method::DELETE),
    "HEAD" => Ok(Method::HEAD),
    _ => Err("Invalid method".to_string()),
  }?;

  // Build client
  let client = {
    let mut b = reqwest::Client::builder();

    // Auto set proxy settings
    if enable_proxy {
      if proxy_url.len() == 0 {
        // Use system proxy, do nothing
      } else {
        // Use custom proxy url
        let proxy_http =
          reqwest::Proxy::http(proxy_url.clone()).or(Err("Failed to set proxy url".to_string()))?;
        let proxy_https =
          reqwest::Proxy::https(proxy_url.clone()).or(Err("Failed to set proxy url".to_string()))?;
        b = b.proxy(proxy_http).proxy(proxy_https);
      }
    } else {
      // No proxy
      b = b.no_proxy();
    }

    b.build().or(Err("Failed to build reqwest client".to_string()))
  }?;

  // Build request
  let request = {
    let mut req = client.request(method.clone(), url);
    for (k, v) in headers {
      req = req.header(k, v);
    }

    if !matches!(method.clone(), Method::GET) {
      req = req.body(body);
    }

    req
  };

  // Send request
  let response = request.send().await.map_err(map_reqwest_err)?;

  // Extract some info
  let status = response.status().as_u16();
  let resp_headers = {
    let reqwest_headers = response.headers();
    let mut h: HashMap<String, Vec<String>> = HashMap::with_capacity(reqwest_headers.len());

    for (k, v) in reqwest_headers {
      let v = v.to_str();
      if let Err(_) = v {
        continue;
      }

      let v = v.unwrap().to_string();
      h.entry(k.to_string())
        .and_modify(|arr: &mut Vec<String>| arr.push(v.clone()))
        .or_insert_with(|| vec![v]);
    }

    h
  };

  // Load response body
  let body: Value = {
    match response_type.as_str() {
      "json" => response
        .json::<Value>()
        .await
        .map_err(map_reqwest_err),
      "text" => response
        .text()
        .await
        .map_err(map_reqwest_err)
        .map(|res| Value::String(res)),
      "binary" => {
        let bytes = response.bytes().await.map_err(map_reqwest_err)?;
        serde_json::to_value(bytes.to_vec()).map_err(|err| err.to_string())
      }
      _ => Err("Unsupported response type".to_string()),
    }
  }?;

  return Ok(Response {
    status,
    body,
    headers: resp_headers,
  });
}

/// 将代理 URL 规范为 host:port（供前端拼 http://）
fn normalize_proxy_host(raw: &str) -> Option<String> {
  let trimmed = raw.trim();
  if trimmed.is_empty() {
    return None;
  }

  let without_scheme = trimmed
    .strip_prefix("http://")
    .or_else(|| trimmed.strip_prefix("https://"))
    .or_else(|| trimmed.strip_prefix("socks5://"))
    .or_else(|| trimmed.strip_prefix("socks4://"))
    .unwrap_or(trimmed);

  let host = without_scheme.split('@').last().unwrap_or(without_scheme);
  let host = host.trim_end_matches('/');
  if host.is_empty() {
    None
  } else {
    Some(host.to_string())
  }
}

/// 从环境变量读取代理
fn proxies_from_env() -> HashMap<String, String> {
  let mut map = HashMap::new();

  let https = env::var("HTTPS_PROXY")
    .or_else(|_| env::var("https_proxy"))
    .ok()
    .and_then(|v| normalize_proxy_host(&v));
  let http = env::var("HTTP_PROXY")
    .or_else(|_| env::var("http_proxy"))
    .ok()
    .and_then(|v| normalize_proxy_host(&v));
  let all = env::var("ALL_PROXY")
    .or_else(|_| env::var("all_proxy"))
    .ok()
    .and_then(|v| normalize_proxy_host(&v));

  if let Some(v) = https.or_else(|| all.clone()) {
    map.insert("https".to_string(), v);
  }
  if let Some(v) = http.or(all) {
    map.insert("http".to_string(), v);
  }

  map
}

/// 解析 Windows Internet Settings 的 ProxyServer 字符串
fn parse_windows_proxy_server(proxy_server: &str) -> HashMap<String, String> {
  let mut map = HashMap::new();

  if proxy_server.contains('=') {
    for part in proxy_server.split(';') {
      let mut kv = part.splitn(2, '=');
      let key = kv.next().unwrap_or("").trim().to_lowercase();
      let value = kv.next().unwrap_or("").trim();
      if let Some(host) = normalize_proxy_host(value) {
        if key == "http" || key == "https" {
          map.insert(key, host);
        } else if key == "socks" || key == "socks5" {
          map.entry("http".to_string()).or_insert(host.clone());
          map.entry("https".to_string()).or_insert(host);
        }
      }
    }
  } else if let Some(host) = normalize_proxy_host(proxy_server) {
    map.insert("http".to_string(), host.clone());
    map.insert("https".to_string(), host);
  }

  map
}

/// 从 Windows 注册表读取系统代理
#[cfg(windows)]
fn proxies_from_windows_registry() -> HashMap<String, String> {
  use winreg::enums::HKEY_CURRENT_USER;
  use winreg::RegKey;

  let hkcu = RegKey::predef(HKEY_CURRENT_USER);
  let Ok(settings) =
    hkcu.open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings")
  else {
    return HashMap::new();
  };

  let proxy_enable: u32 = settings.get_value("ProxyEnable").unwrap_or(0);
  if proxy_enable == 0 {
    return HashMap::new();
  }

  let proxy_server: String = match settings.get_value("ProxyServer") {
    Ok(v) => v,
    Err(_) => return HashMap::new(),
  };

  parse_windows_proxy_server(&proxy_server)
}

#[cfg(not(windows))]
fn proxies_from_windows_registry() -> HashMap<String, String> {
  HashMap::new()
}

#[tauri::command]
pub async fn network_get_system_proxy_url() -> Result<HashMap<String, String>, ()> {
  // 优先环境变量，其次 Windows 系统代理
  let mut mapped = proxies_from_env();
  if mapped.is_empty() {
    mapped = proxies_from_windows_registry();
  }
  Ok(mapped)
}
