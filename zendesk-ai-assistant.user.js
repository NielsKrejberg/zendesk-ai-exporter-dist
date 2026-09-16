// ==UserScript==
// @name         Zendesk AI Assistant
// @namespace    https://github.com/NielsKrejberg/zendesk-ai-exporter
// @version      0.4.1
// @description  Zendesk AI support assistant with built-in ticket search, export and Supabase knowledge-base upload.
// @author       Niels Krejberg
// @homepageURL  https://github.com/NielsKrejberg/zendesk-ai-exporter
// @updateURL    https://raw.githubusercontent.com/NielsKrejberg/zendesk-ai-exporter-dist/main/zendesk-ai-assistant.user.js
// @downloadURL  https://raw.githubusercontent.com/NielsKrejberg/zendesk-ai-exporter-dist/main/zendesk-ai-assistant.user.js
// @match        https://*.zendesk.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      gdpukysdcaoxtgqjkesv.supabase.co
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const APP_ID = 'zae-cloud-assistant';
    const SUPABASE_BASE = 'https://gdpukysdcaoxtgqjkesv.supabase.co/functions/v1';
    const CHAT_ENDPOINT = `${SUPABASE_BASE}/zendesk-chat`;
    const IMPORT_ENDPOINT = `${SUPABASE_BASE}/import-zendesk`;
    const TOKEN_KEY = 'zae_supabase_import_token';
    const COMMENT_CONCURRENCY = 4;
    const IMPORT_BATCH_SIZE = 20;
    const DB_NAME = 'zendesk-ai-exporter-kb';
    const DB_VERSION = 1;
    const STORE = 'tickets';

    if (document.getElementById(APP_ID)) return;

    const state = {
        ticketId: null,
        messages: [],
        busy: false,
        view: 'chat',
        tickets: [],
        selectedTicketIds: new Set(),
        exportRunning: false,
        exportCancelled: false,
        groupCache: new Map(),
        kbCount: 0,
    };

    const style = document.createElement('style');
    style.textContent = `
      #${APP_ID},#${APP_ID}-toggle{font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#fff}
      #${APP_ID}-toggle{position:fixed;z-index:2147483644;top:61px;right:18px;border:1px solid rgba(155,229,178,.28);border-radius:7px;background:rgba(20,63,42,.86);backdrop-filter:blur(12px);color:#fff;padding:8px 11px;cursor:pointer;box-shadow:0 8px 28px rgba(0,0,0,.25)}
      #${APP_ID}{position:fixed;z-index:2147483646;top:12px;right:12px;width:min(560px,calc(100vw - 24px));height:calc(100vh - 24px);display:none;flex-direction:column;background:rgba(15,48,32,.93);border:1px solid rgba(148,210,168,.25);border-radius:12px;box-shadow:0 16px 44px rgba(0,0,0,.38);backdrop-filter:blur(14px);overflow:hidden;transition:width .18s ease}
      #${APP_ID}.zaec-export-mode{width:min(1180px,calc(100vw - 24px))}
      #${APP_ID} *{box-sizing:border-box}
      .zaec-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 13px;border-bottom:1px solid rgba(148,210,168,.18);flex:0 0 auto}
      .zaec-title{font-size:15px;font-weight:700}.zaec-sub,.zaec-help{font-size:11px;color:rgba(255,255,255,.58)}
      .zaec-head-actions,.zaec-tools,.zaec-input-row,.zaec-tabs,.zaec-actions,.zaec-kb-row{display:flex;gap:7px;align-items:center}
      #${APP_ID} button{border:1px solid rgba(255,255,255,.14);border-radius:6px;background:rgba(255,255,255,.08);color:#fff;padding:7px 9px;cursor:pointer}#${APP_ID} button:hover{background:rgba(255,255,255,.13)}#${APP_ID} button:disabled{opacity:.45;cursor:default}
      .zaec-primary{background:rgba(117,190,139,.20)!important;border-color:rgba(155,229,178,.35)!important}
      .zaec-tabs{padding:7px 11px;border-bottom:1px solid rgba(148,210,168,.14)}.zaec-tab{min-width:74px}.zaec-tab.active{background:rgba(117,190,139,.22)!important;border-color:rgba(155,229,178,.38)!important}
      .zaec-view{flex:1;min-height:0}.zaec-chat-view{display:flex;flex-direction:column}.zaec-export-view{display:none;flex-direction:column;min-height:0}
      .zaec-tools{padding:8px 11px;border-bottom:1px solid rgba(148,210,168,.14);flex-wrap:wrap}.zaec-status{margin-left:auto;color:rgba(255,255,255,.56);font-size:11px;max-width:420px;text-align:right;overflow-wrap:anywhere}.zaec-error{color:#ffd3c8}.zaec-ok{color:#d9f5e2}
      .zaec-chat{flex:1;min-height:0;overflow:auto;padding:12px}.zaec-msg{margin:0 0 11px;padding:9px 10px;border-radius:9px;white-space:pre-wrap;overflow-wrap:anywhere}.zaec-user{margin-left:45px;background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.10)}.zaec-assistant{margin-right:28px;background:rgba(37,84,57,.54);border:1px solid rgba(148,210,168,.16)}
      .zaec-role{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:rgba(255,255,255,.48);margin-bottom:4px}.zaec-sources{margin-top:8px;padding-top:7px;border-top:1px solid rgba(255,255,255,.10);display:flex;gap:5px;flex-wrap:wrap}.zaec-source{display:inline-flex;padding:3px 6px;border-radius:999px;border:1px solid rgba(155,229,178,.22);background:rgba(117,190,139,.12);color:#dff6e6;text-decoration:none;font-size:11px}
      .zaec-empty{padding:20px 12px;color:rgba(255,255,255,.58);text-align:center}.zaec-compose{padding:10px;border-top:1px solid rgba(148,210,168,.18)}#${APP_ID} textarea{resize:vertical}
      .zaec-input-row{margin-top:7px;justify-content:flex-end}
      .zaec-export-body{padding:10px 12px 12px;overflow:auto;display:flex;flex-direction:column;min-height:0;height:100%}.zaec-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 10px}.zaec-section{margin-top:9px;flex:0 0 auto}.zaec-actions{flex-wrap:wrap;margin-top:9px}.zaec-kb{padding:8px;border:1px solid rgba(148,210,168,.16);border-radius:7px;background:rgba(0,0,0,.10);flex:0 0 auto}.zaec-kb-row{flex-wrap:wrap}.zaec-kb-count{font-weight:600}
      #${APP_ID} label{display:grid;gap:4px;color:rgba(255,255,255,.84);min-width:0}#${APP_ID} input,#${APP_ID} select,#${APP_ID} textarea{width:100%;min-width:0;border:1px solid rgba(255,255,255,.12);border-radius:6px;background:rgba(0,0,0,.18);color:#fff;padding:7px 8px;outline:none}#${APP_ID} input,#${APP_ID} select{min-height:34px}.zaec-compose textarea{min-height:76px;max-height:180px}.zaec-export-body textarea{min-height:48px;max-height:110px}
      .zaec-table-wrap{margin-top:9px;flex:1 0 220px;min-height:220px;overflow:auto;border:1px solid rgba(148,210,168,.16);border-radius:7px}.zaec-table-wrap table{width:100%;border-collapse:collapse;min-width:980px}.zaec-table-wrap th{position:sticky;top:0;z-index:1;background:rgba(20,63,42,.98);text-align:left}.zaec-table-wrap th,.zaec-table-wrap td{padding:7px 8px;border-bottom:1px solid rgba(255,255,255,.08);vertical-align:top}.zaec-link{color:#d9f5e2;text-decoration:none;font-weight:600}.zaec-pill{display:inline-block;padding:2px 6px;border-radius:999px;background:rgba(125,200,148,.15);border:1px solid rgba(145,219,168,.18)}
      .zaec-local-evidence{margin-top:8px;padding:9px;border:1px solid rgba(148,210,168,.16);border-radius:7px;background:rgba(0,0,0,.10);display:none}.zaec-local-card{padding:8px;margin-top:7px;border:1px solid rgba(148,210,168,.15);border-radius:7px;background:rgba(0,0,0,.10)}
      @media(max-width:700px){#${APP_ID},#${APP_ID}.zaec-export-mode{top:6px;right:6px;width:calc(100vw - 12px);height:calc(100vh - 12px)}.zaec-grid{grid-template-columns:1fr}.zaec-table-wrap{min-height:260px}}
    `;
    document.head.appendChild(style);

    const toggle = document.createElement('button');
    toggle.id = `${APP_ID}-toggle`;
    toggle.textContent = 'AI Assistant';
    document.body.appendChild(toggle);

    const panel = document.createElement('div');
    panel.id = APP_ID;
    panel.innerHTML = `
      <div class="zaec-head"><div><div class="zaec-title">Zendesk AI Assistant</div><div class="zaec-sub" id="zaec-ticket-label">Ready</div></div><div class="zaec-head-actions"><button id="zaec-settings" title="Configure access token">⚙</button><button id="zaec-close">×</button></div></div>
      <div class="zaec-tabs"><button id="zaec-tab-chat" class="zaec-tab active">Chat</button><button id="zaec-tab-export" class="zaec-tab">Export</button></div>
      <div id="zaec-view-chat" class="zaec-view zaec-chat-view">
        <div class="zaec-tools"><button id="zaec-add-kb" class="zaec-primary">Add current ticket to KB</button><button id="zaec-local-evidence-btn">Local evidence</button><button id="zaec-clear">Clear chat</button><span class="zaec-status" id="zaec-status">Ready</span></div>
        <div id="zaec-local-evidence" class="zaec-local-evidence"></div>
        <div class="zaec-chat" id="zaec-chat"><div class="zaec-empty">Ask about the current ticket or use Export to add historical tickets.</div></div>
        <div class="zaec-compose"><textarea id="zaec-input" placeholder="Ask about this ticket…">Help me solve this</textarea><div class="zaec-input-row"><button id="zaec-send" class="zaec-primary">Send</button></div></div>
      </div>
      <div id="zaec-view-export" class="zaec-view zaec-export-view">
        <div class="zaec-export-body">
          <div class="zaec-kb">
            <div class="zaec-kb-row"><strong>Local knowledge base</strong><span class="zaec-kb-count" id="zaec-kb-count">Loading…</span></div>
            <div class="zaec-kb-row" style="margin-top:7px"><input type="file" id="zaec-kb-files" accept=".jsonl,.ndjson,.json" multiple><button id="zaec-kb-import">Import file(s)</button><button id="zaec-kb-clear">Clear local KB</button></div>
            <div class="zaec-help">Legacy browser-local knowledge base retained from the standalone exporter. Cloud chat uses Supabase instead.</div>
          </div>
          <div class="zaec-section"><label>Search terms / Zendesk query<textarea id="zaec-query" placeholder='Optional. Use | between alternatives, e.g. checkout error | payment failed | basket issue'></textarea></label><div class="zaec-help">Use | for multiple alternatives. Results are combined and duplicate tickets removed.</div></div>
          <div class="zaec-section zaec-grid"><label>From date<input type="date" id="zaec-from-date"></label><label>To date<input type="date" id="zaec-to-date"></label><label>Date field<select id="zaec-date-field"><option value="solved">Solved date</option><option value="created" selected>Created date</option><option value="updated">Updated date</option></select></label><label>Group<input id="zaec-group" value="Web - Helpdesk" placeholder="Leave empty for any group"></label></div>
          <div class="zaec-section zaec-grid"><label>Comments in JSONL<select id="zaec-comments"><option value="all">Public + internal notes</option><option value="public">Public only</option></select></label><label>Attachment handling<select id="zaec-attachments"><option value="urls">Include attachment URLs</option><option value="none">Exclude attachments</option></select></label></div>
          <div class="zaec-actions"><button id="zaec-find" class="zaec-primary">Find matching tickets</button><button id="zaec-load-comments" disabled>Load conversations</button><button id="zaec-cancel" disabled>Cancel</button><button id="zaec-select-all" disabled>Select all</button><button id="zaec-select-none" disabled>Select none</button><button id="zaec-upload-cloud" class="zaec-primary" disabled>Upload selected to KB</button><button id="zaec-export-jsonl" disabled>Export JSONL</button><button id="zaec-export-csv" disabled>Export CSV</button></div>
          <div class="zaec-status" id="zaec-export-status">Ready.</div>
          <div class="zaec-table-wrap"><table><thead><tr><th><input type="checkbox" id="zaec-check-all" disabled></th><th>ID</th><th>Date</th><th>Subject</th><th>Status</th><th>Group</th><th>Conversation</th></tr></thead><tbody id="zaec-results"></tbody></table></div>
        </div>
      </div>`;
    document.body.appendChild(panel);

    const $ = s => panel.querySelector(s);
    toggle.onclick = () => panel.style.display = panel.style.display === 'flex' ? 'none' : 'flex';
    $('#zaec-close').onclick = () => panel.style.display = 'none';
    $('#zaec-settings').onclick = configureToken;
    $('#zaec-clear').onclick = clearChat;
    $('#zaec-add-kb').onclick = addCurrentTicketToKnowledgeBase;
    $('#zaec-local-evidence-btn').onclick = analyzeLocalEvidence;
    $('#zaec-send').onclick = sendMessage;
    $('#zaec-tab-chat').onclick = () => switchView('chat');
    $('#zaec-tab-export').onclick = () => switchView('export');
    $('#zaec-input').addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    $('#zaec-find').onclick = findTickets;
    $('#zaec-load-comments').onclick = loadSelectedConversations;
    $('#zaec-cancel').onclick = () => { state.exportCancelled = true; setExportStatus('Cancellation requested…'); };
    $('#zaec-select-all').onclick = selectAll;
    $('#zaec-select-none').onclick = selectNone;
    $('#zaec-check-all').onchange = e => e.target.checked ? selectAll() : selectNone();
    $('#zaec-upload-cloud').onclick = uploadSelectedToKnowledgeBase;
    $('#zaec-export-jsonl').onclick = exportSelectedJsonl;
    $('#zaec-export-csv').onclick = () => exportCsv(getSelectedTickets());
    $('#zaec-kb-import').onclick = importKnowledgeFiles;
    $('#zaec-kb-clear').onclick = clearKnowledgeBase;

    setDefaultFilters();
    refreshContext();
    refreshKnowledgeCount();
    setInterval(refreshContext, 800);

    function switchView(view) {
        state.view = view;
        const isExport = view === 'export';
        $('#zaec-view-chat').style.display = isExport ? 'none' : 'flex';
        $('#zaec-view-export').style.display = isExport ? 'flex' : 'none';
        $('#zaec-tab-chat').classList.toggle('active', !isExport);
        $('#zaec-tab-export').classList.toggle('active', isExport);
        panel.classList.toggle('zaec-export-mode', isExport);
    }

    function currentTicketId() {
        const m = location.pathname.match(/\/agent\/tickets\/(\d+)/);
        return m ? Number(m[1]) : null;
    }

    function refreshContext() {
        const id = currentTicketId();
        toggle.style.display = 'block';
        if (id !== state.ticketId) { state.ticketId = id; state.messages = []; renderChat(); $('#zaec-local-evidence').style.display = 'none'; }
        $('#zaec-ticket-label').textContent = id ? `Ticket #${id}` : 'Zendesk';
        if (!state.busy) $('#zaec-add-kb').disabled = !id;
        $('#zaec-local-evidence-btn').disabled = !id;
    }

    function getToken() { return String(GM_getValue(TOKEN_KEY, '') || '').trim(); }
    function configureToken() {
        const value = prompt('Enter your ZENDESK_IMPORT_TOKEN from Supabase. It is stored only in Tampermonkey on this browser.', getToken());
        if (value === null) return;
        GM_setValue(TOKEN_KEY, value.trim());
        setStatus(value.trim() ? 'Token saved' : 'Token cleared', !!value.trim());
    }
    function requireToken() {
        let token = getToken();
        if (!token) { configureToken(); token = getToken(); }
        if (!token) throw new Error('No Supabase access token configured.');
        return token;
    }

    async function zendeskGet(url, attempt = 0) {
        const r = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
        if (r.status === 429 && attempt < 5) {
            const sec = Math.max(1, Number(r.headers.get('Retry-After')) || 2);
            await new Promise(resolve => setTimeout(resolve, sec * 1000));
            return zendeskGet(url, attempt + 1);
        }
        if (!r.ok) {
            let detail = '';
            try { const body = await r.json(); detail = body.description || body.error || body.message || ''; } catch {}
            throw new Error(`Zendesk API returned ${r.status}${detail ? `: ${detail}` : ''}`);
        }
        return r.json();
    }

    function toSameOriginApiPath(v) {
        const u = new URL(v, location.origin);
        if (u.origin !== location.origin) throw new Error('Unexpected Zendesk pagination host.');
        return u.pathname + u.search;
    }

    async function fetchComments(ticketId, includeAttachments = false) {
        const comments = [], users = new Map(), seen = new Set();
        let next = `/api/v2/tickets/${ticketId}/comments.json?include=users&include_inline_images=true&page[size]=100&sort_order=asc`;
        while (next && !state.exportCancelled) {
            const d = await zendeskGet(next);
            for (const u of d.users || []) users.set(Number(u.id), { id: u.id, name: u.name || '', email: u.email || '', role: u.role || '' });
            for (const c of d.comments || []) comments.push({
                id: c.id, created_at: c.created_at || null, public: c.public === true, type: c.type || 'Comment', author_id: c.author_id || null,
                author: users.get(Number(c.author_id)) || null, body: c.plain_body || c.body || '', via: c.via || null,
                attachments: includeAttachments ? (c.attachments || []).map(a => ({ id: a.id || null, file_name: a.file_name || a.name || '', content_type: a.content_type || '', size: a.size || null, content_url: a.content_url || '' })) : []
            });
            if (![true, 'true', 1, '1'].includes(d.meta?.has_more)) break;
            let candidate = d.links?.next || null;
            if (!candidate && (d.meta?.after_cursor || d.meta?.after)) candidate = `/api/v2/tickets/${ticketId}/comments.json?include=users&include_inline_images=true&page[size]=100&sort_order=asc&page[after]=${encodeURIComponent(d.meta.after_cursor || d.meta.after)}`;
            if (!candidate || seen.has(candidate)) break;
            seen.add(candidate);
            next = toSameOriginApiPath(candidate);
        }
        return comments;
    }

    async function loadTicket(ticketId) {
        const d = await zendeskGet(`/api/v2/tickets/${ticketId}.json`);
        const t = d.ticket || d;
        return {
            id: Number(t.id), subject: t.subject || '', description: t.description || '', status: t.status || '', group_name: '', tags: t.tags || [],
            created_at: t.created_at || null, updated_at: t.updated_at || null, solved_at: t.solved_at || null,
            url: `${location.origin}/agent/tickets/${ticketId}`, conversation: await fetchComments(ticketId, false),
        };
    }

    async function loadCurrentTicket() {
        const id = currentTicketId();
        if (!id) throw new Error('Open a Zendesk ticket first.');
        return loadTicket(id);
    }

    function extractSupabaseError(data, status) {
        const firstFailure = Array.isArray(data?.results) ? data.results.find(row => row?.ok === false) : null;
        const stage = firstFailure?.stage ? ` [${firstFailure.stage}]` : '';
        const detail = firstFailure?.error || data?.error || data?.message || '';
        return detail ? `Supabase ${status}${stage}: ${detail}` : `Supabase returned HTTP ${status || 'unknown'}`;
    }

    function callSupabase(endpoint, body) {
        const token = requireToken();
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST', url: endpoint,
                headers: { 'Content-Type': 'application/json', 'x-import-token': token },
                data: JSON.stringify(body), timeout: 120000,
                onload: response => {
                    let data = null;
                    try { data = JSON.parse(response.responseText || '{}'); } catch {}
                    if (response.status < 200 || response.status >= 300) { reject(new Error(extractSupabaseError(data, response.status))); return; }
                    resolve(data || {});
                },
                ontimeout: () => reject(new Error('Supabase request timed out.')),
                onerror: error => reject(new Error(`Supabase network request failed${error?.error ? `: ${error.error}` : ''}.`)),
            });
        });
    }

    async function addCurrentTicketToKnowledgeBase() {
        if (state.busy) return;
        setBusy(true);
        try {
            setStatus('Loading ticket…');
            const ticket = await loadCurrentTicket();
            setStatus('Uploading to knowledge base…');
            const result = await callSupabase(IMPORT_ENDPOINT, { tickets: [ticket] });
            const row = result.results?.[0];
            if (row && row.ok === false) throw new Error(row.error || 'Import failed.');
            setStatus(`Added #${ticket.id}: ${row?.chunks || 0} chunks, ${row?.embeddings || 0} embeddings · PII ${sumRedactions(result.redactions)}`, true);
        } catch (e) { setStatus(e.message || String(e), false); }
        finally { setBusy(false); }
    }

    async function sendMessage() {
        if (state.busy) return;
        const input = $('#zaec-input'), text = input.value.trim();
        if (!text) return;
        input.value = '';
        state.messages.push({ role: 'user', content: text });
        renderChat();
        setBusy(true);
        try {
            setStatus('Loading ticket…');
            const ticket = await loadCurrentTicket();
            setStatus('Searching knowledge base…');
            const history = state.messages.slice(0, -1).slice(-4).map(({ role, content }) => ({ role, content }));
            const result = await callSupabase(CHAT_ENDPOINT, { ticket, message: text, history });
            state.messages.push({ role: 'assistant', content: result.answer || '', sources: result.sources || [] });
            renderChat();
            setStatus(`${result.sources?.length || 0} historical source tickets`, true);
        } catch (e) {
            state.messages.push({ role: 'assistant', content: `Error: ${e.message || String(e)}`, error: true, sources: [] });
            renderChat();
            setStatus(e.message || String(e), false);
        } finally { setBusy(false); }
    }

    function renderChat() {
        const el = $('#zaec-chat');
        if (!state.messages.length) { el.innerHTML = '<div class="zaec-empty">Ask about the current ticket or use Export to add historical tickets.</div>'; return; }
        el.innerHTML = '';
        for (const msg of state.messages) {
            const box = document.createElement('div'); box.className = `zaec-msg ${msg.role === 'user' ? 'zaec-user' : 'zaec-assistant'}`;
            const role = document.createElement('div'); role.className = 'zaec-role'; role.textContent = msg.role === 'user' ? 'You' : 'Assistant';
            const body = document.createElement('div'); renderAnswer(body, msg.content || ''); box.append(role, body);
            if (Array.isArray(msg.sources) && msg.sources.length) {
                const sources = document.createElement('div'); sources.className = 'zaec-sources';
                for (const s of msg.sources) {
                    const a = document.createElement('a'); a.className = 'zaec-source'; a.href = s.url || `${location.origin}/agent/tickets/${s.ticketId}`; a.target = '_blank'; a.rel = 'noopener'; a.textContent = `#${s.ticketId}`; a.title = `${s.subject || ''} · score ${Math.round(Number(s.score || 0) * 100)}%`; sources.appendChild(a);
                }
                box.appendChild(sources);
            }
            if (msg.error) box.classList.add('zaec-error');
            el.appendChild(box);
        }
        el.scrollTop = el.scrollHeight;
    }

    function renderAnswer(container, text) {
        const re = /\[#(\d+)\]/g; let last = 0, match;
        while ((match = re.exec(text))) {
            container.appendChild(document.createTextNode(text.slice(last, match.index)));
            const a = document.createElement('a'); a.href = `${location.origin}/agent/tickets/${match[1]}`; a.target = '_blank'; a.rel = 'noopener'; a.className = 'zaec-source'; a.textContent = `#${match[1]}`; container.appendChild(a); last = re.lastIndex;
        }
        container.appendChild(document.createTextNode(text.slice(last)));
    }

    function clearChat() { state.messages = []; renderChat(); setStatus('Ready', true); }
    function sumRedactions(r) { return Object.values(r || {}).reduce((a, b) => a + Number(b || 0), 0); }
    function setBusy(value) { state.busy = value; $('#zaec-send').disabled = value; $('#zaec-add-kb').disabled = value || !currentTicketId(); }
    function setStatus(text, ok = null) { const el = $('#zaec-status'); el.textContent = text; el.className = `zaec-status ${ok === true ? 'zaec-ok' : ok === false ? 'zaec-error' : ''}`; }
    function setExportStatus(text, ok = null) { const el = $('#zaec-export-status'); el.textContent = text; el.className = `zaec-status ${ok === true ? 'zaec-ok' : ok === false ? 'zaec-error' : ''}`; }

    function toDateInputValue(date) { const y=date.getFullYear(),m=String(date.getMonth()+1).padStart(2,'0'),d=String(date.getDate()).padStart(2,'0'); return `${y}-${m}-${d}`; }
    function subtractCalendarMonths(date, months) { const day=date.getDate(),target=new Date(date.getFullYear(),date.getMonth()-months,1),lastDay=new Date(target.getFullYear(),target.getMonth()+1,0).getDate(); target.setDate(Math.min(day,lastDay)); return target; }
    function setDefaultFilters() { const today=new Date(); $('#zaec-from-date').value=toDateInputValue(subtractCalendarMonths(today,2)); $('#zaec-to-date').value=toDateInputValue(today); $('#zaec-date-field').value='created'; }

    async function findTickets() {
        if (state.exportRunning) return;
        state.exportRunning = true; state.exportCancelled = false; state.tickets = []; state.selectedTicketIds.clear(); renderResults(); setExportRunningUi(true);
        try {
            const raw = $('#zaec-query').value.trim().replace(/\btype:ticket\b/gi,'').trim();
            const groupName = $('#zaec-group').value.trim();
            let group=null, exactId=null, exactName=null;
            if (groupName) {
                setExportStatus(`Resolving Zendesk group “${groupName}”…`);
                group = await resolveGroup(groupName);
                if (!group) throw new Error(`Could not find group “${groupName}”.`);
                exactId=group.id; exactName=group.name;
            }
            const terms = raw ? raw.split('|').map(x=>x.trim()).filter(Boolean) : [''];
            const queries = terms.map(term=>buildUnifiedQuery(term,group)).filter(Boolean);
            if (!queries.length) throw new Error('Enter search terms or choose at least one structured filter.');
            const combined = new Map();
            for (let i=0;i<queries.length&&!state.exportCancelled;i++) {
                const label = terms[i] ? `Term ${i+1}/${queries.length}: “${terms[i]}”` : `Search ${i+1}/${queries.length}`;
                const found = await searchExportTickets(queries[i], exactId, exactName, label);
                for (const ticket of found) combined.set(ticket.id,ticket);
            }
            state.tickets=[...combined.values()].sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0));
            state.tickets.forEach(t=>state.selectedTicketIds.add(t.id)); renderResults();
            setExportStatus(state.exportCancelled ? `Search cancelled. ${state.tickets.length.toLocaleString()} unique tickets loaded.` : `Found ${state.tickets.length.toLocaleString()} unique tickets across ${queries.length} search${queries.length===1?'':'es'}.`, true);
        } catch(e) { console.error(e); setExportStatus(`Error: ${e.message}`, false); }
        finally { state.exportRunning=false; setExportRunningUi(false); }
    }

    function buildUnifiedQuery(raw, group) {
        const field=$('#zaec-date-field').value,from=$('#zaec-from-date').value,to=$('#zaec-to-date').value,parts=[];
        if(raw)parts.push(raw); if(group)parts.push(`group:${group.id}`); if(from)parts.push(`${field}>=${from}`); if(to)parts.push(`${field}<=${to}`); return parts.join(' ').trim();
    }

    async function resolveGroup(name) {
        const key=name.toLowerCase(); if(state.groupCache.has(key))return state.groupCache.get(key);
        const d=await zendeskGet(`/api/v2/groups/autocomplete.json?name=${encodeURIComponent(name)}`),g=(d.groups||[]).find(x=>(x.name||'').toLowerCase()===key)||null;
        if(g)state.groupCache.set(key,g); return g;
    }

    async function searchExportTickets(query, exactGroupId, exactGroupName, progressLabel='') {
        const out=[],seen=new Set(),cursors=new Set(); let after=null,page=0;
        while(!state.exportCancelled) {
            page++; const p=new URLSearchParams({query,'filter[type]':'ticket','page[size]':'100'}); if(after)p.set('page[after]',after);
            const d=await zendeskGet(`/api/v2/search/export.json?${p}`);
            for(const t of d.results||[]) { if((exactGroupId&&Number(t.group_id)!==Number(exactGroupId))||seen.has(t.id))continue; seen.add(t.id); out.push(normalizeSearchTicket(t,exactGroupName)); }
            setExportStatus(`${progressLabel?`${progressLabel} · `:''}Searching Zendesk… ${out.length.toLocaleString()} tickets loaded (page ${page}).`);
            const meta=d.meta||{},links=d.links||{},hasMore=[true,'true',1,'1'].includes(meta.has_more); if(!hasMore)break;
            let next=meta.after_cursor||meta.after||null; if(!next&&links.next){try{next=new URL(links.next,location.origin).searchParams.get('page[after]')}catch{}}
            if(!next||next===after||cursors.has(next))break; cursors.add(next); after=next;
        }
        return out;
    }

    function normalizeSearchTicket(t, groupName) {
        return {id:t.id,created_at:t.created_at||null,updated_at:t.updated_at||null,solved_at:t.solved_at||null,status:t.status||'',subject:t.subject||'',description:t.description||'',group_id:t.group_id||null,group_name:groupName||'',assignee_id:t.assignee_id||null,requester_id:t.requester_id||null,submitter_id:t.submitter_id||null,priority:t.priority||null,type:t.type||null,tags:t.tags||[],via:t.via||null,custom_fields:t.custom_fields||[],ticket_form_id:t.ticket_form_id||null,brand_id:t.brand_id||null,conversation:null,conversation_loaded:false,conversation_error:null,url:`${location.origin}/agent/tickets/${t.id}`};
    }

    async function loadSelectedConversations() {
        if(state.exportRunning)return; const tickets=getSelectedTickets(); if(!tickets.length)return;
        state.exportRunning=true; state.exportCancelled=false; setExportRunningUi(true);
        try { await ensureConversationsLoaded(tickets); renderResults(); setExportStatus(`Conversations processed for ${tickets.length.toLocaleString()} selected tickets.`, true); }
        finally { state.exportRunning=false; setExportRunningUi(false); }
    }

    async function ensureConversationsLoaded(tickets) {
        const pending=tickets.filter(t=>!t.conversation_loaded&&!t.conversation_error); let cursor=0,done=tickets.length-pending.length;
        const includeAttachments=$('#zaec-attachments').value==='urls';
        const workers=Array.from({length:Math.min(COMMENT_CONCURRENCY,pending.length)},async()=>{while(!state.exportCancelled){const i=cursor++;if(i>=pending.length)return;const t=pending[i];try{t.conversation=await fetchComments(t.id,includeAttachments);t.conversation_loaded=true;t.conversation_error=null}catch(e){t.conversation=[];t.conversation_error=e.message}done++;setExportStatus(`Loading conversations… ${done}/${tickets.length}`)}});
        await Promise.all(workers);
    }

    async function uploadSelectedToKnowledgeBase() {
        if(state.exportRunning||state.busy)return; const tickets=getSelectedTickets(); if(!tickets.length)return;
        state.exportRunning=true; state.exportCancelled=false; setExportRunningUi(true);
        try {
            requireToken(); await ensureConversationsLoaded(tickets);
            if(state.exportCancelled)return;
            let imported=0,failed=0,chunks=0,embeddings=0,pii=0;
            for(let i=0;i<tickets.length;i+=IMPORT_BATCH_SIZE){const batch=tickets.slice(i,i+IMPORT_BATCH_SIZE).map(t=>buildCloudTicket(t));setExportStatus(`Uploading batch ${Math.floor(i/IMPORT_BATCH_SIZE)+1}/${Math.ceil(tickets.length/IMPORT_BATCH_SIZE)}…`);const result=await callSupabase(IMPORT_ENDPOINT,{tickets:batch});imported+=Number(result.imported||0);failed+=Number(result.failed||0);pii+=sumRedactions(result.redactions);for(const row of result.results||[]){chunks+=Number(row.chunks||0);embeddings+=Number(row.embeddings||0)}}
            setExportStatus(`KB upload complete: ${imported}/${tickets.length} tickets · ${chunks} chunks · ${embeddings} embeddings · PII ${pii}${failed?` · ${failed} failed`:''}`,failed===0);
        } catch(e){setExportStatus(e.message||String(e),false)}
        finally{state.exportRunning=false;setExportRunningUi(false)}
    }

    function buildCloudTicket(t) { return {id:Number(t.id),subject:t.subject||'',description:t.description||'',status:t.status||'',group_name:t.group_name||'',tags:t.tags||[],created_at:t.created_at||null,updated_at:t.updated_at||null,solved_at:t.solved_at||null,url:t.url||`${location.origin}/agent/tickets/${t.id}`,conversation:Array.isArray(t.conversation)?t.conversation:[]}; }

    async function exportSelectedJsonl() {
        if(state.exportRunning)return; const selected=getSelectedTickets(); if(!selected.length)return;
        state.exportRunning=true;state.exportCancelled=false;setExportRunningUi(true);
        try{await ensureConversationsLoaded(selected);if(state.exportCancelled)return;const mode=$('#zaec-comments').value;exportJsonl(selected.map(t=>buildExportTicket(t,mode)));setExportStatus(`Exported ${selected.length.toLocaleString()} tickets with conversations.`,true)}
        finally{state.exportRunning=false;setExportRunningUi(false)}
    }

    function buildExportTicket(t,mode){const conversation=Array.isArray(t.conversation)?t.conversation.filter(c=>mode==='all'||c.public):[];return {...t,conversation,derived:{conversation_length:conversation.length,public_comment_count:conversation.filter(c=>c.public).length,internal_note_count:conversation.filter(c=>!c.public).length}}}

    function renderResults(){const tbody=$('#zaec-results');tbody.textContent='';for(const t of state.tickets){const tr=document.createElement('tr'),date=t.solved_at||t.updated_at||t.created_at||'',conv=t.conversation_loaded?`${(t.conversation||[]).length} comments`:t.conversation_error?'Failed':'Not loaded';tr.innerHTML=`<td><input class="zaec-row-check" type="checkbox" data-id="${t.id}" ${state.selectedTicketIds.has(t.id)?'checked':''}></td><td><a class="zaec-link" href="${escapeHtml(t.url)}" target="_blank">${t.id}</a></td><td>${escapeHtml(formatDate(date))}</td><td>${escapeHtml(t.subject)}</td><td><span class="zaec-pill">${escapeHtml(t.status)}</span></td><td>${escapeHtml(t.group_name||t.group_id||'')}</td><td>${escapeHtml(conv)}</td>`;tbody.appendChild(tr)}panel.querySelectorAll('.zaec-row-check').forEach(c=>c.onchange=()=>{const id=Number(c.dataset.id);c.checked?state.selectedTicketIds.add(id):state.selectedTicketIds.delete(id);updateSelectionUi()});updateSelectionUi()}
    function selectAll(){state.tickets.forEach(t=>state.selectedTicketIds.add(t.id));panel.querySelectorAll('.zaec-row-check').forEach(c=>c.checked=true);updateSelectionUi()}
    function selectNone(){state.selectedTicketIds.clear();panel.querySelectorAll('.zaec-row-check').forEach(c=>c.checked=false);updateSelectionUi()}
    function getSelectedTickets(){return state.tickets.filter(t=>state.selectedTicketIds.has(t.id))}
    function updateSelectionUi(){const has=state.tickets.length>0,sel=state.selectedTicketIds.size;$('#zaec-load-comments').disabled=!sel||state.exportRunning;$('#zaec-upload-cloud').disabled=!sel||state.exportRunning;$('#zaec-export-jsonl').disabled=!sel||state.exportRunning;$('#zaec-export-csv').disabled=!sel||state.exportRunning;$('#zaec-select-all').disabled=!has||state.exportRunning;$('#zaec-select-none').disabled=!has||state.exportRunning;$('#zaec-check-all').disabled=!has||state.exportRunning;$('#zaec-check-all').checked=has&&sel===state.tickets.length;$('#zaec-upload-cloud').textContent=sel?`Upload selected (${sel}) to KB`:'Upload selected to KB'}
    function setExportRunningUi(r){$('#zaec-find').disabled=r;$('#zaec-cancel').disabled=!r;updateSelectionUi()}

    function exportJsonl(tickets){downloadBlob(tickets.map(t=>JSON.stringify(t)).join('\n'),`zendesk-tickets-${dateStamp()}.jsonl`,'application/x-ndjson;charset=utf-8')}
    function exportCsv(tickets){const h=['id','created_at','updated_at','solved_at','status','subject','group_id','group_name','assignee_id','priority','type','tags','conversation_loaded','conversation_count','url'],rows=[h.map(csvCell).join(',')];for(const t of tickets){const v={...t,tags:(t.tags||[]).join(' | '),conversation_count:Array.isArray(t.conversation)?t.conversation.length:''};rows.push(h.map(k=>csvCell(v[k])).join(','))}downloadBlob(rows.join('\n'),`zendesk-tickets-${dateStamp()}.csv`,'text/csv;charset=utf-8')}
    function csvCell(v){const s=v==null?'':String(v);return `"${s.replaceAll('"','""')}"`}
    function downloadBlob(c,n,t){const b=new Blob([c],{type:t}),u=URL.createObjectURL(b),a=document.createElement('a');a.href=u;a.download=n;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1000)}

    async function openDb(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE,{keyPath:'id'})};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
    async function dbPutMany(items){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE);items.forEach(x=>store.put(x));tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)})}
    async function dbGetAll(){const db=await openDb();return new Promise((resolve,reject)=>{const r=db.transaction(STORE,'readonly').objectStore(STORE).getAll();r.onsuccess=()=>{db.close();resolve(r.result||[])};r.onerror=()=>reject(r.error)})}
    async function dbClear(){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).clear();tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)})}
    async function refreshKnowledgeCount(){try{const all=await dbGetAll();state.kbCount=all.length;$('#zaec-kb-count').textContent=`${all.length.toLocaleString()} tickets`}catch{$('#zaec-kb-count').textContent='Unavailable'}}
    async function importKnowledgeFiles(){const files=[...$('#zaec-kb-files').files];if(!files.length){setExportStatus('Choose one or more JSONL files first.');return}try{let imported=[];for(const file of files){const text=await file.text();const rows=file.name.toLowerCase().endsWith('.json')&&!file.name.toLowerCase().endsWith('.jsonl')?JSON.parse(text):text.split(/\r?\n/).filter(Boolean).map((line,i)=>{try{return JSON.parse(line)}catch{throw new Error(`${file.name}: invalid JSON on line ${i+1}`)}});const arr=Array.isArray(rows)?rows:[rows];imported.push(...arr.filter(x=>x&&x.id).map(buildKnowledgeRecord))}await dbPutMany(imported);await refreshKnowledgeCount();setExportStatus(`Imported/updated ${imported.length.toLocaleString()} local knowledge-base tickets.`,true)}catch(e){setExportStatus(`Local knowledge-base import failed: ${e.message}`,false)}}
    async function clearKnowledgeBase(){if(!confirm('Clear all locally stored historical Zendesk tickets?'))return;await dbClear();await refreshKnowledgeCount();setExportStatus('Local knowledge base cleared.',true)}
    function buildKnowledgeRecord(ticket){const conv=Array.isArray(ticket.conversation)?ticket.conversation:[];const resolutionSnippets=extractResolutionSnippets(ticket);const confirmed=hasResolutionConfirmation(conv);const evidenceQuality=resolutionSnippets.length?(confirmed?'strong':'moderate'):'weak';return {id:Number(ticket.id),subject:ticket.subject||'',description:ticket.description||'',status:ticket.status||'',group_name:ticket.group_name||'',tags:ticket.tags||[],url:ticket.url||`${location.origin}/agent/tickets/${ticket.id}`,conversation:conv,derived:ticket.derived||{},search_text:buildSearchText(ticket),resolution_snippets:resolutionSnippets,evidence_quality:evidenceQuality,imported_at:new Date().toISOString()}}
    function buildSearchText(ticket){const conv=(ticket.conversation||[]).map(c=>c.body||'').join(' ');return [ticket.subject,ticket.description,(ticket.tags||[]).join(' '),conv].filter(Boolean).join(' ').slice(0,30000)}
    function extractResolutionSnippets(ticket){const re=/(fixed|resolved|working now|works now|cause|caused by|because|due to|missing|added|updated|corrected|changed|removed|workaround|solution|skyldes|rettet|løst|virker nu|udgået|discontinued|price increase|nightly|daily run|sync)/i;return (ticket.conversation||[]).filter(c=>re.test(c.body||'')&&(c.author?.role==='agent'||c.author?.role==='admin'||c.public===false)).map(c=>({comment_id:c.id,created_at:c.created_at,public:c.public,author:c.author?.name||'',text:cleanSnippet(c.body||'',520)})).slice(-6)}
    function hasResolutionConfirmation(conv){const re=/(works now|working now|fixed now|resolved|solved|issue is gone|not happening anymore|got solved|virker nu|løst|thank.*work)/i;return conv.some(c=>re.test(c.body||''))}
    function cleanSnippet(text,max){return String(text).replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim().slice(0,max)}

    async function analyzeLocalEvidence(){const id=currentTicketId(),box=$('#zaec-local-evidence');box.style.display='block';box.textContent='Loading local evidence…';if(!id){box.textContent='Open a Zendesk ticket first.';return}try{const kb=await dbGetAll();if(!kb.length){box.textContent='No local knowledge base imported.';return}const ticket=await loadCurrentTicket();const matches=findSimilar(ticket,kb.filter(x=>Number(x.id)!==id)).filter(m=>m.similarity>=.10).slice(0,5);if(!matches.length){box.textContent='No related local historical tickets found.';return}box.innerHTML=matches.map(m=>`<div class="zaec-local-card"><a class="zaec-link" target="_blank" rel="noopener" href="${escapeHtml(m.url)}">#${m.id} — ${escapeHtml(m.subject)}</a><div class="zaec-help">Similarity ${(m.similarity*100).toFixed(0)}% · evidence ${escapeHtml(m.evidence_quality)}</div>${(m.resolution_snippets||[]).slice(-2).map(s=>`<div style="margin-top:5px">${escapeHtml(s.text)}</div>`).join('')}</div>`).join('')}catch(e){box.textContent=`Local analysis failed: ${e.message}`}}
    function findSimilar(ticket,kb){const currentSubject=tokenFreq(ticket.subject||''),currentAll=tokenFreq(buildSearchText(ticket));return kb.map(item=>{const s=cosine(currentSubject,tokenFreq(item.subject||'')),a=cosine(currentAll,tokenFreq(item.search_text||''));const similarity=Math.min(1,s*.55+a*.45);const q=item.evidence_quality==='strong'?1:item.evidence_quality==='moderate'?.72:.32;return {...item,similarity,evidence_score:similarity*q}}).sort((x,y)=>y.evidence_score-x.evidence_score).slice(0,8)}
    const STOP=new Set('the a an and or to of in on for with is are was were be been being this that it its i we you they our your my from at as by can could would should have has had do does did not no but if then than into about after before customer customers ticket tickets hi hello thanks thank best regards team bolia'.split(' '));
    function tokenFreq(text){const m=new Map();String(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').match(/[a-z0-9_-]{3,}/g)?.forEach(t=>{if(!STOP.has(t))m.set(t,(m.get(t)||0)+1)});return m}
    function cosine(a,b){let dot=0,aa=0,bb=0;a.forEach(v=>aa+=v*v);b.forEach(v=>bb+=v*v);a.forEach((v,k)=>dot+=v*(b.get(k)||0));return aa&&bb?dot/Math.sqrt(aa*bb):0}

    function formatDate(v){if(!v)return'';const d=new Date(v);return Number.isNaN(d.getTime())?v:d.toLocaleString()}
    function escapeHtml(v){return String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;')}
    function dateStamp(){return new Date().toISOString().slice(0,10)}
})();
