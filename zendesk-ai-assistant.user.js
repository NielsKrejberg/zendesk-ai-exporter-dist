// ==UserScript==
// @name         Zendesk AI Assistant
// @namespace    https://github.com/NielsKrejberg/zendesk-ai-exporter
// @version      0.7.0
// @description  Zendesk AI support assistant with built-in ticket search, export, Supabase KB upload, and versioned reference knowledge.
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
    const REFERENCE_IMPORT_ENDPOINT = `${SUPABASE_BASE}/import-reference-knowledge`;
    const LOGIN_ENDPOINT = `${SUPABASE_BASE}/request-login`;
    const TOKEN_KEY = 'zae_supabase_access_token';
    const COMMENT_CONCURRENCY = 4;
    const IMPORT_BATCH_SIZE = 20;

    captureLoginCallback();

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
      .zaec-head-actions,.zaec-tools,.zaec-input-row,.zaec-tabs,.zaec-actions,.zaec-reference-row{display:flex;gap:7px;align-items:center}
      #${APP_ID} button{border:1px solid rgba(255,255,255,.14);border-radius:6px;background:rgba(255,255,255,.08);color:#fff;padding:7px 9px;cursor:pointer}#${APP_ID} button:hover{background:rgba(255,255,255,.13)}#${APP_ID} button:disabled{opacity:.45;cursor:default}
      .zaec-primary{background:rgba(117,190,139,.20)!important;border-color:rgba(155,229,178,.35)!important}
      .zaec-tabs{padding:7px 11px;border-bottom:1px solid rgba(148,210,168,.14)}.zaec-tab{min-width:74px}.zaec-tab.active{background:rgba(117,190,139,.22)!important;border-color:rgba(155,229,178,.38)!important}
      .zaec-view{flex:1;min-height:0}.zaec-chat-view{display:flex;flex-direction:column}.zaec-export-view{display:none;flex-direction:column;min-height:0}
      .zaec-tools{padding:8px 11px;border-bottom:1px solid rgba(148,210,168,.14);flex-wrap:wrap}.zaec-status{margin-left:auto;color:rgba(255,255,255,.56);font-size:11px;max-width:420px;text-align:right;overflow-wrap:anywhere}.zaec-status-panel{min-height:30px;margin:0 0 8px;padding:6px 8px;display:flex;align-items:center;gap:8px;border:1px solid rgba(148,210,168,.12);border-radius:7px;background:rgba(0,0,0,.10);color:rgba(255,255,255,.66);font-size:11px;overflow-wrap:anywhere;transition:background .18s ease,border-color .18s ease}.zaec-status-panel.zaec-working{background:rgba(117,190,139,.10);border-color:rgba(155,229,178,.24);color:#dff6e6}.zaec-status-panel.zaec-working::before{content:'';width:13px;height:13px;flex:0 0 13px;border:2px solid rgba(223,246,230,.22);border-top-color:#dff6e6;border-radius:50%;animation:zaec-spin .8s linear infinite}.zaec-status-panel.zaec-working::after{content:'•••';margin-left:auto;letter-spacing:2px;animation:zaec-pulse 1.2s ease-in-out infinite}.zaec-error{color:#ffd3c8}.zaec-ok{color:#d9f5e2}@keyframes zaec-spin{to{transform:rotate(360deg)}}@keyframes zaec-pulse{0%,100%{opacity:.25}50%{opacity:1}}
      .zaec-chat{flex:1;min-height:0;overflow:auto;padding:12px}.zaec-msg{margin:0 0 11px;padding:9px 10px;border-radius:9px;white-space:pre-wrap;overflow-wrap:anywhere}.zaec-user{margin-left:45px;background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.10)}.zaec-assistant{margin-right:28px;background:rgba(37,84,57,.54);border:1px solid rgba(148,210,168,.16)}
      .zaec-role{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:rgba(255,255,255,.48);margin-bottom:4px}.zaec-sources-details{margin-top:8px;padding-top:7px;border-top:1px solid rgba(255,255,255,.10);white-space:normal}.zaec-sources-details summary{display:flex;align-items:center;gap:6px;width:max-content;max-width:100%;cursor:pointer;color:rgba(255,255,255,.66);font-size:11px;user-select:none;list-style:none}.zaec-sources-details summary::-webkit-details-marker{display:none}.zaec-sources-details summary::before{content:'▶';font-size:8px;transition:transform .14s ease}.zaec-sources-details[open] summary::before{transform:rotate(90deg)}.zaec-sources{display:flex;gap:5px;flex-wrap:wrap;margin-top:7px}.zaec-source{display:inline-flex;padding:3px 6px;border-radius:999px;border:1px solid rgba(155,229,178,.22);background:rgba(117,190,139,.12);color:#dff6e6;text-decoration:none;font-size:11px}.zaec-reference-source{border-style:dashed;background:rgba(172,214,185,.08)}
      .zaec-reuse-box{margin-top:9px;padding:9px 10px;border:1px solid rgba(155,229,178,.34);border-radius:8px;background:rgba(117,190,139,.11);white-space:normal}.zaec-reuse-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px}.zaec-reuse-title{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;color:#dff6e6}.zaec-reuse-title a{color:#dff6e6;text-decoration:none}.zaec-reuse-solution{padding:8px;border:1px solid rgba(255,255,255,.10);border-radius:6px;background:rgba(0,0,0,.15);white-space:pre-wrap;overflow-wrap:anywhere;color:rgba(255,255,255,.92)}.zaec-copy-solution{flex:0 0 auto;padding:5px 8px!important;font-size:11px}
      .zaec-empty{padding:20px 12px;color:rgba(255,255,255,.58);text-align:center}.zaec-compose{padding:10px;border-top:1px solid rgba(148,210,168,.18)}#${APP_ID} textarea{resize:vertical}.zaec-input-row{margin-top:7px;justify-content:flex-end}
      .zaec-export-body{padding:10px 12px 12px;overflow:auto;display:flex;flex-direction:column;min-height:0;height:100%}.zaec-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 10px}.zaec-section{margin-top:9px;flex:0 0 auto}.zaec-actions{flex-wrap:wrap;margin-top:9px}
      .zaec-reference-box{padding:9px 10px;border:1px solid rgba(148,210,168,.18);border-radius:8px;background:rgba(0,0,0,.11)}.zaec-reference-row{margin-top:7px;flex-wrap:wrap}.zaec-reference-row input[type=file]{flex:1;min-width:260px}
      #${APP_ID} label{display:grid;gap:4px;color:rgba(255,255,255,.84);min-width:0}#${APP_ID} input,#${APP_ID} select,#${APP_ID} textarea{width:100%;min-width:0;border:1px solid rgba(255,255,255,.12);border-radius:6px;background:rgba(0,0,0,.18);color:#fff;padding:7px 8px;outline:none}#${APP_ID} input,#${APP_ID} select{min-height:34px}.zaec-compose textarea{min-height:76px;max-height:180px}.zaec-export-body textarea{min-height:48px;max-height:110px}
      .zaec-table-wrap{margin-top:9px;flex:1 0 220px;min-height:220px;overflow:auto;border:1px solid rgba(148,210,168,.16);border-radius:7px}.zaec-table-wrap table{width:100%;border-collapse:collapse;min-width:980px}.zaec-table-wrap th{position:sticky;top:0;z-index:1;background:rgba(20,63,42,.98);text-align:left}.zaec-table-wrap th,.zaec-table-wrap td{padding:7px 8px;border-bottom:1px solid rgba(255,255,255,.08);vertical-align:top}.zaec-link{color:#d9f5e2;text-decoration:none;font-weight:600}.zaec-pill{display:inline-block;padding:2px 6px;border-radius:999px;background:rgba(125,200,148,.15);border:1px solid rgba(145,219,168,.18)}
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
        <div class="zaec-tools"><button id="zaec-add-kb" class="zaec-primary">Add current ticket to KB</button><button id="zaec-clear">Clear chat</button></div>
        <div class="zaec-chat" id="zaec-chat"><div class="zaec-empty">Ask about the current ticket or use Export to add historical tickets and reference knowledge.</div></div>
        <div class="zaec-compose"><div class="zaec-status-panel zaec-ok" id="zaec-status" role="status" aria-live="polite">Ready</div><textarea id="zaec-input" placeholder="Ask about this ticket…">Help me solve this</textarea><div class="zaec-input-row"><button id="zaec-send" class="zaec-primary">Send</button></div></div>
      </div>
      <div id="zaec-view-export" class="zaec-view zaec-export-view">
        <div class="zaec-export-body">
          <div class="zaec-section zaec-reference-box">
            <strong>Reference knowledge</strong>
            <div class="zaec-help">Upload versioned non-Zendesk reference snapshots. A newer snapshot with the same source key supersedes the older one for retrieval.</div>
            <div class="zaec-reference-row"><input type="file" id="zaec-reference-file" accept=".json,application/json"><button id="zaec-upload-reference" class="zaec-primary">Upload reference snapshot</button></div>
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
    $('#zaec-settings').onclick = requestLoginLink;
    $('#zaec-clear').onclick = clearChat;
    $('#zaec-add-kb').onclick = addCurrentTicketToKnowledgeBase;
    $('#zaec-send').onclick = sendMessage;
    $('#zaec-tab-chat').onclick = () => switchView('chat');
    $('#zaec-tab-export').onclick = () => switchView('export');
    $('#zaec-input').addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    $('#zaec-upload-reference').onclick = uploadReferencePackage;
    $('#zaec-find').onclick = findTickets;
    $('#zaec-load-comments').onclick = loadSelectedConversations;
    $('#zaec-cancel').onclick = () => { state.exportCancelled = true; setExportStatus('Cancellation requested…'); };
    $('#zaec-select-all').onclick = selectAll;
    $('#zaec-select-none').onclick = selectNone;
    $('#zaec-check-all').onchange = e => e.target.checked ? selectAll() : selectNone();
    $('#zaec-upload-cloud').onclick = uploadSelectedToKnowledgeBase;
    $('#zaec-export-jsonl').onclick = exportSelectedJsonl;
    $('#zaec-export-csv').onclick = () => exportCsv(getSelectedTickets());

    setDefaultFilters();
    refreshContext();
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
        if (id !== state.ticketId) { state.ticketId = id; state.messages = []; renderChat(); }
        $('#zaec-ticket-label').textContent = id ? `Ticket #${id}` : 'Zendesk';
        if (!state.busy) $('#zaec-add-kb').disabled = !id;
    }

    function getToken() {
        const token = String(GM_getValue(TOKEN_KEY, '') || '').trim();
        try {
            const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
            if (!payload.exp || payload.exp * 1000 <= Date.now() + 30000) { GM_setValue(TOKEN_KEY, ''); return ''; }
        } catch { GM_setValue(TOKEN_KEY, ''); return ''; }
        return token;
    }

    function captureLoginCallback() {
        const params = new URLSearchParams(location.hash.slice(1));
        const token = params.get('access_token');
        if (!token) return;
        GM_setValue(TOKEN_KEY, token);
        history.replaceState(null, '', location.pathname + location.search);
        setTimeout(() => setStatus('Signed in securely', true), 0);
    }

    function requestLoginLink() {
        const email = prompt('Enter your Bolia e-mail address. A sign-in link is sent only after you request it.');
        if (email === null || !email.trim()) return;
        GM_xmlhttpRequest({
            method: 'POST',
            url: LOGIN_ENDPOINT,
            headers: { 'Content-Type': 'application/json' },
            data: JSON.stringify({ email: email.trim(), redirectTo: location.origin + location.pathname + location.search }),
            onload: response => {
                let data = {};
                try { data = JSON.parse(response.responseText || '{}'); } catch {}
                if (response.status >= 200 && response.status < 300) {
                    setStatus(data.message || 'If your account is approved, a sign-in link has been sent.', true);
                } else {
                    setStatus(data.error || 'Could not request a sign-in link.', false);
                }
            },
            onerror: () => setStatus('Could not request a sign-in link.', false),
        });
    }

    function requireToken() {
        const token = getToken();
        if (!token) {
            requestLoginLink();
            throw new Error('Sign-in link requested. Open it from your e-mail, then try again.');
        }
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

    function callSupabase(endpoint, body, timeout = 120000) {
        const token = requireToken();
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST', url: endpoint,
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                data: JSON.stringify(body), timeout,
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

    async function uploadReferencePackage() {
        if (state.busy || state.exportRunning) return;
        const file = $('#zaec-reference-file').files?.[0];
        if (!file) { setExportStatus('Choose a reference snapshot JSON file first.', false); return; }
        state.busy = true;
        $('#zaec-upload-reference').disabled = true;
        try {
            setExportStatus(`Reading ${file.name}…`);
            let payload;
            try { payload = JSON.parse(await file.text()); }
            catch { throw new Error('Reference snapshot must be valid JSON.'); }
            if (!Array.isArray(payload?.sources) || !payload.sources.length) throw new Error('Reference package contains no sources.');
            const sourceCount = payload.sources.length;
            const recordCount = payload.sources.reduce((sum, source) => sum + (Array.isArray(source.records) ? source.records.length : 0), 0);
            setExportStatus(`Uploading ${sourceCount} sources / ${recordCount.toLocaleString()} records…`);
            const result = await callSupabase(REFERENCE_IMPORT_ENDPOINT, payload, 240000);
            const imported = (result.results || []).reduce((sum, row) => sum + Number(row.records || 0), 0);
            setExportStatus(`Reference upload complete: ${result.imported_sources || sourceCount} sources · ${imported.toLocaleString()} records · PII ${sumRedactions(result.redactions)}`, true);
        } catch (e) {
            setExportStatus(e.message || String(e), false);
        } finally {
            state.busy = false;
            $('#zaec-upload-reference').disabled = false;
        }
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
            const progressSteps = [
                'Searching knowledge base…',
                'Comparing previous Zendesk tickets…',
                'Checking PIM and website reference data…',
                'Preparing answer…'
            ];
            let progressIndex = 0;
            setStatus(progressSteps[progressIndex]);
            const progressTimer = setInterval(() => {
                if (!state.busy) return;
                progressIndex = (progressIndex + 1) % progressSteps.length;
                setStatus(progressSteps[progressIndex]);
            }, 1800);
            try {
                const history = state.messages.slice(0, -1).slice(-4).map(({ role, content }) => ({ role, content }));
                const result = await callSupabase(CHAT_ENDPOINT, { ticket, message: text, history });
                clearInterval(progressTimer);
                const reuseSuggestion = result.reuseSuggestion || extractReuseSuggestion(result.answer || '');
                state.messages.push({ role: 'assistant', content: result.answer || '', sources: result.sources || [], references: result.references || [], reuseSuggestion });
                renderChat();
                const refCount = result.references?.length || 0;
                setStatus(`${result.sources?.length || 0} historical tickets · ${refCount} reference records`, true);
            } finally {
                clearInterval(progressTimer);
            }
        } catch (e) {
            state.messages.push({ role: 'assistant', content: `Error: ${e.message || String(e)}`, error: true, sources: [], references: [], reuseSuggestion: null });
            renderChat();
            setStatus(e.message || String(e), false);
        } finally { setBusy(false); }
    }

    function renderChat() {
        const el = $('#zaec-chat');
        if (!state.messages.length) { el.innerHTML = '<div class="zaec-empty">Ask about the current ticket or use Export to add historical tickets and reference knowledge.</div>'; return; }
        el.innerHTML = '';
        for (const msg of state.messages) {
            const box = document.createElement('div'); box.className = `zaec-msg ${msg.role === 'user' ? 'zaec-user' : 'zaec-assistant'}`;
            const role = document.createElement('div'); role.className = 'zaec-role'; role.textContent = msg.role === 'user' ? 'You' : 'Assistant';
            const body = document.createElement('div'); renderAnswer(body, msg.content || ''); box.append(role, body);
            if (msg.reuseSuggestion?.solution) box.appendChild(renderReuseSuggestion(msg.reuseSuggestion));
            if ((Array.isArray(msg.sources) && msg.sources.length) || (Array.isArray(msg.references) && msg.references.length)) {
                const details = document.createElement('details'); details.className = 'zaec-sources-details';
                const summary = document.createElement('summary');
                const ticketCount = msg.sources?.length || 0, referenceCount = msg.references?.length || 0;
                const parts = [];
                if (ticketCount) parts.push(`${ticketCount} Zendesk ticket${ticketCount === 1 ? '' : 's'}`);
                if (referenceCount) parts.push(`${referenceCount} reference${referenceCount === 1 ? '' : 's'}`);
                summary.textContent = `Sources · ${parts.join(' · ')}`;
                const sources = document.createElement('div'); sources.className = 'zaec-sources';
                for (const s of msg.sources || []) {
                    const a = document.createElement('a'); a.className = 'zaec-source'; a.href = s.url || `${location.origin}/agent/tickets/${s.ticketId}`; a.target = '_blank'; a.rel = 'noopener'; a.textContent = `#${s.ticketId}`; a.title = `${s.subject || ''} · score ${Math.round(Number(s.score || 0) * 100)}%`; sources.appendChild(a);
                }
                for (const r of msg.references || []) {
                    const span = document.createElement('span'); span.className = 'zaec-source zaec-reference-source'; span.textContent = `${r.sourceTitle || r.sourceKey} · ${r.snapshotDate}`; span.title = `${r.recordKey || ''}${r.score != null ? ` · score ${Math.round(Number(r.score || 0) * 100)}%` : ''}`; sources.appendChild(span);
                }
                details.append(summary, sources);
                box.appendChild(details);
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

    function extractReuseSuggestion(text) {
        const reuse = String(text || '').match(/REUSE SUGGESTION:[^\n]*\[#(\d+)\][^\n]*/i);
        if (!reuse) return null;
        const ticketId = Number(reuse[1]);
        if (!Number.isFinite(ticketId)) return null;
        const previous = String(text || '').match(new RegExp(`\\[#${ticketId}\\][^\\n]*?Resolution:\\s*([^\\n]+)`, 'i'));
        let solution = previous?.[1]?.trim() || '';
        if (!solution) {
            const blocks = String(text || '').match(/SOLUTION \d+ —[\s\S]*?(?=\nSOLUTION \d+ —|\nSUGGESTED NEXT CHECK|\nRELEVANT TICKETS|$)/g) || [];
            solution = (blocks.find(block => block.includes(`[#${ticketId}]`)) || blocks[0] || '').trim();
        }
        return solution ? { ticketId, solution, url: `${location.origin}/agent/tickets/${ticketId}` } : null;
    }

    function renderReuseSuggestion(suggestion) {
        const box = document.createElement('div'); box.className = 'zaec-reuse-box';
        const head = document.createElement('div'); head.className = 'zaec-reuse-head';
        const title = document.createElement('div'); title.className = 'zaec-reuse-title'; title.appendChild(document.createTextNode('Reusable solution from '));
        const link = document.createElement('a'); link.href = suggestion.url || `${location.origin}/agent/tickets/${suggestion.ticketId}`; link.target = '_blank'; link.rel = 'noopener'; link.textContent = `#${suggestion.ticketId}`; title.appendChild(link);
        const copy = document.createElement('button'); copy.className = 'zaec-copy-solution'; copy.textContent = 'Copy solution';
        copy.onclick = async () => {
            const ok = await copyText(suggestion.solution || '');
            copy.textContent = ok ? 'Copied' : 'Copy failed';
            setTimeout(() => copy.textContent = 'Copy solution', 1400);
        };
        const body = document.createElement('div'); body.className = 'zaec-reuse-solution'; body.textContent = suggestion.solution || '';
        head.append(title, copy); box.append(head, body);
        return box;
    }

    async function copyText(text) {
        if (!text) return false;
        try {
            if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
        } catch {}
        try {
            const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; ta.style.pointerEvents = 'none'; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok;
        } catch { return false; }
    }

    function clearChat() { state.messages = []; renderChat(); setStatus('Ready', true); }
    function sumRedactions(r) { return Object.values(r || {}).reduce((a, b) => a + Number(b || 0), 0); }
    function setBusy(value) { state.busy = value; $('#zaec-send').disabled = value; $('#zaec-add-kb').disabled = value || !currentTicketId(); $('#zaec-upload-reference').disabled = value; }
    function setStatus(text, ok = null) { const el = $('#zaec-status'); el.textContent = text; el.className = `zaec-status-panel ${state.busy && ok === null ? 'zaec-working' : ''} ${ok === true ? 'zaec-ok' : ok === false ? 'zaec-error' : ''}`.trim(); }
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
    function setExportRunningUi(r){$('#zaec-find').disabled=r;$('#zaec-cancel').disabled=!r;$('#zaec-upload-reference').disabled=r||state.busy;updateSelectionUi()}

    function exportJsonl(tickets){downloadBlob(tickets.map(t=>JSON.stringify(t)).join('\n'),`zendesk-tickets-${dateStamp()}.jsonl`,'application/x-ndjson;charset=utf-8')}
    function exportCsv(tickets){const h=['id','created_at','updated_at','solved_at','status','subject','group_id','group_name','assignee_id','priority','type','tags','conversation_loaded','conversation_count','url'],rows=[h.map(csvCell).join(',')];for(const t of tickets){const v={...t,tags:(t.tags||[]).join(' | '),conversation_count:Array.isArray(t.conversation)?t.conversation.length:''};rows.push(h.map(k=>csvCell(v[k])).join(','))}downloadBlob(rows.join('\n'),`zendesk-tickets-${dateStamp()}.csv`,'text/csv;charset=utf-8')}
    function csvCell(v){const s=v==null?'':String(v);return `"${s.replaceAll('"','""')}"`}
    function downloadBlob(c,n,t){const b=new Blob([c],{type:t}),u=URL.createObjectURL(b),a=document.createElement('a');a.href=u;a.download=n;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1000)}

    function formatDate(v){if(!v)return'';const d=new Date(v);return Number.isNaN(d.getTime())?v:d.toLocaleString()}
    function escapeHtml(v){return String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;')}
    function dateStamp(){return new Date().toISOString().slice(0,10)}
})();