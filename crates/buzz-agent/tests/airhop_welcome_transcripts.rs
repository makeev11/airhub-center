use std::process::Stdio;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;

const PERSONAS_SOURCE: &str =
    include_str!("../../../desktop/src-tauri/src/managed_agents/personas.rs");

struct Harness {
    child: tokio::process::Child,
    stdin: tokio::process::ChildStdin,
    stdout: BufReader<tokio::process::ChildStdout>,
    next_id: i64,
}

impl Harness {
    async fn spawn(base_url: &str) -> Self {
        let mut command = tokio::process::Command::new(env!("CARGO_BIN_EXE_buzz-agent"));
        command
            .env("BUZZ_AGENT_PROVIDER", "openai")
            .env("OPENAI_COMPAT_API_KEY", "test")
            .env("OPENAI_COMPAT_MODEL", "fake-model")
            .env("OPENAI_COMPAT_BASE_URL", base_url)
            .env("BUZZ_AGENT_LLM_TIMEOUT_SECS", "5")
            .env("BUZZ_AGENT_TOOL_TIMEOUT_SECS", "5")
            .env("BUZZ_AGENT_MAX_ROUNDS", "3")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        let mut child = command.spawn().expect("spawn buzz-agent");
        let stdin = child.stdin.take().expect("agent stdin");
        let stdout = BufReader::new(child.stdout.take().expect("agent stdout"));
        Self {
            child,
            stdin,
            stdout,
            next_id: 1,
        }
    }

    async fn send(&mut self, method: &str, params: Value) -> i64 {
        let id = self.next_id;
        self.next_id += 1;
        let mut frame = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        })
        .to_string();
        frame.push('\n');
        self.stdin
            .write_all(frame.as_bytes())
            .await
            .expect("write frame");
        self.stdin.flush().await.expect("flush frame");
        id
    }

    async fn recv(&mut self) -> Value {
        let mut line = String::new();
        let bytes = tokio::time::timeout(Duration::from_secs(10), self.stdout.read_line(&mut line))
            .await
            .expect("agent response timeout")
            .expect("read agent response");
        assert!(bytes > 0, "agent exited before responding");
        serde_json::from_str(&line).expect("agent JSON response")
    }

    async fn recv_for_id(&mut self, id: i64) -> Value {
        loop {
            let value = self.recv().await;
            if value["id"] == json!(id) {
                return value;
            }
        }
    }

    async fn initialize(&mut self) {
        let id = self
            .send(
                "initialize",
                json!({ "protocolVersion": 2, "clientCapabilities": {} }),
            )
            .await;
        let response = self.recv_for_id(id).await;
        assert_eq!(response["result"]["protocolVersion"], 2);
    }

    async fn new_session(&mut self, system_prompt: &str) -> String {
        let id = self
            .send(
                "session/new",
                json!({
                    "cwd": "/tmp",
                    "mcpServers": [],
                    "systemPrompt": system_prompt,
                }),
            )
            .await;
        self.recv_for_id(id).await["result"]["sessionId"]
            .as_str()
            .expect("session id")
            .to_owned()
    }

    async fn prompt(&mut self, session_id: &str, text: &str) -> Vec<Value> {
        let id = self
            .send(
                "session/prompt",
                json!({
                    "sessionId": session_id,
                    "prompt": [{ "type": "text", "text": text }],
                }),
            )
            .await;
        let mut updates = Vec::new();
        loop {
            let value = self.recv().await;
            if value["id"] == json!(id) {
                assert_eq!(value["result"]["stopReason"], "end_turn");
                return updates;
            }
            if value["method"] == "session/update" {
                updates.push(value["params"]["update"].clone());
            }
        }
    }

    async fn shutdown(mut self) {
        drop(self.stdin);
        let _ = tokio::time::timeout(Duration::from_secs(2), self.child.wait()).await;
        let _ = self.child.start_kill();
    }
}

