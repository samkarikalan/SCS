/* ============================================================
   offline-db.js — SCS local offline data foundation

   This module is intentionally data-only. It does NOT contain the
   scheduling algorithm and it does NOT replace the existing online flow.

   Stores:
     snapshots       latest Round Manager session snapshot
     roundContexts   latest input/context sent to the Worker
     preparedRounds  reserved for later pre-generated offline round pool
     meta            lightweight local metadata
============================================================ */
(function () {
  'use strict';

  const DB_NAME = 'scs_offline_rounds';
  const DB_VERSION = 3;
  const CURRENT_KEY = 'current';

  let _dbPromise = null;

  function cloneData(value) {
    if (value == null) return value;
    try {
      if (typeof structuredClone === 'function') return structuredClone(value);
    } catch (_) {}
    return JSON.parse(JSON.stringify(value));
  }

  function openDb() {
    if (!('indexedDB' in window)) {
      return Promise.reject(new Error('IndexedDB is not supported on this device'));
    }
    if (_dbPromise) return _dbPromise;

    _dbPromise = new Promise(function (resolve, reject) {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = function () {
        const db = request.result;
        if (!db.objectStoreNames.contains('snapshots')) {
          db.createObjectStore('snapshots', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('roundContexts')) {
          db.createObjectStore('roundContexts', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('preparedRounds')) {
          const store = db.createObjectStore('preparedRounds', { keyPath: 'id' });
          store.createIndex('batchId', 'batchId', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('tempPreparedRounds')) {
          db.createObjectStore('tempPreparedRounds', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
        // Build 917: keep the Round Template cache encrypted at rest.
        // CryptoKey is non-extractable; normal app code can use it, but it cannot
        // be exported as raw key material. Worker/API behavior is unchanged.
        if (!db.objectStoreNames.contains('cryptoKeys')) {
          db.createObjectStore('cryptoKeys', { keyPath: 'key' });
        }
      };

      request.onsuccess = function () {
        const db = request.result;
        db.onversionchange = function () { db.close(); };
        resolve(db);
      };
      request.onerror = function () {
        _dbPromise = null;
        reject(request.error || new Error('Could not open offline database'));
      };
      request.onblocked = function () {
        console.warn('SCS offline DB upgrade is blocked by another open tab.');
      };
    });

    return _dbPromise;
  }

  async function put(storeName, value) {
    const db = await openDb();
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value);
      tx.oncomplete = function () { resolve(true); };
      tx.onerror = function () { reject(tx.error || new Error('Offline DB write failed')); };
      tx.onabort = function () { reject(tx.error || new Error('Offline DB write aborted')); };
    });
  }

  async function get(storeName, key) {
    const db = await openDb();
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = function () { resolve(req.result || null); };
      req.onerror = function () { reject(req.error || new Error('Offline DB read failed')); };
    });
  }

  async function remove(storeName, key) {
    const db = await openDb();
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = function () { resolve(true); };
      tx.onerror = function () { reject(tx.error || new Error('Offline DB delete failed')); };
    });
  }

  async function saveSnapshot(blob) {
    if (!blob) return false;
    return put('snapshots', {
      key: CURRENT_KEY,
      savedAt: Date.now(),
      data: cloneData(blob)
    });
  }

  async function getSnapshot() {
    const row = await get('snapshots', CURRENT_KEY);
    return row ? row.data : null;
  }

  async function clearSnapshot() {
    return remove('snapshots', CURRENT_KEY);
  }

  async function saveRoundContext(payload) {
    if (!payload) return false;
    return put('roundContexts', {
      key: CURRENT_KEY,
      savedAt: Date.now(),
      data: cloneData(payload)
    });
  }

  async function getRoundContext() {
    const row = await get('roundContexts', CURRENT_KEY);
    return row ? row.data : null;
  }

  async function clearRoundContext() {
    return remove('roundContexts', CURRENT_KEY);
  }

  // Prepared-round APIs are intentionally present but unused in this build.
  // The next stage can fill this store from Worker-generated batches without
  // changing the database structure or the existing online round generator.
  const TEMPLATE_KEY_ID = 'round-template-aes-v1';

  function bytesToBase64(bytes) {
    let binary = '';
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i]);
    return btoa(binary);
  }

  function base64ToBytes(text) {
    const binary = atob(String(text || ''));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  async function getTemplateCryptoKey() {
    if (!(window.crypto && window.crypto.subtle)) throw new Error('Secure template storage is unavailable');
    const existing = await get('cryptoKeys', TEMPLATE_KEY_ID);
    if (existing && existing.cryptoKey) return existing.cryptoKey;
    const cryptoKey = await window.crypto.subtle.generateKey({ name:'AES-GCM', length:256 }, false, ['encrypt','decrypt']);
    await put('cryptoKeys', { key:TEMPLATE_KEY_ID, cryptoKey:cryptoKey, createdAt:Date.now() });
    return cryptoKey;
  }

  async function encryptTemplateRecord(roundRecord) {
    const key = await getTemplateCryptoKey();
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const plain = new TextEncoder().encode(JSON.stringify(cloneData(roundRecord)));
    const cipher = await window.crypto.subtle.encrypt({ name:'AES-GCM', iv:iv }, key, plain);
    return {
      id: roundRecord.id,
      batchId: roundRecord.batchId || '',
      createdAt: roundRecord.createdAt || Date.now(),
      encrypted: true,
      iv: bytesToBase64(iv),
      payload: bytesToBase64(new Uint8Array(cipher))
    };
  }

  async function decryptTemplateRecord(row) {
    if (!row || !row.encrypted) return cloneData(row); // migrate legacy cache on next write
    const key = await getTemplateCryptoKey();
    const plain = await window.crypto.subtle.decrypt(
      { name:'AES-GCM', iv:base64ToBytes(row.iv) }, key, base64ToBytes(row.payload)
    );
    return JSON.parse(new TextDecoder().decode(plain));
  }

  async function savePreparedRound(roundRecord) {
    if (!roundRecord || !roundRecord.id) throw new Error('Prepared round requires an id');
    return put('preparedRounds', await encryptTemplateRecord(roundRecord));
  }

  async function deletePreparedRoundsByBatch(batchId) {
    const id = String(batchId || '');
    if (!id) return 0;
    const db = await openDb();
    return new Promise(function(resolve, reject) {
      const tx = db.transaction('preparedRounds', 'readwrite');
      const store = tx.objectStore('preparedRounds');
      const req = store.getAll();
      let deleted = 0;
      req.onsuccess = function() {
        (req.result || []).forEach(function(row) {
          if (String((row && row.batchId) || '') === id) {
            store.delete(row.id);
            deleted++;
          }
        });
      };
      req.onerror = function() { reject(req.error || new Error('Could not read prepared rounds')); };
      tx.oncomplete = function() { resolve(deleted); };
      tx.onerror = function() { reject(tx.error || new Error('Could not delete prepared rounds')); };
    });
  }

  async function clearPreparedRounds() {
    const db = await openDb();
    return new Promise(function (resolve, reject) {
      const tx = db.transaction('preparedRounds', 'readwrite');
      tx.objectStore('preparedRounds').clear();
      tx.oncomplete = function () { resolve(true); };
      tx.onerror = function () { reject(tx.error || new Error('Could not clear prepared rounds')); };
    });
  }


  async function getPreparedRounds() {
    const db = await openDb();
    return new Promise(function (resolve, reject) {
      const tx = db.transaction('preparedRounds', 'readonly');
      const req = tx.objectStore('preparedRounds').getAll();
      req.onsuccess = async function () {
        try {
          const rows = req.result || [];
          resolve(await Promise.all(rows.map(decryptTemplateRecord)));
        } catch (error) { reject(error); }
      };
      req.onerror = function () { reject(req.error || new Error('Could not read prepared rounds')); };
    });
  }

  async function saveTempPreparedRound(roundRecord) {
    if (!roundRecord || !roundRecord.id) throw new Error('Temp round requires an id');
    return put('tempPreparedRounds', cloneData(roundRecord));
  }

  async function getTempPreparedRounds() {
    const db = await openDb();
    return new Promise(function(resolve,reject){
      const tx=db.transaction('tempPreparedRounds','readonly');
      const req=tx.objectStore('tempPreparedRounds').getAll();
      req.onsuccess=function(){resolve(req.result||[]);};
      req.onerror=function(){reject(req.error||new Error('Could not read temp rounds'));};
    });
  }

  async function clearTempPreparedRounds() {
    const db = await openDb();
    return new Promise(function(resolve,reject){
      const tx=db.transaction('tempPreparedRounds','readwrite');
      tx.objectStore('tempPreparedRounds').clear();
      tx.oncomplete=function(){resolve(true);};
      tx.onerror=function(){reject(tx.error||new Error('Could not clear temp rounds'));};
    });
  }

  async function saveMeta(key, value) {
    return put('meta', { key: String(key), value: cloneData(value), updatedAt: Date.now() });
  }

  async function getMeta(key) {
    const row = await get('meta', String(key));
    return row ? row.value : null;
  }

  async function countPreparedRounds() {
    const db = await openDb();
    return new Promise(function (resolve, reject) {
      const tx = db.transaction('preparedRounds', 'readonly');
      const req = tx.objectStore('preparedRounds').count();
      req.onsuccess = function () { resolve(req.result || 0); };
      req.onerror = function () { reject(req.error || new Error('Could not count prepared rounds')); };
    });
  }

  async function migratePreparedRoundsToEncrypted() {
    const db = await openDb();
    const legacy = await new Promise(function(resolve, reject) {
      const tx = db.transaction('preparedRounds', 'readonly');
      const req = tx.objectStore('preparedRounds').getAll();
      req.onsuccess = function() { resolve((req.result || []).filter(function(row) { return row && !row.encrypted; })); };
      req.onerror = function() { reject(req.error || new Error('Could not inspect template cache')); };
    });
    for (const row of legacy) await savePreparedRound(row);
    return legacy.length;
  }

  async function init() {
    try {
      await openDb();
      await migratePreparedRoundsToEncrypted();
      await put('meta', { key: 'schema', version: DB_VERSION, templateEncryption:'AES-GCM-256', updatedAt: Date.now() });
      return true;
    } catch (error) {
      console.warn('SCS offline DB unavailable:', error && error.message ? error.message : error);
      return false;
    }
  }

  window.SCSOfflineDB = {
    init,
    saveSnapshot,
    getSnapshot,
    clearSnapshot,
    saveRoundContext,
    getRoundContext,
    clearRoundContext,
    savePreparedRound,
    getPreparedRounds,
    deletePreparedRoundsByBatch,
    clearPreparedRounds,
    saveTempPreparedRound,
    getTempPreparedRounds,
    clearTempPreparedRounds,
    countPreparedRounds,
    saveMeta,
    getMeta
  };

  // Non-blocking initialization. A failure here must never affect online SCS.
  init();
})();
