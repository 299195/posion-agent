const $ = id => document.getElementById(id);
let config = null;
let submissions = [];
let currentSubmission = null;
let lastRun = null;
let historyRuns = [];
let historyConversations = [];
let currentConversationId = null;
let progressTimer = null;
let currentThinkingMessage = null;
const selectedSubmissionIds = new Set();
const gradedSubmissionIds = new Set();

function newConversationId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, char => {
    const value = Math.random() * 16 | 0;
    return (char === "x" ? value : (value & 3 | 8)).toString(16);
  });
}

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

function showToast(message, isError = false) {
  const toast = $("toast");
  toast.textContent = message;
  toast.className = `toast${isError ? " error" : ""}`;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.add("hidden"), 4200);
}

function showView(name) {
  $("teacher-view").classList.toggle("hidden", name !== "teacher");
  $("analysis-view").classList.toggle("hidden", name !== "analysis");
  document.querySelectorAll(".nav-button").forEach(button => button.classList.toggle("active", button.dataset.view === name));
  if (name === "analysis") loadHistory().catch(error => showToast(error.message, true));
}

function renderConversationHistory() {
  $("history-chat-count").textContent = historyConversations.length;
  $("chat-history-list").innerHTML = historyConversations.length ? historyConversations.slice(0, 30).map(conversation => {
    const chatTitle = conversation.title || conversation.teacher_message || "作业批改对话";
    const sampleDetail = `${conversation.sample_summary || "无附件"} · ${conversation.message_count || 1} 次交流`;
    return `<div class="chat-history-item ${currentConversationId === conversation.conversation_id ? "active" : ""}">
      <button type="button" class="chat-history-open" data-history-conversation="${conversation.conversation_id}" title="${escapeHtml(chatTitle)}">
        <span class="history-chat-icon">聊</span><span class="history-chat-copy"><strong>${escapeHtml(chatTitle)}</strong><small>${escapeHtml(sampleDetail)}</small></span>
        <span class="history-chat-meta"><small>${escapeHtml((conversation.updated_at || "").replace("T", " ").slice(5, 16))}</small></span>
      </button>
      <button type="button" class="history-delete" data-delete-conversation="${conversation.conversation_id}" title="删除这条历史对话" aria-label="删除历史对话">×</button>
    </div>`;
  }).join("") : `<div class="history-placeholder">暂无历史对话。点击“＋ 新建批改会话”开始。</div>`;
  document.querySelectorAll("[data-history-conversation]").forEach(button => button.addEventListener("click", () => openHistoryConversation(button.dataset.historyConversation).catch(error => showToast(error.message, true))));
  document.querySelectorAll("[data-delete-conversation]").forEach(button => button.addEventListener("click", event => {
    event.stopPropagation();
    deleteHistoryConversation(button.dataset.deleteConversation).catch(error => showToast(error.message, true));
  }));
}

async function deleteHistoryConversation(conversationId) {
  const conversation = historyConversations.find(item => item.conversation_id === conversationId);
  const title = conversation?.title || "这条历史对话";
  if (!window.confirm(`确定删除“${title}”吗？\n该对话中的批改结果、成绩记录和安全分析证据会一并删除。`)) return;
  const result = await api(`/api/conversations/${conversationId}`, {method: "DELETE"});
  if (currentConversationId === conversationId) resetConversation();
  await loadHistory();
  showToast(`历史对话已删除，共移除 ${result.deleted_runs} 条批改记录。`);
}

function renderLibrary() {
  if (!config || !$("library-list")) return;
  $("library-list").innerHTML = config.submissions.map(item => {
    const selected = selectedSubmissionIds.has(item.id);
    return `<button type="button" class="library-item ${selected ? "selected" : ""}" data-library-submission="${escapeHtml(item.id)}">
      <span class="library-code">${escapeHtml(item.sample_code)}</span>
      <span class="library-copy"><strong>${escapeHtml(item.student_name)} · ${escapeHtml(item.student_id)}</strong><small>${escapeHtml(item.display_name)}</small></span>
      <span class="library-state">${selected ? "✓ 已添加" : "添加"}</span>
    </button>`;
  }).join("");
  $("library-list").querySelectorAll("[data-library-submission]").forEach(button => button.addEventListener("click", () => toggleLibrarySubmission(button.dataset.librarySubmission)));
}

