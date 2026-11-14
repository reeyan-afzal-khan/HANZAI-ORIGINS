//! Render a reader block as UTF-16 so browser selection offsets and arbitrary
//! imported text (including isolated surrogates) survive the round trip.
use std::cell::RefCell;
use std::fmt::Write;
use super::ENGINE;

thread_local! { static MARKUP: RefCell<Vec<u16>> = RefCell::new(Vec::new()); }
fn append(out: &mut Vec<u16>, s: &str) { out.extend(s.encode_utf16()); }
fn escaped(out: &mut Vec<u16>, text: &[u16]) {
    for &u in text {
        match u {
            38 => append(out,"&amp;"), 60 => append(out,"&lt;"), 62 => append(out,"&gt;"),
            34 => append(out,"&quot;"), 39 => append(out,"&#39;"), _ => out.push(u),
        }
    }
}
pub(super) fn whitespace(u:u16) -> bool {
    matches!(u, 9..=13 | 32 | 0xa0 | 0x1680 | 0x2000..=0x200a | 0x2028 | 0x2029 | 0x202f | 0x205f | 0x3000 | 0xfeff)
}
fn in_set(u:u16, set:&str) -> bool {
    char::from_u32(u.into()).is_some_and(|c| set.contains(c))
}
fn punct(out:&mut Vec<u16>, text:&[u16], index:usize) {
    let mut rest = text;
    while !rest.is_empty() {
        let space = whitespace(rest[0]);
        let n = rest.iter().position(|&c| whitespace(c) != space).unwrap_or(rest.len());
        if !space { append(out, &format!(r#"<span class="rdx" data-i="{index}">"#)); }
        escaped(out, &rest[..n]);
        if !space { append(out, "</span>"); }
        rest = &rest[n..];
    }
}

#[no_mangle]
pub extern "C" fn annotation_ptr() -> *const u16 { MARKUP.with_borrow(|m| m.as_ptr()) }

// Each input record is kind, level, familiarity, length (two units), payload.
// Ruby payloads contain trusted markup already escaped by the pinyin renderer.
#[no_mangle]
pub extern "C" fn annotate(mode:u32, span:bool, dim:bool) -> usize {
    ENGINE.with_borrow(|e| MARKUP.with_borrow_mut(|out| {
        out.clear();
        let mut pending = Vec::new();
        let mut last = None;
        let mut at = 0;
        let mut i = 0;
        let mut tag = String::new();
        while at < e.input.len() {
            let header = &e.input[at..at+5];
            let n = usize::from(header[3]) | (usize::from(header[4]) << 16);
            let raw = &e.input[at+5..at+5+n];
            at += 5+n;
            if header[0] == 0 {
                let a = raw.iter().take_while(|&&u| in_set(u,"。．，、；：！？）］｝〕〉》」』】〞’”…‥・%,.:;!?)]}")).count();
                let tail = raw[a..].iter().rev().take_while(|&&u| in_set(u,"（［｛〔〈《「『【〝‘“([{")).count();
                let b = raw.len()-tail;
                if a > 0 {
                    if let Some(pos) = last {
                        out.splice(pos..pos, "<span class=\"nb\">".encode_utf16());
                        punct(out, &raw[..a], i);
                        append(out, "</span>");
                    } else {
                        last = Some(out.len());
                        punct(out, &raw[..a], i);
                    }
                }
                if b > a { last = Some(out.len()); punct(out, &raw[a..b], i); }
                if b < raw.len() { punct(&mut pending, &raw[b..], i); }
            } else {
                last = Some(out.len());
                let glued = !pending.is_empty();
                if glued { append(out,"<span class=\"nb\">"); out.append(&mut pending); }
                tag.clear();
                tag.push_str(if span { "<span class=\"rdw" } else { "<button class=\"rdw" });
                if mode == 1 {
                    if header[1] == 0 { tag.push_str(" kx"); }
                    else { write!(tag," k{}",header[1]).unwrap(); }
                    if dim && header[2] == 2 { tag.push_str(" seen"); }
                } else if mode == 2 { write!(tag," f{}",header[2]).unwrap(); }
                write!(tag,"\" data-i=\"{i}\"").unwrap();
                if span { tag.push_str(" role=\"button\""); }
                tag.push_str(" tabindex=\"-1\">");
                append(out,&tag);
                if header[0] == 2 { out.extend_from_slice(raw); } else { escaped(out, raw); }
                append(out, if span { "</span>" } else { "</button>" });
                if glued { append(out, "</span>"); }
            }
            i += 1;
        }
        out.append(&mut pending);
        out.len()
    }))
}
