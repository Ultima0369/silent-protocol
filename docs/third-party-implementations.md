# 第三方实现指南

> 如何用 Python、Go、Rust 实现 Silent Protocol 客户端。
> 本指南定义协议的最小实现要求，并提供各语言参考代码。

---

## 协议最小实现

任何语言的 Silent Protocol 实现至少需要提供：

```
1. 消息类型定义      → Message struct/class
2. JSON 编解码器     → encode(m) → bytes, decode(bytes) → Message
3. （可选）Binary 编解码器 → 紧凑二进制格式
4. HTTP 传输层      → POST /api/v1/message 发送，GET /api/v1/pending/:agent 接收
```

### 消息结构

```json
{
  "ver": 1,
  "id": "msg_1716000000_1",
  "from": "cloud_ds",
  "to": "local_claude",
  "type": "exec",
  "payload": { "cmd": "echo hi" },
  "callback": false,
  "ts": 1716000000
}
```

### 标准 Agent

```
cloud_ds, local_claude, cloud_claude, user, neca
```

### 标准消息类型

```
ping, pong, exec, read, write, search, delegate,
query, report, cancel, error, ack, init
```

---

## Python 实现

### 最小实现（~80 行）

```python
"""silent_protocol.py — Silent Protocol 最小 Python 实现"""
import json
import time
from dataclasses import dataclass, field
from typing import Any, Optional
from urllib.request import Request, urlopen

STANDARD_AGENTS = ['cloud_ds', 'local_claude', 'cloud_claude', 'user', 'neca']
STANDARD_TYPES  = ['ping','pong','exec','read','write','search','delegate',
                   'query','report','cancel','error','ack','init']

_msg_counter = 0

@dataclass
class Message:
    ver: int = 1
    id: str = ""
    from_: str = "cloud_ds"
    to: str = "local_claude"
    type: str = "ping"
    payload: dict = field(default_factory=dict)
    callback: bool = False
    ts: int = 0

    def __post_init__(self):
        global _msg_counter
        if not self.id:
            _msg_counter += 1
            self.id = f"msg_{int(time.time()*1000)}_{_msg_counter}"
        if not self.ts:
            self.ts = int(time.time())

    def encode(self) -> bytes:
        return json.dumps({
            "ver": self.ver, "id": self.id,
            "from": self.from_, "to": self.to,
            "type": self.type, "payload": self.payload,
            "callback": self.callback, "ts": self.ts
        }).encode('utf-8')

    @classmethod
    def decode(cls, data: bytes) -> Optional['Message']:
        try:
            obj = json.loads(data.decode('utf-8'))
            if not isinstance(obj, dict): return None
            return cls(
                ver=obj.get('ver', 1),
                id=obj.get('id', ''),
                from_=obj.get('from', ''),
                to=obj.get('to', ''),
                type=obj.get('type', ''),
                payload=obj.get('payload', {}),
                callback=obj.get('callback', False),
                ts=obj.get('ts', 0),
            )
        except: return None

class Neca2Client:
    def __init__(self, base_url: str = "http://localhost:3101"):
        self.base_url = base_url.rstrip('/')

    def send(self, msg: Message) -> dict:
        data = msg.encode()
        req = Request(
            f"{self.base_url}/api/v1/message",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urlopen(req) as resp:
            return json.loads(resp.read().decode('utf-8'))

    def poll_pending(self, agent: str = "cloud_ds") -> list:
        req = Request(f"{self.base_url}/api/v1/pending/{agent}")
        with urlopen(req) as resp:
            return json.loads(resp.read().decode('utf-8'))

# 使用示例
if __name__ == "__main__":
    client = Neca2Client()
    msg = Message(to="local_claude", type="exec",
                  payload={"cmd": "echo 'Hello from Python!'"})
    result = client.send(msg)
    print(f"Sent: {msg.id}")
    print(f"Session: {result}")
```

---

## Go 实现

### 最小实现（~120 行）