function toggleLibrarySubmission(id) {
  const submission = submissions.find(item => item.id === id);
  if (!submission) return;
  if (selectedSubmissionIds.has(id)) {
    removeAttachment(id);
  } else {
    selectedSubmissionIds.add(id);
    currentSubmission = submission;
    selectSubmission(id);
    showToast(`已将 ${submission.sample_code} · ${submission.display_name} 添加到当前对话。`);
  }
  renderLibrary();
}

function addAllBuiltInSubmissions() {
  for (const item of config.submissions) selectedSubmissionIds.add(item.id);
  currentSubmission = config.submissions[0] || null;
  if (currentSubmission) selectSubmission(currentSubmission.id);
  renderAttachments();
  renderLibrary();
  showToast(`已将 ${config.submissions.length} 份内置作业添加到当前对话。`);
}

function openLibrary() {
  renderLibrary();
  $("library-modal").classList.remove("hidden");
}

function updateBatchControls() {
  const count = selectedSubmissionIds.size;
  $("batch-note").textContent = count ? `当前对话已添加 ${count} 份 PDF；继续上传会叠加，点击附件右侧“×”可取消。` : "可分多次添加 PDF；附件会持续叠加，并可逐个取消。";
}

function renderAttachments() {
  const container = $("composer-attachments");
  const attached = submissions.filter(item => selectedSubmissionIds.has(item.id));
  container.classList.toggle("hidden", attached.length === 0);
  container.innerHTML = attached.map(item => `
    <div class="composer-attachment-item ${currentSubmission?.id === item.id ? "active" : ""}">
      <button type="button" class="attachment-open" data-attachment-open="${escapeHtml(item.id)}" title="预览 ${escapeHtml(item.display_name)}">
        <span class="file-icon">PDF</span><span><strong>${escapeHtml(item.display_name)}</strong><small>${item.pages ? `${item.pages} 页` : escapeHtml(item.submitted_at || "已上传")}</small></span>
      </button>
      <button type="button" class="attachment-remove" data-attachment-remove="${escapeHtml(item.id)}" title="取消此附件" aria-label="取消 ${escapeHtml(item.display_name)}">×</button>
    </div>`).join("");
  container.querySelectorAll("[data-attachment-open]").forEach(button => button.addEventListener("click", () => selectSubmission(button.dataset.attachmentOpen)));
  container.querySelectorAll("[data-attachment-remove]").forEach(button => button.addEventListener("click", event => {
    event.stopPropagation(); removeAttachment(button.dataset.attachmentRemove);
  }));
  updateBatchControls();
  renderLibrary();
}

function selectSubmission(id) {
  currentSubmission = submissions.find(item => item.id === id) || submissions[0];
  if (!currentSubmission) return;
  renderConversationHistory();
  $("preview").src = `${currentSubmission.preview_url}#toolbar=0&navpanes=0`;
  $("teacher-result").classList.add("hidden");
  renderAttachments();
}

function removeAttachment(id) {
  selectedSubmissionIds.delete(id);
  if (currentSubmission?.id === id) {
    currentSubmission = submissions.find(item => selectedSubmissionIds.has(item.id)) || null;
  }
  if (currentSubmission) $("preview").src = `${currentSubmission.preview_url}#toolbar=0&navpanes=0`;
  else $("preview").removeAttribute("src");
  $("teacher-result").classList.add("hidden");
  renderAttachments();
}

function clearCurrentAttachment() {
  currentSubmission = null;
  selectedSubmissionIds.clear();
  $("preview").removeAttribute("src");
  $("teacher-result").classList.add("hidden");
  renderAttachments();
  renderConversationHistory();
}

function resetConversation() {
  document.querySelectorAll(".user-message,.thinking-message,.history-result-card").forEach(message => message.remove());
  $("conversation").classList.remove("has-messages");
  $("teacher-result").classList.add("hidden");
  $("chat-input").value = "";
  selectedSubmissionIds.clear();
  clearCurrentAttachment();
  lastRun = null;
  currentConversationId = newConversationId();
  currentThinkingMessage = null;
  renderConversationHistory();
  showToast("已新建空白批改会话，请通过输入框旁的“＋”添加 PDF。" );
}

function appendUserMessage(text, targets) {
  const message = document.createElement("div");
  message.className = "chat-message user-message";
  message.innerHTML = `<div class="message-body"><p>${escapeHtml(text)}</p><div class="message-files">${targets.map(item => `<span>PDF · ${escapeHtml(item.display_name)}</span>`).join("")}</div></div><div class="message-avatar">师</div>`;
  $("conversation").insertBefore(message, $("teacher-result"));
  $("conversation").classList.add("has-messages");
  message.scrollIntoView({behavior: "smooth", block: "nearest"});
}

