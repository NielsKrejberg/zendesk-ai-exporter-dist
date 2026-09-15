// ==UserScript==
// @name         Zendesk AI Assistant
// @namespace    https://github.com/NielsKrejberg/zendesk-ai-exporter
// @version      0.2.0
// @description  Chat with a Supabase-backed Zendesk support knowledge base directly inside Zendesk.
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
    const EXPORTER_ID = 'zendesk-ai-exporter';
    const SUPABASE_BASE = 'https://gdpukysdcaoxtgqjkesv.supabase.co/functions/v1';
    const CHAT_ENDPOINT = `${SUPABASE_BASE}/zendesk-chat`;
    const IMPORT_ENDPOINT = `${SUPABASE_BASE}/import-zendesk`;
    const TOKEN_KEY = 'zae_supabase_import_token';
    const LOAD_CONCURRENCY = 4;
    const IMPORT_BATCH_SIZE = 20;

    if (document.getElementById(APP_ID)) return;

    const state = { ticketId: null, messages: [], busy: false };

    const style = document.createElement('style');
    style.textContent = `
      #${APP_ID},#${APP_ID}-toggle{font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#fff}
      #${APP_ID}-toggle{position:fixed;z-index:2147483644;top:61px;right:18px;border:1px solid rgba(155,229,178,.28);border-radius:7px;background:rgba(20,63,42,.86);backdrop-filter:blur(12px);color:#fff;padding:8px 11px;cursor:pointer;box-shadow:0 8px 28px rgba(0,0,0,.25);display:none}
      #${APP_ID}{position:fixed;z-index:2147483646;top:12px;right:12px;width:min(560px,calc(100vw - 24px));height:calc(100vh - 24px);display:none;flex-direction:column;background:rgba(15,48,32,.93);border:1px solid rgba(148,210,168,.25);border-radius:12px;box-shadow:0 16px 44px rgba(0,0,0,.38);backdrop-filter:blur(14px);overflow:hidden}
      #${APP_ID} *{box-sizing:border-box}.zaec-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 13px;border-bottom:1px solid rgba(148,210,168,.18)}
      .zaec-title{font-size:15px;font-weight:700}.zaec-sub{font-size:11px;color:rgba(255,255,255,.58)}.zaec-head-actions,.zaec-tools,.zaec-input-row{display:flex;gap:7px;align-items:center}
      #${APP_ID} button{border:1px solid rgba(255,255,255,.14);border-radius:6px;background:rgba(255,255,255,.08);color:#fff;padding:7px 9px;cursor:pointer}#${APP_ID} button:hover{background:rgba(255,255,255,.13)}#${APP_ID} button:disabled{opacity:.45;cursor:default}
      .zaec-tools{padding:8px 11px;border-bottom:1px solid rgba(148,210,168,.14);flex-wrap:wrap}.zaec-primary{background:rgba(117,190,139,.20)!important;border-color:rgba(155,229,178,.35)!important}.zaec-status{margin-left:auto;color:rgba(255,255,255,.56);font-size:11px;max-width:300px;text-align:right;overflow-wrap:anywhere}
      .zaec-chat{flex:1;min-height:0;overflow:auto;padding:12px}.zaec-msg{margin:0 0 11px;padding:9px 10px;border-radius:9px;white-space:pre-wrap;overflow-wrap:anywhere}.zaec-user{margin-left:45px;background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.10)}.zaec-assistant{margin-right:28px;background:rgba(37,84,57,.54);border:1px solid rgba(148,210,168,.16)}
      .zaec-role{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:rgba(255,255,255,.48);margin-bottom:4px}.zaec-sources{margin-top:8px;padding-top:7px;border-top:1px solid rgba(255,255,255,.10);display:flex;gap:5px;flex-wrap:wrap}.zaec-source{display:inline-flex;padding:3px 6px;border-radius:999px;border:1px solid rgba(155,229,178,.22);background:rgba(117,190,139,.12);color:#dff6e6;text-decoration:none;font-size:11px}
      .zaec-empty{padding:20px 12px;color:rgba(255,255,255,.58);text-align:center}.zaec-compose{padding:10px;border-top:1px solid rgba(148,210,168,.18)}#${APP_ID} textarea{width:100%;min-height:76px;max-height:180px;resize:vertical;border:1px solid rgba(255,255,255,.13);border-radius:8px;background:rgba(0,0,0,.18);color:#fff;padding:9px;outline:none}.zaec-input-row{margin-top:7px;justify-content:flex-end}.zaec-error{color:#ffd3c8}.zaec-ok{color:#d9f5e2}
      @media(max-width:700px){#${APP_ID}{top:6px;right:6px;width:calc(100vw - 12px);height:calc(100vh - 12px)}}`;
    document.head.appendChild(style);

    const toggle = document.createElement('button');
    toggle.id = `${APP_ID}-toggle`;
    toggle.textContent = 'AI Assistant';
    document.body.appendChild(toggle);

    const panel = document.createElement('div');
    panel.id = APP_ID;
    panel.innerHTML = `
      <div class="zaec-head"><div><div class="zaec-title">Zendesk AI Assistant</div><div class="zaec-sub" id="zaec-ticket-label">Ready</div></div><div class="zaec-head-actions"><button id="zaec-settings" title="Configure access token">⚙</button><button id="zaec-close">×</button></div></div>
      <div class="zaec-tools">
        <button id="zaec-add-kb" class="zaec-primary">Add current ticket to KB</button>
        <button id="zaec-add-exporter" class="zaec-primary">Upload exporter selection to KB</button>
        <button id="zaec-clear">Clear chat</button>
        <span class="zaec-status" id="zaec-status">Ready</span>
      </div>
      <div class="zaec-chat" id="zaec-chat"><div class="zaec-empty">Ask about the current ticket or upload selected tickets from Zendesk AI Exporter.</div></div>
      <div class="zaec-compose"><textarea id="zaec-input" placeholder="Ask about this ticket…"></textarea><div class="zaec-input-row"><button id="zaec-send" class="zaec-primary">Send</button></div></div>`;
    document.body.appendChild(panel);

    const $ = s => panel.querySelector(s);
    toggle.onclick = () => panel.style.display = panel.style.display === 'flex' ? 'none' : 'flex';
    $('#zaec-close').onclick = () => panel.style.display = 'none';
    $('#zaec-settings').onclick = configureToken;
    $('#zaec-clear').onclick = clearChat;
    $('#zaec-add-kb').onclick = addCurrentTicketToKnowledgeBase;
    $('#zaec-add-exporter').onclick = addExporterSelectionToKnowledgeBase;
    $('#zaec-send').onclick = sendMessage;
    $('#zaec-input').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendMessage(); });

    function currentTicketId() {
        const m = location.pathname.match(/\/agent\/tickets\/(\d+)/);
        return m ? Number(m[1]) : null;
    }

    function exporterSelectedIds() {
        return [...document.querySelectorAll(`#${EXPORTER_ID} .zae-row-check:checked`)]
            .map(el => Number(el.dataset.id))
            .filter(Number.isFinite);
    }

    function refreshContext() {
        const id = currentTicketId();
        const exporterPresent = !!document.getElementById(EXPORTER_ID);
        const selectedCount = exporterSelectedIds().length;
        toggle.style.display = id || exporterPresent ? 'block' : 'none';
        if (id !== state.ticketId) { state.ticketId = id; state.messages = []; renderChat(); }
        $('#zaec-ticket-label').textContent = id ? `Ticket #${id}` : exporterPresent ? 'Exporter integration' : 'Ready';
        $('#zaec-add-exporter').textContent = selectedCount ? `Upload exporter selection (${selectedCount})` : 'Upload exporter selection to KB';
        if (!state.busy) {
            $('#zaec-add-kb').disabled = !id;
            $('#zaec-add-exporter').disabled = !selectedCount;
        }
    }
    setInterval(refreshContext, 800);
    refreshContext();

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

    async function fetchComments(ticketId) {
        const comments = [], users = new Map(), seen = new Set();
        let next = `/api/v2/tickets/${ticketId}/comments.json?include=users&include_inline_images=true&page[size]=100&sort_order=asc`;
        while (next) {
            const d = await zendeskGet(next);
            for (const u of d.users || []) users.set(Number(u.id), { id: u.id, name: u.name || '', role: u.role || '' });
            for (const c of d.comments || []) comments.push({ id: c.id, created_at: c.created_at || null, public: c.public === true, author: users.get(Number(c.author_id)) || null, body: c.plain_body || c.body || '' });
            if (![true, 'true', 1, '1'].includes(d.meta?.has_more)) break;
            let candidate = d.links?.next || null;
            if (!candidate && (d.meta?.after_cursor || d.meta?.after)) candidate = `/api/v2/tickets/${ticketId}/comments.json?include=users&include_inline_images=true&page[size]=100&sort_order=asc&page[after]=${encodeURIComponent(d.meta.after_cursor || d.meta.after)}`;
            if (!candidate || seen.has(candidate)) break;
            seen.add(candidate);
            const u = new URL(candidate, location.origin);
            if (u.origin !== location.origin) throw new Error('Unexpected Zendesk pagination host.');
            next = u.pathname + u.search;
        }
        return comments;
    }

    async function loadTicket(ticketId) {
        const d = await zendeskGet(`/api/v2/tickets/${ticketId}.json`);
        const t = d.ticket || d;
        return {
            id: Number(t.id), subject: t.subject || '', description: t.description || '', status: t.status || '', group_name: '', tags: t.tags || [],
            created_at: t.created_at || null, updated_at: t.updated_at || null, solved_at: t.solved_at || null,
            url: `${location.origin}/agent/tickets/${ticketId}`, conversation: await fetchComments(ticketId),
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

    async function addExporterSelectionToKnowledgeBase() {
        if (state.busy) return;
        const ids = exporterSelectedIds();
        if (!ids.length) { setStatus('Select tickets in Zendesk AI Exporter first.', false); return; }
        setBusy(true);
        try {
            requireToken();
            const loaded = [];
            const loadFailures = [];
            let cursor = 0, completed = 0;
            const workers = Array.from({ length: Math.min(LOAD_CONCURRENCY, ids.length) }, async () => {
                while (true) {
                    const index = cursor++;
                    if (index >= ids.length) return;
                    const id = ids[index];
                    try { loaded.push(await loadTicket(id)); }
                    catch (e) { loadFailures.push({ id, error: e.message || String(e) }); }
                    completed++;
                    setStatus(`Loading exporter tickets… ${completed}/${ids.length}`);
                }
            });
            await Promise.all(workers);

            let imported = 0, failed = loadFailures.length, chunks = 0, embeddings = 0, pii = 0;
            const importFailures = [];
            const batches = [];
            for (let i = 0; i < loaded.length; i += IMPORT_BATCH_SIZE) batches.push(loaded.slice(i, i + IMPORT_BATCH_SIZE));

            for (let i = 0; i < batches.length; i++) {
                setStatus(`Uploading batch ${i + 1}/${batches.length}…`);
                try {
                    const result = await callSupabase(IMPORT_ENDPOINT, { tickets: batches[i] });
                    imported += Number(result.imported || 0);
                    failed += Number(result.failed || 0);
                    pii += sumRedactions(result.redactions);
                    for (const row of result.results || []) {
                        chunks += Number(row.chunks || 0);
                        embeddings += Number(row.embeddings || 0);
                        if (row.ok === false) importFailures.push({ id: row.ticket_id, error: row.error || 'Import failed' });
                    }
                } catch (e) {
                    failed += batches[i].length;
                    importFailures.push({ id: `batch ${i + 1}`, error: e.message || String(e) });
                }
            }

            const allFailures = [...loadFailures, ...importFailures];
            if (allFailures.length) console.warn('Zendesk AI bulk import failures:', allFailures);
            setStatus(`KB upload complete: ${imported}/${ids.length} tickets · ${chunks} chunks · ${embeddings} embeddings · PII ${pii}${failed ? ` · ${failed} failed` : ''}`, failed === 0);
        } catch (e) { setStatus(e.message || String(e), false); }
        finally { setBusy(false); refreshContext(); }
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
            const history = state.messages.slice(0, -1).slice(-8).map(({ role, content }) => ({ role, content }));
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

    function sumRedactions(r) { return Object.values(r || {}).reduce((a, b) => a + Number(b || 0), 0); }
    function clearChat() { state.messages = []; renderChat(); setStatus('Ready', true); }

    function renderChat() {
        const el = $('#zaec-chat');
        if (!state.messages.length) { el.innerHTML = '<div class="zaec-empty">Ask about the current ticket or upload selected tickets from Zendesk AI Exporter.</div>'; return; }
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

    function setBusy(value) {
        state.busy = value;
        $('#zaec-send').disabled = value;
        $('#zaec-add-kb').disabled = value || !currentTicketId();
        $('#zaec-add-exporter').disabled = value || !exporterSelectedIds().length;
    }

    function setStatus(text, ok = null) {
        const el = $('#zaec-status'); el.textContent = text;
        el.className = `zaec-status ${ok === true ? 'zaec-ok' : ok === false ? 'zaec-error' : ''}`;
    }
})();
