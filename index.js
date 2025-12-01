document.addEventListener('DOMContentLoaded', () => {
  // === CONFIG & STATE ===
  const STORAGE_KEY = 'trinh_hg_settings_v9'; 
  const INPUT_STATE_KEY = 'trinh_hg_input_state_v9';

  const defaultState = {
    currentMode: 'default',
    activeTab: 'settings', 
    modes: {
      default: { pairs: [], matchCase: false, wholeWord: false }
    }
  };

  let state = JSON.parse(localStorage.getItem(STORAGE_KEY)) || defaultState;
  if (!state.activeTab) state.activeTab = 'settings'; 

  let currentSplitMode = 2;
  let saveTimeout;

  // DOM ELEMENTS
  const els = {
    modeSelect: document.getElementById('mode-select'),
    list: document.getElementById('punctuation-list'),
    inputText: document.getElementById('input-text'),
    outputText: document.getElementById('output-text'),
    splitInput: document.getElementById('split-input-text'),
    splitWrapper: document.getElementById('split-outputs-wrapper'),
    matchCaseBtn: document.getElementById('match-case'),
    wholeWordBtn: document.getElementById('whole-word'),
    renameBtn: document.getElementById('rename-mode'),
    deleteBtn: document.getElementById('delete-mode'),
    emptyState: document.getElementById('empty-state')
  };

  // === CORE FUNCTIONS ===

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function showNotification(msg, type = 'success') {
    const container = document.getElementById('notification-container');
    const note = document.createElement('div');
    note.className = `notification ${type}`;
    note.textContent = msg;
    container.appendChild(note);
    setTimeout(() => {
      note.style.opacity = '0';
      setTimeout(() => note.remove(), 300);
    }, 3000);
  }

  // === HÀM FIX LỖI SMART QUOTES CHUẨN NHẤT ===
  function normalizeSmartQuotes(text) {
    if (typeof text !== 'string' || text.length === 0) return text;
    
    // Bắt và chuyển tất cả Double Quotes về "
    let normalized = text.replace(/["\u201C\u201D\u201E\u201F\u00AB\u00BB\u275D\u275E\u301D-\u301F\uFF02\u02DD]/g, '"');
    
    // Bắt và chuyển tất cả Single Quotes về '
    normalized = normalized.replace(/['\u2018\u2019\u201A\u201B\u2039\u203A\u275B\u275C\u276E\u276F\uA78C\uFF07]/g, "'");

    return normalized;
  }
  
  // Lấy các Text Node chưa được highlight
  function getTextNodes(node) {
      let textNodes = [];
      if (node.nodeType === 3) {
          textNodes.push(node);
      } else {
          for (let child of node.childNodes) {
              // Quan trọng: Chỉ đi vào các node không phải là kết quả replace (span.replaced)
              if (child.nodeType === 1 && child.classList.contains('replaced')) continue; 
              textNodes = textNodes.concat(getTextNodes(child));
          }
      }
      return textNodes;
  }

  // --- LOGIC THAY THẾ CHUẨN XÁC, KHÔNG TREO WEB (Đã tối ưu) ---
  function performReplaceAll() {
      // Tắt nút để tránh click liên tục gây treo
      const replaceBtn = document.getElementById('replace-button');
      replaceBtn.disabled = true;
      replaceBtn.textContent = 'Đang xử lý...';

      const mode = state.modes[state.currentMode];
      if(!mode.pairs.length) {
        replaceBtn.disabled = false;
        replaceBtn.textContent = 'THỰC HIỆN THAY THẾ';
        return showNotification("Chưa có cặp thay thế nào!", "error");
      }

      // 1. Chuẩn hóa Input và gán vào Output Div
      let rawText = els.inputText.value;
      let normalizedText = normalizeSmartQuotes(rawText);
      
      els.outputText.innerHTML = '';
      els.outputText.innerText = normalizedText; // Gán văn bản đã chuẩn hóa

      let totalCount = 0;

      // 2. Chuẩn hóa Rules và sắp xếp
      const rules = mode.pairs
        .filter(p => p.find)
        .map(p => ({
            originalFind: p.find, // Giữ lại bản gốc để kiểm tra tính năng
            normalizedFind: normalizeSmartQuotes(p.find), // Dùng bản đã chuẩn hóa để tìm
            replace: normalizeSmartQuotes(p.replace || '') // Dùng bản đã chuẩn hóa để thay
        }))
        .filter(p => p.normalizedFind.length > 0)
        .sort((a,b) => b.normalizedFind.length - a.normalizedFind.length);


      rules.forEach(rule => {
          const findStr = rule.normalizedFind;
          // Lặp lại việc tìm kiếm/thay thế trên DOM cho đến khi không tìm thấy nữa (Global Replace)
          while (true) {
              let foundInThisPass = false;
              const nodes = getTextNodes(els.outputText);
              
              for (const node of nodes) {
                   const txt = node.nodeValue;
                   const searchIn = mode.matchCase ? txt : txt.toLowerCase();
                   const searchFor = mode.matchCase ? findStr : findStr.toLowerCase();
                   const idx = searchIn.indexOf(searchFor);

                   if (idx !== -1) {
                       // --- Check Whole word ---
                       if (mode.wholeWord) {
                            const before = idx > 0 ? txt[idx-1] : '';
                            const after = idx + findStr.length < txt.length ? txt[idx + findStr.length] : '';
                            const isWordChar = /[\p{L}\p{N}_]/u;
                            // Nếu trước hoặc sau là ký tự chữ/số/gạch dưới => không phải whole word
                            if (isWordChar.test(before) || isWordChar.test(after)) {
                                continue; 
                            }
                       }

                       // --- Tính toán Capitalization (Viết hoa sau dấu chấm) ---
                       let replacement = rule.replace;
                       const originalMatch = txt.substr(idx, findStr.length);
                       
                       // 1. Giữ nguyên Case (ALL CAPS, Title Case) nếu Match Case Tắt
                       if (!mode.matchCase) {
                           if (originalMatch === originalMatch.toUpperCase() && originalMatch !== originalMatch.toLowerCase()) {
                               replacement = replacement.toUpperCase();
                           } else if (originalMatch[0] === originalMatch[0].toUpperCase()) {
                               replacement = replacement.charAt(0).toUpperCase() + replacement.slice(1);
                           }
                       }

                       // 2. Viết hoa sau dấu câu (FIX LỖI NÀY)
                       const prefix = txt.substring(0, idx);
                       // Regex sửa: Tìm dấu câu (., ?, !) sau đó là khoảng trắng (có thể 0 hoặc nhiều)
                       // Nếu match, và replacement là chữ cái, thì viết hoa chữ cái đầu
                       if (/(^|[\.\?\!])\s*$/.test(prefix) && replacement.length > 0) {
                           if (/[a-zA-Z]/u.test(replacement.charAt(0))) {
                                replacement = replacement.charAt(0).toUpperCase() + replacement.slice(1);
                           }
                       }

                       // --- DOM Replace ---
                       const matchNode = node.splitText(idx);
                       matchNode.splitText(findStr.length);
                       const span = document.createElement('span');
                       span.className = 'replaced';
                       span.textContent = replacement;
                       matchNode.parentNode.replaceChild(span, matchNode);
                       
                       totalCount++;
                       foundInThisPass = true;
                       break; // Break node loop để quét lại DOM sau khi thay đổi
                   }
              }
              if (!foundInThisPass) break; // Thoát khỏi vòng lặp rule này nếu không tìm thấy nữa
          }
      });
      
      // --- CẢI THIỆN UI SAU KHI XỬ LÝ ---
      // 1. Tự động thêm dòng trắng giữa các đoạn văn bản trong output
      // Note: Sử dụng innerText để lấy text thuần sau khi highlight
      const finalOutputText = els.outputText.innerText.split('\n').filter(p => p.trim()).join('\n\n');
      els.outputText.innerText = finalOutputText;
      
      // 2. Xóa văn bản gốc
      els.inputText.value = '';
      
      updateCounters();
      saveTempInput();
      
      // Cập nhật lại counter sau khi xóa Input Text
      document.getElementById('input-word-count').textContent = 'Words: 0'; 
      showNotification(`Đã thay thế ${totalCount} vị trí!`);
      
      replaceBtn.disabled = false;
      replaceBtn.textContent = 'THỰC HIỆN THAY THẾ';
      
      return totalCount;
  }

  // === UI MANIPULATION (Giữ nguyên trừ phần loadSettingsToUI) ===
  function renderModeSelect() {
    els.modeSelect.innerHTML = '';
    Object.keys(state.modes).sort().forEach(m => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      els.modeSelect.appendChild(opt);
    });
    els.modeSelect.value = state.currentMode;
    updateModeButtons();
  }

  function updateModeButtons() {
    const isDefault = state.currentMode === 'default';
    els.renameBtn.classList.toggle('hidden', isDefault);
    els.deleteBtn.classList.toggle('hidden', isDefault);
    const mode = state.modes[state.currentMode];
    els.matchCaseBtn.textContent = `Match Case: ${mode.matchCase ? 'BẬT' : 'Tắt'}`;
    els.matchCaseBtn.classList.toggle('active', mode.matchCase);
    els.wholeWordBtn.textContent = `Whole Word: ${mode.wholeWord ? 'BẬT' : 'Tắt'}`;
    els.wholeWordBtn.classList.toggle('active', mode.wholeWord);
  }

  function addPairToUI(find = '', replace = '', append = false) {
    const item = document.createElement('div');
    item.className = 'punctuation-item';
    const safeFind = find.replace(/"/g, '&quot;');
    const safeReplace = replace.replace(/"/g, '&quot;');

    item.innerHTML = `
      <input type="text" class="find" placeholder="Tìm" value="${safeFind}">
      <input type="text" class="replace" placeholder="Thay thế" value="${safeReplace}">
      <button class="remove" tabindex="-1">×</button>
    `;

    item.querySelector('.remove').onclick = () => {
      item.remove();
      checkEmptyState();
      saveTempInput(); 
    };
    item.querySelectorAll('input').forEach(inp => inp.addEventListener('input', saveTempInputDebounced));

    if (append) els.list.appendChild(item);
    else els.list.insertBefore(item, els.list.firstChild);
    checkEmptyState();
  }

  // FIX: Tải lại cài đặt
  function loadSettingsToUI() {
    els.list.innerHTML = '';
    const mode = state.modes[state.currentMode];
    if (mode.pairs && mode.pairs.length > 0) {
      // Dùng true để append (thêm vào cuối) nhằm giữ nguyên thứ tự cũ
      mode.pairs.forEach(p => addPairToUI(p.find, p.replace, true)); 
    }
    updateModeButtons();
    checkEmptyState();
  }

  function checkEmptyState() {
    els.emptyState.classList.toggle('hidden', els.list.children.length > 0);
  }

  function saveCurrentPairsToState(silent = false) {
    const items = Array.from(els.list.children);
    const newPairs = items.map(item => ({
      find: item.querySelector('.find').value,
      replace: item.querySelector('.replace').value 
    })).filter(p => p.find !== '');

    state.modes[state.currentMode].pairs = newPairs;
    saveState();
    if (!silent) showNotification('Đã lưu cài đặt!', 'success');
  }

  // === SPLIT LOGIC (Giữ nguyên) ===
  function renderSplitOutputs(count) {
    els.splitWrapper.innerHTML = '';
    els.splitWrapper.style.gridTemplateColumns = `repeat(${Math.min(count, 4)}, 1fr)`;
    const maxRender = Math.min(count, 10); 
    
    for(let i = 1; i <= maxRender; i++) {
        const div = document.createElement('div');
        div.className = 'split-box';
        div.innerHTML = `
            <div class="split-header">
                <span>Phần ${i}</span>
                <span id="out-${i}-count" class="badge">Words: 0</span>
            </div>
            <textarea id="out-${i}-text" class="custom-scrollbar" readonly></textarea>
            <div class="split-footer">
              <button class="btn btn-secondary full-width copy-btn" data-target="out-${i}-text">Sao chép phần ${i}</button>
            </div>
        `;
        els.splitWrapper.appendChild(div);
    }
    els.splitWrapper.querySelectorAll('.copy-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.target.dataset.target;
            const el = document.getElementById(id);
            if(el.value) {
                navigator.clipboard.writeText(el.value);
                showNotification(`Đã sao chép Phần ${id.split('-')[1]}`, 'success');
            }
        });
    });
  }

  function performSplit() {
    const text = els.splitInput.value;
    if(!text.trim()) return showNotification('Chưa có nội dung để chia!', 'error');

    const normalizedText = normalizeSmartQuotes(text);

    const lines = normalizedText.split('\n');
    const firstLine = lines[0].trim();
    let chapterHeader = '';
    let contentBody = normalizedText;
    
    if (/^(Chương|Chapter)\s+\d+/.test(firstLine)) {
        chapterHeader = firstLine;
        contentBody = lines.slice(1).join('\n');
    }

    const paragraphs = contentBody.split('\n').filter(p => p.trim());
    const totalWords = countWords(contentBody);
    const targetWords = Math.ceil(totalWords / currentSplitMode);
    
    let parts = [];
    let currentPart = [];
    let currentCount = 0;

    for (let p of paragraphs) {
        const wCount = countWords(p);
        if (currentCount + wCount > targetWords && parts.length < currentSplitMode - 1) {
            parts.push(currentPart.join('\n\n'));
            currentPart = [p];
            currentCount = wCount;
        } else {
            currentPart.push(p);
            currentCount += wCount;
        }
    }
    if (currentPart.length) parts.push(currentPart.join('\n\n'));

    for(let i = 0; i < currentSplitMode; i++) {
        const el = document.getElementById(`out-${i+1}-text`);
        const countEl = document.getElementById(`out-${i+1}-count`);
        if(el) {
            let partHeader = '';
            if (chapterHeader) partHeader = chapterHeader.replace(/(\d+)/, (match, num) => `${num}.${i+1}`) + '\n\n';
            
            const partContent = parts[i] || '';
            const cleanContent = partContent.split('\n').filter(l => l.trim() !== '').join('\n\n');

            el.value = partHeader + cleanContent;
            if(countEl) countEl.textContent = 'Words: ' + countWords(el.value);
        }
    }
    els.splitInput.value = '';
    updateCounters();
    saveTempInput();
    showNotification('Đã chia thành công!', 'success');
  }

  // === EXPORT/IMPORT (FIX IMPORT) ===
  function exportCSV() {
    saveCurrentPairsToState(true);
    let csvContent = "\uFEFFfind,replace,mode\n"; 
    Object.keys(state.modes).forEach(modeName => {
        const mode = state.modes[modeName];
        if (mode.pairs) {
            mode.pairs.forEach(p => {
                const safeFind = p.find ? p.find.replace(/"/g, '""') : '';
                const safeReplace = p.replace ? p.replace.replace(/"/g, '""') : '';
                csvContent += `"${safeFind}","${safeReplace}","${modeName}"\n`;
            });
        }
    });
    const blob = new Blob([csvContent], {type: 'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'settings_trinh_hg.csv';
    a.click();
  }

  function importCSV(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const text = e.target.result;
        const lines = text.split(/\r?\n/);
        if (!lines[0].toLowerCase().includes('find,replace,mode')) return showNotification('File lỗi định dạng!', 'error');
        
        let count = 0;
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            const cols = line.match(/(?:"[^"]*"|[^,"]*)+/g) || [];

            if (cols.length >= 3) {
                const find = cols[0].replace(/^"|"$/g, '').replace(/""/g, '"');
                const replace = cols[1].replace(/^"|"$/g, '').replace(/""/g, '"');
                const modeName = cols[2].replace(/^"|"$/g, '').replace(/""/g, '"');
                
                if (!state.modes[modeName]) state.modes[modeName] = { pairs: [], matchCase: false, wholeWord: false };
                state.modes[modeName].pairs.push({ find, replace });
                count++;
            }
        }
        
        // FIX: Gọi loadSettingsToUI() sau khi saveState() để cập nhật hiển thị
        saveState(); 
        renderModeSelect(); 
        loadSettingsToUI(); // Tải lại giao diện Settings
        
        if (count > 0) showNotification(`Đã nhập ${count} cặp!`);
        else showNotification('Không tìm thấy cặp thay thế nào hợp lệ trong file.', 'error');
    };
    reader.readAsText(file);
  }

  // === UTILS ===
  function countWords(str) { return str.trim() ? str.trim().split(/\s+/).length : 0; }
  
  function updateCounters() {
    document.getElementById('input-word-count').textContent = 'Words: ' + countWords(els.inputText.value);
    document.getElementById('output-word-count').textContent = 'Words: ' + countWords(els.outputText.innerText);
    document.getElementById('split-input-word-count').textContent = 'Words: ' + countWords(els.splitInput.value);
  }

  function saveTempInputDebounced() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveTempInput, 500);
  }

  function saveTempInput() {
    const inputState = {
      inputText: els.inputText.value,
      splitInput: els.splitInput.value
    };
    localStorage.setItem(INPUT_STATE_KEY, JSON.stringify(inputState));
  }

  function loadTempInput() {
    const saved = JSON.parse(localStorage.getItem(INPUT_STATE_KEY));
    if(saved) {
        if(saved.inputText) els.inputText.value = saved.inputText;
        if(saved.splitInput) els.splitInput.value = saved.splitInput;
    }
    updateCounters();
  }

  function switchTab(tabId) {
      document.querySelectorAll('.tab-button').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === tabId));
      state.activeTab = tabId;
      saveState();
  }

  function initEvents() {
    document.querySelectorAll('.tab-button').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
    
    els.matchCaseBtn.onclick = () => { state.modes[state.currentMode].matchCase = !state.modes[state.currentMode].matchCase; saveState(); updateModeButtons(); };
    els.wholeWordBtn.onclick = () => { state.modes[state.currentMode].wholeWord = !state.modes[state.currentMode].wholeWord; saveState(); updateModeButtons(); };

    els.modeSelect.onchange = (e) => { state.currentMode = e.target.value; saveState(); loadSettingsToUI(); };
    
    document.getElementById('add-mode').onclick = () => {
      const name = prompt('Tên chế độ mới:');
      if(name && !state.modes[name]) {
        state.modes[name] = { pairs: [], matchCase: false, wholeWord: false };
        state.currentMode = name;
        saveState(); renderModeSelect(); loadSettingsToUI();
      }
    };

    document.getElementById('copy-mode').onclick = () => {
        const name = prompt('Tên mới:');
        if(name && !state.modes[name]) {
            state.modes[name] = JSON.parse(JSON.stringify(state.modes[state.currentMode]));
            state.currentMode = name;
            saveState(); renderModeSelect(); loadSettingsToUI();
        }
    };
    
    els.renameBtn.onclick = () => {
      const newName = prompt('Tên mới:', state.currentMode);
      if(newName && newName !== state.currentMode && !state.modes[newName]) {
        state.modes[newName] = state.modes[state.currentMode];
        delete state.modes[state.currentMode];
        state.currentMode = newName;
        saveState(); renderModeSelect();
      }
    };
    els.deleteBtn.onclick = () => { if(confirm('Xóa?')) { delete state.modes[state.currentMode]; state.currentMode = 'default'; saveState(); renderModeSelect(); loadSettingsToUI(); }};

    document.getElementById('add-pair').onclick = () => addPairToUI('', '', false); 
    document.getElementById('save-settings').onclick = () => saveCurrentPairsToState(false);

    document.getElementById('replace-button').onclick = performReplaceAll;

    document.getElementById('copy-button').onclick = () => {
        if(!els.outputText.innerText) return;
        navigator.clipboard.writeText(els.outputText.innerText);
        showNotification('Đã sao chép!');
    };

    document.querySelectorAll('.split-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.split-mode-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentSplitMode = parseInt(btn.dataset.split);
            renderSplitOutputs(currentSplitMode);
        });
    });

    document.getElementById('split-action-btn').onclick = performSplit;
    document.getElementById('export-settings').onclick = exportCSV;
    document.getElementById('import-settings').onclick = () => {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = '.csv';
        input.onchange = e => { if(e.target.files.length) importCSV(e.target.files[0]); };
        input.click();
    };

    [els.inputText, els.splitInput].forEach(el => el.addEventListener('input', () => { updateCounters(); saveTempInputDebounced(); }));
  }

  // INIT
  renderModeSelect();
  loadSettingsToUI();
  loadTempInput();
  renderSplitOutputs(currentSplitMode); 
  if(state.activeTab) switchTab(state.activeTab);
  initEvents();
});