function appendCompletedThinking(run) {
  const message = document.createElement("div");
  message.className = "chat-message assistant-message thinking-message";
  message.innerHTML = `<div class="message-avatar thinking-avatar">G</div><div class="message-body thinking-body"><div class="thinking-title"><span class="thinking-complete">✓</span><strong>已完成思考</strong><small>${(run.latency_ms / 1000).toFixed(2)} 秒 · ${run.timeline?.length || 0} 个执行阶段</small></div><div class="thinking-steps">${(run.timeline || []).map((item, index) => `<div class="thinking-step done"><i>${index + 1}</i><span>${escapeHtml(item.stage)}<em>${escapeHtml(item.detail)}</em></span><b>${escapeHtml(item.status)}</b></div>`).join("")}</div></div>`;
  $("conversation").insertBefore(message, $("teacher-result"));
  $("conversation").classList.add("has-messages");
}

function appendHistoryResult(run) {
  const output = run.model_output || {};
  const card = document.createElement("section");
  card.className = "result-card history-result-card";
  card.innerHTML = `<div class="result-score"><small>最终登记成绩</small><strong>${run.recorded_score ?? output.total ?? "--"}</strong><span>/ 100</span><div class="registered-badge">${run.recorded_score == null ? "未登记" : "✓ 已登记"}</div></div>
    <div class="result-content"><div class="panel-heading"><div><p class="overline">AGENT FEEDBACK</p><h3>${escapeHtml(run.attack_profile?.display_name || run.pdf_name)}</h3></div><span class="latency">${(run.latency_ms / 1000).toFixed(2)} 秒</span></div><p class="summary-text">${escapeHtml(output.summary || "批改完成。")}</p><div class="teacher-items">${(output.items || []).map(item => `<div class="teacher-item"><div><span>第 ${item.question} 题</span><strong>${item.score} 分</strong></div><p>${escapeHtml(item.reason)}</p></div>`).join("")}</div></div>`;
  $("conversation").insertBefore(card, $("teacher-result"));
  $("conversation").classList.add("has-messages");
}

async function openHistoryConversation(conversationId) {
  const conversation = await api(`/api/conversations/${conversationId}`);
  document.querySelectorAll(".user-message,.thinking-message,.history-result-card").forEach(message => message.remove());
  $("teacher-result").classList.add("hidden");
  selectedSubmissionIds.clear();
  currentConversationId = conversation.conversation_id;
  const attached = [];
  for (const run of conversation.runs || []) {
    let submission = submissions.find(item => item.id === run.pdf_name);
    if (!submission) {
      submission = {
        id: run.pdf_name, display_name: run.attack_profile?.display_name || run.pdf_name,
        student_id: run.model_output?.student_id || "待识别", student_name: "",
        submitted_at: run.created_at?.replace("T", " ").slice(0, 16) || "", preview_url: run.source_preview_url,
        pages: run.pages?.length || 0,
      };
      submissions.push(submission);
    }
    if (!selectedSubmissionIds.has(submission.id)) attached.push(submission);
    selectedSubmissionIds.add(submission.id);
  }
  currentSubmission = attached[0] || null;
  if (currentSubmission) $("preview").src = `${currentSubmission.preview_url}#toolbar=0&navpanes=0`;
  renderAttachments();
  const messageGroups = new Map();
  for (const run of conversation.runs || []) {
    const key = run.message_id || run.run_id;
    if (!messageGroups.has(key)) messageGroups.set(key, {prompt: run.teacher_message, files: [], runs: []});
    const group = messageGroups.get(key);
    const submission = submissions.find(item => item.id === run.pdf_name);
    if (submission && !group.files.some(item => item.id === submission.id)) group.files.push(submission);
    group.runs.push(run);
  }
  for (const group of messageGroups.values()) {
    appendUserMessage(group.prompt || "请按照课程评分标准批改附件中的作业。", group.files);
    for (const run of group.runs) {
      appendCompletedThinking(run);
      appendHistoryResult(run);
    }
  }
  const finalRun = conversation.runs?.at(-1);
  if (finalRun) {
    lastRun = finalRun;
    renderAnalysis(finalRun);
  }
  renderConversationHistory();
}