```go
// silent.go — Silent Protocol 最小 Go 实现
package main

import (
    "bytes"
    "encoding/json"
    "fmt"
    "io"
    "net/http"
    "time"
)

// --- 类型定义 ---

var standardAgents = []string{"cloud_ds", "local_claude", "cloud_claude", "user", "neca"}
var standardTypes  = []string{"ping","pong","exec","read","write","search","delegate",
                               "query","report","cancel","error","ack","init"}

type Message struct {
    Ver      int                    `json:"ver"`
    ID       string                 `json:"id"`
    From     string                 `json:"from"`
    To       string                 `json:"to"`
    Type     string                 `json:"type"`
    Payload  map[string]interface{} `json:"payload"`
    Callback bool                   `json:"callback"`
    Ts       int64                  `json:"ts"`
}

func NewMessage(to, msgType string, payload map[string]interface{}) *Message {
    return &Message{
        Ver: 1,
        ID:  fmt.Sprintf("msg_%d", time.Now().UnixMilli()),
        From: "cloud_ds",
        To: to,
        Type: msgType,
        Payload: payload,
        Ts: time.Now().Unix(),
    }
}

func (m *Message) Encode() ([]byte, error) {
    return json.Marshal(m)
}

func DecodeMessage(data []byte) (*Message, error) {
    var msg Message
    if err := json.Unmarshal(data, &msg); err != nil {
        return nil, err
    }
    return &msg, nil
}

// --- HTTP 客户端 ---

type Client struct {
    BaseURL string
    HTTP    *http.Client
}

func NewClient(baseURL string) *Client {
    return &Client{
        BaseURL: baseURL,
        HTTP:    &http.Client{Timeout: 30 * time.Second},
    }
}

func (c *Client) Send(msg *Message) (map[string]interface{}, error) {
    data, err := msg.Encode()
    if err != nil { return nil, err }

    resp, err := c.HTTP.Post(
        c.BaseURL+"/api/v1/message",
        "application/json",
        bytes.NewReader(data),
    )
    if err != nil { return nil, err }
    defer resp.Body.Close()

    body, _ := io.ReadAll(resp.Body)
    var result map[string]interface{}
    json.Unmarshal(body, &result)
    return result, nil
}

func (c *Client) PollPending(agent string) ([]interface{}, error) {
    resp, err := c.HTTP.Get(c.BaseURL + "/api/v1/pending/" + agent)
    if err != nil { return nil, err }
    defer resp.Body.Close()

    body, _ := io.ReadAll(resp.Body)
    var result map[string]interface{}
    json.Unmarshal(body, &result)
    messages, _ := result["messages"].([]interface{})
    return messages, nil
}
```

---

## Rust 实现

### 最小实现（~150 行）

```rust
// silent_protocol.rs — Silent Protocol 最小 Rust 实现
use serde::{Serialize, Deserialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

// --- 类型定义 ---

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Message {
    pub ver: u32,
    pub id: String,
    #[serde(rename = "from")]
    pub from: String,
    pub to: String,
    #[serde(rename = "type")]
    pub msg_type: String,
    pub payload: HashMap<String, Value>,
    pub callback: bool,
    pub ts: u64,
}

impl Message {
    pub fn new(to: &str, msg_type: &str,
               payload: HashMap<String, Value>) -> Self {
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH).unwrap().as_secs();
        Self {
            ver: 1,
            id: format!("msg_{}", ts),
            from: "cloud_ds".to_string(),
            to: to.to_string(),
            msg_type: msg_type.to_string(),
            payload,
            callback: false,
            ts,
        }
    }

    pub fn encode(&self) -> Result<Vec<u8>, serde_json::Error> {
        serde_json::to_vec(self)
    }

    pub fn decode(data: &[u8]) -> Result<Self, serde_json::Error> {
        serde_json::from_slice(data)
    }
}

// --- HTTP 客户端 ---

pub struct Client {
    base_url: String,
    client: reqwest::Client,
}

impl Client {
    pub fn new(base_url: &str) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            client: reqwest::Client::new(),
        }
    }

    pub async fn send(&self, msg: &Message) -> Result<Value, reqwest::Error> {
        let resp = self.client
            .post(format!("{}/api/v1/message", self.base_url))
            .json(msg)
            .send()
            .await?;
        resp.json().await
    }

    pub async fn poll_pending(&self, agent: &str)
        -> Result<Vec<Message>, reqwest::Error>
    {
        let resp = self.client
            .get(format!("{}/api/v1/pending/{}", self.base_url, agent))
            .send()
            .await?;
        let result: Value = resp.json().await?;
        let messages = result["messages"].as_array()
            .map(|arr| {
                arr.iter().filter_map(|v| {
                    serde_json::from_value(v.clone()).ok()
                }).collect()
            })
            .unwrap_or_default();
        Ok(messages)
    }
}
```

---

## 编解码器实现要求

| 要求 | 说明 |
|------|------|
| JSON 编解码 | 必须支持，作为最低兼容格式 |
| Binary 编解码 | 可选，推荐实现以节省带宽 |
| 错误处理 | decode 失败必须返回错误，不能 panic |
| 消息校验 | From/to 必须是标准 agent，type 必须是标准类型 |
| 时间戳 | 必须填充 ts 字段（Unix 秒级时间戳） |

## 测试你的实现

运行以下命令验证你的实现是否符合协议：

```bash
# 启动 neca2 服务器
cd neca2 && npm start

# 用你的实现发送一条 exec 消息
python client.py  # 或 go run client.go, cargo run

# 验证服务器日志
cat ~/.neca2/neca2.log

# 运行合规性检查
npx tsx src/cli.ts compliance
```

## 贡献你的实现

实现了一个新的语言客户端？欢迎贡献到本仓库！

1. 在 `implementations/` 目录下创建子目录
2. 包含 README.md 介绍安装和使用方法
3. 包含至少一个端到端测试
4. 提交 PR → 见 [CONTRIBUTING.md](../CONTRIBUTING.md)

## 参考

- [紧凑协议规范](../spec/compact-protocol-spec.md)
- [四方协作架构](../spec/quad-party-architecture.md)
- [neca2 源码](https://github.com/Ultima0369/silent-protocol/tree/main/neca2)
