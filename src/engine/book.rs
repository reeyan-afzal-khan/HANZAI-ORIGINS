use super::ENGINE;

#[no_mangle]
pub extern "C" fn section_parts(len: f64) -> usize {
    if len > 18000.0 { (len / 12000.0).ceil() as usize } else { 1 }
}

#[no_mangle]
pub extern "C" fn section_breaks() -> usize {
    ENGINE.with_borrow_mut(|e| {
        let lengths = e.input.chunks_exact(2).map(|p| u32::from(p[0]) | (u32::from(p[1]) << 16));
        let total: f64 = lengths.clone().map(f64::from).sum();
        let parts = section_parts(total);
        let each = total / parts as f64;
        let mut done = 0.0;
        e.output.clear();
        e.output.push(parts as u32);
        for (i,len) in lengths.enumerate() {
            done += f64::from(len);
            if e.output.len() < parts && done >= each * e.output.len() as f64 {
                e.output.push((i+1) as u32);
            }
        }
        let end = (e.input.len()/2) as u32;
        if e.output.len() == 1 || e.output.last() != Some(&end) { e.output.push(end); }
        e.output.len()
    })
}

fn heading(line: &[u16]) -> bool {
    if line.len() > 40 { return false; }
    let text = String::from_utf16_lossy(line);
    if ["序","前言","楔子","后记","後記","尾声","尾聲"].iter().any(|s| text.starts_with(s)) {
        return true;
    }
    if let Some(rest) = text.strip_prefix('第') {
        let rest = rest.trim_start_matches(' ');
        let suffix = rest.trim_start_matches(|c: char| c.is_ascii_digit() || "零一二三四五六七八九十百千两".contains(c));
        return suffix.len() < rest.len() && suffix.trim_start_matches(' ').starts_with(|c| "章回节節篇卷折".contains(c));
    }
    if let Some(rest) = text.strip_prefix("chapter ").or_else(|| text.strip_prefix("Chapter ")) {
        return rest.starts_with(|c: char| c.is_ascii_digit() || "IVXLC".contains(c));
    }
    let digits = text.bytes().take_while(u8::is_ascii_digit).count();
    (1..=3).contains(&digits) && text[digits..].strip_prefix(['.', '、'])
        .is_some_and(|s| !s.trim_start_matches(' ').is_empty())
}

// Return each tidied line's offset and length within the compacted input,
// followed by its block kind and whether it opens a new section.
#[no_mangle]
pub extern "C" fn import_text() -> usize {
    ENGINE.with_borrow_mut(|e| {
        let mut lines = Vec::new();
        let mut start = 0;
        let mut write = 0;
        let mut space = false;
        let mut hanzi = 0;
        let mut headed = false;
        for i in 0..=e.input.len() {
            let u = e.input.get(i).copied().unwrap_or(10);
            if matches!(u, 10 | 13) {
                if write > start {
                    let h = heading(&e.input[start..write]);
                    lines.push((start, write-start, h));
                    headed |= h;
                }
                start = write;
                space = false;
            } else if super::annotation::whitespace(u) {
                space = write > start;
            } else {
                if space { e.input[write] = 32; write += 1; space = false; }
                e.input[write] = u;
                write += 1;
                hanzi += u32::from(matches!(u, 0x3400..=0x9fff | 0xf900..=0xfaff));
            }
        }
        e.output.clear();
        e.output.extend([write as u32, hanzi, u32::from(headed)]);
        for (i, (start, len, h)) in lines.into_iter().enumerate() {
            let new_section = i == 0 || h || (!headed && i % 60 == 0);
            e.output.extend([start as u32, len as u32, h.into(), new_section.into()]);
        }
        e.output.len()
    })
}