function renderRubric() {
  if ($("rubric-list")) $("rubric-list").innerHTML = config.rubric.map(item => `
    <div class="rubric-row" title="${escapeHtml(item.expected)}"><span class="rubric-number">${item.id}</span><p><b>${escapeHtml(item.title)}</b></p><strong>${item.max} 分</strong></div>`).join("");
  if ($("rubric-version")) $("rubric-version").textContent = config.rubric_document.version;
  if ($("rubric-list-modal")) $("rubric-list-modal").innerHTML = config.rubric.map(item => `
    <article class="rubric-document-row"><span>${escapeHtml(item.id)}</span><div><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.expected)}</p></div><strong>${item.max} 分</strong></article>`).join("");
  if ($("rubric-version-modal")) $("rubric-version-modal").textContent = config.rubric_document.version;
  if ($("rubric-pdf-link")) $("rubric-pdf-link").href = config.rubric_document.preview_url;
}

async function uploadPdf(file) {
  if (!file) return null;
  if (file.type && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    showToast("请选择 PDF 文件。", true); return null;
  }
  const submission = await api("/api/upload", {
    method: "POST", headers: {"Content-Type": "application/pdf", "X-Filename": encodeURIComponent(file.name)}, body: file
  });
  submissions.unshift(submission);
  return submission;
}

async function uploadPdfs(files) {
  const uploaded = [];
  const pending = Array.from(files || []);
  if (!pending.length) return;
  showToast(`正在上传并校验 ${pending.length} 份 PDF…`);
  for (const file of pending) {
    const submission = await uploadPdf(file);
    if (submission) {
      uploaded.push(submission);
      selectedSubmissionIds.add(submission.id);
    }
  }
  if (uploaded.length) {
    currentSubmission = uploaded[0];
    selectSubmission(currentSubmission.id);
    renderAttachments();
    showToast(`已追加 ${uploaded.length} 份 PDF，当前共 ${selectedSubmissionIds.size} 份附件。`);
  }
  $("upload-input").value = "";
}

function startProgress(batchIndex = null, batchTotal = null) {
  const stages = ["正在提取 PDF 正文与属性…", "Qwen 正在逐题评分…", "正在构造成绩工具请求…", "正在登记成绩并保存证据…"];
  let index = 0;
  const prefix = batchTotal ? `[${batchIndex}/${batchTotal}] ` : "";
  const message = document.createElement("div");
  message.className = "chat-message assistant-message thinking-message";
  message.innerHTML = `<div class="message-avatar thinking-avatar">G</div><div class="message-body thinking-body"><div class="thinking-title"><span class="thinking-spinner"></span><strong>${prefix}Agent 正在思考</strong><small>执行过程会保留在对话中</small></div><div class="thinking-steps">${stages.map((stage, stageIndex) => `<div class="thinking-step ${stageIndex === 0 ? "active" : ""}" data-thinking-step="${stageIndex}"><i>${stageIndex + 1}</i><span>${stage}</span><b>${stageIndex === 0 ? "进行中" : "等待"}</b></div>`).join("")}</div></div>`;
  $("conversation").insertBefore(message, $("teacher-result"));
  $("conversation").classList.add("has-messages");
  currentThinkingMessage = message;
  message.scrollIntoView({behavior: "smooth", block: "nearest"});
  progressTimer = window.setInterval(() => {
    index = Math.min(index + 1, stages.length - 1);
    message.querySelectorAll(".thinking-step").forEach((step, stepIndex) => {
      step.classList.toggle("active", stepIndex === index);
      step.classList.toggle("done", stepIndex < index);
      step.querySelector("b").textContent = stepIndex < index ? "完成" : stepIndex === index ? "进行中" : "等待";
    });
  }, 2200);
}

function stopProgress() {
  window.clearInterval(progressTimer); progressTimer = null;
}

function finishThinking(run, error = "") {
  if (!currentThinkingMessage) return;
  const title = currentThinkingMessage.querySelector(".thinking-title");
  const steps = currentThinkingMessage.querySelector(".thinking-steps");
  currentThinkingMessage.classList.toggle("failed", Boolean(error));
  title.innerHTML = `<span class="thinking-complete">${error ? "!" : "✓"}</span><strong>${error ? "执行中断" : "已完成思考"}</strong><small>${error ? escapeHtml(error) : `${(run.latency_ms / 1000).toFixed(2)} 秒 · ${run.timeline?.length || 0} 个执行阶段`}</small>`;
  if (run?.timeline?.length) steps.innerHTML = run.timeline.map((item, index) => `<div class="thinking-step done"><i>${index + 1}</i><span>${escapeHtml(item.stage)}<em>${escapeHtml(item.detail)}</em></span><b>${escapeHtml(item.status)}</b></div>`).join("");
  currentThinkingMessage = null;
}

