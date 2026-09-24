/* Minimal globals so engine.js can be loaded by jsc with no browser. */
var window = this, global = this;
var DOMParser = function () {};   /* only the XML paths need it, not the tests */
