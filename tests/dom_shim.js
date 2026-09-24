/* A deliberately small DOM, enough to run app.js outside a browser. */
var window = this, global = this;
function Node(tag) {
  this.tagName = (tag || 'div').toUpperCase();
  this.children = []; this.handlers = {};
  this._text = ''; this._html = '';
  this.value = ''; this.hidden = false; this.className = '';
  this.disabled = false; this.files = [];
  this.attrs = {};
  var self = this;
  this.classList = {
    add: function (c) { self.className += (self.className ? ' ' : '') + c; },
    remove: function (c) { self.className = self.className.replace(c, '').trim(); },
    contains: function (c) { return self.className.indexOf(c) >= 0; }
  };
}
Object.defineProperty(Node.prototype, 'textContent', {
  get: function () { return this._text; },
  set: function (v) { this._text = String(v); }
});
Object.defineProperty(Node.prototype, 'innerHTML', {
  get: function () { return this._html; },
  set: function (v) { this._html = String(v); this.children = []; }
});
Node.prototype.appendChild = function (c) { this.children.push(c); return c; };
Node.prototype.addEventListener = function (t, fn) { (this.handlers[t] = this.handlers[t] || []).push(fn); };
Node.prototype.setAttribute = function (k, v) { this.attrs[k] = v; };
Node.prototype.getAttribute = function (k) { return this.attrs[k]; };
Node.prototype.click = function () { this.fire('click'); };
Node.prototype.scrollIntoView = function () { this.scrolled = true; };
Node.prototype.fire = function (t, ev) {
  ev = ev || {};
  ev.preventDefault = ev.preventDefault || function () {};
  ev.stopPropagation = ev.stopPropagation || function () {};
  (this.handlers[t] || []).forEach(function (fn) { fn.call(this, ev); }, this);
};
Node.prototype.allText = function () {
  var out = this._text + ' ' + this._html;
  this.children.forEach(function (c) { out += ' ' + c.allText(); });
  return out;
};

var REG = {};
var document = {
  getElementById: function (id) { return REG[id] || (REG[id] = new Node('div')); },
  createElement: function (t) { return new Node(t); },
  addEventListener: function () {}
};
window.document = document;
window.addEventListener = function () {};

/* fetch: hand back the journal dataset the tests inline. */
function fetch(url) {
  if (url.indexOf('journals.json') >= 0) {
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(DATA); } });
  }
  return Promise.resolve({ ok: false, status: 404, json: function () { return Promise.resolve({}); } });
}
window.fetch = fetch;

/* FileReader: hand back an empty buffer; extractDocx is stubbed in the test. */
function FileReader() {}
FileReader.prototype.readAsArrayBuffer = function () {
  var self = this;
  Promise.resolve().then(function () {
    self.result = new ArrayBuffer(8);
    if (self.onload) self.onload();
  });
};
window.FileReader = FileReader;
var console = { error: function () {}, log: function () {} };