fn persona_prompt(const_name: &str) -> String {
    let marker = format!("const {const_name}: &str = \"");
    let rest = PERSONAS_SOURCE
        .split_once(&marker)
        .unwrap_or_else(|| panic!("missing persona prompt {const_name}"))
        .1;
    rest.split_once("\";")
        .unwrap_or_else(|| panic!("unterminated persona prompt {const_name}"))
        .0
        .to_owned()
}

fn openai_text(content: &str) -> Value {
    json!({
        "id": "airhop-text",
        "object": "chat.completion",
        "model": "fake-model",
        "choices": [{
            "index": 0,
            "message": { "role": "assistant", "content": content },
            "finish_reason": "stop",
        }],
    })
}

fn openai_tool(name: &str) -> Value {
    json!({
        "id": "airhop-tool",
        "object": "chat.completion",
        "model": "fake-model",
        "choices": [{
            "index": 0,
            "message": {
                "role": "assistant",
                "content": null,
                "tool_calls": [{
                    "id": format!("call-{name}"),
                    "type": "function",
                    "function": {
                        "name": name,
                        "arguments": "{}",
                    },
                }],
            },
            "finish_reason": "tool_calls",
        }],
    })
}

fn request_messages(request: &Value) -> &[Value] {
    request["messages"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

fn message_text<'a>(messages: &'a [Value], role: &str) -> &'a str {
    messages
        .iter()
        .rev()
        .find(|message| message["role"] == role)
        .and_then(|message| message["content"].as_str())
        .unwrap_or("")
}

fn localized_text(user: &str, russian: &str, english: &str, portuguese: &str) -> String {
    if user
        .chars()
        .any(|character| ('А'..='я').contains(&character))
    {
        russian.to_owned()
    } else if user.contains("portugues") || user.contains("horario") {
        portuguese.to_owned()
    } else {
        english.to_owned()
    }
}

fn fake_model_response(request: &Value) -> Value {
    let messages = request_messages(request);
    let system = message_text(messages, "system");
    let user = message_text(messages, "user");
    let used_tool = messages.iter().any(|message| message["role"] == "tool");
    let mirrors_locale = system.contains("Reply in the user's language");
    let final_text = if mirrors_locale {
        localized_text(
            user,
            "Ответ подготовлен по-русски.",
            "The answer is prepared in English.",
            "A resposta foi preparada em portugues.",
        )
    } else {
        "The answer is prepared in English.".to_owned()
    };

    if system.contains("Airhop team lead")
        && system.contains("delegate")
        && system.contains("do not prepare or commit business mutations")
    {
        return if used_tool {
            openai_text(&final_text)
        } else {
            openai_tool("airhop_delegate")
        };
    }
    if system.contains("Airhop Administrator")
        && system.contains("prepare a typed action preview")
        && system.contains("explicit human confirmation")
    {
        return if used_tool {
            openai_text(&final_text)
        } else {
            openai_tool("airhop_prepare_action")
        };
    }
    if system.contains("Airhop Analyst")
        && system.contains("Read authoritative")
        && system.contains("never mutate business data")
    {
        return if used_tool {
            openai_text(&final_text)
        } else {
            openai_tool("airhop_read")
        };
    }
    if system.contains("Airhop Content Marketer")
        && system.contains("must call airhop_propose_site_content")
        && system.contains("immutable HQ preview")
        && system.contains("call airhop_confirm_site_content")
        && system.contains("You cannot confirm your own proposal")
    {
        return if used_tool {
            openai_text(&final_text)
        } else {
            openai_tool("airhop_propose_site_content")
        };
    }

    openai_text("persona contract missing")
}

