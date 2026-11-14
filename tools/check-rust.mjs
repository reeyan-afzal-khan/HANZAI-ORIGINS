// Differential check against the last pre-migration release.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { performance } from "node:perf_hooks";
import { deflateRawSync, constants } from "node:zlib";

const before = "b123daedd69ce3513429850301035063a5334137";
const data = {};
for (const file of ["search.js", "chars.js", ...readdirSync("release/web/data/examples").map(f => "examples/" + f)]) {
  runInContext(readFileSync("release/web/data/" + file, "utf8"), createContext({HSKDATA:(k,v) => { data[k] = v; }}));
}
function load(old) {
  const ctx = createContext({atob, TextDecoder, getSearch:() => data.search, getChars:() => data.chars,
    LEVELS:["1","2","3","4","5","6","7"], S:{level:"1"}, CT:{}});
  const read = f => old ? execFileSync("git", ["show", before + ":" + f.replace("release/web/", "app/")], {encoding:"utf8"})
                        : readFileSync(f, "utf8");
  if (!old) runInContext(read("release/web/js/web-engine.js"), ctx);
  const core = read("release/web/js/core.js");
  runInContext(core.slice(core.indexOf("const esc ="), core.indexOf("const num =")), ctx);
  runInContext(read("release/web/js/epub.js"), ctx);
  const reader = read("release/web/js/reader.js");
  runInContext(reader.slice(reader.indexOf(old ? "const SECTION_MAX =" : "function sectionChapters("), reader.indexOf("const BOOK =")), ctx);
  ctx.clamp = (v,lo,hi) => Math.max(lo,Math.min(hi,v));
  runInContext(read("release/web/js/segment.js"), ctx);
  const tree = read("release/web/js/tree.js");
  runInContext(tree.slice(tree.indexOf("function ctGraph"), tree.indexOf("function ctMakings")), ctx);
  ctx.CT.g = ctx.ctGraph(data.chars);
  return ctx;
}
const old = load(true), next = load(false);
await Promise.all([old.lexicon(), next.lexicon()]);
const equal = (a,b) => assert.equal(JSON.stringify(a), JSON.stringify(b));
const sentences = Object.entries(data).filter(([k]) => k.startsWith("examples/"))
  .flatMap(([,v]) => Object.values(v).flatMap(rows => rows.map(r => r[0])));
for (const text of [...data.search.map(r => r[1]), ...data.chars.map(c => c.h), ...sentences,
                    "", "英文 123\n🙂𠀀\ud800，<html>？！"]){
  equal(next.segment(text), old.segment(text));
}
for (const root of old.CT.g.kids.keys()) {
  const tree = ctx => {
    const {size, branches, parent, under, tall} = ctx.ctGrow(root);
    return [size, ...[branches,parent,under,tall].map(m => [...m].sort((a,b) => a[0].localeCompare(b[0])))];
  };
  equal(tree(next), tree(old));
}
const fam = {words:new Map(data.search.filter((_,i) => i % 3 === 0).map(r => [r[0],2])),
             chars:new Map(data.chars.filter((_,i) => i % 2 === 0).map(c => [c.h,2]))};
const blocks = [];
for(const text of [...sentences, "英文🙂\n𠀀\ud800，<x>！！“[中国]”", '爱 & " < > 我\u00a0书', ""]){
  for(const opts of [{}, {ruby:true, mode:"fam", fam}, {tag:"span", mode:"level", fam, dim:true}, {mode:"off"}]){
    equal(next.annotateHTML(next.segment(text), opts), old.annotateHTML(old.segment(text), opts));
  }
}
for(const text of ["\r\n序言\n第一章\r我 爱\u3000你\n2、尾声🙂", sentences.join("\n"), "Begin\nChapter IV\na\nchapter 2\n结尾",
                    "前 言\n1234. abc\n123. abc\n第 两 篇\n\ud800", "x".repeat(70000)]) {
  equal(next.parseText(text, ""), old.parseText(text, ""));
}
assert.throws(() => next.parseText("\r\n\u00a0", ""), /no text/);
const chapters = [[1], [9000,9000], [10000,8001], [100000], [65000,50000,20,9000], []]
  .map((sizes,i) => ({title:String(i), blocks:sizes.map(n => ({tag:"p", text:"字".repeat(n)}))}));
equal(next.sectionChapters(chapters),old.sectionChapters(chapters));
for(let i=0;i<chapters.length;i++){
  for(const ratio of [0,0.1,0.5,0.99,1]) equal(next.sectionPlace(chapters,i,ratio),old.sectionPlace(chapters,i,ratio));
}
const prose = Buffer.from(sentences.join("\n").repeat(4));
for(const options of [{level:0}, {strategy:constants.Z_FIXED}, {level:9}]){
  const compressed = deflateRawSync(prose,options);
  assert.deepEqual(Buffer.from(next.inflateRaw(compressed)), prose);
}
assert.throws(() => next.inflateRaw(Uint8Array.of(7)), /DEFLATE/);
// A ZIP with a deflated XHTML chapter and a UTF-8 directory entry exercises
// directory offsets, filename decoding and record lifetime after a Wasm call.
const name = Buffer.from("正文.xhtml"), compressed = deflateRawSync(prose);
const local = Buffer.alloc(30), directory = Buffer.alloc(46), trailer = Buffer.alloc(22);
local.writeUInt32LE(0x04034b50); local.writeUInt16LE(name.length,26);
directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(8,10);
directory.writeUInt32LE(compressed.length,20); directory.writeUInt32LE(prose.length,24);
directory.writeUInt16LE(name.length,28);
trailer.writeUInt32LE(0x06054b50); trailer.writeUInt16LE(1,10);
trailer.writeUInt32LE(directory.length+name.length,12);
trailer.writeUInt32LE(local.length+name.length+compressed.length,16);
const zip = Buffer.concat([local,name,compressed,directory,name,trailer]);
const archive = await next.openZip(zip);
assert.equal(await archive.text(name.toString()), prose.toString());
for(let i = 0; i < sentences.length; i += 20) blocks.push(sentences.slice(i,i+20).join(""));
const baseline = () => old.coverage(blocks.flatMap(text => old.segment(text)), fam);
const migrated = () => {
  const counts = new Map();
  for(const text of blocks) next.countReaderWords(text, counts);
  return next.readerCoverage(counts, fam);
};
equal(migrated(), baseline());
function median(times){ return times.sort((a,b) => a-b)[Math.floor(times.length/2)]; }
const runs = [[],[]];
for(let i = 0; i < 5; i++){
  for(const index of (i % 2 ? [1,0] : [0,1])){
    const start = performance.now();
    [baseline,migrated][index]();
    runs[index].push(performance.now()-start);
  }
}
console.log("Token, annotation, text import, coverage and character-tree parity passed.");
console.log("Book analysis on", blocks.join("").length, "UTF-16 units. Median of five warm runs (ms):",
            "JavaScript", median(runs[0]).toFixed(1), "Rust-backed", median(runs[1]).toFixed(1));
