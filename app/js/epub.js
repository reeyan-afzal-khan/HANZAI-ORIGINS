/* a book brought in: the ZIP reader, and the EPUB or text file
 * turned into chapters of prose.
 *
 * The ZIP reader is here because an EPUB is one and nothing else opens one;
 * it is a plain inflate in a few hundred lines rather than a dependency. */


/* ==================================================================
   READING A ZIP ARCHIVE
   ================================================================== */

/* reading a ZIP archive in the page, because an EPUB is one.
 *
 * There is no build step and no CDN to lean on: app/ has to run from a folder,
 * from file:// and inside the APK with nothing fetched at runtime. So the
 * archive is opened here rather than by a library.
 *
 * Two paths to the same bytes. Where the browser has DecompressionStream it
 * does the inflating, which is native code and several times faster than
 * anything written here. Where it does not — an older Android WebView is the
 * case that matters — the inflate below runs instead. It is a direct
 * transcription of the reference decoder in zlib's puff.c, which is the
 * smallest correct thing that reads real DEFLATE.
 */

/* ---------------- inflate ---------------- */

/* Length and distance codes, from RFC 1951 §3.2.5. The tables are the format;
   they are not derived from anything. */
const LBASE = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,
               67,83,99,115,131,163,195,227,258];
const LEXT  = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
const DBASE = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,
               1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
const DEXT  = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
/* The order the code-length code lengths themselves arrive in. */
const CLORDER = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];

/* Canonical Huffman decoding table: how many codes are of each bit length,
   and the symbols in code order. Decoding walks lengths shortest first and
   never needs the codes themselves, only the counts. */
function huffman(lengths){
  const count = new Int32Array(16);
  for(let i = 0; i < lengths.length; i++) count[lengths[i]]++;
  count[0] = 0;
  const offs = new Int32Array(17);
  for(let len = 1; len <= 15; len++) offs[len + 1] = offs[len] + count[len];
  const symbol = new Int32Array(lengths.length);
  for(let s = 0; s < lengths.length; s++) if(lengths[s]) symbol[offs[lengths[s]]++] = s;
  return {count, symbol};
}

let FIXED_LIT = null, FIXED_DIST = null;
function fixedTables(){
  if(FIXED_LIT) return;
  const lit = new Uint8Array(288);
  lit.fill(8, 0, 144); lit.fill(9, 144, 256); lit.fill(7, 256, 280); lit.fill(8, 280, 288);
  FIXED_LIT = huffman(lit);
  FIXED_DIST = huffman(new Uint8Array(30).fill(5));
}

/* Raw DEFLATE in, bytes out. `hint` is the uncompressed size when the archive
   told us one, which turns the output buffer into a single allocation. */
