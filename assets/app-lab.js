(() => {
  'use strict';
  const key = 'entra-app-access-field-lab-v1';
  const modules = Array.from(document.querySelectorAll('.module'));
  const nav = document.getElementById('nav');
  const status = document.getElementById('status');
  let state = { completed: {}, notes: {}, theme: '' };
  let statusTimer;
  const announce = message => {
    status.textContent = message;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { status.textContent = ''; }, 4500);
  };
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    if (saved && typeof saved === 'object') {
      state.completed = saved.completed && typeof saved.completed === 'object' ? saved.completed : {};
      state.notes = saved.notes && typeof saved.notes === 'object' ? saved.notes : {};
      state.theme = saved.theme === 'dark' || saved.theme === 'light' ? saved.theme : '';
    }
  } catch (error) { console.error('Saved lab progress could not be read.', error); announce('Saved progress could not be read. Export notes before closing this page.'); }
  const save = () => {
    try { localStorage.setItem(key, JSON.stringify(state)); }
    catch (error) { console.error('Lab progress could not be saved.', error); announce('Browser storage unavailable. Export progress to keep your notes.'); }
  };
  const download = (name, text, type = 'text/plain;charset=utf-8') => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = document.createElement('a');
    link.href = url; link.download = name;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const updateProgress = () => {
    const count = modules.filter(module => state.completed[module.id] === true).length;
    document.getElementById('progress').max = modules.length;
    document.getElementById('progress').value = count;
    document.getElementById('progress-label').textContent = `${count} of ${modules.length} modules complete`;
    modules.forEach(module => {
      const link = nav.querySelector(`[href="#${module.id}"]`);
      link.classList.toggle('complete', state.completed[module.id] === true);
    });
  };
  modules.forEach(module => {
    const link = document.createElement('a');
    link.href = `#${module.id}`;
    link.textContent = module.dataset.title;
    nav.appendChild(link);
    const checkbox = module.querySelector('[data-complete]');
    checkbox.checked = state.completed[module.id] === true;
    checkbox.addEventListener('change', () => {
      state.completed[module.id] = checkbox.checked;
      save(); updateProgress();
    });
    const label = document.createElement('label');
    label.className = 'notes-label small';
    label.htmlFor = `notes-${module.id}`;
    label.textContent = 'Local notes / evidence references (no passwords or tokens)';
    const notes = document.createElement('textarea');
    notes.className = 'notes'; notes.id = label.htmlFor;
    notes.value = typeof state.notes[module.id] === 'string' ? state.notes[module.id] : '';
    notes.placeholder = 'What did you verify? Record evidence filenames and unresolved issues.';
    notes.addEventListener('input', () => { state.notes[module.id] = notes.value; save(); });
    module.append(label, notes);
  });
  document.querySelectorAll('pre[data-file]').forEach(pre => {
    const code = pre.querySelector('code');
    const text = code.textContent.replace(/\r\n/g, '\n').trim() + '\n';
    code.textContent = text;
    const wrapper = document.createElement('div');
    wrapper.className = 'code-wrap';
    const bar = document.createElement('div');
    bar.className = 'code-bar';
    const title = document.createElement('span');
    title.textContent = `${pre.dataset.lang || 'PowerShell'} / ${pre.dataset.file}`;
    const buttons = document.createElement('div');
    const copy = document.createElement('button');
    copy.type = 'button'; copy.textContent = 'Copy';
    copy.setAttribute('aria-label', `Copy ${pre.dataset.file}`);
    copy.addEventListener('click', async () => {
      try {
        if (!navigator.clipboard || !window.isSecureContext) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(text);
        announce(`Copied ${pre.dataset.file}`);
      } catch {
        const range = document.createRange();
        range.selectNodeContents(code);
        const selection = window.getSelection();
        selection.removeAllRanges(); selection.addRange(range);
        announce('Code selected. Press Ctrl+C (or Command+C) to copy.');
      }
    });
    const dl = document.createElement('button');
    dl.type = 'button'; dl.textContent = 'Download';
    dl.setAttribute('aria-label', `Download ${pre.dataset.file}`);
    dl.addEventListener('click', () => download(pre.dataset.file, text));
    buttons.append(copy, dl); bar.append(title, buttons);
    pre.before(wrapper); wrapper.append(bar, pre);
  });
  const search = document.getElementById('search');
  const empty = document.createElement('p');
  empty.className = 'no-results'; empty.hidden = true;
  empty.textContent = 'No matching modules. Clear the search to show the full lab.';
  document.getElementById('main').appendChild(empty);
  search.addEventListener('input', () => {
    const q = search.value.toLowerCase().trim();
    let count = 0;
    modules.forEach(module => {
      const match = !q || module.textContent.toLowerCase().includes(q);
      module.hidden = !match;
      nav.querySelector(`[href="#${module.id}"]`).hidden = !match;
      if (match) count++;
    });
    empty.hidden = count !== 0;
  });
  const preferredDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = state.theme || (preferredDark ? 'dark' : 'light');
  document.getElementById('theme').addEventListener('click', () => {
    state.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = state.theme; save();
  });
  document.getElementById('expand').addEventListener('click', event => {
    const details = Array.from(document.querySelectorAll('details'));
    const open = details.some(detail => !detail.open);
    details.forEach(detail => { detail.open = open; });
    event.target.textContent = open ? 'Collapse details' : 'Expand details';
  });
  let printedDetails = [];
  window.addEventListener('beforeprint', () => {
    printedDetails = Array.from(document.querySelectorAll('details')).filter(detail => !detail.open);
    printedDetails.forEach(detail => { detail.open = true; });
  });
  window.addEventListener('afterprint', () => {
    printedDetails.forEach(detail => { detail.open = false; });
    printedDetails = [];
  });
  document.getElementById('print').addEventListener('click', () => window.print());
  document.getElementById('export').addEventListener('click', () => {
    download('app-access-lab-progress.json', JSON.stringify({
      lab: 'Microsoft Entra app access field lab', exportedAt: new Date().toISOString(), ...state
    }, null, 2), 'application/json');
    announce('Progress and notes exported. This is not a tenant configuration backup.');
  });
  document.getElementById('reset').addEventListener('click', () => {
    if (!window.confirm('Clear saved checkboxes and local notes? Export first if needed. This does not change anything in Azure or Entra.')) return;
    state.completed = {}; state.notes = {}; save();
    modules.forEach(module => {
      module.querySelector('[data-complete]').checked = false;
      module.querySelector('.notes').value = '';
    });
    updateProgress(); announce('Local progress cleared. No tenant resources changed.');
  });
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        nav.querySelectorAll('a').forEach(link => {
          const current = link.hash === `#${entry.target.id}`;
          link.classList.toggle('current', current);
          if (current) link.setAttribute('aria-current', 'location');
          else link.removeAttribute('aria-current');
        });
      });
    }, { rootMargin: '-5% 0px -65% 0px', threshold: 0 });
    modules.forEach(module => observer.observe(module));
  }
  updateProgress();
})();
