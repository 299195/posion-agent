# 课程作业智能批改中心：PDF 间接提示注入教学演示

一个用于**隔离课堂、软件安全教学和防御评估**的本地演示项目。它模拟“学生 PDF → 文本/元数据提取 → 评分 Agent → 成绩登记”的作业批改链路，并将文档中的可疑结果操纵内容、模型评分、工具请求和 SQLite 登记结果分别展示出来。

> 本仓库仅包含合成作业、合成身份和本地审计数据结构。请勿用于真实学生成绩、生产成绩系统或未授权的模型安全测试。

## 能做什么

- 前端内置 10 份合成作业（P01–P10），可直接选择、叠加到同一对话或逐份取消。
- 支持上传额外 PDF；上传后立即提取文本、文档属性和可疑模式，而不依赖文件名猜测类型。
- 使用固定评分标准逐题评分，展示模型逐题合计、`record_grade` 工具参数与 SQLite 最终登记成绩。
- 保留一条完整对话对应一条左侧历史记录；可以在界面中确认后删除整条对话及其本地审计记录。
- 演示界面默认进入带有明确标识的教学演示模式；安全防御与离线彩排逻辑保留用于回归和故障降级。
- 内置 SHA-256 样本档案和静态回归脚本，核验十份 PDF 的提取载荷、目标分与样本身份。

## 证据边界

界面与代码刻意分开记录四个值：

| 字段 | 含义 |
| --- | --- |
| 模型逐题合计 | 八道题得分之和 |
| 模型 `total` | 模型结构化输出中的总分，程序会校正为逐题之和 |
| 工具请求 | `record_grade.score` 的候选参数 |
| 实际登记成绩 | 写入本地 SQLite 成绩册的分数 |

“检测到载荷”不等于“模型受影响”。只有真实模型请求完成、工具参数与目标命中、且工具参数偏离逐题合计时，教学界面才会标为一次真实模型影响事件。离线彩排和网络故障降级不会被计为真实模型结果。

## 快速开始（Windows PowerShell）

前置条件：Python 3.11+，以及可访问的 Qwen 兼容接口（真实模型模式才需要）。

```powershell
git clone https://github.com/299195/posion-agent.git
Set-Location posion-agent

py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt

# 首次生成 10 份合成作业 PDF 和评分标准 PDF
python scripts\generate_demo_pdfs.py

# 离线彩排：不调用外部模型
.\start_demo.ps1 -NoBrowser
```

浏览器打开 <http://127.0.0.1:8765>。点击顶部“内置作业”即可选中 P01–P10；输入框左侧的“+”用于添加本地 PDF。

也可以让启动脚本在缺少生成物时自动生成：

```powershell
.\start_demo.ps1
```

## 配置真实 Qwen 模型

项目只从环境变量读取密钥，**不会读取、写入或提交 `.env` 中的密钥**。当前 PowerShell 会话可这样设置：

```powershell
$env:QWEN_API_KEY = "在此填入你的密钥"
$env:QWEN_PAID_MODEL = "qwen3.5-flash"
$env:QWEN_PAID_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
.\start_demo.ps1
```

页面默认进入“教学演示模式（来源隔离缺陷）”，仅用于本地合成的 P01–P10，并在批改页持续显示边界提示。页面不提供模式切换控件；安全防御与离线彩排逻辑保留在代码中，用于回归检查和外部模型不可用时的故障降级。

完整变量优先级、超时重试、离线模式和常见问题见 [配置教程](docs/CONFIGURATION.md)。

## 验证

静态回归检查不会访问外部模型：

```powershell
python scripts\run_regression.py
```

预期结果是 `static_passed: true`，并列出 P01–P10 的提取命中数、目标分和 SHA-256 档案状态。

在拥有 API Key、且只在隔离教学环境中时，可额外运行一次真实模型检查：

```powershell
python scripts\run_regression.py --live --sample P07 --backend model_vulnerable
```

这会写入本地 `data/demo.sqlite3`；该目录已被 Git 忽略。

## 项目结构

```text
app.py                         本地 HTTP 服务、PDF 解析、模型调用和审计记录
config/rubric.json             固定评分标准
config/submissions.json        P01–P10 的合成样本目录与预期教学标签
scripts/generate_demo_pdfs.py  可复现生成 PDF 与评分标准
scripts/run_regression.py      静态/可选真实模型回归检查
static/                        前端界面
作业PDF与评分标准/             本地教学材料说明（PDF 生成物不纳入版本控制）
data/                          本地 SQLite、上传缓存（不纳入版本控制）
output/pdf/                   可再生 PDF 生成物（不纳入版本控制）
```

## 安全与隐私

- 不要提交 API Key、真实学生作业、真实姓名、成绩册或 `data/` 目录。
- 不要将“易受注入教学配置”接入生产服务；生产场景应把评分规则、工具权限和学生文档放在不同信任边界中。
- 若要分享截图或实验记录，请先核对其中不含密钥、上传文件名或真实个人信息。
- 本项目展示的是一个受控的教学链路，不是绕过检测、隐藏载荷或攻击真实系统的工具。

## 常见问题

| 现象 | 处理方式 |
| --- | --- |
| 提示找不到 PDF | 运行 `python scripts\generate_demo_pdfs.py`，或直接运行 `./start_demo.ps1`。 |
| 端口被占用 | 使用 `./start_demo.ps1 -Port 8878`。 |
| 真实模型超时 | 默认最多重试 3 次；仍失败时程序会标注为本地降级结果，而不是报为真实模型成功。 |
| PDF 生成时报字体错误 | 默认针对 Windows 的“微软雅黑”字体；可按配置教程设置 `PDF_DEMO_FONT_PATH`。 |
| 页面仍显示旧资源 | 强制刷新浏览器（`Ctrl+F5`）后重新打开本地地址。 |

## 维护说明

欢迎围绕可审计性、来源隔离、评分一致性和可靠性提交改进。请勿提交真实个人数据、密钥或用于规避安全检测的内容。
