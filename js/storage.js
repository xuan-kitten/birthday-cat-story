/* ==========================================================
 * storage.js —— IndexedDB 封装（图片 Blob + 剧情配置）+ localStorage 兜底
 * 图片进 IndexedDB，避免 localStorage 5MB 容量爆掉
 * ========================================================== */
(function () {
  'use strict';
  const BS = (window.BS = window.BS || {});

  const DB_NAME = 'birthday-story';
  const DB_VERSION = 1;
  const LS_STORY_KEY = 'bs.story.v2';
  const LS_SETTINGS_KEY = 'bs.settings.v1';

  let dbPromise = null;
  let idbAvailable = true;
  let idbError = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!('indexedDB' in window)) {
        idbAvailable = false;
        idbError = '浏览器不支持 IndexedDB';
        return reject(new Error(idbError));
      }
      let req;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (err) {
        idbAvailable = false;
        idbError = String(err);
        return reject(err);
      }
      req.onupgradeneeded = function () {
        const db = req.result;
        if (!db.objectStoreNames.contains('assets')) {
          db.createObjectStore('assets', { keyPath: 'name' });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () {
        idbAvailable = false;
        idbError = req.error ? String(req.error) : 'IndexedDB 打开失败';
        reject(req.error || new Error(idbError));
      };
      req.onblocked = function () {
        idbAvailable = false;
        reject(new Error('IndexedDB 被其他标签页占用'));
      };
    });
    return dbPromise;
  }

  function requestToPromise(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  async function withStore(storeName, mode, fn) {
    const db = await openDB();
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let result;
      try {
        result = fn(store);
      } catch (err) {
        reject(err);
        return;
      }
      tx.oncomplete = function () { resolve(result); };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error || new Error('事务中断')); };
    });
  }

  /** 读单条：Promise 化 IDBRequest，拿到真正的值 */
  async function readOne(storeName, key) {
    const db = await openDB();
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = function () { resolve(req.result || null); };
      req.onerror = function () { reject(req.error); };
    });
  }

  /** 读全部 */
  async function readAll(storeName) {
    const db = await openDB();
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = function () { resolve(req.result || []); };
      req.onerror = function () { reject(req.error); };
    });
  }

  /* ---------------- 剧情配置 ---------------- */

  async function saveStory(story) {
    // localStorage 始终留一份，容量小但够放纯配置（图片只有文件名）
    try {
      localStorage.setItem(LS_STORY_KEY, JSON.stringify(story));
    } catch (err) {
      console.warn('[storage] localStorage 保存失败', err);
    }
    if (!idbAvailable) return { saved: 'localStorage' };
    try {
      await withStore('meta', 'readwrite', function (store) {
        store.put({ key: 'story', value: story, updatedAt: Date.now() });
      });
      return { saved: 'indexeddb' };
    } catch (err) {
      console.warn('[storage] IndexedDB 保存失败，仅 localStorage', err);
      return { saved: 'localStorage' };
    }
  }

  async function loadStory() {
    if (idbAvailable) {
      try {
        const rec = await readOne('meta', 'story');
        if (rec && rec.value) return rec.value;
      } catch (err) {
        console.warn('[storage] 读取 IndexedDB 失败', err);
      }
    }
    try {
      const raw = localStorage.getItem(LS_STORY_KEY);
      if (raw) return JSON.parse(raw);
    } catch (err) {
      console.warn('[storage] localStorage 读取失败', err);
    }
    return null;
  }

  /* ---------------- 图片资源（以文件名为 key） ---------------- */

  async function saveAsset(name, blob, type) {
    if (!idbAvailable) throw new Error('当前环境无法使用 IndexedDB 存图片，请用 启动本地预览.bat 打开');
    await withStore('assets', 'readwrite', function (store) {
      store.put({ name: name, blob: blob, type: type || blob.type || '', updatedAt: Date.now() });
    });
  }

  async function getAsset(name) {
    if (!idbAvailable) return null;
    try {
      return await readOne('assets', name);
    } catch (err) {
      return null;
    }
  }

  async function listAssets() {
    if (!idbAvailable) return [];
    try {
      return await readAll('assets');
    } catch (err) {
      return [];
    }
  }

  async function deleteAsset(name) {
    if (!idbAvailable) return;
    await withStore('assets', 'readwrite', function (store) { store.delete(name); });
  }

  /* ---------------- 小设置（音量/静音） ---------------- */

  function loadSettings() {
    try {
      return JSON.parse(localStorage.getItem(LS_SETTINGS_KEY) || '{}') || {};
    } catch (err) {
      return {};
    }
  }

  function saveSettings(patch) {
    const next = Object.assign(loadSettings(), patch || {});
    try {
      localStorage.setItem(LS_SETTINGS_KEY, JSON.stringify(next));
    } catch (err) { /* ignore */ }
    return next;
  }

  BS.storage = {
    open: openDB,
    saveStory: saveStory,
    loadStory: loadStory,
    saveAsset: saveAsset,
    getAsset: getAsset,
    listAssets: listAssets,
    deleteAsset: deleteAsset,
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    isIDBAvailable: function () { return idbAvailable; },
    getIDBError: function () { return idbError; },
    requestToPromise: requestToPromise
  };
})();
