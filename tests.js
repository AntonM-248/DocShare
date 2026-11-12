/* Minimal in-browser test runner: open tests.html. Uses a throwaway database. */
(function () {
  var A = window.DocsApi, tests = [], passed = 0, failed = 0;
  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function assert(c, m) { if (!c) { throw new Error(m || 'assertion failed'); } }
  function rejects(p, re) {
    return p.then(function () { throw new Error('expected a rejection'); }, function (e) {
      if (re && !re.test(e.message)) { throw new Error('wrong error: ' + e.message); }
    });
  }
  function fresh() { return Dexie.delete('docshare-test').then(function () { return A.open('docshare-test'); }); }
  function mk() { return A.createDoc('u1', 'Plan', '<p>start</p>'); }

  test('login accepts seeded user and rejects a bad password', function () {
    return A.login('Alice', 'password').then(function (u) {
      assert(u.id === 'u1');
      return rejects(A.login('alice', 'nope'), /Invalid/);
    });
  });
  test('saved formatting persists and reopens', function () {
    return mk().then(function (d) {
      return A.saveDoc('u1', d.id, { title: 'Renamed', content: '<h1>Hi</h1><p><b>bold</b></p>' }).then(function () { return A.getDoc('u1', d.id); });
    }).then(function (r) { assert(r.doc.title === 'Renamed'); assert(r.doc.content === '<h1>Hi</h1><p><b>bold</b></p>'); assert(r.role === 'owner'); });
  });
  test('empty or overlong titles are rejected', function () {
    return rejects(A.createDoc('u1', '   '), /empty/).then(function () { return rejects(A.createDoc('u1', new Array(130).join('a')), /120/); });
  });
  test('unshared user cannot read or list the document', function () {
    return mk().then(function (d) {
      return rejects(A.getDoc('u3', d.id), /denied/).then(function () { return A.listDocs('u3'); }).then(function (l) {
        assert(l.every(function (x) { return x.id !== d.id; }), 'leaked into list');
      });
    });
  });
  test('view share is read-only', function () {
    return mk().then(function (d) {
      return A.shareDoc('u1', d.id, 'bob', 'view').then(function () { return A.getDoc('u2', d.id); }).then(function (r) {
        assert(r.role === 'view');
        return rejects(A.saveDoc('u2', d.id, { content: '<p>x</p>' }), /view/);
      });
    });
  });
  test('edit share lets another user change the doc and owner sees it', function () {
    return mk().then(function (d) {
      return A.shareDoc('u1', d.id, 'bob', 'edit').then(function () { return A.saveDoc('u2', d.id, { content: '<p>by bob</p>' }); })
        .then(function () { return A.getDoc('u1', d.id); }).then(function (r) { assert(r.doc.content === '<p>by bob</p>'); });
    });
  });
  test('sharing rules: owner only, no self, known user, valid permission, revoke works', function () {
    return mk().then(function (d) {
      return A.shareDoc('u1', d.id, 'bob', 'edit')
        .then(function () { return rejects(A.shareDoc('u2', d.id, 'carol', 'view'), /owner/); })
        .then(function () { return rejects(A.shareDoc('u1', d.id, 'alice', 'view'), /already own/); })
        .then(function () { return rejects(A.shareDoc('u1', d.id, 'zed', 'view'), /No such user/); })
        .then(function () { return rejects(A.shareDoc('u1', d.id, 'bob', 'admin'), /Permission/); })
        .then(function () { return A.unshare('u1', d.id, 'u2'); })
        .then(function () { return rejects(A.getDoc('u2', d.id), /denied/); });
    });
  });
  test('sanitize strips scripts and event handlers but keeps formatting', function () {
    var s = A.sanitize('<p onclick="x()"><b>a</b></p><script>alert(1)</script><img src="x" onerror="alert(1)">');
    assert(s.indexOf('script') < 0 && s.indexOf('onerror') < 0 && s.indexOf('onclick') < 0, s);
    assert(s.indexOf('<b>a</b>') > -1);
  });

  function run(i) {
    var out = document.getElementById('out');
    if (i >= tests.length) {
      document.getElementById('sum').textContent = passed + ' passed, ' + failed + ' failed';
      document.title = failed ? 'FAIL' : 'PASS';
      return;
    }
    var li = document.createElement('li');
    fresh().then(tests[i].fn).then(function () { passed++; li.className = 'pass'; li.textContent = 'PASS: ' + tests[i].name; },
      function (e) { failed++; li.className = 'fail'; li.textContent = 'FAIL: ' + tests[i].name + ' (' + e.message + ')'; })
      .then(function () { out.appendChild(li); run(i + 1); });
  }
  run(0);
})();
