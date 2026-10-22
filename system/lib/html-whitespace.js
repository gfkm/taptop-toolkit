// Whitespace in HTML text content. HTML and CSS treat only ASCII whitespace as
// collapsible (WHATWG Infra "ASCII whitespace": tab, LF, FF, CR, space).
// JavaScript's \s and String.prototype.trim() also match U+00A0 NO-BREAK SPACE
// and the other Unicode spaces, which are text: Russian typography puts U+00A0
// deliberately (a hanging preposition, a number and its unit), and a package
// that collapses it to a space breaks the line where the author forbade it.
// Every place that reads or rewrites text content goes through this module.
const ASCII_WHITESPACE_RUN = /[\t\n\f\r ]+/g;
const ASCII_WHITESPACE_EDGES = /^[\t\n\f\r ]+|[\t\n\f\r ]+$/g;
const ASCII_WHITESPACE_ONLY = /^[\t\n\f\r ]*$/;
const ASCII_WHITESPACE_SEPARATOR = /[\t\n\f\r ]+/;

const collapseAsciiWhitespace = text => String(text).replace(ASCII_WHITESPACE_RUN, ' ');
const trimAsciiWhitespace = text => String(text).replace(ASCII_WHITESPACE_EDGES, '');
// The tokens of a class attribute: HTML splits a class list on ASCII whitespace only.
const splitClassList = value => String(value ?? '').split(ASCII_WHITESPACE_SEPARATOR).filter(Boolean);
// True when the text renders nothing: empty or ASCII whitespace only.
const isBlankText = text => ASCII_WHITESPACE_ONLY.test(String(text ?? ''));

// A layer name from data-taptop-name: ASCII whitespace trimmed, inner runs
// collapsed to one space; null when only whitespace is left, no-break and
// other Unicode spaces included (the attribute then counts as absent). A name
// is valid exactly when layerName returns it unchanged (html-ir-contract.js).
const UNICODE_WHITESPACE_ONLY = /^\s*$/u;
const layerName = value => {
  const name = trimAsciiWhitespace(collapseAsciiWhitespace(value ?? ''));
  return UNICODE_WHITESPACE_ONLY.test(name) ? null : name;
};

module.exports = { collapseAsciiWhitespace, trimAsciiWhitespace, isBlankText, splitClassList, layerName };
