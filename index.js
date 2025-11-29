document.addEventListener('DOMContentLoaded', () => {
  // === CONFIG & STATE ===
  const STORAGE_KEY = 'trinh_hg_settings_v6'; // Update version key
  const INPUT_STATE_KEY = 'trinh_hg_input_state_v6';
  const TAB_STATE_KEY = 'trinh_hg_active_tab';

  const defaultState = {
    currentMode: 'default',
    modes: {
      default: { pairs: [], matchCase: false, wholeWord: false }
    }
  };

  let state = JSON.parse(localStorage.getItem(STORAGE_KEY)) || defaultState;
  let currentSplitMode = 2;
  let saveTimeout;

  // DOM ELEMENTS
  const els = {
    modeSelect: document.getElementById('mode-select'),
    list: document.getElementById('punctuation-list'),
    inputText: document.getElementById('input-text'),
    outputText: document.getElementById('output-text'), // Now a DIV
    splitInput: document.getElementById('split-input-text'),
    splitWrapper: document.getElementById('split-outputs-wrapper'),
    matchCaseBtn: document.getElementById('match-case'),
    wholeWordBtn: document.getElementById('whole-word'),
    renameBtn: document.getElementById('rename-mode'),
    deleteBtn: document.getElementById('delete-mode'),
    emptyState: document.getElementById('empty-state')
  };

  // LIST CÁC KÝ TỰ ĐẶC BIỆT CẦN LƯU Ý
  // “ ” ‘ ’ « » ‐ ‑ ‒ – — ― (Khác với " ' -)
  
  // === CORE FUNCTIONS ===

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function showNotification(msg, type = 'success') {
    const container = document.getElementById('notification-container');
    const note = document.createElement('div');
    note.className = `notification ${type}`;
    note.textContent = type === 'success' ? `✓ ${msg}` : (type === 'error' ? `⚠️ ${msg}` : `ℹ️ ${msg}`);
    container.appendChild(note);
    setTimeout(() => {
      note.style.opacity = '0';
      setTimeout(() => note.remove(), 300);
    }, 3000);
  }

  function escapeRegExp(string) {
    // Escape tất cả ký tự đặc biệt trong regex
    // Lưu ý: Không normalize quote để phân biệt “ và "
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); 
  }

  function escapeHtml(text) {
    return text.replace(/&/g, "&amp;")
               .replace(/</g, "&lt;")
               .replace(/>/g, "&gt;")
               .replace(/"/g, "&quot;")
               .replace(/'/g, "&#039;");
  }

  // --- LOGIC TÌM VÀ THAY THẾ + HIGHLIGHT ---
  function performReplaceAndHighlight() {
    const rawText = els.inputText.value;
    if (!rawText) {
        els.outputText.innerText = '';
        return showNotification('Văn bản trống!', 'error');
    }

    const mode = state.modes[state.currentMode];
    // Filter pairs rỗng
    const rules = mode.pairs.filter(p => p.find && p.find.length > 0);
    
    // Sort: Từ dài xử lý trước để tránh lỗi replace chồng chéo
    rules.sort((a, b) => b.find.length - a.find.length);

    let totalCount = 0;
    
    // Bước 1: Escape HTML toàn bộ text gốc để an toàn và để chèn thẻ mark
    let safeText = escapeHtml(rawText);

    // Bước 2: Thực hiện replace trên chuỗi đã escape
    // Lưu ý: Người dùng nhập "<a>" -> Regex tìm "&lt;a&gt;" (Logic tìm text hiển thị)
    // Nhưng để đơn giản và đúng với nhu cầu văn bản thông thường (truyện), 
    // ta sẽ tìm trên text đã escape. Nếu người dùng muốn tìm dấu " , ta tìm &quot; hoặc " tùy escape.
    
    // Tuy nhiên, để chính xác nhất với ký tự đặc biệt như “ ”:
    // escapeHtml không đổi “ thành entity, chỉ đổi " thành &quot;.
    // Nên ta cần xử lý find string tương tự.
    
    for (const rule of rules) {
        try {
            // Escape chuỗi tìm kiếm theo chuẩn HTML để khớp với safeText
            let findStr = escapeHtml(rule.find);
            let patternStr = escapeRegExp(findStr);
            
            // Whole Word Logic (cần hỗ trợ Unicode tiếng Việt)
            if (mode.wholeWord) {
                 // Lookbehind và Lookahead cho ký tự từ
                 patternStr = `(?<![\\p{L}\\p{N}_])${patternStr}(?![\\p{L}\\p{N}_])`;
            }

            const flags = 'g' + 'u' + (mode.matchCase ? '' : 'i');
            const regex = new RegExp(patternStr, flags);
            const replaceVal = rule.replace; 

            // Logic replace: Khi thay thế, bọc kết quả vào thẻ <mark>
            safeText = safeText.replace(regex, (match, ...args) => {
                totalCount++;
                
                // Lấy offset và chuỗi gốc để check viết hoa đầu dòng
                const offset = args[args.length - 2];
                const wholeString = args[args.length - 1];
                let finalReplace = replaceVal;

                // 1. Match Case Logic (giữ nguyên logic cũ)
                if (!mode.matchCase) {
                    // Nếu match là viết hoa hết -> replace viết hoa hết
                    if (match === match.toUpperCase() && match !== match.toLowerCase()) {
                         finalReplace = replaceVal.toUpperCase();
                    }
                    // Nếu match viết hoa chữ đầu -> replace viết hoa chữ đầu
                    else if (match[0] === match[0].toUpperCase() && replaceVal.length > 0) {
                        finalReplace = replaceVal.charAt(0).toUpperCase() + replaceVal.slice(1);
                    }
                }

                // 2. Context-Aware Capitalization (Đầu dòng hoặc sau dấu câu)
                // Cần check trên wholeString (đã escape). 
                // Dấu chấm câu escape: . vẫn là . , ? vẫn là ? , ! vẫn là !
                if (finalReplace.length > 0) {
                    const textBefore = wholeString.slice(0, offset);
                    // Check ký tự trắng hoặc xuống dòng trước đó
                    // Check entity &gt; thay vì > nếu cần, nhưng dấu câu thường an toàn
                    const isStartOfLine = /^\s*$/.test(textBefore) || /\n\s*$/.test(textBefore);
                    const isAfterPunctuation = /(\.|\?|!|:|”|")\s*$/.test(textBefore); // Thêm check sau " ”
                    
                    if (isStartOfLine || isAfterPunctuation) {
                        finalReplace = finalReplace.charAt(0).toUpperCase() + finalReplace.slice(1);
                    }
                }

                // Return kết quả đã bọc thẻ highlight
                // Cần escape nội dung thay thế để tránh nó chứa HTML tag
                const safeReplaceVal = escapeHtml(finalReplace);
                return `<mark class="hl-yellow">${safeReplaceVal}</mark>`;
            });

        } catch (e) {
            console.warn('Regex Error:', rule.find, e);
        }
    }

    // Bước 3: Đưa vào DIV
    els.outputText.innerHTML = safeText;
    
    // Update count và notify
    updateCounters();
    if(totalCount > 0) showNotification(`Đã thay thế ${totalCount} vị trí!`, 'success');
    else showNotification('Không tìm thấy từ nào phù hợp.', 'info');
  }

  // === UI MANIPULATION ===

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

  // FIX THỨ TỰ: Append = true (thêm cuối) dùng khi load data. Append = false (thêm đầu) dùng khi user bấm nút thêm.
  function addPairToUI(find = '', replace = '', append = false) {
    const item = document.createElement('div');
    item.className = 'punctuation-item';
    // Hiển thị raw value (không escape entity HTML trong input value attribute vì browser tự xử lý)
    // Nhưng cần cẩn thận dấu "
    const safeFind = find.replace(/"/g, '&quot;');
    const safeReplace = replace.replace(/"/g, '&quot;');

    item.innerHTML = `
      <input type="text" class="find" placeholder="Tìm (VD: “ )" value="${safeFind}">
      <input type="text" class="replace" placeholder="Thay thế (VD: &quot; )" value="${safeReplace}">
      <button class="remove" tabindex="-1">×</button>
    `;

    item.querySelector('.remove').onclick = () => {
      item.remove();
      checkEmptyState();
      // Auto save tạm để tránh mất khi f5 mà chưa bấm lưu
      saveCurrentPairsToState(true); 
    };
    
    // Debounce save input changes
    item.querySelectorAll('input').forEach(inp => inp.addEventListener('input', () => {
        // Chỉ lưu trạng thái UI tạm thời hoặc đánh dấu là 'chưa lưu'
    }));

    if (append) {
        els.list.appendChild(item); // Load từ data cũ -> thêm xuống dưới
    } else {
        els.list.insertBefore(item, els.list.firstChild); // Thêm mới -> lên đầu
        // Focus vào ô tìm kiếm mới
        item.querySelector('.find').focus();
    }
    checkEmptyState();
  }

  function loadSettingsToUI() {
    els.list.innerHTML = '';
    const mode = state.modes[state.currentMode];
    if (mode.pairs && mode.pairs.length > 0) {
      // Loop array và append để giữ đúng thứ tự đã lưu
      mode.pairs.forEach(p => addPairToUI(p.find, p.replace, true));
    }
    updateModeButtons();
    checkEmptyState();
  }

  function checkEmptyState() {
    els.emptyState.classList.toggle('hidden', els.list.children.length > 0);
  }

  // FIX LƯU THỨ TỰ: Quét DOM từ trên xuống dưới
  function saveCurrentPairsToState(silent = false) {
    const items = Array.from(els.list.children); // Lấy theo thứ tự hiển thị
    const newPairs = items.map(item => ({
      find: item.querySelector('.find').value,
      replace: item.querySelector('.replace').value 
    })).filter(p => p.find !== ''); // Bỏ qua nếu ô tìm trống

    state.modes[state.currentMode].pairs = newPairs;
    saveState();
    if (!silent) showNotification('Đã lưu cài đặt!', 'success');
  }

  // === SPLIT LOGIC (Giữ nguyên vì dùng Textarea riêng) ===
  function renderSplitOutputs(count) {
    els.splitWrapper.innerHTML = '';
    for(let i = 1; i <= count; i++) {
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

    const lines = text.split('\n');
    const firstLine = lines[0].trim();
    let chapterHeader = '';
    let contentBody = text;
    
    // Detect header (Chương X)
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
            if (chapterHeader) {
                partHeader = chapterHeader.replace(/(\d+)/, `$1.${i+1}`) + '\n\n';
            }
            el.value = (parts[i] ? partHeader + parts[i] : '');
            if(countEl) countEl.textContent = 'Words: ' + countWords(el.value);
        }
    }
    els.splitInput.value = '';
    updateCounters();
    saveTempInput();
    showNotification('Đã chia thành công!', 'success');
  }

  // === CSV EXPORT & IMPORT (FIXED BOM & QUOTES) ===
  function exportCSV() {
    // Lưu trạng thái hiện tại trên UI trước khi xuất
    saveCurrentPairsToState(true);
    
    let csvContent = "\uFEFFfind,replace,mode\n"; 
    Object.keys(state.modes).forEach(modeName => {
        const mode = state.modes[modeName];
        if (mode.pairs && mode.pairs.length > 0) {
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
        let text = e.target.result;
        const lines = text.split(/\r?\n/);
        if (!lines[0].toLowerCase().includes('find,replace,mode')) {
            return showNotification('File không đúng định dạng!', 'error');
        }
        let count = 0;
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            // Parse CSV Line: "find","replace","mode"
            const match = line.match(/^"(.*)","(.*)","(.*)"$/);
            if (match) {
                const find = match[1].replace(/""/g, '"');
                const replace = match[2].replace(/""/g, '"');
                const modeName = match[3];
                if (!state.modes[modeName]) {
                    state.modes[modeName] = { pairs: [], matchCase: false, wholeWord: false };
                }
                // Thêm vào cuối mảng
                state.modes[modeName].pairs.push({ find, replace });
                count++;
            }
        }
        saveState();
        renderModeSelect();
        loadSettingsToUI();
        if (count > 0) showNotification(`Đã nhập thành công ${count} cặp từ!`, 'success');
        else showNotification('Không tìm thấy dữ liệu hợp lệ!', 'error');
    };
    reader.readAsText(file);
  }

  // === UTILS & EVENTS ===
  function countWords(str) {
    return str.trim() ? str.trim().split(/\s+/).length : 0;
  }
  
  function updateCounters() {
    document.getElementById('input-word-count').textContent = 'Words: ' + countWords(els.inputText.value);
    // DIV dùng innerText để lấy text thuần
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
      splitInput: els.splitInput.value,
      // Không cần lưu tempPairs ở đây vì đã có saveCurrentPairsToState
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

  function initEvents() {
    // 1. TAB SWITCHING (FIX F5 PERSISTENCE)
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');

    function activateTab(tabId) {
        tabButtons.forEach(b => {
            b.classList.toggle('active', b.dataset.tab === tabId);
        });
        tabContents.forEach(c => {
            c.classList.toggle('active', c.id === tabId);
        });
        localStorage.setItem(TAB_STATE_KEY, tabId);
    }

    tabButtons.forEach(btn => {
      btn.addEventListener('click', () => activateTab(btn.dataset.tab));
    });

    // Load active tab from storage
    const lastTab = localStorage.getItem(TAB_STATE_KEY);
    if(lastTab) activateTab(lastTab);


    // 2. SETTINGS EVENTS
    els.matchCaseBtn.onclick = () => {
      state.modes[state.currentMode].matchCase = !state.modes[state.currentMode].matchCase;
      saveState(); updateModeButtons();
    };
    els.wholeWordBtn.onclick = () => {
      state.modes[state.currentMode].wholeWord = !state.modes[state.currentMode].wholeWord;
      saveState(); updateModeButtons();
    };

    els.modeSelect.onchange = (e) => {
      // Trước khi chuyển mode, lưu lại các cặp hiện tại của mode cũ
      saveCurrentPairsToState(true);
      state.currentMode = e.target.value;
      saveState(); loadSettingsToUI();
      showNotification(`Chuyển sang: ${state.currentMode}`);
    };
    
    document.getElementById('add-mode').onclick = () => {
      const name = prompt('Tên chế độ mới:');
      if(name && !state.modes[name]) {
        saveCurrentPairsToState(true); // Lưu mode cũ
        state.modes[name] = { pairs: [], matchCase: false, wholeWord: false };
        state.currentMode = name;
        saveState(); renderModeSelect(); loadSettingsToUI();
      }
    };

    document.getElementById('copy-mode').onclick = () => {
      const name = prompt('Tên chế độ sao chép:');
      if(name && !state.modes[name]) {
        saveCurrentPairsToState(true); // Lưu cái hiện tại cho chắc
        state.modes[name] = JSON.parse(JSON.stringify(state.modes[state.currentMode]));
        state.currentMode = name;
        saveState(); renderModeSelect(); loadSettingsToUI();
      }
    };
    
    els.renameBtn.onclick = () => {
      const newName = prompt('Tên mới:', state.currentMode);
      if(newName && newName !== state.currentMode && !state.modes[newName]) {
        saveCurrentPairsToState(true); // Lưu list hiện tại
        state.modes[newName] = state.modes[state.currentMode];
        delete state.modes[state.currentMode];
        state.currentMode = newName;
        saveState(); renderModeSelect();
      }
    };

    els.deleteBtn.onclick = () => {
      if(confirm(`Xóa chế độ ${state.currentMode}?`)) {
        delete state.modes[state.currentMode];
        state.currentMode = 'default';
        saveState(); renderModeSelect(); loadSettingsToUI();
      }
    };

    // Add Pair: Thêm vào đầu list (append=false)
    document.getElementById('add-pair').onclick = () => addPairToUI('', '', false); 
    document.getElementById('save-settings').onclick = () => saveCurrentPairsToState(false);

    // 3. REPLACE EVENTS
    document.getElementById('replace-button').onclick = () => {
        saveCurrentPairsToState(true); // Lưu config trước khi chạy
        performReplaceAndHighlight(); // Hàm mới dùng DIV
        saveTempInput();
    };

    document.getElementById('copy-button').onclick = () => {
        // Lấy innerText để copy nội dung thuần (không lấy thẻ mark)
        if(!els.outputText.innerText.trim()) return;
        navigator.clipboard.writeText(els.outputText.innerText);
        showNotification('Đã sao chép kết quả!', 'success');
    };

    // 4. SPLIT EVENTS
    document.querySelectorAll('.split-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.split-mode-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentSplitMode = parseInt(btn.dataset.split);
            renderSplitOutputs(currentSplitMode);
        });
    });

    document.getElementById('split-action-btn').onclick = performSplit;
    
    // 5. IMPORT/EXPORT
    document.getElementById('export-settings').onclick = exportCSV;
    document.getElementById('import-settings').onclick = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.csv';
        input.onchange = e => {
            if(e.target.files.length > 0) importCSV(e.target.files[0]);
        };
        input.click();
    };

    // 6. INPUT LISTENER
    [els.inputText, els.splitInput].forEach(el => {
        el.addEventListener('input', () => {
            updateCounters();
            saveTempInputDebounced();
        });
    });
  }

  // === INIT ===
  renderModeSelect();
  loadSettingsToUI();
  loadTempInput();
  renderSplitOutputs(2); 
  initEvents();
});
