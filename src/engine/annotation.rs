//! Render a reader block as UTF-16 so browser selection offsets and arbitrary
//! imported text (including isolated surrogates) survive the round trip.
//!
//! A section of a novel is ten thousand words and several megabytes of
//! markup, so this writes straight into one buffer: fixed markup is copied as
//! ASCII, numbers are written digit by digit, and text is copied in runs
//! between the few characters that need escaping.
use std::cell::RefCell;
use super::ENGINE;

thread_local! { static MARKUP: RefCell<Vec<u16>> = RefCell::new(Vec::new()); }

// Every fixed piece of markup is ASCII, so each byte is one UTF-16 unit.
fn ascii(out: &mut Vec<u16>, s: &str) { out.extend(s.bytes().map(u16::from)); }
fn number(out: &mut Vec<u16>, mut n: usize) {
    let mut digits = [0u16; 20];
    let mut at = digits.len();
    loop {
        at -= 1;
        digits[at] = u16::from(b'0') + (n % 10) as u16;
        n /= 10;
        if n == 0 { break; }
    }
    out.extend_from_slice(&digits[at..]);
}
fn escaped(out: &mut Vec<u16>, text: &[u16]) {
    let mut start = 0;
    for (i, &u) in text.iter().enumerate() {
        let entity = match u {
            38 => "&amp;", 60 => "&lt;", 62 => "&gt;", 34 => "&quot;", 39 => "&#39;",
            _ => continue,
        };
        out.extend_from_slice(&text[start..i]);
        ascii(out, entity);
        start = i + 1;
    }
    out.extend_from_slice(&text[start..]);
}
pub(super) fn whitespace(u:u16) -> bool {
    matches!(u, 9..=13 | 32 | 0xa0 | 0x1680 | 0x2000..=0x200a | 0x2028 | 0x2029 | 0x202f | 0x205f | 0x3000 | 0xfeff)
}
// Punctuation Chinese typography will not let a line begin with:
// 。．，、；：！？）］｝〕〉》」』】〞’”…‥・%,.:;!?)]}
fn no_line_start(u:u16) -> bool {
    matches!(u, 0x3002 | 0xFF0E | 0xFF0C | 0x3001 | 0xFF1B | 0xFF1A | 0xFF01 | 0xFF1F | 0xFF09 | 0xFF3D
        | 0xFF5D | 0x3015 | 0x3009 | 0x300B | 0x300D | 0x300F | 0x3011 | 0x301E | 0x2019 | 0x201D
        | 0x2026 | 0x2025 | 0x30FB | 0x25 | 0x2C | 0x2E | 0x3A | 0x3B | 0x21 | 0x3F | 0x29 | 0x5D | 0x7D)
}
// ...and will not let a line end with: （［｛〔〈《「『【〝‘“([{
fn no_line_end(u:u16) -> bool {
    matches!(u, 0xFF08 | 0xFF3B | 0xFF5B | 0x3014 | 0x3008 | 0x300A | 0x300C | 0x300E | 0x3010 | 0x301D
        | 0x2018 | 0x201C | 0x28 | 0x5B | 0x7B)
}
fn punct(out:&mut Vec<u16>, text:&[u16], index:usize) {
    let mut rest = text;
    while let Some(&first) = rest.first() {
        let space = whitespace(first);
        let n = rest.iter().position(|&c| whitespace(c) != space).unwrap_or(rest.len());
        if space {
            escaped(out, &rest[..n]);
        } else {
            ascii(out, "<span class=\"rdx\" data-i=\"");
            number(out, index);
            ascii(out, "\">");
            escaped(out, &rest[..n]);
            ascii(out, "</span>");
        }
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
        // Markup is several times the text; reserving once saves the copies
        // a growing buffer makes on the way up.
        out.reserve(e.input.len() * 8);
        let mut pending = Vec::new();
        let mut last = None;
        let mut at = 0;
        let mut i = 0;
        while at < e.input.len() {
            let header = &e.input[at..at+5];
            let n = usize::from(header[3]) | (usize::from(header[4]) << 16);
            let raw = &e.input[at+5..at+5+n];
            at += 5+n;
            if header[0] == 0 {
                let a = raw.iter().take_while(|&&u| no_line_start(u)).count();
                let tail = raw[a..].iter().rev().take_while(|&&u| no_line_end(u)).count();
                let b = raw.len()-tail;
                if a > 0 {
                    if let Some(pos) = last {
                        out.splice(pos..pos, "<span class=\"nb\">".bytes().map(u16::from));
                        punct(out, &raw[..a], i);
                        ascii(out, "</span>");
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
                if glued { ascii(out, "<span class=\"nb\">"); out.append(&mut pending); }
                ascii(out, if span { "<span class=\"rdw" } else { "<button class=\"rdw" });
                if mode == 1 {
                    if header[1] == 0 { ascii(out, " kx"); }
                    else { ascii(out, " k"); number(out, header[1].into()); }
                    if dim && header[2] == 2 { ascii(out, " seen"); }
                } else if mode == 2 { ascii(out, " f"); number(out, header[2].into()); }
                ascii(out, "\" data-i=\"");
                number(out, i);
                ascii(out, "\"");
                if span { ascii(out, " role=\"button\""); }
                ascii(out, " tabindex=\"-1\">");
                if header[0] == 2 { out.extend_from_slice(raw); } else { escaped(out, raw); }
                ascii(out, if span { "</span>" } else { "</button>" });
                if glued { ascii(out, "</span>"); }
            }
            i += 1;
        }
        out.append(&mut pending);
        out.len()
    }))
}