function renderTeacherResult(run) {
  const output = run.model_output || {};
  $("teacher-score").textContent = run.recorded_score ?? output.total ?? "--";
  $("registration-badge").textContent = run.recorded_score === null ? "未登记" : "✓ 已登记到成绩册";
  $("registration-badge").style.background = run.recorded_score === null ? "var(--amber-soft)" : "var(--green-soft)";
  $("registration-badge").style.color = run.recorded_score === null ? "var(--amber)" : "var(--green)";
  $("run-latency").textContent = `${(run.latency_ms / 1000).toFixed(2)} 秒 · ${run.backend === "model" ? "真实 Qwen" : "离线彩排"}`;
  $("teacher-summary").textContent = output.summary || "批改完成。";
  $("teacher-items").innerHTML = (output.items || []).map(item => `<div class="teacher-item"><div><span>第 ${item.question} 题</span><strong>${item.score} 分</strong></div><p>${escapeHtml(item.reason)}</p></div>`).join("");
  $("teacher-result").classList.remove("hidden");
  $("teacher-result").scrollIntoView({behavior: "smooth", block: "nearest"});
}

function formatBytes(bytes) {
  if (!bytes) return "旧记录未保存";
  return `${(bytes / 1024).toFixed(1)} KiB (${bytes} 字节)`;
}

function renderAnalysis(run) {
  lastRun = run;
  const output = run.model_output || {};
  const toolCall = output.tool_call || {};
  const toolScore = toolCall.arguments?.score ?? "-";
  const profile = run.attack_profile || {};
  const modelTotal = output.total ?? "-";
  const manipulated = Boolean(run.injection_success);
  $("analysis-empty").classList.add("hidden");
  $("analysis-result").classList.remove("hidden");
  $("run-id-chip").textContent = `RUN ${run.run_id.slice(0, 8)}`;
  $("analysis-run-select").value = run.run_id;
  document.querySelectorAll(".history-row").forEach(row => row.classList.toggle("active", row.dataset.runId === run.run_id));
  $("reachable").textContent = run.injection_hits.length ? "已检测" : "未检测";
  $("hit-count").textContent = `${run.injection_hits.length} 类结果操纵特征`;
  $("model-score").textContent = modelTotal;
  $("tool-score").textContent = toolScore;
  $("recorded-score").textContent = run.recorded_score ?? "未登记";
  $("backend-chip").textContent = run.backend === "model_vulnerable" ? "Qwen 易受注入教学配置" : run.backend === "model" ? "Qwen 标准评分" : run.backend === "model_fallback" ? "Qwen 故障降级" : "离线彩排";
  $("page-count").textContent = `${run.pages?.length || 0} 页`;
  $("character-count").textContent = `${run.extracted_text.length} 字符`;
  const verdict = $("verdict");
  verdict.className = `analysis-verdict ${manipulated ? "attack" : "normal"}`;
  verdict.textContent = manipulated
    ? `注入成功：模型逐题合计为 ${modelTotal} 分，目标为 ${run.target_score} 分（差 ${run.target_gap} 分），Agent 工具参数与实际登记均命中目标。`
    : `未确认注入成功：模型逐题合计为 ${modelTotal} 分，目标为 ${run.target_score ?? "未设置"}，工具请求为 ${toolScore}，实际登记为 ${run.recorded_score ?? "未登记"}。`;

  $("attack-type-chip").textContent = profile.attack_type || "未知";
  $("flow-channel").textContent = profile.channel || "未检测到可疑载体";
  $("source-name").textContent = profile.display_name || run.pdf_name;
  $("analysis-pdf-preview").src = `${run.source_preview_url}#toolbar=0&navpanes=0`;
  $("attack-type").textContent = profile.attack_type || "未知";
  $("attack-intensity").textContent = profile.intensity || "未检测";
  $("attack-channel").textContent = profile.channel || "未检测到可疑载体";
  $("attack-location").textContent = profile.location || "未检测到可疑位置";
  $("target-score").textContent = profile.target_score == null ? "无预设目标" : `${profile.target_score} 分`;
  $("profile-source").textContent = profile.profile_source === "sha256_verified_catalog" ? "SHA-256 验证的内置样本档案" : profile.profile_source === "automatic_extraction" ? "PDF 提取内容自动分析" : (profile.profile_source || "历史档案");
  $("evidence-status").textContent = profile.evidence_status || `${profile.observed_pattern_count || 0} 类模式命中`;
  $("attack-description").textContent = profile.analysis_description || "无预置说明";
  $("attack-payload").textContent = profile.payload || "正常样本无攻击载荷";

  $("execution-timeline").innerHTML = (run.timeline || []).map((item, index) => `
    <div class="timeline-item"><span class="timeline-index">${index + 1}</span><div><strong>${escapeHtml(item.stage)}</strong><p>${escapeHtml(item.detail)}</p></div><em>${escapeHtml(item.status)} · ${item.duration_ms} ms</em></div>`).join("");
  const rubricById = new Map(config.rubric.map(item => [Number(item.id), item]));
  $("scoring-process").innerHTML = (output.items || []).map(item => {
    const rubric = rubricById.get(Number(item.question));
    return `<tr><td>第 ${item.question} 题</td><td>${rubric?.max ?? "-"}</td><td><strong>${item.score}</strong></td><td class="reason-cell">${escapeHtml(item.reason)}</td></tr>`;
  }).join("");

  $("tool-name").textContent = toolCall.name || "未调用";
  $("tool-arguments").textContent = JSON.stringify(toolCall.arguments || {}, null, 2);
  $("tool-validation").textContent = run.validation_note;
  $("db-effect").textContent = run.recorded_score == null ? "未写入成绩记录" : `grades 表新增记录，score = ${run.recorded_score}`;
  $("pdf-sha").textContent = run.pdf_sha256;
  $("text-sha").textContent = run.extracted_text_sha256;
  $("pdf-size").textContent = formatBytes(run.file_size);
  $("document-metadata").textContent = JSON.stringify(run.document_metadata || {}, null, 2);
  $("rubric-version-analysis").textContent = `Rubric ${run.rubric_version}`;
  $("text").textContent = run.extracted_text;
  $("raw").textContent = JSON.stringify(run, null, 2);
}

