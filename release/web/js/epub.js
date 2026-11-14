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
 * the portable decoder. A browser without that API uses the Rust decoder.
 */

/* ---------------- inflate ---------------- */

function inflateRaw(src){
  const ptr = webEngine.archive_buffer(src.length);
  new Uint8Array(webEngine.memory.buffer, ptr, src.length).set(src);
  const size = webEngine.inflate_raw();
  if(size < 0) throw new Error("Damaged DEFLATE stream");
  return new Uint8Array(webEngine.memory.buffer, webEngine.inflated_ptr(), size).slice();
}

async function inflate(src){
  if(typeof DecompressionStream === "function"){
    try{
      const stream = new Blob([src]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }catch(e){
      /* Chrome 80–102 has DecompressionStream but not the deflate-raw format,
         and some engines throw only once bytes actually move. Fall through. */
    }
  }
  return inflateRaw(src);
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
  const tail = Math.max(0, bytes.length - 65557);
  const transfer = slice => {
    const ptr = webEngine.archive_buffer(slice.length);
    new Uint8Array(webEngine.memory.buffer, ptr, slice.length).set(slice);
  };
  transfer(bytes.subarray(tail));
  const trailer = webEngine.zip_trailer();
  if(trailer < 0) throw new Error("Not a ZIP file — no end-of-directory record.");
  const eocd = tail + trailer;
  const count = view.getUint16(eocd + 10, true);
  const offset = view.getUint32(eocd + 16, true);
  if(offset === 0xFFFFFFFF) throw new Error("ZIP64 archives are not supported.");
  const directory = bytes.subarray(offset, eocd);
  transfer(directory);
  const length = webEngine.zip_directory(count);
  const rows = new Uint32Array(webEngine.memory.buffer, webEngine.output(), length);
  const entries = new Map(), decoder = new TextDecoder("utf-8");
  for(let i = 0; i < length; i += 6){
    const name = decoder.decode(directory.subarray(rows[i], rows[i] + rows[i+1]));
    entries.set(name, {name, method:rows[i+2], csize:rows[i+3], usize:rows[i+4], offset:rows[i+5]});
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
    if(e.method === 8) return inflate(raw);
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
function parseText(raw, name){
  const ptr = copyReaderText(String(raw));
  const length = webEngine.import_text();
  const rows = new Uint32Array(webEngine.memory.buffer, webEngine.output(), length);
  if(length === 3) throw new Error("There is no text in that file.");

  const text = engineUnits(ptr, rows[0]);
  const hanzi = rows[1], headed = rows[2];
  const chapters = [];
  let chapter;
  for(let i = 3; i < rows.length; i += 4){
    const line = text.slice(rows[i], rows[i] + rows[i + 1]);
    const heading = rows[i + 2] !== 0;
    if(rows[i + 3]){
      const title = heading ? line : headed ? "Beginning" : `Part ${chapters.length + 1}`;
      chapter = {title, blocks:[]};
      chapters.push(chapter);
    }
    chapter.blocks.push({tag:heading ? "h" : "p", text:line});
  }
  const first = chapters[0].blocks.find(b => b.text.length > 1);
  return {title:(name || "").replace(/\.[a-z]+$/i, "") || first?.text.slice(0, 40) || "Untitled",
          author:"", lang:"", chapters, hanzi};
}

/* One entry point for whatever the reader handed over. */
async function parseBook(file){
  const name = file.name || "";
  if(/\.epub$/i.test(name) || file.type === "application/epub+zip"){
    return parseEpub(await file.arrayBuffer());
  }
  return parseText(await file.text(), name);
}