async fn read_json_request(socket: &mut tokio::net::TcpStream) -> Option<Value> {
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 4096];
    while !buffer.windows(4).any(|window| window == b"\r\n\r\n") {
        let read = socket.read(&mut chunk).await.ok()?;
        if read == 0 || buffer.len() > 1_000_000 {
            return None;
        }
        buffer.extend_from_slice(&chunk[..read]);
    }
    let header_end = buffer.windows(4).position(|window| window == b"\r\n\r\n")? + 4;
    let headers = String::from_utf8_lossy(&buffer[..header_end]);
    let content_length = headers.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        name.eq_ignore_ascii_case("content-length")
            .then(|| value.trim().parse::<usize>().ok())
            .flatten()
    })?;
    let mut body = buffer[header_end..].to_vec();
    while body.len() < content_length {
        let read = socket.read(&mut chunk).await.ok()?;
        if read == 0 {
            return None;
        }
        body.extend_from_slice(&chunk[..read]);
    }
    serde_json::from_slice(&body[..content_length]).ok()
}

async fn spawn_contract_llm() -> String {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind fake LLM");
    let url = format!("http://{}", listener.local_addr().expect("LLM address"));
    tokio::spawn(async move {
        loop {
            let (mut socket, _) = match listener.accept().await {
                Ok(connection) => connection,
                Err(_) => return,
            };
            tokio::spawn(async move {
                let Some(request) = read_json_request(&mut socket).await else {
                    return;
                };
                let body = fake_model_response(&request).to_string();
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body,
                );
                let _ = socket.write_all(response.as_bytes()).await;
                let _ = socket.shutdown().await;
            });
        }
    });
    url
}

fn tool_titles(updates: &[Value]) -> Vec<&str> {
    updates
        .iter()
        .filter(|update| update["sessionUpdate"] == "tool_call")
        .filter_map(|update| update["title"].as_str())
        .collect()
}

fn message_texts(updates: &[Value]) -> Vec<&str> {
    updates
        .iter()
        .filter(|update| update["sessionUpdate"] == "agent_message_chunk")
        .filter_map(|update| update["content"]["text"].as_str())
        .collect()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn airhop_welcome_transcripts() {
    let url = spawn_contract_llm().await;
    let mut harness = Harness::spawn(&url).await;
    harness.initialize().await;

    let personas = [
        ("AIRHOP_FIZZ_SYSTEM_PROMPT", Some("airhop_delegate")),
        (
            "AIRHOP_ADMINISTRATOR_SYSTEM_PROMPT",
            Some("airhop_prepare_action"),
        ),
        ("AIRHOP_ANALYST_SYSTEM_PROMPT", Some("airhop_read")),
        (
            "AIRHOP_CONTENT_MARKETER_SYSTEM_PROMPT",
            Some("airhop_propose_site_content"),
        ),
    ];
    let locales = [
        (
            "Нужно обновить расписание и объяснить результат.",
            "русски",
            "недоступна",
        ),
        (
            "Please update the schedule and explain the result.",
            "English",
            "not available",
        ),
        (
            "Atualize o horario e explique o resultado em portugues.",
            "portugues",
            "nao esta disponivel",
        ),
    ];

    for (prompt_name, expected_tool) in personas {
        let prompt = persona_prompt(prompt_name);
        let normalized = prompt.to_lowercase();
        assert!(!normalized.contains("hermes"));
        assert!(!normalized.contains("persistent organization memory"));

        for (user, locale_marker, unavailable_marker) in locales {
            let session_id = harness.new_session(&prompt).await;
            let updates = harness.prompt(&session_id, user).await;
            let tools = tool_titles(&updates);
            let messages = message_texts(&updates);

            match expected_tool {
                Some(tool) => assert_eq!(tools, vec![tool], "{prompt_name} / {user}"),
                None => {
                    assert!(tools.is_empty(), "{prompt_name} must not call a tool");
                }
            }
            assert_eq!(messages.len(), 1, "{prompt_name} / {user}");
            let marker = if expected_tool.is_some() {
                locale_marker
            } else {
                unavailable_marker
            };
            assert!(
                messages[0].contains(marker),
                "{prompt_name} did not preserve locale: {}",
                messages[0],
            );
            assert!(!messages[0].to_lowercase().contains("hermes"));
            assert!(!messages[0].contains("persistent organization memory"));
        }
    }

    harness.shutdown().await;
}