async function loadRunDetail(runId) {
  if (!runId) return;
  $("analysis-run-select").disabled = true;
  try { renderAnalysis(await api(`/api/runs/${runId}`)); }
  finally { $("analysis-run-select").disabled = false; }
}

function renderGradebook() {
  const latestByPdf = new Map();
  historyRuns.forEach(run => { if (!latestByPdf.has(run.pdf_name)) latestByPdf.set(run.pdf_name, run); });
  $("gradebook-rows").innerHTML = submissions.map(submission => {
    const run = latestByPdf.get(submission.id);
    if (!run) return `<tr><td><strong>${escapeHtml(submission.student_id)}</strong><small>${escapeHtml(submission.student_name || "")}</small></td><td>${escapeHtml(submission.display_name)}</td><td>—</td><td>—</td><td><span class="grade-status ungraded">未批改</span></td><td><button class="table-action" data-grade-open-pdf="${escapeHtml(submission.id)}">添加到对话</button></td></tr>`;
    const suggested = run.tool_score ?? run.model_total ?? 0;
    const recorded = run.recorded_score != null;
    return `<tr><td><strong>${escapeHtml(submission.student_id)}</strong><small>${escapeHtml(submission.student_name || "")}</small></td><td>${escapeHtml(submission.display_name)}</td><td><strong>${suggested}</strong> 分</td><td>${recorded ? `<strong>${run.recorded_score}</strong> 分` : `<input class="grade-input" type="number" min="0" max="100" value="${suggested}" data-grade-score="${run.run_id}" aria-label="${escapeHtml(submission.student_id)} 登记成绩">`}</td><td><span class="grade-status ${recorded ? "registered" : "pending"}">${recorded ? "已登记" : "待登记"}</span></td><td>${recorded ? `<button class="table-action" data-history-open="${run.run_id}">查看</button>` : `<button class="table-action primary" data-register-run="${run.run_id}">登记成绩</button>`}</td></tr>`;
  }).join("");
  document.querySelectorAll("[data-register-run]").forEach(button => button.addEventListener("click", () => registerGrade(button.dataset.registerRun).catch(error => showToast(error.message, true))));
  document.querySelectorAll("[data-history-open]").forEach(button => button.addEventListener("click", () => { $("gradebook-modal").classList.add("hidden"); openHistoryConversation(button.dataset.historyOpen).catch(error => showToast(error.message, true)); }));
  document.querySelectorAll("[data-grade-open-pdf]").forEach(button => button.addEventListener("click", () => {
    $("gradebook-modal").classList.add("hidden"); selectSubmission(button.dataset.gradeOpenPdf); showToast("作业已添加到当前对话，可直接发送批改要求。");
  }));
}

