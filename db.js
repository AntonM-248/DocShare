/* Data layer: simulates a server API on top of Dexie/IndexedDB.
   The UI only talks to window.DocsApi; every method enforces permissions. */
(function (g) {
  'use strict';
  var db;
  var USERS = [
    { id: 'u1', username: 'alice', name: 'Alice Adams', password: 'password' },
    { id: 'u2', username: 'bob', name: 'Bob Baker', password: 'password' },
    { id: 'u3', username: 'carol', name: 'Carol Chen', password: 'password' },
    { id: 'u4', username: 'dave', name: 'Dave Diaz', password: 'password' },
    { id: 'u5', username: 'erin', name: 'Erin Evans', password: 'password' }
  ];

  function fail(msg) { return Promise.reject(new Error(msg)); }
  function uid() { return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function cleanTitle(t) {
    t = String(t == null ? '' : t).replace(/\s+/g, ' ').trim();
    if (!t) { throw new Error('Title cannot be empty.'); }
    if (t.length > 120) { throw new Error('Title must be 120 characters or fewer.'); }
    return t;
  }

  /* Remove scripts, event handlers and javascript: URLs (parsed in an inert document). */
  function sanitize(html) {
    var d = document.implementation.createHTMLDocument('');
    var box = d.createElement('div');
    box.innerHTML = String(html || '');
    var bad = box.querySelectorAll('script,style,iframe,object,embed,link,meta,form');
    var i, j;
    for (i = 0; i < bad.length; i++) { if (bad[i].parentNode) { bad[i].parentNode.removeChild(bad[i]); } }
    var all = box.getElementsByTagName('*');
    for (i = 0; i < all.length; i++) {
      for (j = all[i].attributes.length - 1; j >= 0; j--) {
        var a = all[i].attributes[j];
        if (/^on/i.test(a.name) || (/^(href|src)$/i.test(a.name) && /^\s*(javascript|data):/i.test(a.value))) {
          all[i].removeAttribute(a.name);
        }
      }
    }
    return box.innerHTML;
  }

  function open(name) {
    if (db) { db.close(); }
    db = new Dexie(name || 'docshare');
    db.version(1).stores({
      users: 'id, username',
      docs: 'id, ownerId, updatedAt',
      shares: '[docId+userId], docId, userId'
    });
    db.on('populate', function (tx) {
      var t = Date.now();
      tx.table('users').bulkAdd(USERS);
      tx.table('docs').bulkAdd([
        { id: 'seed1', ownerId: 'u1', title: 'Welcome to DocShare', createdAt: t, updatedAt: t,
          content: '<h1>Welcome</h1><p>This document is owned by <b>Alice</b> and shared with Bob (can edit) and Carol (can view).</p><ul><li>Log out and sign in as Bob</li><li>Edit this document</li><li>Sign back in as Alice to see the change</li></ul>' },
        { id: 'seed2', ownerId: 'u2', title: 'Bob\'s meeting notes', createdAt: t, updatedAt: t - 1000,
          content: '<h2>Agenda</h2><ol><li>Roadmap</li><li>Hiring</li></ol><p>Shared with Alice as <i>view only</i>.</p>' },
        { id: 'seed3', ownerId: 'u3', title: 'Carol\'s private draft', createdAt: t, updatedAt: t - 2000,
          content: '<p>Only Carol can see this one.</p>' }
      ]);
      tx.table('shares').bulkAdd([
        { docId: 'seed1', userId: 'u2', permission: 'edit' },
        { docId: 'seed1', userId: 'u3', permission: 'view' },
        { docId: 'seed2', userId: 'u1', permission: 'view' }
      ]);
    });
    return db.open();
  }

  function reset() {
    var name = db.name;
    db.close();
    return Dexie.delete(name).then(function () { return open(name); });
  }

  function listUsers() {
    return db.users.toArray().then(function (us) {
      return us.map(function (u) { return { id: u.id, username: u.username, name: u.name }; });
    });
  }

  function login(username, password) {
    var key = String(username || '').trim().toLowerCase();
    return db.users.where('username').equals(key).first().then(function (u) {
      if (!u || u.password !== password) { throw new Error('Invalid username or password.'); }
      return { id: u.id, username: u.username, name: u.name };
    });
  }

  /* Resolves {doc, role} where role is owner|edit|view, or rejects if no access. */
  function getDoc(userId, id) {
    return db.docs.get(id).then(function (doc) {
      if (!doc) { throw new Error('Document not found or access denied.'); }
      if (doc.ownerId === userId) { return { doc: doc, role: 'owner' }; }
      return db.shares.get([id, userId]).then(function (s) {
        if (!s) { throw new Error('Document not found or access denied.'); }
        return { doc: doc, role: s.permission };
      });
    });
  }

  function listDocs(userId) {
    return Promise.all([
      db.docs.where('ownerId').equals(userId).toArray(),
      db.shares.where('userId').equals(userId).toArray(),
      db.users.toArray()
    ]).then(function (r) {
      var names = {}, perms = {};
      r[2].forEach(function (u) { names[u.id] = u.name; });
      r[1].forEach(function (s) { perms[s.docId] = s.permission; });
      return db.docs.bulkGet(Object.keys(perms)).then(function (shared) {
        var out = r[0].map(function (d) { return { id: d.id, title: d.title, updatedAt: d.updatedAt, role: 'owner', ownerName: names[d.ownerId] }; });
        shared.forEach(function (d) {
          if (d) { out.push({ id: d.id, title: d.title, updatedAt: d.updatedAt, role: perms[d.id], ownerName: names[d.ownerId] }); }
        });
        return out.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
      });
    });
  }

  function createDoc(userId, title, content) {
    var t;
    try { t = cleanTitle(title); } catch (e) { return Promise.reject(e); }
    var now = Date.now();
    var doc = { id: uid(), ownerId: userId, title: t, content: sanitize(content || '<p><br></p>'), createdAt: now, updatedAt: now };
    return db.docs.add(doc).then(function () { return doc; });
  }

  /* fields: {title?, content?}. Owners and editors may save; viewers may not. */
  function saveDoc(userId, id, fields) {
    return getDoc(userId, id).then(function (r) {
      if (r.role === 'view') { throw new Error('You only have view permission for this document.'); }
      var ch = { updatedAt: Date.now() };
      if (fields.title !== undefined) { ch.title = cleanTitle(fields.title); }
      if (fields.content !== undefined) { ch.content = sanitize(fields.content); }
      return db.docs.update(id, ch).then(function () { return db.docs.get(id); });
    });
  }

  function shareDoc(ownerId, docId, username, permission) {
    if (permission !== 'view' && permission !== 'edit') { return fail('Permission must be "view" or "edit".'); }
    return getDoc(ownerId, docId).then(function (r) {
      if (r.role !== 'owner') { throw new Error('Only the owner can share this document.'); }
      return db.users.where('username').equals(String(username || '').trim().toLowerCase()).first().then(function (u) {
        if (!u) { throw new Error('No such user.'); }
        if (u.id === ownerId) { throw new Error('You already own this document.'); }
        return db.shares.put({ docId: docId, userId: u.id, permission: permission });
      });
    });
  }

  function unshare(ownerId, docId, userId) {
    return getDoc(ownerId, docId).then(function (r) {
      if (r.role !== 'owner') { throw new Error('Only the owner can change sharing.'); }
      return db.shares.delete([docId, userId]);
    });
  }

  function listShares(ownerId, docId) {
    return getDoc(ownerId, docId).then(function (r) {
      if (r.role !== 'owner') { throw new Error('Only the owner can view sharing settings.'); }
      return Promise.all([db.shares.where('docId').equals(docId).toArray(), db.users.toArray()]).then(function (x) {
        var m = {};
        x[1].forEach(function (u) { m[u.id] = u; });
        return x[0].map(function (s) {
          return { userId: s.userId, username: m[s.userId].username, name: m[s.userId].name, permission: s.permission };
        });
      });
    });
  }

  g.DocsApi = { open: open, reset: reset, listUsers: listUsers, login: login, getDoc: getDoc, listDocs: listDocs,
    createDoc: createDoc, saveDoc: saveDoc, shareDoc: shareDoc, unshare: unshare, listShares: listShares, sanitize: sanitize };
})(window);
