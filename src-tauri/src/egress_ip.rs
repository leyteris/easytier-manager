use serde::Serialize;
use std::net::IpAddr;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri_plugin_http::reqwest;

/// 本机通过系统路由访问检测服务时的公网出口快照。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EgressIp {
    ip: String,
    family: &'static str,
    source: String,
    checked_at: u64,
}

/// 解析服务响应并排除内网、回环等明显不是公网出口的地址。
fn parse_ip(body: &str, trace: bool) -> Result<IpAddr, String> {
    let value = if trace {
        body.lines()
            .find_map(|line| line.trim().strip_prefix("ip="))
            .ok_or("Cloudflare 响应缺少 IP")?
    } else {
        body.trim()
    };
    let ip: IpAddr = value.parse().map_err(|_| "响应不是有效 IP 地址")?;
    let valid = match ip {
        IpAddr::V4(v4) => {
            let bytes = v4.octets();
            !v4.is_private()
                && !v4.is_loopback()
                && !v4.is_link_local()
                && !v4.is_unspecified()
                && !v4.is_multicast()
                && !v4.is_broadcast()
                && !v4.is_documentation()
                && bytes[0] != 0
                && bytes[0] < 240
                && !(bytes[0] == 100 && (64..=127).contains(&bytes[1]))
        }
        IpAddr::V6(v6) => {
            !v6.is_loopback()
                && !v6.is_unspecified()
                && !v6.is_multicast()
                && !v6.is_unique_local()
                && !v6.is_unicast_link_local()
                && v6.to_ipv4_mapped().is_none()
                && !(v6.segments()[0] == 0x2001 && v6.segments()[1] == 0xdb8)
        }
    };
    if !valid {
        return Err("检测服务返回了非公网地址".into());
    }
    Ok(ip)
}

/// 依次查询固定服务；每次请求限时并限制响应大小，失败才使用下一服务。
async fn query_sources(sources: &[(&str, &str, bool)]) -> Result<EgressIp, String> {
    let client = reqwest::Client::builder()
        // 明确绕过 HTTP/SOCKS 代理，但保留系统路由、VPN 和 TUN 的实际转发路径。
        .no_proxy()
        .timeout(Duration::from_secs(8))
        .connect_timeout(Duration::from_secs(4))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "无法初始化出口查询客户端")?;
    let mut failures = Vec::new();
    for (source, url, trace) in sources {
        let result = async {
            let mut response = client
                .get(*url)
                .header("Cache-Control", "no-cache")
                .send()
                .await
                .map_err(|_| "请求失败或超时")?
                .error_for_status()
                .map_err(|_| "服务返回错误状态")?;
            let mut body = Vec::new();
            while let Some(chunk) = response.chunk().await.map_err(|_| "响应读取失败")? {
                if body.len() + chunk.len() > 8192 {
                    return Err("响应超过大小限制");
                }
                body.extend_from_slice(&chunk);
            }
            let text = std::str::from_utf8(&body).map_err(|_| "响应编码无效")?;
            parse_ip(text, *trace).map_err(|_| "服务未返回有效公网 IP")
        }
        .await;
        match result {
            Ok(ip) => {
                return Ok(EgressIp {
                    ip: ip.to_string(),
                    family: if ip.is_ipv4() { "IPv4" } else { "IPv6" },
                    source: source.to_string(),
                    checked_at: SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as u64,
                })
            }
            Err(reason) => failures.push(format!("{source}：{reason}")),
        }
    }
    Err(failures.join("；"))
}

/// 手动获取系统路由出口，Cloudflare 优先，Amazon AWS 兜底。
#[tauri::command]
pub async fn query_egress_ip() -> Result<EgressIp, String> {
    query_sources(&[
        (
            "Cloudflare",
            "https://www.cloudflare.com/cdn-cgi/trace",
            true,
        ),
        ("Amazon AWS", "https://checkip.amazonaws.com", false),
    ])
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    /// 显式运行的公网烟测，只断言结果有效，不输出用户公网地址。
    #[test]
    #[ignore = "需要访问 Cloudflare 或 Amazon AWS"]
    fn live_query_returns_public_ip() {
        let result = tauri::async_runtime::block_on(query_egress_ip()).unwrap();
        assert!(parse_ip(&result.ip, false).is_ok());
        assert!(result.source == "Cloudflare" || result.source == "Amazon AWS");
    }

    /// 覆盖两种响应格式、IPv6 和无效响应，避免将错误网页显示成 IP。
    #[test]
    fn parses_provider_responses() {
        assert_eq!(
            parse_ip("fl=test\nip=8.8.8.8\ncolo=SJC\n", true)
                .unwrap()
                .to_string(),
            "8.8.8.8"
        );
        assert_eq!(
            parse_ip(" 1.1.1.1\n", false).unwrap().to_string(),
            "1.1.1.1"
        );
        assert!(parse_ip("ip=2606:4700:4700::1111\n", true)
            .unwrap()
            .is_ipv6());
        for value in [
            "<html>error</html>",
            "127.0.0.1",
            "192.168.1.1",
            "100.64.0.1",
            "::1",
            "fe80::1",
        ] {
            assert!(parse_ip(value, false).is_err());
        }
        assert!(parse_ip("colo=SJC", true).is_err());
    }

    /// 用本地模拟响应验证首选服务解析失败后确实调用备用服务，不依赖公网。
    #[test]
    fn falls_back_after_invalid_primary_response() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            for body in ["invalid", "1.1.1.1\n"] {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut request = [0; 2048];
                let _ = stream.read(&mut request).unwrap();
                write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                )
                .unwrap();
            }
        });
        let url = format!("http://{address}");
        let result = tauri::async_runtime::block_on(query_sources(&[
            ("Cloudflare", &url, true),
            ("Amazon AWS", &url, false),
        ]))
        .unwrap();
        assert_eq!(result.source, "Amazon AWS");
        assert_eq!(result.ip, "1.1.1.1");
        server.join().unwrap();
    }
}