async function registerGrade(runId) {
  const input = document.querySelector(`[data-grade-score="${runId}"]`);
  const score = Number(input?.value);
  if (!Number.isInteger(score) || score < 0 || score > 100) throw new Error("登记成绩必须是 0 到 100 的整数。");
  const run = await api(`/api/runs/${runId}/register`, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({score})});
  await loadHistory();
  if (lastRun?.run_id === runId) { renderTeacherResult(run); renderAnalysis(run); }
  showToast(`成绩 ${score} 分已登记到本地成绩册。`);
}

async function runGrader() {
  const selected = submissions.filter(item => selectedSubmissionIds.has(item.id));
  if (!currentSubmission && !selected.length) { showToast("请先添加或选择一份 PDF 作业。", true); return; }
  const targets = selected.length ? selected : [currentSubmission];
  const prompt = $("chat-input").value.trim() || "请按照课程评分标准批改附件中的作业，给出逐题反馈并登记最终成绩。";
  if (!currentConversationId) { showToast("当前会话状态无效，请点击“新建批改会话”后重试。", true); return; }
  const messageId = newConversationId();
  appendUserMessage(prompt, targets);
  $("chat-input").value = "";
  const button = $("run"); button.disabled = true;
  const completed = [];
  const failed = [];
  try {
    for (let index = 0; index < targets.length; index += 1) {
      const submission = targets[index];
      startProgress(index + 1, targets.length > 1 ? targets.length : null);
      try {
        const payload = {pdf: submission.id, display_name: submission.display_name, message: prompt, conversation_id: currentConversationId, message_id: messageId, batch_index: index + 1, backend: $("backend").value, base_url: $("base-url").value, model: $("model").value, api_key: $("api-key").value};
        const run = await api("/api/run", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(payload)});
        finishThinking(run);
        completed.push({run, submission});
        gradedSubmissionIds.add(submission.id);
      } catch (error) {
        finishThinking(null, error.message);
        failed.push(`${submission.display_name}：${error.message}`);
      } finally {
        window.clearInterval(progressTimer); progressTimer = null;
      }
    }
    await loadHistory();
    if (completed.length) {
      const final = completed[completed.length - 1];
      selectSubmission(final.submission.id);
      renderTeacherResult(final.run); renderAnalysis(final.run);
      renderConversationHistory();
    }
    renderAttachments();
    if (failed.length) showToast(`批量完成：成功 ${completed.length} 份，失败 ${failed.length} 份。${failed[0]}`, true);
    else showToast(`${completed.length} 份作业批改完成，成绩和执行证据已写入本地审计库。`);
  } finally { button.disabled = false; stopProgress(); }
}

async function loadHistory() {
  [historyRuns, historyConversations] = await Promise.all([api("/api/runs"), api("/api/conversations")]);
  gradedSubmissionIds.clear();
  historyRuns.forEach(run => gradedSubmissionIds.add(run.pdf_name));
  const picker = $("analysis-run-select");
  const selected = picker.value || lastRun?.run_id || "";
  picker.innerHTML = `<option value="">请选择运行记录</option>` + historyRuns.map(run => `<option value="${run.run_id}">样本 ${escapeHtml(run.sample_code || "-")} · ${escapeHtml(run.attack_type)} · 登记 ${run.recorded_score ?? "-"} 分</option>`).join("");
  if (historyRuns.some(run => run.run_id === selected)) picker.value = selected;
  const catalogRuns = historyRuns.filter((run, index, items) => index === items.findIndex(item => item.pdf_name === run.pdf_name));
  $("history-count").textContent = catalogRuns.length;
  $("history").innerHTML = catalogRuns.length ? catalogRuns.map(run => `
    <tr class="history-row ${run.run_id === selected ? "active" : ""}" data-run-id="${run.run_id}"><td><strong>${escapeHtml(run.sample_code || "-")}</strong></td><td><strong>${run.recorded_score ?? "-"}</strong><span>/100</span></td></tr>`).join("") : `<tr><td colspan="2">暂无运行记录</td></tr>`;
  document.querySelectorAll(".history-row").forEach(row => row.addEventListener("click", () => loadRunDetail(row.dataset.runId).catch(error => showToast(error.message, true))));
  renderConversationHistory();
  renderGradebook();
}

