/* UI layer: talks only to DocsApi. ES5 style for broad browser compatibility. */
(function () {
  'use strict';
  var api = window.DocsApi, me = null, cur = null, timer = null, users = [];

  function $(id) { return document.getElementById(id); }
  function show(id, on) { $(id).style.display = on ? '' : 'none'; }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function say(msg, bad) {
    var t = $('toast');
    t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.style.display = 'block';
    clearTimeout(say.t);
    say.t = setTimeout(function () { t.style.display = 'none'; }, 3500);
  }
  function guard(p) { return p.catch(function (e) { say(e && e.message ? e.message : 'Something went wrong.', true); }); }
  function sess(v) {
    try { if (v === null) { sessionStorage.removeItem('docshareUser'); } else if (v) { sessionStorage.setItem('docshareUser', v); } else { return sessionStorage.getItem('docshareUser'); } } catch (e) { return null; }
  }

  /* ---------- auth ---------- */
  function renderUsers() {
    $('userPicks').innerHTML = users.map(function (u) {
      return '<button type="button" data-u="' + esc(u.username) + '">' + esc(u.name) + '</button>';
    }).join('');
  }
  function showLogin() { show('app', false); show('login', true); $('loginPass').value = ''; $('loginErr').textContent = ''; }
  function enter(user) {
    me = user; cur = null; sess(user.id);
    $('whoami').textContent = 'Signed in as ' + user.name;
    $('shareUser').innerHTML = users.filter(function (u) { return u.id !== user.id; }).map(function (u) {
      return '<option value="' + esc(u.username) + '">' + esc(u.name) + '</option>';
    }).join('');
    show('login', false); show('app', true); closeDoc();
    return refreshList();
  }
  function doLogin() {
    api.login($('loginUser').value, $('loginPass').value).then(enter, function (e) { $('loginErr').textContent = e.message; });
  }
  function logout() { save().then(function () { me = null; cur = null; sess(null); showLogin(); }); }

  /* ---------- document list ---------- */
  function refreshList() {
    return api.listDocs(me.id).then(function (docs) {
      var own = '', sh = '';
      docs.forEach(function (d) {
        var meta = d.role === 'owner' ? 'Owned by you' : 'Shared by ' + esc(d.ownerName) + ' (' + (d.role === 'edit' ? 'can edit' : 'view only') + ')';
        var li = '<li data-id="' + d.id + '"' + (cur && cur.doc.id === d.id ? ' class="active"' : '') + '>' + esc(d.title) + '<small>' + meta + '</small></li>';
        if (d.role === 'owner') { own += li; } else { sh += li; }
      });
      $('ownList').innerHTML = own || '<li class="muted">No documents yet.</li>';
      $('sharedList').innerHTML = sh || '<li class="muted">Nothing shared with you.</li>';
    });
  }

  /* ---------- editor ---------- */
  function closeDoc() { cur = null; show('editorWrap', false); show('empty', true); }
  function openDoc(id) {
    return save().then(function () { return api.getDoc(me.id, id); }).then(function (r) {
      cur = r;
      var canEdit = r.role !== 'view';
      $('title').value = r.doc.title; $('title').disabled = !canEdit;
      $('editor').innerHTML = api.sanitize(r.doc.content);
      $('editor').contentEditable = canEdit ? 'true' : 'false';
      $('saveBtn').disabled = !canEdit;
      var btns = $('toolbar').getElementsByTagName('button');
      for (var i = 0; i < btns.length; i++) { btns[i].disabled = !canEdit; }
      $('roleBadge').textContent = r.role === 'owner' ? 'Owner' : (canEdit ? 'Shared: can edit' : 'Shared: view only');
      $('roleBadge').className = 'badge' + (r.role === 'owner' ? '' : ' shared');
      $('status').textContent = 'Last saved ' + new Date(r.doc.updatedAt).toLocaleString();
      show('empty', false); show('editorWrap', true);
      return Promise.all([refreshList(), renderShares()]);
    });
  }
  function queueSave() {
    if (!cur || cur.role === 'view') { return; }
    $('status').textContent = 'Unsaved changes...';
    clearTimeout(timer); timer = setTimeout(save, 800);
  }
  function save() {
    clearTimeout(timer); timer = null;
    if (!cur || cur.role === 'view') { return Promise.resolve(); }
    var id = cur.doc.id;
    return api.saveDoc(me.id, id, { title: $('title').value, content: $('editor').innerHTML }).then(function (d) {
      if (cur && cur.doc.id === id) { cur.doc = d; }
      $('status').textContent = 'Saved at ' + new Date(d.updatedAt).toLocaleTimeString();
      return refreshList();
    }).catch(function (e) {
      $('status').textContent = 'Not saved';
      if (cur) { $('title').value = cur.doc.title; }
      say(e.message, true);
    });
  }

  /* ---------- sharing ---------- */
  function renderShares() {
    var owner = cur && cur.role === 'owner';
    show('sharePanel', !!owner);
    if (!owner) { return Promise.resolve(); }
    return api.listShares(me.id, cur.doc.id).then(function (list) {
      $('shareList').innerHTML = list.length ? list.map(function (s) {
        return '<li>' + esc(s.name) + ' - ' + (s.permission === 'edit' ? 'can edit' : 'can view') +
          ' <button type="button" data-uid="' + s.userId + '">Remove</button></li>';
      }).join('') : '<li class="muted">Not shared with anyone yet.</li>';
    });
  }

  /* ---------- import ---------- */
  function textToHtml(text, md) {
    var out = [], inList = false;
    function close() { if (inList) { out.push('</ul>'); inList = false; } }
    text.replace(/\r\n?/g, '\n').split('\n').forEach(function (line) {
      var m;
      if (md && (m = /^(#{1,3})\s+(.*)$/.exec(line))) { close(); out.push('<h' + m[1].length + '>' + esc(m[2]) + '</h' + m[1].length + '>'); }
      else if (md && (m = /^\s*[-*]\s+(.*)$/.exec(line))) { if (!inList) { out.push('<ul>'); inList = true; } out.push('<li>' + esc(m[1]) + '</li>'); }
      else if (!line.replace(/\s/g, '')) { close(); }
      else { close(); out.push('<p>' + esc(line) + '</p>'); }
    });
    close();
    return out.join('') || '<p><br></p>';
  }
  function importFile(input) {
    var f = input.files[0];
    if (!f) { return; }
    var ext = (f.name.split('.').pop() || '').toLowerCase();
    if (['txt', 'md', 'markdown', 'html', 'htm'].indexOf(ext) < 0) { say('Unsupported file type. Use .txt, .md or .html.', true); input.value = ''; return; }
    if (f.size > 1048576) { say('File is too large. The limit is 1 MB.', true); input.value = ''; return; }
    var r = new FileReader();
    r.onerror = function () { say('Could not read that file.', true); };
    r.onload = function () {
      var html = (ext === 'html' || ext === 'htm') ? r.result : textToHtml(r.result, ext !== 'txt');
      var title = f.name.replace(/\.[^.]+$/, '').slice(0, 120) || 'Imported document';
      guard(api.createDoc(me.id, title, html).then(function (d) { return openDoc(d.id); }).then(function () { say('Imported "' + f.name + '".'); }));
      input.value = '';
    };
    r.readAsText(f);
  }

  /* ---------- wiring ---------- */
  function liId(e) {
    var n = e.target;
    while (n && n.nodeName !== 'LI') { n = n.parentNode; }
    return n ? n.getAttribute('data-id') : null;
  }
  function init() {
    if (!window.Dexie) { document.body.innerHTML = '<p class="pad error">Dexie failed to load. Check your connection or see the README.</p>'; return; }
    $('userPicks').onclick = function (e) {
      var u = e.target.getAttribute && e.target.getAttribute('data-u');
      if (u) { $('loginUser').value = u; $('loginPass').value = 'password'; }
    };
    $('loginBtn').onclick = doLogin;
    $('loginPass').onkeydown = function (e) { if (e.keyCode === 13) { doLogin(); } };
    $('logoutBtn').onclick = logout;
    $('resetBtn').onclick = function () {
      if (!window.confirm('Delete all changes and restore the demo data?')) { return; }
      guard(api.reset().then(api.listUsers).then(function (u) { users = u; sess(null); me = null; cur = null; showLogin(); }));
    };
    $('ownList').onclick = $('sharedList').onclick = function (e) { var id = liId(e); if (id) { guard(openDoc(id)); } };
    $('newBtn').onclick = function () {
      guard(save().then(function () { return api.createDoc(me.id, 'Untitled document'); })
        .then(function (d) { return openDoc(d.id); })
        .then(function () { $('title').focus(); $('title').select(); }));
    };
    $('fileIn').onchange = function () { importFile(this); };
    $('editor').oninput = queueSave;
    $('saveBtn').onclick = function () { guard(save()); };
    $('title').onchange = function () {
      if (!cur) { return; }
      if (!$('title').value.replace(/\s/g, '')) { say('Title cannot be empty.', true); $('title').value = cur.doc.title; return; }
      guard(save());
    };
    $('toolbar').onmousedown = function (e) { e.preventDefault(); }; /* keep the text selection */
    $('toolbar').onclick = function (e) {
      var b = e.target;
      while (b && b.nodeName !== 'BUTTON') { b = b.parentNode; }
      if (!b || b.disabled || !cur) { return; }
      $('editor').focus();
      if (b.getAttribute('data-cmd')) { document.execCommand(b.getAttribute('data-cmd'), false, null); }
      else if (b.getAttribute('data-block')) { document.execCommand('formatBlock', false, '<' + b.getAttribute('data-block') + '>'); }
      queueSave();
    };
    $('shareBtn').onclick = function () {
      guard(api.shareDoc(me.id, cur.doc.id, $('shareUser').value, $('sharePerm').value)
        .then(renderShares).then(function () { say('Sharing updated.'); }));
    };
    $('shareList').onclick = function (e) {
      var uidv = e.target.getAttribute && e.target.getAttribute('data-uid');
      if (uidv) { guard(api.unshare(me.id, cur.doc.id, uidv).then(renderShares)); }
    };
    window.addEventListener('beforeunload', function () { if (timer) { save(); } });

    api.open().then(api.listUsers).then(function (u) {
      users = u; renderUsers();
      var saved = sess(), found = null;
      u.forEach(function (x) { if (x.id === saved) { found = x; } });
      if (found) { enter(found); } else { showLogin(); }
    }).catch(function (e) {
      document.body.innerHTML = '<p class="pad error">Could not open the local database (' + esc(e.message) + '). Private browsing in some browsers disables IndexedDB.</p>';
    });
  }
  init();
})();