function inflateRaw(src, hint){
  fixedTables();
  let bp = 0, bb = 0, bc = 0;          // byte position, bit buffer, bits held
  let out = new Uint8Array(Math.max(hint || 0, 1024));
  let op = 0;

  /* DEFLATE packs bits low-to-high within each byte, so the buffer fills at
     the top and drains from the bottom. */
  function bits(n){
    while(bc < n){
      if(bp >= src.length) throw new Error("truncated deflate stream");
      bb |= src[bp++] << bc;
      bc += 8;
    }
    const v = bb & ((1 << n) - 1);
    bb >>>= n; bc -= n;
    return v;
  }
  /* Codes are stored most-significant bit first even though the stream is
     little-endian, so each bit is shifted into the accumulator from the top. */
  function decode(h){
    let code = 0, first = 0, index = 0;
    for(let len = 1; len <= 15; len++){
      code |= bits(1);
      const cnt = h.count[len];
      if(code - first < cnt) return h.symbol[index + (code - first)];
      index += cnt;
      first = (first + cnt) << 1;
      code <<= 1;
    }
    throw new Error("bad Huffman code");
  }
  function room(n){
    if(op + n <= out.length) return;
    let cap = out.length * 2;
    while(cap < op + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(out.subarray(0, op));
    out = next;
  }

  for(;;){
    const last = bits(1), type = bits(2);

    if(type === 0){                       // stored: byte-aligned, length-prefixed
      bb = 0; bc = 0;
      if(bp + 4 > src.length) throw new Error("truncated stored block");
      const len = src[bp] | (src[bp + 1] << 8);
      bp += 4;                            // LEN then its one's complement
      room(len);
      out.set(src.subarray(bp, bp + len), op);
      op += len; bp += len;
    }else if(type === 1 || type === 2){
      let lit = FIXED_LIT, dist = FIXED_DIST;
      if(type === 2){
        const nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4;
        const clen = new Uint8Array(19);
        for(let i = 0; i < ncode; i++) clen[CLORDER[i]] = bits(3);
        const cl = huffman(clen);
        /* The literal and distance lengths are themselves Huffman-coded, and
           three of the symbols are run-lengths rather than lengths. */
        const lengths = new Uint8Array(nlen + ndist);
        for(let i = 0; i < lengths.length;){
          const sym = decode(cl);
          if(sym < 16){ lengths[i++] = sym; continue; }
          let repeat, value = 0;
          if(sym === 16){
            if(i === 0) throw new Error("no length to repeat");
            value = lengths[i - 1]; repeat = 3 + bits(2);
          }else if(sym === 17) repeat = 3 + bits(3);
          else repeat = 11 + bits(7);
          while(repeat-- && i < lengths.length) lengths[i++] = value;
        }
        lit = huffman(lengths.subarray(0, nlen));
        dist = huffman(lengths.subarray(nlen));
      }
      for(;;){
        const sym = decode(lit);
        if(sym < 256){ room(1); out[op++] = sym; continue; }
        if(sym === 256) break;            // end of block
        const li = sym - 257;
        if(li >= LBASE.length) throw new Error("bad length code");
        const len = LBASE[li] + bits(LEXT[li]);
        const di = decode(dist);
        const back = DBASE[di] + bits(DEXT[di]);
        if(back > op) throw new Error("distance runs off the front of the output");
        room(len);
        /* Copies may overlap — that is how DEFLATE encodes runs — so this is a
           byte loop rather than a set() of a subarray. */
        let from = op - back;
        for(let i = 0; i < len; i++) out[op++] = out[from++];
      }
    }else{
      throw new Error("reserved deflate block type");
    }
    if(last) break;
  }
  return out.subarray(0, op);
}

/* Native where it exists, the transcription above where it does not. */
async function inflate(src, hint){
  if(typeof DecompressionStream === "function"){
    try{
      const stream = new Blob([src]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }catch(e){
      /* Chrome 80–102 has DecompressionStream but not the deflate-raw format,
         and some engines throw only once bytes actually move. Fall through. */
    }
  }
  return inflateRaw(src, hint);
}

/* ---------------- the archive ---------------- */

/* A ZIP is read back-to-front: the central directory at the end is the index,
   and only it can be trusted — the per-file local headers are allowed to leave
   the sizes at zero and defer them to a trailer. */
async function openZip(buffer){
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  /* End of central directory: fixed signature, then a comment of up to 64 KB,
     so it is found by scanning backwards from the last possible position. */
  let eocd = -1;
  const floor = Math.max(0, bytes.length - 65557);
  for(let i = bytes.length - 22; i >= floor; i--){
    if(view.getUint32(i, true) === 0x06054b50){ eocd = i; break; }
  }
  if(eocd < 0) throw new Error("Not a ZIP file — no end-of-directory record.");

  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  if(at === 0xFFFFFFFF) throw new Error("ZIP64 archives are not supported.");

  const entries = new Map();
  for(let i = 0; i < count && at + 46 <= bytes.length; i++){
    if(view.getUint32(at, true) !== 0x02014b50) break;
    const method   = view.getUint16(at + 10, true);
    const csize    = view.getUint32(at + 20, true);
    const usize    = view.getUint32(at + 24, true);
    const nameLen  = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const cmtLen   = view.getUint16(at + 32, true);
    const offset   = view.getUint32(at + 42, true);
    /* Names are UTF-8 when the language-encoding flag is set and CP437 when it
       is not, but every EPUB writer sets it and CP437 agrees with UTF-8 across
       ASCII, which is all a manifest path ever needs. */
    const name = new TextDecoder("utf-8").decode(bytes.subarray(at + 46, at + 46 + nameLen));
    entries.set(name, {name, method, csize, usize, offset});
    at += 46 + nameLen + extraLen + cmtLen;
  }
  if(!entries.size) throw new Error("The archive is empty.");

  async function read(name){
    const e = entries.get(name);
    if(!e) throw new Error(`${name} is not in the archive`);
    /* The local header's own name and extra fields are the only thing needed
       from it: everything else came from the directory. */
    if(view.getUint32(e.offset, true) !== 0x04034b50)
      throw new Error(`${name} has a damaged local header`);
    const start = e.offset + 30
      + view.getUint16(e.offset + 26, true)
      + view.getUint16(e.offset + 28, true);
    const raw = bytes.subarray(start, start + e.csize);
    if(e.method === 0) return raw;
    if(e.method === 8) return inflate(raw, e.usize);
    throw new Error(`${name} uses an unsupported compression method (${e.method})`);
  }

  const text = async name => new TextDecoder("utf-8").decode(await read(name));
  return {entries, names: [...entries.keys()], has: n => entries.has(n), read, text};
}


/* ==================================================================
   EPUB AND PLAIN TEXT, AS CHAPTERS
   ================================================================== */

/* an EPUB, or a plain text file, turned into chapters of prose.
 *
 * What the reader wants out of a book is paragraphs. Everything an EPUB
 * carries besides that — its stylesheets, its fonts, its page templates, the
 * publisher's cover markup — is dropped here rather than being rendered,
 * because the reading surface downstream is annotating every word and needs
 * the text under its own typography to do it.
 *
 * The shape that comes out:
 *   {title, author, lang, chapters:[{title, blocks:[{tag, text}]}], hanzi}
 */

/* The tags worth keeping as their own block. Everything else contributes its
   text to whichever of these encloses it. */
const BLOCK_TAGS = new Set(["P","H1","H2","H3","H4","H5","H6","LI","BLOCKQUOTE","PRE","DIV","TD","DT","DD"]);
const HEADINGS = new Set(["H1","H2","H3","H4","H5","H6"]);

const countHanzi = s => (String(s).match(/[㐀-鿿豈-﫿]/g) || []).length;

/* A path relative to the document that named it. EPUB manifests are full of
   "../Text/ch01.xhtml", and the archive is keyed by the flat path. */
function resolvePath(base, href){
  const clean = decodeURIComponent(String(href).split("#")[0].trim());
  if(!clean) return "";
  if(clean.startsWith("/")) return clean.slice(1);
  const parts = base ? base.split("/").slice(0, -1) : [];
  for(const seg of clean.split("/")){
    if(seg === "." || seg === "") continue;
    if(seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

/* Archive lookup that tolerates a manifest whose case does not match the
   archive's. It should never differ and in a handful of real books it does. */
function findEntry(zip, path){
  if(zip.has(path)) return path;
  const want = path.toLowerCase();
  return zip.names.find(n => n.toLowerCase() === want) || null;
}

function parseXML(text, kind = "application/xml"){
  const doc = new DOMParser().parseFromString(text, kind);
  if(doc.querySelector("parsererror")) throw new Error("Malformed XML in the book.");
  return doc;
}

/* Whitespace as prose wants it. XHTML indentation puts newlines and runs of
   spaces inside every paragraph; a Chinese book also arrives full of ideographic
   spaces used as first-line indents, which are noise once the paragraph has a
   text-indent of its own. */
const tidy = s => String(s)
  .replace(/ /g, " ")
  .replace(/\s+/g, " ")
  .replace(/^[\s　]+|[\s　]+$/g, "");

/* One XHTML document flattened to blocks.
 *
 * The walk keeps a block open until it meets the next block-level element,
 * which is what makes inline markup — <em>, <span>, <a>, a stray <br> —
 * disappear into the sentence it belongs to rather than splitting it. */
function blocksFrom(html){
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style,head,svg,rt,rp").forEach(el => el.remove());
  const body = doc.body;
  if(!body) return [];

  const out = [];
  let open = null;
  /* A blockquote almost always wraps paragraphs rather than holding text
     directly, so the fact that they are quoted has to be carried down to them
     — otherwise the quote is flattened into ordinary prose. */
  let quoted = 0;

  const flush = () => {
    if(!open) return;
    const text = tidy(open.text);
    if(text) out.push({tag: open.tag === "p" && quoted ? "q" : open.tag, text});
    open = null;
  };

  const walk = node => {
    for(const child of node.childNodes){
      if(child.nodeType === 3){                       // text
        if(open) open.text += child.nodeValue;
        else if(tidy(child.nodeValue)) { open = {tag:"p", text: child.nodeValue}; }
        continue;
      }
      if(child.nodeType !== 1) continue;
      const tag = child.tagName.toUpperCase();
      if(tag === "BR"){ if(open) open.text += " "; continue; }
      if(tag === "IMG"){ continue; }                  // pictures are not text
      if(!BLOCK_TAGS.has(tag)){ walk(child); continue; }

      /* A DIV that only wraps other blocks is a container, not a paragraph —
         opening one would swallow every paragraph inside it into a single
         run. A DIV holding text directly is how a lot of books write <p>. */
      const wraps = (tag === "DIV" || tag === "BLOCKQUOTE") &&
        [...child.children].some(c => BLOCK_TAGS.has(c.tagName.toUpperCase()));
      if(wraps){
        flush();
        if(tag === "BLOCKQUOTE") quoted++;
        walk(child);
        if(tag === "BLOCKQUOTE") quoted--;
        continue;
      }

      flush();
      open = {tag: HEADINGS.has(tag) ? "h" : tag === "BLOCKQUOTE" ? "q" : "p", text: ""};
      walk(child);
      flush();
    }
  };
  walk(body);
  flush();
  return out;
}

/* href (without its fragment) -> the label the table of contents gives it.
   EPUB 3 ships a nav document, EPUB 2 an NCX; books in the wild ship either,
   and plenty ship both. */
async function tocLabels(zip, opfPath, manifest, spineIds){
  const labels = new Map();
  const add = (href, label) => {
    const path = resolvePath(opfPath, href);
    if(path && label && !labels.has(path)) labels.set(path, tidy(label));
  };

  const navItem = [...manifest.values()].find(m => (m.props || "").includes("nav"));
  if(navItem){
    try{
      const path = findEntry(zip, resolvePath(opfPath, navItem.href));
      const doc = new DOMParser().parseFromString(await zip.text(path), "text/html");
      const nav = doc.querySelector('nav[*|type="toc"]') || doc.querySelector("nav") || doc.body;
      nav?.querySelectorAll("a[href]").forEach(a =>
        add(resolvePath(navItem.href, a.getAttribute("href")), a.textContent));
    }catch(e){ /* a broken nav is not a reason to refuse the book */ }
  }

  const ncxId = [...manifest.entries()]
    .find(([, m]) => m.type === "application/x-dtbncx+xml")?.[0];
  const ncxHref = ncxId ? manifest.get(ncxId).href : null;
  if(ncxHref){
    try{
      const path = findEntry(zip, resolvePath(opfPath, ncxHref));
      const doc = parseXML(await zip.text(path));
      doc.querySelectorAll("navPoint").forEach(np => {
        const href = np.querySelector("content")?.getAttribute("src");
        const label = np.querySelector("navLabel > text")?.textContent;
        if(href) add(resolvePath(ncxHref, href), label);
      });
    }catch(e){ /* likewise */ }
  }
  return labels;
}

/* ---------------- the front door ---------------- */

async function parseEpub(buffer){
  const zip = await openZip(buffer);

  /* The one path an EPUB fixes by specification. Everything else is found by
     following it. */
  const containerPath = findEntry(zip, "META-INF/container.xml");
  if(!containerPath) throw new Error("Not an EPUB — META-INF/container.xml is missing.");
  const container = parseXML(await zip.text(containerPath));
  const opfHref = container.querySelector("rootfile")?.getAttribute("full-path");
  if(!opfHref) throw new Error("The book does not say where its content file is.");

  const opfPath = findEntry(zip, decodeURIComponent(opfHref));
  if(!opfPath) throw new Error("The book's content file is missing from the archive.");
  const opf = parseXML(await zip.text(opfPath));

  const meta = tag => opf.getElementsByTagNameNS("*", tag)[0]?.textContent?.trim() || "";

  const manifest = new Map();
  for(const item of opf.getElementsByTagNameNS("*", "item")){
    const id = item.getAttribute("id");
    if(!id) continue;
    manifest.set(id, {
      href: item.getAttribute("href") || "",
      type: item.getAttribute("media-type") || "",
      props: item.getAttribute("properties") || "",
    });
  }

  const spineIds = [...opf.getElementsByTagNameNS("*", "itemref")]
    .filter(r => r.getAttribute("linear") !== "no")
    .map(r => r.getAttribute("idref"))
    .filter(id => manifest.has(id));
  if(!spineIds.length) throw new Error("The book has no readable sections.");

  const labels = await tocLabels(zip, opfPath, manifest, spineIds);

  const chapters = [];
  for(const id of spineIds){
    const item = manifest.get(id);
    if(!/x?html/.test(item.type) && !/\.x?html?$/i.test(item.href)) continue;
    const path = findEntry(zip, resolvePath(opfPath, item.href));
    if(!path) continue;

    let blocks;
    try{ blocks = blocksFrom(await zip.text(path)); }
    catch(e){ continue; }                 // one bad section should not lose the book
    if(!blocks.length) continue;

    /* A title from the table of contents beats one scraped out of the markup:
       it is the one the author wrote for this section. */
    const heading = blocks.find(b => b.tag === "h");
    const title = labels.get(path) || (heading && heading.text) || `Section ${chapters.length + 1}`;
    chapters.push({title: title.slice(0, 120), blocks});
  }
  if(!chapters.length) throw new Error("No text could be read out of this book.");

  /* Front matter is often a cover page and a copyright notice with no prose in
     them at all. They stay — skipping them would renumber the chapters against
     the book's own contents — but they are why the count below is of the whole
     book rather than of chapter one. */
  const hanzi = chapters.reduce((n, ch) =>
    n + ch.blocks.reduce((m, b) => m + countHanzi(b.text), 0), 0);

  return {
    title: meta("title") || "Untitled",
    author: meta("creator") || "",
    lang: meta("language") || "",
    chapters, hanzi,
  };
}

/* A plain .txt file, or text pasted straight in.
 *
 * Chapters are cut on a heading that looks like one — 第一章, Chapter 4, a
 * bare 序言 — and where a file has none it is sliced into even runs, because a
 * single chapter of nine hundred paragraphs is not something to navigate. */
const CHAPTER_LINE = /^\s*(?:第\s*[0-9零一二三四五六七八九十百千两]+\s*[章回节節篇卷折]|[Cc]hapter\s+[0-9IVXLC]+|[0-9]{1,3}[.、]\s*\S|序[言章]?|前言|楔子|后记|後記|尾声|尾聲)/;
const SLICE = 60;

function parseText(raw, name){
  const lines = String(raw).replace(/\r\n?/g, "\n").split("\n")
    .map(tidy).filter(Boolean);
  if(!lines.length) throw new Error("There is no text in that file.");

  /* Decided up front rather than while building, because the two layouts want
     opposite things: a file with chapter lines is cut at exactly those and
     nowhere else, and a file without any is cut at even intervals. Mixing the
     two rules — the earlier version started slicing and stopped as soon as the
     first slice existed — left everything after the first cut in one section. */
  const headed = lines.some(l => CHAPTER_LINE.test(l) && l.length <= 40);

  const chapters = [];
  let cur = null;
  const open = title => { cur = {title, blocks: []}; chapters.push(cur); };

  for(const text of lines){
    if(headed && CHAPTER_LINE.test(text) && text.length <= 40){
      open(text);
      cur.blocks.push({tag:"h", text});
      continue;
    }
    if(!cur) open(headed ? "Beginning" : "Part 1");
    if(!headed && cur.blocks.length >= SLICE) open(`Part ${chapters.length + 1}`);
    cur.blocks.push({tag:"p", text});
  }

  const first = chapters[0].blocks.find(b => b.text.length > 1);
  const hanzi = chapters.reduce((n, ch) =>
    n + ch.blocks.reduce((m, b) => m + countHanzi(b.text), 0), 0);

  return {
    title: (name || "").replace(/\.[a-z]+$/i, "") || tidy(first?.text || "").slice(0, 40) || "Untitled",
    author: "", lang: "", chapters, hanzi,
  };
}

/* One entry point for whatever the reader handed over. */
async function parseBook(file){
  const name = file.name || "";
  if(/\.epub$/i.test(name) || file.type === "application/epub+zip"){
    return parseEpub(await file.arrayBuffer());
  }
  return parseText(await file.text(), name);
}