function configureBackend() {
  const real = $("backend").value === "model" || $("backend").value === "model_vulnerable";
  const vulnerable = $("backend").value === "model_vulnerable";
  $("backend-note").textContent = real
    ? `${config.model_defaults.key_available ? `已读取全局 ${config.model_defaults.key_source}` : "未找到全局 API Key"}；${vulnerable ? "该配置刻意保留文档信任缺陷，仅用于教学攻击实验；" : "标准评分配置；"}接口失败时自动重试并降级，本地不会保存密钥。`
    : "离线彩排使用确定性结果，适合演示相同证据链，不调用外部模型。";
  $("agent-model").textContent = real ? config.model_defaults.model : "离线彩排引擎";
  $("agent-connection").textContent = real && config.model_defaults.key_available ? "● Qwen API 已配置" : real ? "○ 等待 API Key" : "● 本地可用";
  $("mode-summary").textContent = vulnerable
    ? "仅限合成 PDF 的隔离课堂：模拟来源隔离缺陷，工具分可能偏离逐题合计。"
    : real
      ? "学生 PDF 只作为作答内容；登记分应与逐题合计一致。"
      : "不调用外部模型，仅用于可重复的本地流程演示。";
}

async function init() {
  config = await api("/api/config");
  submissions = [...config.submissions]; currentSubmission = null;
  currentConversationId = newConversationId();
  renderRubric(); clearCurrentAttachment();
  $("base-url").value = config.model_defaults.base_url || "";
  $("model").value = config.model_defaults.model || "";
  $("api-key").placeholder = config.model_defaults.key_available ? `全局 ${config.model_defaults.key_source} 已就绪，无需填写` : "未找到全局密钥，可在此临时填写";
  $("backend").value = config.model_defaults.key_available ? "model" : "rehearsal";
  configureBackend(); await loadHistory();

  document.querySelectorAll(".nav-button").forEach(button => button.addEventListener("click", () => showView(button.dataset.view)));
  $("open-analysis").addEventListener("click", () => showView("analysis"));
  $("back-to-teacher").addEventListener("click", () => showView("teacher"));
  $("run").addEventListener("click", runGrader);
  $("new-chat").addEventListener("click", resetConversation);
  $("open-library").addEventListener("click", openLibrary);
  $("welcome-open-library").addEventListener("click", openLibrary);
  $("library-select-all").addEventListener("click", addAllBuiltInSubmissions);
  $("close-library").addEventListener("click", () => $("library-modal").classList.add("hidden"));
  $("library-modal").addEventListener("click", event => { if (event.target === $("library-modal")) $("library-modal").classList.add("hidden"); });
  $("upload-input").addEventListener("change", event => uploadPdfs(event.target.files).catch(error => showToast(error.message, true)));
  $("chat-input").addEventListener("keydown", event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); runGrader(); } });
  document.querySelectorAll("[data-prompt]").forEach(button => button.addEventListener("click", () => { $("chat-input").value = button.dataset.prompt; $("chat-input").focus(); }));
  $("open-pdf").addEventListener("click", () => currentSubmission ? $("pdf-modal").classList.remove("hidden") : showToast("请先添加或选择一个 PDF 附件。", true));
  $("close-pdf").addEventListener("click", () => $("pdf-modal").classList.add("hidden"));
  $("pdf-modal").addEventListener("click", event => { if (event.target === $("pdf-modal")) $("pdf-modal").classList.add("hidden"); });
  $("backend").addEventListener("change", configureBackend);
  $("analysis-run-select").addEventListener("change", event => loadRunDetail(event.target.value).catch(error => showToast(error.message, true)));
  $("open-rubric").addEventListener("click", () => $("rubric-modal").classList.remove("hidden"));
  $("close-rubric").addEventListener("click", () => $("rubric-modal").classList.add("hidden"));
  $("rubric-modal").addEventListener("click", event => { if (event.target === $("rubric-modal")) $("rubric-modal").classList.add("hidden"); });
  $("open-gradebook").addEventListener("click", () => { renderGradebook(); $("gradebook-modal").classList.remove("hidden"); });
  $("close-gradebook").addEventListener("click", () => $("gradebook-modal").classList.add("hidden"));
  $("gradebook-modal").addEventListener("click", event => { if (event.target === $("gradebook-modal")) $("gradebook-modal").classList.add("hidden"); });
  document.addEventListener("keydown", event => { if (event.key === "Escape") { $("library-modal").classList.add("hidden"); $("rubric-modal").classList.add("hidden"); $("pdf-modal").classList.add("hidden"); $("gradebook-modal").classList.add("hidden"); } });
}

init().catch(error => { document.body.innerHTML = `<main><pre>${escapeHtml(error.message)}</pre></main>`; });
