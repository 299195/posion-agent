# 配置与部署教程

本项目是单机、本地 HTTP 演示程序；默认仅监听 `127.0.0.1`。本页说明如何生成材料、配置 Qwen 兼容接口、运行回归检查，以及如何安全地发布或清理本地数据。

## 1. 安装依赖

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

依赖只有：

- `reportlab`：生成可复现的教学 PDF；
- `pypdf`：读取 PDF 页面文本和文档属性。

## 2. 生成十份内置作业

```powershell
python scripts\generate_demo_pdfs.py
```

该命令根据 `config/rubric.json` 与 `config/submissions.json` 写入：

- `output/pdf/2026110101-张晓雨.pdf` 至 `2026110110-郑凯文.pdf`；
- `output/pdf/网络与智能系统安全-评分标准.pdf`。

PDF 是可再生生成物，因此不提交到 Git。服务启动时从 `output/pdf/` 读取文件；前端的“内置作业”列表来自 `config/submissions.json`。

### 字体设置

默认生成脚本使用 Windows 的 `C:\Windows\Fonts\msyh.ttc`。如果字体位于其他位置，请在运行生成脚本前设置：

```powershell
$env:PDF_DEMO_FONT_PATH = "D:\fonts\your-chinese-font.ttc"
python scripts\generate_demo_pdfs.py
```

> 当前版本的生成脚本仍以 Windows 为主要目标；如需 macOS/Linux 支持，请替换为本机可用的中文 TrueType Collection 字体，并在改动后重新运行回归检查。

## 3. 启动方式

### 推荐：PowerShell 启动脚本

```powershell
.\start_demo.ps1
```

脚本会检查依赖、补生成缺少的 PDF，并在默认浏览器打开服务。

常用参数：

```powershell
# 不自动打开浏览器
.\start_demo.ps1 -NoBrowser

# 改用其他本地端口
.\start_demo.ps1 -Port 8878
```

### 直接启动 Python 服务

```powershell
python app.py --host 127.0.0.1 --port 8765
```

不要把 `--host` 改为公共网卡地址来暴露带有教学缺陷配置的服务。

## 4. Qwen 兼容接口配置

服务按下列优先级读取环境变量：

| 用途 | 依次读取 | 默认值 |
| --- | --- | --- |
| API Key | `QWEN_API_KEY` → `DASHSCOPE_API_KEY` → `LLM_API_KEY` | 无 |
| 基础地址 | `QWEN_PAID_BASE_URL` → `DASHSCOPE_BASE_URL` → `LLM_BASE_URL` | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| 模型名称 | `QWEN_PAID_MODEL` → `DASHSCOPE_MODEL` → `LLM_MODEL` | `qwen3.5-flash` |
| 单次请求超时 | `QWEN_REQUEST_TIMEOUT` | `180` 秒，限制在 30–300 秒 |
| 最大尝试次数 | `QWEN_REQUEST_RETRIES` | `3` 次，限制在 1–4 次 |

示例（仅影响当前 PowerShell 窗口）：

```powershell
$env:QWEN_API_KEY = "你的密钥"
$env:QWEN_PAID_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
$env:QWEN_PAID_MODEL = "qwen3.5-flash"
$env:QWEN_REQUEST_TIMEOUT = "180"
$env:QWEN_REQUEST_RETRIES = "3"
```

`.env.example` 仅用于记录变量名；程序不会自动加载 `.env` 文件。请使用受控的系统环境变量、CI 密钥存储或当前终端会话设置真实密钥。

## 5. 前端后端模式说明

| 模式 | 是否请求外部模型 | 用途 | 能否算作真实模型结果 |
| --- | --- | --- | --- |
| 真实 Qwen（标准评分） | 是 | 正常逐题评分 | 可以，但必须满足界面中的完整判据 |
| 真实 Qwen（易受注入教学配置） | 是 | 仅用于隔离课堂中复现来源混淆风险 | 可以，但只适用于合成材料和明确记录的配置 |
| 离线彩排 | 否 | 展示可重复的本地执行链路 | 不可以 |
| Qwen 故障降级 | 仅在前序请求失败后 | 保持批改流程可用 | 不可以 |

真实模型请求会自动重试。若所有尝试失败，服务返回带有 `model_fallback` 标志的本地结果，而非把降级结果包装为真实模型行为。

## 6. 修改评分标准或样本目录

1. 编辑 `config/rubric.json` 中题目、分值和判据；总分应保持为 100。
2. 编辑 `config/submissions.json` 中样本元数据和合成场景标签。
3. 运行 `python scripts\generate_demo_pdfs.py` 重新生成 PDF。
4. 运行 `python scripts\run_regression.py`。
5. 在前端刷新后，通过“内置作业”检查 P01–P10 是否都可选。

不要仅靠文件名识别上传文件。服务会先做 SHA-256 目录匹配；不匹配时则依据提取文本和文档属性自动形成分析档案。

## 7. 回归检查

```powershell
# 不调用外部接口
python scripts\run_regression.py

# 仅在拥有授权 API Key 的隔离环境中调用真实模型
python scripts\run_regression.py --live --sample P07 --backend model_vulnerable
```

静态检查验证：每份内置 PDF 是否有预期载荷命中、目标分是否正确、以及是否匹配 SHA-256 样本档案。真实模型检查额外验证八道题、逐题合计、工具参数和登记分数的关系。

## 8. 本地数据与清理

| 路径 | 内容 | 是否应提交 |
| --- | --- | --- |
| `data/demo.sqlite3` | 本地运行、成绩和审计证据 | 否 |
| `data/uploads/` | 用户上传的 PDF 副本 | 否 |
| `output/pdf/` | 可再生 PDF | 否 |
| `tmp/` | 渲染、截图和服务日志 | 否 |

前端的删除按钮会删除一条对话关联的运行、成绩和证据行，但为避免影响别的对话，不会删除磁盘上的上传 PDF。需要清空整个演示状态时，请在关闭服务后手动删除 `data/` 目录；这会不可逆地删除本地记录。

## 9. 发布前检查

```powershell
python -m py_compile app.py scripts\run_regression.py
node --check static\app.js
python scripts\run_regression.py
git status --short
```

确认状态中没有 `.env`、`data/`、`tmp/`、`output/pdf/` 或真实学生材料，再提交并推送。
